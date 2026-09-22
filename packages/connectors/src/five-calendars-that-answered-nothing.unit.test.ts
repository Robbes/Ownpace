// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * FIVE CALENDARS THAT ANSWERED NOTHING (live 2026-09-12).
 *
 * Mapping `0cc9a844`, Google → Nextcloud. `listFolders()` found five Google
 * calendars and named them correctly; `ensureCalendar()` created all five on
 * the target — `occ dav:list-calendars` shows `owner@example.invalid`,
 * `Family`, `iCloud_`, `Cottage` and `Shared team` sitting there. And the
 * run log said:
 *
 *   calendar: 0 created, 0 skipped — 5 collection(s) listed and NOT ONE ITEM
 *   scanned in any of them.
 *
 * Nothing threw. `errors: 0`, `last_error` empty, state `completed`. Since a
 * non-207 threw at the old call site, every REPORT must have come back 207
 * carrying no calendar objects.
 *
 * ## The asymmetry that named the bug
 *
 * On that same pass, over the same Google account and the same token, contacts
 * read **1,227 cards**. `CarddavSource` falls back to an `addressbook-query`
 * when `sync-collection` does not answer; `CalDAVSource` had the same promise
 * in its file header — "CTag fallback when sync-token not supported" — and no
 * code behind it. One source recovered and the other reported an empty
 * account, and that difference is the whole defect.
 *
 * ## What is asserted
 *
 * RFC 6578 `sync-collection` is an optimisation. RFC 4791 §7.8
 * `calendar-query` is the enumeration every CalDAV server must support. So:
 *
 *  - a 207 that carries nothing, **on a read that sent no sync token**, is not taken as
 *    "this calendar is empty" — it is checked;
 *  - a 207 that carries nothing **after a sync token was sent** IS taken at face value,
 *    because that is what an incremental read is FOR and re-listing an
 *    unchanged account on every pass would be a bill for nothing;
 *  - a non-207 falls back rather than failing the domain;
 *  - the fallback names exactly one component, and carries the filter RFC 4791
 *    §9.5 does not make optional.
 */

import { describe, it, expect, vi } from 'vitest';
import { CalDAVSource } from './caldav-source.ts';
import { CarddavSource } from './carddav-source.ts';
import type { CalDAVSourceConfig } from './caldav-source.types.ts';
import type { HttpClient, HttpRequestOptions, HttpResponse } from './dav-http.types.ts';
import type { CalendarFolder, SyncCursor } from '@openmig/shared';

const CONFIG: CalDAVSourceConfig = {
  url: 'https://apidata.googleusercontent.com/caldav/v2/',
  username: 'owner@example.invalid',
  password: 'app-password',
};

const FOLDER: CalendarFolder = {
  name: 'Family',
  path: '/caldav/v2/family@group.calendar.google.com/events/',
};

/** A 207 with a sync-token and not one calendar object — what Google sent. */
const EMPTY_SYNC_207: HttpResponse = {
  status: 207,
  body: `<?xml version="1.0" encoding="utf-8"?>
    <D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
      <D:sync-token>https://apidata.googleusercontent.com/caldav/v2/tok/42</D:sync-token>
    </D:multistatus>`,
  headers: {},
};

const oneEvent = (uid: string): string =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTART:20260101T100000Z',
    'SUMMARY:Verjaardag',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

const queryAnswerWith = (uids: readonly string[]): HttpResponse => ({
  status: 207,
  body: `<?xml version="1.0" encoding="utf-8"?>
    <D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
      ${uids
        .map(
          (uid) => `<D:response>
        <D:href>/caldav/v2/family/events/${uid}.ics</D:href>
        <D:propstat><D:prop>
          <D:getetag>"etag-${uid}"</D:getetag>
          <C:calendar-data>${oneEvent(uid)}</C:calendar-data>
        </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
      </D:response>`,
        )
        .join('\n')}
    </D:multistatus>`,
  headers: {},
});

interface Asked {
  readonly method: string;
  readonly body: string;
  readonly depth?: string;
}

