// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT IS OVER KEEPS EVERY ADDRESS (the owner, 2026-11-23; ADR-0055; workplan
 * 0168).
 *
 * The owner: *"Though perhapse we need not change past-events we migrate."*
 * A calendar object whose last occurrence ended before the migration's start
 * is copied as the source has it, and the rest changes. Every case here goes
 * through `applyAddressChanges` with that start, so each fails where the start
 * is not read: the object would then change like any other.
 *
 * The start is 2026-11-23 10:00 UTC throughout unless a case says otherwise.
 * Addresses are `example.org` only.
 */

import { describe, it, expect } from 'vitest';
import {
  addressTableDigest,
  applyAddressChanges,
  calendarObjectIsOver,
  prepareAddressTable,
  type ConfirmedAddressChange,
} from './address-changes.ts';
import { addressKey } from './address-forms.ts';

function row(oldAddress: string, newAddress: string): ConfirmedAddressChange {
  return { oldKey: addressKey(oldAddress), oldAddress, newAddress };
}

const ANA = row('ana@old.example.org', 'ana@example.org');
const BEN = row('ben@old.example.org', 'ben@example.org');
const TABLE = [ANA, BEN];
const START = new Date('2026-11-23T10:00:00Z');

const crlf = (lines: string[]): string => `${lines.join('\r\n')}\r\n`;

/** The lines of one component organised by Ana's old address, with Ben as a guest whom she sent for. */
function own(component: string, lines: string[], uid = 'object-1'): string[] {
  return [
    `BEGIN:${component}`,
    `UID:${uid}`,
    ...lines,
    'ORGANIZER;CN=Ana:mailto:ana@old.example.org',
    'ATTENDEE;CN=Ben;SENT-BY="mailto:ana@old.example.org":mailto:ben@old.example.org',
    'SUMMARY:with ben@old.example.org',
    `END:${component}`,
  ];
}

/** A calendar object: a VEVENT with these lines, after any other lines of the VCALENDAR (a VTIMEZONE). */
function event(lines: string[], before: string[] = [], after: string[] = []): string {
  return crlf(['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ownpace test//EN', ...before, ...own('VEVENT', lines), ...after, 'END:VCALENDAR']);
}

/** Over: every byte as the source has it, and no digest, as for a body the table does not touch. */
function expectKept(body: string, start: Date = START): void {
  expect(applyAddressChanges('icalendar', body, TABLE, [], start)).toEqual({ body, changed: false, digest: null });
  expect(calendarObjectIsOver(body, start)).toBe(true);
}

/** Not over: changed exactly as it is with no start at all. */
function expectChanged(body: string, start: Date = START): void {
  const r = applyAddressChanges('icalendar', body, TABLE, [], start);
  expect(r.changed).toBe(true);
  expect(r.body).toContain('\r\nORGANIZER;CN=Ana:mailto:ana@example.org\r\n');
  expect(r).toEqual(applyAddressChanges('icalendar', body, TABLE));
  expect(calendarObjectIsOver(body, start)).toBe(false);
}

describe('an event without a rule', () => {
  it('that ended last year keeps every address, its SENT-BY included, byte for byte', () => {
    expectKept(event(['DTSTART:20251124T090000Z', 'DTEND:20251124T100000Z']));
  });

  it('that ended a second before the start keeps them; one that ends at the start, or runs past it, changes', () => {
    expectKept(event(['DTSTART:20261123T090000Z', 'DTEND:20261123T095959Z']));
    expectChanged(event(['DTSTART:20261123T090000Z', 'DTEND:20261123T100000Z']));
    expectChanged(event(['DTSTART:20261123T093000Z', 'DTEND:20261123T110000Z']));
  });

  it('that is still to come changes', () => {
    expectChanged(event(['DTSTART:20261201T090000Z', 'DTEND:20261201T100000Z']));
  });

  it('ends at DTSTART plus DURATION', () => {
    expectKept(event(['DTSTART:20261123T080000Z', 'DURATION:PT1H59M59S']));
    expectChanged(event(['DTSTART:20261123T080000Z', 'DURATION:PT2H']));
    expectChanged(event(['DTSTART:20261122T120000Z', 'DURATION:P1D']));
  });

  it('with a time and neither DTEND nor DURATION, ends at DTSTART (RFC 5545 §3.6.1)', () => {
    expectKept(event(['DTSTART:20261123T095959Z']));
    expectChanged(event(['DTSTART:20261123T100000Z']));
  });

  it('whose DTEND is before its DTSTART ends no earlier than it starts', () => {
    expectChanged(event(['DTSTART:20261201T090000Z', 'DTEND:20251201T100000Z']));
  });
});

