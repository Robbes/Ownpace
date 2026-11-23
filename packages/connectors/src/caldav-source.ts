// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * CalDAV Source Connector Implementation
 * 
 * Implements CalendarSource interface for CalDAV calendar synchronization.
 * Follows RFC 4791 (CalDAV) and RFC 6578 (Collection Synchronization).
 * 
 * Features:
 * - Calendar home set discovery via PROPFIND
 * - Incremental sync using sync-collection REPORT (RFC 6578), followed
 *   through its pages (§3.6), with the members a server lists without their
 *   data read by calendar-multiget (RFC 4791 §7.9) (workplan 0164 T2)
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
import {
  CALENDAR_COMPONENTS,
  COMPONENT_ITEM_TYPES,
  collectionCarries,
  componentOfIcalendar,
  davRefusalParts,
  RemoteRefusal,
} from '@openmig/shared';
import type { CalDAVSourceConfig, CalDAVSyncToken, CalDAVCalendarObject } from './caldav-source.types.ts';
import { caldavComponentFilter, davRefusalBody, elementsIn, log, namesPrefixedElement } from '@openmig/shared';
import { tenantFetch } from '@openmig/shared/reachable-host';
import type { HttpClient, HttpRequestOptions, HttpResponse } from './dav-http.types.ts';
import {
  wellKnownUrl as buildWellKnownUrl,
  normalizeDavHref,
  isSendableAsText,
} from './dav-http.types.ts';
import { parseRemovedHrefs } from './dav-removals.ts';
import { asksToSlowDown, rateLimitWaitMs } from './rate-limit-once.ts';

/**
 * How many members one `calendar-multiget` asks for (RFC 4791 §7.9).
 *
 * Small enough that one request stays small, and that a batch that fails
 * names few members; large enough that a first reading of a calendar of
 * 3,624 events, the largest T1 measured at Google (workplan 0164), is 73
 * requests rather than hundreds.
 */
export const MULTIGET_HREFS_PER_REQUEST = 50;

/**
 * The most pages of one `sync-collection` reading this follows (RFC 6578
 * §3.6). Google answered a calendar of 3,627 members in 15 pages (workplan
 * 0164 T1), about 250 a page, so this is room for about 25,000, far past a
 * family's or a small business's calendar. A reading still truncated past it
 * is read whole instead (`syncCollection`). The cost it bounds: a server
 * whose pages never end is asked this many times a pass before that.
 */
export const MOST_SYNC_PAGES = 100;

/**
 * One `sync-collection` reading, every page of it.
 *
 * `answered`: the pages ended, and this is what they said. `refused`: the
 * first page was not a 207, and `response` is what came instead. `cut-short`:
 * a later page was not a 207, or the pages did not end; `why` says which, and
 * what the pages before it said is kept.
 */
type SyncReading =
  | {
      readonly kind: 'answered';
      readonly objects: CalDAVCalendarObject[];
      /** Members listed without their calendar data: what is left to read. */
      readonly toRead: string[];
      readonly removed: string[];
      readonly syncToken?: string;
      readonly ctag?: string;
      readonly pages: number;
      readonly bytes: number;
    }
  | { readonly kind: 'refused'; readonly response: HttpResponse }
  | {
      readonly kind: 'cut-short';
      readonly why: string;
      readonly removed: string[];
      /**
       * The last token a page gave, from which the rest of the changes
       * follow, or, when the page that stopped gave none, the one it was sent.
       */
      readonly syncToken?: string;
    };

/**
 * RFC 6578 §3.2: a token the server will no longer take is refused with the
 * `DAV:valid-sync-token` precondition, as a 403 or a 409.
 */
function refusesTheSyncToken(response: HttpResponse): boolean {
  return (
    (response.status === 403 || response.status === 409) &&
    /<(?:[A-Za-z][\w-]*:)?valid-sync-token\b/i.test(response.body)
  );
}

/**
 * Whether a refusal is the server's trouble for the moment rather than its
 * word on the request (workplan 0164 T2, second review of #2019): a 5xx, or
 * what this source already reads as a rate limit, a 429 or Google's 403
 * rate limit (`asksToSlowDown`). Only such a refusal keeps the sync token it
 * was sent (`syncCollection`).
 */
function refusedForTheMoment(response: HttpResponse): boolean {
  return response.status >= 500 || asksToSlowDown(response.status, response.body);
}

/** A `<response>`'s own status, with its propstats taken out: about the resource, not a property. */
function responseLevelStatus(responseXml: string): number | undefined {
  const own = responseXml.replace(
    /<[A-Za-z][\w-]*:propstat[^>]*>[\s\S]*?<\/[A-Za-z][\w-]*:propstat>/gi,
    '',
  );
  const text = own.match(/<[A-Za-z][\w-]*:status[^>]*>([^<]*)<\/[A-Za-z][\w-]*:status>/i)?.[1];
  const code = text?.match(/\b(\d{3})\b/)?.[1];
  return code === undefined ? undefined : Number(code);
}