/**
 * Answers the sync-collection REPORT with `first`, and any calendar-query with
 * `then`. Records every request so the fallback's own document can be read.
 */
function davServer(first: HttpResponse, then: HttpResponse): {
  client: HttpClient;
  asked: Asked[];
} {
  const asked: Asked[] = [];
  const client: HttpClient = {
    request: vi.fn(async (options: HttpRequestOptions): Promise<HttpResponse> => {
      const body = String(options.body ?? '');
      asked.push({
        method: options.method,
        body,
        ...(options.headers?.Depth ? { depth: options.headers.Depth } : {}),
      });
      if (body.includes('calendar-query')) return then;
      return first;
    }),
  };
  return { client, asked };
}

const sourceOn = (client: HttpClient, component?: 'VEVENT' | 'VTODO'): CalDAVSource =>
  new CalDAVSource(
    { ...CONFIG, ...(component ? { component } : {}) },
    { httpClient: client },
  );

/** The home set is already known, so the test drives `listSince` directly. */
function withHomeSet(source: CalDAVSource): CalDAVSource {
  (source as unknown as { calendarHomeSet: string }).calendarHomeSet = '/caldav/v2/';
  return source;
}

describe('a 207 carrying nothing is not proof a calendar is empty', () => {
  it('falls back to calendar-query on a FIRST read that answered nothing', async () => {
    const { client, asked } = davServer(EMPTY_SYNC_207, queryAnswerWith(['a', 'b', 'c']));

    const result = await withHomeSet(sourceOn(client)).listSince(FOLDER, undefined);

    // THE LIVE BUG: this was three items reported as zero.
    expect(result.items).toHaveLength(3);
    const queries = asked.filter((a) => a.body.includes('calendar-query'));
    expect(queries, 'no calendar-query was ever sent').toHaveLength(1);
  });

  it('takes an empty answer at face value WHEN A CURSOR WAS GIVEN', async () => {
    // An incremental read answering "nothing changed" is the common case and
    // the whole point of a cursor. Re-listing the account every pass to
    // confirm it would be a bill for nothing.
    const { client, asked } = davServer(EMPTY_SYNC_207, queryAnswerWith(['a']));
    const cursor: SyncCursor = { value: 'sync-token:https://example/tok/41' };

    const result = await withHomeSet(sourceOn(client)).listSince(FOLDER, cursor);

    expect(result.items).toHaveLength(0);
    expect(asked.filter((a) => a.body.includes('calendar-query'))).toHaveLength(0);
  });

  it('falls back when the server refuses the report outright', async () => {
    // Sabre answers `ReportNotSupported`; the old code threw and failed the
    // whole domain over an optional optimisation.
    const refused: HttpResponse = {
      status: 403,
      body: '<D:error xmlns:D="DAV:"><D:supported-report/></D:error>',
      headers: {},
    };
    const { client } = davServer(refused, queryAnswerWith(['a', 'b']));

    const result = await withHomeSet(sourceOn(client)).listSince(FOLDER, undefined);

    expect(result.items).toHaveLength(2);
  });

  it('reports a genuinely empty calendar as empty, without throwing', async () => {
    const { client, asked } = davServer(EMPTY_SYNC_207, queryAnswerWith([]));

    const result = await withHomeSet(sourceOn(client)).listSince(FOLDER, undefined);

    // It asked, and the answer really was nothing. That is a fact now, not an
    // assumption — and the difference is the whole point.
    expect(result.items).toHaveLength(0);
    expect(asked.filter((a) => a.body.includes('calendar-query'))).toHaveLength(1);
  });

  it('does not fall back when the sync-collection DID answer', async () => {
    const answered = queryAnswerWith(['x']);
    const { client, asked } = davServer(answered, queryAnswerWith(['a', 'b', 'c']));

    const result = await withHomeSet(sourceOn(client)).listSince(FOLDER, undefined);

    expect(result.items).toHaveLength(1);
    expect(asked.filter((a) => a.body.includes('calendar-query'))).toHaveLength(0);
  });
});

