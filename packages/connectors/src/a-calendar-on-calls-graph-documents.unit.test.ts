// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CALENDAR ON CALLS GRAPH DOCUMENTS (2026-11-24).
 *
 * A personal Microsoft account's four calendars listed no event, because the
 * Graph calendar source stood on two calls Graph v1.0 does not document:
 *
 *  - a calendar's `events/delta`, which v1.0 offers only as
 *    `calendarView/delta`, with a start and an end date
 *    (https://learn.microsoft.com/en-us/graph/api/event-delta?view=graph-rest-1.0);
 *  - an event's `/$value`, asked for with
 *    `Prefer: outlook.body-content-type="icalendar"`, where `$value` is a
 *    message's and that header takes `text` or `html`
 *    (https://learn.microsoft.com/en-us/graph/api/event-get?view=graph-rest-1.0).
 *
 * Its tests mocked both, answering by call order, so neither ever failed. This
 * fails if either comes back: in the source's code, and in what it actually
 * asks Graph for over a whole account.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import type { TokenProvider } from '@openmig/shared';
import { GraphCalendarSource } from './graph-calendar-source.ts';
import { fakeGraphCalendars } from './__testing__/graph-calendar-fake.ts';
import type { GraphEvent } from './graph-calendar-source.types.ts';

const SOURCE = join(import.meta.dirname, 'graph-calendar-source.ts');

/** The file's code, without its comments: the header says what was wrong, and may. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/** A calendar's events delta that is not the documented `calendarView/delta`. */
const UNDOCUMENTED_DELTA = /(?<!calendarView)\/(?:events\/)?delta\b|events\/delta/;
const EVENT_VALUE = /\/\$value\b/;
const ICALENDAR_BODY = /body-content-type\s*=\s*\\?"?icalendar/i;

const tokens: TokenProvider = {
  getToken: vi.fn().mockResolvedValue({ accessToken: 't', tokenType: 'Bearer', expiresAt: Date.now() + 3_600_000 }),
  refresh: vi.fn(),
  isTokenValid: vi.fn().mockReturnValue(true),
  getTokenStatus: vi.fn().mockReturnValue({ isValid: true, timeUntilExpiry: 3600 }),
} as unknown as TokenProvider;

const SERIES: GraphEvent = {
  id: 'series-1',
  iCalUId: 'series-uid',
  subject: 'Every Wednesday',
  start: { dateTime: '2026-09-02T17:00:00.0000000', timeZone: 'UTC' },
  end: { dateTime: '2026-09-02T18:00:00.0000000', timeZone: 'UTC' },
  originalStartTimeZone: 'W. Europe Standard Time',
  isAllDay: false,
  type: 'seriesMaster',
  recurrence: {
    pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'] },
    range: { type: 'noEnd', startDate: '2026-09-02' },
  },
};

const HOLIDAY: GraphEvent = {
  id: 'holiday-1',
  iCalUId: 'holiday-uid',
  subject: 'New Year’s Day',
  start: { dateTime: '2027-01-01T00:00:00.0000000', timeZone: 'UTC' },
  end: { dateTime: '2027-01-02T00:00:00.0000000', timeZone: 'UTC' },
  isAllDay: true,
  type: 'singleInstance',
};

describe('the Graph calendar source, in its code', () => {
  it('asks for no calendar events delta but calendarView/delta', () => {
    const found = code(SOURCE)
      .split('\n')
      .filter((line) => UNDOCUMENTED_DELTA.test(line) && !/calendarView\/delta/.test(line));
    expect(found, 'v1.0 documents only calendarView/delta, with startDateTime and endDateTime').toEqual([]);
  });

  it('asks for no event as $value, and for no body as iCalendar', () => {
    const lines = code(SOURCE).split('\n');
    expect(lines.filter((l) => EVENT_VALUE.test(l)), '`$value` is documented for messages, not events').toEqual([]);
    expect(lines.filter((l) => ICALENDAR_BODY.test(l)), 'outlook.body-content-type takes "text" or "html"').toEqual([]);
  });
});

describe('the Graph calendar source, on the wire', () => {
  it('over a whole account asks only what v1.0 documents, and finds every event', async () => {
    const fake = fakeGraphCalendars([
      { id: 'cal-a', name: 'Calendar', events: [SERIES], series: { 'series-1': { cancelled: ['OID.series-1.2026-09-09'] } } },
      { id: 'cal-b', name: 'Holidays', canEdit: false, events: [HOLIDAY] },
    ]);
    const source = new GraphCalendarSource(tokens, 'tenant', undefined, { httpClient: fake.client });
    let events = 0;
    for (const folder of await source.listFolders()) {
      events += (await source.listSince(folder)).items.length;
    }

    expect(events, 'four calendars and no event is the defect this guards').toBe(2);
    for (const r of fake.requests) {
      const prefer = Object.entries(r.headers).find(([k]) => k.toLowerCase() === 'prefer')?.[1] ?? '';
      expect(r.method).toBe('GET');
      expect(r.url).not.toMatch(EVENT_VALUE);
      expect(r.url.replace(/calendarView\/delta/g, '')).not.toMatch(/\/delta\b/);
      expect(prefer).not.toMatch(/icalendar/i);
    }
    // And each request is one of the three documented shapes.
    const shapes = fake.requests.map((r) => {
      const u = new URL(r.url);
      if (u.pathname === '/v1.0/me/calendars') return 'calendars';
      if (/^\/v1\.0\/me\/calendars\/[^/]+\/events$/.test(u.pathname) && u.searchParams.get('$select')) return 'events';
      if (
        /^\/v1\.0\/me\/calendars\/[^/]+\/events\/[^/]+$/.test(u.pathname) &&
        u.searchParams.get('$select') === 'cancelledOccurrences,exceptionOccurrences' &&
        u.searchParams.get('$expand') === 'exceptionOccurrences'
      ) {
        return 'series';
      }
      return `undocumented: ${r.url}`;
    });
    expect(shapes).toEqual(['calendars', 'events', 'series', 'events']);
  });
});
