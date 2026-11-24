// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN OUTLOOK SERIES THAT ARRIVES WHOLE (2026-11-24).
 *
 * A personal Microsoft account's calendars listed no event at all, while one
 * held a weekly repeating event and another the year's holidays. The Graph
 * calendar source now lists on calls v1.0 documents and builds each event's
 * iCalendar itself (`graph-calendar-source.ts`). This runs it through the
 * calendar pass the product runs, on a fake Graph that answers by address:
 *
 *  - the series arrives as one object, its moved occurrence and its cancelled
 *    one inside it, and the holiday as a date;
 *  - what the target is handed survives what a CalDAV target does to it
 *    before its PUT (`neutraliseScheduling`, `withoutGuests`) and parses;
 *  - a second pass with nothing changed rewrites nothing;
 *  - an event gone from the calendar is reported as a deletion the source
 *    stated, and nothing is removed from the target for it (hard rule 2).
 */

import { describe, it, expect } from 'vitest';
import { GraphCalendarSource } from '@openmig/connectors';
import {
  asMappingId,
  asTenantId,
  componentsNamed,
  neutraliseScheduling,
  parseIcalComponents,
  withoutGuests,
  type OAuth2Token,
  type RawCalendarEvent,
  type TokenProvider,
  type UpsertResult,
} from '@openmig/shared';
import { runCalendarSync } from './dav-sync.ts';
import { MemoryCursorStore, MemoryLedger } from './__testing__/memory.ts';

const TENANT = asTenantId('0e300000-e29b-41d4-a716-446655440011');
const MAPPING = asMappingId('0e300000-e29b-41d4-a716-446655440012');

const TOKEN: OAuth2Token = { accessToken: 'token', tokenType: 'Bearer', expiresAt: Date.now() + 3_600_000 };
const tokens: TokenProvider = {
  getToken: async () => TOKEN,
  refresh: async () => TOKEN,
  isTokenValid: () => true,
  getTokenStatus: () => ({ isValid: true, timeUntilExpiry: 3600 }),
} as unknown as TokenProvider;

const json = (body: unknown) => ({ status: 200, body: JSON.stringify(body), headers: {} });

/** Two calendars: a weekly series and a single event, and a read-only holiday calendar. */
function fakeGraph() {
  const state = {
    main: [
      {
        id: 'wed',
        iCalUId: 'wednesday-uid',
        changeKey: 'ck-wed',
        subject: 'Choir',
        start: { dateTime: '2026-09-02T17:00:00.0000000', timeZone: 'UTC' },
        end: { dateTime: '2026-09-02T18:00:00.0000000', timeZone: 'UTC' },
        originalStartTimeZone: 'W. Europe Standard Time',
        isAllDay: false,
        type: 'seriesMaster',
        recurrence: {
          pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'] },
          range: { type: 'noEnd', startDate: '2026-09-02' },
        },
        attendees: [{ type: 'required', status: { response: 'accepted' }, emailAddress: { address: 'guest@example.org' } }],
        organizer: { emailAddress: { address: 'owner@example.org' } },
      },
      {
        id: 'dentist',
        iCalUId: 'dentist-uid',
        changeKey: 'ck-dentist',
        subject: 'Dentist',
        start: { dateTime: '2026-12-01T08:00:00.0000000', timeZone: 'UTC' },
        end: { dateTime: '2026-12-01T08:30:00.0000000', timeZone: 'UTC' },
        isAllDay: false,
        type: 'singleInstance',
      },
    ],
    holidays: [
      {
        id: 'xmas',
        iCalUId: 'xmas-uid',
        changeKey: 'ck-xmas',
        subject: 'Christmas Day',
        start: { dateTime: '2026-12-25T00:00:00.0000000', timeZone: 'UTC' },
        end: { dateTime: '2026-12-26T00:00:00.0000000', timeZone: 'UTC' },
        isAllDay: true,
        type: 'singleInstance',
        showAs: 'free',
      },
    ],
  };
  const client = {
    request: async ({ url, method }: { url: string; method: string }) => {
      if (method !== 'GET') return { status: 405, body: '{}', headers: {} };
      const path = new URL(url).pathname.replace('/v1.0/me', '');
      if (path === '/calendars') {
        return json({
          value: [
            { id: 'main', name: 'Calendar', canEdit: true },
            { id: 'holidays', name: 'Holidays', canEdit: false },
          ],
        });
      }
      if (path === '/calendars/main/events') return json({ value: state.main });
      if (path === '/calendars/holidays/events') return json({ value: state.holidays });
      if (path === '/calendars/main/events/wed') {
        return json({
          id: 'wed',
          cancelledOccurrences: ['OID.wed.2026-10-28'],
          exceptionOccurrences: [
            {
              id: 'wed-x',
              changeKey: 'ck-wed-x',
              type: 'exception',
              occurrenceId: 'OID.wed.2026-10-14',
              originalStart: '2026-10-14T17:00:00Z',
              subject: 'Choir (later)',
              start: { dateTime: '2026-10-14T18:00:00.0000000', timeZone: 'UTC' },
              end: { dateTime: '2026-10-14T19:00:00.0000000', timeZone: 'UTC' },
            },
          ],
        });
      }
      return { status: 400, body: JSON.stringify({ error: { code: 'BadRequest', message: `no route ${path}` } }), headers: {} };
    },
  };
  return { state, client };
}

