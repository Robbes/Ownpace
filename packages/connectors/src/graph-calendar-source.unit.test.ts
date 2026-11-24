// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE GRAPH CALENDAR SOURCE, AGAINST GRAPH AS v1.0 DOCUMENTS IT.
 *
 * Rebuilt 2026-11-24, after a personal Microsoft account's four calendars
 * listed no event at all (`graph-calendar-source.ts`, header). Every answer
 * here comes from `__testing__/graph-calendar-fake.ts`, which answers by
 * method and address, in the JSON shape Microsoft's pages show, and refuses a
 * call v1.0 does not document. The old tests answered by call order.
 *
 * Each VEVENT is read back through the repository's own iCalendar reading
 * (`@openmig/shared`): the parser the window and the targets use, its times,
 * and the component a target asks its server for.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  componentOfIcalendar,
  componentsNamed,
  declaredZones,
  eventInWindow,
  icalTimeToIso,
  latestEnd,
  naturalKeyForCalendar,
  neutraliseScheduling,
  parseIcalComponents,
  type IcalComponent,
  type OAuth2Token,
  type RawCalendarEvent,
  type TokenProvider,
} from '@openmig/shared';
import { GraphCalendarSource } from './graph-calendar-source.ts';
import type { GraphEvent } from './graph-calendar-source.types.ts';
import { fakeGraphCalendars, type FakeCalendar } from './__testing__/graph-calendar-fake.ts';

const TOKEN: OAuth2Token = { accessToken: 'token', tokenType: 'Bearer', expiresAt: Date.now() + 3_600_000 };
const tokens: TokenProvider = {
  getToken: vi.fn().mockResolvedValue(TOKEN),
  refresh: vi.fn().mockResolvedValue(TOKEN),
  isTokenValid: vi.fn().mockReturnValue(true),
  getTokenStatus: vi.fn().mockReturnValue({ isValid: true, timeUntilExpiry: 3600 }),
} as unknown as TokenProvider;

// ---------------------------------------------------------------------------
// Fixtures, in the shape `calendar-list-events` and `event-get` answer with.
// Times are UTC, as Graph sends them with no `Prefer: outlook.timezone`.
// ---------------------------------------------------------------------------

/** Every Wednesday 19:00–20:00 in Amsterdam's zone, from 2 September 2026, no end. */
const WEDNESDAY: GraphEvent = {
  id: 'AAMk-wed',
  iCalUId: '040000008200E00074C5B7101A82E00800000000WEDNESDAY',
  changeKey: 'ck-wed-1',
  createdDateTime: '2026-08-20T10:00:00.1234567Z',
  lastModifiedDateTime: '2026-08-21T10:00:00.1234567Z',
  subject: 'Choir',
  body: { contentType: 'html', content: '<html><body><p>Bring the <b>new</b> scores</p></body></html>' },
  start: { dateTime: '2026-09-02T17:00:00.0000000', timeZone: 'UTC' },
  end: { dateTime: '2026-09-02T18:00:00.0000000', timeZone: 'UTC' },
  originalStartTimeZone: 'W. Europe Standard Time',
  originalEndTimeZone: 'W. Europe Standard Time',
  location: { displayName: 'Church hall' },
  isAllDay: false,
  isCancelled: false,
  isReminderOn: true,
  reminderMinutesBeforeStart: 15,
  type: 'seriesMaster',
  recurrence: {
    pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'], firstDayOfWeek: 'sunday' },
    range: { type: 'noEnd', startDate: '2026-09-02', recurrenceTimeZone: 'W. Europe Standard Time' },
  },
  showAs: 'busy',
  sensitivity: 'normal',
  categories: ['Music'],
  organizer: { emailAddress: { name: 'Account owner', address: 'owner@example.org' } },
};