/** Whether a `<response>`'s resourcetype names a collection (RFC 4918 §15.9): not a calendar object. */
function isCollectionResource(responseXml: string): boolean {
  const type =
    responseXml.match(
      /<[A-Za-z][\w-]*:resourcetype[^>]*>([\s\S]*?)<\/[A-Za-z][\w-]*:resourcetype>/i,
    )?.[1] ?? '';
  return /<(?:[A-Za-z][\w-]*:)?collection\b/i.test(type);
}

/**
 * CalDAV source connector implementation.
 */
export class CalDAVSource implements CalendarSource {
  private readonly config: CalDAVSourceConfig;
  private readonly httpClient: HttpClient;
  private calendarHomeSet: string | null = null;
  /**
   * The component this source serves — `VEVENT` unless told otherwise, which
   * is what every caller before workplan 0113 meant and still means.
   */
  private readonly component: CalendarComponent;

  constructor(
    config: CalDAVSourceConfig,
    deps?: { httpClient?: HttpClient },
  ) {
    this.config = config;
    this.httpClient = deps?.httpClient ?? createDefaultHttpClient();
    this.component = config.component ?? 'VEVENT';
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
    //
    // ## A 404 IN AN ANSWER TO NO TOKEN (workplan 0164 T2)
    //
    // RFC 6578 §3.4 says a first reading, one with an empty token, lists the
    // members there are and no removed ones: with no earlier state, a client
    // would have nothing to hold a removal against. Google lists them anyway:
    // 3, 5 and 7 members with 404 in three calendars' first readings (0164
    // T1), removals it still remembers. They are carried up here as `removed`,
    // exactly as a 404 in an answer to a token is, and the reasoning is this:
    //
    //  - A 404 at the response's own level is the server's word that the
    //    resource at that href is gone (RFC 4918 §14.24, RFC 6578 §3.5.2),
    //    whatever token was sent. §3.4 is about what a server sends, and does
    //    not make it untrue.
    //  - What the RFC protects against cannot happen here. A 404 is matched to
    //    the ledger by its href (`findBySourceRef`), and a 404 for something
    //    this migration never copied matches no row and is passed over. Only
    //    a copy the ledger holds becomes a `reported` removal.
    //  - And it is the only way to learn of one. An existing Google migration
    //    holds no token, because `calendar-query` never gave one, so its first
    //    pass on this reader sends none; the events deleted at Google while it
    //    listed whole are in that answer and in no later one, since an answer
    //    to a token lists only what changed after it.
    //  - The gates are the same as for any reported removal: resolved only by
    //    a pass that reached every collection, never for an item seen
    //    anywhere in that pass (a move between calendars, a 404 in one and a
    //    200 in the other, is a move), never for an item whose move an
    //    earlier pass recorded (its old href's 404 is that move's echo, which
    //    a reading with no token repeats while the calendar it moved to, read
    //    with a token, names it no more: `resolveReportedRemovals`), and
    //    nothing applied: a person applies it, behind every gate of ADR-0024.
    //
    // The same rule held already for a server that sends its data: a 404 in
    // any answer has been carried up since `parseRemovedHrefs`, token or none.
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
      throw new RemoteRefusal(
        `PROPFIND failed with status ${response.status}: ${davRefusalBody(response.body)}`,
        davRefusalParts(response),
      );
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
      throw new RemoteRefusal(
        `PROPFIND failed with status ${response.status}: ${davRefusalBody(response.body)}`,
        davRefusalParts(response),
      );
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

    let reading = await this.readSyncCollection(collectionPath, syncToken, ctag);

    /**
     * A TOKEN THE SERVER REFUSED IS DROPPED, AND THE CALENDAR READ WHOLE
     * AGAIN, ONCE (workplan 0164 T2).
     *
     * RFC 6578 §3.2: a token a server no longer takes, expired or never its
     * own, is refused with the `DAV:valid-sync-token` precondition. Nothing it
     * stood for can be asked about any more, so the calendar is read the way a
     * first reading is, with no token, in this pass rather than the next. Once:
     * an answer to no token cannot refuse a token, and whatever else it says is
     * handled below as any first reading's is. Before this, a refused token
     * went to `calendar-query` like any other non-207, and was dropped there,
     * a pass later.
     */
    if (reading.kind === 'refused' && syncToken !== undefined && refusesTheSyncToken(reading.response)) {
      log.warn(
        `[caldav] a calendar's server refused this read's sync token ` +
          `(${reading.response.status}, DAV:valid-sync-token, RFC 6578 §3.2), so the token is dropped ` +
          'and the calendar is read whole again, once.',
      );
      syncToken = undefined;
      reading = await this.readSyncCollection(collectionPath, undefined, ctag);
    }

    /**
     * WHEN `sync-collection` DOES NOT ANSWER, ASK THE QUESTION EVERY CALDAV
     * SERVER HAS TO ANSWER.
     *
     * RFC 6578 is an optimisation — "what changed since this token" — and this
     * source treated it as the only way to read a calendar. The sibling
     * CardDAV source has had a fallback since a Nextcloud address book
     * rejected the report outright; this one had the same promise in its file
     * header ("CTag fallback when sync-token not supported") and no code.
     *
     * Live 2026-09-12, mapping 0cc9a844: five Google calendars, all five
     * created on the target by this same pass, `listFolders` naming them
     * correctly — and `0 created, 0 skipped` with nothing thrown and no
     * failure row, because every REPORT came back 207 carrying no calendar
     * objects. On that same pass, over the same Google account and the same
     * token, contacts read 1,227 cards: the CardDAV fallback caught what the
     * CalDAV one could not, and that asymmetry WAS the bug.
     *
     * Two ways in, and the second is the one that had no exit:
     *
     *  - a non-207, which is a server refusing the report (Sabre answers
     *    `ReportNotSupported`); and
     *  - a 207 that carries nothing, on a read that sent NO SYNC TOKEN. With
     *    a token, "nothing" is the correct and common answer — it means
     *    nothing changed since that token. Without one it is a claim that an
     *    entire calendar is empty, and this is where #926's invariant already
     *    refuses to store a token over it. Refusing to record the claim was
     *    the right half; this is the other half, which is to go and find out.
     *
     * ## A token SENT, not a cursor HELD (2026-09-22)
     *
     * This asked `cursor === undefined`, and that is a different question. The
     * fallback below returns an EMPTY cursor — `calendar-query` has no token to
     * give — so the pass after it arrives holding a cursor object that
     * decodes to nothing and sends `<D:sync-token/>`: the very same request as
     * a first read, answered with the very same nothing. But a cursor object
     * WAS passed, so the guard stood down, the empty answer was trusted as
     * "nothing changed", and Google's token was stored in its place. From then
     * on every pass sent a real token, got nothing back, and moved the token
     * past whatever had changed.
     *
     * Live, on the owner's own calendar: an event moved a week in Google, two
     * passes run since, both advancing the token, the copy on the target
     * untouched — and no future delta ever going to mention it again. The
     * existing suite tested every one of those reads alone and never fed the
     * first one's cursor into the second, which is the only place it breaks.
     *
     * ## Google's 207 was not nothing (workplan 0164 T2)
     *
     * What Google sent, measured on 2026-11-21 (0164 T1), was a list: every
     * member by its href, the removed ones with a 404, in pages, and no
     * calendar data at all. The parse below kept only members that carried
     * data, so the list read as nothing and the calendar was listed whole on
     * every pass (6,212 events skipped a pass, 0164 §1), and no removal was
     * ever reported. A member listed without its data is now a member to
     * read (`toRead`, read by `calendar-multiget` in `withEveryMemberRead`),
     * so "nothing" means no member and no removal on any page. A server that
     * sends its data with each member, as Nextcloud does, is still read from
     * that one answer, with no multiget.
     */
    if (reading.kind === 'cut-short') {
      // The pages did not end, so this reading names only part of what
      // changed. The calendar is listed whole instead, which leaves nothing
      // out, and what the pages did say is kept: the removals the server
      // reported, and the last token a page gave, from which the rest of the
      // changes follow (RFC 6578 §3.6), or, when the page that stopped gave
      // none, the token that page was sent. The listing was taken after that
      // token, so a change the next pass is told of again, which this
      // listing already copied, is skipped there by the ledger.
      log.warn(
        `[caldav] a calendar's sync-collection answered in pages (RFC 6578 §3.6) and ${reading.why}, ` +
          `so this pass lists the calendar whole with calendar-query (RFC 4791 §7.8), and keeps the ` +
          `${reading.removed.length} removal(s) the pages reported` +
          `${reading.syncToken !== undefined ? ' and a sync token to read on from' : ''}.`,
      );
      const { objects } = await this.calendarQueryAll(collectionPath);
      return {
        objects,
        ...(reading.syncToken !== undefined ? { syncToken: reading.syncToken } : {}),
        removed: reading.removed,
      };
    }

    let kept: string | undefined;
    if (reading.kind === 'refused') {
      kept = syncToken !== undefined && refusedForTheMoment(reading.response) ? syncToken : undefined;
      log.warn(
        `[caldav] a calendar's sync-collection answered ${reading.response.status}, not 207 — ` +
          `falling back to a calendar-query listing (RFC 4791 §7.8)` +
          (syncToken === undefined
            ? '. '
            : kept !== undefined
              ? ', and keeping the sync token it was sent. '
              : ', and dropping the sync token it was sent, so the next pass reads the calendar with none. ') +
          davRefusalBody(reading.response.body),
      );
    } else {
      // What is left to read, counted once the calendar's own href and any
      // collection are out of it: a server that lists nothing but the
      // calendar itself has answered nothing.
      const toRead = this.membersToRead(collectionPath, reading);
      const answeredNothing =
        reading.objects.length === 0 && toRead.length === 0 && reading.removed.length === 0;
      if (!(answeredNothing && syncToken === undefined)) {
        return this.withEveryMemberRead(collectionPath, reading, toRead);
      }
      log.warn(
        `[caldav] a calendar's sync-collection read that sent no sync token came back with ` +
          `no objects and no removals, from a ${reading.bytes}-byte 207. That is a claim ` +
          `the whole calendar is empty, which this does not take on trust — falling back to a ` +
          `calendar-query listing (RFC 4791 §7.8).`,
      );
    }

    const { objects } = await this.calendarQueryAll(collectionPath);
    if (objects.length === 0) {
      log.warn(
        `[caldav] the calendar-query listing found nothing either, so this ` +
          `collection really is empty for ${this.component}.`,
      );
    }
    // No removal reports from this path: a deleted event is simply absent
    // from a `calendar-query` answer, which is the absence-counting path's
    // business, not this one. `[]` says exactly that. And no token of its
    // own: `calendar-query` answers "everything that matches", and ADR-0020
    // makes cursors non-authoritative, so a re-scan stays idempotent.
    //
    // THE TOKEN IT WAS SENT IS KEPT ONLY AFTER A REFUSAL FOR THE MOMENT
    // (workplan 0164 T2, reviews of #2019): a 5xx or a rate limit
    // (`refusedForTheMoment`). The listing is newer than that token, so
    // nothing it stands for is left out, and the next pass asks from it
    // again rather than reading the calendar whole with no token.
    //
    // ANY OTHER REFUSAL DROPS IT, as this source always did: a 410, or a 403
    // that names no precondition, may be a stale token refused without
    // `DAV:valid-sync-token`. Kept, such a token is refused on every pass,
    // each pass lists the calendar whole, and no removal is reported from it
    // again. Dropped, the next pass reads the calendar with no token, which
    // costs one whole first reading and, at Google, names the removals it
    // still remembers; a recorded move is not reported from one
    // (`resolveReportedRemovals`, refusal 5). A token the server refused as a
    // token was dropped above, and a read that sent none has none to keep.
    return { objects, ...(kept !== undefined ? { syncToken: kept } : {}), removed: [] };
  }