describe('an all-day event', () => {
  it('ends at the end of its DTSTART’s day: yesterday’s keeps its addresses, today’s changes', () => {
    expectKept(event(['DTSTART;VALUE=DATE:20261122']));
    expectChanged(event(['DTSTART;VALUE=DATE:20261123']));
  });

  it('with a DTEND date ends at the start of that day, which is not part of it', () => {
    expectKept(event(['DTSTART;VALUE=DATE:20261120', 'DTEND;VALUE=DATE:20261123']));
    expectChanged(event(['DTSTART;VALUE=DATE:20261120', 'DTEND;VALUE=DATE:20261124']));
  });
});

describe('time zones', () => {
  it('reads an end in its TZID: Amsterdam in winter is an hour ahead of UTC', () => {
    expectKept(event(['DTSTART;TZID=Europe/Amsterdam:20261123T100000', 'DTEND;TZID=Europe/Amsterdam:20261123T105959']));
    expectChanged(event(['DTSTART;TZID=Europe/Amsterdam:20261123T100000', 'DTEND;TZID=Europe/Amsterdam:20261123T110000']));
  });

  it('reads New York and Tokyo by their own clocks, not by UTC’s', () => {
    // 05:30 in New York is 10:30 UTC: running at the start. Read as UTC it would have been over.
    expectChanged(event(['DTSTART;TZID=America/New_York:20261123T050000', 'DTEND;TZID=America/New_York:20261123T053000']));
    // 18:30 in Tokyo is 09:30 UTC: over. Read as UTC it would have been to come.
    expectKept(event(['DTSTART;TZID=Asia/Tokyo:20261123T180000', 'DTEND;TZID=Asia/Tokyo:20261123T183000']));
  });

  it('reads the offset of the end’s own date: Amsterdam in summer is two hours ahead', () => {
    const summer = new Date('2026-07-01T10:00:00Z');
    // 11:30 there is 09:30 UTC in July; read at the winter offset it would be 10:30.
    expectKept(event(['DTSTART;TZID=Europe/Amsterdam:20260701T110000', 'DTEND;TZID=Europe/Amsterdam:20260701T113000']), summer);
    expectChanged(event(['DTSTART;TZID=Europe/Amsterdam:20260701T113000', 'DTEND;TZID=Europe/Amsterdam:20260701T120000']), summer);
  });

  it('reads a wall time the autumn change makes twice at its later instant', () => {
    // 2026-10-25, 02:30 in Amsterdam is 00:30 UTC, and again 01:30 UTC an hour later.
    const between = new Date('2026-10-25T01:00:00Z');
    expectChanged(event(['DTSTART;TZID=Europe/Amsterdam:20261025T020000', 'DTEND;TZID=Europe/Amsterdam:20261025T023000']), between);
  });

  it('reads Microsoft’s own zone names through the object’s VTIMEZONE, at the latest instant its offsets allow', () => {
    const vtimezone = [
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
    const at = (from: string, to: string) =>
      event([`DTSTART;TZID=W. Europe Standard Time:${from}`, `DTEND;TZID=W. Europe Standard Time:${to}`], vtimezone);
    expectKept(at('20251124T090000', '20251124T100000'));
    // 10:30 there is 09:30 UTC at +01:00, the latest its offsets allow (08:30 at +02:00): over.
    expectKept(at('20261123T100000', '20261123T103000'));
    // 11:30 there is 10:30 UTC at +01:00, the latest it can be: running at the start.
    expectChanged(at('20261123T110000', '20261123T113000'));
  });

  it('does not read a TZID that names no zone and no VTIMEZONE of the object: not over', () => {
    expectChanged(event(['DTSTART;TZID=Nowhere/Land:20251124T090000', 'DTEND;TZID=Nowhere/Land:20251124T100000']));
  });

  it('reads a floating time, with neither Z nor TZID, in UTC', () => {
    expectKept(event(['DTSTART:20261123T090000', 'DTEND:20261123T095959']));
    expectChanged(event(['DTSTART:20261123T090000', 'DTEND:20261123T100000']));
  });
});

describe('a series', () => {
  it('with an open-ended rule never is over, however long ago it began', () => {
    expectChanged(event(['DTSTART:20150105T090000Z', 'DTEND:20150105T100000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO']));
  });

  it('whose UNTIL is past is over; one whose UNTIL is to come is not', () => {
    expectKept(event(['DTSTART:20250106T090000Z', 'DTEND:20250106T100000Z', 'RRULE:FREQ=WEEKLY;UNTIL=20251229T090000Z']));
    expectChanged(event(['DTSTART:20250106T090000Z', 'DTEND:20250106T100000Z', 'RRULE:FREQ=WEEKLY;UNTIL=20270104T090000Z']));
  });

  it('is over when no occurrence falls between the start and an UNTIL just after it', () => {
    // Wednesdays; the start is a Monday. The last occurrence before UNTIL is the 18th.
    const weekly = (until: string) => event(['DTSTART:20260107T090000Z', 'DTEND:20260107T100000Z', `RRULE:FREQ=WEEKLY;UNTIL=${until}`]);
    expectKept(weekly('20261124T235959Z'));
    expectChanged(weekly('20261125T235959Z'));
    // UNTIL as a date allows the whole of that day.
    expectKept(weekly('20261124'));
    expectChanged(weekly('20261125'));
  });

  it('with a COUNT is over once its last occurrence ended', () => {
    expectKept(event(['DTSTART:20261110T090000Z', 'DTEND:20261110T100000Z', 'RRULE:FREQ=DAILY;COUNT=5']));
    expectChanged(event(['DTSTART:20261120T090000Z', 'DTEND:20261120T100000Z', 'RRULE:FREQ=DAILY;COUNT=5']));
  });

  it('counts the days BYDAY names: the ninth of Mondays, Wednesdays and Fridays from the 2nd is the 20th, the tenth the 23rd', () => {
    const count = (n: number) =>
      event(['DTSTART:20261102T090000Z', 'DTEND:20261102T100000Z', `RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=${n}`]);
    expectKept(count(9));
    // The tenth is Monday the 23rd, 09:00 to 10:00: it ends at the start, not before it.
    expectChanged(count(10));
  });

  it('counts the last Friday of each month', () => {
    const count = (n: number) =>
      event(['DTSTART:20260828T090000Z', 'DTEND:20260828T100000Z', `RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=${n}`]);
    // August 28, September 25, October 30; then November 27.
    expectKept(count(3));
    expectChanged(count(4));
  });

  it('skips the months and years in which its day does not exist', () => {
    // The 31st: January, March, May, July, August, October, then December.
    const monthly = (n: number) => event(['DTSTART:20260131T090000Z', 'DTEND:20260131T100000Z', `RRULE:FREQ=MONTHLY;COUNT=${n}`]);
    expectKept(monthly(6));
    expectChanged(monthly(7));
    // 29 February: 2016, 2020, 2024, then 2028.
    const leap = (n: number) => event(['DTSTART;VALUE=DATE:20160229', `RRULE:FREQ=YEARLY;COUNT=${n}`]);
    expectKept(leap(3));
    expectChanged(leap(4));
  });

  it('reads WKST as RFC 5545’s own example does: TU,SU every other week ends on the 24th from Monday, the 31st from Sunday', () => {
    // RFC 5545 §3.8.5.3: from 1997-08-05, 09:00 in New York, COUNT=4.
    const rfc = (wkst: string) =>
      event(['DTSTART;TZID=America/New_York:19970805T090000', `RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=${wkst}`]);
    const after = new Date('1997-08-25T00:00:00Z');
    expectKept(rfc('MO'), after);
    expectChanged(rfc('SU'), after);
  });

  it('is not over while an RDATE ends at or after the start', () => {
    const past = ['DTSTART:20250106T090000Z', 'DTEND:20250106T100000Z'];
    expectKept(event([...past, 'RDATE:20250301T090000Z,20250401T090000Z']));
    expectChanged(event([...past, 'RDATE:20250301T090000Z,20261201T090000Z']));
    expectChanged(event([...past, 'RDATE;VALUE=PERIOD:20261123T080000Z/PT3H']));
    expectKept(event([...past, 'RDATE;VALUE=PERIOD:20261123T080000Z/20261123T090000Z']));
  });

  it('with a rule part it does not walk is over by its UNTIL alone, and with a COUNT is not over', () => {
    expectKept(event(['DTSTART:20240101T090000Z', 'DTEND:20240101T100000Z', 'RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;UNTIL=20241231T235959Z']));
    expectChanged(event(['DTSTART:20240101T090000Z', 'DTEND:20240101T100000Z', 'RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=3']));
  });

  it('does not read EXDATE, which only takes occurrences away', () => {
    // The tenth occurrence is excluded, so the series is over by RFC 5545; read as not over.
    expectChanged(
      event(['DTSTART:20261102T090000Z', 'DTEND:20261102T100000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=10', 'EXDATE:20261123T090000Z']),
    );
  });

  it('with a rule that is not one is not over', () => {
    expectChanged(event(['DTSTART:20250106T090000Z', 'DTEND:20250106T100000Z', 'RRULE:BYDAY=MO;COUNT=2']));
    expectChanged(event(['DTSTART:20250106T090000Z', 'DTEND:20250106T100000Z', 'RRULE:FREQ=DAILY;COUNT=2;UNTIL=20250110T000000Z']));
  });
});

describe('a series and its overridden instances are one decision', () => {
  const series = (masterRule: string, moved: string) =>
    crlf([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      ...own('VEVENT', ['DTSTART:20250106T090000Z', 'DTEND:20250106T100000Z', masterRule], 'series-1'),
      ...own('VEVENT', ['RECURRENCE-ID:20250113T090000Z', moved], 'series-1'),
      'END:VCALENDAR',
    ]);

  it('keeps every address of a series that ended, its moved instance included', () => {
    expectKept(series('RRULE:FREQ=WEEKLY;COUNT=4', 'DTSTART:20250114T090000Z\r\nDTEND:20250114T100000Z'));
  });

  it('changes the whole object, the ended series too, when one instance was moved past the start', () => {
    const body = series('RRULE:FREQ=WEEKLY;COUNT=4', 'DTSTART:20261201T090000Z\r\nDTEND:20261201T100000Z');
    expectChanged(body);
    const out = applyAddressChanges('icalendar', body, TABLE, [], START).body;
    expect(out.match(/\r\nORGANIZER;CN=Ana:mailto:ana@example\.org\r\n/g)).toHaveLength(2);
  });

  it('changes an instance that is over when its series still runs', () => {
    const out = applyAddressChanges('icalendar', series('RRULE:FREQ=WEEKLY', 'DTSTART:20250114T090000Z\r\nDTEND:20250114T100000Z'), TABLE, [], START).body;
    expect(out.match(/\r\nORGANIZER;CN=Ana:mailto:ana@example\.org\r\n/g)).toHaveLength(2);
  });

  it('does not read an instance that moves the ones after it (RANGE=THISANDFUTURE): not over', () => {
    expectChanged(
      crlf([
        'BEGIN:VCALENDAR',
        ...own('VEVENT', ['DTSTART:20250106T090000Z', 'DTEND:20250106T100000Z', 'RRULE:FREQ=WEEKLY;COUNT=4'], 's-2'),
        ...own('VEVENT', ['RECURRENCE-ID;RANGE=THISANDFUTURE:20250113T090000Z', 'DTSTART:20250114T090000Z', 'DTEND:20250114T100000Z'], 's-2'),
        'END:VCALENDAR',
      ]),
    );
  });
});

/**
 * A TASK MUST NOT FLIP (found in review, 2026-11-23). A task is over
 * only when it was done before the start, so one open at the start changes,
 * and stays changed when the person finishes it later: the next pass never
 * puts the old organiser back.
 */
describe('a task is over when it was done before the start', () => {
  const task = (lines: string[]) => crlf(['BEGIN:VCALENDAR', 'VERSION:2.0', ...own('VTODO', lines), 'END:VCALENDAR']);

  it('completed before the start, by its COMPLETED time, it is over, whatever it was due; completed at the start, it is not', () => {
    expectKept(task(['STATUS:COMPLETED', 'COMPLETED:20261001T120000Z', 'DUE:20270101T090000Z']));
    expectKept(task(['STATUS:COMPLETED', 'COMPLETED:20261123T095959Z']));
    expectChanged(task(['STATUS:COMPLETED', 'COMPLETED:20261123T100000Z']));
  });

  it('completed after the start, it is not over: a task changed while open stays changed when it is done', () => {
    const open = task(['DTSTAMP:20261101T080000Z', 'LAST-MODIFIED:20261101T080000Z', 'STATUS:NEEDS-ACTION']);
    const done = task(['DTSTAMP:20261124T080000Z', 'LAST-MODIFIED:20261124T080000Z', 'STATUS:COMPLETED', 'COMPLETED:20261124T080000Z']);
    expectChanged(open);
    expectChanged(done);
    const organiserOf = (body: string) => applyAddressChanges('icalendar', body, TABLE, [], START).body.split('\r\n').find((l) => l.startsWith('ORGANIZER'));
    expect(organiserOf(done)).toBe(organiserOf(open));
    // The COMPLETED time decides, though the task was last changed before the start.
    expectChanged(task(['LAST-MODIFIED:20261101T080000Z', 'STATUS:COMPLETED', 'COMPLETED:20261124T080000Z']));
  });

  it('cancelled before the start, with its LAST-MODIFIED before it, it is over; changed at the start or after, it is not', () => {
    // LAST-MODIFIED decides where it is written, whatever DTSTAMP says.
    expectKept(task(['DTSTAMP:20261124T080000Z', 'LAST-MODIFIED:20261101T080000Z', 'STATUS:CANCELLED']));
    expectChanged(task(['DTSTAMP:20261101T080000Z', 'LAST-MODIFIED:20261123T100000Z', 'STATUS:CANCELLED']));
    // Without it, DTSTAMP does, for a task completed by its status alone too.
    expectKept(task(['DTSTAMP:20261101T080000Z', 'STATUS:COMPLETED']));
    expectChanged(task(['DTSTAMP:20261124T080000Z', 'STATUS:COMPLETED']));
  });

  it('cancelled or completed with no time to say when, or one that cannot be read, it is not over', () => {
    expectChanged(task(['STATUS:CANCELLED']));
    expectChanged(task(['STATUS:COMPLETED', 'DUE:20200101T090000Z']));
    // A time that cannot be read decides nothing, and no other stands in for it.
    expectChanged(task(['DTSTAMP:20261101T080000Z', 'STATUS:COMPLETED', 'COMPLETED:yesterday']));
    expectChanged(task(['DTSTAMP:20261101T080000Z', 'LAST-MODIFIED:last week', 'STATUS:CANCELLED']));
    expectChanged(task(['STATUS:COMPLETED', 'COMPLETED;TZID=Nowhere/Atlantis:20261001T120000']));
  });

  it('reads a COMPLETED date to the end of its day, and one in a zone in that zone', () => {
    expectKept(task(['STATUS:COMPLETED', 'COMPLETED;VALUE=DATE:20261122']));
    expectChanged(task(['STATUS:COMPLETED', 'COMPLETED;VALUE=DATE:20261123']));
    // 18:59:59 in Tokyo is 09:59:59 UTC, a second before the start.
    expectKept(task(['STATUS:COMPLETED', 'COMPLETED;TZID=Asia/Tokyo:20261123T185959']));
    expectChanged(task(['STATUS:COMPLETED', 'COMPLETED;TZID=Asia/Tokyo:20261123T190000']));
  });

  it('open, it changes, however long ago it was due or last changed', () => {
    expectChanged(task(['STATUS:NEEDS-ACTION', 'DUE:20200101T090000Z', 'LAST-MODIFIED:20200101T090000Z']));
    expectChanged(task(['DTSTART:20200101T090000Z', 'DTSTAMP:20200101T090000Z']));
  });
});

describe('a journal entry is over when its DTSTART is before the start', () => {
  const journal = (lines: string[]) => crlf(['BEGIN:VCALENDAR', 'VERSION:2.0', ...own('VJOURNAL', lines), 'END:VCALENDAR']);

  it('dated before the start, it keeps its addresses; after it, or undated, it changes', () => {
    expectKept(journal(['DTSTART;VALUE=DATE:20261122']));
    expectKept(journal(['DTSTART:20261123T095959Z']));
    expectChanged(journal(['DTSTART:20261123T100000Z']));
    expectChanged(journal([]));
  });
});

describe('dates that cannot be read: not over, so the object changes', () => {
  it.each([
    ['no DTSTART', []],
    ['a DTSTART that is not a date', ['DTSTART:2025-11-24 09:00']],
    ['a day that does not exist', ['DTSTART:20250230T090000Z', 'DTEND:20250230T100000Z']],
    ['an hour that does not exist', ['DTSTART:20250201T250000Z']],
    ['a DTEND that is not a date', ['DTSTART:20251124T090000Z', 'DTEND:tomorrow']],
    ['a DURATION that is not one', ['DTSTART:20251124T090000Z', 'DURATION:1 hour']],
    ['a negative DURATION', ['DTSTART:20251124T090000Z', 'DURATION:-PT1H']],
    ['both DTEND and DURATION', ['DTSTART:20251124T090000Z', 'DTEND:20251124T100000Z', 'DURATION:PT1H']],
    ['an RDATE that is not a date', ['DTSTART:20251124T090000Z', 'DTEND:20251124T100000Z', 'RDATE:someday']],
  ])('%s', (_name, lines) => {
    expectChanged(event(lines as string[]));
  });

  it('an object with an event that is over and a task that is open', () => {
    expectChanged(
      crlf([
        'BEGIN:VCALENDAR',
        ...own('VEVENT', ['DTSTART:20251124T090000Z', 'DTEND:20251124T100000Z'], 'a'),
        ...own('VTODO', ['STATUS:IN-PROCESS'], 'b'),
        'END:VCALENDAR',
      ]),
    );
  });
});

describe('without a start, and for a card', () => {
  it('changes every object when no start is given, as before 2026-11-23', () => {
    const body = event(['DTSTART:20151124T090000Z', 'DTEND:20151124T100000Z']);
    expect(applyAddressChanges('icalendar', body, TABLE).changed).toBe(true);
    expect(applyAddressChanges('icalendar', body, TABLE, [], undefined).changed).toBe(true);
  });

  it('never reads a card as over: a start changes nothing about one', () => {
    const card = crlf(['BEGIN:VCARD', 'VERSION:3.0', 'FN:Ana', 'EMAIL:ana@old.example.org', 'REV:20150101T000000Z', 'END:VCARD']);
    expect(applyAddressChanges('vcard', card, TABLE, [], START)).toEqual(applyAddressChanges('vcard', card, TABLE));
    expect(applyAddressChanges('vcard', card, TABLE, [], START).changed).toBe(true);
  });
});

// --- Properties, over random dated objects --------------------------------------

/** A seeded generator, so a failing case names its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: () => number, xs: ReadonlyArray<T>): T {
  return xs[Math.floor(r() * xs.length)]!;
}

const ADDRESSES = ['ana@old.example.org', 'ben@old.example.org', 'ana@example.org', 'outside@other.example.org'];
const HOUR = 3_600_000;

/** A UTC instant as iCalendar writes it: `YYYYMMDDTHHMMSS`, `Z` added by the caller where it is UTC. */
function stamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
}