/** 14 October moved an hour later, before daylight saving time ends on 25 October. */
const WEDNESDAY_MOVED: GraphEvent = {
  ...WEDNESDAY,
  id: 'AAMk-wed-x1',
  iCalUId: '040000008200E00074C5B7101A82E00807EA0A0E00000000WEDNESDAY',
  changeKey: 'ck-wed-x1-1',
  type: 'exception',
  seriesMasterId: 'AAMk-wed',
  occurrenceId: 'OID.AAMk-wed.2026-10-14',
  originalStart: '2026-10-14T17:00:00Z',
  subject: 'Choir (later)',
  start: { dateTime: '2026-10-14T18:00:00.0000000', timeZone: 'UTC' },
  end: { dateTime: '2026-10-14T19:00:00.0000000', timeZone: 'UTC' },
  recurrence: null,
};

/** Christmas, on a holiday calendar the account may only read. */
const CHRISTMAS: GraphEvent = {
  id: 'AAMk-xmas',
  iCalUId: 'holiday-nl-2026-12-25',
  changeKey: 'ck-xmas',
  subject: 'Christmas Day',
  start: { dateTime: '2026-12-25T00:00:00.0000000', timeZone: 'UTC' },
  end: { dateTime: '2026-12-26T00:00:00.0000000', timeZone: 'UTC' },
  originalStartTimeZone: 'tzone://Microsoft/Utc',
  originalEndTimeZone: 'tzone://Microsoft/Utc',
  isAllDay: true,
  isCancelled: false,
  isReminderOn: false,
  type: 'singleInstance',
  showAs: 'free',
  sensitivity: 'normal',
  categories: ['Holiday'],
};

/** 30 November 09:00 to 2 December 17:00, in Paris's zone. */
const TRIP: GraphEvent = {
  id: 'AAMk-trip',
  iCalUId: 'trip-uid',
  changeKey: 'ck-trip',
  subject: 'Conference',
  start: { dateTime: '2026-11-30T08:00:00.0000000', timeZone: 'UTC' },
  end: { dateTime: '2026-12-02T16:00:00.0000000', timeZone: 'UTC' },
  originalStartTimeZone: 'Romance Standard Time',
  originalEndTimeZone: 'Romance Standard Time',
  location: {
    displayName: 'Congress centre',
    address: { street: 'Main street 1', city: 'Lyon', postalCode: '69001', countryOrRegion: 'France' },
  },
  isAllDay: false,
  type: 'singleInstance',
  showAs: 'oof',
};

/** Mondays 10:00 in Los Angeles, four of them, across the end of daylight saving time on 1 November. */
const PACIFIC_SERIES: GraphEvent = {
  id: 'AAMk-pst',
  iCalUId: 'pacific-series',
  changeKey: 'ck-pst',
  subject: 'Call with the west coast',
  start: { dateTime: '2026-10-26T17:00:00.0000000', timeZone: 'UTC' },
  end: { dateTime: '2026-10-26T17:30:00.0000000', timeZone: 'UTC' },
  originalStartTimeZone: 'Pacific Standard Time',
  originalEndTimeZone: 'Pacific Standard Time',
  isAllDay: false,
  type: 'seriesMaster',
  recurrence: {
    pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'], firstDayOfWeek: 'sunday' },
    range: { type: 'numbered', startDate: '2026-10-26', numberOfOccurrences: 4 },
  },
};

/** A private appointment. */
const DOCTOR: GraphEvent = {
  id: 'AAMk-doc',
  iCalUId: 'doctor-uid',
  changeKey: 'ck-doc',
  subject: 'Doctor',
  start: { dateTime: '2026-12-03T08:30:00.0000000', timeZone: 'UTC' },
  end: { dateTime: '2026-12-03T09:00:00.0000000', timeZone: 'UTC' },
  originalStartTimeZone: 'W. Europe Standard Time',
  isAllDay: false,
  type: 'singleInstance',
  sensitivity: 'private',
};

