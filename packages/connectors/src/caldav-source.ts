// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * CalDAV Source Connector Implementation
 * 
 * Implements CalendarSource interface for CalDAV calendar synchronization.
 * Follows RFC 4791 (CalDAV) and RFC 6578 (Collection Synchronization).
 * 
 * Features:
 * - Calendar home set discovery via PROPFIND
 * - Incremental sync using sync-collection REPORT (RFC 6578)
 * - CTag fallback when sync-token not supported
 * - Case-insensitive UID handling (UIDs are lowercased for comparison)
 */

import type {
  CalendarSource,
  CalendarFolder,
  CalendarComponent,
  CalendarEventType,
  SyncCursor,
  RawCalendarEvent,
} from '@openmig/shared';
import { CALENDAR_COMPONENTS, COMPONENT_ITEM_TYPES, collectionCarries } from '@openmig/shared';
import type { CalDAVSourceConfig, CalDAVSyncToken, CalDAVCalendarObject } from './caldav-source.types.ts';
import { davRefusalBody } from './gdata-refusal.ts';
import type { HttpClient, HttpRequestOptions, HttpResponse } from './dav-http.types.ts';
import { wellKnownUrl as buildWellKnownUrl } from './dav-http.types.ts';
import { parseRemovedHrefs } from './dav-removals.ts';

/**
 * CalDAV source connector implementation.
 */
export class CalDAVSource implements CalendarSource {
  private readonly config: CalDAVSourceConfig;
  private readonly httpClient: HttpClient;
  private calendarHomeSet: string | null = null;

  constructor(
    config: CalDAVSourceConfig,
    deps?: { httpClient?: HttpClient },
  ) {
    this.config = config;
    this.httpClient = deps?.httpClient ?? createDefaultHttpClient();
  }

  /**
   * Enumerate calendar folders (collections) with discovery.
   * Discovers calendar home set if not provided in config.
   */
  async listFolders(): Promise<ReadonlyArray<CalendarFolder>> {
    // Discover calendar home set if not configured
    if (!this.calendarHomeSet) {
      await this.discoverCalendarHomeSet();
    }

    if (!this.calendarHomeSet) {
      throw new Error('Failed to discover calendar home set');
    }

    // List all calendar collections under the home set
    return await this.listCollections(this.calendarHomeSet);
  }

  /**
   * List calendar items changed since cursor (or all if undefined).
   * Uses sync-collection REPORT (RFC 6578) for incremental sync.
   * Falls back to CTag if sync-token not supported.
   */
  async listSince(
    folder: CalendarFolder,
    cursor?: SyncCursor,
  ): Promise<{
    items: ReadonlyArray<RawCalendarEvent>;
    nextCursor: SyncCursor;
    removed?: ReadonlyArray<string>;
  }> {
    if (!this.calendarHomeSet) {
      await this.discoverCalendarHomeSet();
    }

    if (!this.calendarHomeSet) {
      throw new Error('Failed to discover calendar home set');
    }

    // Build the collection path from folder
    const collectionPath = this.buildCollectionPath(folder, this.calendarHomeSet);

    // Perform sync-collection REPORT
    const result = await this.syncCollection(collectionPath, cursor);

    // Parse the response and extract calendar events
    const items: RawCalendarEvent[] = [];
    for (const obj of result.objects) {
      const event = this.parseCalendarObject(obj);
      if (event) {
        items.push(event);
      }
    }

    // Create next cursor from sync token
    const nextCursor: SyncCursor = {
      value: result.syncToken ? this.encodeSyncToken(result.syncToken) : (result.ctag ? this.encodeCTag(result.ctag, collectionPath) : ''),
    };

    // The objects the server said are GONE, carried up instead of dropped.
    //
    // These hrefs are the SAME strings as `RawCalendarEvent.item.sourcePath`
    // above (`obj.href`): both are the verbatim text of a `<d:href>` in a
    // multistatus body from this server, read by the same trimming. That
    // agreement is what lets the sync loop find the ledger row a removal refers
    // to, and it is why neither side normalises, unescapes or resolves the href
    // — any transformation applied to one and not the other would silently break
    // the match, and a match that silently fails reports nothing at all.
    //
    // Omitted rather than sent as `[]` when there are none, so "the server
    // reported no removals" and "this poll could not report removals" are not
    // spelled the same way.
    return {
      items,
      nextCursor,
      ...(result.removed.length > 0 ? { removed: result.removed } : {}),
    };
  }

  // Private helper methods

