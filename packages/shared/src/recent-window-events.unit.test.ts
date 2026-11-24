// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHICH EVENTS A WINDOW HOLDS (workplan 0170 T4, D1 (a)).
 *
 * Every event that ends on or after `since`, every upcoming one, and every
 * recurring series with an occurrence on or after `since`, whole, with its
 * overrides. Tasks are never windowed. Decided by `eventInWindow` from the
 * object's own iCalendar, through `latestEnd`; whatever it cannot decide is
 * held. The samples below are shaped as Google, Apple and Exchange send them.
 */

import { describe, it, expect } from 'vitest';
import { eventInWindow } from './recent-window.ts';
import { componentsNamed, declaredZones, icalTimeToIso, latestEnd, parseIcalComponents } from './ical-occurrences.ts';
import type { RawCalendarEvent } from './calendar.ts';

/** The window of a migration anchored on 2026-11-24. */
const SINCE = new Date('2026-08-26T00:00:00.000Z');

function event(icalendar: string, type: 'event' | 'todo' = 'event'): RawCalendarEvent {
  return { item: { uid: 'u1', type, summary: 's' } as RawCalendarEvent['item'], icalendar };
}

function ics(...lines: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Example//Calendar//EN', ...lines, 'END:VCALENDAR', ''].join('\r\n');
}

const inWindow = (...lines: string[]): boolean => eventInWindow(event(ics(...lines)), SINCE);

/** As Google sends Europe/Amsterdam: the VTIMEZONE first, with a 1970 start. */
const AMSTERDAM = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Amsterdam',
  'X-LIC-LOCATION:Europe/Amsterdam',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

/** As Exchange sends it: a Windows name no IANA database knows. */
const W_EUROPE = [
  'BEGIN:VTIMEZONE',
  'TZID:W. Europe Standard Time',
  'BEGIN:STANDARD',
  'DTSTART:16010101T030000',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:16010101T020000',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
];

describe('a series that started years ago and still recurs', () => {
  it('is in, however old its DTSTART', () => {
    expect(
      inWindow(
        ...AMSTERDAM,
        'BEGIN:VEVENT',
        'DTSTART;TZID=Europe/Amsterdam:20190107T090000',
        'DTEND;TZID=Europe/Amsterdam:20190107T093000',
        'RRULE:FREQ=WEEKLY;BYDAY=MO',
        'DTSTAMP:20190101T120000Z',
        'UID:standup-2019@example.org',
        'SUMMARY:Stand-up',
        'END:VEVENT',
      ),
    ).toBe(true);
  });

  it('is in when it ends after since, by COUNT', () => {
    // Daily from 2026-08-10: the 20th is on 2026-08-29.
    expect(inWindow('BEGIN:VEVENT', 'UID:c@example.org', 'DTSTART:20260810T090000Z', 'DTEND:20260810T100000Z', 'RRULE:FREQ=DAILY;COUNT=20', 'END:VEVENT')).toBe(true);
    // Monthly on the 15th from January: the 9th is on 15 September.
    expect(inWindow('BEGIN:VEVENT', 'UID:m@example.org', 'DTSTART:20260115T090000Z', 'RRULE:FREQ=MONTHLY;COUNT=9', 'END:VEVENT')).toBe(true);
  });

  it('is in, an all-day birthday since 1990 with no end', () => {
    expect(
      inWindow('BEGIN:VEVENT', 'UID:bday@example.org', 'DTSTART;VALUE=DATE:19900312', 'DTEND;VALUE=DATE:19900313', 'RRULE:FREQ=YEARLY', 'SUMMARY:Birthday', 'END:VEVENT'),
    ).toBe(true);
  });
});

