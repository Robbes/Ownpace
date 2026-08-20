// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Graph Drive Source Connector Implementation
 * 
 * Implements FileSource interface for Microsoft OneDrive/SharePoint file synchronization.
 * Uses Microsoft Graph API v1.0 with delta query for incremental synchronization.
 * 
 * Features:
 * - File/folder enumeration via {scope}/drive/root/children endpoint
 * - Delta query for incremental sync, scoped per folder ({scope}/drive/root:{path}:/delta)
 * - Path normalization as natural key (§10)
 * - cTag/quickXorHash as cheap change detection before byte hashing
 * - Download streams to file writer
 * - Handle renamed files (same GUID, different path) - log as drift, not duplicate
 * - Rate limiting and throttling support
 */

import type { FileSource, FileFolder, RawFileItem, SyncCursor, ThrottleLimiter, FileItem } from '@openmig/shared';
import type { GraphDriveSourceConfig, GraphDriveItem, GraphDriveDeltaResponse, GraphDriveDeltaCursor, ParsedPath, NormalizePathOptions } from './graph-drive-source.types.ts';
import { graphScopePrefix } from './graph-scope.ts';
import type { HttpClient as _HttpClient, HttpRequestOptions, HttpResponse } from './dav-http.types.ts';
import { log } from '@openmig/shared';

/**
 * Graph Drive source connector implementation.
 */
/** Deeper than any real drive nests — a guard against a looping walk. */
const MAX_FOLDER_DEPTH = 64;

export class GraphDriveSource implements FileSource {
  private readonly config: GraphDriveSourceConfig;
  private readonly baseUrl: string;
  private readonly throttleLimiter?: ThrottleLimiter;
  private readonly provider: string;
  /** `{baseUrl}/me` or `{baseUrl}/users/{address}` — see graph-scope.ts. */
  private readonly scope: string;

  constructor(
    config: GraphDriveSourceConfig,
    throttleLimiter?: ThrottleLimiter,
  ) {
    this.config = config;
    this.baseUrl = config.baseUrl?.replace(/\/$/, '') ?? 'https://graph.microsoft.com/v1.0';
    this.throttleLimiter = throttleLimiter;
    this.provider = this.extractProviderFromBaseUrl(this.baseUrl);
    // Application-permission scope, workplan 0027 T0; `/me` by default.
    this.scope = graphScopePrefix(this.baseUrl, config.mailbox);
  }

  /**
   * Every folder in the drive, depth-first, ROOT INCLUDED.
   *
   * Two things this had wrong until 2026-08-17, both of which lost files
   * silently rather than failing:
   *
   *  - It listed `/drive/root/children` and never recursed, so only top-level
   *    folders were ever returned. The sync loop migrates exactly what this
   *    answers, so nothing nested was ever enumerated as a collection.
   *  - It omitted the root itself. Every other file source emits `{ path: '' }`
   *    first (`WebdavFileSource`, Drive, Box, Dropbox), because files sitting
   *    directly in the account root live in that collection and nothing else
   *    lists them.
   *
   * Folder paths keep this connector's leading-slash form (`/Documents`),
   * which `listSince` needs verbatim to build `…/root:/Documents:/delta`. The
   * root is the one exception, spelled `''` — the same value `listSince`
   * already recognised.
   */
  async listFolders(): Promise<ReadonlyArray<FileFolder>> {
    const folders: FileFolder[] = [{ path: '' }];

    const walk = async (url: string, prefix: string, depth: number): Promise<void> => {
      // A drive cannot nest this deep; a walk that says otherwise is looping,
      // and an unbounded recursion against a customer tenant is the expensive
      // way to find that out.
      if (depth > MAX_FOLDER_DEPTH) {
        throw new Error(
          `OneDrive folder walk passed ${MAX_FOLDER_DEPTH} levels at "${prefix}" — refusing to ` +
            'keep recursing.',
        );
      }
      let nextLink: string | undefined;
      do {
        const response = await this.makeRequest({
          url: nextLink ?? url,
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
        });

        if (response.status !== 200) {
          throw new Error(`Failed to list drive items: ${response.status} - ${response.body}`);
        }

        const data = JSON.parse(response.body) as {
          value: GraphDriveItem[];
          '@odata.nextLink'?: string;
        };

        // Only folders: files arrive through `listSince`, per collection.
        for (const item of data.value) {
          if (!item.folder) continue;
          const path = `${prefix}/${item.name}`;
          folders.push({
            path,
            name: item.name,
            quota: item.folder.childCount
              ? {
                  used: 0, // Graph doesn't provide folder quota directly
                  available: undefined,
                }
              : undefined,
          });
          await walk(`${this.scope}/drive/items/${item.id}/children`, path, depth + 1);
        }

        nextLink = data['@odata.nextLink'];
      } while (nextLink);
    };

    await walk(`${this.scope}/drive/root/children`, '', 0);
    return folders;
  }

