// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GOOGLE CALENDAR DELETION IS REPORTED (workplan 0164 T2), through the
 * sync loop.
 *
 * The owner's test of 2026-11-20 (0160 §4, step (3)): an event deleted in
 * Google never reached *Deleted on the old system*. Google answers
 * `sync-collection` with members and no calendar data (0164 T1), and the
 * CalDAV source read that as nothing, listed the calendar whole on every
 * pass, and reported no removal. `a-calendar-listed-without-its-data` holds
 * the reader; this holds what the loop does with it, over the real
 * `CalDAVSource`, the real `runCalendarSync`, and `GoogleLikeCalDav`:
 *
 * - an event deleted at Google becomes a `reported` removal on the
 *   deletions queue, and nothing is removed from the target;
 * - a 404 a reading with no token lists is reported for a copy the ledger
 *   holds, and passed over for anything never copied;
 * - an event moved between two Google calendars is a move, not a removal,
 *   with a token and without one;
 * - the token is saved only once the pass has handled what it read, so a
 *   pass that did not reads the same changes again;
 * - after the first pass, a pass reads what changed and lists nothing whole.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  asMappingId,
  asTenantId,
  calendarNaturalKeyHash,
  log,
  type CalendarFolder,
  type CalendarTargetWriter,
  type RawCalendarEvent,
  type UpsertOptions,
  type UpsertResult,
} from '@openmig/shared';
import { CalDAVSource } from '../../connectors/src/caldav-source.ts';
import type { HttpClient, HttpRequestOptions } from '../../connectors/src/dav-http.types.ts';
import { FAKE_CALDAV_URL, FAKE_HOME, GoogleLikeCalDav } from '../../connectors/src/__testing__/google-like-caldav.ts';
import { runCalendarSync } from './dav-sync.ts';
import { MemoryCursorStore, MemoryLedger } from './__testing__/memory.ts';

const TENANT = asTenantId('0164b200-e29b-41d4-a716-446655440001');
const MAPPING = asMappingId('0164b200-e29b-41d4-a716-446655440002');

afterEach(() => {
  vi.restoreAllMocks();
});

/** A target that keeps what it is given; a pass never removes, and `removeItem` is not even offered. */
class KeepingTarget implements CalendarTargetWriter {
  readonly events = new Map<string, string>();
  /** A UID whose write fails, as a server's 503 would. */
  failUid: string | undefined;

  ensureCalendar(folder: CalendarFolder): Promise<string> {
    return Promise.resolve(`target:${folder.name}`);
  }

  upsertCalendarEvent(calendarId: string, raw: RawCalendarEvent, options?: UpsertOptions): Promise<UpsertResult> {
    if (raw.item.uid === this.failUid) return Promise.reject(new Error('503 Service Unavailable'));
    const at = `${calendarId}:${raw.item.uid}`;
    const existed = this.events.has(at);
    this.events.set(at, raw.icalendar);
    if (options?.overwrite) return Promise.resolve({ targetId: at, created: false, updated: true });
    if (existed) return Promise.resolve({ targetId: at, created: false, adopted: true });
    return Promise.resolve({ targetId: at, created: true });
  }

  findCalendarByNaturalKey(): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }
}

function world() {
  const google = new GoogleLikeCalDav();
  google.pageSize = 15;
  const family = google.addCalendar('family', 'Family');
  const work = google.addCalendar('work', 'Work');
  for (let i = 1; i <= 40; i += 1) google.add(family, `e${i}`);
  for (let i = 1; i <= 5; i += 1) google.add(work, `w${i}`);

  /** A calendar whose every REPORT fails, as a calendar the source cannot read. */
  const unreadable = new Set<string>();
  const client: HttpClient = {
    request: (options: HttpRequestOptions) =>
      unreadable.has(new URL(options.url).pathname)
        ? Promise.resolve({ status: 500, headers: {}, body: 'backend error' })
        : google.client.request(options),
  };
  const source = new CalDAVSource(
    { url: FAKE_CALDAV_URL, username: 'owner@example.com', password: 'app-password' },
    { httpClient: client },
  );
  (source as unknown as { calendarHomeSet: string }).calendarHomeSet = FAKE_HOME;
  const target = new KeepingTarget();
  const ledger = new MemoryLedger();
  const cursors = new MemoryCursorStore();
  const pass = () =>
    runCalendarSync({
      tenantId: TENANT,
      mappingId: MAPPING,
      source,
      target,
      ledger,
      cursors,
      sourceIsAuthorityOnExistence: true,
      stillTheAuthority: async () => true,
    });
  const cursorOf = async (path: string) => (await cursors.get(TENANT, MAPPING, path))?.value;
  return { google, family, work, unreadable, target, ledger, cursors, pass, cursorOf };
}