  /**
   * One `sync-collection` reading, followed through every page (RFC 6578
   * §3.6, workplan 0164 T2).
   *
   * A server may answer in part: a 207 whose `<response>` for the collection
   * itself says 507, with a token from which the rest follows. Google does,
   * in pages of about 250 (0164 T1: 15 pages for a calendar of 3,627
   * members). Only the last page's token stands for the whole reading, so
   * the pages are asked for in turn, each with the token the one before it
   * gave, until one is not truncated. Each page is the same REPORT; only its
   * token differs.
   *
   * The first page's non-207 is returned as `refused`, for `syncCollection`
   * to read as a refused token or a report the server does not answer. A
   * later page's non-207, a truncated page with no token to go on with or
   * with the token it was sent, and more than `MOST_SYNC_PAGES` pages are
   * `cut-short`: the reading names only part of what changed, and is never
   * returned as though it were whole.
   */
  private async readSyncCollection(
    collectionPath: string,
    syncToken: string | undefined,
    ctag: string | undefined,
  ): Promise<SyncReading> {
    const objects: CalDAVCalendarObject[] = [];
    const toRead: string[] = [];
    const removed: string[] = [];
    let next = syncToken;
    let bytes = 0;
    let level = true;
    const ask = async (token: string | undefined, withLevel: boolean): Promise<HttpResponse> =>
      this.send({
        method: 'REPORT',
        url: this.resolveHref(collectionPath),
        body: this.buildSyncCollectionReport(collectionPath, token, ctag, withLevel),
        headers: {
          'Content-Type': 'application/xml',
          Authorization: await this.authorizationHeader(),
        },
      });
    for (let pages = 0; ; ) {
      let response = await ask(next, level);
      if (response.status === 400 && level && pages === 0) {
        // A server that will not take `sync-level` (RFC 6578 §6.1 has it in
        // every request) is asked once more without it, as this source asked
        // before, and every page of this reading goes without it.
        //
        // The retry's answer stands, whatever it is (second review of
        // #2019): a 400 to `sync-level` says nothing of the token, and the
        // retry may refuse the token itself, with `DAV:valid-sync-token`,
        // which `syncCollection` reads as a refused token only if it sees it.
        response = await ask(next, false);
        if (response.status === 207) {
          log.warn(
            '[caldav] a calendar\'s server answered sync-level 1 with 400 and the same report without it ' +
              'with 207, so this reading goes without sync-level.',
          );
          level = false;
        }
      }
      if (response.status !== 207) {
        if (pages === 0) return { kind: 'refused', response };
        return {
          kind: 'cut-short',
          why: `page ${pages + 1} answered ${response.status}`,
          removed,
          ...(next !== undefined ? { syncToken: next } : {}),
        };
      }
      pages += 1;
      bytes += response.body.length;
      const page = this.parseSyncCollectionResponse(response.body);
      objects.push(...page.objects);
      toRead.push(...page.toRead);
      removed.push(...page.removed);
      // A PAGE THAT GIVES NO TOKEN KEEPS THE ONE IT WAS SENT (second review
      // of #2019). RFC 6578 has every answer carry one; a server that leaves
      // it out has said nothing past the token it was asked with, so a
      // reading from that token again names what this one named, and more,
      // where dropping it would read the calendar whole with no token.
      const token = page.syncToken ?? next;
      if (!page.truncated) {
        return {
          kind: 'answered',
          objects,
          toRead,
          removed,
          ...(token !== undefined ? { syncToken: token } : {}),
          ...(page.ctag !== undefined ? { ctag: page.ctag } : {}),
          pages,
          bytes,
        };
      }
      const stuck =
        page.syncToken === undefined
          ? `page ${pages} was truncated and gave no token to go on with`
          : page.syncToken === next
            ? `page ${pages} was truncated and gave back the token it was sent`
            : pages >= MOST_SYNC_PAGES
              ? `it was still truncated after ${MOST_SYNC_PAGES} pages`
              : undefined;
      if (stuck !== undefined) {
        return {
          kind: 'cut-short',
          why: stuck,
          removed,
          ...(token !== undefined ? { syncToken: token } : {}),
        };
      }
      next = page.syncToken;
    }
  }