  /**
   * The item's path, derived from the fields Graph ACTUALLY returns.
   *
   * There is no `path` property on a driveItem. The type declared one, no
   * response ever carried it, and the natural key therefore fell through to
   * `/${item.name}` for every file in the drive — the whole tree flattened
   * onto the root, so `/Work/notes.txt` and `/Personal/notes.txt` became one
   * key and collided on the ledger's unique index. The unit fixtures invented
   * the field too, which is why the suite stayed green.
   *
   * Graph gives `parentReference.path`: `/drive/root:` at the root,
   * `/drive/root:/Documents` below it, `/drives/{id}/root:/…` when the drive
   * is addressed by id. Everything up to and including `root:` is addressing,
   * not path.
   *
   * `undefined` when it cannot be derived, and the caller SKIPS that item
   * loudly rather than falling back to a bare name: a wrong key is worse than
   * a missing one, because it silently merges two different files.
   *
   * NOT percent-decoded. Whether Graph encodes this field for names with
   * spaces or `%` is exactly the sort of thing only a real tenant settles, and
   * decoding a literal `%` corrupts it (the trap `webdav-trashbin.ts`
   * documents); workplan 0058 records it as the first live run's question.
   */
  private itemPath(item: GraphDriveItem): string | undefined {
    if (!item.name) return undefined;
    const parent = item.parentReference?.path;
    if (parent === undefined) return undefined;
    const marker = parent.indexOf('root:');
    if (marker === -1) return undefined;
    const dir = parent.slice(marker + 'root:'.length);
    return this.normalizePath(`${dir}/${item.name}`);
  }

