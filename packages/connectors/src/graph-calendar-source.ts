// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * OUTLOOK CALENDARS AS A CALENDAR SOURCE, ON CALLS GRAPH v1.0 DOCUMENTS.
 *
 * ## The defect this was rebuilt for (2026-11-24)
 *
 * A Microsoft 365 → Cirrux migration listed a personal account's four
 * calendars and found no event in any of them, while the account holds a
 * weekly repeating event and a calendar of holidays. Its mail, contacts and
 * tasks copied. The old listing stood on two calls v1.0 does not document:
 *
 *  - `{scope}/calendars/{id}/events/delta`. v1.0 documents only
 *    `calendarView/delta`, with a start and an end date
 *    (https://learn.microsoft.com/en-us/graph/api/event-delta?view=graph-rest-1.0);
 *    the per-calendar `events/delta` is in the beta version only.
 *  - `/events/{id}/$value` with `Prefer: outlook.body-content-type="icalendar"`.
 *    `$value` is documented for messages, not events, and that header takes
 *    `text` or `html` (https://learn.microsoft.com/en-us/graph/api/event-get?view=graph-rest-1.0).
 *
 * Its tests mocked both calls, by call order, so neither ever failed in CI.
 * `a-calendar-on-calls-graph-documents.unit.test.ts` keeps both from coming back.
 *
 * ## What it calls now
 *
 *  1. **The listing:** `GET {scope}/calendars/{id}/events?$select=…`, every
 *     page. "The list contains single instance meetings and series masters"
 *     (https://learn.microsoft.com/en-us/graph/api/calendar-list-events?view=graph-rest-1.0):
 *     a series is listed once, not as its occurrences. Times come in UTC, the
 *     documented default with no `Prefer: outlook.timezone`, and the body as
 *     text where Graph honours `Prefer: outlook.body-content-type="text"`
 *     (HTML is turned into text here when it does not).
 *  2. **A series' exceptions and cancellations:** for each series master,
 *     `GET {scope}/calendars/{id}/events/{masterId}?$select=cancelledOccurrences,exceptionOccurrences&$expand=exceptionOccurrences`.
 *     Both are v1.0 relationships of `event`, "only returned in a GET
 *     operation that specifies the ID … of a series master event"
 *     (https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0).
 *     `instances` would not do: it needs a date range, and "doesn't include
 *     occurrences canceled from the series"
 *     (https://learn.microsoft.com/en-us/graph/api/event-list-instances?view=graph-rest-1.0).
 *
 * ## One series, one object
 *
 * Each item is one iCalendar object, as a CalDAV server stores it: a single
 * event, or a series with its master, an EXDATE for every cancelled
 * occurrence, and a VEVENT with RECURRENCE-ID for every changed one, all under
 * the master's `iCalUId` ("different for each occurrence in a recurring
 * series", so an exception's own is not used). The VEVENT is built from
 * Graph's JSON by this file; Graph is never asked for iCalendar.
 *
 * ## Edits, deletions and the cursor
 *
 * No v1.0 delta fits a calendar's events (see above), so every pass lists the
 * calendar whole, which is one request per hundred events and one more per
 * series. An edit is found by version: `changeKey`, and for a series also its
 * exceptions' and its cancellations, so a changed occurrence re-copies the
 * series (`seriesVersion`). A deletion is found by absence: the cursor keeps
 * the ids the last listing found, and an id the next complete listing does not
 * find is reported in `removed`, the way the CalDAV source reports a
 * `sync-collection` 404. The sync loop resolves it as it does those: a move
 * when the event turned up in another calendar, a deletion for the owner to
 * decide otherwise (never applied on its own, hard rule 2).
 *
 * ## A window (workplan 0170 D1 (a))
 *
 * With `ListOptions.since`, the listing is still read whole (so its cursor
 * claims nothing about what it did not list), and an event plainly over
 * before `since` is not built: for a series that saves its second request.
 * The sync loop's `eventInWindow` decides every event that is built.
 */

import { createHash } from 'node:crypto';
import { graphFailure } from './graph-refusal.ts';
import type { CalendarSource, CalendarFolder, ListOptions, RawCalendarEvent, SyncCursor } from '@openmig/shared';
import type { TokenProvider } from '@openmig/shared';
import type {
  GraphAttendee,
  GraphCalendar,
  GraphCalendarPage,
  GraphEvent,
  GraphSeriesDetail,
} from './graph-calendar-source.types.ts';
import type { GraphDateTimeTimeZone } from './graph-todo-source.types.ts';
import type { HttpClient, HttpRequestOptions, HttpResponse } from './dav-http.types.ts';
import { graphScopePrefix } from './graph-scope.ts';
import { graphItemVersion } from './graph-item-version.ts';
import { bodyText, escapeText, fold, recurrenceToRrule } from './graph-todo-source.ts';
import { ianaZoneOf, offsetMinutes, vtimezoneLines, wallIn, wallStamp } from './graph-time-zones.ts';
import type { ThrottleLimiter } from '@openmig/shared';
import { log } from '@openmig/shared';

/** The tick and the delegated scope this face needs — named in a refusal's way forward (0114 T6). */
const CALENDAR_FACE = { face: 'Calendar', scope: 'Calendars.Read' } as const;

/**
 * More pages than any calendar produces. A guard, not a limit: an unbounded
 * request loop against a customer tenant should fail loudly, not quietly.
 */
const MAX_PAGES = 10_000;

/** Events per page. */
const PAGE_SIZE = 100;

/** What the listing asks for, and nothing more. */
const EVENT_FIELDS = [
  'id',
  'iCalUId',
  'changeKey',
  'createdDateTime',
  'lastModifiedDateTime',
  'subject',
  'body',
  'start',
  'end',
  'originalStartTimeZone',
  'originalEndTimeZone',
  'location',
  'isAllDay',
  'isCancelled',
  'isReminderOn',
  'reminderMinutesBeforeStart',
  'type',
  'seriesMasterId',
  'recurrence',
  'showAs',
  'sensitivity',
  'categories',
  'organizer',
  'attendees',
].join(',');

/** The body as text where Graph honours it; `bodyText` turns HTML into text where it does not. */
const PREFER_TEXT_BODY = 'outlook.body-content-type="text"';

/** The cursor: the ids the last complete listing found, for the next one to compare. */
const CURSOR_PREFIX = 'graph-events:';

interface ListingCursor {
  readonly folderPath: string;
  readonly ids: ReadonlyArray<string>;
}

const DAY_MS = 86_400_000;
/** The furthest west of UTC a zone is: a wall-clock time is at most this much later in UTC. */
const WEST_MS = 12 * 3_600_000;

/** A Graph `dateTime` (`2024-01-15T10:00:00.0000000`) as wall-clock ms, or `undefined`. */
function graphWall(dateTime: string | undefined): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(dateTime ?? '');
  if (!m) return undefined;
  const ms = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  return Number.isFinite(ms) ? ms : undefined;
}

/** The latest instant a Graph `dateTimeTimeZone` can be: exact in UTC, else read at UTC−12. */
function graphLatest(at: GraphDateTimeTimeZone | undefined): number | undefined {
  const wall = graphWall(at?.dateTime);
  if (wall === undefined) return undefined;
  const zone = at?.timeZone?.trim().toUpperCase();
  return zone === 'UTC' || zone === 'ETC/UTC' ? wall : wall + WEST_MS;
}

/**
 * Whether a listed event may be in a window (workplan 0170 D1 (a)), from the
 * entry alone, before it is built. `false` only for what is plainly over
 * before `since`; everything else is built and decided by the sync loop's
 * `eventInWindow`:
 *
 *  - a single event, by its `end`;
 *  - a series, by its range's `endDate` plus one occurrence's length, and
 *    kept when it has no end or ends after a number of occurrences;
 *  - an occurrence or an exception, always;
 *  - a removal, or an entry whose times do not read, always.
 */
export function graphEntryMayBeInWindow(event: GraphEvent, since: Date): boolean {
  if (event['@removed'] !== undefined) return true;
  const type = event.type ?? (event.recurrence ? 'seriesMaster' : 'singleInstance');
  if (type === 'occurrence' || type === 'exception') return true;
  const end = graphLatest(event.end);
  if (end === undefined) return true;
  if (type === 'seriesMaster') {
    const range = event.recurrence?.range;
    if (range?.type !== 'endDate') return true;
    const lastDay = graphWall(range.endDate);
    const start = graphWall(event.start?.dateTime);
    const endWall = graphWall(event.end?.dateTime);
    if (lastDay === undefined || start === undefined || endWall === undefined) return true;
    // The last occurrence starts on its last day at the latest, and lasts as the first does.
    return lastDay + DAY_MS + WEST_MS + Math.max(0, endWall - start) >= since.getTime();
  }
  return end >= since.getTime();
}

export class GraphCalendarSource implements CalendarSource {
  private readonly tenantId: string;
  private readonly tokenProvider: TokenProvider;
  private readonly httpClient: HttpClient;
  private readonly baseUrl: string;
  private readonly throttleLimiter?: ThrottleLimiter;
  /** `{baseUrl}/me` or `{baseUrl}/users/{address}` — see graph-scope.ts. */
  private readonly scope: string;
  private readonly provider: string;

  constructor(
    tokenProvider: TokenProvider,
    tenantId: string,
    options?: { baseUrl?: string; throttleLimiter?: ThrottleLimiter; mailbox?: string },
    deps?: { httpClient?: HttpClient },
  ) {
    this.tokenProvider = tokenProvider;
    this.tenantId = tenantId;
    this.baseUrl = options?.baseUrl?.replace(/\/$/, '') ?? 'https://graph.microsoft.com/v1.0';
    this.httpClient = deps?.httpClient ?? createDefaultHttpClient();
    this.throttleLimiter = options?.throttleLimiter;
    this.provider = hostnameOf(this.baseUrl);
    // Application-permission scope, workplan 0027 T0; `/me` by default.
    this.scope = graphScopePrefix(this.baseUrl, options?.mailbox);
  }

  /**
   * Every calendar, as a folder at `/calendars/{id}` that holds VEVENT.
   *
   * A subscribed or holiday calendar (`canEdit: false`) is listed like any
   * other: its events are copied, and a target holds them as ordinary events.
   */
  async listFolders(): Promise<ReadonlyArray<CalendarFolder>> {
    const calendars = await this.collect<GraphCalendar>(`${this.scope}/calendars`, 'Failed to list calendars');
    return calendars.map((cal) => ({
      path: `/calendars/${cal.id}`,
      name: cal.name,
      description: undefined,
      timezone: undefined,
      color: cal.hexColor,
      // Said out loud, as the To Do source says VTODO: a target that creates
      // this calendar asks for an event collection.
      components: ['VEVENT'],
    }));
  }

  /** Every event in the calendar, one object per single event or series. See the header. */
  async listSince(
    folder: CalendarFolder,
    cursor?: SyncCursor,
    options?: ListOptions,
  ): Promise<{
    items: ReadonlyArray<RawCalendarEvent>;
    nextCursor: SyncCursor;
    unreadable?: number;
    removed?: ReadonlyArray<string>;
  }> {
    const calendarId = calendarIdOf(folder);
    const calendarName = folder.name ? `"${folder.name}"` : folder.path;
    const since = options?.since;

    // A calendar that cannot be listed THROWS, with Graph's own words: the
    // sync loop then names it among the collections it could not list, and
    // concludes nothing about what is in it. Never a quiet empty listing.
    const entries = await this.collect<GraphEvent>(
      `${this.scope}/calendars/${calendarId}/events?$select=${EVENT_FIELDS}&$top=${PAGE_SIZE}`,
      `Failed to list the events in calendar ${calendarName}`,
      { Prefer: PREFER_TEXT_BODY },
    );

    // What the listing holds as objects of their own: single events and series.
    // An occurrence or an exception, should a listing ever carry one, is
    // carried by its series and not twice.
    const objects = entries.filter((e) => e.type !== 'occurrence' && e.type !== 'exception');
    if (objects.length < entries.length) {
      log.debug(
        `Graph calendar: ${entries.length - objects.length} occurrence(s) in ${calendarName} are carried by their series`,
      );
    }

    // A deletion, by absence from a complete listing.
    const listedIds = objects.map((e) => e.id);
    const before = readCursor(cursor, folder.path);
    const now = new Set(listedIds);
    const removed = (before?.ids ?? [])
      .filter((id) => !now.has(id))
      .map((id) => eventPathOf(calendarId, id));

    let setAside = 0;
    const toBuild =
      since === undefined
        ? objects
        : objects.filter((event) => {
            const may = graphEntryMayBeInWindow(event, since);
            if (!may) setAside += 1;
            return may;
          });
    if (setAside > 0) {
      log.info(`Graph calendar: ${setAside} event(s) in ${calendarName} ended before the window and were not read`);
    }

    // Events this listing found and could not turn into an event to migrate.
    let unreadable = 0;
    const items: RawCalendarEvent[] = [];
    for (const event of toBuild) {
      try {
        const series = isSeriesMaster(event) ? await this.seriesDetail(calendarId, event.id) : undefined;
        items.push(graphEventAsCalendarItem(event, calendarId, series));
      } catch (error) {
        // COUNTED, NOT JUST LOGGED (2026-09-07). A `log.warn` and a `continue`
        // put this event nowhere the owner looks: absent from the pass, from
        // the total they approve, and from both sides of the verification
        // gate, which then agree and report PASS. `unreadable` is how the
        // skip earns its silence — see `ports.ts`.
        unreadable += 1;
        log.warn(`Graph calendar: could not read event ${event.id} in ${calendarName}:`, error);
      }
    }

    if (objects.length === 0) {
      log.info(`Graph calendar: ${calendarName} lists no events`);
    }
    if (unreadable > 0) {
      log.warn(`Graph calendar: ${unreadable} event(s) in ${calendarName} could not be read and were not listed`);
    }

    const nextCursor: SyncCursor = {
      value: `${CURSOR_PREFIX}${JSON.stringify({ folderPath: folder.path, ids: listedIds } satisfies ListingCursor)}`,
    };
    // Omitted rather than sent as 0, so "none failed" and "this listing
    // cannot report" read differently downstream.
    return {
      items,
      nextCursor,
      ...(removed.length > 0 ? { removed } : {}),
      ...(unreadable > 0 ? { unreadable } : {}),
    };
  }

  /** A series master's cancelled occurrences and changed ones. See the header, step 2. */
  private async seriesDetail(calendarId: string, masterId: string): Promise<GraphSeriesDetail> {
    const url =
      `${this.scope}/calendars/${calendarId}/events/${masterId}` +
      '?$select=cancelledOccurrences,exceptionOccurrences&$expand=exceptionOccurrences';
    const response = await this.makeRequest({
      url,
      method: 'GET',
      headers: { Accept: 'application/json', Prefer: PREFER_TEXT_BODY },
    });
    if (response.status !== 200) {
      throw new Error(graphFailure(`Failed to read the series ${masterId}`, response, CALENDAR_FACE));
    }
    return JSON.parse(response.body) as GraphSeriesDetail;
  }

  /** Follow `@odata.nextLink` to the end, refusing to loop forever. */
  private async collect<T>(firstUrl: string, failure: string, headers: Record<string, string> = {}): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = firstUrl;
    let hops = 0;
    while (next) {
      if (++hops > MAX_PAGES) {
        throw new Error(`${failure}: paging passed ${MAX_PAGES} pages — refusing to keep requesting.`);
      }
      const response = await this.makeRequest({
        url: next,
        method: 'GET',
        headers: { Accept: 'application/json', ...headers },
      });
      if (response.status !== 200) {
        throw new Error(graphFailure(failure, response, CALENDAR_FACE));
      }
      const page = JSON.parse(response.body) as GraphCalendarPage<T>;
      out.push(...page.value);
      next = page['@odata.nextLink'];
    }
    return out;
  }

  /** The sibling sources' request idiom: a Bearer token, and 429/503 honoured. */
  private async makeRequest(options: HttpRequestOptions): Promise<HttpResponse> {
    const token = await this.tokenProvider.getToken();
    const send = () =>
      this.httpClient.request({
        ...options,
        headers: { Authorization: `Bearer ${token.accessToken}`, ...options.headers },
      });

    if (this.throttleLimiter) {
      const limiter = this.throttleLimiter;
      return limiter.executeWithThrottling(this.tenantId, this.provider, async () => {
        const response = await send();
        if (response.status === 429 || response.status === 503) {
          const retryAfter = response.headers['retry-after'] as string | undefined;
          const waitTime = limiter.handleRateLimited(response.status, retryAfter);
          return { ...response, _retryAfterMs: waitTime };
        }
        return response;
      });
    }
    const response = await send();
    if (response.status === 429 || response.status === 503) {
      const retryAfter = response.headers['retry-after'] as string | undefined;
      const seconds = Number(retryAfter);
      await new Promise((resolve) => setTimeout(resolve, Number.isFinite(seconds) ? seconds * 1000 : 1000));
      return send();
    }
    return response;
  }
}

function calendarIdOf(folder: CalendarFolder): string {
  const m = /^\/calendars\/([^/]+)/.exec(folder.path);
  if (!m?.[1]) throw new Error(`Not a Graph calendar path: ${folder.path}`);
  return m[1];
}

function eventPathOf(calendarId: string, eventId: string): string {
  return `/calendars/${calendarId}/events/${eventId}`;
}

function hostnameOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return 'unknown';
  }
}