  /**
   * THE MEMBERS A READING NAMED WITHOUT THEIR DATA, READ (workplan 0164 T2).
   *
   * RFC 6578 lets a `sync-collection` answer name a changed member by its
   * href and ETag without the data asked for; Google's carries none (0164
   * T1). Those members are read with `calendar-multiget` (RFC 4791 §7.9),
   * `MULTIGET_HREFS_PER_REQUEST` at a time, and each is handed on under the
   * href the reading named it by: that is the href a later 404 names, and
   * `findBySourceRef` matches the two as plain strings.
   *
   * A multiget that falls short (a batch not answered with 207, a member it
   * answers without its data, a 404 included, or leaves out) would leave
   * members unread, and the token past them would retire them for good. So the
   * calendar is listed whole with `calendar-query` instead, as it was before
   * this reader, and nothing is left out: the removals the reading reported
   * and its token are kept, since a whole listing taken after the token is
   * complete for everything the token stands for. A failing batch thus loses
   * none of the members of the batches around it, and costs that one pass
   * what every pass cost before. If the listing fails too, that is thrown,
   * and the pass skips the collection with its token unmoved.
   */
  private async withEveryMemberRead(
    collectionPath: string,
    reading: Extract<SyncReading, { kind: 'answered' }>,
    toRead: readonly string[],
  ): Promise<{ objects: CalDAVCalendarObject[]; syncToken?: string; ctag?: string; removed: string[] }> {
    const kept = {
      ...(reading.syncToken !== undefined ? { syncToken: reading.syncToken } : {}),
      ...(reading.ctag !== undefined ? { ctag: reading.ctag } : {}),
      removed: reading.removed,
    };
    if (toRead.length === 0) return { objects: reading.objects, ...kept };

    const read = await this.readMembers(collectionPath, toRead);
    if (read.short === undefined) {
      log.info(
        `[caldav] sync-collection named ${toRead.length} member(s) of a calendar without their data ` +
          `over ${reading.pages} page(s); read with ` +
          `${Math.ceil(toRead.length / MULTIGET_HREFS_PER_REQUEST)} calendar-multiget request(s) (RFC 4791 §7.9).`,
      );
      return { objects: [...reading.objects, ...read.objects], ...kept };
    }
    log.warn(
      `[caldav] ${read.short}, so not every one of the ${toRead.length} member(s) a calendar's ` +
        `sync-collection named without their data was read. This pass lists the calendar whole with ` +
        `calendar-query (RFC 4791 §7.8), as it did before, and keeps the ${reading.removed.length} ` +
        `removal(s) the server reported and its sync token.`,
    );
    const { objects } = await this.calendarQueryAll(collectionPath);
    return { objects, ...kept };
  }

