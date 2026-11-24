// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CALENDAR LISTED FOR ITS WINDOW (workplan 0170 T4, §4.3).
 *
 * With `since`, a CalDAV source lists a calendar with `calendar-query` and a
 * `time-range` (RFC 4791 §9.9), plus every series (`prop-filter` RRULE and
 * RDATE), so a server that does not expand recurrence for `time-range` still
 * puts a series that began years ago in front of the sync loop. It returns
 * more than the window, never less: a refusal lists the calendar whole. Its
 * cursor claims nothing, whatever cursor came in. Tasks are never windowed.
 *
 * And the DTSTART parse §4.3 names: read from the object's own component, a
 * TZID time in UTC, never a VTIMEZONE's 1970 start, never "now".
 */

import { describe, it, expect, vi } from 'vitest';
import { CalDAVSource } from './caldav-source.ts';
import type { HttpClient, HttpRequestOptions, HttpResponse } from './dav-http.types.ts';
import type { CalendarFolder } from '@openmig/shared';

const FOLDER: CalendarFolder = { name: 'Family', path: '/caldav/v2/family/events/' };
const SINCE = new Date('2026-08-26T00:00:00.000Z');

const vcal = (...lines: string[]): string =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR'].join('\r\n');

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Amsterdam',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'DTSTART:19701025T030000',
  'END:STANDARD',
  'END:VTIMEZONE',
];

const UPCOMING = vcal(...VTIMEZONE, 'BEGIN:VEVENT', 'UID:upcoming', 'DTSTART;TZID=Europe/Amsterdam:20261201T100000', 'END:VEVENT');
const OLD_SERIES = vcal('BEGIN:VEVENT', 'UID:standup', 'DTSTART:20190107T080000Z', 'RRULE:FREQ=WEEKLY', 'END:VEVENT');
const ENDED_SERIES = vcal('BEGIN:VEVENT', 'UID:course', 'DTSTART:20240108T080000Z', 'RRULE:FREQ=WEEKLY;UNTIL=20250630T080000Z', 'END:VEVENT');
const OLD_SINGLE = vcal('BEGIN:VEVENT', 'UID:old', 'DTSTART:20200101T100000Z', 'END:VEVENT');

function multistatus(objects: Readonly<Record<string, string>>): HttpResponse {
  const responses = Object.entries(objects).map(
    ([name, ics]) => `<D:response>
        <D:href>/caldav/v2/family/events/${name}.ics</D:href>
        <D:propstat><D:prop>
          <D:getetag>"etag-${name}"</D:getetag>
          <C:calendar-data>${ics}</C:calendar-data>
        </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
      </D:response>`,
  );
  return {
    status: 207,
    body: `<?xml version="1.0" encoding="utf-8"?>
    <D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">${responses.join('\n')}</D:multistatus>`,
    headers: {},
  };
}

interface Answers {
  readonly sync?: HttpResponse;
  readonly timeRange?: HttpResponse;
  readonly rrule?: HttpResponse;
  readonly rdate?: HttpResponse;
  readonly whole?: HttpResponse;
}

/** A server that answers by the question asked, and records every body. */
function server(answers: Answers): { client: HttpClient; asked: string[] } {
  const asked: string[] = [];
  const empty = multistatus({});
  const client: HttpClient = {
    request: vi.fn(async (options: HttpRequestOptions): Promise<HttpResponse> => {
      const body = String(options.body ?? '');
      asked.push(body);
      if (body.includes('sync-collection')) return answers.sync ?? empty;
      if (body.includes('time-range')) return answers.timeRange ?? empty;
      if (body.includes('prop-filter name="RRULE"')) return answers.rrule ?? empty;
      if (body.includes('prop-filter name="RDATE"')) return answers.rdate ?? empty;
      return answers.whole ?? empty;
    }),
  };
  return { client, asked };
}

function source(client: HttpClient, component?: 'VEVENT' | 'VTODO'): CalDAVSource {
  const s = new CalDAVSource(
    { url: 'https://caldav.example.org/', username: 'owner@example.org', password: 'x', ...(component ? { component } : {}) },
    { httpClient: client },
  );
  (s as unknown as { calendarHomeSet: string }).calendarHomeSet = '/caldav/v2/';
  return s;
}

const uids = (items: ReadonlyArray<{ item: { uid: string } }>): string[] => items.map((i) => i.item.uid).sort();

