// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GRAPH CALENDAR'S WINDOW, BEFORE THE FETCH (workplan 0170 T4, §4.3).
 *
 * Graph's events delta takes no date filter, and every event it lists costs a
 * second request for its iCalendar (`$value`). With `since`, an entry plainly
 * over before the window is not fetched; a series with no end, an occurrence,
 * an exception, a removal and anything whose times do not read are. Its
 * cursor is marked with its window, so a listing with no window, or another,
 * does not read on from a deltaLink that claims what the window set aside.
 */

import { describe, it, expect, vi } from 'vitest';
import { GraphCalendarSource, graphEntryMayBeInWindow } from './graph-calendar-source.ts';
import type { GraphEvent } from './graph-calendar-source.types.ts';
import type { HttpClient, HttpRequestOptions, HttpResponse } from './dav-http.types.ts';
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
    isRecurring: false,
    type: 'singleInstance',
    start: { dateTime: '2026-09-10T10:00:00.0000000', timeZone: 'UTC' },
    end: { dateTime: '2026-09-10T11:00:00.0000000', timeZone: 'UTC' },
    ...over,
  };
}

const ICS = (uid: string): string =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', `UID:${uid}`, 'DTSTART:20260910T100000Z', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');

/** A delta of `entries`, and each event's `$value`; records every URL. */
function graph(entries: GraphEvent[]): { client: HttpClient; urls: string[] } {
  const urls: string[] = [];
  const client: HttpClient = {
    request: vi.fn(async (options: HttpRequestOptions): Promise<HttpResponse> => {
      urls.push(options.url);
      const value = /\/events\/([^/]+)\/\$value$/.exec(options.url);
      if (value) return { status: 200, body: ICS(value[1]!), headers: {} };
      return {
        status: 200,
        body: JSON.stringify({ value: entries, '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/calendars/cal1/events/delta?$deltatoken=d1' }),
        headers: {},
      };
    }),
  };
  return { client, urls };
}

const fetched = (urls: string[]): string[] =>
  urls.flatMap((u) => /\/events\/([^/]+)\/\$value$/.exec(u)?.[1] ?? []).sort();

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
      recurrence: { range: { type: 'endDate', endDate: '2025-06-30' } },
    }),
    entry('standup', {
      type: 'seriesMaster',
      end: { dateTime: '2019-01-07T09:30:00.0000000', timeZone: 'UTC' },
      start: { dateTime: '2019-01-07T09:00:00.0000000', timeZone: 'UTC' },
      recurrence: { range: { type: 'noEnd' } },
    }),
  ];

  it('fetches only what may be in the window', async () => {
    const { client, urls } = graph(entries);
    const source = new GraphCalendarSource(tokens, 'tenant', undefined, { httpClient: client });
    const result = await source.listSince(FOLDER, undefined, { since: SINCE });

    expect(fetched(urls)).toEqual(['standup', 'upcoming']);
    expect(result.items.map((i) => i.item.uid).sort()).toEqual(['standup', 'upcoming']);
  });

  it('fetches every event without a window', async () => {
    const { client, urls } = graph(entries);
    const source = new GraphCalendarSource(tokens, 'tenant', undefined, { httpClient: client });
    const result = await source.listSince(FOLDER);

    expect(fetched(urls)).toEqual(['ended', 'old', 'standup', 'upcoming']);
    expect(result.nextCursor.value.startsWith('graph-delta:')).toBe(true);
  });

  it('marks its cursor with its window, which only the same window reads on from', async () => {
    const first = graph(entries);
    const source = new GraphCalendarSource(tokens, 'tenant', undefined, { httpClient: first.client });
    const { nextCursor } = await source.listSince(FOLDER, undefined, { since: SINCE });
    expect(nextCursor.value).toBe(`graph-delta-window:${SINCE.getTime()}:graph-delta:/calendars/cal1:https://graph.microsoft.com/v1.0/me/calendars/cal1/events/delta?$deltatoken=d1`);

    const deltaUrl = async (options?: { since: Date }): Promise<string> => {
      const g = graph([]);
      const s = new GraphCalendarSource(tokens, 'tenant', undefined, { httpClient: g.client });
      await s.listSince(FOLDER, nextCursor, options);
      return g.urls[0]!;
    };
    // The same window reads on from its deltaLink.
    expect(await deltaUrl({ since: SINCE })).toContain('$deltatoken=d1');
    // No window, or another one, lists whole.
    expect(await deltaUrl()).not.toContain('$deltatoken');
    expect(await deltaUrl({ since: new Date('2026-07-01T00:00:00Z') })).not.toContain('$deltatoken');
  });
});