describe('a series that ended before the window', () => {
  it('is out, by UNTIL', () => {
    expect(
      inWindow(
        ...AMSTERDAM,
        'BEGIN:VEVENT',
        'DTSTART;TZID=Europe/Amsterdam:20240108T090000',
        'DTEND;TZID=Europe/Amsterdam:20240108T100000',
        'RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20250630T070000Z',
        'UID:course-2024@example.org',
        'SUMMARY:Evening course',
        'END:VEVENT',
      ),
    ).toBe(false);
  });

  it('is out, by COUNT, where the rule has a fixed period', () => {
    // Daily from 2026-08-10, ten times: the last on 2026-08-19.
    expect(inWindow('BEGIN:VEVENT', 'UID:c@example.org', 'DTSTART:20260810T090000Z', 'DTEND:20260810T100000Z', 'RRULE:FREQ=DAILY;COUNT=10', 'END:VEVENT')).toBe(false);
    // Monthly on the 15th from January, eight times: the last on 15 August.
    expect(inWindow('BEGIN:VEVENT', 'UID:m@example.org', 'DTSTART:20260115T090000Z', 'RRULE:FREQ=MONTHLY;COUNT=8', 'END:VEVENT')).toBe(false);
    // Mondays and Wednesdays from 1 June, ten times: done within ten weeks.
    expect(inWindow('BEGIN:VEVENT', 'UID:w@example.org', 'DTSTART:20260601T090000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10', 'END:VEVENT')).toBe(false);
    // Yearly from 2020, three times: the last in 2022.
    expect(inWindow('BEGIN:VEVENT', 'UID:y@example.org', 'DTSTART:20200301T090000Z', 'RRULE:FREQ=YEARLY;COUNT=3', 'END:VEVENT')).toBe(false);
  });

  it('is held when its COUNT cannot be bounded', () => {
    // The last day of each month, three times, from 2020: this does not expand BY-parts.
    expect(inWindow('BEGIN:VEVENT', 'UID:l@example.org', 'DTSTART:20200131T090000Z', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3', 'END:VEVENT')).toBe(true);
    // The 31st, which a short month skips.
    expect(inWindow('BEGIN:VEVENT', 'UID:t@example.org', 'DTSTART:20200131T090000Z', 'RRULE:FREQ=MONTHLY;COUNT=3', 'END:VEVENT')).toBe(true);
  });
});

describe('all-day events', () => {
  it('lasts its day, read as a date anywhere in the world', () => {
    // As Apple sends them: DTEND the day after.
    const day = (from: string, to: string): boolean =>
      inWindow('BEGIN:VEVENT', 'UID:d@example.org', `DTSTART;VALUE=DATE:${from}`, `DTEND;VALUE=DATE:${to}`, 'SUMMARY:Holiday', 'END:VEVENT');
    expect(day('20260823', '20260824')).toBe(false);
    // Ends at midnight on since's day, which is after since somewhere west of UTC.
    expect(day('20260825', '20260826')).toBe(true);
    expect(day('20260901', '20260902')).toBe(true);
    // A fortnight's holiday that runs into the window.
    expect(day('20260815', '20260829')).toBe(true);
  });

  it('lasts its day with no DTEND', () => {
    expect(inWindow('BEGIN:VEVENT', 'UID:d@example.org', 'DTSTART;VALUE=DATE:20260824', 'END:VEVENT')).toBe(false);
    expect(inWindow('BEGIN:VEVENT', 'UID:d@example.org', 'DTSTART;VALUE=DATE:20260825', 'END:VEVENT')).toBe(true);
  });
});

describe('an UNTIL in another time zone', () => {
  it('reads UNTIL in UTC, against a series in New York', () => {
    const series = (until: string): boolean =>
      inWindow(
        'BEGIN:VEVENT',
        'UID:ny@example.org',
        'DTSTART;TZID=America/New_York:20260601T200000',
        'DTEND;TZID=America/New_York:20260601T210000',
        `RRULE:FREQ=DAILY;UNTIL=${until}`,
        'END:VEVENT',
      );
    // 20:00 in New York on 25 August is 00:00 UTC on the 26th, since itself.
    expect(series('20260826T000000Z')).toBe(true);
    // A day earlier, its last evening ends at 02:00 UTC on the 25th.
    expect(series('20260825T000000Z')).toBe(false);
  });

  it('reads a local UNTIL in the series own zone, not as UTC', () => {
    // 09:00 in Auckland on 26 August is 21:00 UTC on the 25th: before since.
    // Read as UTC it would be 09:00 on the 26th, after it.
    const auckland = (until: string): boolean =>
      inWindow(
        'BEGIN:VEVENT',
        'UID:akl@example.org',
        'DTSTART;TZID=Pacific/Auckland:20260601T090000',
        'DTEND;TZID=Pacific/Auckland:20260601T100000',
        `RRULE:FREQ=DAILY;UNTIL=${until}`,
        'END:VEVENT',
      );
    expect(auckland('20260826T090000')).toBe(false);
    expect(auckland('20260826T210000Z')).toBe(true);
  });

  it('reads a Windows zone by its own VTIMEZONE, and a path that ends in an IANA zone', () => {
    const exchange = (start: string, end: string): boolean =>
      inWindow(
        ...W_EUROPE,
        'BEGIN:VEVENT',
        `DTSTART;TZID=W. Europe Standard Time:${start}`,
        `DTEND;TZID=W. Europe Standard Time:${end}`,
        'UID:040000008200E00074C5B7101A82E008@example.org',
        'END:VEVENT',
      );
    // 21:00 at UTC+1 or +2 is before midnight UTC.
    expect(exchange('20260825T200000', '20260825T210000')).toBe(false);
    // 01:30 at UTC+2 is 23:30 UTC; at UTC+1, 00:30: it may be after since.
    expect(exchange('20260826T003000', '20260826T013000')).toBe(true);
    const mozilla = (end: string): boolean =>
      inWindow('BEGIN:VEVENT', 'UID:moz@example.org', 'DTSTART;TZID=/mozilla.org/20050126_1/Europe/Amsterdam:20260825T200000', `DTEND;TZID=/mozilla.org/20050126_1/Europe/Amsterdam:${end}`, 'END:VEVENT');
    // 01:30 CEST on the 26th is 23:30 UTC on the 25th.
    expect(mozilla('20260826T013000')).toBe(false);
    expect(mozilla('20260826T023000')).toBe(true);
  });
});

describe('an EXDATE', () => {
  it('never takes a recurring series out, and never brings an ended one in', () => {
    expect(
      inWindow('BEGIN:VEVENT', 'UID:e@example.org', 'DTSTART:20250106T090000Z', 'RRULE:FREQ=WEEKLY', 'EXDATE:20260831T090000Z,20260907T090000Z', 'END:VEVENT'),
    ).toBe(true);
    expect(
      inWindow('BEGIN:VEVENT', 'UID:e@example.org', 'DTSTART:20250106T090000Z', 'RRULE:FREQ=WEEKLY;UNTIL=20250630T090000Z', 'EXDATE:20260831T090000Z', 'END:VEVENT'),
    ).toBe(false);
  });
});

describe('a moved occurrence (RECURRENCE-ID)', () => {
  const master = [
    'BEGIN:VEVENT',
    'UID:moved@example.org',
    'DTSTART;TZID=Europe/Amsterdam:20260601T100000',
    'DTEND;TZID=Europe/Amsterdam:20260601T110000',
    'RRULE:FREQ=WEEKLY;UNTIL=20260817T080000Z',
    'END:VEVENT',
  ];

  it('brings its whole series in when it moved into the window', () => {
    expect(inWindow(...AMSTERDAM, ...master)).toBe(false);
    expect(
      inWindow(
        ...AMSTERDAM,
        ...master,
        'BEGIN:VEVENT',
        'UID:moved@example.org',
        'RECURRENCE-ID;TZID=Europe/Amsterdam:20260817T100000',
        'DTSTART;TZID=Europe/Amsterdam:20260902T100000',
        'DTEND;TZID=Europe/Amsterdam:20260902T110000',
        'END:VEVENT',
      ),
    ).toBe(true);
  });

  it('leaves a series out when its occurrence moved to another old date', () => {
    expect(
      inWindow(
        ...AMSTERDAM,
        ...master,
        'BEGIN:VEVENT',
        'UID:moved@example.org',
        'RECURRENCE-ID;TZID=Europe/Amsterdam:20260608T100000',
        'DTSTART;TZID=Europe/Amsterdam:20260609T100000',
        'DTEND;TZID=Europe/Amsterdam:20260609T110000',
        'END:VEVENT',
      ),
    ).toBe(false);
  });

  it('holds an override listed without its series, as Graph lists an exception', () => {
    expect(
      inWindow('BEGIN:VEVENT', 'UID:moved@example.org', 'RECURRENCE-ID:20240108T090000Z', 'DTSTART:20240109T090000Z', 'DTEND:20240109T100000Z', 'END:VEVENT'),
    ).toBe(true);
  });
});

describe('a VTODO', () => {
  it('is never windowed, however old', () => {
    const todo = ics('BEGIN:VTODO', 'UID:t@example.org', 'DTSTART:20200101T100000Z', 'DUE:20200102T100000Z', 'STATUS:COMPLETED', 'END:VTODO');
    expect(eventInWindow(event(todo, 'todo'), SINCE)).toBe(true);
  });
});

describe('DURATION and RDATE', () => {
  it('reads DURATION as the length of each occurrence', () => {
    expect(inWindow('BEGIN:VEVENT', 'UID:d@example.org', 'DTSTART:20200101T100000Z', 'DURATION:PT1H', 'END:VEVENT')).toBe(false);
    expect(inWindow('BEGIN:VEVENT', 'UID:d@example.org', 'DTSTART:20260601T100000Z', 'DURATION:P100D', 'END:VEVENT')).toBe(true);
  });

  it('is in when an RDATE is, and out when every date is old', () => {
    expect(inWindow('BEGIN:VEVENT', 'UID:r@example.org', 'DTSTART:20200101T100000Z', 'RDATE:20200201T100000Z,20260910T100000Z', 'END:VEVENT')).toBe(true);
    expect(inWindow('BEGIN:VEVENT', 'UID:r@example.org', 'DTSTART:20200101T100000Z', 'RDATE:20200201T100000Z', 'END:VEVENT')).toBe(false);
    expect(
      inWindow('BEGIN:VEVENT', 'UID:r@example.org', 'DTSTART:20200101T100000Z', 'RDATE;VALUE=PERIOD:20200201T100000Z/20260827T000000Z', 'END:VEVENT'),
    ).toBe(true);
    expect(inWindow('BEGIN:VEVENT', 'UID:r@example.org', 'DTSTART:20200101T100000Z', 'RDATE:soon', 'END:VEVENT')).toBe(true);
  });
});

describe('latestEnd and icalTimeToIso', () => {
  it('is Infinity for a series with no end', () => {
    const roots = parseIcalComponents(ics('BEGIN:VEVENT', 'UID:x', 'DTSTART:20200101T100000Z', 'RRULE:FREQ=DAILY', 'END:VEVENT'));
    expect(latestEnd(componentsNamed(roots, 'VEVENT')[0]!, declaredZones(roots))).toBe(Infinity);
  });

  it('turns a TZID time into UTC, and keeps a date and a floating time as they are', () => {
    const roots = parseIcalComponents(
      ics(...W_EUROPE, 'BEGIN:VEVENT', 'DTSTART;TZID="Europe/Amsterdam":20260701T100000', 'DTEND;VALUE=DATE:20260702', 'RDATE:20260703T100000', 'RECURRENCE-ID;TZID=W. Europe Standard Time:20260701T100000', 'END:VEVENT'),
    );
    const zones = declaredZones(roots);
    const [vevent] = componentsNamed(roots, 'VEVENT');
    const iso = (name: string): string | undefined => icalTimeToIso(vevent!.properties.find((p) => p.name === name)!, zones);
    expect(iso('DTSTART')).toBe('2026-07-01T08:00:00Z');
    expect(iso('DTEND')).toBe('2026-07-02T00:00:00Z');
    expect(iso('RDATE')).toBe('2026-07-03T10:00:00');
    expect(iso('RECURRENCE-ID')).toBe('2026-07-01T10:00:00');
  });
});
