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
  type LedgerRecord,
  type RawCalendarEvent,
  type UpsertOptions,
  type UpsertResult,
} from '@openmig/shared';
import { CalDAVSource } from '../../connectors/src/caldav-source.ts';
import type { HttpClient, HttpRequestOptions } from '../../connectors/src/dav-http.types.ts';
import { FAKE_CALDAV_URL, FAKE_HOME, GoogleLikeCalDav } from '../../connectors/src/__testing__/google-like-caldav.ts';
import { runCalendarSync } from './dav-sync.ts';
import { aRemovalCanBeReported } from './domain-sync.ts';
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
  /** A calendar whose next sync-collection answers 500, once. */
  const failsOnce = new Set<string>();
  const client: HttpClient = {
    request: (options: HttpRequestOptions) => {
      const path = new URL(options.url).pathname;
      if (unreadable.has(path)) return Promise.resolve({ status: 500, headers: {}, body: 'backend error' });
      if (failsOnce.has(path) && String(options.body).includes('sync-collection')) {
        failsOnce.delete(path);
        return Promise.resolve({ status: 500, headers: {}, body: 'backend error' });
      }
      return google.client.request(options);
    },
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
  return { google, family, work, unreadable, failsOnce, target, ledger, cursors, pass, cursorOf };
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

/**
 * THE MOVE, AND THE CALENDAR IT LEFT READ WITH NO TOKEN (review of #2019,
 * the blocker). The event moved from Family to Work, and a pass with both
 * tokens recorded the move. Later Family is read with no token while Work
 * keeps its own: Google's answer for Family names the old href as a removal
 * it remembers, and Work's names only what changed after its token, so the
 * event is seen nowhere. Reported, it was a removal a person may apply, and
 * applying it removed the only copy of a live event.
 */
describe('a recorded move, when the calendar it left is read with no token', () => {
  async function moved() {
    const w = world();
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    await w.pass();
    w.google.move('e2', w.family, w.work);
    const recorded = await w.pass();
    expect(recorded.moves.map((m) => m.naturalKeyHash)).toEqual([key('e2')]);
    return w;
  }

  it('is not a removal when Google refuses that calendar\'s token and it is read again with none', async () => {
    const w = await moved();
    w.google.refusedTokens.add((await w.cursorOf(w.family))!.replace(/^sync-token:/, ''));

    const later = await w.pass();

    expect(later.deletions, 'a recorded move was reported as a deletion').toHaveLength(0);
    expect(await w.ledger.listDeletions(TENANT, MAPPING, 'calendar')).toHaveLength(0);
    expect((await w.ledger.listMoves(TENANT, MAPPING, 'calendar')).map((m) => m.naturalKeyHash)).toEqual([key('e2')]);
  });

  it('is not a removal when that calendar holds no token and the other keeps its own', async () => {
    const w = await moved();
    await w.cursors.set(TENANT, MAPPING, w.family, { value: '' });

    const later = await w.pass();

    expect(w.google.askedOf('sync-collection', w.work).at(-1)?.token, 'Work was read with no token too').not.toBe('');
    expect(later.deletions, 'a recorded move was reported as a deletion').toHaveLength(0);
  });

  it('is not read with no token at all after a 500: the token it was sent is kept', async () => {
    const w = await moved();
    const before = await w.cursorOf(w.family);
    w.failsOnce.add(w.family);

    const during = await w.pass();
    w.google.asked.length = 0;
    const after = await w.pass();

    expect(during.deletions).toHaveLength(0);
    expect(await w.cursorOf(w.family), 'a 500 dropped the token').toBe(before);
    expect(w.google.askedOf('sync-collection', w.family).map((a) => `sync-token:${a.token}`)).toEqual([before]);
    expect(after.deletions).toHaveLength(0);
  });
});

describe('the one rule for a removal that can become a deletion (review of #2019)', () => {
  const row = (over: Partial<LedgerRecord>): LedgerRecord => ({
    tenantId: TENANT,
    mappingId: MAPPING,
    itemType: 'calendar',
    naturalKeyHash: key('e1'),
    contentHash: 'h',
    targetId: 't',
    createdAt: '2026-11-21T00:00:00.000Z',
    status: 'copied',
    ...over,
  });

  it('takes a copy on the target, and nothing else', () => {
    expect(aRemovalCanBeReported(undefined)).toBe(false);
    expect(aRemovalCanBeReported(row({}))).toBe(true);
    expect(aRemovalCanBeReported(row({ status: 'failed' }))).toBe(false);
  });

  it('refuses an item whose move under the same key is on record', () => {
    expect(aRemovalCanBeReported(row({ collection: '/a/', movedToCollection: '/b/' }))).toBe(false);
  });

  it('takes a file moved by path, whose old row and new row share the source\'s id: that removal is a removal', () => {
    expect(
      aRemovalCanBeReported(
        row({ itemType: 'file', collection: '/a/', movedToCollection: '/b/', movedToNaturalKeyHash: 'k-new' }),
      ),
      'a removal reported by a moved file\'s id was refused',
    ).toBe(true);
  });
});

describe('a cursor held for removals that cannot become deletions (review of #2019)', () => {
  it('is not held: beside a calendar that stays unreadable, the other goes on from its token', async () => {
    const w = world();
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    // Google remembers a removal from before this migration; nothing was copied from it.
    w.google.rememberRemoval(w.family, 'never-copied');
    w.unreadable.add(w.work);

    await w.pass();
    w.google.asked.length = 0;
    const second = await w.pass();

    expect(await w.cursorOf(w.family), 'held for a removal that could come to nothing').toBe('sync-token:tok:family:40');
    expect(w.google.askedOf('sync-collection', w.family).map((a) => a.token)).toEqual(['tok:family:40']);
    expect(w.google.askedOf('calendar-multiget', w.family), 'the calendar was read whole again').toHaveLength(0);
    expect(second.skipped).toBe(0);
  });
});

describe('a multiget that answers 404 for events that are there, in the loop (review of #2019)', () => {
  it('copies every one of them, from the whole listing', async () => {
    const w = world();
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    w.google.onMultiget = (_index, hrefs) =>
      hrefs[0]?.includes('family')
        ? {
            status: 207,
            headers: {},
            body:
              '<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">' +
              hrefs.map((h) => `<D:response><D:href>${h}</D:href><D:status>HTTP/1.1 404 Not Found</D:status></D:response>`).join('') +
              '</D:multistatus>',
          }
        : undefined;

    const result = await w.pass();

    expect(result.created, 'events that are there were taken as gone, and never copied').toBe(45);
    expect(await w.cursorOf(w.family)).toBe('sync-token:tok:family:40');
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
