/**
 * CalDAV Target Writer Implementation
 * 
 * Implements CalendarTargetWriter interface for CalDAV calendar synchronization.
 * Uses vdirsyncer for bulk operations and direct JMAP/CalDAV API calls for individual operations.
 * Follows the idempotency pattern with ledger fast-path and target-side existence checks.
 */

import type {
  CalendarTargetWriter,
  CalendarFolder,
  RawCalendarEvent,
  UpsertResult,
  Ledger,
  TenantId,
  MappingId,
  TargetReindexer,
  TargetEntry,
} from '@openmig/shared';
import { calendarNaturalKeyHash, calendarContentHash } from '@openmig/shared';
import { collectionSlug } from './dav-collection-path';
import {
  parseMultiStatus,
  firstElementText,
  hasResourceType,
  extractUid,
  decodeHref,
  hrefRelativeTo,
  unescapeXml,
  sizeOf,
} from './dav-multistatus';
import { requestWithDavRetry } from './dav-retry';

/**
 * Configuration for CalDAV target writer
 */
export interface CalDAVTargetConfig {
  /** CalDAV endpoint URL */
  url: string;
  /** Authentication username */
  username: string;
  /** Authentication password or token */
  password: string;
  /** Calendar home set path */
  homeSet?: string;
  /** Default calendar color */
  color?: string;
  /** Default calendar description */
  description?: string;
}

/**
 * CalDAV target writer implementation
 */
export class CalDAVTargetWriter implements CalendarTargetWriter, TargetReindexer {
  private readonly config: CalDAVTargetConfig;
  private readonly ledger: Ledger;
  private readonly tenantId: TenantId;
  private readonly mappingId: MappingId;
  private readonly httpClient: HttpClient;
  /**
   * Per-collection snapshot of what the target already holds, natural key ->
   * href, built once and reused for every item in that collection.
   *
   * The existence check used to be one `calendar-query` REPORT PER ITEM. That
   * is a network round trip each, and it dominated: a real run moved 203 events
   * — 52 KB in total — in 76 seconds, 374 ms an item, essentially none of it
   * data transfer. One REPORT for the whole collection answers the same
   * question.
   *
   * A promise, not a Set, so concurrent items coalesce onto one in-flight
   * listing instead of racing to build it N times.
   */
  private readonly collectionKeys = new Map<string, Promise<Map<string, string> | undefined>>();

  constructor(
    config: CalDAVTargetConfig,
    deps: {
      ledger: Ledger;
      tenantId: TenantId;
      mappingId: MappingId;
      httpClient?: HttpClient;
    },
  ) {
    this.config = config;
    this.ledger = deps.ledger;
    this.tenantId = deps.tenantId;
    this.mappingId = deps.mappingId;
    this.httpClient = deps.httpClient ?? createDefaultHttpClient();
  }

  /**
   * Ensure a calendar exists with the given folder metadata.
   * Returns the calendar ID (href) for use in subsequent operations.
   */
  async ensureCalendar(folder: CalendarFolder): Promise<string> {
    // The collection MUST live under THIS writer's own account, not wherever the
    // source folder came from. In a real cross-account/cross-server migration the
    // folder handed to us by the domain-sync loop is the SOURCE collection (e.g.
    // /remote.php/dav/calendars/<source-user>/personal/); using its path verbatim
    // would target the wrong user (or double the DAV prefix). We therefore derive a
    // stable slug from the folder and re-home it under calendars/<target-user>/.
    const calendarPath = this.normalizeCalendarPath(
      `calendars/${this.config.username}/${collectionSlug(folder.name, folder.path, 'calendar')}`,
    );

    // Check if calendar already exists via PROPFIND
    const exists = await this.calendarExists(calendarPath);
    if (exists) {
      return calendarPath;
    }

    // Create new calendar using MKCALENDAR
    await this.createCalendar(calendarPath, folder);
    return calendarPath;
  }

