// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT GOOGLE ANSWERS TO `sync-collection`, against a Google made of a fake
 * `fetch` and a database made of a fake pool (workplan 0164 T1).
 *
 * Held here, each by a test that fails when it breaks:
 *
 *  - **the method guard**: nothing but PROPFIND and REPORT reaches Google's
 *    calendars, refused before `fetch` is called, and nothing reaches another
 *    host, a redirect included; in a whole run the one other request is the
 *    sign-in's POST to Google's token endpoint;
 *  - **the output guard**: a line carrying an href, an address, a title, a
 *    token or an ETag is refused, and a run over a calendar whose every href,
 *    name, title, token and ETag carries an address and a title prints none of
 *    it, and leaves `console` alone;
 *  - **the reading**: a removed member listed as 404 makes A the reader, none
 *    makes B, with the changed event as the control; a 404 inside a propstat is
 *    not a removal; a calendar that answers an error is said by its status and
 *    not read again; a truncated answer is followed with its token; a
 *    `sync-level` refused with 400 is asked for again without it;
 *  - **the database**: one READ ONLY transaction, rolled back and released
 *    before Google is asked anything; no Google migration, and a connection
 *    under row security, are refused with a sentence and no request at all;
 *  - **the CLI**: no options, and the refusals that name the wrapper.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { SecretStore } from '@openmig/core/secret-store';
import { googleCalDavPrincipalUrl } from '@openmig/orchestration/google-dav-source-factory';
import {
  GOOGLE_CALDAV_ORIGIN,
  GOOGLE_CALENDAR_KINDS,
  GOOGLE_CALENDAR_MIGRATION_SQL,
  READ_ONLY_METHODS,
  RefusedRequest,
  SAID,
  SEES_EVERY_ORGANISATION_SQL,
  calendarsIn,
  countMultistatus,
  countsOnly,
  measureGoogleSync,
  readOnlyGoogleCalDav,
  syncCollectionBody,
  type FetchLike,
  type ReadOnlyClient,
  type ReadOnlyPool,
} from './measure-google-sync.ts';

const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

// ---------------------------------------------------------------------------
// A Google, and what it hears
// ---------------------------------------------------------------------------

/** The account. Every value below that could name it carries it, so a leak cannot hide. */
const ADDRESS = 'owner@example.com';
const PRINCIPAL = googleCalDavPrincipalUrl(ADDRESS);
const HOME = '/caldav/v2/owner%40example.com/';
const HOME_URL = `${GOOGLE_CALDAV_ORIGIN}${HOME}`;
const PRIMARY = `${GOOGLE_CALDAV_ORIGIN}/caldav/v2/owner%40example.com/events/`;
const FAMILY = `${GOOGLE_CALDAV_ORIGIN}/caldav/v2/dentist-family%40group.calendar.example.com/events/`;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** What must never be printed: pieces of every href, name, title, address, token and ETag served. */
const NEVER_PRINTED = [
  'owner',
  'example.com',
  '%40',
  '@',
  'Dentist',
  'dentist',
  'SECRET',
  'guest',
  'etag',
  '/caldav',
  'googleusercontent',
  'ya29',
  'Main Street',
  'invalid_grant',
];

