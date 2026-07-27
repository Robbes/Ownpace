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
  unescapeXml,
} from './dav-multistatus';

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

    // Check if event already exists on target (by UID)
    const existingId = await this.findCalendarByNaturalKey(calendarId, naturalKey);
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
      });
      return { targetId: existingId, created: false };
    }

    // Upload the event to the calendar
    const eventId = await this.uploadEvent(calendarId, raw, uid);

    // RECORD IN LEDGER
    await this.ledger.recordIfAbsent({
      tenantId: this.tenantId,
        itemType: 'calendar',
      mappingId: this.mappingId,
      naturalKeyHash,
      contentHash: contentHashValue,
      targetId: eventId,
      createdAt: new Date().toISOString(),
    });

    return { targetId: eventId, created: true };
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

    const homeSetPath = decodeHref(this.buildUrl(homeSet)).replace(/\/+$/, '');
    return parseMultiStatus(response.body)
      .filter((r) => hasResourceType(r.xml, 'calendar'))
      .map((r) => this.normalizeCalendarPath(decodeHref(r.href)))
      // The home set itself is not a calendar, but some servers still list it.
      .filter((path) => this.buildUrl(path).replace(/\/+$/, '') !== homeSetPath);
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
      yield { naturalKey: uid, targetId: decodeHref(item.href), mailboxId: calendarPath };
    }
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
    attempts = 3,
    backoffMs = 250,
  ): Promise<HttpResponse> {
    let lastResponse: HttpResponse | undefined;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const response = await this.httpClient.request(options);
      if (response.status < 500 || attempt === attempts) {
        return response;
      }
      lastResponse = response;
      await new Promise((resolve) => setTimeout(resolve, backoffMs * attempt));
    }
    // Unreachable in practice (the loop always returns on its last iteration), but keeps
    // TypeScript happy about a guaranteed return value.
    return lastResponse as HttpResponse;
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
        Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
      },
    });

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