  /**
   * Idempotently write a calendar event to the target.
   * Uses ledger fast-path and target-side UID check to ensure idempotency.
   */
  async upsertCalendarEvent(
    calendarId: string,
    raw: RawCalendarEvent,
  ): Promise<UpsertResult> {
    // Extract UID from iCalendar data
    const uid = this.extractUidFromIcalendar(raw.icalendar);
    const naturalKey = uid;
    const naturalKeyHash = calendarNaturalKeyHash(naturalKey);

    // LEDGER FAST-PATH: Check if already migrated
    const known = await this.ledger.find(this.tenantId, this.mappingId, 'calendar', naturalKeyHash);
    if (known) {
      return { targetId: known.targetId, created: false };
    }

    // Compute content hash for change detection
    const contentHashValue = calendarContentHash(raw.icalendar);
    // Recorded here, not only by the sync loop: `recordIfAbsent` makes the first
    // writer win, and that is this one. See webdav-target-writer.ts.
    const sizeBytes = Buffer.byteLength(raw.icalendar, 'utf8');

    // Check if event already exists on target (by UID)
    const existingId = await this.existingTargetId(calendarId, naturalKey);
    if (existingId) {
      // Record in ledger if not present (adopt existing)
      await this.ledger.recordIfAbsent({
        tenantId: this.tenantId,
        itemType: 'calendar',
        mappingId: this.mappingId,
        naturalKeyHash,
        contentHash: contentHashValue,
        targetId: existingId,
        createdAt: new Date().toISOString(),
        sizeBytes,
      });
      return { targetId: existingId, created: false, adopted: true };
    }

    // Upload the event to the calendar
    const eventId = await this.uploadEvent(calendarId, raw, uid);
    // Keep the snapshot current: a duplicate UID later in the same pass is then
    // answered from memory instead of being written twice.
    (await this.keysIn(calendarId))?.set(naturalKey, eventId);

    // RECORD IN LEDGER
    await this.ledger.recordIfAbsent({
      tenantId: this.tenantId,
        itemType: 'calendar',
      mappingId: this.mappingId,
      naturalKeyHash,
      contentHash: contentHashValue,
      targetId: eventId,
      createdAt: new Date().toISOString(),
      sizeBytes,
    });

    return { targetId: eventId, created: true };
  }

  /**
   * Natural key -> href for everything already in this collection.
   *
   * Returns undefined when the collection cannot be listed, and the caller then
   * falls back to the per-item REPORT — a target we cannot enumerate must still
   * be migratable, just not as quickly.
   */
  private keysIn(collectionId: string): Promise<Map<string, string> | undefined> {
    let pending = this.collectionKeys.get(collectionId);
    if (!pending) {
      pending = (async () => {
        try {
          const keys = new Map<string, string>();
          for await (const entry of this.listEntries(collectionId)) {
            keys.set(entry.naturalKey, entry.targetId);
          }
          return keys;
        } catch (err) {
          console.warn(
            `[caldav] could not list ${collectionId} up front, falling back to a per-item ` +
              `existence check: ${err instanceof Error ? err.message : String(err)}`,
          );
          return undefined;
        }
      })();
      this.collectionKeys.set(collectionId, pending);
    }
    return pending;
  }

  /** Is this item already on the target? Snapshot first, per-item REPORT as fallback. */
  private async existingTargetId(
    collectionId: string,
    naturalKey: string,
  ): Promise<string | undefined> {
    const keys = await this.keysIn(collectionId);
    if (keys) return keys.get(naturalKey);
    return this.findCalendarByNaturalKey(collectionId, naturalKey);
  }

  /**
   * Find a calendar event by its natural key (UID).
   * Returns the event ID if found, undefined otherwise.
   */
  async findCalendarByNaturalKey(
    calendarId: string,
    naturalKey: string,
  ): Promise<string | undefined> {
    // Use CalDAV REPORT to search for events by UID
    const query = `<?xml version="1.0" encoding="utf-8"?>
      <C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
        <D:prop>
          <D:resourcetype/>
          <C:calendar-data/>
        </D:prop>
        <C:filter>
          <C:comp-filter name="VCALENDAR">
            <C:comp-filter name="VEVENT">
              <C:prop-filter name="UID">
                <C:text-match>${this.escapeXml(naturalKey)}</C:text-match>
              </C:prop-filter>
            </C:comp-filter>
          </C:comp-filter>
        </C:filter>
      </C:calendar-query>`;

    const response = await this.httpClient.request({
      method: 'REPORT',
      url: this.buildUrl(calendarId),
      body: query,
      headers: {
        'Content-Type': 'application/xml',
        Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
      },
    });

    if (response.status === 207) {
      // Multi-status response - parse for matching resources
      const href = this.parseMultiStatusResponse(response.body, naturalKey);
      return href || undefined;
    }

    return undefined;
  }