  /**
   * Discover the calendar home set using RFC 6764 well-known URIs.
   * First tries /.well-known/caldav, then falls back to PROPFIND on base URL.
   * RFC 6764 Section 4.1
   */
  private async discoverCalendarHomeSet(): Promise<void> {
    // Step 1: Try RFC 6764 well-known URI discovery
    try {
      const wellKnownUrl = buildWellKnownUrl(this.config.url, 'caldav');
      const response = await this.send({
        method: 'GET',
        url: wellKnownUrl,
        headers: {
          Authorization: await this.authorizationHeader(),
        },
      });

      // Follow redirect to get principal URL
      if (response.status === 301 || response.status === 302 || response.status === 307 || response.status === 308) {
        // Extract redirect location
        const location = response.headers['location'] || response.headers['Location'];
        if (location) {
          const principalUrl = this.normalizePath(location);
          // Step 2: PROPFIND the principal to get calendar-home-set
          const homeSet = await this.discoverHomeSetFromPrincipal(principalUrl);
          if (homeSet) {
            this.calendarHomeSet = homeSet;
            return;
          }
        }
      } else if (response.status === 200 || response.status === 204) {
        // Well-known URI exists but may not redirect the way this code expects. Note: with the
        // native-fetch-backed httpClient this connector actually uses (createDefaultHttpClient,
        // no `redirect: 'manual'`), fetch ALWAYS follows redirects transparently -- so this is
        // really the ONLY branch that ever executes, and `wellKnownUrl` here has already been
        // silently redirected to wherever the server sent it (confirmed live against Nextcloud:
        // to /remote.php/dav/, the DAV root -- NOT a principal resource).
        let homeSet = await this.discoverHomeSetFromPrincipal(wellKnownUrl);
        if (!homeSet) {
          // calendar-home-set is a PRINCIPAL property (RFC 4791 §6.2.1), not a DAV-root one --
          // querying it directly on the (post-redirect) DAV root gets an embedded 404 for that
          // specific property even though the PROPFIND itself returns 207. Resolve
          // current-user-principal there first, then query calendar-home-set on THAT.
          const principalUrl = await this.discoverPrincipalUrl(wellKnownUrl);
          if (principalUrl) {
            homeSet = await this.discoverHomeSetFromPrincipal(principalUrl);
          }
        }
        if (homeSet) {
          this.calendarHomeSet = homeSet;
          return;
        }
      }
      // Well-known URI not available or didn't help, fall through to PROPFIND on base URL
    } catch {
      // Well-known discovery failed, fall through to PROPFIND on base URL
    }

    // Fallback: PROPFIND on base URL (original behavior)
    const propfind = `<?xml version="1.0" encoding="utf-8"?>
      <D:propfind xmlns:D="DAV:">
        <D:prop>
          <C:calendar-home-set xmlns:C="urn:ietf:params:xml:ns:caldav"/>
        </D:prop>
      </D:propfind>`;

    const response = await this.send({
      method: 'PROPFIND',
      url: this.config.url,
      body: propfind,
      headers: {
        'Content-Type': 'application/xml',
        Depth: '0',
        Authorization: await this.authorizationHeader(),
      },
    });

    if (response.status === 207) {
      const homeSet = this.parseCalendarHomeSetResponse(response.body);
      if (homeSet) {
        this.calendarHomeSet = homeSet;
      } else {
        // Final fallback: construct calendar home set from username
        // Nextcloud typically serves calendars at /remote.php/dav/calendars/{username}/
        const baseUrl = this.config.url.replace(/\/$/, '');
        this.calendarHomeSet = `${baseUrl}/calendars/${this.config.username}/`;
      }
    } else if (response.status === 404) {
      // PROPFIND failed with 404, use fallback constructed URL
      const baseUrl = this.config.url.replace(/\/$/, '');
      this.calendarHomeSet = `${baseUrl}/calendars/${this.config.username}/`;
    } else {
      throw new Error(`PROPFIND failed with status ${response.status}: ${davRefusalBody(response.body)}`);
    }
  }

  /**
   * Discover calendar-home-set by PROPFINDing a principal URL.
   * Used after following RFC 6764 well-known redirect.
   */
  private async discoverHomeSetFromPrincipal(principalUrl: string): Promise<string | null> {
    const propfind = `<?xml version="1.0" encoding="utf-8"?>
      <D:propfind xmlns:D="DAV:">
        <D:prop>
          <C:calendar-home-set xmlns:C="urn:ietf:params:xml:ns:caldav"/>
        </D:prop>
      </D:propfind>`;

    const response = await this.send({
      method: 'PROPFIND',
      url: principalUrl,
      body: propfind,
      headers: {
        'Content-Type': 'application/xml',
        Depth: '0',
        Authorization: await this.authorizationHeader(),
      },
    });

    if (response.status !== 207) {
      return null;
    }

    return this.parseCalendarHomeSetResponse(response.body);
  }