  /**
   * The hrefs left to read: each once, none that came with its data on
   * another page, and not the collection's own href, which a server may list
   * among its members.
   */
  private membersToRead(
    collectionPath: string,
    reading: Extract<SyncReading, { kind: 'answered' }>,
  ): string[] {
    const withData = new Set(reading.objects.map((o) => this.sameResource(o.href)));
    const itself = this.sameResource(collectionPath).replace(/\/+$/, '');
    const seen = new Set<string>();
    const toRead: string[] = [];
    for (const href of reading.toRead) {
      const key = this.sameResource(href);
      if (seen.has(key) || withData.has(key) || key.replace(/\/+$/, '') === itself) continue;
      seen.add(key);
      toRead.push(href);
    }
    return toRead;
  }

  /**
   * `calendar-multiget` (RFC 4791 §7.9), `MULTIGET_HREFS_PER_REQUEST` hrefs a
   * request, in turn. Returns what it read, and in `short` why it stopped
   * before reading every member: counts and a status, and the server's own
   * words where it refused, as every other DAV refusal here carries them.
   * No member's href or data is put in it.
   *
   * A MEMBER THE MULTIGET ANSWERS 404 FOR IS NOT TAKEN AS GONE (review of
   * #2019). It may have gone since the reading listed it; it may as well be
   * there, and a multiget that cannot find what `sync-collection` just named
   * (an href it spells another way, a server's own fault) is the likelier
   * reading of a batch of them. Passed over, a member that is there was never
   * copied, and the token handed on retired it for good. Counted short, the
   * calendar is listed whole for that pass: a member that went is absent from
   * the listing, and the next reading, with the token, reports its removal
   * (RFC 6578 §3.5.2); a member that is there is copied.
   */
  private async readMembers(
    collectionPath: string,
    hrefs: readonly string[],
  ): Promise<{ objects: CalDAVCalendarObject[]; short?: string }> {
    const objects: CalDAVCalendarObject[] = [];
    for (let at = 0; at < hrefs.length; at += MULTIGET_HREFS_PER_REQUEST) {
      const batch = hrefs.slice(at, at + MULTIGET_HREFS_PER_REQUEST);
      const authorization = await this.authorizationHeader();
      let response: HttpResponse;
      try {
        response = await this.send({
          method: 'REPORT',
          url: this.resolveHref(collectionPath),
          body: this.buildMultigetReport(batch),
          headers: {
            'Content-Type': 'application/xml',
            // RFC 4791 §7.9: a server MUST ignore Depth on a multiget, whose
            // hrefs name what it reads. Sent as `calendar-query` sends it, so
            // a server that reads it all the same reads the collection's
            // members, which is where these hrefs are.
            Depth: '1',
            Authorization: authorization,
          },
        });
      } catch (err) {
        return {
          objects,
          short: `a calendar-multiget of ${batch.length} member(s) got no answer (${(err as Error)?.message ?? String(err)})`,
        };
      }
      if (response.status !== 207) {
        return {
          objects,
          short:
            `a calendar-multiget of ${batch.length} member(s) answered ${response.status}: ` +
            davRefusalBody(response.body),
        };
      }
      const answer = this.parseSyncCollectionResponse(response.body);
      const found = new Map(answer.objects.map((o) => [this.sameResource(o.href), o]));
      let left = 0;
      for (const href of batch) {
        const object = found.get(this.sameResource(href));
        if (object !== undefined) {
          objects.push({ href, icalendar: object.icalendar, ...(object.etag ? { etag: object.etag } : {}) });
        } else {
          left += 1;
        }
      }
      if (left > 0) {
        return {
          objects,
          short: `a calendar-multiget of ${batch.length} member(s) answered ${left} of them without their data`,
        };
      }
    }
    return { objects };
  }