  /**
   * Stream every event on this target, keyed the way the ledger keys them.
   *
   * This is what makes calendar verifiable at all. Until it existed, only the
   * two mail targets implemented `TargetReindexer`, so `runVerification` had no
   * way to read a calendar target and reported the whole domain
   * NOT_VERIFIABLE — blocking any cutover that had actually copied events.
   *
   * `naturalKey` is the VEVENT UID, exactly what `upsertCalendarEvent` hashes
   * with `calendarNaturalKeyHash`. `targetId` is the resource href, matching
   * what that method records as the ledger's target id.
   *
   * @param mailboxId Restrict to one calendar collection path. Omitted, every
   *   calendar under this account's home set is walked.
   */
  async *listEntries(mailboxId?: string): AsyncIterable<TargetEntry> {
    const calendars = mailboxId ? [mailboxId] : await this.listCalendarCollections();

    for (const calendarPath of calendars) {
      for await (const entry of this.listEventsIn(calendarPath)) {
        yield entry;
      }
    }
  }

  /** Every calendar collection under `calendars/<username>/`. */
  private async listCalendarCollections(): Promise<string[]> {
    const homeSet = this.normalizeCalendarPath(`calendars/${this.config.username}`);
    const response = await this.httpClient.request({
      method: 'PROPFIND',
      url: this.buildUrl(homeSet),
      body: `<?xml version="1.0" encoding="utf-8"?>
        <D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/></D:prop></D:propfind>`,
      headers: {
        Depth: '1',
        'Content-Type': 'application/xml',
        Authorization: this.authHeader(),
      },
    });

    if (response.status !== 207) {
      // Failing loudly matters more here than anywhere else: an empty list is
      // indistinguishable from "the target has no events", which verification
      // would report as total data loss (hard rule 9).
      throw new Error(
        `PROPFIND on calendar home set ${homeSet} failed with status ${response.status}: ${response.body}`,
      );
    }

    // An href in a multistatus is SERVER-absolute (`/remote.php/dav/calendars/
    // <user>/personal/`), while `buildUrl` treats its argument as relative to
    // the configured base and just concatenates. Handing hrefs to it straight
    // produced `…/remote.php/dav/remote.php/dav/calendars/<user>/personal/`,
    // and every calendar-query REPORT 404'd:
    //
    //   REPORT /remote.php/dav/remote.php/dav/calendars/e2e-target/personal/ 404
    //   Sabre\DAV\Exception\NotFound — File not found: remote.php in 'root'
    //
    // The writes never hit this because they build their own relative paths;
    // only the reindexer feeds server hrefs back in, so it surfaced the first
    // time verification ran against a real Nextcloud. `hrefRelativeTo` (#142)
    // exists for exactly this and is what the WebDAV reindexer already uses.
    return parseMultiStatus(response.body)
      .filter((r) => hasResourceType(r.xml, 'calendar'))
      .map((r) => hrefRelativeTo(r.href, this.buildUrl('')))
      // An href outside the configured base is not ours to read; dropping it is
      // right, and `''` is the home set itself — not a calendar, though some
      // servers list it.
      .filter((relative): relative is string => relative !== undefined && relative !== '')
      .map((relative) => this.normalizeCalendarPath(relative))
      .filter((path) => path !== homeSet);
  }

  /** Every VEVENT resource in one calendar, as ledger-shaped entries. */
  private async *listEventsIn(calendarPath: string): AsyncIterable<TargetEntry> {
    // Partial retrieval (RFC 4791 §9.6): ask for the UID rather than the whole
    // event body. Enumeration is metadata-only by contract and a mailbox-sized
    // calendar should not be downloaded in full to count it.
    const query = `<?xml version="1.0" encoding="utf-8"?>
      <C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
        <D:prop>
          <D:getetag/>
          <D:getcontentlength/>
          <C:calendar-data>
            <C:comp name="VCALENDAR">
              <C:comp name="VEVENT">
                <C:prop name="UID"/>
              </C:comp>
            </C:comp>
          </C:calendar-data>
        </D:prop>
        <C:filter>
          <C:comp-filter name="VCALENDAR">
            <C:comp-filter name="VEVENT"/>
          </C:comp-filter>
        </C:filter>
      </C:calendar-query>`;

    const response = await this.httpClient.request({
      method: 'REPORT',
      url: this.buildUrl(calendarPath),
      body: query,
      headers: {
        Depth: '1',
        'Content-Type': 'application/xml',
        Authorization: this.authHeader(),
      },
    });

    if (response.status !== 207) {
      throw new Error(
        `calendar-query REPORT on ${calendarPath} failed with status ${response.status}: ${response.body}`,
      );
    }

    for (const item of parseMultiStatus(response.body)) {
      const data = firstElementText(item.xml, 'calendar-data');
      if (data === undefined) {
        // The collection itself comes back in some servers' Depth:1 responses
        // with no calendar-data. Skipping it is right; skipping an actual event
        // would not be, which is why the UID check below throws instead.
        continue;
      }
      const uid = extractUid(unescapeXml(data));
      if (!uid) {
        // Yielding the href as a stand-in key would mis-key the item and make a
        // present event look missing — the ADR-0020 failure mode fixed in the
        // mail reindexers. Fail instead.
        throw new Error(`Calendar resource ${item.href} returned no UID; cannot key it for verification.`);
      }
      yield {
        naturalKey: uid,
        targetId: decodeHref(item.href),
        mailboxId: calendarPath,
        ...sizeOf(item.xml),
        // No contentHash from the LISTING: it fetches only the UID, and a hash
        // of the server's re-serialized bytes could never equal the source's.
        // `contentHashFor` below fetches sampled items in full and fingerprints
        // them canonically instead.
      };
    }
  }

