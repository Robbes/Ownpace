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
import {
  CalDAVTargetWriter,
  newCalendarSegment,
  type HttpClient,
  type CalDavLedgerDomain,
} from './caldav-target-writer.ts';

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

/** Where a new calendar in the named home is asked for: a UUID of the writer's own, the same on every pass. */
const newAt = (slug: string, domain: CalDavLedgerDomain = 'calendar') =>
  `${HOME}${newCalendarSegment(USER, domain, slug)}/`;
const FAMILY_NEW = newAt('family');

/** A Depth-0 read-back that finds a calendar at `path`. */
const there = (path: string): Answer => ({
  status: 207,
  body: multistatus(propResponse(path, '<d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>')),
});

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

const asked = (method: string, calls: Call[]) => calls.filter((c) => c.method === method).map((c) => c.url);

const event = (uid: string) =>
  ({
    icalendar: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:s\r\nEND:VEVENT\r\nEND:VCALENDAR`,
  }) as never;

describe('a server that keeps its calendars elsewhere (Cirrux)', () => {
  it('makes the calendar in the home the server names, found by asking', async () => {
    const { writer, calls } = server(
      cirrux({
        [`MKCALENDAR ${BASE}${FAMILY_NEW}`]: { status: 201 },
        [`PROPFIND ${BASE}${FAMILY_NEW}`]: there(FAMILY_NEW),
        [`REPORT ${BASE}${FAMILY_NEW}`]: EMPTY_REPORT,
        [`PUT ${BASE}${FAMILY_NEW}event-1.ics`]: { status: 201, headers: { etag: '"e1"' } },
      }),
    );

    const calendarId = await writer.ensureCalendar(FAMILY);
    expect(calendarId).toBe(FAMILY_NEW);
    expect(asked('MKCALENDAR', calls)).toEqual([`${ASSUMED_HOME}family/`, `${BASE}${FAMILY_NEW}`]);

    // The new calendar carries the folder's name and kinds, as one made where assumed does.
    const mkcalendar = calls.filter((c) => c.method === 'MKCALENDAR')[1]!;
    expect(mkcalendar.body).toContain('<D:displayname>Family</D:displayname>');
    expect(mkcalendar.body).toContain('<C:comp name="VEVENT"/>');

    const result = await writer.upsertCalendarEvent(calendarId, event('event-1'));
    expect(result.created).toBe(true);
    expect(result.targetId).toBe(`${FAMILY_NEW}event-1.ics`);
    expect(asked('PUT', calls)).toEqual([`${BASE}${FAMILY_NEW}event-1.ics`]);
  });

  it('asks the principal for its calendar-home-set, at Depth 0, in the CalDAV namespace', async () => {
    const { writer, calls } = server(
      cirrux({ [`MKCALENDAR ${BASE}${FAMILY_NEW}`]: { status: 201 }, [`PROPFIND ${BASE}${FAMILY_NEW}`]: there(FAMILY_NEW) }),
    );
    await writer.ensureCalendar(FAMILY);

    const asked = calls.find((c) => c.method === 'PROPFIND' && c.url === `${BASE}${PRINCIPAL}`)!;
    expect(asked.depth).toBe('0');
    expect(asked.body).toContain('xmlns:C="urn:ietf:params:xml:ns:caldav"');
    expect(asked.body).toContain('<C:calendar-home-set/>');
    expect(calls.find((c) => c.url === `${BASE}/.well-known/caldav`)?.depth).toBe('0');
  });

  it('a second pass finds the calendar it made by its address, renamed since, and makes no other', async () => {
    const listed = [...CIRRUX_CALENDARS, { path: FAMILY_NEW, name: 'Renamed by its owner', holds: ['VEVENT'] }];
    const { writer, calls } = server(cirrux({}, listed));

    expect(await writer.ensureCalendar(FAMILY)).toBe(FAMILY_NEW);
    expect(asked('MKCALENDAR', calls)).toEqual([`${ASSUMED_HOME}family/`]);
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
    expect(asked('MKCALENDAR', calls)).toEqual([`${ASSUMED_HOME}reminders/`]);
  });

  it('a calendar of that name that does not hold the kind is passed over', async () => {
    // A source task list called "Calendar", and the account's "Calendar" holds
    // events only: tasks written there would be refused. The name is taken, so
    // the server refuses a second one, and the one list that holds tasks takes them.
    const info = vi.spyOn(log, 'info').mockImplementation(() => undefined);
    const { writer } = server(cirrux({ [`MKCALENDAR ${BASE}${newAt('calendar', 'task')}`]: { status: 405 } }), 'task');

    expect(await writer.ensureCalendar({ name: 'Calendar', path: '/x/calendar/', components: ['VTODO'] })).toBe(
      REMINDERS,
    );
    expect(info.mock.calls.flat().join(' ')).toContain(`its VTODO objects go into ${REMINDERS}`);
    info.mockRestore();
  });

  it('where no calendar can be made at all, the one that holds events takes them, and the log says so', async () => {
    const info = vi.spyOn(log, 'info').mockImplementation(() => undefined);
    const { writer, calls } = server(cirrux({ [`MKCALENDAR ${BASE}${FAMILY_NEW}`]: { status: 403 } }));

    expect(await writer.ensureCalendar(FAMILY)).toBe(DEFAULT_CALENDAR);
    expect(asked('MKCALENDAR', calls)).toEqual([`${ASSUMED_HOME}family/`, `${BASE}${FAMILY_NEW}`]);
    expect(info.mock.calls.flat().join(' ')).toContain(`its VEVENT objects go into ${DEFAULT_CALENDAR}`);
    info.mockRestore();
  });

  it('several that hold the kind, none by that name: fails, names them, and does not guess', async () => {
    const listed = [...CIRRUX_CALENDARS, { path: `${HOME}d1e2f3/`, name: 'Holidays', holds: ['VEVENT'] }];
    const { writer } = server(cirrux({ [`MKCALENDAR ${BASE}${FAMILY_NEW}`]: { status: 403 } }, listed));

    const failure = writer.ensureCalendar(FAMILY);
    await expect(failure).rejects.toThrow(`MKCALENDAR failed for /calendars/${USER}/family/ with status 404`);
    await expect(failure).rejects.toThrow('2 at /calendars/7f3a/ that hold VEVENT, none of them by that name');
    await expect(failure).rejects.toThrow('(Calendar, Holidays)');
    await expect(failure).rejects.toThrow('not guessed');
  });

  it('a calendar that declares no kinds holds every kind, as RFC 4791 §5.2.3 says', async () => {
    const listed: Listed[] = [{ path: DEFAULT_CALENDAR, name: 'Calendar' }];
    const { writer } = server(cirrux({ [`MKCALENDAR ${BASE}${newAt('family', 'task')}`]: { status: 403 } }, listed), 'task');

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
      cirrux({ [`PROPFIND ${BASE}${HOME}`]: listing, [`MKCALENDAR ${BASE}${newAt('family', 'task')}`]: { status: 403 } }),
      'task',
    );

    expect(await writer.ensureCalendar({ name: 'Family', path: '/x/family/', components: ['VTODO'] })).toBe(
      REMINDERS,
    );
  });
});

describe('a calendar the server says it made is read back (Cirrux, 2026-11-19)', () => {
  // On the test mailbox, an MKCALENDAR at a name of ours was answered 201,
  // and Cirrux showed the new calendar, named as asked. Every event then
  // written to that address was refused with 404: Cirrux keeps its calendars
  // under ids of its own (https://cirrux.co/help/api/calendar).

  it('a new calendar in a named home is asked for at a UUID, the same one on every pass', async () => {
    const routes = () =>
      cirrux({ [`MKCALENDAR ${BASE}${FAMILY_NEW}`]: { status: 201 }, [`PROPFIND ${BASE}${FAMILY_NEW}`]: there(FAMILY_NEW) });
    const first = server(routes());
    const second = server(routes());
    await first.writer.ensureCalendar(FAMILY);
    await second.writer.ensureCalendar(FAMILY);

    expect(asked('MKCALENDAR', first.calls)[1]).toBe(`${BASE}${FAMILY_NEW}`);
    expect(asked('MKCALENDAR', second.calls)[1]).toBe(`${BASE}${FAMILY_NEW}`);
    // Version 5's shape for every name, not only for this one.
    for (const slug of ['family', 'work', 'holidays', 'reminders', 'a', 'b', 'c', 'd']) {
      expect(newAt(slug), slug).toMatch(/\/[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/$/);
    }
    // A task list of the same name, or another account's calendar, is another collection.
    expect(newAt('family', 'task')).not.toBe(FAMILY_NEW);
    expect(newCalendarSegment('someone@example.org', 'calendar', 'family')).not.toBe(
      newCalendarSegment(USER, 'calendar', 'family'),
    );
  });

  it('a calendar the server made under an id of its own is found in the home, and the events go there', async () => {
    const SERVER_ID = `${HOME}c0ffee00-0000-4000-8000-000000000001/`;
    let made = false;
    const { writer, calls } = server(
      cirrux({
        [`MKCALENDAR ${BASE}${FAMILY_NEW}`]: () => {
          made = true;
          return { status: 201 };
        },
        [`PROPFIND ${BASE}${HOME}`]: () =>
          calendarsAt(
            HOME,
            made ? [...CIRRUX_CALENDARS, { path: SERVER_ID, name: 'Family', holds: ['VEVENT'] }] : CIRRUX_CALENDARS,
          ),
        [`REPORT ${BASE}${SERVER_ID}`]: EMPTY_REPORT,
        [`PUT ${BASE}${SERVER_ID}event-1.ics`]: { status: 201, headers: { etag: '"e1"' } },
      }),
    );
    const info = vi.spyOn(log, 'info').mockImplementation(() => undefined);

    const calendarId = await writer.ensureCalendar(FAMILY);
    expect(calendarId).toBe(SERVER_ID);
    expect(info.mock.calls.flat().join(' ')).toContain(`made Family at ${SERVER_ID}`);
    info.mockRestore();

    const result = await writer.upsertCalendarEvent(calendarId, event('event-1'));
    expect(result.created).toBe(true);
    expect(asked('PUT', calls)).toEqual([`${BASE}${SERVER_ID}event-1.ics`]);
  });

  it('an address that answers but holds no calendar is not taken for the one made', async () => {
    const SERVER_ID = `${HOME}c0ffee00-0000-4000-8000-000000000003/`;
    const PLAIN = `${HOME}not-a-calendar/`;
    let made = false;
    const { writer } = server(
      cirrux({
        [`MKCALENDAR ${BASE}${FAMILY_NEW}`]: () => {
          made = true;
          return { status: 201, headers: { location: PLAIN } };
        },
        // Both answer 207, and neither holds a calendar.
        [`PROPFIND ${BASE}${FAMILY_NEW}`]: { status: 207, body: multistatus() },
        [`PROPFIND ${BASE}${PLAIN}`]: {
          status: 207,
          body: multistatus(propResponse(PLAIN, '<d:resourcetype><d:collection/></d:resourcetype>')),
        },
        [`PROPFIND ${BASE}${HOME}`]: () =>
          calendarsAt(
            HOME,
            made ? [...CIRRUX_CALENDARS, { path: SERVER_ID, name: 'Family', holds: ['VEVENT'] }] : CIRRUX_CALENDARS,
          ),
      }),
    );

    expect(await writer.ensureCalendar(FAMILY)).toBe(SERVER_ID);
  });

  it('the address the answer gives in its Location is followed', async () => {
    const SERVER_ID = `${HOME}c0ffee00-0000-4000-8000-000000000002/`;
    const { writer } = server(
      cirrux({
        [`MKCALENDAR ${BASE}${FAMILY_NEW}`]: { status: 201, headers: { location: SERVER_ID } },
        [`PROPFIND ${BASE}${SERVER_ID}`]: there(SERVER_ID),
      }),
    );

    expect(await writer.ensureCalendar(FAMILY)).toBe(SERVER_ID);
  });

  it('a Location on another host is not followed', async () => {
    const { writer, calls } = server(
      cirrux({
        [`MKCALENDAR ${BASE}${FAMILY_NEW}`]: {
          status: 201,
          headers: { location: 'https://elsewhere.example.org/calendars/1/' },
        },
        // The same path on this host holds a calendar: a foreign Location must not be read as it.
        [`PROPFIND ${BASE}/calendars/1/`]: there('/calendars/1/'),
      }),
    );

    await expect(writer.ensureCalendar(FAMILY)).rejects.toThrow('was answered 201, but no calendar is there');
    expect(calls.some((c) => c.url.startsWith('https://elsewhere.example.org'))).toBe(false);
  });

  it('a 201 with no calendar anywhere fails, and says what was asked for', async () => {
    const { writer } = server(cirrux({ [`MKCALENDAR ${BASE}${FAMILY_NEW}`]: { status: 201 } }));

    const failure = writer.ensureCalendar(FAMILY);
    await expect(failure).rejects.toThrow(`MKCALENDAR for ${FAMILY_NEW} was answered 201, but no calendar is there`);
    await expect(failure).rejects.toThrow(`${HOME} lists no new calendar that holds VEVENT`);
  });

  it('several new calendars after the 201, none by that name, are not guessed between', async () => {
    let made = false;
    const { writer } = server(
      cirrux({
        [`MKCALENDAR ${BASE}${FAMILY_NEW}`]: () => {
          made = true;
          return { status: 201 };
        },
        [`PROPFIND ${BASE}${HOME}`]: () =>
          calendarsAt(
            HOME,
            made
              ? [
                  ...CIRRUX_CALENDARS,
                  { path: `${HOME}aaaa0000/`, name: 'One', holds: ['VEVENT'] },
                  { path: `${HOME}bbbb0000/`, name: 'Two', holds: ['VEVENT'] },
                ]
              : CIRRUX_CALENDARS,
          ),
      }),
    );

    await expect(writer.ensureCalendar(FAMILY)).rejects.toThrow(
      'lists 2 new ones that hold VEVENT, none of them by that name (One, Two)',
    );
  });

  it('of two new calendars after the 201, the one with the folder\'s name is taken', async () => {
    let made = false;
    const { writer } = server(
      cirrux({
        [`MKCALENDAR ${BASE}${FAMILY_NEW}`]: () => {
          made = true;
          return { status: 201 };
        },
        [`PROPFIND ${BASE}${HOME}`]: () =>
          calendarsAt(
            HOME,
            made
              ? [
                  ...CIRRUX_CALENDARS,
                  { path: `${HOME}aaaa0000/`, name: 'Someone else', holds: ['VEVENT'] },
                  { path: `${HOME}bbbb0000/`, name: 'Family', holds: ['VEVENT'] },
                ]
              : CIRRUX_CALENDARS,
          ),
      }),
    );

    expect(await writer.ensureCalendar(FAMILY)).toBe(`${HOME}bbbb0000/`);
  });

  it('an event refused with 404 says so when its calendar is not on the server', async () => {
    const MISSING = `${HOME}not-there/`;
    const { writer } = server({
      [`REPORT ${BASE}${MISSING}`]: EMPTY_REPORT,
      [`PUT ${BASE}${MISSING}event-1.ics`]: { status: 404, body: 'Not Found' },
    });

    await expect(writer.upsertCalendarEvent(MISSING, event('event-1'))).rejects.toThrow(
      `PUT failed for ${MISSING}event-1.ics with status 404: the calendar ${MISSING} is not on the server`,
    );
  });

  it('an event refused with 404 into a calendar that is there keeps the server\'s own words alone', async () => {
    const HERE = `${HOME}here/`;
    const { writer } = server({
      [`REPORT ${BASE}${HERE}`]: EMPTY_REPORT,
      [`PROPFIND ${BASE}${HERE}`]: there(HERE),
      [`PUT ${BASE}${HERE}event-1.ics`]: { status: 404, body: 'Not Found' },
    });

    const message = await writer.upsertCalendarEvent(HERE, event('event-1')).then(
      () => '',
      (err: Error) => err.message,
    );
    expect(message).toContain(`PUT failed for ${HERE}event-1.ics with status 404`);
    expect(message).not.toContain('is not on the server');
  });
});

describe('what is refused for another reason is reported as it always was', () => {
  it('a refusal that is not about the place asks nothing more', async () => {
    const { writer, calls } = server({ [`MKCALENDAR ${ASSUMED_HOME}family/`]: { status: 401, body: 'Unauthorized' } });

    await expect(writer.ensureCalendar(FAMILY)).rejects.toThrow(
      `MKCALENDAR failed for /calendars/${USER}/family/ with status 401`,
    );
    expect(calls.some((c) => c.url.includes('.well-known'))).toBe(false);
    expect(asked('MKCALENDAR', calls)).toHaveLength(1);
  });

  it('a refusal in the named home that is not about the place is reported, not passed over', async () => {
    const { writer } = server(cirrux({ [`MKCALENDAR ${BASE}${FAMILY_NEW}`]: { status: 400, body: 'bad body' } }));

    await expect(writer.ensureCalendar(FAMILY)).rejects.toThrow(`MKCALENDAR failed for ${FAMILY_NEW} with status 400`);
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
      [`MKCALENDAR ${BASE}${FAMILY_NEW}`]: { status: 201 },
      [`PROPFIND ${BASE}${FAMILY_NEW}`]: there(FAMILY_NEW),
    });

    expect(await writer.ensureCalendar(FAMILY)).toBe(FAMILY_NEW);
  });

  it('the home is asked for once per writer, not once per calendar', async () => {
    const { writer, calls } = server(
      cirrux({
        [`MKCALENDAR ${BASE}${FAMILY_NEW}`]: { status: 201 },
        [`PROPFIND ${BASE}${FAMILY_NEW}`]: there(FAMILY_NEW),
        [`MKCALENDAR ${BASE}${newAt('work')}`]: { status: 201 },
        [`PROPFIND ${BASE}${newAt('work')}`]: there(newAt('work')),
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
    expect(asked('REPORT', calls)).toEqual([`${BASE}${DEFAULT_CALENDAR}`, `${BASE}${REMINDERS}`]);
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
    expect(asked('REPORT', calls)).toEqual([`${BASE}${DEFAULT_CALENDAR}`, `${BASE}${REMINDERS}`]);
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
    expect(asked('REPORT', calls)).toEqual([`${BASE}${personal}`]);
  });
});
