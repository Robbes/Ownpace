// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GRAPH CALENDAR'S WINDOW, BEFORE THE READ (workplan 0170 T4, §4.3).
 *
 * The calendar's events are listed whole either way (no v1.0 delta fits a
 * calendar's events: `graph-calendar-source.ts`), and a series costs a second
 * request for its exceptions and cancellations. With `since`, an entry plainly
 * over before the window is not built and its series not read; a series with
 * no end, an occurrence, an exception, a removal and anything whose times do
 * not read are. The cursor keeps every id the listing saw, window or not, so
 * it claims nothing about an event it did not list.
 */

import { describe, it, expect, vi } from 'vitest';
import { GraphCalendarSource, graphEntryMayBeInWindow } from './graph-calendar-source.ts';
import type { GraphEvent } from './graph-calendar-source.types.ts';
import { fakeGraphCalendars } from './__testing__/graph-calendar-fake.ts';
import type { TokenProvider } from '@openmig/shared';

const SINCE = new Date('2026-08-26T00:00:00.000Z');
const FOLDER = { path: '/calendars/cal1', name: 'Calendar' };

const tokens: TokenProvider = {
  getToken: vi.fn().mockResolvedValue({ accessToken: 't', tokenType: 'Bearer', expiresAt: Date.now() + 3_600_000 }),
  refresh: vi.fn(),
  isTokenValid: vi.fn().mockReturnValue(true),
  getTokenStatus: vi.fn().mockReturnValue({ isValid: true, timeUntilExpiry: 3600 }),
} as unknown as TokenProvider;

function entry(id: string, over: Partial<GraphEvent> = {}): GraphEvent {
  return {
    id,
    subject: id,
    isAllDay: false,
    isCancelled: false,
    type: 'singleInstance',
    start: { dateTime: '2026-09-10T10:00:00.0000000', timeZone: 'UTC' },
    end: { dateTime: '2026-09-10T11:00:00.0000000', timeZone: 'UTC' },
    ...over,
  };
}

/** A listing of `entries` in one calendar, and every request made of it. */
function graph(entries: GraphEvent[]) {
  return fakeGraphCalendars([{ id: 'cal1', name: 'Calendar', events: entries }]);
}

/** The series whose exceptions and cancellations were read. */
const seriesRead = (requests: ReadonlyArray<{ url: string }>): string[] =>
  requests.flatMap((r) => /\/events\/([^/?]+)\?/.exec(r.url)?.[1] ?? []).sort();

describe('graphEntryMayBeInWindow', () => {
  it('leaves a single event that ended before since, and keeps one that ends after', () => {
    expect(graphEntryMayBeInWindow(entry('old', { end: { dateTime: '2025-01-01T11:00:00.0000000', timeZone: 'UTC' } }), SINCE)).toBe(false);
    expect(graphEntryMayBeInWindow(entry('new'), SINCE)).toBe(true);
    // In UTC an end of 23:00 on the 25th is out; in a zone it may be the 26th.
    expect(graphEntryMayBeInWindow(entry('utc', { end: { dateTime: '2026-08-25T23:00:00.0000000', timeZone: 'UTC' } }), SINCE)).toBe(false);
    expect(graphEntryMayBeInWindow(entry('zoned', { end: { dateTime: '2026-08-25T23:00:00.0000000', timeZone: 'Pacific Standard Time' } }), SINCE)).toBe(true);
  });

  it('keeps a series with no end, or a number of occurrences, and leaves one whose end date passed', () => {
    const series = (range: NonNullable<GraphEvent['recurrence']>['range']): GraphEvent =>
      entry('s', {
        type: 'seriesMaster',
        start: { dateTime: '2019-01-07T09:00:00.0000000', timeZone: 'UTC' },
        end: { dateTime: '2019-01-07T09:30:00.0000000', timeZone: 'UTC' },
        recurrence: { range },
      });
    expect(graphEntryMayBeInWindow(series({ type: 'noEnd', startDate: '2019-01-07' } as never), SINCE)).toBe(true);
    expect(graphEntryMayBeInWindow(series({ type: 'numbered', numberOfOccurrences: 10 }), SINCE)).toBe(true);
    expect(graphEntryMayBeInWindow(series({ type: 'endDate', endDate: '2025-06-30' }), SINCE)).toBe(false);
    expect(graphEntryMayBeInWindow(series({ type: 'endDate', endDate: '2026-08-25' }), SINCE)).toBe(true);
  });

  it('keeps an occurrence, an exception, a removal and an entry with no times', () => {
    const old = { end: { dateTime: '2020-01-01T11:00:00.0000000', timeZone: 'UTC' } };
    expect(graphEntryMayBeInWindow(entry('o', { ...old, type: 'occurrence' }), SINCE)).toBe(true);
    expect(graphEntryMayBeInWindow(entry('x', { ...old, type: 'exception' }), SINCE)).toBe(true);
    expect(graphEntryMayBeInWindow({ id: 'gone', '@removed': { reason: 'deleted' } } as GraphEvent, SINCE)).toBe(true);
    const { end: _end, ...noEnd } = entry('n');
    expect(graphEntryMayBeInWindow(noEnd as GraphEvent, SINCE)).toBe(true);
  });
});

describe('a Graph calendar listing with a window', () => {
  const entries = [
    entry('upcoming'),
    entry('old', { end: { dateTime: '2024-03-01T11:00:00.0000000', timeZone: 'UTC' } }),
    entry('ended', {
      type: 'seriesMaster',
      end: { dateTime: '2024-01-08T09:30:00.0000000', timeZone: 'UTC' },
      start: { dateTime: '2024-01-08T09:00:00.0000000', timeZone: 'UTC' },
      recurrence: { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] }, range: { type: 'endDate', endDate: '2025-06-30' } },
    }),
    entry('standup', {
      type: 'seriesMaster',
      end: { dateTime: '2019-01-07T09:30:00.0000000', timeZone: 'UTC' },
      start: { dateTime: '2019-01-07T09:00:00.0000000', timeZone: 'UTC' },
      recurrence: { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] }, range: { type: 'noEnd' } },
    }),
  ];

  it('builds only what may be in the window, and reads only those series', async () => {
    const { client, requests } = graph(entries);
    const source = new GraphCalendarSource(tokens, 'tenant', undefined, { httpClient: client });
    const result = await source.listSince(FOLDER, undefined, { since: SINCE });

    expect(seriesRead(requests)).toEqual(['standup']);
    expect(result.items.map((i) => i.item.uid).sort()).toEqual(['standup', 'upcoming']);
  });

  it('builds every event without a window', async () => {
    const { client, requests } = graph(entries);
    const source = new GraphCalendarSource(tokens, 'tenant', undefined, { httpClient: client });
    const result = await source.listSince(FOLDER);

    expect(seriesRead(requests)).toEqual(['ended', 'standup']);
    expect(result.items.map((i) => i.item.uid).sort()).toEqual(['ended', 'old', 'standup', 'upcoming']);
  });

  it('keeps every id it listed in its cursor, window or not, so a later listing reports no removal it did not see', async () => {
    const { client } = graph(entries);
    const source = new GraphCalendarSource(tokens, 'tenant', undefined, { httpClient: client });
    const windowed = await source.listSince(FOLDER, undefined, { since: SINCE });
    const whole = await source.listSince(FOLDER, windowed.nextCursor);
    expect(whole.removed).toBeUndefined();
    expect(windowed.nextCursor.value).toBe(whole.nextCursor.value);
  });
});