const EVENT = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:dentist-SECRET-uid@example.com',
  'SUMMARY:Dentist appointment',
  'LOCATION:Main Street 1',
  'ATTENDEE;CN=Guest:mailto:guest@example.com',
  'DTSTART:20261201T100000Z',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const multistatus = (inner: string, token?: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><D:multistatus xmlns:D="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">` +
  `${inner}${token === undefined ? '' : `<D:sync-token>${token}</D:sync-token>`}</D:multistatus>`;

/** A member that is there; with no data, the 404 propstat for `calendar-data` Google may well send. */
const there = (href: string, withData = false): string =>
  `<D:response><D:href>${href}</D:href><D:propstat><D:prop><D:getetag>"etag-SECRET-${href.length}"</D:getetag>` +
  `${withData ? `<cal:calendar-data>${EVENT}</cal:calendar-data>` : ''}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>` +
  `${withData ? '' : '<D:propstat><D:prop><cal:calendar-data/></D:prop><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat>'}` +
  `</D:response>`;

/** A member that is gone (RFC 6578 §3.5). */
const gone = (href: string): string =>
  `<D:response><D:href>${href}</D:href><D:status>HTTP/1.1 404 Not Found</D:status></D:response>`;

/** The collection, cut short (RFC 6578 §3.6). */
const truncatedAt = (href: string): string =>
  `<D:response><D:href>${href}</D:href><D:status>HTTP/1.1 507 Insufficient Storage</D:status></D:response>`;

const eventHref = (calendar: string, name: string): string =>
  `${new URL(calendar).pathname}${name}-dentist-appointment-SECRET.ics`;

/** A Google sync token: a URL that names the calendar, with an `&` that must travel escaped. */
const tokenFor = (calendar: string, n: number): string => `${calendar}sync/SECRET-${n}?a=1&b=2`;
const inXml = (text: string): string => text.replace(/&/g, '&amp;');

const PRINCIPAL_ANSWER = multistatus(
  `<D:response><D:href>/caldav/v2/owner%40example.com/user/</D:href><D:propstat><D:prop>` +
    `<D:current-user-principal><D:href>/caldav/v2/owner%40example.com/user/</D:href></D:current-user-principal>` +
    `<cal:calendar-home-set><D:href>${HOME}</D:href></cal:calendar-home-set>` +
    `</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`,
);

const calendarEntry = (url: string, name: string, components: string): string =>
  `<D:response><D:href>${new URL(url).pathname}</D:href><D:propstat><D:prop><D:displayname>${name}</D:displayname>` +
  `<D:resourcetype><D:collection/><cal:calendar/></D:resourcetype><cal:supported-calendar-component-set>${components}` +
  `</cal:supported-calendar-component-set></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;

const LISTING_ANSWER = multistatus(
  `<D:response><D:href>${HOME}</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype>` +
    `</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>` +
    calendarEntry(PRIMARY, 'owner@example.com', '<cal:comp name="VEVENT"/>') +
    calendarEntry(FAMILY, 'Dentist and family', '<cal:comp name="VEVENT"/><cal:comp name="VTODO"/>') +
    calendarEntry(`${GOOGLE_CALDAV_ORIGIN}/caldav/v2/owner%40example.com/tasks/`, 'Tasks of the owner', '<cal:comp name="VTODO"/>'),
);

interface Heard {
  readonly method: string;
  readonly url: string;
  readonly body?: string;
}

type Answer = { readonly status: number; readonly body: string; readonly location?: string };

const answerOf = (a: Answer): Awaited<ReturnType<FetchLike>> => ({
  status: a.status,
  headers: { get: (name: string) => (name.toLowerCase() === 'location' ? (a.location ?? null) : null) },
  text: () => Promise.resolve(a.body),
});

/**
 * A Google with two event calendars and a task list. `report` answers each
 * REPORT from the calendar, the token it was sent (decoded) and whether it
 * carried `sync-level`; `changed` says whether the owner has pressed Enter.
 */
function aGoogle(
  report: (calendar: string, token: string | undefined, level: boolean, changed: boolean) => Answer,
  options: { readonly signIn?: Answer } = {},
): { fetch: FetchLike; heard: Heard[]; order: string[]; pressEnter: () => Promise<void> } {
  const heard: Heard[] = [];
  const order: string[] = [];
  let changed = false;
  const fetch: FetchLike = async (url, init) => {
    heard.push({ method: init.method, url, ...(init.body !== undefined ? { body: init.body } : {}) });
    order.push('fetch');
    if (url === TOKEN_URL) {
      return answerOf(
        options.signIn ?? { status: 200, body: JSON.stringify({ access_token: 'ya29.SECRET-access', expires_in: 3600 }) },
      );
    }
    if (init.method === 'PROPFIND' && url === PRINCIPAL) return answerOf({ status: 207, body: PRINCIPAL_ANSWER });
    if (init.method === 'PROPFIND' && url === HOME_URL) return answerOf({ status: 207, body: LISTING_ANSWER });
    if (init.method === 'REPORT') {
      const body = init.body ?? '';
      const sent = /<D:sync-token>([^<]*)<\/D:sync-token>/.exec(body)?.[1];
      const token = sent === undefined ? undefined : sent.replace(/&amp;/g, '&');
      return answerOf(report(url, token, body.includes('<D:sync-level>1</D:sync-level>'), changed));
    }
    return answerOf({ status: 404, body: '<D:error>owner@example.com</D:error>' });
  };
  return {
    fetch,
    heard,
    order,
    pressEnter: () => {
      changed = true;
      return Promise.resolve();
    },
  };
}

/**
 * Two calendars, one sync token each, then what `after` says the second
 * reading lists in the primary one. The family calendar carries its data and
 * lists nothing new.
 */
function twoCalendars(after: (calendar: string) => string): (
  calendar: string,
  token: string | undefined,
  level: boolean,
  changed: boolean,
) => Answer {
  return (calendar, token, _level, changed) => {
    if (token === undefined) {
      const members =
        calendar === PRIMARY
          ? [there(eventHref(calendar, 'a')), there(eventHref(calendar, 'b')), there(eventHref(calendar, 'c'))]
          : [there(eventHref(calendar, 'd'), true), there(eventHref(calendar, 'e'), true)];
      return { status: 207, body: multistatus(members.join(''), inXml(tokenFor(calendar, 1))) };
    }
    if (token !== tokenFor(calendar, 1)) return { status: 403, body: '<D:error><D:valid-sync-token/></D:error>' };
    const listed = changed && calendar === PRIMARY ? after(calendar) : '';
    return { status: 207, body: multistatus(listed, inXml(tokenFor(calendar, 2))) };
  };
}

// ---------------------------------------------------------------------------
// A database, and what it was asked
// ---------------------------------------------------------------------------

const MIGRATION_ID = '7c0e7a52-1b2d-4c3e-9f4a-5b6c7d8e9f01';

function aMigration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: MIGRATION_ID,
    created_at: new Date('2026-11-20T14:03:27.512Z'),
    source_secret_ref: null,
    source_config_override: null,
    kind: 'google',
    config: { user: ADDRESS },
    // A grant made with the button: the refresh token alone, the client is the deployment's.
    secret_ref: JSON.stringify(SecretStore.encryptCredentials({ refreshToken: 'refresh-SECRET' }).encrypted),
    candidates: '2',
    ...overrides,
  };
}