const key = (uid: string): string => calendarNaturalKeyHash(uid);

describe('the first pass over a Google calendar', () => {
  it('copies every event without listing a calendar whole, and keeps each calendar\'s token', async () => {
    const w = world();

    const result = await w.pass();

    expect(result.created).toBe(45);
    expect(w.target.events.size).toBe(45);
    expect(w.google.askedOf('calendar-query'), 'a calendar was listed whole').toHaveLength(0);
    expect(await w.cursorOf(w.family)).toBe('sync-token:tok:family:40');
    expect(await w.cursorOf(w.work)).toBe('sync-token:tok:work:5');
    // The rows hold the href sync-collection names, which a later 404 names.
    const row = await w.ledger.find(TENANT, MAPPING, 'calendar', key('e3'));
    expect(row?.sourceRef).toBe(w.google.hrefOf(w.family, 'e3'));
  });
});

describe('an event deleted at Google', () => {
  it('reaches the deletions queue as reported, and nothing is removed from the target', async () => {
    const w = world();
    await w.pass();
    w.google.remove(w.family, 'e3');
    w.google.change(w.family, 'e4', 'Moved a week');
    w.google.asked.length = 0;

    const result = await w.pass();

    expect(result.deletions.map((d) => [d.naturalKeyHash, d.evidence])).toEqual([[key('e3'), 'reported']]);
    const queued = await w.ledger.listDeletions(TENANT, MAPPING, 'calendar');
    expect(queued.map((d) => [d.naturalKeyHash, d.evidence, d.confirmed])).toEqual([[key('e3'), 'reported', true]]);
    // Reported is all it is: the copy is still on the target, and the row still says copied.
    expect(w.target.events.has('target:Family:e3'), 'a pass removed what the owner did not apply').toBe(true);
    expect((await w.ledger.find(TENANT, MAPPING, 'calendar', key('e3')))?.status).toBe('copied');
    expect(result.updated).toBe(1);
    expect(await w.cursorOf(w.family)).toBe('sync-token:tok:family:42');
  });

  it('is read with the rest of what changed, and the calendar is not listed whole: 45 skipped a pass ends', async () => {
    const w = world();
    await w.pass();
    w.google.asked.length = 0;

    const quiet = await w.pass();
    w.google.remove(w.family, 'e10');
    const after = await w.pass();

    expect(quiet.scanned, 'an unchanged account was listed again').toBe(0);
    expect(quiet.skipped).toBe(0);
    expect(after.scanned).toBe(0);
    expect(after.deletions).toHaveLength(1);
    expect(w.google.askedOf('calendar-query')).toHaveLength(0);
    expect(w.google.askedOf('calendar-multiget'), 'a removal needs no read').toHaveLength(0);
  });
});

describe('a 404 in a reading with no token', () => {
  /**
   * An existing Google migration holds no token, because `calendar-query`
   * never gave one: its first pass on this reader sends none, and Google's
   * answer lists the removals it remembers (0164 T1).
   */
  it('is reported for an event this migration copied, and passed over for one it never copied', async () => {
    const w = world();
    await w.pass();
    // As the whole listing left it: a cursor holding no token.
    await w.cursors.set(TENANT, MAPPING, w.family, { value: '' });
    w.google.remove(w.family, 'e5');
    w.google.rememberRemoval(w.family, 'never-copied');
    w.google.asked.length = 0;

    const result = await w.pass();

    expect(w.google.askedOf('sync-collection', w.family)[0]?.token, 'not a reading with no token').toBe('');
    expect(result.deletions.map((d) => [d.naturalKeyHash, d.evidence])).toEqual([[key('e5'), 'reported']]);
    expect(await w.ledger.findBySourceRef(TENANT, MAPPING, 'calendar', w.google.hrefOf(w.family, 'never-copied'))).toBeUndefined();
    expect(result.skipped, 'the first pass on this reader reads every event once more').toBe(39);
    expect(await w.cursorOf(w.family)).toBe('sync-token:tok:family:41');
  });
});