/** A meeting with guests. */
const MEETING: GraphEvent = {
  id: 'AAMk-meet',
  iCalUId: 'meeting-uid',
  changeKey: 'ck-meet',
  subject: 'Planning; budget, 2027',
  start: { dateTime: '2026-12-07T13:00:00.0000000', timeZone: 'UTC' },
  end: { dateTime: '2026-12-07T14:00:00.0000000', timeZone: 'UTC' },
  originalStartTimeZone: 'W. Europe Standard Time',
  isAllDay: false,
  type: 'singleInstance',
  showAs: 'tentative',
  organizer: { emailAddress: { name: 'Organiser "Org"', address: 'organiser@example.org' } },
  attendees: [
    { type: 'required', status: { response: 'accepted' }, emailAddress: { name: 'Ada', address: 'ada@example.org' } },
    { type: 'optional', status: { response: 'tentativelyAccepted' }, emailAddress: { address: 'bob@example.org' } },
    { type: 'resource', status: { response: 'none' }, emailAddress: { name: 'Room 1', address: 'room1@example.org' } },
  ],
};

function account(): FakeCalendar[] {
  return [
    {
      id: 'cal-main',
      name: 'Calendar',
      events: [WEDNESDAY, TRIP, PACIFIC_SERIES, DOCTOR, MEETING],
      series: {
        'AAMk-wed': { exceptions: [WEDNESDAY_MOVED], cancelled: ['OID.AAMk-wed.2026-10-28'] },
        'AAMk-pst': {},
      },
    },
    { id: 'cal-holidays', name: 'Holidays in the Netherlands', canEdit: false, events: [CHRISTMAS] },
  ];
}

function sourceOn(calendars: FakeCalendar[], pageSize?: number) {
  const fake = fakeGraphCalendars(calendars, pageSize ? { pageSize } : {});
  return { ...fake, source: new GraphCalendarSource(tokens, 'tenant', undefined, { httpClient: fake.client }) };
}

async function listed(calendars = account(), folderId = 'cal-main') {
  const { source, requests } = sourceOn(calendars);
  const folders = await source.listFolders();
  const folder = folders.find((f) => f.path === `/calendars/${folderId}`)!;
  return { result: await source.listSince(folder), requests, source, folder };
}

const byUid = (items: ReadonlyArray<RawCalendarEvent>, uid: string): RawCalendarEvent => {
  const found = items.find((i) => i.item.uid === uid);
  if (!found) throw new Error(`no item ${uid} among ${items.map((i) => i.item.uid).join(', ')}`);
  return found;
};

/** The VEVENTs of an object, through the repository's own parser. */
function vevents(raw: RawCalendarEvent): IcalComponent[] {
  return componentsNamed(parseIcalComponents(raw.icalendar), 'VEVENT');
}

const prop = (c: IcalComponent, name: string) => c.properties.find((p) => p.name === name);
const props = (c: IcalComponent, name: string) => c.properties.filter((p) => p.name === name);

/** A time property as an instant, read the way the window and the targets read it. */
function instant(raw: RawCalendarEvent, c: IcalComponent, name: string): string | undefined {
  const p = prop(c, name);
  return p ? icalTimeToIso(p, declaredZones(parseIcalComponents(raw.icalendar))) : undefined;
}

describe('the calendars', () => {
  it('lists every calendar, a read-only holiday calendar too, as one that holds events', async () => {
    const { source } = sourceOn(account());
    const folders = await source.listFolders();
    expect(folders.map((f) => [f.path, f.name, f.components])).toEqual([
      ['/calendars/cal-main', 'Calendar', ['VEVENT']],
      ['/calendars/cal-holidays', 'Holidays in the Netherlands', ['VEVENT']],
    ]);
  });

  it('a 403 listing calendars names the scope and the tick, in Graph’s words, without the envelope (0114 T6)', async () => {
    const source = new GraphCalendarSource(tokens, 'tenant', undefined, {
      httpClient: {
        request: async () => ({
          status: 403,
          body: JSON.stringify({
            error: {
              code: 'Authorization_RequestDenied',
              message: 'Insufficient privileges to complete the operation.',
              innerError: { date: '2026-09-05T09:40:11', 'request-id': 'r-1', 'client-request-id': 'c-1' },
            },
          }),
          headers: {},
        }),
      },
    });
    const failure = await source.listFolders().then(
      () => 'listed',
      (err: unknown) => (err instanceof Error ? err.message : String(err)),
    );
    expect(failure).toContain('Failed to list calendars: 403 - Authorization_RequestDenied — Insufficient privileges');
    expect(failure).toContain('does not include Calendars.Read');
    expect(failure).toContain('reconnect the account with Calendar ticked');
    expect(failure).not.toContain('{"error"');
    expect(failure).not.toContain('request-id');
  });
});