  /**
   * A canonical content fingerprint for one sampled event.
   *
   * The listing cannot supply this — it deliberately fetches only the UID — and
   * a byte hash would be meaningless here anyway: CalDAV servers re-serialize
   * iCalendar, so the octets are the server's, not ours. `calendarContentHash`
   * is a canonical fingerprint over opaque text properties (see
   * dav-canonical.ts for exactly what is compared and what a match claims), so
   * the same function applied to the source and to what comes back is a
   * like-for-like comparison.
   *
   * Called only for sampled items, so the extra GET is bounded by the sample
   * size, not the calendar size. Returns undefined — never a wrong hash — when
   * the resource cannot be read, so the sample is counted as unavailable rather
   * than as corruption.
   */
  async contentHashFor(entry: TargetEntry): Promise<string | undefined> {
    // `targetId` is the resource href, which is SERVER-absolute. Handing it to
    // buildUrl unconverted doubles the DAV prefix — the defect that made every
    // calendar REPORT 404 until hrefRelativeTo was applied to collections.
    const relative = hrefRelativeTo(entry.targetId, this.buildUrl(''));
    if (relative === undefined) {
      console.warn(`[caldav] ${entry.targetId} is outside the configured base; not content-verifying it`);
      return undefined;
    }

    let response: HttpResponse;
    try {
      response = await this.httpClient.request({
        method: 'GET',
        url: this.buildUrl(relative),
        headers: { Authorization: this.authHeader() },
      });
    } catch (err) {
      console.warn(`[caldav] GET ${entry.targetId} failed: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }

    if (response.status !== 200) {
      console.warn(`[caldav] GET ${entry.targetId} -> ${response.status}; cannot content-verify it`);
      return undefined;
    }

    return calendarContentHash(response.body);
  }

  private authHeader(): string {
    return `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`;
  }

  // Private helper methods

  private normalizeCalendarPath(path: string): string {
    // Normalize path to ensure consistent format
    let normalized = path.replace(/\\/g, '/');
    if (!normalized.startsWith('/')) {
      normalized = '/' + normalized;
    }
    if (!normalized.endsWith('/')) {
      normalized += '/';
    }
    // Ensure .ics extension for individual events, no extension for calendars
    if (normalized.endsWith('.ics/')) {
      normalized = normalized.slice(0, -4);
    }
    return normalized;
  }

  private async calendarExists(path: string): Promise<boolean> {
    try {
      const response = await this.httpClient.request({
        method: 'PROPFIND',
        url: this.buildUrl(path),
        headers: {
          Depth: '0',
          Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
        },
      });
      return response.status === 207 || response.status === 200;
    } catch {
      return false;
    }
  }

  private async createCalendar(path: string, folder: CalendarFolder): Promise<void> {
    // RFC 4791 §5.3.1: the MKCALENDAR request body's root element MUST be in the CalDAV
    // namespace (C:mkcalendar), not DAV: — servers (e.g. SabreDAV, which Nextcloud uses)
    // deserialize the body by its Clark-notation element name and silently fail to create a
    // real calendar collection (while still returning success) if the root is misnamed.
    const mkcalendar = `<?xml version="1.0" encoding="utf-8"?>
      <C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
        <D:set>
          <D:prop>
            <D:displayname>${this.escapeXml(folder.name || folder.path)}</D:displayname>
            ${folder.description ? `<C:calendar-description>${this.escapeXml(folder.description)}</C:calendar-description>` : ''}
            ${folder.color ? `<CR:color xmlns:CR="http://apple.com/ns/ical/">${this.escapeXml(folder.color)}</CR:color>` : ''}
          </D:prop>
        </D:set>
      </C:mkcalendar>`;

    const response = await this.requestWithRetry({
      method: 'MKCALENDAR',
      url: this.buildUrl(path),
      body: mkcalendar,
      headers: {
        'Content-Type': 'application/xml',
        Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
      },
    });

    if (response.status !== 201) {
      throw new Error(`MKCALENDAR failed for ${path} with status ${response.status}: ${response.body}`);
    }
  }

  /**
   * Retry a write request a few times on a transient 5xx before giving up. Needed for the
   * demo/self-host Nextcloud backend, which uses SQLite by default -- a single-writer database
   * that genuinely returns "SQLSTATE[HY000]: General error: 5 database is locked" under
   * concurrent domain writes (confirmed live: calendar and contact syncs racing the same
   * account). The lock is transient by nature, so a short backoff is the standard mitigation
   * rather than requiring every demo deployment to run a concurrent-safe database.
   */
  private async requestWithRetry(
    options: HttpRequestOptions,
  ): Promise<HttpResponse> {
    // Shared with the other DAV writers and with the seed script's proven
    // parameters — see dav-retry.ts for why 5 attempts with jitter, and why
    // 423/429 count as transient alongside 5xx.
    return requestWithDavRetry(() => this.httpClient.request(options));
  }

  private extractUidFromIcalendar(icalendar: string): string {
    const uidMatch = icalendar.match(/UID:[^\r\n]+/i);
    if (!uidMatch) {
      throw new Error('Invalid iCalendar data: missing UID');
    }
    const parts = uidMatch[0].split(':');
    return parts[1]?.trim() ?? '';
  }

  private async uploadEvent(
    calendarId: string,
    raw: RawCalendarEvent,
    uid: string,
  ): Promise<string> {
    // Generate event filename from UID
    const filename = `${uid}.ics`;
    const eventPath = `${calendarId}${filename}`;

    const response = await this.requestWithRetry({
      method: 'PUT',
      url: this.buildUrl(eventPath),
      body: raw.icalendar,
      headers: {
        'Content-Type': 'text/calendar',
        // Create-only, atomically (RFC 4918 §10.4.2 / RFC 9110 §13.1.2). The
        // existence check above and this write are two separate requests, so on
        // its own that pairing is check-then-act: anything appearing at this
        // href in between would be silently REPLACED, which target writers are
        // specified never to do (hard rule 2). The precondition closes the
        // window in the server, and costs nothing.
        'If-None-Match': '*',
        Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
      },
    });

    // 412: something is already there. Not an error — the caller's snapshot was
    // merely stale, and the resource is exactly what we would have written.
    if (response.status === 412) {
      return eventPath;
    }

    if (response.status !== 201 && response.status !== 204) {
      throw new Error(`PUT failed for ${eventPath} with status ${response.status}: ${response.body}`);
    }

    return eventPath;
  }

  private parseMultiStatusResponse(
    response: string,
    searchUid: string,
  ): string | null {
    // Parse XML response to find matching href
    const hrefMatches = response.matchAll(/<D:href>([^<]+)<\/D:href>/g);
    for (const match of hrefMatches) {
      const href = match[1];
      if (!href) continue;
      // Check if this resource contains the matching UID
      // In a real implementation, we'd parse the full response
      if (href.includes(searchUid)) {
        return href;
      }
    }
    return null;
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private buildUrl(path: string): string {
    const baseUrl = this.config.url.replace(/\/$/, '');
    const normalizedPath = path.replace(/^\/+/, '');
    return `${baseUrl}/${normalizedPath}`;
  }
}

/**
 * HTTP client interface for CalDAV requests
 */
export interface HttpClient {
  request(options: HttpRequestOptions): Promise<HttpResponse>;
}

export interface HttpRequestOptions {
  method: string;
  url: string;
  body?: string | Buffer;
  headers?: Record<string, string>;
}

export interface HttpResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

/**
 * Create a default HTTP client using Node.js fetch
 */
function createDefaultHttpClient(): HttpClient {
  return {
    async request(options: HttpRequestOptions): Promise<HttpResponse> {
      const response = await fetch(options.url, {
        method: options.method,
        headers: options.headers,
        body: typeof options.body === 'string' ? options.body : undefined,
      });

      const body = await response.text();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        status: response.status,
        body,
        headers,
      };
    },
  };
}