describe('the fallback asks a question the server can answer', () => {
  const documentOf = async (component?: 'VEVENT' | 'VTODO'): Promise<Asked> => {
    const { client, asked } = davServer(EMPTY_SYNC_207, queryAnswerWith(['a']));
    await withHomeSet(sourceOn(client, component)).listSince(FOLDER, undefined);
    const query = asked.find((a) => a.body.includes('calendar-query'));
    expect(query, 'no calendar-query was sent').toBeDefined();
    return query!;
  };

  it('carries the filter RFC 4791 §9.5 does not make optional', async () => {
    // The CardDAV sibling shipped without one and Google answered
    // `400 … Request contains an invalid argument`.
    const query = await documentOf();
    expect(query.body).toContain('<C:filter>');
    expect(query.body).toContain('</C:filter>');
  });

  it('names exactly ONE component — siblings are a conjunction, not a union', async () => {
    // RFC 4791 §9.7.1. Asking for VEVENT and VTODO together describes a
    // VCALENDAR containing both, which is no object anybody has. Sabre indexes
    // on the first child and so appears to work, which is how this hid for
    // four domains until the task domain met a real server.
    const query = await documentOf();
    const components = [...query.body.matchAll(/comp-filter name="(\w+)"/g)].map((m) => m[1]);
    expect(components).toEqual(['VCALENDAR', 'VEVENT']);
  });

  it('asks for the task component when this source carries tasks', async () => {
    const query = await documentOf('VTODO');
    const components = [...query.body.matchAll(/comp-filter name="(\w+)"/g)].map((m) => m[1]);
    expect(components).toEqual(['VCALENDAR', 'VTODO']);
  });

  it('asks for the event bodies, not just their UIDs', async () => {
    // This is the read the sync loop COPIES from, unlike the target writer's
    // sibling query, which is only enumerating.
    const query = await documentOf();
    expect(query.body).toContain('<C:calendar-data/>');
    expect(query.body).not.toContain('<C:prop name="UID"/>');
  });

  it('sends Depth: 1, so the collection is listed rather than fetched', async () => {
    expect((await documentOf()).depth).toBe('1');
  });
});

/**
 * THE PASS AFTER THE FALLBACK — the one read this file never made.
 *
 * Every read above is tested alone. The first read falls back; a real token is
 * trusted; the fallback hands back an empty cursor. All true, and all green,
 * while the owner's calendar stopped receiving changes for good — because the
 * one thing never done here is to take the cursor a pass RETURNED and hand it
 * to the next pass, which is the only thing production ever does with one.
 *
 * That empty cursor decodes to no position, so the second pass sends
 * `<D:sync-token/>` — a first read in every respect — and Google answers it as
 * it answered the first. The guard asked whether a CURSOR had been passed, not
 * whether a TOKEN had been sent, so it stood down: the empty answer was taken
 * as "nothing changed" and Google's token was stored. Live on 2026-09-22: an
 * event moved a week in Google, two passes since, both advancing the token,
 * the copy on the target untouched.
 */
