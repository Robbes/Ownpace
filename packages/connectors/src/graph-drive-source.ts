/**
 * Graph Drive Source Connector Implementation
 * 
 * Implements FileSource interface for Microsoft OneDrive/SharePoint file synchronization.
 * Uses Microsoft Graph API v1.0 with delta query for incremental synchronization.
 * 
 * Features:
 * - File/folder enumeration via /me/drive/root/children endpoint
 * - Delta query for incremental sync, scoped per folder (/me/drive/root:{path}:/delta)
 * - Path normalization as natural key (§10)
 * - cTag/quickXorHash as cheap change detection before byte hashing
 * - Download streams to file writer
 * - Handle renamed files (same GUID, different path) - log as drift, not duplicate
 * - Rate limiting and throttling support
 */

import type { FileSource, FileFolder, RawFileItem, SyncCursor, ThrottleLimiter, FileItem } from '@openmig/shared';
import type { GraphDriveSourceConfig, GraphDriveItem, GraphDriveDeltaResponse, GraphDriveDeltaCursor, ParsedPath, NormalizePathOptions } from './graph-drive-source.types';
import type { HttpClient as _HttpClient, HttpRequestOptions, HttpResponse } from './dav-http.types';
import { log } from '@openmig/shared';

/**
 * Graph Drive source connector implementation.
 */
export class GraphDriveSource implements FileSource {
  private readonly config: GraphDriveSourceConfig;
  private readonly baseUrl: string;
  private readonly throttleLimiter?: ThrottleLimiter;
  private readonly provider: string;

  constructor(
    config: GraphDriveSourceConfig,
    throttleLimiter?: ThrottleLimiter,
  ) {
    this.config = config;
    this.baseUrl = config.baseUrl?.replace(/\/$/, '') ?? 'https://graph.microsoft.com/v1.0';
    this.throttleLimiter = throttleLimiter;
    this.provider = this.extractProviderFromBaseUrl(this.baseUrl);
  }

  /**
   * Enumerate all file folders (directories) from OneDrive root.
   * Uses /drive/root/children endpoint to list items.
   */
  async listFolders(): Promise<ReadonlyArray<FileFolder>> {
    const folders: FileFolder[] = [];
    let nextLink: string | undefined;

    // Start from root and enumerate
    do {
      const url = nextLink ?? `${this.baseUrl}/me/drive/root/children`;
      const response = await this.makeRequest({
        url,
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (response.status !== 200) {
        throw new Error(`Failed to list drive items: ${response.status} - ${response.body}`);
      }

      const data = JSON.parse(response.body) as { value: GraphDriveItem[]; '@odata.nextLink'?: string };
      
      // Only include folders
      for (const item of data.value) {
        if (item.folder) {
          folders.push({
            path: this.normalizePath(item.path || `/${item.name}`),
            name: item.name,
            quota: item.folder.childCount ? {
              used: 0, // Graph doesn't provide folder quota directly
              available: undefined,
            } : undefined,
          });
        }
      }
      
      nextLink = data['@odata.nextLink'];
    } while (nextLink);

    return folders;
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
    // path — `/me/drive/root:/{path}:/delta` — which scopes the response
    // server-side to that folder's descendants; no client-side filter needed.
    const folderPath = folder.path;
    const isRoot = folderPath === '/' || folderPath === '';

    const baseUrl = isRoot
      ? `${this.baseUrl}/me/drive/root/delta`
      : `${this.baseUrl}/me/drive/root:${folderPath
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
        // Get the natural key (normalized path)
        const naturalKey = this.normalizePath(item.path || `/${item.name}`);
        
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
    const url = `${this.baseUrl}/me/drive/items/${itemId}/content`;
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
   * Check if two items are the same (same GUID) but with different paths (renamed).
   * Returns true if items have the same id but different paths.
   */
  isRename(oldItem: GraphDriveItem, newItem: GraphDriveItem): boolean {
    return oldItem.id === newItem.id && oldItem.path !== newItem.path;
  }

  /**
   * Get the change hash for an item.
   * Uses quickXorHash if available, otherwise cTag, otherwise etag.
   */
  getChangeHash(item: GraphDriveItem): string | undefined {
    return item.quickXorHash || item.cTag || (item as unknown as Record<string, string>)['@odata.etag'];
  }
}