describe('the listing', () => {
  it('lists the events with $select, follows every page, and reads each series once more', async () => {
    const calendars = account();
    const { source, requests } = sourceOn(calendars, 2);
    const result = await source.listSince({ path: '/calendars/cal-main', name: 'Calendar' });

    expect(result.items.map((i) => i.item.uid).sort()).toEqual(
      [WEDNESDAY.iCalUId, 'doctor-uid', 'meeting-uid', 'pacific-series', 'trip-uid'].sort(),
    );
    const paths = requests.map((r) => new URL(r.url));
    const listings = paths.filter((u) => u.pathname.endsWith('/calendars/cal-main/events'));
    expect(listings).toHaveLength(3);
    for (const u of listings) {
      expect(u.searchParams.get('$select')).toContain('iCalUId');
      expect(u.searchParams.get('$select')).toContain('recurrence');
    }
    // One read per series master, for its exceptions and cancellations; none for a single event.
    expect(paths.filter((u) => /\/events\/[^/]+$/.test(u.pathname)).map((u) => u.pathname.split('/').pop()).sort()).toEqual([
      'AAMk-pst',
      'AAMk-wed',
    ]);
    expect(result.unreadable).toBeUndefined();
  });

  it('a calendar Graph will not list throws, naming the calendar; it never lists as empty', async () => {
    const calendars = account();
    calendars[1]!.refuse = { status: 403, code: 'ErrorAccessDenied', message: 'Access is denied. Check credentials and try again.' };
    const { source } = sourceOn(calendars);
    await expect(source.listSince({ path: '/calendars/cal-holidays', name: 'Holidays in the Netherlands' })).rejects.toThrow(
      /Failed to list the events in calendar "Holidays in the Netherlands": 403 - ErrorAccessDenied/,
    );
  });

  it('a series whose exceptions cannot be read is counted unreadable, not listed without them', async () => {
    const calendars = account();
    calendars[0]!.brokenSeries = ['AAMk-wed'];
    const { source } = sourceOn(calendars);
    const result = await source.listSince({ path: '/calendars/cal-main', name: 'Calendar' });
    expect(result.unreadable).toBe(1);
    expect(result.items.map((i) => i.item.uid)).not.toContain(WEDNESDAY.iCalUId);
    expect(result.items).toHaveLength(4);
  });
});