describe('an event moved between two Google calendars (the Moves page, #1949)', () => {
  it('is a move, not a removal, on a pass with tokens', async () => {
    const w = world();
    await w.pass();
    w.google.move('e2', w.family, w.work);

    const result = await w.pass();

    expect(result.deletions, 'a move was reported as a deletion').toHaveLength(0);
    expect(result.moves.map((m) => [m.naturalKeyHash, m.from, m.to])).toEqual([[key('e2'), w.family, w.work]]);
    expect(await w.ledger.listDeletions(TENANT, MAPPING, 'calendar')).toHaveLength(0);
    expect((await w.ledger.listMoves(TENANT, MAPPING, 'calendar')).map((m) => m.naturalKeyHash)).toEqual([key('e2')]);
  });

  it('is a move, not a removal, on a pass with no tokens, which lists the 404 too', async () => {
    const w = world();
    await w.pass();
    w.google.move('e2', w.family, w.work);
    await w.cursors.set(TENANT, MAPPING, w.family, { value: '' });
    await w.cursors.set(TENANT, MAPPING, w.work, { value: '' });

    const result = await w.pass();

    expect(result.deletions).toHaveLength(0);
    expect(result.moves.map((m) => m.naturalKeyHash)).toEqual([key('e2')]);
  });
});

describe('the token is saved only once the pass has handled what it read', () => {
  it('stays where it was when a new event could not be written, and the next pass reads the same change again', async () => {
    const w = world();
    await w.pass();
    const before = await w.cursorOf(w.family);
    w.google.add(w.family, 'e41', 'Added at Google');
    w.target.failUid = 'e41';

    const failed = await w.pass();

    expect(failed.failed).toBe(1);
    expect(await w.cursorOf(w.family), 'the token moved past a change nobody wrote').toBe(before);

    w.target.failUid = undefined;
    w.google.asked.length = 0;
    const retried = await w.pass();

    expect(w.google.askedOf('sync-collection', w.family).map((a) => `sync-token:${a.token}`)).toEqual([before]);
    expect(retried.created).toBe(1);
    expect(w.target.events.get('target:Family:e41')).toContain('SUMMARY:Added at Google');
    expect(await w.cursorOf(w.family)).toBe('sync-token:tok:family:41');
  });

  it('is held while a removal waits on a calendar the pass could not read, and the next pass reports it', async () => {
    const w = world();
    await w.pass();
    const before = await w.cursorOf(w.family);
    w.google.remove(w.family, 'e7');
    w.unreadable.add(w.work);
    vi.spyOn(log, 'warn').mockImplementation(() => {});

    const stopped = await w.pass();

    // e7 may have moved into the calendar this pass could not read.
    expect(stopped.deletions).toHaveLength(0);
    expect(await w.ledger.listDeletions(TENANT, MAPPING, 'calendar')).toHaveLength(0);
    expect(await w.cursorOf(w.family), 'the token moved past a removal nobody resolved').toBe(before);

    w.unreadable.clear();
    const next = await w.pass();

    expect(next.deletions.map((d) => [d.naturalKeyHash, d.evidence])).toEqual([[key('e7'), 'reported']]);
    expect(await w.cursorOf(w.family)).toBe('sync-token:tok:family:41');
  });
});

describe('a token Google refuses, in the loop', () => {
  it('is dropped, the calendar read whole again in the same pass, and its remembered removals resolved', async () => {
    const w = world();
    await w.pass();
    w.google.refusedTokens.add('tok:family:40');
    w.google.remove(w.family, 'e8');
    vi.spyOn(log, 'warn').mockImplementation(() => {});

    const result = await w.pass();

    expect(result.deletions.map((d) => d.naturalKeyHash)).toEqual([key('e8')]);
    expect(await w.cursorOf(w.family)).toBe('sync-token:tok:family:41');
    expect(w.google.askedOf('calendar-query')).toHaveLength(0);
  });
});
