// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The window's vocabulary (workplan 0170 §3.5): its start, the data types it
 * applies to, the predicates, the record, and the setting as a mapping file
 * or the stored override carries it. Every predicate holds what it cannot
 * decide: a window must never leave out an item that belongs in it.
 */

import { describe, it, expect } from 'vitest';
import {
  RECENT_WINDOW_DAYS,
  WINDOWED_DOMAINS,
  eventInWindow,
  fileInWindow,
  formatWindowRecord,
  isWindowedDomain,
  mailInWindow,
  parseWindowRecord,
  windowCursorKey,
  windowRecordKey,
  windowSince,
} from './recent-window.ts';
import { discardedScanCursorKey } from './ports.ts';
import { ConfigError, parseMappingConfig, parseRecentOnly } from './config.ts';
import type { MailItem } from './mail.ts';
import type { FileItem } from './file.ts';
import type { RawCalendarEvent } from './calendar.ts';

const SINCE = new Date('2026-08-26T00:00:00.000Z');

function mail(receivedAt: string): MailItem {
  return {
    messageId: '<m@example.org>',
    folder: { path: 'INBOX', delimiter: '/', specialUse: 'inbox' } as MailItem['folder'],
    keywords: [],
    receivedAt,
    sourceRef: 'INBOX:1',
  };
}

function file(modifiedAt: string, isDirectory = false): FileItem {
  return { path: 'a/b.txt', isDirectory, size: 1, modifiedAt } as FileItem;
}

function event(icalendar: string, type: 'event' | 'todo' = 'event'): RawCalendarEvent {
  return { item: { uid: 'u1', type, summary: 's' } as RawCalendarEvent['item'], icalendar };
}

function vcal(...vevents: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...vevents, 'END:VCALENDAR'].join('\r\n');
}

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Amsterdam',
  'BEGIN:STANDARD',
  'DTSTART:19701025T030000',
  'END:STANDARD',
  'END:VTIMEZONE',
].join('\r\n');