  /**
   * List files changed since cursor (or all if undefined).
   * Uses delta query for incremental file synchronization.
   * Downloads file streams to the file writer.
   */
  async listSince(
    folder: FileFolder,
    cursor?: SyncCursor,
  ): Promise<{
    items: ReadonlyArray<RawFileItem>;
    nextCursor: SyncCursor;
    removed?: ReadonlyArray<string>;
  }> {
    // Parse cursor to get delta link
    let deltaLink: string | undefined;
    
    if (cursor) {
      try {
        const graphCursor = this.decodeCursor(cursor);
        deltaLink = graphCursor.deltaLink;
      } catch {
        // Invalid cursor, do full sync
        deltaLink = undefined;
      }
    }

    // Scope the delta to THE FOLDER BEING POLLED. The files sync calls this
    // once per folder; both branches used to request the whole drive's root
    // delta, so every folder's poll processed every item on the drive (the
    // ledger's natural key made it converge, but at N-folders × whole-drive
    // cost per pass — 0026 T1 item 1). Graph addresses a folder's delta by
    // path — `{scope}/drive/root:/{path}:/delta` — which scopes the response
    // server-side to that folder's descendants; no client-side filter needed.
    const folderPath = folder.path;
    const isRoot = folderPath === '/' || folderPath === '';

    const baseUrl = isRoot
      ? `${this.scope}/drive/root/delta`
      : `${this.scope}/drive/root:${folderPath
          .split('/')
          .map(encodeURIComponent)
          .join('/')}:/delta`;

    const url = deltaLink ?? baseUrl;

    const items: GraphDriveItem[] = [];
    /**
     * Item IDs Graph reported as DELETED on this poll.
     *
     * The delta query's own removal report, and the OneDrive equivalent of a
     * CalDAV `sync-collection` 404: the service states outright that an item is
     * gone, rather than us inferring it from an absence with a dozen innocent
     * causes. It was being read and thrown away below — `if (item.deleted)
     * continue`, under a comment saying deletions "should be handled separately"
     * with nothing anywhere handling them.
     *
     * IDs, not paths. A deleted delta entry is not guaranteed to carry usable
     * path metadata — `name` and `parentReference` may be partial — but `id` is
     * always present and never changes, which is why it is what the ledger row
     * records as the item's source ref.
     */
    const removed: string[] = [];
    let lastDeltaLink: string | undefined;
    let nextLink: string | undefined;

    // Paginate through all changes
    do {
      const response = await this.makeRequest({
        url: nextLink ?? url,
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (response.status !== 200) {
        throw new Error(`Failed to list drive changes: ${response.status} - ${response.body}`);
      }

      const data = JSON.parse(response.body) as GraphDriveDeltaResponse;
      
      for (const item of data.value) {
        // DELETED, and now carried up instead of discarded. Folders included: a
        // deleted folder's children each get their own delta entry, but a folder
        // whose id we recorded is an item too, and dropping it here would make
        // that one silently unreportable.
        if (item.deleted) {
          if (item.id) removed.push(item.id);
          continue;
        }

        // Skip folders in the items list - we only want files
        if (item.folder) {
          continue;
        }

        items.push(item);
      }
      
      lastDeltaLink = data['@odata.deltaLink'];
      nextLink = data['@odata.nextLink'];
    } while (nextLink);

    // Build metadata-only items (no content fetch in listSince)
    const fileItems: RawFileItem[] = [];
    for (const item of items) {
      try {
        // The natural key, derived from Graph's own fields — see `itemPath`.
        const naturalKey = this.itemPath(item);
        if (naturalKey === undefined) {
          // Never fall back to the bare name. That fallback is what flattened
          // every file onto the root; skipping one item loudly is the honest
          // failure, merging two files silently is not.
          log.warn(
            `[graph-drive] skipping "${item.name}" (id ${item.id}): Graph did not report a ` +
              'usable parentReference.path, so where it lives cannot be named and a natural ' +
              'key would be a guess.',
          );
          continue;
        }

        // Get change detection hash (quickXorHash or cTag)
        const changeHash = item.quickXorHash || item.cTag;
        
        const fileItem: RawFileItem = {
          item: {
            path: naturalKey,
            isDirectory: false,
            size: item.size || 0,
            contentHash: changeHash, // Use quickXorHash as content hash for change detection
            modifiedAt: item.lastModifiedDateTime,
            mimeType: item.file?.mimeType,
            sourceRef: item.id,
          },
          // Content is NOT fetched here - use fetch() method instead
          content: undefined,
        };

        fileItems.push(fileItem);
      } catch (error) {
        // Skip files that fail to process
        log.warn(`Failed to process file ${item.id}:`, error);
      }
    }

    // Create next cursor from delta link
    const nextCursor: SyncCursor = {
      value: this.encodeCursor({
        deltaLink: lastDeltaLink ?? '',
        folderPath: folder.path,
      }),
    };

    // Omitted rather than sent as `[]` when Graph reported nothing, so "the
    // service reported no deletions" and "this poll cannot report deletions" are
    // not spelled the same way. A full `children` listing is the second case.
    return {
      items: fileItems,
      nextCursor,
      ...(removed.length > 0 ? { removed } : {}),
    };
  }

  /**
   * Fetch file content as Uint8Array.
   */
  private async fetchFileContent(itemId: string): Promise<Uint8Array> {
    const url = `${this.scope}/drive/items/${itemId}/content`;
    const response = await this.makeRequest({
      url,
      method: 'GET',
      headers: {
        'Accept': 'application/octet-stream',
      },
    });

    if (response.status !== 200) {
      throw new Error(`Failed to download file: ${response.status} - ${response.body}`);
    }

    // Convert response body to Uint8Array
    const encoder = new TextEncoder();
    return encoder.encode(response.body);
  }

  /**
   * Fetch full raw data for an item (implements FileSource interface).
   */
  async fetch(item: FileItem): Promise<RawFileItem> {
    // Extract item ID from sourceRef
    const itemId = item.sourceRef;
    if (!itemId) {
      throw new Error(`Item missing sourceRef: ${JSON.stringify(item)}`);
    }

    // Fetch content
    const content = await this.fetchFileContent(itemId);

    return {
      item,
      content,
    };
  }

  // Private helper methods

  /**
   * Make an authenticated HTTP request to Graph API.
   */
  private async makeRequest(options: HttpRequestOptions): Promise<HttpResponse> {
    const token = await this.config.tokenProvider.getToken();

    const executeRequest = async (): Promise<HttpResponse> => {
      const response = await fetch(options.url, {
        method: options.method,
        headers: {
          'Authorization': `Bearer ${token.accessToken}`,
          ...options.headers,
        },
        body: typeof options.body === 'string' ? options.body : undefined,
      });

      const body = await response.text();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      // Handle 429/503 responses with Retry-After
      if ((response.status === 429 || response.status === 503) && this.throttleLimiter) {
        const retryAfter = response.headers.get('retry-after');
        const waitTime = this.throttleLimiter.handleRateLimited(response.status, retryAfter || undefined);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return executeRequest(); // Retry
      }

      return {
        status: response.status,
        body,
        headers,
      };
    };

    // If throttling is enabled, use the throttle limiter
    if (this.throttleLimiter) {
      const doRequest = async (): Promise<HttpResponse> => {
        const response = await fetch(options.url, {
          method: options.method,
          headers: {
            'Authorization': `Bearer ${token.accessToken}`,
            ...options.headers,
          },
          body: typeof options.body === 'string' ? options.body : undefined,
        });

        const body = await response.text();
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key] = value;
        });

        // Check for rate limited response and retry
        if ((response.status === 429 || response.status === 503) && this.throttleLimiter) {
          const retryAfter = response.headers.get('retry-after');
          const waitTime = this.throttleLimiter.handleRateLimited(response.status, retryAfter || undefined);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          return doRequest(); // Retry
        }

        return {
          status: response.status,
          body,
          headers,
        };
      };

      return this.throttleLimiter.executeWithThrottling(
        this.config.tenantId,
        this.provider,
        doRequest,
      );
    }