function isSeriesMaster(event: GraphEvent): boolean {
  return event.type === 'seriesMaster' || (event.type === undefined && Boolean(event.recurrence));
}

/** The last listing's ids, when the cursor is this source's and for this calendar; otherwise none. */
function readCursor(cursor: SyncCursor | undefined, folderPath: string): ListingCursor | undefined {
  if (!cursor?.value.startsWith(CURSOR_PREFIX)) return undefined;
  try {
    const parsed = JSON.parse(cursor.value.slice(CURSOR_PREFIX.length)) as Partial<ListingCursor>;
    if (parsed.folderPath !== folderPath || !Array.isArray(parsed.ids)) return undefined;
    return { folderPath, ids: parsed.ids.filter((id): id is string => typeof id === 'string') };
  } catch {
    // A cursor this cannot read claims nothing: no removal is reported from it.
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Graph JSON → VEVENT
// ---------------------------------------------------------------------------

/** One time of an event, as it will be written. */
interface EventTime {
  /** `YYYYMMDD` for a date; `YYYYMMDDTHHMMSS`, with `Z` when `zone` is absent. */
  readonly value: string;
  readonly date: boolean;
  /** The IANA zone the value is a wall clock in; absent for a date or UTC. */
  readonly zone?: string;
  /** The instant, for the item's own `start`/`end`: UTC ms; for a date, its midnight in UTC. */
  readonly instant: number;
}

/** The instant a Graph time names. Graph sends UTC unless asked otherwise; any other zone is read through its IANA name. */
function instantOf(at: GraphDateTimeTimeZone): number {
  const wall = graphWall(at.dateTime);
  if (wall === undefined) throw new Error(`A time Graph sent that does not read: ${at.dateTime}`);
  const name = at.timeZone?.trim();
  if (!name || /^(utc|etc\/utc|z)$/i.test(name)) return wall;
  const zone = ianaZoneOf(name);
  if (zone === undefined) throw new Error(`A time zone this cannot read: ${name}`);
  return instantOfWall(zone, wall);
}

/** The instant a wall clock in `zone` names (the later reading, in an hour that occurs twice). */
function instantOfWall(zone: string, wall: number): number {
  let instant = wall - offsetMinutes(zone, wall) * 60_000;
  instant = wall - offsetMinutes(zone, instant) * 60_000;
  return instant;
}

/** `YYYYMMDD` of a UTC-based wall clock. */
function dateStamp(wall: number): string {
  return new Date(wall).toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * A timed event's start or end: its instant, written as the wall clock of the
 * zone the organizer set (`originalStartTimeZone`), with that TZID. A zone
 * this cannot name in IANA terms is written in UTC: the same instant, which a
 * single event keeps exactly. (A series written in UTC keeps its UTC clock
 * across a daylight saving change, so it is the IANA name this prefers.)
 */
function timedAt(at: GraphDateTimeTimeZone, zoneName: string | undefined): EventTime {
  const instant = instantOf(at);
  const zone = ianaZoneOf(zoneName) ?? ianaZoneOf(at.timeZone);
  if (zone === undefined) return { value: `${wallStamp(instant)}Z`, date: false, instant };
  return { value: wallStamp(wallIn(zone, instant)), date: false, zone, instant };
}

/**
 * An all-day event's day. Graph keeps an all-day event at midnight, so the day
 * is the date Graph sends; a time that is not midnight (an all-day event read
 * through another zone) is moved to the organizer's zone first.
 */
function dayAt(at: GraphDateTimeTimeZone, zoneName: string | undefined): EventTime {
  const wall = graphWall(at.dateTime);
  if (wall === undefined) throw new Error(`A date Graph sent that does not read: ${at.dateTime}`);
  let day = wall;
  if (wall % DAY_MS !== 0) {
    const zone = ianaZoneOf(zoneName);
    if (zone !== undefined) day = wallIn(zone, instantOf(at));
    day = Math.round(day / DAY_MS) * DAY_MS;
  }
  return { value: dateStamp(day), date: true, instant: day };
}

function timeLine(name: string, t: EventTime): string {
  if (t.date) return `${name};VALUE=DATE:${t.value}`;
  if (t.zone) return `${name};TZID=${t.zone}:${t.value}`;
  return `${name}:${t.value}`;
}

function isoOf(t: EventTime): string {
  return new Date(t.instant).toISOString().replace('.000Z', 'Z');
}

/** `2026-09-05T06:00:00.1234567Z` → `20260905T060000Z`; undefined for anything else. */
function utcStamp(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso.replace(/(\.\d{3})\d+/, '$1'));
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** A parameter value, quoted, with what a quoted value cannot hold taken out (RFC 5545 §3.2). */
function paramValue(value: string): string {
  return `"${value.replace(/["\r\n]/g, '').trim()}"`;
}

function calAddress(property: string, params: string[], address: string): string {
  return `${[property, ...params].join(';')}:mailto:${address.trim()}`;
}

const PARTSTAT: Readonly<Record<string, string>> = {
  accepted: 'ACCEPTED',
  tentativelyAccepted: 'TENTATIVE',
  declined: 'DECLINED',
  organizer: 'ACCEPTED',
  none: 'NEEDS-ACTION',
  notResponded: 'NEEDS-ACTION',
};

function attendeeLine(a: GraphAttendee): string | undefined {
  const address = a.emailAddress?.address;
  if (!address) return undefined;
  const params: string[] = [];
  if (a.emailAddress?.name) params.push(`CN=${paramValue(a.emailAddress.name)}`);
  if (a.type === 'resource') params.push('CUTYPE=RESOURCE', 'ROLE=NON-PARTICIPANT');
  else params.push(`ROLE=${a.type === 'optional' ? 'OPT-PARTICIPANT' : 'REQ-PARTICIPANT'}`);
  params.push(`PARTSTAT=${PARTSTAT[a.status?.response ?? 'none'] ?? 'NEEDS-ACTION'}`);
  return calAddress('ATTENDEE', params, address);
}

/** RFC 5545 §3.8.1.3: Outlook's four sensitivities onto three classes. */
const CLASS_BY_SENSITIVITY: Readonly<Record<string, string>> = {
  normal: 'PUBLIC',
  personal: 'PRIVATE',
  private: 'PRIVATE',
  confidential: 'CONFIDENTIAL',
};

/** Outlook's own busy status, which it reads back from `X-MICROSOFT-CDO-BUSYSTATUS`. */
const BUSYSTATUS: Readonly<Record<string, string>> = {
  free: 'FREE',
  tentative: 'TENTATIVE',
  busy: 'BUSY',
  oof: 'OOF',
  workingElsewhere: 'WORKINGELSEWHERE',
};

function locationText(event: GraphEvent): string | undefined {
  const name = event.location?.displayName?.trim();
  const a = event.location?.address;
  const address = a
    ? [a.street, [a.postalCode, a.city].filter(Boolean).join(' '), a.state, a.countryOrRegion]
        .map((p) => p?.trim())
        .filter(Boolean)
        .join(', ')
    : '';
  if (name && address && !name.includes(address)) return `${name}, ${address}`;
  return name || address || undefined;
}

/** The times an event's own VEVENT is written with. */
interface EventTimes {
  readonly start: EventTime;
  readonly end?: EventTime;
}

function timesOf(event: GraphEvent): EventTimes {
  if (!event.start) throw new Error(`Event ${event.id} has no start`);
  if (event.isAllDay) {
    const start = dayAt(event.start, event.originalStartTimeZone);
    const end = event.end ? dayAt(event.end, event.originalEndTimeZone ?? event.originalStartTimeZone) : undefined;
    return { start, ...(end ? { end } : {}) };
  }
  const start = timedAt(event.start, event.originalStartTimeZone);
  const end = event.end ? timedAt(event.end, event.originalEndTimeZone ?? event.originalStartTimeZone) : undefined;
  return { start, ...(end ? { end } : {}) };
}

/**
 * One VEVENT's lines, from one Graph event: a single event, a series master,
 * or an exception (which carries `recurrenceId` and no RRULE). `fallback` is
 * the series master, read for what an exception leaves out.
 */
function veventLines(
  event: GraphEvent,
  uid: string,
  times: EventTimes,
  extra: { readonly rrule?: string; readonly exdates?: ReadonlyArray<string>; readonly recurrenceId?: string },
  fallback?: GraphEvent,
): string[] {
  const field = <K extends keyof GraphEvent>(k: K): GraphEvent[K] | undefined => event[k] ?? fallback?.[k];
  const stamp = utcStamp(event.lastModifiedDateTime ?? event.createdDateTime) ?? '19700101T000000Z';
  const lines: string[] = ['BEGIN:VEVENT', `UID:${escapeText(uid)}`, `DTSTAMP:${stamp}`];
  if (extra.recurrenceId) lines.push(extra.recurrenceId);
  const created = utcStamp(event.createdDateTime);
  if (created) lines.push(`CREATED:${created}`);
  const modified = utcStamp(event.lastModifiedDateTime);
  if (modified) lines.push(`LAST-MODIFIED:${modified}`);
  lines.push(timeLine('DTSTART', times.start));
  if (times.end) lines.push(timeLine('DTEND', times.end));
  if (extra.rrule) lines.push(`RRULE:${extra.rrule}`);
  for (const exdate of extra.exdates ?? []) lines.push(exdate);

  lines.push(`SUMMARY:${escapeText(field('subject')?.trim() || 'Untitled event')}`);
  const body = field('body');
  const description = body?.content ? bodyText(body.content, body.contentType) : '';
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  const location = locationText(event.location ? event : (fallback ?? event));
  if (location) lines.push(`LOCATION:${escapeText(location)}`);

  const organizer = field('organizer')?.emailAddress;
  if (organizer?.address) {
    lines.push(calAddress('ORGANIZER', organizer.name ? [`CN=${paramValue(organizer.name)}`] : [], organizer.address));
  }
  for (const a of field('attendees') ?? []) {
    const line = attendeeLine(a);
    if (line) lines.push(line);
  }

  const showAs = field('showAs');
  lines.push(`TRANSP:${showAs === 'free' ? 'TRANSPARENT' : 'OPAQUE'}`);
  if (showAs && BUSYSTATUS[showAs]) lines.push(`X-MICROSOFT-CDO-BUSYSTATUS:${BUSYSTATUS[showAs]}`);
  const sensitivity = field('sensitivity');
  if (sensitivity) lines.push(`CLASS:${CLASS_BY_SENSITIVITY[sensitivity] ?? 'PUBLIC'}`);
  lines.push(`STATUS:${event.isCancelled ? 'CANCELLED' : showAs === 'tentative' ? 'TENTATIVE' : 'CONFIRMED'}`);
  const categories = field('categories');
  if (categories && categories.length > 0) {
    lines.push(`CATEGORIES:${categories.map((c) => escapeText(c)).join(',')}`);
  }
  const minutes = field('reminderMinutesBeforeStart');
  if (field('isReminderOn') && typeof minutes === 'number' && minutes >= 0) {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:-PT${Math.round(minutes)}M`, 'DESCRIPTION:Reminder', 'END:VALARM');
  }
  lines.push('END:VEVENT');
  return lines;
}

/** `OID.{masterId}.2020-05-21` → `2020-05-21`. */
function occurrenceDate(occurrenceId: string | null | undefined): string | undefined {
  const m = /\.(\d{4}-\d{2}-\d{2})$/.exec(occurrenceId ?? '');
  return m?.[1];
}

/**
 * One occurrence of a series, by its date (`OID.….2020-05-21`), as a
 * RECURRENCE-ID or EXDATE value: the date for an all-day series, and otherwise
 * that day at the series' own start time, in the series' own zone.
 */
function occurrenceOnDate(ymd: string, start: EventTime): EventTime {
  const day = Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10));
  if (start.date) return { value: ymd.replace(/-/g, ''), date: true, instant: day };
  const clock = start.value.slice(9, 15);
  const value = `${ymd.replace(/-/g, '')}T${clock}${start.zone ? '' : 'Z'}`;
  return { value, date: false, ...(start.zone ? { zone: start.zone } : {}), instant: day };
}

/**
 * An exception's RECURRENCE-ID: the start it replaced. `originalStart` (UTC)
 * where Graph sends it, written in the series' zone; else its occurrence date.
 */
function recurrenceIdOf(exception: GraphEvent, start: EventTime): EventTime {
  if (start.date) {
    const ymd = occurrenceDate(exception.occurrenceId) ?? exception.originalStart?.slice(0, 10);
    if (!ymd) throw new Error(`Exception ${exception.id} names no occurrence`);
    return occurrenceOnDate(ymd, start);
  }
  if (exception.originalStart) {
    const instant = Date.parse(exception.originalStart.replace(/(\.\d{3})\d+/, '$1'));
    if (Number.isFinite(instant)) {
      return start.zone
        ? { value: wallStamp(wallIn(start.zone, instant)), date: false, zone: start.zone, instant }
        : { value: `${wallStamp(instant)}Z`, date: false, instant };
    }
  }
  const ymd = occurrenceDate(exception.occurrenceId);
  if (!ymd) throw new Error(`Exception ${exception.id} names no occurrence`);
  return occurrenceOnDate(ymd, start);
}

/**
 * A range's last day as UNTIL for a timed series: the end of that day in the
 * series' zone, in UTC (RFC 5545 §3.3.10: UNTIL follows DTSTART's type, and is
 * UTC when DTSTART has a TZID).
 */
function untilFor(start: EventTime, recurrenceZone: string | undefined): (endDate: string) => string | undefined {
  if (start.date) return (endDate) => (/^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate.replace(/-/g, '') : undefined);
  const zone = ianaZoneOf(recurrenceZone) ?? start.zone;
  return (endDate) => {
    const wall = graphWall(endDate);
    if (wall === undefined) return undefined;
    const endOfDay = wall + DAY_MS - 1000;
    return `${wallStamp(zone ? instantOfWall(zone, endOfDay) : endOfDay)}Z`;
  };
}

/**
 * The version of a series: the master's, and, when it has any, its
 * exceptions' and its cancellations', so a changed occurrence re-copies the
 * series. A series with neither keeps exactly the master's version, as a
 * single event does (`graphItemVersion`).
 */
function seriesVersion(master: GraphEvent, detail: GraphSeriesDetail | undefined): { readonly etag?: string } {
  const own = graphItemVersion(master);
  const exceptions = detail?.exceptionOccurrences ?? [];
  const cancelled = detail?.cancelledOccurrences ?? [];
  if (exceptions.length === 0 && cancelled.length === 0) return own;
  const parts = [
    ...exceptions.map((e) => `x:${e.id}:${graphItemVersion(e).etag ?? ''}`).sort(),
    ...cancelled.map((c) => `c:${c}`).sort(),
  ];
  const digest = createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 16);
  return { etag: `${own.etag ?? 'none'}+series:${digest}` };
}

/**
 * One Graph event — a single event, or a series with its detail — as the
 * calendar item the sync loop copies: keyed by its `iCalUId`, versioned by
 * `changeKey`, its iCalendar built here.
 *
 * Exported because the mapping IS the connector: a target receives exactly
 * these lines, and the tests that pin them are the specification.
 */
export function graphEventAsCalendarItem(
  event: GraphEvent,
  calendarId: string,
  series?: GraphSeriesDetail,
): RawCalendarEvent {
  const uid = event.iCalUId?.trim() || event.id;
  const times = timesOf(event);
  const vevents: string[][] = [];

  if (series !== undefined || isSeriesMaster(event)) {
    const rrule = recurrenceToRrule(
      event.recurrence?.pattern,
      event.recurrence?.range,
      untilFor(times.start, event.recurrence?.range?.recurrenceTimeZone),
    );
    // A series whose pattern this cannot write is not written as its first
    // occurrence alone: that would be a different event, quietly.
    if (rrule === undefined) throw new Error(`Series ${event.id} has a recurrence this cannot write`);
    const exdates = (series?.cancelledOccurrences ?? [])
      .map(occurrenceDate)
      .filter((d): d is string => d !== undefined)
      .sort()
      .map((ymd) => timeLine('EXDATE', occurrenceOnDate(ymd, times.start)));
    vevents.push(veventLines(event, uid, times, { rrule, exdates }));
    for (const exception of series?.exceptionOccurrences ?? []) {
      const exceptionTimes = timesOf({
        ...exception,
        isAllDay: exception.isAllDay ?? event.isAllDay,
        originalStartTimeZone: exception.originalStartTimeZone ?? event.originalStartTimeZone,
        originalEndTimeZone: exception.originalEndTimeZone ?? event.originalEndTimeZone,
      });
      const recurrenceId = timeLine('RECURRENCE-ID', recurrenceIdOf(exception, times.start));
      vevents.push(veventLines(exception, uid, exceptionTimes, { recurrenceId }, event));
    }
  } else {
    vevents.push(veventLines(event, uid, times, {}));
  }

  // A VTIMEZONE for every zone a time is written in (RFC 5545 §3.6.5).
  const zones = new Map<string, number>();
  for (const line of vevents.flat()) {
    const m = /^[A-Z-]+;TZID=([^:;]+):(\d{4})/.exec(line);
    if (m && !zones.has(m[1]!)) zones.set(m[1]!, Number(m[2]));
  }
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ownpace//Microsoft Outlook calendar//EN',
    ...[...zones].flatMap(([zone, year]) => vtimezoneLines(zone, year)),
    ...vevents.flat(),
    'END:VCALENDAR',
  ];
  const icalendar = lines.map(fold).join('\r\n') + '\r\n';
  const location = locationText(event);
  const body = event.body?.content ? bodyText(event.body.content, event.body.contentType) : '';

  return {
    item: {
      uid,
      type: 'event',
      summary: event.subject?.trim() || 'Untitled event',
      start: isoOf(times.start),
      ...(times.end ? { end: isoOf(times.end) } : {}),
      ...(event.isAllDay ? { isAllDay: true } : {}),
      ...(times.start.zone ? { timezone: times.start.zone } : {}),
      ...(body ? { description: body } : {}),
      ...(location ? { location } : {}),
      // The version an edit is detected by (`graphItemVersion`).
      ...seriesVersion(event, series),
      sourcePath: eventPathOf(calendarId, event.id),
      icalendar,
    },
    icalendar,
  };
}

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
      return { status: response.status, body, headers };
    },
  };
}