describe('a weekly series with one changed occurrence and one cancelled', () => {
  it('travels as ONE object: the master with its RRULE and EXDATE, and the change as a RECURRENCE-ID VEVENT', async () => {
    const { result } = await listed();
    const series = byUid(result.items, WEDNESDAY.iCalUId!);
    expect(series.item.recurrenceId).toBeUndefined();
    expect(componentOfIcalendar(series.icalendar)).toBe('VEVENT');

    const [master, moved, ...rest] = vevents(series);
    expect(rest).toEqual([]);
    expect(prop(master!, 'UID')?.value).toBe(WEDNESDAY.iCalUId);
    expect(prop(moved!, 'UID')?.value, 'an exception carries its series’ UID, not its own iCalUId').toBe(WEDNESDAY.iCalUId);

    expect(prop(master!, 'DTSTART')).toEqual({ name: 'DTSTART', params: { TZID: 'Europe/Berlin' }, value: '20260902T190000' });
    expect(prop(master!, 'RRULE')?.value).toBe('FREQ=WEEKLY;BYDAY=WE;WKST=SU');
    // Cancelled on 28 October, after the clocks went back: still 19:00 local, now 18:00 UTC.
    expect(prop(master!, 'EXDATE')).toEqual({ name: 'EXDATE', params: { TZID: 'Europe/Berlin' }, value: '20261028T190000' });
    expect(instant(series, master!, 'EXDATE')).toBe('2026-10-28T18:00:00Z');

    expect(prop(moved!, 'RECURRENCE-ID')).toEqual({ name: 'RECURRENCE-ID', params: { TZID: 'Europe/Berlin' }, value: '20261014T190000' });
    expect(prop(moved!, 'DTSTART')?.value).toBe('20261014T200000');
    expect(prop(moved!, 'SUMMARY')?.value).toBe('Choir (later)');
    expect(prop(moved!, 'RRULE')).toBeUndefined();
    // What the exception leaves out, the series gives it.
    expect(prop(moved!, 'LOCATION')?.value).toBe('Church hall');
  });

  it('carries the body as text, the reminder, the category and the zone it needs', async () => {
    const { result } = await listed();
    const series = byUid(result.items, WEDNESDAY.iCalUId!);
    const [master] = vevents(series);
    expect(prop(master!, 'DESCRIPTION')?.value).toBe('Bring the new scores');
    expect(prop(master!, 'CATEGORIES')?.value).toBe('Music');
    expect(prop(master!, 'TRANSP')?.value).toBe('OPAQUE');
    expect(prop(master!, 'CLASS')?.value).toBe('PUBLIC');
    const alarm = master!.children.find((c) => c.name === 'VALARM');
    expect(prop(alarm!, 'TRIGGER')?.value).toBe('-PT15M');
    const tz = componentsNamed(parseIcalComponents(series.icalendar), 'VTIMEZONE');
    expect(tz.map((z) => prop(z, 'TZID')?.value)).toEqual(['Europe/Berlin']);
    expect(series.icalendar).toMatch(/BEGIN:DAYLIGHT\r\nDTSTART:20260329T020000\r\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU\r\nTZOFFSETFROM:\+0100\r\nTZOFFSETTO:\+0200/);
    expect(series.icalendar).toMatch(/BEGIN:STANDARD\r\nDTSTART:20261025T030000\r\nRRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU\r\nTZOFFSETFROM:\+0200\r\nTZOFFSETTO:\+0100/);
  });

  it('is keyed by its UID alone, and the item carries the instant it starts', async () => {
    const { result } = await listed();
    const series = byUid(result.items, WEDNESDAY.iCalUId!);
    expect(series.item.start).toBe('2026-09-02T17:00:00Z');
    expect(naturalKeyForCalendar(series.item)).toBe(naturalKeyForCalendar({ ...series.item, recurrenceId: undefined }));
    expect(series.item.sourcePath).toBe('/calendars/cal-main/events/AAMk-wed');
  });

  it('a changed occurrence changes the series’ version; a series with neither keeps its own', async () => {
    const calendars = account();
    const first = byUid((await listed(calendars)).result.items, WEDNESDAY.iCalUId!).item.etag;
    calendars[0]!.series!['AAMk-wed'] = {
      exceptions: [{ ...WEDNESDAY_MOVED, changeKey: 'ck-wed-x1-2', subject: 'Choir (later still)' }],
      cancelled: ['OID.AAMk-wed.2026-10-28'],
    };
    const second = byUid((await listed(calendars)).result.items, WEDNESDAY.iCalUId!).item.etag;
    expect(first).toMatch(/^changeKey:ck-wed-1\+series:/);
    expect(second).not.toBe(first);
    expect(byUid((await listed(calendars)).result.items, 'pacific-series').item.etag).toBe('changeKey:ck-pst');
  });
});

describe('an all-day holiday on a read-only calendar', () => {
  it('is copied as dates, free time, with its category', async () => {
    const { result } = await listed(account(), 'cal-holidays');
    const xmas = byUid(result.items, 'holiday-nl-2026-12-25');
    const [ev] = vevents(xmas);
    expect(prop(ev!, 'DTSTART')).toEqual({ name: 'DTSTART', params: { VALUE: 'DATE' }, value: '20261225' });
    expect(prop(ev!, 'DTEND')).toEqual({ name: 'DTEND', params: { VALUE: 'DATE' }, value: '20261226' });
    expect(prop(ev!, 'TRANSP')?.value).toBe('TRANSPARENT');
    expect(prop(ev!, 'CATEGORIES')?.value).toBe('Holiday');
    expect(xmas.item.isAllDay).toBe(true);
    expect(xmas.item.start).toBe('2026-12-25T00:00:00Z');
    expect(componentsNamed(parseIcalComponents(xmas.icalendar), 'VTIMEZONE')).toEqual([]);
  });
});