describe('the pass AFTER the fallback', () => {
  it('re-lists again, because the cursor it was handed holds no position', async () => {
    const { client } = davServer(EMPTY_SYNC_207, queryAnswerWith(['a', 'b', 'c']));
    const source = withHomeSet(sourceOn(client));

    const first = await source.listSince(FOLDER, undefined);
    const second = await source.listSince(FOLDER, first.nextCursor);
    const third = await source.listSince(FOLDER, second.nextCursor);

    expect(first.items).toHaveLength(3);
    expect(second.items, 'the second pass trusted an empty answer and saw nothing').toHaveLength(3);
    expect(third.items, 'and it never recovers once the token is stored').toHaveLength(3);
  });

  it('never trades the empty cursor for the token of an answer it did not believe', async () => {
    // The token came with an answer this code had already decided was wrong.
    // Storing it is what turns a single bad read into every read after it.
    const { client } = davServer(EMPTY_SYNC_207, queryAnswerWith(['a']));
    const source = withHomeSet(sourceOn(client));

    const first = await source.listSince(FOLDER, undefined);
    const second = await source.listSince(FOLDER, first.nextCursor);

    expect(second.nextCursor.value).toBe('');
  });

  it('carries an edit made after the first copy — the owner\'s moved event', async () => {
    // Pass one copies the event as it stands. The owner then moves it in
    // Google, which gives it a new etag. Pass two must hand that etag up, or
    // the ledger has nothing to compare and the move never reaches the target.
    let etag = '"63925766695"';
    const client: HttpClient = {
      request: vi.fn(async (options: HttpRequestOptions): Promise<HttpResponse> => {
        if (!String(options.body ?? '').includes('calendar-query')) return EMPTY_SYNC_207;
        return {
          status: 207,
          headers: {},
          body: `<?xml version="1.0" encoding="utf-8"?>
            <D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
              <D:response>
                <D:href>/caldav/v2/family/events/moved.ics</D:href>
                <D:propstat><D:prop>
                  <D:getetag>${etag}</D:getetag>
                  <C:calendar-data>${oneEvent('moved')}</C:calendar-data>
                </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
              </D:response>
            </D:multistatus>`,
        };
      }),
    };
    const source = withHomeSet(sourceOn(client));

    const first = await source.listSince(FOLDER, undefined);
    etag = '"63925790000"';
    const second = await source.listSince(FOLDER, first.nextCursor);

    expect(first.items[0]?.item.etag).toBe('"63925766695"');
    expect(second.items[0]?.item.etag, 'the edit never reached the ledger').toBe('"63925790000"');
  });

  it('treats a ctag cursor as the full read it is', async () => {
    // A ctag cannot be sent as "changes since", so a ctag cursor sends no token
    // and asks for everything. An empty answer to that is the same claim as an
    // empty first read, and gets the same check.
    const { client } = davServer(EMPTY_SYNC_207, queryAnswerWith(['a', 'b']));
    const cursor: SyncCursor = { value: 'ctag:/caldav/v2/family/events/:ctag-1' };

    const result = await withHomeSet(sourceOn(client)).listSince(FOLDER, cursor);

    expect(result.items).toHaveLength(2);
  });
});

describe('what the fallback does NOT claim', () => {
  it('returns no cursor, so nothing records an incremental position it never had', async () => {
    const { client } = davServer(EMPTY_SYNC_207, queryAnswerWith(['a', 'b']));

    const result = await withHomeSet(sourceOn(client)).listSince(FOLDER, undefined);

    // `calendar-query` answers "everything that matches" — there is no token
    // to resume from. ADR-0020 makes cursors non-authoritative, so the cost is
    // a full, still-idempotent re-list each pass.
    expect(result.nextCursor.value).toBe('');
  });

  it('reports no removals, because this report cannot see one', async () => {
    // A deleted event is simply absent from a calendar-query answer. Calling
    // that a removal report would turn "I cannot see it" into "the server told
    // me it is gone" — the absence-counting path's job, not this one's.
    const { client } = davServer(EMPTY_SYNC_207, queryAnswerWith(['a']));

    const result = await withHomeSet(sourceOn(client)).listSince(FOLDER, undefined);

    expect(result.removed ?? []).toEqual([]);
  });
});

/**
 * THE SAME RULE ON THE SIBLING, because the evidence says it needs it too.
 *
 * `CarddavSource` already fell back when the report was REFUSED — that is what
 * saved the contacts domain on 2026-09-12. But it took a 207 carrying no cards
 * at face value, exactly as CalDAV did, and the same run shows the cost: the
 * FIRST pass read `contact: 0 created, 0 skipped`, and the second, fifteen
 * seconds later, read 1,227 cards from the same account over the same token.
 * Nothing was repaired in between.
 *
 * That domain only recovered because #926's cursor invariant refused to store
 * a token over an empty first read, so the next pass started again. A migration
 * whose owner read the first report and believed it would have cut over with
 * an empty address book.
 */