/** Keeps what it was handed, as a CalDAV target would PUT it. */
function memoryTarget() {
  const held = new Map<string, string>();
  const rewrites: string[] = [];
  const removed: string[] = [];
  return {
    held,
    rewrites,
    removed,
    ensureCalendar: async (folder: { path: string }) => `t${folder.path}`,
    upsertCalendarEvent: async (
      _calendar: string,
      raw: RawCalendarEvent,
      options?: { overwrite?: boolean },
    ): Promise<UpsertResult> => {
      // What the CalDAV target sends: no invitation leaves the copy.
      held.set(raw.item.uid, neutraliseScheduling(withoutGuests(raw.icalendar)));
      if (options?.overwrite) {
        rewrites.push(raw.item.uid);
        return { targetId: raw.item.uid, created: false, updated: true };
      }
      return { targetId: raw.item.uid, created: true };
    },
    removeCalendarEvent: async (id: string) => {
      removed.push(id);
    },
  };
}

function pass(source: GraphCalendarSource, target: ReturnType<typeof memoryTarget>, ledger: MemoryLedger, cursors: MemoryCursorStore) {
  return runCalendarSync({
    tenantId: TENANT,
    mappingId: MAPPING,
    source,
    target: target as never,
    ledger,
    cursors,
    sourceIsAuthorityOnExistence: true,
    stillTheAuthority: async () => true,
  });
}

describe('an Outlook series, through the calendar pass', () => {
  it('arrives as one object with its changed and cancelled occurrences, beside the holiday', async () => {
    const { client } = fakeGraph();
    const source = new GraphCalendarSource(tokens, 'tenant', undefined, { httpClient: client });
    const target = memoryTarget();
    const ledger = new MemoryLedger();
    const cursors = new MemoryCursorStore();

    const first = await pass(source, target, ledger, cursors);
    expect(first.collectionsListed).toBe(2);
    expect(first.created).toBe(3);
    expect([...target.held.keys()].sort()).toEqual(['dentist-uid', 'wednesday-uid', 'xmas-uid']);

    const series = componentsNamed(parseIcalComponents(target.held.get('wednesday-uid')!), 'VEVENT');
    expect(series).toHaveLength(2);
    expect(series[0]!.properties.find((p) => p.name === 'EXDATE')?.value).toBe('20261028T190000');
    expect(series[1]!.properties.find((p) => p.name === 'RECURRENCE-ID')?.value).toBe('20261014T190000');
    // No ATTENDEE reaches the target, so no invitation goes out from the copy.
    expect(target.held.get('wednesday-uid')).not.toMatch(/^ATTENDEE/m);

    const xmas = componentsNamed(parseIcalComponents(target.held.get('xmas-uid')!), 'VEVENT')[0]!;
    expect(xmas.properties.find((p) => p.name === 'DTSTART')).toMatchObject({ params: { VALUE: 'DATE' }, value: '20261225' });

    const again = await pass(source, target, ledger, cursors);
    expect(again.created).toBe(0);
    expect(again.updated ?? 0).toBe(0);
    expect(target.rewrites).toEqual([]);
  });

  it('an event gone from the calendar is a deletion the source stated, and nothing is removed for it', async () => {
    const { state, client } = fakeGraph();
    const source = new GraphCalendarSource(tokens, 'tenant', undefined, { httpClient: client });
    const target = memoryTarget();
    const ledger = new MemoryLedger();
    const cursors = new MemoryCursorStore();

    await pass(source, target, ledger, cursors);
    state.main = state.main.filter((e) => e.id !== 'dentist');
    const after = await pass(source, target, ledger, cursors);

    expect(after.deletions.map((d) => d.evidence)).toEqual(['reported']);
    expect(target.removed).toEqual([]);
    expect(target.held.has('dentist-uid')).toBe(true);
  });
});