  /**
   * The `calendar-multiget` REPORT (RFC 4791 §9.10) for these hrefs. Each is
   * the text of an href from a multistatus, entities and all, so it is
   * decoded and escaped again: a `&amp;` in a member's href goes out as one.
   */
  private buildMultigetReport(hrefs: readonly string[]): string {
    const named = hrefs
      .map((href) => `<D:href>${this.escapeXml(this.decodeXmlEntities(href).trim())}</D:href>`)
      .join('\n        ');
    return `<?xml version="1.0" encoding="utf-8"?>
      <C:calendar-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
        <D:prop>
          <D:getetag/>
          <C:calendar-data/>
        </D:prop>
        ${named}
      </C:calendar-multiget>`;
  }

  /**
   * One resource as two answers may spell its href: the entities decoded,
   * an origin dropped, the percent-escapes undone. Used only to MATCH a
   * multiget's answers to the hrefs it asked for; what is handed on is the
   * href as the reading gave it, never this.
   */
  private sameResource(href: string): string {
    let path = this.decodeXmlEntities(href).trim();
    if (/^https?:\/\//i.test(path)) {
      try {
        path = new URL(path).pathname;
      } catch {
        // Not a URL after all: compared as it came.
      }
    }
    try {
      path = decodeURIComponent(path);
    } catch {
      // A stray `%`: compared as it came.
    }
    return path;
  }