describe('the CardDAV sibling holds the same line', () => {
  const CARD_CONFIG = {
    url: 'https://www.googleapis.com/carddav/v1/',
    username: 'owner@example.invalid',
    password: 'app-password',
  };

  const EMPTY_207: HttpResponse = {
    status: 207,
    body: `<?xml version="1.0" encoding="utf-8"?>
      <D:multistatus xmlns:D="DAV:" xmlns:A="urn:ietf:params:xml:ns:carddav">
        <D:sync-token>https://www.googleapis.com/carddav/v1/tok/7</D:sync-token>
      </D:multistatus>`,
    headers: {},
  };

  const cardsAnswer = (uids: readonly string[]): HttpResponse => ({
    status: 207,
    body: `<?xml version="1.0" encoding="utf-8"?>
      <D:multistatus xmlns:D="DAV:" xmlns:A="urn:ietf:params:xml:ns:carddav">
        ${uids
          .map(
            (uid) => `<D:response>
          <D:href>/carddav/v1/.../${uid}.vcf</D:href>
          <D:propstat><D:prop>
            <D:getetag>"e-${uid}"</D:getetag>
            <A:address-data>BEGIN:VCARD${'\r\n'}VERSION:3.0${'\r\n'}UID:${uid}${'\r\n'}FN:Someone${'\r\n'}END:VCARD</A:address-data>
          </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
        </D:response>`,
          )
          .join('\n')}
      </D:multistatus>`,
    headers: {},
  });

  const server = (first: HttpResponse, then: HttpResponse) => {
    const asked: string[] = [];
    const client: HttpClient = {
      request: vi.fn(async (options: HttpRequestOptions): Promise<HttpResponse> => {
        const body = String(options.body ?? '');
        asked.push(body);
        return body.includes('addressbook-query') ? then : first;
      }),
    };
    return { client, asked };
  };

  it('checks a FIRST 207 that carried no cards, instead of believing it', async () => {
    const { client, asked } = server(EMPTY_207, cardsAnswer(['a', 'b', 'c']));
    const source = new CarddavSource(CARD_CONFIG, { httpClient: client });
    (source as unknown as { addressBookHomeSet: string }).addressBookHomeSet = '/carddav/v1/';

    const result = await source.listSince({ path: '/carddav/v1/lists/default/' }, undefined);

    expect(result.items).toHaveLength(3);
    expect(asked.filter((b) => b.includes('addressbook-query'))).toHaveLength(1);
  });

  it('checks again on the pass AFTER the fallback, whose cursor holds no token', async () => {
    // Google's address books happen to answer with cards and no token, which
    // is why the owner's contacts never hit this. A server that answers the
    // way Google's CALENDARS do would, and the guard was the same line.
    const { client } = server(EMPTY_207, cardsAnswer(['a', 'b', 'c']));
    const source = new CarddavSource(CARD_CONFIG, { httpClient: client });
    (source as unknown as { addressBookHomeSet: string }).addressBookHomeSet = '/carddav/v1/';
    const book = { path: '/carddav/v1/lists/default/' };

    const first = await source.listSince(book, undefined);
    const second = await source.listSince(book, first.nextCursor);

    expect(second.items).toHaveLength(3);
    expect(second.nextCursor.value).toBe('');
  });

  it('still believes an empty answer when a cursor asked for changes only', async () => {
    const { client, asked } = server(EMPTY_207, cardsAnswer(['a']));
    const source = new CarddavSource(CARD_CONFIG, { httpClient: client });
    (source as unknown as { addressBookHomeSet: string }).addressBookHomeSet = '/carddav/v1/';

    const result = await source.listSince(
      { path: '/carddav/v1/lists/default/' },
      { value: 'sync-token:https://example/tok/6' },
    );

    expect(result.items).toHaveLength(0);
    expect(asked.filter((b) => b.includes('addressbook-query'))).toHaveLength(0);
  });
});
