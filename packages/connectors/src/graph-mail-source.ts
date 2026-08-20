// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Graph Mail Source Connector (workplan 0023 T1)
 *
 * Implements the mail `SourceConnector` port over Microsoft Graph v1.0 —
 * ADR-0006's fallback for mailboxes whose admin disabled IMAP (owner
 * decision 2026-08-02: keep + build).
 *
 * Design points that carry correctness:
 * - The natural key is `internetMessageId` — the SAME RFC 5322 Message-ID the
 *   IMAP source keys on, so an item copied over IMAP and re-listed over Graph
 *   is the same ledger row; switching transport cannot duplicate a mailbox.
 *   A message without one is counted in `unkeyable`, never silently dropped.
 * - Special-use is resolved from Graph's WELL-KNOWN folders (inbox, sentitems,
 *   drafts, archive, junkemail, deleteditems) by id — authoritative even for
 *   localized display names — with the shared name conventions as fallback.
 *   The trash/junk exclusion and the bin-as-deletion-signal design (SAD
 *   §11.1) key off this, so guessing from names alone is not acceptable.
 * - `listSince` is a delta query per folder; the persisted cursor is the
 *   deltaLink. `@removed` entries are SKIPPED: the mail port has no removal
 *   channel (mail deletion evidence stays on the trash/absence path), and
 *   hard rule 2 forbids acting on them here anyway.
 * - `fetch` reads `/messages/{id}/$value` and returns `bodyBytes` — MIME must
 *   never round-trip through a UTF-8 string (see dav-http.types.ts on why).
 */

import type {
  SourceConnector,
  MailFolder,
  MailItem,
  MailKeyword,
  RawMessage,
  SyncCursor,
  TokenProvider,
  ThrottleLimiter,
  SpecialUse,
} from '@openmig/shared';
import { specialUseFromName, log } from '@openmig/shared';
import type { GraphMailFolder, GraphMessage, GraphPage } from './graph-mail-source.types.ts';
import type { HttpClient, HttpRequestOptions, HttpResponse } from './dav-http.types.ts';
import { graphScopePrefix } from './graph-scope.ts';

/** Graph well-known folder name -> our SpecialUse. */
const WELL_KNOWN_TO_SPECIAL_USE: ReadonlyArray<readonly [string, SpecialUse]> = [
  ['inbox', 'inbox'],
  ['sentitems', 'sent'],
  ['drafts', 'drafts'],
  ['archive', 'archive'],
  ['junkemail', 'junk'],
  ['deleteditems', 'trash'],
];

const DELTA_SELECT = 'id,internetMessageId,receivedDateTime,isRead,isDraft,flag';

/** The prefix distinguishing our persisted deltaLink cursors. */
const CURSOR_PREFIX = 'graph-mail-delta:';

export class GraphMailSource implements SourceConnector {
  private readonly tokenProvider: TokenProvider;
  private readonly httpClient: HttpClient;
  private readonly baseUrl: string;
  private readonly throttleLimiter?: ThrottleLimiter;
  /** `{baseUrl}/me` or `{baseUrl}/users/{address}` — see graph-scope.ts. */
  private readonly scope: string;

  /**
   * path -> Graph folder id, built by `listFolders()`. The mail port's
   * `MailFolder` carries only path/name/specialUse (IMAP needs nothing more),
   * so the Graph id lives here; `listSince` rebuilds the map when handed a
   * path it does not know, so a stale map self-heals instead of erroring.
   */
  private folderIds = new Map<string, string>();

  constructor(
    tokenProvider: TokenProvider,
    tenantId: string,
    options?: { baseUrl?: string; throttleLimiter?: ThrottleLimiter; mailbox?: string },
    deps?: { httpClient?: HttpClient },
  ) {
    void tenantId; // Recorded in config by callers; the SCOPE is `options.mailbox`.
    this.tokenProvider = tokenProvider;
    this.baseUrl = options?.baseUrl?.replace(/\/$/, '') ?? 'https://graph.microsoft.com/v1.0';
    // `/me` unless a mailbox address was configured, in which case
    // `/users/{address}` — application permissions, workplan 0027 T0. Resolved
    // ONCE here so a bad address fails at construction rather than on the
    // first request, and so no URL below can spell the scope differently.
    this.scope = graphScopePrefix(this.baseUrl, options?.mailbox);
    this.httpClient = deps?.httpClient ?? createDefaultHttpClient();
    this.throttleLimiter = options?.throttleLimiter;
  }