describe('a multi-day event in another zone', () => {
  it('keeps both ends in its own zone, and its address beside its name', async () => {
    const { result } = await listed();
    const trip = byUid(result.items, 'trip-uid');
    const [ev] = vevents(trip);
    expect(prop(ev!, 'DTSTART')).toEqual({ name: 'DTSTART', params: { TZID: 'Europe/Paris' }, value: '20261130T090000' });
    expect(prop(ev!, 'DTEND')).toEqual({ name: 'DTEND', params: { TZID: 'Europe/Paris' }, value: '20261202T170000' });
    expect(instant(trip, ev!, 'DTEND')).toBe('2026-12-02T16:00:00Z');
    expect(prop(ev!, 'LOCATION')?.value).toBe('Congress centre\\, Main street 1\\, 69001 Lyon\\, France');
    expect(prop(ev!, 'X-MICROSOFT-CDO-BUSYSTATUS')?.value).toBe('OOF');
  });
});

describe('a series in a non-UTC zone across a daylight saving change', () => {
  it('is written on the local clock with its IANA zone, so 10:00 stays 10:00 after the change', async () => {
    const { result } = await listed();
    const pst = byUid(result.items, 'pacific-series');
    const [ev] = vevents(pst);
    expect(prop(ev!, 'DTSTART')).toEqual({ name: 'DTSTART', params: { TZID: 'America/Los_Angeles' }, value: '20261026T100000' });
    expect(prop(ev!, 'RRULE')?.value).toBe('FREQ=WEEKLY;BYDAY=MO;WKST=SU;COUNT=4');
    expect(instant(pst, ev!, 'DTSTART')).toBe('2026-10-26T17:00:00Z');
    // The fourth Monday, 16 November, is 10:00 PST = 18:00 UTC; the repository's
    // bound on the series' last end reaches it.
    const roots = parseIcalComponents(pst.icalendar);
    expect(latestEnd(ev!, declaredZones(roots))).toBeGreaterThanOrEqual(Date.parse('2026-11-16T18:30:00Z'));
  });

  it('an end date becomes UNTIL in UTC, at the end of that day in the series’ zone', async () => {
    const calendars = account();
    calendars[0]!.events = [
      {
        ...PACIFIC_SERIES,
        recurrence: { ...PACIFIC_SERIES.recurrence!, range: { type: 'endDate', startDate: '2026-10-26', endDate: '2026-11-16' } },
      },
    ];
    const pst = byUid((await listed(calendars)).result.items, 'pacific-series');
    expect(prop(vevents(pst)[0]!, 'RRULE')?.value).toBe('FREQ=WEEKLY;BYDAY=MO;WKST=SU;UNTIL=20261117T075959Z');
  });
});

describe('a private event, and a meeting with guests', () => {
  it('a private event is CLASS:PRIVATE', async () => {
    const { result } = await listed();
    expect(prop(vevents(byUid(result.items, 'doctor-uid'))[0]!, 'CLASS')?.value).toBe('PRIVATE');
  });

  it('carries the organizer and every attendee with their role and answer', async () => {
    const { result } = await listed();
    const meeting = byUid(result.items, 'meeting-uid');
    const [ev] = vevents(meeting);
    expect(prop(ev!, 'SUMMARY')?.value).toBe('Planning\\; budget\\, 2027');
    expect(prop(ev!, 'ORGANIZER')).toEqual({ name: 'ORGANIZER', params: { CN: 'Organiser Org' }, value: 'mailto:organiser@example.org' });
    expect(props(ev!, 'ATTENDEE').map((a) => [a.value, a.params['ROLE'], a.params['PARTSTAT'], a.params['CUTYPE']])).toEqual([
      ['mailto:ada@example.org', 'REQ-PARTICIPANT', 'ACCEPTED', undefined],
      ['mailto:bob@example.org', 'OPT-PARTICIPANT', 'TENTATIVE', undefined],
      ['mailto:room1@example.org', 'NON-PARTICIPANT', 'NEEDS-ACTION', 'RESOURCE'],
    ]);
    expect(prop(ev!, 'STATUS')?.value).toBe('TENTATIVE');
    // What a target does before it writes: no invitation goes out from the copy.
    expect(() => neutraliseScheduling(meeting.icalendar)).not.toThrow();
  });
});