  /**
   * List all calendar collections under a home set.
   * Uses PROPFIND with Depth: 1 to find MKCALENDAR collections.
   */
  private async listCollections(homeSet: string): Promise<CalendarFolder[]> {
    const propfind = `<?xml version="1.0" encoding="utf-8"?>
      <D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
        <D:prop>
          <D:displayname/>
          <D:resourcetype/>
          <C:calendar-description/>
          <C:calendar-timezone/>
          <C:supported-calendar-component-set/>
          <CR:color xmlns:CR="urn:ietf:params:xml:ns:carddav"/>
        </D:prop>
      </D:propfind>`;

    const response = await this.send({
      method: 'PROPFIND',
      url: this.resolveHref(homeSet),
      body: propfind,
      headers: {
        'Content-Type': 'application/xml',
        Depth: '1',
        Authorization: await this.authorizationHeader(),
      },
    });

    // Handle 404 - collection doesn't exist yet, return empty list
    if (response.status === 404) {
      return [];
    }

    if (response.status !== 207) {
      throw new Error(`PROPFIND failed with status ${response.status}: ${davRefusalBody(response.body)}`);
    }

    return this.parseCollectionsResponse(response.body, homeSet);
  }

  /**
   * Perform sync-collection REPORT for incremental synchronization.
   * RFC 6578 Section 3.1
   */
  private async syncCollection(
    collectionPath: string,
    cursor?: SyncCursor,
  ): Promise<{
    objects: CalDAVCalendarObject[];
    syncToken?: string;
    ctag?: string;
    removed: string[];
  }> {
    // Build sync-collection REPORT
    let syncToken: string | undefined;
    let ctag: string | undefined;

    if (cursor) {
      try {
        const decoded = this.decodeSyncToken(cursor);
        if (decoded.isSyncToken) {
          syncToken = decoded.token;
        } else {
          ctag = decoded.token;
        }
      } catch {
        // Invalid cursor, do full sync
      }
    }

    const report = this.buildSyncCollectionReport(collectionPath, syncToken, ctag);

    const response = await this.send({
      method: 'REPORT',
      url: this.resolveHref(collectionPath),
      body: report,
      headers: {
        'Content-Type': 'application/xml',
        Authorization: await this.authorizationHeader(),
      },
    });

    if (response.status !== 207) {
      throw new Error(`REPORT failed with status ${response.status}: ${response.body}`);
    }

    return this.parseSyncCollectionResponse(response.body);
  }

  /**
   * Build the sync-collection REPORT XML.
   */
  private buildSyncCollectionReport(
    collectionPath: string,
    syncToken?: string,
    ctag?: string,
  ): string {
    // Nextcloud requires sync-token element even for full syncs
    // Use empty string for full sync, actual token for incremental sync
    const syncTokenElement = syncToken
      ? `<D:sync-token>${this.escapeXml(syncToken)}</D:sync-token>`
      : '<D:sync-token/>';

    const ctagElement = ctag
      ? `<C:expand xmlns:C="urn:ietf:params:xml:ns:caldav" start="19700101T000000Z" end="20991231235959Z"/>`
      : '';

    return `<?xml version="1.0" encoding="utf-8"?>
      <D:sync-collection xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
        <D:prop>
          <D:resourcetype/>
          <!-- Per-object ETag: the shadow-sync change signal. Without asking
               for it here the response carries none and every event looks
               unchanged forever. -->
          <D:getetag/>
          <C:calendar-data>
            ${ctagElement}
          </C:calendar-data>
        </D:prop>
        ${syncTokenElement}
      </D:sync-collection>`;
  }

  /**
   * Extract a property's href value from a multistatus response body, tolerating any XML
   * namespace prefix the server chooses to echo back (confirmed live against Nextcloud/sabre-dav:
   * it responds with e.g. "cal:calendar-home-set", not the "C:" prefix used in the request -- a
   * server is never required to preserve the client's chosen prefix), and the href nested inside
   * a <?:href> child element (not present as the property's own bare text content, which is what
   * this used to assume).
   */
  private static extractHrefProperty(body: string, elementName: string): string | null {
    const outer = body.match(
      new RegExp(`<[\\w-]+:${elementName}[^>]*>([\\s\\S]*?)<\\/[\\w-]+:${elementName}>`, 'i'),
    );
    const outerContent = outer?.[1];
    if (outerContent === undefined) return null;
    const hrefMatch = outerContent.match(/<[\w-]+:href[^>]*>([^<]+)<\/[\w-]+:href>/i);
    const value = (hrefMatch?.[1] ?? outerContent).trim();
    return value || null;
  }