function aDatabase(
  rows: ReadonlyArray<Record<string, unknown>>,
  options: { readonly seesEveryOrganisation?: boolean; readonly order?: string[] } = {},
): { pool: ReadOnlyPool; asked: Array<{ text: string; values?: unknown[] }>; released: () => number } {
  const asked: Array<{ text: string; values?: unknown[] }> = [];
  let released = 0;
  const client: ReadOnlyClient = {
    query(text, values) {
      asked.push({ text, ...(values ? { values } : {}) });
      if (text === SEES_EVERY_ORGANISATION_SQL) {
        return Promise.resolve({ rows: [{ sees_every_organisation: options.seesEveryOrganisation ?? true }] });
      }
      if (text === GOOGLE_CALENDAR_MIGRATION_SQL) return Promise.resolve({ rows: [...rows] });
      return Promise.resolve({ rows: [] });
    },
    release() {
      released += 1;
      options.order?.push('released');
    },
  };
  return { pool: { connect: () => Promise.resolve(client) }, asked, released: () => released };
}

/** The deployment's own Google client, as `.env` carries it. */
const ENV = { GOOGLE_OAUTH_CLIENT_ID: 'deployment-client-id', GOOGLE_OAUTH_CLIENT_SECRET: 'deployment-client-secret' };

async function run(
  google: ReturnType<typeof aGoogle>,
  database: ReturnType<typeof aDatabase>,
): Promise<{ code: number; lines: string[] }> {
  const written: string[] = [];
  const code = await measureGoogleSync({
    pool: database.pool,
    fetch: google.fetch,
    write: (text) => {
      written.push(text);
    },
    waitForEnter: google.pressEnter,
    env: ENV,
  });
  const lines = written.join('').split('\n');
  expect(lines.pop(), 'every line ends with a newline').toBe('');
  return { code, lines };
}

let consoleCalls: Array<ReturnType<typeof vi.spyOn>>;

beforeEach(() => {
  process.env.SECRET_ENCRYPTION_KEY = TEST_KEY;
  consoleCalls = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error'), vi.spyOn(console, 'info')];
});

afterEach(() => {
  for (const spy of consoleCalls) {
    expect(spy, 'something printed past the output guard').not.toHaveBeenCalled();
  }
  vi.restoreAllMocks();
  delete process.env.SECRET_ENCRYPTION_KEY;
});

// ---------------------------------------------------------------------------
// The method guard
// ---------------------------------------------------------------------------