/**
 * A random calendar object around the start: an event, a task or a journal
 * entry, timed in UTC, in a zone, floating or all day, with or without an end,
 * a rule of any kind, an RDATE and an overridden instance.
 */
function randomObject(r: () => number): { readonly body: string; readonly utcEnd?: number } {
  const component = r() < 0.8 ? 'VEVENT' : pick(r, ['VTODO', 'VJOURNAL']);
  const from = START.getTime() + Math.floor((r() * 4 - 3) * 365 * 24) * HOUR + pick(r, [0, -1, 1, -HOUR / 2]) * 1000;
  const length = Math.floor(r() * 49) * HOUR;
  const kind = pick(r, ['utc', 'utc', 'zone', 'floating', 'date']);
  const tzid = pick(r, ['Europe/Amsterdam', 'America/New_York', 'Asia/Tokyo']);
  const write = (name: string, ms: number) =>
    kind === 'utc'
      ? `${name}:${stamp(ms)}Z`
      : kind === 'zone'
        ? `${name};TZID=${tzid}:${stamp(ms)}`
        : kind === 'floating'
          ? `${name}:${stamp(ms)}`
          : `${name};VALUE=DATE:${stamp(ms).slice(0, 8)}`;
  const lines: string[] = [write('DTSTART', from)];
  const end = r();
  let utcEnd: number | undefined = kind === 'utc' ? from : undefined;
  if (component === 'VEVENT' && end < 0.4) {
    lines.push(write('DTEND', from + length));
    if (kind === 'utc') utcEnd = from + length;
  } else if (component === 'VEVENT' && end < 0.6) {
    lines.push(`DURATION:PT${length / HOUR}H`);
    if (kind === 'utc') utcEnd = from + length;
  }
  const recurring = r() < 0.35;
  if (recurring) {
    const freq = pick(r, ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);
    const byDay = freq === 'WEEKLY' && r() < 0.5 ? ';BYDAY=MO,WE,FR' : freq === 'MONTHLY' && r() < 0.5 ? ';BYDAY=-1FR' : '';
    const bound = pick(r, ['', `;COUNT=${1 + Math.floor(r() * 30)}`, `;UNTIL=${stamp(from + Math.floor(r() * 400) * 24 * HOUR)}Z`]);
    lines.push(`RRULE:FREQ=${freq}${byDay}${bound}`);
  }
  if (r() < 0.1) lines.push(`RDATE:${stamp(from + Math.floor((r() * 2 - 0.5) * 400) * 24 * HOUR)}Z`);
  if (component === 'VTODO') {
    // Done before the start or after it, by each time that can say so, or with none.
    const done = stamp(START.getTime() + Math.floor((r() * 2 - 1) * 60 * 24) * HOUR);
    lines.push(
      ...pick(r, [
        [],
        ['STATUS:COMPLETED'],
        ['STATUS:CANCELLED'],
        ['STATUS:NEEDS-ACTION'],
        ['COMPLETED:20261001T000000Z'],
        ['STATUS:COMPLETED', `COMPLETED:${done}Z`],
        ['STATUS:CANCELLED', `LAST-MODIFIED:${done}Z`],
        ['STATUS:COMPLETED', `DTSTAMP:${done}Z`],
      ]),
    );
  }
  const organiser = pick(r, ADDRESSES);
  const objectLines = [
    `BEGIN:${component}`,
    'UID:random-1',
    ...lines,
    `ORGANIZER:mailto:${organiser}`,
    `ATTENDEE;DELEGATED-FROM="mailto:${pick(r, ADDRESSES)}":mailto:${pick(r, ADDRESSES)}`,
    `END:${component}`,
  ];
  const override =
    recurring && r() < 0.3
      ? [`BEGIN:${component}`, 'UID:random-1', `RECURRENCE-ID:${stamp(from + 24 * HOUR)}Z`, write('DTSTART', from + Math.floor((r() * 2 - 1) * 200) * 24 * HOUR), `ORGANIZER:mailto:${organiser}`, `END:${component}`]
      : [];
  const simple = component === 'VEVENT' && !recurring && !lines.some((l) => l.startsWith('RDATE'));
  return {
    body: crlf(['BEGIN:VCALENDAR', 'VERSION:2.0', ...objectLines, ...override, 'END:VCALENDAR']),
    ...(simple && utcEnd !== undefined ? { utcEnd } : {}),
  };
}