  /**
   * Parse calendar home set from PROPFIND response.
   */
  private parseCalendarHomeSetResponse(body: string): string | null {
    const value = CalDAVSource.extractHrefProperty(body, 'calendar-home-set');
    return value ? this.normalizePath(value) : null;
  }

  /**
   * Resolve the current-user-principal at a given URL (a PROPFIND response body may report this
   * property on some other resource than a well-known-redirect target -- see
   * discoverCalendarHomeSet's well-known branch for why this matters).
   */
  private async discoverPrincipalUrl(url: string): Promise<string | null> {
    const propfind = `<?xml version="1.0" encoding="utf-8"?>
      <D:propfind xmlns:D="DAV:">
        <D:prop>
          <D:current-user-principal/>
        </D:prop>
      </D:propfind>`;

    const response = await this.send({
      method: 'PROPFIND',
      url,
      body: propfind,
      headers: {
        'Content-Type': 'application/xml',
        Depth: '0',
        Authorization: await this.authorizationHeader(),
      },
    });

    if (response.status !== 207) return null;
    const href = CalDAVSource.extractHrefProperty(response.body, 'current-user-principal');
    return href ? this.resolveHref(href) : null;
  }

  /**
   * The components one collection declared, or `undefined` when it declared
   * nothing (RFC 4791 §5.2.3).
   *
   * Namespace-agnostic like every other parse in this file, and scoped to the
   * `supported-calendar-component-set` element rather than run over the whole
   * response: a `<C:comp name="VEVENT"/>` can legitimately appear elsewhere in
   * a multistatus, and reading one of those as this collection's declaration
   * would answer a question the server never asked.
   *
   * A declared set with no recognised `comp` children comes back `undefined`
   * — read as undeclared, which keeps the collection. The alternative reading
   * ("declares nothing, so holds nothing") would drop a real calendar on a
   * server whose spelling this parse did not anticipate, and 0105's rule is
   * that a thing we could not measure is never a no.
   */
  static parseComponentSet(responseXml: string): ReadonlyArray<CalendarComponent> | undefined {
    const set = responseXml.match(
      /<[A-Za-z]+:supported-calendar-component-set[^>]*>([\s\S]*?)<\/[A-Za-z]+:supported-calendar-component-set>/i,
    );
    if (!set || !set[1]) return undefined;
    const known = new Set<string>(CALENDAR_COMPONENTS);
    const components = [...set[1].matchAll(/<[A-Za-z]*:?comp\s[^>]*name="([^"]+)"/gi)]
      .map((m) => m[1]!.toUpperCase())
      .filter((name) => known.has(name)) as CalendarComponent[];
    return components.length > 0 ? [...new Set(components)] : undefined;
  }