describe('the method guard: PROPFIND and REPORT to Google, and nothing else', () => {
  const nothingSent = (): { fetch: FetchLike; sent: () => number } => {
    let sent = 0;
    return {
      fetch: () => {
        sent += 1;
        return Promise.resolve(answerOf({ status: 207, body: '' }));
      },
      sent: () => sent,
    };
  };

  it('allows exactly those two methods', () => {
    expect([...READ_ONLY_METHODS].sort()).toEqual(['PROPFIND', 'REPORT']);
  });

  it.each([
    'GET',
    'HEAD',
    'OPTIONS',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'MKCALENDAR',
    'MKCOL',
    'PROPPATCH',
    'MOVE',
    'COPY',
    'LOCK',
    'UNLOCK',
    'ACL',
    'propfind',
    'report',
  ])('refuses %s before anything is sent', async (method) => {
    const { fetch, sent } = nothingSent();
    const send = readOnlyGoogleCalDav(fetch);
    await expect(send({ method, url: PRIMARY, headers: {}, body: '<x/>' })).rejects.toEqual(new RefusedRequest('method'));
    expect(sent()).toBe(0);
  });

  it.each([
    'https://example.com/caldav/v2/owner%40example.com/events/',
    'http://apidata.googleusercontent.com/caldav/v2/owner%40example.com/events/',
    'https://apidata.googleusercontent.com.example.com/caldav/v2/',
    'https://www.googleapis.com/carddav/v1/principals/owner%40example.com/',
    'not a url at all',
  ])('refuses a REPORT to %s before anything is sent', async (url) => {
    const { fetch, sent } = nothingSent();
    await expect(readOnlyGoogleCalDav(fetch)({ method: 'REPORT', url, headers: {} })).rejects.toEqual(
      new RefusedRequest('host'),
    );
    expect(sent()).toBe(0);
  });

  it('sends PROPFIND and REPORT to Google, and lets no fetch follow a redirect by itself', async () => {
    const inits: Array<Parameters<FetchLike>[1]> = [];
    const send = readOnlyGoogleCalDav((_url, init) => {
      inits.push(init);
      return Promise.resolve(answerOf({ status: 207, body: '<ok/>' }));
    });
    expect(await send({ method: 'PROPFIND', url: PRINCIPAL, headers: { Depth: '0' }, body: '<p/>' })).toEqual({
      status: 207,
      body: '<ok/>',
    });
    expect(await send({ method: 'REPORT', url: PRIMARY, headers: {}, body: '<r/>' })).toEqual({ status: 207, body: '<ok/>' });
    expect(inits.map((i) => [i.method, i.redirect])).toEqual([
      ['PROPFIND', 'manual'],
      ['REPORT', 'manual'],
    ]);
  });

  it('follows a redirect inside Google through the guard, and refuses one that leaves it', async () => {
    const urls: string[] = [];
    const inside = readOnlyGoogleCalDav((url) => {
      urls.push(url);
      return Promise.resolve(
        answerOf(url === PRIMARY ? { status: 301, body: '', location: FAMILY } : { status: 207, body: '<moved/>' }),
      );
    });
    expect(await inside({ method: 'REPORT', url: PRIMARY, headers: {} })).toEqual({ status: 207, body: '<moved/>' });
    expect(urls).toEqual([PRIMARY, FAMILY]);

    const away: string[] = [];
    const outside = readOnlyGoogleCalDav((url) => {
      away.push(url);
      return Promise.resolve(answerOf({ status: 307, body: '', location: 'https://example.com/steal' }));
    });
    await expect(outside({ method: 'REPORT', url: PRIMARY, headers: {} })).rejects.toEqual(new RefusedRequest('host'));
    expect(away, 'the address it was sent to was never asked').toEqual([PRIMARY]);
  });

  it('in a whole run, sends Google only PROPFIND and REPORT, and signs in once, at the token endpoint', async () => {
    const google = aGoogle(twoCalendars((calendar) => there(eventHref(calendar, 'a')) + gone(eventHref(calendar, 'b'))));
    const { code } = await run(google, aDatabase([aMigration()]));
    expect(code).toBe(0);
    const toCalendars = google.heard.filter((h) => new URL(h.url).origin === GOOGLE_CALDAV_ORIGIN);
    expect(new Set(toCalendars.map((h) => h.method))).toEqual(new Set(['PROPFIND', 'REPORT']));
    const elsewhere = google.heard.filter((h) => new URL(h.url).origin !== GOOGLE_CALDAV_ORIGIN);
    expect(elsewhere.map((h) => [h.method, h.url])).toEqual([['POST', TOKEN_URL]]);
    // The deployment's client, put back the way every pass puts it back.
    expect(elsewhere[0]!.body).toContain('client_id=deployment-client-id');
    expect(elsewhere[0]!.body).toContain(`scope=${encodeURIComponent('https://www.googleapis.com/auth/calendar')}`);
    // Two PROPFINDs to find the calendars, and two REPORTs per calendar: the task list is not one.
    const named: Record<string, string> = { [PRINCIPAL]: 'principal', [HOME_URL]: 'home', [PRIMARY]: 'primary', [FAMILY]: 'family' };
    expect(toCalendars.map((h) => `${h.method} ${named[h.url] ?? 'elsewhere'}`)).toEqual([
      'PROPFIND principal',
      'PROPFIND home',
      'REPORT primary',
      'REPORT family',
      'REPORT primary',
      'REPORT family',
    ]);
  });
});

// ---------------------------------------------------------------------------
// The output guard
// ---------------------------------------------------------------------------

