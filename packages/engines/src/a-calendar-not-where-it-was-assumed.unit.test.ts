// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CALENDAR NOT WHERE IT WAS ASSUMED (workplan 0160).
 *
 * The owner's first calendar pass into Cirrux, on 2026-11-19, failed before
 * it wrote a single event:
 *
 *     calendar sync failed: MKCALENDAR failed for /calendars/<mailbox>/
 *     <slug>/ with status 404: the server answered with something that is
 *     not a DAV, JMAP or IMAP error.
 *
 * The writer put every calendar at `calendars/<username>/`, which is where
 * Nextcloud and SabreDAV keep them and nobody's standard. Cirrux keeps them
 * elsewhere. And since a failed type ended the pass, the tasks and the mail
 * behind the calendars never had their turn.
 *
 * The server here is shaped from what Cirrux publishes: every mailbox has a
 * default calendar and a task list called Reminders, apps add task lists
 * over CalDAV (https://cirrux.co/help/api/tasks, read 2026-11-19), and the
 * calendars are found by asking (RFC 6764, RFC 4791 §6.2.1). Where Cirrux
 * keeps them is not published, so the paths are this test's own; what is
 * pinned is that the writer finds them by asking rather than by assuming.
 */

import { describe, it, expect, vi } from 'vitest';
import { asTenantId, asMappingId, log, type Ledger } from '@openmig/shared';
import { CalDAVTargetWriter, type HttpClient, type CalDavLedgerDomain } from './caldav-target-writer.ts';

const TENANT = asTenantId('a1b2c3d4-0160-4000-8000-000000000003' as never);
const MAPPING = asMappingId('a1b2c3d4-0160-4000-8000-000000000004' as never);
const BASE = 'https://dav.example.net';
const USER = 'sam@example.com';
const ASSUMED_HOME = `${BASE}/calendars/${USER}/`;
const PRINCIPAL = '/principals/7f3a/';
const HOME = '/calendars/7f3a/';
const DEFAULT_CALENDAR = `${HOME}2b4d6f/`;
const REMINDERS = `${HOME}8c9e0a/`;

const emptyLedger = {
  find: async () => undefined,
  recordIfAbsent: async () => undefined,
} as unknown as Ledger;

/** A calendar the source handed over: "Family", slug `family`. */
const FAMILY = { name: 'Family', path: '/calendars/owner/family/', components: ['VEVENT' as const] };

interface Call {
  method: string;
  url: string;
  depth: string | undefined;
  body: string;
}

type Answer = { status: number; body?: string; headers?: Record<string, string> };
type Route = Answer | ((calls: Call[]) => Answer);

function multistatus(...responses: string[]): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">' +
    responses.join('') +
    '</d:multistatus>'
  );
}

function propResponse(href: string, prop: string): string {
  return (
    `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${prop}</d:prop>` +
    '<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>'
  );
}

function principalAt(href: string): Answer {
  return {
    status: 207,
    body: multistatus(
      propResponse('/', `<d:current-user-principal><d:href>${href}</d:href></d:current-user-principal>`),
    ),
  };
}

function calendarHomeAt(principal: string, home: string): Answer {
  return {
    status: 207,
    body: multistatus(
      propResponse(principal, `<cal:calendar-home-set><d:href>${home}</d:href></cal:calendar-home-set>`),
    ),
  };
}

interface Listed {
  path: string;
  name: string;
  /** The kinds it declares; absent declares none, which holds every kind. */
  holds?: string[];
}

/** A Depth-1 listing of `home`: the home itself, then each calendar with its name and kinds. */
function calendarsAt(home: string, calendars: Listed[]): Answer {
  return {
    status: 207,
    body: multistatus(
      propResponse(home, '<d:resourcetype><d:collection/></d:resourcetype>'),
      ...calendars.map((c) =>
        propResponse(
          c.path,
          '<d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>' +
            `<d:displayname>${c.name}</d:displayname>` +
            (c.holds
              ? `<cal:supported-calendar-component-set>${c.holds
                  .map((k) => `<cal:comp name="${k}"/>`)
                  .join('')}</cal:supported-calendar-component-set>`
              : ''),
        ),
      ),
    ),
  };
}