describe('a calendar that lists events but has none in the window', () => {
  const SINCE = new Date('2026-08-26T00:00:00Z');
  const old = (id: string, end: string): GraphEvent => ({
    id,
    iCalUId: `${id}-uid`,
    subject: id,
    start: { dateTime: `${end.slice(0, 10)}T09:00:00.0000000`, timeZone: 'UTC' },
    end: { dateTime: end, timeZone: 'UTC' },
    isAllDay: false,
    type: 'singleInstance',
  });

  it('lists the calendar, builds nothing, reads no series, and still keeps every id it saw', async () => {
    const calendars: FakeCalendar[] = [
      {
        id: 'cal-old',
        name: 'Old',
        events: [
          old('e1', '2025-03-01T10:00:00.0000000'),
          old('e2', '2024-12-01T10:00:00.0000000'),
          {
            ...old('s1', '2024-01-08T09:30:00.0000000'),
            type: 'seriesMaster',
            recurrence: {
              pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
              range: { type: 'endDate', startDate: '2024-01-08', endDate: '2025-06-30' },
            },
          },
        ],
      },
    ];
    const { source, requests } = sourceOn(calendars);
    const result = await source.listSince({ path: '/calendars/cal-old', name: 'Old' }, undefined, { since: SINCE });
    expect(result.items).toEqual([]);
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual(['/v1.0/me/calendars/cal-old/events']);
    expect(result.nextCursor.value).toContain('"ids":["e1","e2","s1"]');
  });

  it('what it does build, the window’s own check agrees with', async () => {
    const { source } = sourceOn(account());
    const result = await source.listSince({ path: '/calendars/cal-main', name: 'Calendar' }, undefined, { since: SINCE });
    for (const raw of result.items) expect(eventInWindow(raw, SINCE), raw.item.uid).toBe(true);
  });
});

describe('edits and deletions', () => {
  it('a single event’s version is its changeKey, exactly as before', async () => {
    const { result } = await listed();
    expect(byUid(result.items, 'trip-uid').item.etag).toBe('changeKey:ck-trip');
  });

  it('an event the next complete listing does not find is reported removed, by its path', async () => {
    const calendars = account();
    const { source } = sourceOn(calendars);
    const folder = { path: '/calendars/cal-main', name: 'Calendar' };
    const first = await source.listSince(folder);
    expect(first.removed).toBeUndefined();

    calendars[0]!.events = calendars[0]!.events.filter((e) => e.id !== 'AAMk-doc');
    const second = await source.listSince(folder, first.nextCursor);
    expect(second.removed).toEqual(['/calendars/cal-main/events/AAMk-doc']);

    const third = await source.listSince(folder, second.nextCursor);
    expect(third.removed).toBeUndefined();
  });

  it('a cursor from another calendar, from the old delta, or unreadable, reports nothing removed', async () => {
    const calendars = account();
    const { source } = sourceOn(calendars);
    const folder = { path: '/calendars/cal-main', name: 'Calendar' };
    const other = await source.listSince({ path: '/calendars/cal-holidays', name: 'Holidays' });
    for (const value of [
      other.nextCursor.value,
      'graph-delta:/calendars/cal-main:https://graph.microsoft.com/v1.0/me/calendars/cal-main/events/delta?$deltatoken=x',
      'graph-events:{not json',
    ]) {
      expect((await source.listSince(folder, { value })).removed).toBeUndefined();
    }
  });
});