describe('the output guard: counts and status codes, and nothing read from Google', () => {
  it.each([
    ['an href', `Calendar 1: status 207; href ${eventHref(PRIMARY, 'a')}.`],
    ['an address', `Migration of ${ADDRESS}, created 2026-11-20 14:03 UTC.`],
    ['a title', 'Calendar 1: Dentist appointment; members 200: 1, 404: 0, other: 0; sync token: yes; calendar data: no.'],
    ['a calendar name', 'Calendar Dentist and family: status 207; members 200: 1, 404: 0, other: 0; sync token: yes; calendar data: no.'],
    ['a sync token', `Calendar 1: status 207; sync token: ${tokenFor(PRIMARY, 1)}.`],
    ['an ETag', 'Calendar 1: status 207; members 200: 1 ("etag-SECRET-1"), 404: 0, other: 0; sync token: yes; calendar data: no.'],
    ['a body', `Stopped: Google answered 403: <D:error>${ADDRESS}</D:error>`],
    ['a sentence with an address appended', `${SAID.verdictB} ${ADDRESS}`],
    ['a status code that is not one', 'Calendar 1: status 2O7; members 200: 1, 404: 0, other: 0; sync token: yes; calendar data: no.'],
    ['a second line hidden in one', `${SAID.verdictB}\n${ADDRESS}`],
  ])('refuses a line carrying %s', (_what, line) => {
    expect(() => countsOnly(line)).toThrow('a line that is not a count');
  });

  it('lets through the counts it is for', () => {
    for (const line of [
      '',
      SAID.header,
      `Migration ${MIGRATION_ID}, created 2026-11-20 14:03 UTC, the newest of 2 whose calendars come from Google over CalDAV.`,
      'Calendar 12: status 207, pages 3; members 200: 6212, 404: 0, other: 2 (403: 1, 404 in propstat: 1); sync token: yes; calendar data: no.',
      'Calendar 2: status 403; changed (200): 0, removed (404): 0, other: 0; new sync token: no.',
      'Google also listed 1 member with another status (410: 1): read it before deciding.',
    ]) {
      expect(countsOnly(line)).toBe(line);
    }
  });

  it('prints nothing of the hrefs, names, titles, addresses, tokens or ETags Google served', async () => {
    const google = aGoogle(twoCalendars((calendar) => there(eventHref(calendar, 'a'), true) + gone(eventHref(calendar, 'b'))));
    const { code, lines } = await run(google, aDatabase([aMigration()]));
    expect(code).toBe(0);
    const printed = lines.join('\n');
    for (const piece of NEVER_PRINTED) expect(printed, `printed "${piece}"`).not.toContain(piece);
    // And every line is one the guard admits, which is how it got out.
    for (const line of lines) expect(countsOnly(line)).toBe(line);
  });

  it('stops, in its own sentence, on a line that is not a count', async () => {
    const google = aGoogle(twoCalendars(() => ''));
    const written: string[] = [];
    const code = await measureGoogleSync({
      pool: aDatabase([aMigration({ id: `${ADDRESS}-not-a-uuid` })]).pool,
      fetch: google.fetch,
      write: (text) => written.push(text),
      waitForEnter: google.pressEnter,
      env: ENV,
    });
    expect(code).toBe(1);
    expect(written).toEqual([`${SAID.header}\n`, `${SAID.outputRefused}\n`]);
    expect(google.heard, 'it stopped before asking Google anything').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// What Google answers
// ---------------------------------------------------------------------------

describe('what Google answers, and the verdict', () => {
  const FIRST = [
    SAID.header,
    `Migration ${MIGRATION_ID}, created 2026-11-20 14:03 UTC, the newest of 2 whose calendars come from Google over CalDAV.`,
    'Calendars in this account: 2.',
    '',
    SAID.firstReading,
    'Calendar 1: status 207; members 200: 3, 404: 0, other: 0; sync token: yes; calendar data: no.',
    'Calendar 2: status 207; members 200: 2, 404: 0, other: 0; sync token: yes; calendar data: yes.',
    '',
    SAID.promptEn,
    SAID.promptNl,
    '',
    SAID.secondReading,
  ];

  it('makes A the reader when Google lists the deleted event as a 404', async () => {
    const google = aGoogle(twoCalendars((calendar) => there(eventHref(calendar, 'a')) + gone(eventHref(calendar, 'b'))));
    const { code, lines } = await run(google, aDatabase([aMigration()]));
    expect(lines).toEqual([
      ...FIRST,
      'Calendar 1: status 207; changed (200): 1, removed (404): 1, other: 0; new sync token: yes.',
      'Calendar 2: status 207; changed (200): 0, removed (404): 0, other: 0; new sync token: yes.',
      '',
      'Verdict: A is the reader. Google listed 1 removed event as 404, and 1 changed one as 200 (workplan 0164 §3.1).',
    ]);
    expect(code).toBe(0);
  });

  it('makes B the reader when Google lists the change and not the deletion', async () => {
    const google = aGoogle(twoCalendars((calendar) => there(eventHref(calendar, 'a'))));
    const { code, lines } = await run(google, aDatabase([aMigration()]));
    expect(lines.slice(FIRST.length)).toEqual([
      'Calendar 1: status 207; changed (200): 1, removed (404): 0, other: 0; new sync token: yes.',
      'Calendar 2: status 207; changed (200): 0, removed (404): 0, other: 0; new sync token: yes.',
      '',
      SAID.verdictB,
      'The change was listed (1 changed), so the second reading did answer.',
    ]);
    expect(code).toBe(0);
  });

  it('says so when Google lists neither, so a reading of nothing is not taken for a measured B', async () => {
    const google = aGoogle(twoCalendars(() => ''));
    const { code, lines } = await run(google, aDatabase([aMigration()]));
    expect(lines.slice(-2)).toEqual([SAID.verdictB, SAID.noChangeEither]);
    expect(code).toBe(0);
  });

  it('names a member listed with another status, rather than counting it as either', async () => {
    const gone410 = (href: string): string =>
      `<D:response><D:href>${href}</D:href><D:status>HTTP/1.1 410 Gone</D:status></D:response>`;
    const google = aGoogle(twoCalendars((calendar) => there(eventHref(calendar, 'a')) + gone410(eventHref(calendar, 'b'))));
    const { lines } = await run(google, aDatabase([aMigration()]));
    expect(lines.slice(FIRST.length)).toEqual([
      'Calendar 1: status 207; changed (200): 1, removed (404): 0, other: 1 (410: 1); new sync token: yes.',
      'Calendar 2: status 207; changed (200): 0, removed (404): 0, other: 0; new sync token: yes.',
      '',
      SAID.verdictB,
      'The change was listed (1 changed), so the second reading did answer.',
      'Google also listed 1 member with another status (410: 1): read it before deciding.',
    ]);
  });

  it('says a calendar that answers an error by its status, and does not read it again', async () => {
    const answers = twoCalendars((calendar) => there(eventHref(calendar, 'a')) + gone(eventHref(calendar, 'b')));
    const google = aGoogle((calendar, token, level, changed) =>
      calendar === FAMILY && token === undefined
        ? { status: 403, body: `<D:error><D:need-privileges><D:href>${new URL(FAMILY).pathname}</D:href></D:need-privileges></D:error>` }
        : answers(calendar, token, level, changed),
    );
    const { code, lines } = await run(google, aDatabase([aMigration()]));
    expect(lines).toContain('Calendar 2: status 403; members 200: 0, 404: 0, other: 0; sync token: no; calendar data: no.');
    expect(lines).toContain('Calendar 2: not read again, the first reading answered 403.');
    expect(lines.at(-1)).toBe(
      'Verdict: A is the reader. Google listed 1 removed event as 404, and 1 changed one as 200 (workplan 0164 §3.1).',
    );
    expect(google.heard.filter((h) => h.method === 'REPORT' && h.url === FAMILY)).toHaveLength(1);
    expect(code).toBe(0);
  });

  it('asks the owner nothing when no calendar can be read again', async () => {
    const google = aGoogle(() => ({ status: 403, body: `<D:error>${ADDRESS}</D:error>` }));
    const { code, lines } = await run(google, aDatabase([aMigration()]));
    expect(lines.slice(-2)).toEqual(['', SAID.nothingToReadAgain]);
    expect(lines).not.toContain(SAID.promptEn);
    expect(code).toBe(1);
  });

  it('says none when no second reading answers 207', async () => {
    const google = aGoogle((calendar, token) =>
      token === undefined
        ? { status: 207, body: multistatus(there(eventHref(calendar, 'a')), inXml(tokenFor(calendar, 1))) }
        : { status: 403, body: '<D:error><D:valid-sync-token/></D:error>' },
    );
    const { code, lines } = await run(google, aDatabase([aMigration()]));
    expect(lines).toContain('Calendar 1: status 403; changed (200): 0, removed (404): 0, other: 0; new sync token: no.');
    expect(lines.at(-1)).toBe(SAID.verdictNone);
    expect(code).toBe(1);
  });

  it('sends the second reading the token the first one gave, escaped, kept nowhere else', async () => {
    const google = aGoogle(twoCalendars((calendar) => gone(eventHref(calendar, 'b'))));
    await run(google, aDatabase([aMigration()]));
    const reports = google.heard.filter((h) => h.method === 'REPORT' && h.url === PRIMARY).map((h) => h.body ?? '');
    expect(reports[0]).toContain('<D:sync-token/>');
    expect(reports[1]).toContain(`<D:sync-token>${inXml(tokenFor(PRIMARY, 1))}</D:sync-token>`);
    expect(reports[0]).toBe(syncCollectionBody(undefined, true));
  });

  it('follows a truncated first reading with the token it carries, and counts the whole calendar', async () => {
    const answers = twoCalendars((calendar) => gone(eventHref(calendar, 'b')));
    const google = aGoogle((calendar, token, level, changed) => {
      if (calendar !== PRIMARY) return answers(calendar, token, level, changed);
      if (token === undefined) {
        return {
          status: 207,
          body: multistatus(
            there(eventHref(calendar, 'a')) + there(eventHref(calendar, 'b')) + truncatedAt(new URL(calendar).pathname),
            inXml(tokenFor(calendar, 0)),
          ),
        };
      }
      if (token === tokenFor(calendar, 0)) {
        return { status: 207, body: multistatus(there(eventHref(calendar, 'c')), inXml(tokenFor(calendar, 1))) };
      }
      return answers(calendar, token, level, changed);
    });
    const { lines } = await run(google, aDatabase([aMigration()]));
    expect(lines).toContain('Calendar 1: status 207, pages 2; members 200: 3, 404: 0, other: 0; sync token: yes; calendar data: no.');
    expect(lines).toContain('Calendar 1: status 207; changed (200): 0, removed (404): 1, other: 0; new sync token: yes.');
  });

  it('asks again without sync-level when Google refuses it with 400, and keeps to that', async () => {
    const answers = twoCalendars((calendar) => gone(eventHref(calendar, 'b')));
    const google = aGoogle((calendar, token, level, changed) =>
      level ? { status: 400, body: `<D:error>${ADDRESS}</D:error>` } : answers(calendar, token, level, changed),
    );
    const { lines, code } = await run(google, aDatabase([aMigration()]));
    expect(lines).toContain(
      'Calendar 1: status 207 without sync-level (400 with it); members 200: 3, 404: 0, other: 0; sync token: yes; calendar data: no.',
    );
    const second = google.heard.filter((h) => h.method === 'REPORT' && h.url === PRIMARY).at(-1)!;
    expect(second.body).toBe(syncCollectionBody(tokenFor(PRIMARY, 1), false));
    expect(code).toBe(0);
  });
});

describe('reading a multistatus', () => {
  it('reads an answer that opens <response> many times and never closes it in linear time (workplan 0163)', () => {
    // The element pattern scanned from every opening tag to the end of such an
    // answer: before the change this one took 15 seconds. The bound is
    // far above a linear read.
    const started = performance.now();
    const counted = countMultistatus('<D:response><D:propstat>'.repeat(40_000));
    expect([counted.members.ok, counted.members.gone, counted.token]).toEqual([0, 0, undefined]);
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it('takes a 404 inside a propstat for a property without a value, never for a removal', () => {
    const counted = countMultistatus(multistatus(there('/a.ics') + gone('/b.ics')));
    expect([counted.members.ok, counted.members.gone, [...counted.members.other]]).toEqual([1, 1, []]);
    expect(counted.carriedData).toBe(false);
  });

  it('counts a member with no 200 anywhere by the status it does carry', () => {
    const onlyMissing =
      '<D:response><D:href>/x.ics</D:href><D:propstat><D:prop><D:getetag/></D:prop>' +
      '<D:status>HTTP/1.1 404 Not Found</D:status></D:propstat></D:response>';
    const nothing = '<D:response><D:href>/y.ics</D:href></D:response>';
    const counted = countMultistatus(multistatus(onlyMissing + nothing));
    expect([counted.members.ok, counted.members.gone, [...counted.members.other].sort()]).toEqual([
      0,
      0,
      [
        ['404 in propstat', 1],
        ['no status', 1],
      ],
    ]);
  });

  it('reads any prefix, or none, and the token outside the responses only', () => {
    const body =
      '<multistatus xmlns="DAV:"><response><href>/a.ics</href><status>HTTP/1.1 404 Not Found</status></response>' +
      '<x:response xmlns:x="DAV:"><x:href>/b.ics</x:href><x:propstat><x:prop><c:calendar-data xmlns:c="urn:ietf:params:xml:ns:caldav">' +
      'BEGIN:VCALENDAR</c:calendar-data></x:prop><x:status>HTTP/1.1 200 OK</x:status></x:propstat></x:response>' +
      '<sync-token>tok&amp;en</sync-token></multistatus>';
    const counted = countMultistatus(body);
    expect([counted.members.ok, counted.members.gone, counted.carriedData, counted.token]).toEqual([1, 1, true, 'tok&en']);
  });

  it('reads a 507 as the answer cut short, not as a member', () => {
    const counted = countMultistatus(multistatus(there('/a.ics') + truncatedAt('/cal/'), 'next'));
    expect([counted.members.ok, counted.truncated, counted.token, [...counted.members.other]]).toEqual([1, true, 'next', []]);
  });

  it('lists the event calendars a home names, once each, and neither the home nor a task list', () => {
    expect(calendarsIn(LISTING_ANSWER, HOME_URL)).toEqual([PRIMARY, FAMILY]);
  });
});

// ---------------------------------------------------------------------------
// The migration, and the database
// ---------------------------------------------------------------------------

describe('the migration it chooses, from a database it only reads', () => {
  it('reads in one READ ONLY transaction, rolled back and released before Google is asked anything', async () => {
    const google = aGoogle(twoCalendars((calendar) => gone(eventHref(calendar, 'b'))));
    const database = aDatabase([aMigration()], { order: google.order });
    const { code } = await run(google, database);
    expect(code).toBe(0);
    expect(database.asked.map((a) => a.text)).toEqual([
      'BEGIN READ ONLY',
      SEES_EVERY_ORGANISATION_SQL,
      GOOGLE_CALENDAR_MIGRATION_SQL,
      'ROLLBACK',
    ]);
    for (const { text } of database.asked) {
      expect(text, 'a statement that is not a read').toMatch(/^(?:BEGIN READ ONLY|ROLLBACK|SELECT )/);
      expect(text).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|CREATE|DROP|GRANT|COPY)\b/i);
    }
    expect(database.asked[2]!.values).toEqual([[...GOOGLE_CALENDAR_KINDS]]);
    expect(database.released()).toBe(1);
    expect(google.order.indexOf('released')).toBeLessThan(google.order.indexOf('fetch'));
  });

  it('chooses among the kinds whose calendars the Google builder reads, newest first, carrying calendars', () => {
    expect([...GOOGLE_CALENDAR_KINDS].sort()).toEqual(['google', 'google_calendar']);
    expect(GOOGLE_CALENDAR_MIGRATION_SQL).toContain('ORDER BY m.created_at DESC, m.id DESC');
    expect(GOOGLE_CALENDAR_MIGRATION_SQL).toContain("s.domain = 'calendar' AND s.included");
    expect(GOOGLE_CALENDAR_MIGRATION_SQL).toContain('m.grant_withdrawn_at IS NULL');
    expect(GOOGLE_CALENDAR_MIGRATION_SQL).toContain("t.status = 'active'");
  });

  it('refuses with a sentence, and asks Google nothing, when no migration reads Google calendars', async () => {
    const google = aGoogle(twoCalendars(() => ''));
    const { code, lines } = await run(google, aDatabase([]));
    expect(lines).toEqual([SAID.header, SAID.noMigration]);
    expect(code).toBe(1);
    expect(google.heard).toEqual([]);
  });

  it('refuses a connection bound by row security, which would find nothing and call it none', async () => {
    const google = aGoogle(twoCalendars(() => ''));
    const database = aDatabase([aMigration()], { seesEveryOrganisation: false });
    const { code, lines } = await run(google, database);
    expect(lines).toEqual([SAID.header, SAID.rowSecurity]);
    expect(database.asked.map((a) => a.text)).toEqual(['BEGIN READ ONLY', SEES_EVERY_ORGANISATION_SQL, 'ROLLBACK']);
    expect(code).toBe(1);
    expect(google.heard).toEqual([]);
  });

  it('says the only one when there is one', async () => {
    const google = aGoogle(twoCalendars((calendar) => gone(eventHref(calendar, 'b'))));
    const { lines } = await run(google, aDatabase([aMigration({ candidates: '1' })]));
    expect(lines[1]).toBe(
      `Migration ${MIGRATION_ID}, created 2026-11-20 14:03 UTC, the only one whose calendars come from Google over CalDAV.`,
    );
  });

  it("reads the migrator's own grant over the connection's, as every pass does", async () => {
    const google = aGoogle(twoCalendars((calendar) => gone(eventHref(calendar, 'b'))));
    const grant = JSON.stringify(SecretStore.encryptCredentials({ refreshToken: 'migrator-SECRET' }).encrypted);
    await run(google, aDatabase([aMigration({ source_secret_ref: grant })]));
    expect(google.heard[0]!.body).toContain('refresh_token=migrator-SECRET');
  });

  it('says the database failed by its SQLSTATE, never its words', async () => {
    const google = aGoogle(twoCalendars(() => ''));
    const failing: ReadOnlyPool = {
      connect: () => Promise.reject(Object.assign(new Error(`password authentication failed for ${ADDRESS}`), { code: '28P01' })),
    };
    const written: string[] = [];
    const code = await measureGoogleSync({
      pool: failing,
      fetch: google.fetch,
      write: (t) => written.push(t),
      waitForEnter: google.pressEnter,
      env: ENV,
    });
    expect(written.join('')).toBe(`${SAID.header}\nStopped: the database answered SQLSTATE 28P01, so nothing was measured.\n`);
    expect(code).toBe(1);
  });
});

describe('the sign-in', () => {
  it("stops on Google's refusal with its status, and reads no calendar", async () => {
    const google = aGoogle(twoCalendars(() => ''), {
      signIn: { status: 400, body: `{"error":"invalid_grant","error_description":"${ADDRESS}"}` },
    });
    const { code, lines } = await run(google, aDatabase([aMigration()]));
    expect(lines.at(-1)).toBe("Stopped: Google's sign-in answered 400, so nothing more was read.");
    expect(google.heard.map((h) => h.method)).toEqual(['POST']);
    expect(code).toBe(1);
  });

  it('refuses without the key, naming the wrapper that loads it, and asks nobody anything', async () => {
    const stored = aMigration();
    delete process.env.SECRET_ENCRYPTION_KEY;
    const google = aGoogle(twoCalendars(() => ''));
    const { code, lines } = await run(google, aDatabase([stored]));
    expect(lines.at(-1)).toBe(SAID.noKey);
    expect(google.heard).toEqual([]);
    expect(code).toBe(1);
  });

  it('refuses a sign-in with no refresh token rather than asking Google for one', async () => {
    const google = aGoogle(twoCalendars(() => ''));
    const empty = JSON.stringify(SecretStore.encryptCredentials({}).encrypted);
    const { lines } = await run(google, aDatabase([aMigration({ secret_ref: empty })]));
    expect(lines.at(-1)).toBe(SAID.incompleteSignIn);
    expect(google.heard).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The CLI
// ---------------------------------------------------------------------------

describe('the CLI', () => {
  const CLI = join(import.meta.dirname, 'index.ts');
  const cli = (
    args: string[],
    env: Record<string, string>,
  ): { status: number | null; out: string; stdout: string } => {
    const clean = Object.fromEntries(
      Object.entries(process.env).filter(
        ([k]) => !['DATABASE_URL', 'SECRET_ENCRYPTION_KEY', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'].includes(k),
      ),
    );
    const r = spawnSync(process.execPath, [CLI, ...args], {
      env: { ...clean, ...env },
      encoding: 'utf8',
      input: '',
      timeout: 60_000,
    });
    return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, stdout: r.stdout ?? '' };
  };

  it('takes no options, so nobody can believe they chose the migration', () => {
    const r = cli(['measure-google-sync', '--mapping', MIGRATION_ID], {});
    expect(r.status).toBe(1);
    expect(r.out).toContain('measure-google-sync takes no options: it chooses its migration itself, and prints which.');
  }, 60_000);

  it('names the wrapper when the owner connection is missing', () => {
    const r = cli(['measure-google-sync'], {});
    expect(r.status).toBe(1);
    expect(r.out).toContain('Run ./deploy/compose/operator.sh measure-google-sync');
  }, 60_000);

  it('refuses before it reads anything when its input is not a terminal', () => {
    const r = cli(['measure-google-sync'], { DATABASE_URL: 'postgresql://nobody@127.0.0.1:9/none' });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe(`${SAID.notATerminal}\n`);
  }, 60_000);
});