describe('windowSince', () => {
  it('is the start of the UTC day ninety days before the anchor', () => {
    expect(windowSince(new Date('2026-11-24T10:00:00Z')).toISOString()).toBe('2026-08-26T00:00:00.000Z');
    expect(windowSince(new Date('2026-11-24T23:59:59Z')).toISOString()).toBe('2026-08-26T00:00:00.000Z');
  });

  it('takes another number of days, and refuses what is not one', () => {
    expect(windowSince(new Date('2026-03-01T00:00:00Z'), 1).toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(() => windowSince(new Date('nope'))).toThrow(RangeError);
    expect(() => windowSince(new Date(), 0)).toThrow(RangeError);
  });
});

describe('WINDOWED_DOMAINS', () => {
  it('is mail, files and calendars; contacts and tasks are copied whole', () => {
    expect([...WINDOWED_DOMAINS].sort()).toEqual(['calendar', 'email', 'file']);
    expect(RECENT_WINDOW_DAYS).toBe(90);
    expect(isWindowedDomain('contact')).toBe(false);
    expect(isWindowedDomain('task')).toBe(false);
    expect(isWindowedDomain('email')).toBe(true);
  });
});

describe('mailInWindow', () => {
  it('holds a message received on or after since, and leaves an older one', () => {
    expect(mailInWindow(mail('2026-08-26T00:00:00Z'), SINCE)).toBe(true);
    expect(mailInWindow(mail('2026-11-01T08:00:00Z'), SINCE)).toBe(true);
    expect(mailInWindow(mail('2026-08-25T23:59:59Z'), SINCE)).toBe(false);
  });

  it('holds a message whose date it cannot read', () => {
    expect(mailInWindow(mail(''), SINCE)).toBe(true);
    expect(mailInWindow(mail('not a date'), SINCE)).toBe(true);
  });
});

describe('fileInWindow', () => {
  it('holds a file modified on or after since, and leaves an older one', () => {
    expect(fileInWindow(file('2026-09-01T00:00:00Z'), SINCE)).toBe(true);
    expect(fileInWindow(file('2025-01-01T00:00:00Z'), SINCE)).toBe(false);
  });

  it('holds a file with no date, the epoch among them (D6), and every directory', () => {
    expect(fileInWindow(file('1970-01-01T00:00:00.000Z'), SINCE)).toBe(true);
    expect(fileInWindow(file(''), SINCE)).toBe(true);
    expect(fileInWindow(file('2020-01-01T00:00:00Z', true), SINCE)).toBe(true);
  });
});

describe('eventInWindow', () => {
  it('leaves a single event that ended before since, and holds one that ends after', () => {
    const old = vcal('BEGIN:VEVENT', 'UID:u1', 'DTSTART:20250101T100000Z', 'DTEND:20250101T110000Z', 'END:VEVENT');
    const soon = vcal('BEGIN:VEVENT', 'UID:u1', 'DTSTART:20261201T100000Z', 'DTEND:20261201T110000Z', 'END:VEVENT');
    expect(eventInWindow(event(old), SINCE)).toBe(false);
    expect(eventInWindow(event(soon), SINCE)).toBe(true);
  });

  it('reads the VEVENT, never the VTIMEZONE that comes before it', () => {
    const upcoming = vcal(VTIMEZONE, 'BEGIN:VEVENT', 'UID:u1', 'DTSTART;TZID=Europe/Amsterdam:20261201T100000', 'END:VEVENT');
    expect(eventInWindow(event(upcoming), SINCE)).toBe(true);
    const past = vcal(VTIMEZONE, 'BEGIN:VEVENT', 'UID:u1', 'DTSTART;TZID=Europe/Amsterdam:20240101T100000', 'END:VEVENT');
    expect(eventInWindow(event(past), SINCE)).toBe(false);
  });

  it('holds every event it cannot decide', () => {
    // Series, RDATEs and DURATIONs are decided since T4: recent-window-events.unit.test.ts.
    const noStart = vcal('BEGIN:VEVENT', 'UID:u1', 'SUMMARY:x', 'END:VEVENT');
    const garbled = vcal('BEGIN:VEVENT', 'UID:u1', 'DTSTART:yesterday', 'END:VEVENT');
    for (const ics of [noStart, garbled, 'not an icalendar']) {
      expect(eventInWindow(event(ics), SINCE)).toBe(true);
    }
  });

  it('holds a floating end that a time zone may move into the window, and leaves one none can', () => {
    // A floating time is read at the widest offsets there are, UTC-12 to UTC+14.
    const edge = vcal('BEGIN:VEVENT', 'UID:u1', 'DTSTART:20260825T140000', 'DTEND:20260825T150000', 'END:VEVENT');
    expect(eventInWindow(event(edge), SINCE)).toBe(true);
    const before = vcal('BEGIN:VEVENT', 'UID:u1', 'DTSTART:20260825T080000', 'DTEND:20260825T090000', 'END:VEVENT');
    expect(eventInWindow(event(before), SINCE)).toBe(false);
  });

  it('reads an all-day event as lasting its day', () => {
    const day = vcal('BEGIN:VEVENT', 'UID:u1', 'DTSTART;VALUE=DATE:20260825', 'END:VEVENT');
    const long = vcal('BEGIN:VEVENT', 'UID:u1', 'DTSTART;VALUE=DATE:20260801', 'DTEND;VALUE=DATE:20260901', 'END:VEVENT');
    const gone = vcal('BEGIN:VEVENT', 'UID:u1', 'DTSTART;VALUE=DATE:20260101', 'END:VEVENT');
    expect(eventInWindow(event(day), SINCE)).toBe(true);
    expect(eventInWindow(event(long), SINCE)).toBe(true);
    expect(eventInWindow(event(gone), SINCE)).toBe(false);
  });

  it('holds an object when any of its VEVENTs is in, and ignores an alarm', () => {
    const override = vcal(
      'BEGIN:VEVENT', 'UID:u1', 'DTSTART:20200101T100000Z', 'DTEND:20200101T110000Z', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:u1', 'RECURRENCE-ID:20261201T100000Z', 'DTSTART:20261201T120000Z', 'END:VEVENT',
    );
    expect(eventInWindow(event(override), SINCE)).toBe(true);
    const alarm = vcal(
      'BEGIN:VEVENT', 'UID:u1',
      'BEGIN:VALARM', 'TRIGGER;VALUE=DATE-TIME:20261201T100000Z', 'DTSTART:20261201T100000Z', 'END:VALARM',
      'DTSTART:20200101T100000Z', 'DTEND:20200101T110000Z', 'END:VEVENT',
    );
    expect(eventInWindow(event(alarm), SINCE)).toBe(false);
  });

  it('holds every task, whatever its dates', () => {
    const todo = vcal('BEGIN:VTODO', 'UID:u1', 'DTSTART:20200101T100000Z', 'END:VTODO');
    expect(eventInWindow(event(todo, 'todo'), SINCE)).toBe(true);
  });
});

describe('the window record', () => {
  it('lives under keys no real collection can produce, apart from the bin scan', () => {
    expect(windowRecordKey('email')).toBe('\u0001window-record\u0001email');
    expect(windowCursorKey('INBOX')).toBe('\u0001window\u0001INBOX');
    expect(windowCursorKey('INBOX')).not.toBe(discardedScanCursorKey('INBOX'));
    expect(windowCursorKey('INBOX')).not.toBe('INBOX');
  });

  it('round-trips, and reads anything else as no record', () => {
    const record = { since: '2026-08-26T00:00:00.000Z', state: 'in' } as const;
    expect(parseWindowRecord(formatWindowRecord(record))).toEqual(record);
    for (const bad of [undefined, '', 'x', '{}', '{"since":"x","state":"in"}', '{"since":"2026-08-26","state":"done"}']) {
      expect(parseWindowRecord(bad)).toBeUndefined();
    }
  });
});

describe('recentOnly, the setting', () => {
  it('reads { days: 90 } and an anchor', () => {
    expect(parseRecentOnly(undefined)).toBeUndefined();
    expect(parseRecentOnly({ days: 90 })).toEqual({ days: 90 });
    expect(parseRecentOnly({ days: 90, anchor: '2026-11-24T10:00:00Z' })).toEqual({
      days: 90,
      anchor: '2026-11-24T10:00:00.000Z',
    });
  });

  it('refuses another number of days, an unknown key and an anchor that is no date', () => {
    expect(() => parseRecentOnly(true)).toThrow(ConfigError);
    expect(() => parseRecentOnly({ days: 30 })).toThrow(/must be 90/);
    expect(() => parseRecentOnly({ days: 90, from: 'x' })).toThrow(/recentOnly\.from/);
    expect(() => parseRecentOnly({ days: 90, anchor: 'soon' })).toThrow(/recentOnly\.anchor/);
  });

  it('is read from a mapping file by parseMappingConfig, and absent when the file has none', () => {
    const base = {
      tenantId: 't',
      mappingId: 'm',
      source: {
        type: 'imap-oauth2',
        host: 'outlook.office365.com',
        port: 993,
        user: 'you@example.com',
        auth: { kind: 'xoauth2', tokenFromEnv: 'SOURCE_OAUTH_TOKEN' },
      },
      target: {
        type: 'jmap',
        baseUrl: 'https://mail.example.net',
        user: 'you@example.net',
        auth: { kind: 'basic', passwordFromEnv: 'TARGET_JMAP_PASSWORD' },
      },
    };
    expect(parseMappingConfig(base).recentOnly).toBeUndefined();
    expect(parseMappingConfig({ ...base, recentOnly: { days: 90 } }).recentOnly).toEqual({ days: 90 });
  });
});