  /**
   * Enumerate the full folder tree with special-use detection.
   *
   * Well-known folders are resolved FIRST (`{scope}/mailFolders/{wellKnownName}`)
   * so their ids map to roles authoritatively; a tenant that has disabled one
   * (404) simply lacks that role. Nesting is walked breadth-first via
   * `childFolders`, building IMAP-shaped "Parent/Child" paths.
   */
  async listFolders(): Promise<ReadonlyArray<MailFolder>> {
    const roleById = new Map<string, SpecialUse>();
    for (const [wellKnown, role] of WELL_KNOWN_TO_SPECIAL_USE) {
      const res = await this.request({
        url: `${this.scope}/mailFolders/${wellKnown}`,
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (res.status === 404) continue; // that well-known folder does not exist here
      if (res.status !== 200) {
        throw new Error(`Graph mail: resolving well-known folder "${wellKnown}" failed: ${res.status} - ${res.body}`);
      }
      const folder = JSON.parse(res.body) as GraphMailFolder;
      roleById.set(folder.id, role);
    }

    const folders: MailFolder[] = [];
    const ids = new Map<string, string>();

    // Breadth-first walk from the root listing; queue entries carry the
    // already-built parent path so children get "Parent/Child".
    const queue: Array<{ url: string; parentPath: string }> = [
      { url: `${this.scope}/mailFolders?$top=100`, parentPath: '' },
    ];

    while (queue.length > 0) {
      const { url, parentPath } = queue.shift()!;
      let next: string | undefined = url;
      while (next) {
        const res = await this.request({
          url: next,
          method: 'GET',
          headers: { Accept: 'application/json' },
        });
        if (res.status !== 200) {
          throw new Error(`Graph mail: listing folders failed: ${res.status} - ${res.body}`);
        }
        const page = JSON.parse(res.body) as GraphPage<GraphMailFolder>;
        for (const f of page.value) {
          const path = parentPath ? `${parentPath}/${f.displayName}` : f.displayName;
          const specialUse = roleById.get(f.id) ?? specialUseFromName(f.displayName);
          folders.push({ path, name: f.displayName, specialUse });
          ids.set(path, f.id);
          if ((f.childFolderCount ?? 0) > 0) {
            queue.push({
              url: `${this.scope}/mailFolders/${f.id}/childFolders?$top=100`,
              parentPath: path,
            });
          }
        }
        next = page['@odata.nextLink'];
      }
    }

    this.folderIds = ids;
    return folders;
  }

  /**
   * Delta listing for one folder. First call (no cursor) starts a fresh delta
   * query; subsequent calls resume from the persisted deltaLink. Pages are
   * followed to the end so the returned cursor always advances past
   * everything reported.
   */
  async listSince(
    folder: MailFolder,
    cursor?: SyncCursor,
  ): Promise<{
    items: ReadonlyArray<MailItem>;
    nextCursor: SyncCursor;
    unkeyable?: number;
    removed?: ReadonlyArray<string>;
  }> {
    const items: MailItem[] = [];
    let unkeyable = 0;
    /**
     * Message ids Graph reported as DELETED on this poll — the delta query's
     * own removal report (0023's recorded follow-up, built as 0026 T1 item 2).
     * Ids, not Message-IDs: a removed entry has no body left, so `id` — what
     * every listed item records as its `sourceRef` — is all there is to match
     * on. The reconcile loop takes them back to rows via `findBySourceRef`,
     * the same seam the DAV domains use; the source stays read-only (rule 2).
     */
    const removed: string[] = [];

    let next: string | undefined;
    if (cursor?.value.startsWith(CURSOR_PREFIX)) {
      next = cursor.value.slice(CURSOR_PREFIX.length);
    } else {
      const folderId = await this.resolveFolderId(folder.path);
      next = `${this.scope}/mailFolders/${folderId}/messages/delta?$select=${DELTA_SELECT}`;
    }

    let deltaLink: string | undefined;
    while (next) {
      const res = await this.request({
        url: next,
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (res.status !== 200) {
        throw new Error(
          `Graph mail: delta listing for "${folder.path}" failed: ${res.status} - ${res.body}`,
        );
      }
      const page = JSON.parse(res.body) as GraphPage<GraphMessage>;
      for (const m of page.value) {
        // Removed entries are reported, not counted as unkeyable: they are
        // not messages that failed to list, they are the server stating
        // outright that a message is gone.
        if (m['@removed']) {
          if (m.id) removed.push(m.id);
          continue;
        }
        if (!m.internetMessageId) {
          unkeyable += 1;
          continue;
        }
        items.push({
          messageId: m.internetMessageId,
          folder,
          keywords: keywordsFrom(m),
          receivedAt: m.receivedDateTime ?? new Date(0).toISOString(),
          sourceRef: m.id,
        });
      }
      deltaLink = page['@odata.deltaLink'] ?? deltaLink;
      next = page['@odata.nextLink'];
    }

    if (!deltaLink) {
      // A delta response's final page always carries the deltaLink; its
      // absence means we did not actually finish the listing.
      throw new Error(`Graph mail: delta listing for "${folder.path}" ended without a deltaLink`);
    }
    if (unkeyable > 0) {
      log.warn(
        `Graph mail: ${unkeyable} message(s) in "${folder.path}" carry no internetMessageId and were not listed`,
      );
    }

    const nextCursor: SyncCursor = { value: `${CURSOR_PREFIX}${deltaLink}` };
    // Both fields omitted rather than sent empty, so "the server reported
    // none" and "this listing cannot report" read differently downstream.
    return {
      items,
      nextCursor,
      ...(unkeyable > 0 ? { unkeyable } : {}),
      ...(removed.length > 0 ? { removed } : {}),
    };
  }

  /** Fetch the full RFC822/MIME bytes for an item. */
  async fetch(item: MailItem): Promise<RawMessage> {
    const res = await this.request({
      url: `${this.scope}/messages/${item.sourceRef}/$value`,
      method: 'GET',
      headers: {},
    });
    if (res.status !== 200) {
      throw new Error(
        `Graph mail: fetching MIME for ${item.messageId} failed: ${res.status} - ${res.body}`,
      );
    }
    // MIME is bytes. `body` is a UTF-8 decode and corrupts anything that is
    // not UTF-8 text (dav-http.types.ts documents the measured damage); a
    // client that cannot provide bodyBytes cannot serve this connector.
    if (!res.bodyBytes) {
      throw new Error(
        `Graph mail: HTTP client returned no bodyBytes for ${item.messageId}; ` +
          'MIME must not be read from the string body',
      );
    }
    return { item, rfc822: res.bodyBytes };
  }

  private async resolveFolderId(path: string): Promise<string> {
    let id = this.folderIds.get(path);
    if (!id) {
      await this.listFolders();
      id = this.folderIds.get(path);
    }
    if (!id) {
      throw new Error(`Graph mail: unknown folder path "${path}" (not present in the folder listing)`);
    }
    return id;
  }

  /** Authenticated request with the drive source's 429/503 Retry-After handling. */
  private async request(options: HttpRequestOptions): Promise<HttpResponse> {
    const token = await this.tokenProvider.getToken();
    const withAuth: HttpRequestOptions = {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${token.accessToken}` },
    };

    const response = await this.httpClient.request(withAuth);

    if ((response.status === 429 || response.status === 503) && this.throttleLimiter) {
      const retryAfter = response.headers['retry-after'] ?? response.headers['Retry-After'];
      const waitTime = this.throttleLimiter.handleRateLimited(response.status, retryAfter);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      return this.request(options);
    }

    return response;
  }
}

function keywordsFrom(m: GraphMessage): ReadonlyArray<MailKeyword> {
  const keywords: MailKeyword[] = [];
  if (m.isRead) keywords.push('$seen');
  if (m.flag?.flagStatus === 'flagged') keywords.push('$flagged');
  if (m.isDraft) keywords.push('$draft');
  // '$answered' has no Graph message field; omitted rather than guessed.
  return keywords;
}

/**
 * Default client. Unlike the JSON-only Graph sources, this one MUST surface
 * `bodyBytes`: `fetch()` serves MIME through it.
 */
function createDefaultHttpClient(): HttpClient {
  return {
    async request(options: HttpRequestOptions): Promise<HttpResponse> {
      const response = await fetch(options.url, {
        method: options.method,
        headers: options.headers,
        body: typeof options.body === 'string' ? options.body : undefined,
      });

      const bytes = new Uint8Array(await response.arrayBuffer());
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        status: response.status,
        body: new TextDecoder().decode(bytes),
        bodyBytes: bytes,
        headers,
      };
    },
  };
}