  /**
   * Parse collections from PROPFIND multi-status response.
   */
  private parseCollectionsResponse(body: string, _homeSet: string): CalendarFolder[] {
    const folders: CalendarFolder[] = [];

    // Extract all response elements - namespace-agnostic regex
    const responseRegex = /<[A-Za-z]+:response[^>]*>([\s\S]*?)<\/[A-Za-z]+:response>/gi;
    let match: RegExpExecArray | null;

    while ((match = responseRegex.exec(body)) !== null) {
      const responseXml = match[1];
      if (!responseXml) continue;

      // Extract href - namespace-agnostic
      const hrefMatch = responseXml.match(/<[A-Za-z]+:href>([^<]+)<\/[A-Za-z]+:href>/i);
      if (!hrefMatch || !hrefMatch[1]) continue;

      const href = hrefMatch[1].trim();
      
      // Check if this is a calendar collection (has calendar-collection or calendar type) - namespace-agnostic
      const isCalendarCollection = /<[A-Za-z]+:calendar-collection|<calendar-collection|<[A-Za-z]+:calendar\/|<calendar\//i.test(responseXml);
      
      // Skip if not a calendar collection or if it's the home set itself
      if (!isCalendarCollection) continue;

      // Extract display name - namespace-agnostic
      const displayNameMatch = responseXml.match(/<[A-Za-z]+:displayname[^>]*>([^<]*)<\/[A-Za-z]+:displayname>/i);
      const displayName = displayNameMatch && displayNameMatch[1] ? displayNameMatch[1].trim() : undefined;

      // Extract description - namespace-agnostic
      const descriptionMatch = responseXml.match(/<[A-Za-z]+:calendar-description[^>]*>([^<]*)<\/[A-Za-z]+:calendar-description>/i);
      const description = descriptionMatch && descriptionMatch[1] ? descriptionMatch[1].trim() : undefined;

      // Extract timezone - namespace-agnostic
      const timezoneMatch = responseXml.match(/<[A-Za-z]+:calendar-timezone[^>]*>([^<]*)<\/[A-Za-z]+:calendar-timezone>/i);
      const timezone = timezoneMatch && timezoneMatch[1] ? timezoneMatch[1].trim() : undefined;

      // Extract color - namespace-agnostic
      const colorMatch = responseXml.match(/<[A-Za-z]+:color[^>]*>([^<]*)<\/[A-Za-z]+:color>/i);
      const color = colorMatch && colorMatch[1] ? colorMatch[1].trim() : undefined;

      // WHAT THIS COLLECTION SAYS IT HOLDS (RFC 4791 §5.2.3).
      //
      // A task list is not a different kind of collection — it is a calendar
      // collection whose `supported-calendar-component-set` says VTODO. Until
      // this property was asked for, there was nothing here to tell them apart,
      // so a Nextcloud "Tasks" list was returned as a calendar and counted as
      // one: the owner's "5 calendars visible" could include a list holding no
      // events at all (workplan 0113).
      //
      // Skipped, not renamed: this source's `listFolders` answers the CALENDAR
      // domain, and a collection that carries no VEVENT has nothing that domain
      // can copy. It becomes visible again under the task domain (0113 T3b),
      // which reads the same property for VTODO.
      const components = CalDAVSource.parseComponentSet(responseXml);
      if (!collectionCarries(components, 'VEVENT')) continue;

      // Skip Nextcloud internal collections. MUST check the stable path segment, not the
      // human-readable displayname -- confirmed live against Nextcloud 34 for the sibling
      // CardDAV filter (same bug pattern): internal collections get a friendly displayname
      // (e.g. "z-server-generated--system" displays as "Accounts"), which never matches these
      // patterns, so checking `displayName || extractNameFromPath(href)` (displayName wins
      // whenever present) would let them leak through as syncable collections.
      if (this.isInternalCollection(this.extractNameFromPath(href))) continue;
      const name = displayName || this.extractNameFromPath(href);

      // Build the folder path
      const path = this.normalizePath(href);

      folders.push({
        path,
        name,
        description,
        timezone,
        color,
        ...(components ? { components } : {}),
      });
    }

    return folders;
  }

  /**
   * Parse sync-collection REPORT response.
   */
  private parseSyncCollectionResponse(body: string): {
    objects: CalDAVCalendarObject[];
    syncToken?: string;
    ctag?: string;
    /** Hrefs the server reported as gone (RFC 6578). See `dav-removals.ts`. */
    removed: string[];
  } {
    const objects: CalDAVCalendarObject[] = [];
    let syncToken: string | undefined;
    let ctag: string | undefined;

    // Extract sync-token if present - namespace-agnostic
    const syncTokenMatch = body.match(/<[A-Za-z]+:sync-token>([^<]+)<\/[A-Za-z]+:sync-token>/i);
    if (syncTokenMatch && syncTokenMatch[1]) {
      syncToken = syncTokenMatch[1].trim();
    }

    // Extract CTag if present (in Content-Mod-Time or other headers) - namespace-agnostic
    const ctagMatch = body.match(/<[A-Za-z]+:getetag>([^<]+)<\/[A-Za-z]+:getetag>/i);
    if (ctagMatch && ctagMatch[1]) {
      ctag = ctagMatch[1].trim();
    }

    // Extract all calendar objects - namespace-agnostic
    const responseRegex = /<[A-Za-z]+:response[^>]*>([\s\S]*?)<\/[A-Za-z]+:response>/gi;
    let match: RegExpExecArray | null;

    while ((match = responseRegex.exec(body)) !== null) {
      const responseXml = match[1];
      if (!responseXml) continue;

      // Extract href - namespace-agnostic
      const hrefMatch = responseXml.match(/<[A-Za-z]+:href>([^<]+)<\/[A-Za-z]+:href>/i);
      if (!hrefMatch || !hrefMatch[1]) continue;

      const href = hrefMatch[1].trim();

      // Extract calendar data - namespace-agnostic
      const calendarDataMatch = responseXml.match(/<[A-Za-z]+:calendar-data[^>]*>([\s\S]*?)<\/[A-Za-z]+:calendar-data>/i);
      if (!calendarDataMatch || !calendarDataMatch[1]) continue;

      const icalendar = this.parseCalendarData(calendarDataMatch[1]);

      // This object's OWN etag, scoped to its <response> — not the
      // collection-level scrape above, which takes whichever getetag appears
      // first in the whole body and would hand every object the same value.
      const etagMatch = responseXml.match(/<[A-Za-z]+:getetag[^>]*>([^<]+)<\/[A-Za-z]+:getetag>/i);
      const etag = etagMatch?.[1]?.trim();

      objects.push({
        href,
        icalendar,
        syncToken,
        ...(etag ? { etag } : {}),
      });
    }

    // RFC 6578 removal reports. Both sources have been issuing a
    // `sync-collection` REPORT and dropping these on the floor, which meant the
    // strongest deletion signal available anywhere in the product arrived on
    // every incremental pass and was discarded.
    return { objects, syncToken, ctag, removed: parseRemovedHrefs(body) };
  }