  /**
   * Every object of this source's component in one collection.
   *
   * RFC 4791 §7.8 `calendar-query`, with the filter §9.5 requires and exactly
   * ONE component — see `caldavComponentFilter` for why both of those are
   * load-bearing and what each cost when it was got wrong.
   *
   * The whole body is asked for, not a partial retrieval: this is the read the
   * sync loop copies FROM, so it needs the events themselves, where the target
   * writer's sibling query is only enumerating and asks for UIDs alone.
   */
  private async calendarQueryAll(
    collectionPath: string,
  ): Promise<{ objects: CalDAVCalendarObject[] }> {
    const query = `<?xml version="1.0" encoding="utf-8"?>
      <C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
        <D:prop>
          <D:getetag/>
          <C:calendar-data/>
        </D:prop>
        ${caldavComponentFilter(this.component, 'C')}
      </C:calendar-query>`;

    const response = await this.send({
      method: 'REPORT',
      url: this.resolveHref(collectionPath),
      body: query,
      headers: {
        'Content-Type': 'application/xml',
        Depth: '1',
        Authorization: await this.authorizationHeader(),
      },
    });

    if (response.status !== 207) {
      throw new RemoteRefusal(
        `calendar-query REPORT failed with status ${response.status}: ${davRefusalBody(response.body)}`,
        davRefusalParts(response),
      );
    }

    const { objects } = this.parseSyncCollectionResponse(response.body);
    return { objects };
  }