describe('a CalDAV listing with a window', () => {
  it('asks a time-range from a day before since, and every series, and no sync-collection', async () => {
    const { client, asked } = server({});
    await source(client).listSince(FOLDER, undefined, { since: SINCE });

    expect(asked.some((b) => b.includes('sync-collection'))).toBe(false);
    expect(asked).toHaveLength(3);
    // A day early, for floating times and dates the server reads in a zone of its own.
    expect(asked[0]).toMatch(/<C:comp-filter name="VEVENT">\s*<C:time-range start="20260825T000000Z"\/>/);
    expect(asked[1]).toMatch(/<C:comp-filter name="VEVENT">\s*<C:prop-filter name="RRULE"\/>/);
    expect(asked[2]).toMatch(/<C:comp-filter name="VEVENT">\s*<C:prop-filter name="RDATE"\/>/);
  });

  it('still lists a series that began years ago when the time-range leaves it out, once', async () => {
    // A server that tests a series by its first occurrence only.
    const { client } = server({
      timeRange: multistatus({ upcoming: UPCOMING }),
      rrule: multistatus({ standup: OLD_SERIES, course: ENDED_SERIES, upcoming: UPCOMING }),
    });
    const result = await source(client).listSince(FOLDER, undefined, { since: SINCE });

    expect(uids(result.items)).toEqual(['course', 'standup', 'upcoming']);
  });

  it('claims nothing in its cursor, and reports no removals, whatever cursor came in', async () => {
    const { client } = server({ timeRange: multistatus({ upcoming: UPCOMING }) });
    const result = await source(client).listSince(FOLDER, { value: 'sync-token:https://example.org/tok/41' }, { since: SINCE });

    expect(result.nextCursor).toEqual({ value: '' });
    expect(result.removed).toBeUndefined();
  });

  it('lists the calendar whole when the server refuses a window query', async () => {
    const { client, asked } = server({
      timeRange: multistatus({ upcoming: UPCOMING }),
      rrule: { status: 400, body: 'Request contains an invalid argument.', headers: {} },
      whole: multistatus({ upcoming: UPCOMING, standup: OLD_SERIES, old: OLD_SINGLE }),
    });
    const result = await source(client).listSince(FOLDER, undefined, { since: SINCE });

    expect(uids(result.items)).toEqual(['old', 'standup', 'upcoming']);
    expect(asked.at(-1)).not.toMatch(/time-range|prop-filter/);
  });

  it('never windows a task list', async () => {
    const todo = vcal('BEGIN:VTODO', 'UID:t1', 'DUE:20200102T100000Z', 'END:VTODO');
    const { client, asked } = server({ sync: multistatus({ t1: todo }) });
    const result = await source(client, 'VTODO').listSince(FOLDER, undefined, { since: SINCE });

    expect(asked.some((b) => /time-range|prop-filter/.test(b))).toBe(false);
    expect(uids(result.items)).toEqual(['t1']);
  });

  it('asks no time-range without a window', async () => {
    const { client, asked } = server({ sync: multistatus({ old: OLD_SINGLE }) });
    const result = await source(client).listSince(FOLDER, undefined);

    expect(asked.some((b) => /time-range|prop-filter/.test(b))).toBe(false);
    expect(uids(result.items)).toEqual(['old']);
  });
});

describe('the DTSTART an item carries', () => {
  it('is the VEVENT own start in UTC, never the VTIMEZONE 1970 start', async () => {
    const { client } = server({ sync: multistatus({ upcoming: UPCOMING }) });
    const [item] = (await source(client).listSince(FOLDER, undefined)).items;

    expect(item?.item.start).toBe('2026-12-01T09:00:00Z');
  });

  it('is the series start, not an override listed before it', async () => {
    const ics = vcal(
      'BEGIN:VEVENT', 'UID:s', 'RECURRENCE-ID:20260907T080000Z', 'DTSTART:20260908T080000Z', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:s', 'DTSTART:20260601T080000Z', 'DTEND:20260601T090000Z', 'RRULE:FREQ=WEEKLY', 'END:VEVENT',
    );
    const { client } = server({ sync: multistatus({ s: ics }) });
    const [item] = (await source(client).listSince(FOLDER, undefined)).items;

    expect(item?.item.start).toBe('2026-06-01T08:00:00Z');
    expect(item?.item.end).toBe('2026-06-01T09:00:00Z');
  });

  it('keeps a date as a date, and is empty when there is no DTSTART', async () => {
    const day = vcal('BEGIN:VEVENT', 'UID:d', 'DTSTART;VALUE=DATE:20260901', 'END:VEVENT');
    const todo = vcal('BEGIN:VTODO', 'UID:t', 'DUE:20260901T100000Z', 'END:VTODO');
    const { client } = server({ sync: multistatus({ d: day }) });
    expect((await source(client).listSince(FOLDER, undefined)).items[0]?.item.start).toBe('2026-09-01T00:00:00Z');
    const tasks = server({ sync: multistatus({ t: todo }) });
    expect((await source(tasks.client, 'VTODO').listSince(FOLDER, undefined)).items[0]?.item.start).toBe('');
  });
});
