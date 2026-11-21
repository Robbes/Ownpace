// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CALDAV SERVER THAT ANSWERS `sync-collection` AS GOOGLE DID (workplan
 * 0164 T1, measured on 2026-11-21 on the owner's test migration).
 *
 * What T1 measured, counts only, and what this server does in its place:
 *
 * - **Every answer was a 207 with a sync token and NO calendar data.** A
 *   member is its href and ETag, and its `calendar-data` comes back as a 404
 *   inside a propstat (`calendar-data-404`, the default shape, or
 *   `calendar-data-404-first`, that propstat before the one with the ETag),
 *   or not at all (`etag-only`), or the member is an href and a 200
 *   (`status-200`).
 * - **It pages.** 15 pages for 3,627 members: a page holds `pageSize`
 *   entries, and a page with more after it carries a `<response>` for the
 *   calendar itself with a 507 and a token to go on with (RFC 6578 §3.6).
 * - **A reading with no token lists removals too**, 404 members Google still
 *   remembers (3, 5 and 7 in three calendars). Here: every href removed in
 *   this calendar's log, and the removals made before it (`rememberRemoval`).
 * - **A reading with a token lists what changed after it**, changed members
 *   as above and removed ones as a 404.
 *
 * Its tokens are positions in each calendar's own change log, so a reading
 * with a token names exactly what changed after it, and nothing in them is
 * an address or a time. `calendar-multiget` and `calendar-query` answer with
 * the data. Anything else it is sent is answered 400 and recorded, so a
 * request the reader should not make fails the test that made it.
 *
 * Every href and name here is a fixture: example.com, and events named
 * "Event 1" and so on.
 */

import type { HttpClient, HttpRequestOptions, HttpResponse } from '../dav-http.types.ts';

/** Where the fake serves. Nothing keys on it: the reader is server-agnostic. */
export const FAKE_CALDAV_URL = 'https://calendar.example.com/caldav/v2/';
/** The calendar home the calendars are listed under. */
export const FAKE_HOME = '/caldav/v2/owner%40example.com/';

/** How a member is written when its data is left out. */
export type MemberShape = 'calendar-data-404' | 'calendar-data-404-first' | 'etag-only' | 'status-200';

/** One request, as a test reads it. */
export interface Asked {
  readonly kind: 'propfind' | 'sync-collection' | 'calendar-multiget' | 'calendar-query' | 'unknown';
  /** The calendar's path, for a REPORT. */
  readonly calendar?: string;
  /** For a sync-collection: the token sent, `''` for none. */
  readonly token?: string;
  /** For a calendar-multiget: how many hrefs it named. */
  readonly hrefs?: number;
  readonly depth?: string;
}

interface FakeEvent {
  readonly uid: string;
  readonly etag: string;
  readonly summary: string;
}

interface Entry {
  readonly href: string;
  readonly gone: boolean;
}

class FakeCalendar {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly events = new Map<string, FakeEvent>();
  /** Every href that changed, in order; a token is a position in this log. */
  readonly log: string[] = [];
  /** Hrefs removed before the log began, which a reading with no token still lists. */
  readonly remembered: string[] = [];
  constructor(id: string, path: string, name: string) {
    this.id = id;
    this.path = path;
    this.name = name;
  }
}

const XML_HEAD =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<D:multistatus xmlns:D="DAV:" xmlns:caldav="urn:ietf:params:xml:ns:caldav">';

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const multistatus = (parts: readonly string[], token?: string): HttpResponse => ({
  status: 207,
  headers: {},
  body:
    `${XML_HEAD}\n${parts.join('\n')}\n` +
    `${token !== undefined ? `<D:sync-token>${escapeXml(token)}</D:sync-token>\n` : ''}</D:multistatus>`,
});

const refusedToken = (): HttpResponse => ({
  status: 403,
  headers: {},
  body: '<?xml version="1.0" encoding="UTF-8"?>\n<D:error xmlns:D="DAV:"><D:valid-sync-token/></D:error>',
});