    return executeRequest();
  }

  /**
   * Extract provider from base URL.
   */
  private extractProviderFromBaseUrl(baseUrl: string): string {
    try {
      const url = new URL(baseUrl);
      return url.hostname;
    } catch {
      return 'graph';
    }
  }

  /**
   * Normalize path according to §10 natural key requirements.
   * Handles:
   * - Multiple consecutive slashes
   * - Relative path segments (. and ..)
   * - Trailing slashes
   * - Case normalization (for case-insensitive filesystems)
   */
  normalizePath(path: string, options?: NormalizePathOptions): string {
    const opts = {
      collapseSlashes: true,
      resolveDots: true,
      removeTrailingSlash: true,
      ...options,
    };

    if (!path) {
      return '/';
    }

    // Ensure path starts with /
    let result = path.startsWith('/') ? path : `/${path}`;

    // Collapse multiple slashes
    if (opts.collapseSlashes) {
      result = result.replace(/\/+/g, '/');
    }

    // Resolve . and .. segments
    if (opts.resolveDots) {
      const segments = result.split('/');
      const resolved: string[] = [];
      
      for (const segment of segments) {
        if (segment === '.' || segment === '') {
          // Skip current directory references and empty segments
          continue;
        } else if (segment === '..') {
          // Go up one directory
          if (resolved.length > 0) {
            resolved.pop();
          }
        } else {
          resolved.push(segment);
        }
      }
      
      result = '/' + resolved.join('/');
    }

    // Remove trailing slash (except for root)
    if (opts.removeTrailingSlash && result.length > 1 && result.endsWith('/')) {
      result = result.slice(0, -1);
    }

    // Ensure root is /
    if (result === '') {
      result = '/';
    }

    return result;
  }

  /**
   * Parse path into components.
   */
  parsePath(path: string): ParsedPath {
    const normalized = this.normalizePath(path);
    
    // Find the last slash to split directory and base
    const lastSlashIndex = normalized.lastIndexOf('/');
    const dir = lastSlashIndex > 0 ? normalized.slice(0, lastSlashIndex) : '';
    const base = lastSlashIndex >= 0 ? normalized.slice(lastSlashIndex + 1) : normalized;
    
    // Find the last dot to split name and extension
    const lastDotIndex = base.lastIndexOf('.');
    let name: string;
    let ext: string;
    
    if (lastDotIndex > 0) {
      name = base.slice(0, lastDotIndex);
      ext = base.slice(lastDotIndex + 1);
    } else {
      name = base;
      ext = '';
    }

    return {
      root: normalized.startsWith('/') ? '/' : '',
      dir,
      base,
      ext,
      name,
    };
  }

  /**
   * Encode cursor for storage.
   */
  private encodeCursor(cursor: GraphDriveDeltaCursor): string {
    return `graph-drive-delta:${cursor.folderPath}:${cursor.deltaLink}`;
  }

  /**
   * Decode cursor from storage.
   */
  private decodeCursor(cursor: SyncCursor): GraphDriveDeltaCursor {
    const value = cursor.value;

    if (!value.startsWith('graph-drive-delta:')) {
      throw new Error(`Invalid cursor format: ${value}`);
    }

    const parts = value.slice('graph-drive-delta:'.length).split(':');
    if (parts.length < 2) {
      throw new Error(`Invalid cursor format: ${value}`);
    }

    const folderPath = parts[0] ?? '';
    const deltaLink = parts.slice(1).join(':');

    return {
      deltaLink,
      folderPath,
    };
  }

  /**
   * Same item (same GUID), different place — a rename or a move.
   *
   * The third site that read the phantom `item.path`: with no such field it
   * compared `undefined` against `undefined`, so this answered FALSE for every
   * rename it was asked about. It goes through `itemPath` now, like the
   * natural key does. Two items whose paths cannot be derived are not called a
   * rename — that would be a guess about customer data from no evidence.
   */
  isRename(oldItem: GraphDriveItem, newItem: GraphDriveItem): boolean {
    if (oldItem.id !== newItem.id) return false;
    const before = this.itemPath(oldItem);
    const after = this.itemPath(newItem);
    if (before === undefined || after === undefined) return false;
    return before !== after;
  }

  /**
   * Get the change hash for an item.
   * Uses quickXorHash if available, otherwise cTag, otherwise etag.
   */
  getChangeHash(item: GraphDriveItem): string | undefined {
    return item.quickXorHash || item.cTag || (item as unknown as Record<string, string>)['@odata.etag'];
  }
}