const SEEDS = Array.from({ length: 600 }, (_, k) => k + 1);
const OWN = [addressKey('ana@old.example.org')];

describe('properties over random dated objects', () => {
  it('changes nothing when applied again: f(f(x)) = f(x), with the start', () => {
    const table = prepareAddressTable(TABLE);
    for (const seed of SEEDS) {
      const once = applyAddressChanges('icalendar', randomObject(rng(seed)).body, table, OWN, START).body;
      expect(applyAddressChanges('icalendar', once, table, OWN, START).body, `seed ${seed}`).toBe(once);
    }
  });

  it('gives either the source’s bytes, for an object that is over, or exactly what it gives with no start', () => {
    let over = 0;
    let changed = 0;
    for (const seed of SEEDS) {
      const { body } = randomObject(rng(seed));
      const without = applyAddressChanges('icalendar', body, TABLE, OWN);
      const withStart = applyAddressChanges('icalendar', body, TABLE, OWN, START);
      if (without.changed && calendarObjectIsOver(body, START)) {
        over += 1;
        expect(withStart, `seed ${seed}`).toEqual({ body, changed: false, digest: null });
      } else {
        if (withStart.changed) changed += 1;
        expect(withStart, `seed ${seed}`).toEqual(without);
      }
    }
    // Both kinds were drawn.
    expect(over).toBeGreaterThan(50);
    expect(changed).toBeGreaterThan(50);
  });

  it('reads an event timed in UTC, without a rule, as over exactly when its end is before the start', () => {
    let checked = 0;
    for (const seed of SEEDS) {
      const { body, utcEnd } = randomObject(rng(seed));
      if (utcEnd === undefined) continue;
      checked += 1;
      expect(calendarObjectIsOver(body, START), `seed ${seed}`).toBe(utcEnd < START.getTime());
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('reads a task as over exactly when the time that decides is before the start, so a task done later never goes back', () => {
    const task = (lines: string[]) => crlf(['BEGIN:VCALENDAR', 'VERSION:2.0', ...own('VTODO', lines), 'END:VCALENDAR']);
    const ways: Array<(t: string) => string[]> = [
      (t) => ['STATUS:COMPLETED', `COMPLETED:${t}Z`],
      (t) => ['DTSTAMP:20200101T000000Z', `LAST-MODIFIED:${t}Z`, 'STATUS:CANCELLED'],
      (t) => [`DTSTAMP:${t}Z`, 'STATUS:COMPLETED'],
    ];
    let before = 0;
    let after = 0;
    for (const seed of SEEDS) {
      const r = rng(seed);
      // To the second, within a month either side of the start.
      const at = START.getTime() + Math.floor((r() * 2 - 1) * 30 * 24 * 3600) * 1000;
      const body = task(pick(r, ways)(stamp(at)));
      const over = at < START.getTime();
      expect(calendarObjectIsOver(body, START), `seed ${seed}`).toBe(over);
      if (over) {
        before += 1;
        continue;
      }
      after += 1;
      expect(applyAddressChanges('icalendar', body, TABLE, [], START).body, `seed ${seed}`).toContain(
        '\r\nORGANIZER;CN=Ana:mailto:ana@example.org\r\n',
      );
    }
    expect(before).toBeGreaterThan(50);
    expect(after).toBeGreaterThan(50);
  });

  it('gives an object the same bytes under any two tables that give it the same digest, and a row it never names changes nothing (0168 S4)', () => {
    const OUT = row('outside@other.example.org', 'outside@example.org');
    const GRANDMA = row('grandma@old.example.org', 'grandma@example.org');
    const universe = [ANA, BEN, OUT, GRANDMA];
    for (const seed of SEEDS) {
      const r = rng(seed * 7919);
      const { body } = randomObject(rng(seed));
      for (let k = 0; k < 4; k += 1) {
        const t1 = universe.filter(() => r() < 0.5);
        const a = applyAddressChanges('icalendar', body, t1, OWN, START);
        const b = applyAddressChanges('icalendar', body, universe.filter(() => r() < 0.5), OWN, START);
        if (a.digest === b.digest) expect(a.body, `seed ${seed} pair ${k}`).toBe(b.body);
        const withGrandma = applyAddressChanges('icalendar', body, [...t1.filter((x) => x !== GRANDMA), GRANDMA], OWN, START);
        const without = applyAddressChanges('icalendar', body, t1.filter((x) => x !== GRANDMA), OWN, START);
        expect(withGrandma.digest, `seed ${seed}`).toBe(without.digest);
        expect(withGrandma.body, `seed ${seed}`).toBe(without.body);
      }
    }
  });

  it('records no digest for an object that is over, under any table', () => {
    for (const seed of SEEDS) {
      const { body } = randomObject(rng(seed));
      if (!calendarObjectIsOver(body, START)) continue;
      expect(applyAddressChanges('icalendar', body, TABLE, OWN, START).digest, `seed ${seed}`).toBeNull();
      expect(applyAddressChanges('icalendar', body, [BEN], OWN, START).digest, `seed ${seed}`).toBeNull();
    }
    // The digest of a changed object still names the rows that decided it.
    const ahead = event(['DTSTART:20261201T090000Z']);
    expect(applyAddressChanges('icalendar', ahead, TABLE, [], START).digest).toBe(addressTableDigest([ANA, BEN]));
  });
});