  /**
   * Parse iCalendar data from XML response.
   * Handles XML entity decoding and line folding.
   */
  private parseCalendarData(rawData: string): string {
    // Decode XML entities
    let icalendar = this.decodeXmlEntities(rawData);
    
    // Handle iCalendar line folding (lines starting with space/tab are continuations)
    icalendar = this.unfoldLines(icalendar);
    
    return icalendar;
  }

  /**
   * Unfold iCalendar lines (RFC 5545 Section 3.1).
   * Lines starting with whitespace are continuations of the previous line.
   */
  private unfoldLines(text: string): string {
    return text.replace(/[\r\n]+[ \t]+/g, '');
  }

  /**
   * Decode XML entities in iCalendar data.
   */
  private decodeXmlEntities(text: string): string {
    // Numeric character references (&#13; / &#x0D;) too, not just the five named entities —
    // see the identical fix + rationale in carddav-source.ts's decodeXmlEntities. Not yet
    // observed to bite here (Nextcloud's calendar-data responses haven't needed it in
    // practice), but the underlying XML-serialization behavior is server-side, not
    // domain-specific, so the same corruption is possible for any control character in an
    // event field.
    return text
      .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec: string) => String.fromCharCode(parseInt(dec, 10)))
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  /**
   * Which component an iCalendar object holds, as this product's label.
   *
   * The FIRST recognised `BEGIN:` inside the VCALENDAR wrapper. An object may
   * legitimately carry more than one component — a recurring series and its
   * modified occurrences share a file — but they are the same UID and the same
   * kind, so the first one names the object.
   *
   * Defaults to `'event'` when nothing is recognised: unchanged from the
   * behaviour every object had before this, so an unusual object keeps
   * travelling exactly as it did rather than being re-routed on the strength
   * of a parse that did not understand it.
   */
  static componentTypeOf(icalendar: string): CalendarEventType {
    const match = icalendar.match(/^BEGIN:(VEVENT|VTODO|VJOURNAL)\s*$/im);
    const component = match?.[1]?.toUpperCase() as CalendarComponent | undefined;
    return component ? COMPONENT_ITEM_TYPES[component] : 'event';
  }

  /**
   * Parse a calendar object and extract event data.
   */
  private parseCalendarObject(obj: CalDAVCalendarObject): RawCalendarEvent | null {
    try {
      // Extract UID from iCalendar data
      const uid = this.extractUidFromIcalendar(obj.icalendar);
      if (!uid) {
        return null;
      }

      // Create the calendar event
      const event: RawCalendarEvent = {
        item: {
          uid: this.normalizeUid(uid), // Normalize UID to lowercase
          // WHAT THIS OBJECT ACTUALLY IS, read from its own BEGIN line rather
          // than assumed (workplan 0113). This used to be the literal
          // `'event'` for every object, which is wrong for two of the three
          // components RFC 5545 defines — and reachable today, not
          // hypothetically: `sync-collection` (RFC 6578) is
          // component-agnostic, so a MIXED collection (Nextcloud's default
          // calendar declares VEVENT,VTODO) hands this parser its tasks along
          // with its events. The raw iCalendar always survived, so the bytes
          // that reach a target are right; it was the LABEL on the record that
          // lied, and a label nothing reads today is one T4's read-back is
          // about to.
          type: CalDAVSource.componentTypeOf(obj.icalendar),
          summary: this.extractSummary(obj.icalendar),
          start: this.extractStart(obj.icalendar),
          end: this.extractEnd(obj.icalendar),
          description: this.extractDescription(obj.icalendar),
          location: this.extractLocation(obj.icalendar),
          // Carried through so the sync loop can tell a changed event from one
          // it has already copied. Absent when the server sent no getetag.
          ...(obj.etag ? { etag: obj.etag } : {}),
          sourcePath: obj.href,
          icalendar: obj.icalendar,
        },
        icalendar: obj.icalendar,
      };

      return event;
    } catch {
      return null;
    }
  }

  /**
   * Extract UID from iCalendar data.
   * Returns the UID value (normalized to lowercase).
   */
  extractUidFromIcalendar(icalendar: string): string | null {
    // Match UID property at start of line (RFC 5545: properties start at beginning of line)
    const uidMatch = icalendar.match(/^[ \t]*UID[:\s]([^\r\n]+)/im);
    if (!uidMatch || !uidMatch[1]) {
      return null;
    }
    return uidMatch[1].trim();
  }

  /**
   * Normalize UID for case-insensitive comparison.
   * RFC 5545 states UID is case-insensitive.
   */
  normalizeUid(uid: string): string {
    return uid.toLowerCase();
  }

  /**
   * Extract summary from iCalendar data.
   */
  private extractSummary(icalendar: string): string {
    const match = icalendar.match(/SUMMARY[:\s]([^\r\n]+)/i);
    return match && match[1] ? match[1].trim() : 'Untitled Event';
  }

  /**
   * Extract start time from iCalendar data.
   */
  private extractStart(icalendar: string): string {
    // Try DTSTART first
    const startMatch = icalendar.match(/DTSTART(?:;[^:]+)?[:\s]([^\r\n]+)/i);
    if (startMatch && startMatch[1]) {
      return this.convertIcalDateToIso(startMatch[1].trim());
    }
    return new Date().toISOString();
  }

  /**
   * Extract end time from iCalendar data.
   */
  private extractEnd(icalendar: string): string | undefined {
    const endMatch = icalendar.match(/DTEND(?:;[^:]+)?[:\s]([^\r\n]+)/i);
    if (endMatch && endMatch[1]) {
      return this.convertIcalDateToIso(endMatch[1].trim());
    }
    return undefined;
  }

  /**
   * Extract description from iCalendar data.
   */
  private extractDescription(icalendar: string): string | undefined {
    const match = icalendar.match(/DESCRIPTION[:\s]([^\r\n]+)/i);
    return match && match[1] ? match[1].trim() : undefined;
  }

  /**
   * Extract location from iCalendar data.
   */
  private extractLocation(icalendar: string): string | undefined {
    const match = icalendar.match(/LOCATION[:\s]([^\r\n]+)/i);
    return match && match[1] ? match[1].trim() : undefined;
  }

  /**
   * Convert iCalendar date format to ISO 8601.
   */
  private convertIcalDateToIso(dateStr: string): string {
    // Handle both formats:
    // - Date-time: 20240101T120000Z or 20240101T120000
    // - Date: 20240101
    
    const dateOnlyMatch = dateStr.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (dateOnlyMatch) {
      // Date-only (all-day event)
      const year = dateOnlyMatch[1];
      const month = dateOnlyMatch[2];
      const day = dateOnlyMatch[3];
      return `${year}-${month}-${day}T00:00:00Z`;
    }

    const dateTimeMatch = dateStr.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
    if (dateTimeMatch) {
      const year = dateTimeMatch[1];
      const month = dateTimeMatch[2];
      const day = dateTimeMatch[3];
      const hour = dateTimeMatch[4];
      const minute = dateTimeMatch[5];
      const second = dateTimeMatch[6];
      const isUtc = dateTimeMatch[7] === 'Z';
      
      if (isUtc) {
        return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
      } else {
        return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
      }
    }

    // Fallback: return as-is or current time
    return new Date().toISOString();
  }

  /**
   * Build collection path from folder info.
   */
  private buildCollectionPath(folder: CalendarFolder, homeSet: string): string {
    // Use the folder path if available, otherwise construct from home set
    if (folder.path) {
      return this.normalizePath(folder.path);
    }
    return this.normalizePath(`${homeSet}${folder.name}/`);
  }

  /**
   * Encode sync token for cursor storage.
   */
  private encodeSyncToken(token: string): string {
    return `sync-token:${token}`;
  }

  /**
   * Encode CTag for cursor storage.
   */
  private encodeCTag(ctag: string, collectionPath: string): string {
    return `ctag:${collectionPath}:${ctag}`;
  }

  /**
   * Decode sync token from cursor.
   */
  private decodeSyncToken(cursor: SyncCursor): CalDAVSyncToken {
    const value = cursor.value;
    
    if (value.startsWith('sync-token:')) {
      return {
        token: value.slice('sync-token:'.length),
        isSyncToken: true,
        collectionPath: '',
      };
    }

    if (value.startsWith('ctag:')) {
      const parts = value.slice('ctag:'.length).split(':');
      if (parts.length >= 2) {
        const collectionPath = parts[0];
        const token = parts.slice(1).join(':');
        if (!collectionPath) {
          throw new Error(`Invalid cursor format: ${value}`);
        }
        return {
          token,
          isSyncToken: false,
          collectionPath,
        };
      }
    }

    throw new Error(`Invalid cursor format: ${value}`);
  }

  /**
   * Get authorization header value.
   * Password is read from environment variable.
   */

  /**
   * The one place every request leaves through (workplan 0050): when the
   * mapping carries a limiter, take a rate+concurrency slot first and release
   * it after — the caps an owner configured, enforced. Without one this is
   * exactly `httpClient.request`.
   */
  private async send(options: import('./dav-http.types.ts').HttpRequestOptions): Promise<import('./dav-http.types.ts').HttpResponse> {
    const limiter = this.config.throttleLimiter;
    if (!limiter) return this.httpClient.request(options);
    await limiter.waitForSlot('dav', this.limiterHost());
    try {
      return await this.httpClient.request(options);
    } finally {
      limiter.releaseSlot();
    }
  }

  /** Bucket key: the server, so several collections on one host share caps. */
  private limiterHost(): string {
    try {
      return new URL(this.config.url).host;
    } catch {
      return this.config.url;
    }
  }

  private async authorizationHeader(): Promise<string> {
    // Bearer first (workplan 0045): a configured token provider mints per
    // request — cached until expiry, so this is cheap — which is what keeps a
    // pass alive past Google's one-hour token lifetime. Basic stays exactly as
    // it was for every server that takes a password.
    if (this.config.tokenProvider) {
      return `Bearer ${(await this.config.tokenProvider.getToken()).accessToken}`;
    }
    const password = this.config.password ?? (this.config.passwordEnv ? process.env[this.config.passwordEnv] : undefined);
    if (!password) {
      throw new Error(`No password configured (set config.password or config.passwordEnv)`);
    }
    const credentials = Buffer.from(`${this.config.username}:${password}`).toString('base64');
    return `Basic ${credentials}`;
  }

  /**
   * Build URL from path.
   * Used for config-derived paths (e.g., .well-known/caldav).
   * Rule B: APPEND the path to the base, preserving any subpath prefix.
   * For CalDAV collections, always add trailing slash (RFC 4918).
   */
  private buildUrl(path: string): string {
    // Handle empty path case
    if (path === '') {
      return this.config.url.replace(/\/$/, '');
    }
    
    const baseUrl = this.config.url.endsWith('/') 
      ? this.config.url.slice(0, -1)
      : this.config.url;
    
    // Remove leading slash from relative path to avoid double slash
    const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
    
    // Remove trailing slash from path for now - we'll add it back for collections
    const pathWithoutTrailingSlash = normalizedPath.replace(/\/$/, '');
    
    const result = baseUrl + '/' + pathWithoutTrailingSlash;
    
    // For CalDAV collections (non-.well-known paths), add trailing slash
    // .well-known paths should NOT have trailing slash
    if (!pathWithoutTrailingSlash.includes('.well-known')) {
      return result + '/';
    }
    
    return result;
  }

  /**
   * Resolve a server-returned href against the base URL's origin.
   * Used for hrefs returned by the server in PROPFIND multistatus responses.
   * Rule A: REPLACE the base path with the server-returned path.
   */
  private resolveHref(href: string): string {
    // If href is already a full URL, return it as-is
    if (href.startsWith('http://') || href.startsWith('https://')) {
      return href;
    }
    
    const origin = new URL(this.config.url).origin;
    // Normalize href to ensure it starts with /
    const normalizedHref = href.startsWith('/') ? href : '/' + href;
    return new URL(normalizedHref, origin).toString();
  }

  /**
   * Normalize path to ensure consistent format.
   */
  private normalizePath(path: string): string {
    let normalized = path.replace(/\\/g, '/');
    if (!normalized.startsWith('/')) {
      normalized = '/' + normalized;
    }
    if (!normalized.endsWith('/')) {
      normalized += '/';
    }
    return normalized;
  }

  /**
   * Extract name from path.
   */
  private extractNameFromPath(path: string): string {
    const parts = path.split('/').filter(p => p.length > 0);
    return parts[parts.length - 1] || 'Calendar';
  }

  /**
   * Check if a collection name indicates it's an internal Nextcloud collection.
   * These are auto-created by Nextcloud and should be filtered out.
   */
  private isInternalCollection(name: string): boolean {
    // Nextcloud internal calendar collections
    const internalPatterns = [
      /^z-server-generated--system$/,
      /^z-app-generated--contactsinteraction--recent$/,
      /^contact_birthdays$/,
    ];
    return internalPatterns.some(pattern => pattern.test(name));
  }

  /**
   * Escape XML special characters.
   */
  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

/**
 * Create a default HTTP client using Node.js fetch.
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