/** Cirrux's two calendars of every mailbox: the default one, and Reminders. */
const CIRRUX_CALENDARS: Listed[] = [
  { path: DEFAULT_CALENDAR, name: 'Calendar', holds: ['VEVENT'] },
  { path: REMINDERS, name: 'Reminders', holds: ['VTODO'] },
];

const EMPTY_REPORT: Answer = { status: 207, body: multistatus() };

/**
 * A server answering from a table, keyed `METHOD url`. Anything not in it is
 * a 404, as a server answers a path it does not have. Every request is kept,
 * so a test can say what was NOT asked as well as what was.
 */
function server(routes: Record<string, Route>, domain: CalDavLedgerDomain = 'calendar') {
  const calls: Call[] = [];
  const client: HttpClient = {
    async request(o) {
      calls.push({ method: o.method, url: o.url, depth: o.headers?.['Depth'], body: String(o.body ?? '') });
      const route = routes[`${o.method} ${o.url}`];
      const answer = typeof route === 'function' ? route(calls) : route;
      if (answer === undefined) return { status: 404, body: '', headers: {} };
      return { status: answer.status, body: answer.body ?? '', headers: answer.headers ?? {} };
    },
  };
  const writer = new CalDAVTargetWriter(
    { url: BASE, username: USER, password: 'app-password' },
    { domain, ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
  );
  return { writer, calls };
}

/** Cirrux's shape: nothing at Nextcloud's path, the home named by the principal, two calendars in it. */
function cirrux(extra: Record<string, Route> = {}, listed: Listed[] = CIRRUX_CALENDARS): Record<string, Route> {
  return {
    [`PROPFIND ${BASE}/.well-known/caldav`]: principalAt(PRINCIPAL),
    [`PROPFIND ${BASE}${PRINCIPAL}`]: calendarHomeAt(PRINCIPAL, HOME),
    [`PROPFIND ${BASE}${HOME}`]: calendarsAt(HOME, listed),
    ...extra,
  };
}

const made = (method: string, calls: Call[]) => calls.filter((c) => c.method === method).map((c) => c.url);

const event = (uid: string) =>
  ({
    icalendar: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:s\r\nEND:VEVENT\r\nEND:VCALENDAR`,
  }) as never;

describe('a server that keeps its calendars elsewhere (Cirrux)', () => {
  it('makes the calendar in the home the server names, found by asking', async () => {
    const { writer, calls } = server(
      cirrux({
        [`MKCALENDAR ${BASE}${HOME}family/`]: { status: 201 },
        [`REPORT ${BASE}${HOME}family/`]: EMPTY_REPORT,
        [`PUT ${BASE}${HOME}family/event-1.ics`]: { status: 201, headers: { etag: '"e1"' } },
      }),
    );

    const calendarId = await writer.ensureCalendar(FAMILY);
    expect(calendarId).toBe(`${HOME}family/`);
    expect(made('MKCALENDAR', calls)).toEqual([`${ASSUMED_HOME}family/`, `${BASE}${HOME}family/`]);

    // The new calendar carries the folder's name and kinds, as one made where assumed does.
    const mkcalendar = calls.filter((c) => c.method === 'MKCALENDAR')[1]!;
    expect(mkcalendar.body).toContain('<D:displayname>Family</D:displayname>');
    expect(mkcalendar.body).toContain('<C:comp name="VEVENT"/>');

    const result = await writer.upsertCalendarEvent(calendarId, event('event-1'));
    expect(result.created).toBe(true);
    expect(result.targetId).toBe(`${HOME}family/event-1.ics`);
    expect(made('PUT', calls)).toEqual([`${BASE}${HOME}family/event-1.ics`]);
  });

  it('asks the principal for its calendar-home-set, at Depth 0, in the CalDAV namespace', async () => {
    const { writer, calls } = server(cirrux({ [`MKCALENDAR ${BASE}${HOME}family/`]: { status: 201 } }));
    await writer.ensureCalendar(FAMILY);

    const asked = calls.find((c) => c.method === 'PROPFIND' && c.url === `${BASE}${PRINCIPAL}`)!;
    expect(asked.depth).toBe('0');
    expect(asked.body).toContain('xmlns:C="urn:ietf:params:xml:ns:caldav"');
    expect(asked.body).toContain('<C:calendar-home-set/>');
    expect(calls.find((c) => c.url === `${BASE}/.well-known/caldav`)?.depth).toBe('0');
  });

  it('a second pass finds the calendar it made, by its path, and makes no other', async () => {
    const listed = [...CIRRUX_CALENDARS, { path: `${HOME}family/`, name: 'Family', holds: ['VEVENT'] }];
    const { writer, calls } = server(cirrux({}, listed));

    expect(await writer.ensureCalendar(FAMILY)).toBe(`${HOME}family/`);
    expect(made('MKCALENDAR', calls)).toEqual([`${ASSUMED_HOME}family/`]);
  });

  it('finds a calendar by its display name where its path names nothing', async () => {
    const listed = [...CIRRUX_CALENDARS, { path: `${HOME}5e6f70/`, name: 'Family', holds: ['VEVENT'] }];
    const { writer } = server(cirrux({}, listed));

    expect(await writer.ensureCalendar(FAMILY)).toBe(`${HOME}5e6f70/`);
  });

  it('a task list named as the server\'s own goes into it', async () => {
    const { writer, calls } = server(cirrux(), 'task');

    expect(await writer.ensureCalendar({ name: 'Reminders', path: '/x/reminders/', components: ['VTODO'] })).toBe(
      REMINDERS,
    );
    expect(made('MKCALENDAR', calls)).toEqual([`${ASSUMED_HOME}reminders/`]);
  });

  it('a calendar of that name that does not hold the kind is passed over', async () => {
    // A source task list called "Calendar", and the account's "Calendar" holds
    // events only: tasks written there would be refused. The name is taken, so
    // the server refuses a second one, and the one list that holds tasks takes them.
    const info = vi.spyOn(log, 'info').mockImplementation(() => undefined);
    const { writer } = server(cirrux({ [`MKCALENDAR ${BASE}${HOME}calendar/`]: { status: 405 } }), 'task');

    expect(await writer.ensureCalendar({ name: 'Calendar', path: '/x/calendar/', components: ['VTODO'] })).toBe(
      REMINDERS,
    );
    expect(info.mock.calls.flat().join(' ')).toContain(`its VTODO objects go into ${REMINDERS}`);
    info.mockRestore();
  });

  it('where no calendar can be made at all, the one that holds events takes them, and the log says so', async () => {
    const info = vi.spyOn(log, 'info').mockImplementation(() => undefined);
    const { writer, calls } = server(cirrux({ [`MKCALENDAR ${BASE}${HOME}family/`]: { status: 403 } }));

    expect(await writer.ensureCalendar(FAMILY)).toBe(DEFAULT_CALENDAR);
    expect(made('MKCALENDAR', calls)).toEqual([`${ASSUMED_HOME}family/`, `${BASE}${HOME}family/`]);
    expect(info.mock.calls.flat().join(' ')).toContain(`its VEVENT objects go into ${DEFAULT_CALENDAR}`);
    info.mockRestore();
  });

  it('several that hold the kind, none by that name: fails, names them, and does not guess', async () => {
    const listed = [...CIRRUX_CALENDARS, { path: `${HOME}d1e2f3/`, name: 'Holidays', holds: ['VEVENT'] }];
    const { writer } = server(cirrux({ [`MKCALENDAR ${BASE}${HOME}family/`]: { status: 403 } }, listed));

    const failure = writer.ensureCalendar(FAMILY);
    await expect(failure).rejects.toThrow(`MKCALENDAR failed for /calendars/${USER}/family/ with status 404`);
    await expect(failure).rejects.toThrow('2 at /calendars/7f3a/ that hold VEVENT, none of them by that name');
    await expect(failure).rejects.toThrow('(Calendar, Holidays)');
    await expect(failure).rejects.toThrow('not guessed');
  });

  it('a calendar that declares no kinds holds every kind, as RFC 4791 §5.2.3 says', async () => {
    const listed: Listed[] = [{ path: DEFAULT_CALENDAR, name: 'Calendar' }];
    const { writer } = server(cirrux({ [`MKCALENDAR ${BASE}${HOME}family/`]: { status: 403 } }, listed), 'task');

    expect(await writer.ensureCalendar({ name: 'Family', path: '/x/family/', components: ['VTODO'] })).toBe(
      DEFAULT_CALENDAR,
    );
  });

  it('reads the kinds a calendar declares in the default namespace too', async () => {
    // Prefixes are the server's to choose; the reader must not need one.
    const listing: Answer = {
      status: 207,
      body:
        '<multistatus xmlns="DAV:"><response><href>/calendars/7f3a/</href><propstat><prop>' +
        '<resourcetype><collection/></resourcetype></prop></propstat></response>' +
        `<response><href>${DEFAULT_CALENDAR}</href><propstat><prop><resourcetype><collection/>` +
        '<calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype><displayname>Calendar</displayname>' +
        '<supported-calendar-component-set xmlns="urn:ietf:params:xml:ns:caldav"><comp name="VEVENT"/>' +
        '</supported-calendar-component-set></prop></propstat></response>' +
        `<response><href>${REMINDERS}</href><propstat><prop><resourcetype><collection/>` +
        '<calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype><displayname>Reminders</displayname>' +
        "<supported-calendar-component-set xmlns=\"urn:ietf:params:xml:ns:caldav\"><comp name='VTODO'/>" +
        '</supported-calendar-component-set></prop></propstat></response></multistatus>',
    };
    const { writer } = server(
      cirrux({ [`PROPFIND ${BASE}${HOME}`]: listing, [`MKCALENDAR ${BASE}${HOME}family/`]: { status: 403 } }),
      'task',
    );

    expect(await writer.ensureCalendar({ name: 'Family', path: '/x/family/', components: ['VTODO'] })).toBe(
      REMINDERS,
    );
  });
});

describe('what is refused for another reason is reported as it always was', () => {
  it('a refusal that is not about the place asks nothing more', async () => {
    const { writer, calls } = server({ [`MKCALENDAR ${ASSUMED_HOME}family/`]: { status: 401, body: 'Unauthorized' } });

    await expect(writer.ensureCalendar(FAMILY)).rejects.toThrow(
      `MKCALENDAR failed for /calendars/${USER}/family/ with status 401`,
    );
    expect(calls.some((c) => c.url.includes('.well-known'))).toBe(false);
    expect(made('MKCALENDAR', calls)).toHaveLength(1);
  });

  it('a refusal in the named home that is not about the place is reported, not passed over', async () => {
    const { writer } = server(cirrux({ [`MKCALENDAR ${BASE}${HOME}family/`]: { status: 400, body: 'bad body' } }));

    await expect(writer.ensureCalendar(FAMILY)).rejects.toThrow(
      'MKCALENDAR failed for /calendars/7f3a/family/ with status 400',
    );
  });

  it('a home that cannot be found says so, after the first refusal', async () => {
    // The well-known address and the base both answer nothing.
    const { writer } = server({});

    const failure = writer.ensureCalendar(FAMILY);
    await expect(failure).rejects.toThrow(`MKCALENDAR failed for /calendars/${USER}/family/ with status 404`);
    await expect(failure).rejects.toThrow("Looking for this account's own calendars failed too");
    await expect(failure).rejects.toThrow(`PROPFIND on calendar home set /calendars/${USER}/ failed with status 404`);
  });

  it('a principal on another host is not followed', async () => {
    const { writer, calls } = server({
      [`PROPFIND ${BASE}/.well-known/caldav`]: principalAt('https://elsewhere.example.org/principals/7f3a/'),
    });

    await expect(writer.ensureCalendar(FAMILY)).rejects.toThrow("Looking for this account's own calendars failed too");
    expect(calls.some((c) => c.url.startsWith('https://elsewhere.example.org'))).toBe(false);
  });

  it('a home the base names, where the well-known address names none, is used', async () => {
    const { writer } = server({
      [`PROPFIND ${BASE}/`]: principalAt(PRINCIPAL),
      [`PROPFIND ${BASE}${PRINCIPAL}`]: calendarHomeAt(PRINCIPAL, HOME),
      [`PROPFIND ${BASE}${HOME}`]: calendarsAt(HOME, CIRRUX_CALENDARS),
      [`MKCALENDAR ${BASE}${HOME}family/`]: { status: 201 },
    });

    expect(await writer.ensureCalendar(FAMILY)).toBe(`${HOME}family/`);
  });

  it('the home is asked for once per writer, not once per calendar', async () => {
    const { writer, calls } = server(
      cirrux({
        [`MKCALENDAR ${BASE}${HOME}family/`]: { status: 201 },
        [`MKCALENDAR ${BASE}${HOME}work/`]: { status: 201 },
      }),
    );

    await writer.ensureCalendar(FAMILY);
    await writer.ensureCalendar({ name: 'Work', path: '/x/work/', components: ['VEVENT'] });
    expect(calls.filter((c) => c.url === `${BASE}/.well-known/caldav`)).toHaveLength(1);
  });
});

describe('verification reads the calendars where the server keeps them', () => {
  it('lists the calendars in the home the server names', async () => {
    const { writer, calls } = server(
      cirrux({ [`REPORT ${BASE}${DEFAULT_CALENDAR}`]: EMPTY_REPORT, [`REPORT ${BASE}${REMINDERS}`]: EMPTY_REPORT }),
    );

    const entries = [];
    for await (const entry of writer.listEntries()) entries.push(entry);
    expect(entries).toEqual([]);
    expect(made('REPORT', calls)).toEqual([`${BASE}${DEFAULT_CALENDAR}`, `${BASE}${REMINDERS}`]);
  });

  it('an assumed home that lists no calendar is not taken as an empty account while the server names another', async () => {
    const { writer, calls } = server(
      cirrux({
        [`PROPFIND ${ASSUMED_HOME}`]: calendarsAt(`/calendars/${USER}/`, []),
        [`REPORT ${BASE}${DEFAULT_CALENDAR}`]: EMPTY_REPORT,
        [`REPORT ${BASE}${REMINDERS}`]: EMPTY_REPORT,
      }),
    );

    for await (const _entry of writer.listEntries()) void _entry;
    expect(made('REPORT', calls)).toEqual([`${BASE}${DEFAULT_CALENDAR}`, `${BASE}${REMINDERS}`]);
  });

  it('a named home that cannot be listed fails loudly: an empty list would read as every event lost', async () => {
    const { writer } = server(cirrux({ [`PROPFIND ${BASE}${HOME}`]: { status: 503, body: 'busy' } }));

    const listing = (async () => {
      for await (const _entry of writer.listEntries()) void _entry;
    })();
    await expect(listing).rejects.toThrow('PROPFIND on calendar home set /calendars/7f3a/ failed with status 503');
  });
});

describe("a server with Nextcloud's layout sends the same requests as before", () => {
  it('an assumed calendar that exists is used, and nothing is discovered', async () => {
    const { writer, calls } = server({ [`PROPFIND ${ASSUMED_HOME}family/`]: { status: 207, body: multistatus() } });

    expect(await writer.ensureCalendar(FAMILY)).toBe(`/calendars/${USER}/family/`);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`PROPFIND ${ASSUMED_HOME}family/`]);
  });

  it('a calendar made where assumed is used, and nothing is discovered', async () => {
    const { writer, calls } = server({ [`MKCALENDAR ${ASSUMED_HOME}family/`]: { status: 201 } });

    expect(await writer.ensureCalendar(FAMILY)).toBe(`/calendars/${USER}/family/`);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `PROPFIND ${ASSUMED_HOME}family/`,
      `MKCALENDAR ${ASSUMED_HOME}family/`,
    ]);
  });

  it('an assumed home with calendars in it is listed, and nothing is discovered', async () => {
    const personal = `/calendars/${USER}/personal/`;
    const { writer, calls } = server({
      [`PROPFIND ${ASSUMED_HOME}`]: calendarsAt(`/calendars/${USER}/`, [{ path: personal, name: 'Personal' }]),
      [`REPORT ${BASE}${personal}`]: EMPTY_REPORT,
    });

    for await (const _entry of writer.listEntries()) void _entry;
    expect(calls.some((c) => c.url.includes('.well-known'))).toBe(false);
    expect(made('REPORT', calls)).toEqual([`${BASE}${personal}`]);
  });
});