export function icalendarOf(uid: string, summary: string): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Fixture//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTART:20261201T100000Z',
    'DTEND:20261201T110000Z',
    `SUMMARY:${summary}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

export class GoogleLikeCalDav {
  /** Entries per page; Google's held about 250. */
  pageSize = 250;
  shape: MemberShape = 'calendar-data-404';
  /** Every request, in order. */
  readonly asked: Asked[] = [];
  /** Tokens it no longer takes: a reading sent one is refused (RFC 6578 §3.2). */
  readonly refusedTokens = new Set<string>();
  /**
   * Asked before each calendar-multiget is answered, numbered from 0 across
   * the server's life; a response returned is sent in place of the data.
   */
  onMultiget?: (index: number, hrefs: readonly string[]) => HttpResponse | undefined;
  /** Hrefs a calendar-multiget leaves out of its answer, as though never asked. */
  readonly multigetLeavesOut = new Set<string>();
  /**
   * How a calendar-multiget spells the hrefs it answers for: as it was asked
   * (`same`), or as an absolute URL with its escapes undone (`absolute`),
   * which a server may do and which must still match what it was asked.
   */
  multigetSpelling: 'same' | 'absolute' = 'same';

  private readonly calendars = new Map<string, FakeCalendar>();
  private readonly readings = new Map<string, { readonly entries: readonly Entry[]; readonly final: string }>();
  private readingSeq = 0;
  private multigets = 0;
  private etagSeq = 63925766000;

  /** The client the source is given. */
  readonly client: HttpClient = {
    request: (options) => Promise.resolve(this.answer(options)),
  };

  /** A calendar, by a short id; its path is Google's shape, `/caldav/v2/<id>%40example.com/events/`. */
  addCalendar(id: string, name: string): string {
    const path = `/caldav/v2/${id}%40example.com/events/`;
    this.calendars.set(path, new FakeCalendar(id, path, name));
    return path;
  }

  /** The href an event of a calendar has. */
  hrefOf(calendarPath: string, uid: string): string {
    return `${calendarPath}${uid}.ics`;
  }

  add(calendarPath: string, uid: string, summary = `Event ${uid}`): string {
    const calendar = this.calendarAt(calendarPath);
    const href = this.hrefOf(calendarPath, uid);
    calendar.events.set(href, { uid, etag: this.nextEtag(), summary });
    calendar.log.push(href);
    return href;
  }

  change(calendarPath: string, uid: string, summary: string): void {
    const calendar = this.calendarAt(calendarPath);
    const href = this.hrefOf(calendarPath, uid);
    if (!calendar.events.has(href)) throw new Error(`no event ${uid} to change`);
    calendar.events.set(href, { uid, etag: this.nextEtag(), summary });
    calendar.log.push(href);
  }

  remove(calendarPath: string, uid: string): string {
    const calendar = this.calendarAt(calendarPath);
    const href = this.hrefOf(calendarPath, uid);
    if (!calendar.events.delete(href)) throw new Error(`no event ${uid} to remove`);
    calendar.log.push(href);
    return href;
  }

  /** A removal from before the log began: listed by a reading with no token, never by one with a token. */
  rememberRemoval(calendarPath: string, uid: string): string {
    const href = this.hrefOf(calendarPath, uid);
    this.calendarAt(calendarPath).remembered.push(href);
    return href;
  }

  /** Google's move between calendars: gone from one (a 404 there), new in the other under its own href. */
  move(uid: string, from: string, to: string): void {
    const event = this.calendarAt(from).events.get(this.hrefOf(from, uid));
    if (event === undefined) throw new Error(`no event ${uid} to move`);
    this.remove(from, uid);
    this.add(to, uid, event.summary);
  }

  /** What was asked of one kind, in order. */
  askedOf(kind: Asked['kind'], calendar?: string): Asked[] {
    return this.asked.filter((a) => a.kind === kind && (calendar === undefined || a.calendar === calendar));
  }

  private nextEtag(): string {
    this.etagSeq += 1;
    return `"${this.etagSeq}"`;
  }

  private calendarAt(path: string): FakeCalendar {
    const calendar = this.calendars.get(path);
    if (calendar === undefined) throw new Error(`no calendar at ${path}`);
    return calendar;
  }

  private answer(options: HttpRequestOptions): HttpResponse {
    const path = new URL(options.url).pathname;
    const body = typeof options.body === 'string' ? options.body : '';
    const depth = options.headers?.Depth;
    if (options.method === 'PROPFIND' && path === FAKE_HOME && depth === '1') {
      this.asked.push({ kind: 'propfind', depth });
      return this.listCalendars();
    }
    const calendar = this.calendars.get(path);
    if (options.method === 'REPORT' && calendar !== undefined) {
      if (body.includes('sync-collection')) return this.syncCollection(calendar, body);
      if (body.includes('calendar-multiget')) return this.multiget(calendar, body, depth);
      if (body.includes('calendar-query')) {
        this.asked.push({ kind: 'calendar-query', calendar: calendar.path, ...(depth ? { depth } : {}) });
        return multistatus([...calendar.events].map(([href, event]) => this.withData(href, event)));
      }
    }
    this.asked.push({ kind: 'unknown', ...(depth ? { depth } : {}) });
    return { status: 400, headers: {}, body: 'not a request this fake answers' };
  }

  private listCalendars(): HttpResponse {
    const home =
      `<D:response><D:href>${FAKE_HOME}</D:href><D:propstat><D:prop>` +
      '<D:resourcetype><D:collection/></D:resourcetype></D:prop>' +
      '<D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>';
    const calendars = [...this.calendars.values()].map(
      (c) =>
        `<D:response><D:href>${c.path}</D:href><D:propstat><D:prop>` +
        `<D:displayname>${escapeXml(c.name)}</D:displayname>` +
        '<D:resourcetype><D:collection/><caldav:calendar/></D:resourcetype>' +
        '<caldav:supported-calendar-component-set><caldav:comp name="VEVENT"/></caldav:supported-calendar-component-set>' +
        '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>',
    );
    return multistatus([home, ...calendars]);
  }

  private syncCollection(calendar: FakeCalendar, body: string): HttpResponse {
    const token = decodeXml(/<D:sync-token>([^<]*)<\/D:sync-token>/.exec(body)?.[1] ?? '').trim();
    this.asked.push({ kind: 'sync-collection', calendar: calendar.path, token });
    if (this.refusedTokens.has(token)) return refusedToken();

    let reading: { readonly entries: readonly Entry[]; readonly final: string };
    let offset = 0;
    const ownPrefix = `tok:${calendar.id}:`;
    if (token.startsWith('page:')) {
      const [, id, at] = token.split(':');
      const known = id === undefined ? undefined : this.readings.get(id);
      if (known === undefined || at === undefined) return refusedToken();
      reading = known;
      offset = Number(at);
    } else if (token === '') {
      // Every member there is, then every removal it remembers.
      const gone = new Set([...calendar.remembered, ...calendar.log.filter((h) => !calendar.events.has(h))]);
      reading = {
        entries: [
          ...[...calendar.events.keys()].map((href) => ({ href, gone: false })),
          ...[...gone].map((href) => ({ href, gone: true })),
        ],
        final: `${ownPrefix}${calendar.log.length}`,
      };
    } else if (token.startsWith(ownPrefix)) {
      const since = Number(token.slice(ownPrefix.length));
      const changed = [...new Set(calendar.log.slice(since).reverse())].reverse();
      reading = {
        entries: changed.map((href) => ({ href, gone: !calendar.events.has(href) })),
        final: `${ownPrefix}${calendar.log.length}`,
      };
    } else {
      // A token it never gave.
      return refusedToken();
    }

    const page = reading.entries.slice(offset, offset + this.pageSize);
    const more = offset + this.pageSize < reading.entries.length;
    let next = reading.final;
    if (more) {
      const id = String((this.readingSeq += 1));
      this.readings.set(id, reading);
      next = `page:${id}:${offset + this.pageSize}`;
    }
    const parts = page.map((entry) => {
      if (entry.gone) {
        return `<D:response><D:href>${entry.href}</D:href><D:status>HTTP/1.1 404 Not Found</D:status></D:response>`;
      }
      const event = calendar.events.get(entry.href);
      return this.withoutData(entry.href, event?.etag ?? '"0"');
    });
    if (more) {
      parts.push(
        `<D:response><D:href>${calendar.path}</D:href>` +
          '<D:status>HTTP/1.1 507 Insufficient Storage</D:status></D:response>',
      );
    }
    return multistatus(parts, next);
  }

  private multiget(calendar: FakeCalendar, body: string, depth: string | undefined): HttpResponse {
    const hrefs = [...body.matchAll(/<D:href>([^<]*)<\/D:href>/g)].map((m) => decodeXml(m[1] ?? '').trim());
    const index = this.multigets;
    this.multigets += 1;
    this.asked.push({ kind: 'calendar-multiget', calendar: calendar.path, hrefs: hrefs.length, ...(depth ? { depth } : {}) });
    const instead = this.onMultiget?.(index, hrefs);
    if (instead !== undefined) return instead;
    const parts = hrefs
      .filter((href) => !this.multigetLeavesOut.has(href))
      .map((href) => {
        const event = calendar.events.get(href);
        const spelled =
          this.multigetSpelling === 'absolute' ? `${new URL(FAKE_CALDAV_URL).origin}${decodeURIComponent(href)}` : href;
        return event === undefined
          ? `<D:response><D:href>${spelled}</D:href><D:status>HTTP/1.1 404 Not Found</D:status></D:response>`
          : this.withData(spelled, event);
      });
    return multistatus(parts);
  }

  private withData(href: string, event: FakeEvent): string {
    return (
      `<D:response><D:href>${href}</D:href><D:propstat><D:prop>` +
      `<D:getetag>${event.etag}</D:getetag>` +
      `<caldav:calendar-data>${escapeXml(icalendarOf(event.uid, event.summary))}</caldav:calendar-data>` +
      '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>'
    );
  }

  private withoutData(href: string, etag: string): string {
    switch (this.shape) {
      case 'status-200':
        return `<D:response><D:href>${href}</D:href><D:status>HTTP/1.1 200 OK</D:status></D:response>`;
      case 'etag-only':
        return (
          `<D:response><D:href>${href}</D:href><D:propstat><D:prop><D:getetag>${etag}</D:getetag>` +
          '<D:resourcetype/></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>'
        );
      case 'calendar-data-404-first':
        return (
          `<D:response><D:href>${href}</D:href>` +
          '<D:propstat><D:prop><caldav:calendar-data/></D:prop>' +
          '<D:status>HTTP/1.1 404 Not Found</D:status></D:propstat>' +
          `<D:propstat><D:prop><D:getetag>${etag}</D:getetag><D:resourcetype/></D:prop>` +
          '<D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>'
        );
      case 'calendar-data-404':
        return (
          `<D:response><D:href>${href}</D:href>` +
          `<D:propstat><D:prop><D:getetag>${etag}</D:getetag><D:resourcetype/></D:prop>` +
          '<D:status>HTTP/1.1 200 OK</D:status></D:propstat>' +
          '<D:propstat><D:prop><caldav:calendar-data/></D:prop>' +
          '<D:status>HTTP/1.1 404 Not Found</D:status></D:propstat></D:response>'
        );
    }
  }
}