  /**
   * Build the sync-collection REPORT XML.
   */
  private buildSyncCollectionReport(
    collectionPath: string,
    syncToken?: string,
    ctag?: string,
    level = true,
  ): string {
    // Nextcloud requires sync-token element even for full syncs
    // Use empty string for full sync, actual token for incremental sync
    const syncTokenElement = syncToken
      ? `<D:sync-token>${this.escapeXml(syncToken)}</D:sync-token>`
      : '<D:sync-token/>';

    const calendarData = ctag
      ? `<C:calendar-data><C:expand start="19700101T000000Z" end="20991231235959Z"/></C:calendar-data>`
      : '<C:calendar-data/>';

    // THE REPORT T1 MEASURED AT GOOGLE (workplan 0164 T1; review of #2019):
    // sync-token, `sync-level` 1, then prop, the order and the elements RFC
    // 6578 §6.1 gives every `sync-collection`. This source used to send prop
    // first and no `sync-level`, and Google's answer to that was measured
    // only as "no calendar data". A server that refuses `sync-level` with a
    // 400 is asked once more without it (`readSyncCollection`), as T1 did.
    return `<?xml version="1.0" encoding="utf-8"?>
      <D:sync-collection xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
        ${syncTokenElement}
        ${level ? '<D:sync-level>1</D:sync-level>' : ''}
        <D:prop>
          <D:resourcetype/>
          <!-- Per-object ETag: the shadow-sync change signal. Without asking
               for it here the response carries none and every event looks
               unchanged forever. -->
          <D:getetag/>
          ${calendarData}
        </D:prop>
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
    // `<p:name[^>]*>([\s\S]*?)<\/p:name>`, case aside, read a tag at a time, in time linear in the
    // body's length (`elementsIn`, workplan 0163): the pattern was quadratic on a body that opens
    // the element many times and never closes it, and the server is whatever host a person named.
    const outerContent = elementsIn(
      body,
      (tag) => namesPrefixedElement(tag, elementName),
      (tag) => tag.startsWith('/') && namesPrefixedElement(tag.slice(1), elementName, true),
      true,
    )[0]?.text;
    if (outerContent === undefined) return null;
    const hrefMatch = outerContent.match(/<[\w-]+:href[^<>]*>([^<]+)<\/[\w-]+:href>/i);
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
      if (!collectionCarries(components, this.component)) continue;

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
    /**
     * Hrefs of members listed WITHOUT their calendar data: there, and left
     * to read (workplan 0164 T2). Not a removal, not a collection, and not
     * the 507 that says the answer was cut short.
     */
    toRead: string[];
    /** A 507 for the collection: this is one page, and the token carries on (RFC 6578 §3.6). */
    truncated: boolean;
  } {
    const objects: CalDAVCalendarObject[] = [];
    const toRead: string[] = [];
    let truncated = false;
    let syncToken: string | undefined;
    let ctag: string | undefined;

    // Extract sync-token if present - namespace-agnostic. Decoded, as the
    // text inside XML it is: it is escaped again when it is sent, and a token
    // carrying an `&` (often a URL) would otherwise go back changed (review of
    // #2019).
    const syncTokenMatch = body.match(/<[A-Za-z]+:sync-token>([^<]+)<\/[A-Za-z]+:sync-token>/i);
    if (syncTokenMatch && syncTokenMatch[1]) {
      syncToken = this.decodeXmlEntities(syncTokenMatch[1]).trim();
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
      if (!calendarDataMatch || !calendarDataMatch[1]) {
        // NOT NOTHING (workplan 0164 T2). A member listed without its data
        // used to be passed over here, which is how Google's whole list read
        // as an empty one. Its own status, with its propstats taken out,
        // says what it is: none, or a 2xx, is a member that is there, so it
        // is read (unless it is a collection, which holds no event); a 404
        // is a removal, which `parseRemovedHrefs` below reports; a 507 is
        // the collection itself, saying this is one page of the answer. A
        // 404 INSIDE a propstat, which is what a server says of
        // `calendar-data` it will not send, is about that property, and the
        // member is still there.
        const own = responseLevelStatus(responseXml);
        if (own === 507) truncated = true;
        else if ((own === undefined || (own >= 200 && own < 300)) && !isCollectionResource(responseXml)) {
          toRead.push(href);
        }
        continue;
      }

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
    return { objects, syncToken, ctag, removed: parseRemovedHrefs(body), toRead, truncated };
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
    const component = componentOfIcalendar(icalendar);
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

      // NOT MINE TO CARRY (workplan 0113). `sync-collection` is
      // component-agnostic, so a MIXED collection — Nextcloud's default
      // calendar declares VEVENT,VTODO — hands this parser its tasks along
      // with its events. Each domain takes only its own: the component decides
      // the domain, the collection never does, and ticking one box means one
      // thing. An object whose component is unrecognised (`undefined`) is
      // carried by the calendar domain, which is where every object went
      // before this existed.
      const component = componentOfIcalendar(obj.icalendar) ?? 'VEVENT';
      if (component !== this.component) {
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
   *
   * A RATE LIMIT IS WAITED OUT ONCE (workplan 0143 T10): a 429 or 503, or
   * Google's 403 rate limit, for what `Retry-After` asks or else a second,
   * holding no slot while it waits. The rule and its limits are
   * `rate-limit-once.ts`'s. Every request here is a read, so asking again
   * cannot do anything twice.
   */
  private async send(options: import('./dav-http.types.ts').HttpRequestOptions): Promise<import('./dav-http.types.ts').HttpResponse> {
    const first = await this.sendOnce(options);
    if (!asksToSlowDown(first.status, first.body)) return first;
    const waitMs = rateLimitWaitMs(first.headers['retry-after'] ?? first.headers['Retry-After']);
    if (waitMs === undefined) return first;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return this.sendOnce(options);
  }

  /** One request, with the limiter's slot held for it alone. */
  private async sendOnce(options: import('./dav-http.types.ts').HttpRequestOptions): Promise<import('./dav-http.types.ts').HttpResponse> {
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
  private normalizePath(hrefOrUrl: string): string {
    // 0115 T1: an absolute URL keeps its host. See `normalizeDavHref` for the
    // iCloud partition host this used to turn into a path that cannot exist.
    return normalizeDavHref(hrefOrUrl);
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
      // A BODY THIS CLIENT CANNOT SEND IS A REFUSAL, NOT A SILENCE.
      //
      // This read `typeof body === 'string' ? body : undefined`, which turns
      // any other body into a request that goes out EMPTY — a PUT that blanks
      // a resource and answers 204, with nothing anywhere saying why. Nothing
      // hands this client bytes today; the point is that the day something
      // does, it says so. (Streams belong to the WebDAV client, which carries
      // files; see `HttpRequestOptions.body`.)
      if (!isSendableAsText(options.body)) {
        throw new Error(
          `this DAV client sends XML and was handed a ${
            options.body instanceof ReadableStream ? 'stream' : 'binary'
          } body for ${options.method} ${options.url} — refusing rather than sending the ` +
            'request without it, which would empty the resource and report success',
        );
      }
      const response = await tenantFetch(options.url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
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
