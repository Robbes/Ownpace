// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PAUSE PRESSED DURING A PASS WAITED FOR THE PASS'S OWN DEADLINE
 * (2026-09-29).
 *
 * The owner pressed Pause on a migration while its file pass was writing large
 * files into a Nextcloud target, and the writes went on: about two thousand
 * PUTs in the hour after the press. Nothing had gone wrong in the sense of an
 * error. The managed pass re-read its migration BETWEEN data types only, on
 * the reasoning that "each domain pass already stops itself at its own
 * deadline", and inside one data type's pass the loop knew two reasons to
 * stop: the day's download budget and its own deadline, fifty minutes out. So
 * a pause pressed a minute into a file pass was honoured forty-nine minutes
 * later. The same held for a grant taken back (0108 T8 (c)), an organisation
 * closed (0085 T2) and a data type stopped by its owner (0128 T4), which the
 * between-types re-read answers too.
 *
 * Now the loop can be handed the question that re-read asks (`whyItStops`),
 * and asks it at the same gates it asks its deadline, at most once every
 * `PASS_REREAD_EVERY_MS` of its own clock. An answer that says stop is a third
 * pause, `haltPause`, with the deadline's whole contract. These cases hold it
 * to that contract at each of the five places a pause has to be respected:
 *
 *   1. whether to list collections at all;
 *   2. whether to open the next collection;
 *   3. whether to scan the next item — the one that stops a single huge
 *      folder, which is where the field case was;
 *   4. whether the collection's cursor may advance;
 *   5. whether the pass may conclude that something is gone.
 *
 * And to what makes it affordable and honest: the question is asked by the
 * pass's own clock and not per item, one at a time, never again once it said
 * stop, not at all when nobody handed it in, and a question that cannot be
 * answered fails the pass rather than reading as "go on" (hard rule 9).
 *
 * The first four gates' deadline cases are in
 * `a-pass-that-stops-halfway-keeps-its-cursor.unit.test.ts`; the fifth's in
 * `a-pass-that-did-not-look.unit.test.ts` and
 * `a-removal-the-pass-could-not-check.unit.test.ts`. What is asserted here that
 * is not asserted there is that the new reason reaches every one of them.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runDomainSync } from './domain-sync.ts';
import { runShadowPass } from './reconcile.ts';
import { MemoryLedger, MemorySource, MemoryTarget } from './__testing__/memory.ts';
import {
  asTenantId,
  asMappingId,
  log,
  setLogLevel,
  resetLogLevel,
  HALT_IN_WORDS,
  PASS_REREAD_EVERY_MS,
  type CursorStore,
  type DiscardedListing,
  type PassStopReason,
  type UpsertResult,
} from '@openmig/shared';

const TENANT = asTenantId('0e290000-e29b-41d4-a716-4466554409aa');
const MAPPING = asMappingId('0e290000-e29b-41d4-a716-4466554409bb');

beforeEach(() => setLogLevel('error'));
afterEach(() => {
  resetLogLevel();
  vi.restoreAllMocks();
});

/** Every reason a pass can be told to stop, written out so a sixth is a question. */
const EVERY_REASON: readonly PassStopReason[] = [
  'no_longer_runs',
  'grant_withdrawn',
  'organisation_closed',
  'stopped_by_its_owner',
  'data_type_no_longer_runs',
];

interface Item {
  readonly key: string;
  readonly body: string;
  readonly ref?: string;
}

type Listing = Record<string, ReadonlyArray<Item>>;

const SECOND = 1000;

/**
 * A clock the test moves by hand. `now` is what the pass reads, and it counts
 * the readings, because "the absent question costs nothing" is a claim about
 * how often it is read.
 */
function handClock(start = 0) {
  let at = start;
  let reads = 0;
  return {
    now: () => {
      reads += 1;
      return at;
    },
    advance: (ms: number) => {
      at += ms;
    },
    reads: () => reads,
  };
}

/**
 * A clock on which every question is due: each reading is twenty seconds after
 * the one before, more than any rate limit this file could be up against.
 */
function alwaysDue(): () => number {
  let at = 0;
  return () => {
    at += 20 * SECOND;
    return at;
  };
}

/**
 * A question the test can make say stop, that counts how often it was asked
 * and how many askings were in flight at once.
 */
function question(reason: PassStopReason = 'no_longer_runs', opts: { slow?: boolean } = {}) {
  let pressed = false;
  let asked = 0;
  let inFlight = 0;
  let mostInFlight = 0;
  return {
    press: () => {
      pressed = true;
    },
    asked: () => asked,
    mostInFlight: () => mostInFlight,
    whyItStops: async (): Promise<PassStopReason | null> => {
      asked += 1;
      inFlight += 1;
      mostInFlight = Math.max(mostInFlight, inFlight);
      try {
        // A real re-read is a database round trip: an answer that arrives
        // after other item bodies have had their turn.
        if (opts.slow) await new Promise((r) => setTimeout(r, 0));
        return pressed ? reason : null;
      } finally {
        inFlight -= 1;
      }
    },
  };
}

/**
 * One file migration, with a source that can change between passes and a
 * ledger that remembers across them.
 */
function world(initial: Listing, setup: { cursors?: boolean } = {}) {
  const state: { listing: Listing; removed: Record<string, string[]> } = { listing: initial, removed: {} };
  const ledger = new MemoryLedger();
  const cursorValues = new Map<string, string>();
  const cursorsSet: string[] = [];
  const cursors: CursorStore = {
    get: async (_t, _m, key) => {
      const value = cursorValues.get(key);
      return value === undefined ? undefined : { value };
    },
    set: async (_t, _m, key, cursor) => {
      cursorsSet.push(key);
      cursorValues.set(key, cursor.value);
    },
    clear: async () => {},
  };
  const seen = { fetched: [] as string[], written: [] as string[], listed: [] as string[], listFolders: 0, binReads: 0 };

  const run = (
    opts: {
      readonly whyItStops?: () => Promise<PassStopReason | null>;
      readonly now?: () => number;
      readonly deadline?: number;
      readonly concurrency?: number;
      /** Called inside each item's fetch, before the bytes come back. */
      readonly onFetch?: (item: Item) => void;
      /** Called when the loop reads this item's key, which it does after the item's gate. */
      readonly onScan?: (item: Item) => void;
      readonly bin?: () => Promise<DiscardedListing>;
    } = {},
  ) => {
    seen.fetched.length = 0;
    seen.written.length = 0;
    seen.listed.length = 0;
    seen.listFolders = 0;
    seen.binReads = 0;
    cursorsSet.length = 0;
    return runDomainSync<unknown, unknown, Item, { path: string }>({
      sourceIsAuthorityOnExistence: true,
      tenantId: TENANT,
      mappingId: MAPPING,
      domain: 'file',
      source: {},
      target: {},
      ledger,
      ...(setup.cursors ? { cursors } : {}),
      // One at a time unless a case says otherwise, so "the next item" means
      // one thing — exactly as the deadline's and the budget's cases do it.
      concurrency: opts.concurrency ?? 1,
      listFolders: async () => {
        seen.listFolders += 1;
        return Object.keys(state.listing).map((path) => ({ path }));
      },
      listSince: async (folder) => {
        seen.listed.push(folder.path);
        return {
          items: state.listing[folder.path] ?? [],
          nextCursor: { value: 'next' },
          removed: state.removed[folder.path] ?? [],
        };
      },
      fetchRaw: async (item) => {
        seen.fetched.push(item.key);
        opts.onFetch?.(item);
        return { raw: item.body, sizeBytes: item.body.length };
      },
      upsert: async (_collection, raw): Promise<UpsertResult> => {
        seen.written.push(raw as string);
        return { targetId: 't', created: true };
      },
      naturalKey: (item) => {
        opts.onScan?.(item);
        return item.key;
      },
      contentHash: (raw) => `h:${raw as string}`,
      sourceVersion: () => 'v1',
      sourceRef: (item) => item.ref,
      ensureCollection: async (folder) => folder.path,
      ...(opts.bin
        ? {
            listDiscardedKeys: async () => {
              seen.binReads += 1;
              return opts.bin!();
            },
          }
        : {}),
      ...(opts.deadline !== undefined ? { deadline: opts.deadline } : {}),
      ...(opts.now ? { now: opts.now } : {}),
      ...(opts.whyItStops ? { whyItStops: opts.whyItStops } : {}),
    });
  };
  const absences = async (key: string) => (await ledger.find(TENANT, MAPPING, 'file', key))?.absentPasses ?? 0;
  return { state, ledger, seen, cursorsSet, run, absences };
}

const THREE = (): Listing => ({
  f1: [
    { key: 'f1/a', body: 'A' },
    { key: 'f1/b', body: 'B' },
    { key: 'f1/c', body: 'C' },
  ],
});

describe('a pass nobody can tell to stop', () => {
  it('runs to the end, and reads its clock exactly once', async () => {
    // The standalone CLI's case, and every test in this repository that
    // scripts the clock gate by gate: a question that was not handed in must
    // cost nothing, not even a clock reading, or the scripted readings of
    // `a-pass-that-stops-halfway-keeps-its-cursor` would shift under it.
    const clock = handClock();
    const w = world(THREE(), { cursors: true });
    const result = await w.run({ now: clock.now });

    expect(w.seen.written.sort()).toEqual(['A', 'B', 'C']);
    expect(result.haltPause).toBeUndefined();
    expect(w.cursorsSet).toEqual(['f1']);
    // Once: the pass's start. No deadline, so no gate reads it either.
    expect(clock.reads()).toBe(1);
  });
});

describe('gate 1 — whether to list at all', () => {
  it('a pass told to stop before it began lists nothing and concludes nothing', async () => {
    // A pass the tick enqueued the minute before the owner pressed Pause, or
    // one whose credentials took their time to build: the first gate is the
    // first chance to hear it, and listing a whole Drive to act on none of it
    // would spend the source's rate budget to learn nothing.
    const w = world({ f1: [{ key: 'f1/a', body: 'A' }], f2: [{ key: 'f2/b', body: 'B' }] });
    await w.run();

    for (const n of [2, 3, 4]) {
      const q = question();
      q.press();
      const result = await w.run({ whyItStops: q.whyItStops, now: handClock().now });

      expect(w.seen.listFolders, `pass ${n}`).toBe(0);
      expect(w.seen.fetched, `pass ${n}`).toEqual([]);
      expect(result.scanned, `pass ${n}`).toBe(0);
      expect(result.failed, `pass ${n}`).toBe(0);
      expect(result.failures, `pass ${n}`).toEqual([]);
      expect(result.haltPause?.reason, `pass ${n}`).toBe('no_longer_runs');
      // A pass that listed nothing saw nothing, and concludes nothing from it.
      expect(result.drift, `pass ${n}`).toBe(0);
      expect(result.deletions, `pass ${n}`).toEqual([]);
    }
    expect(await w.absences('f1/a')).toBe(0);
    expect(await w.absences('f2/b')).toBe(0);
  });
});

describe('gate 3 — whether to scan the next item', () => {
  it('lets the item in flight finish, begins nothing new, and fails nothing', async () => {
    // THE FIELD CASE. One folder can be the whole migration, and each item in
    // it a large file on a slow target: the pause has to be heard between
    // items, not only between folders or data types.
    //
    // Each fetch takes ten seconds of the pass's clock. The owner presses
    // Pause while item b is being fetched. Item b is already under way and
    // finishes; item c is the next piece of work, and is never begun.
    const clock = handClock();
    const q = question();
    const w = world(THREE(), { cursors: true });
    const result = await w.run({
      whyItStops: q.whyItStops,
      now: clock.now,
      onFetch: (item) => {
        if (item.key === 'f1/b') q.press();
        clock.advance(10 * SECOND);
      },
    });

    expect(w.seen.written.sort()).toEqual(['A', 'B']);
    expect(w.seen.fetched.sort()).toEqual(['f1/a', 'f1/b']);
    expect(result.created).toBe(2);
    // The item not reached is the next pass's work, in no counter at all: not
    // scanned, not failed, not in the failure queue, and no ledger row.
    expect(result.scanned).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.failures).toEqual([]);
    expect(result.needsDecision).toBe(0);
    expect(await w.ledger.find(TENANT, MAPPING, 'file', 'f1/c')).toBeUndefined();
    // Its own pause, and neither of the other two: a reader must be told
    // "you paused it", not "the pass ran out of minutes".
    expect(result.haltPause?.reason).toBe('no_longer_runs');
    expect(result.deadlinePause).toBeUndefined();
    expect(result.budgetPause).toBeUndefined();
    // Stopped inside the last collection: no count at all, because absent is
    // not zero, and zero would report a data type that got through everything.
    expect(result.haltPause?.collectionsNotReached).toBeUndefined();
  });
});

describe('gate 4 — whether the cursor may advance', () => {
  it('a collection the pause stopped inside keeps its cursor, so the next pass lists it again', async () => {
    // THE ONE THAT LOSES DATA IF IT IS FORGOTTEN. An advanced cursor means "do
    // not show me these items again", and the pass the pause promises — the
    // one after Resume — would never list item c.
    const clock = handClock();
    const q = question();
    const w = world(THREE(), { cursors: true });
    await w.run({
      whyItStops: q.whyItStops,
      now: clock.now,
      onFetch: (item) => {
        if (item.key === 'f1/b') q.press();
        clock.advance(10 * SECOND);
      },
    });

    expect(w.cursorsSet).toEqual([]);
  });
});

describe('gate 2 — whether to open the next collection', () => {
  it('opens no collection after the pause, counts the ones it never reached, and advances the finished one', async () => {
    // Pressed while f1's last item is scanned. f1 is finished and its cursor
    // moves; f2 and f3 are not opened.
    const q = question();
    const w = world(
      { f1: [{ key: 'f1/a', body: 'A' }], f2: [{ key: 'f2/b', body: 'B' }], f3: [{ key: 'f3/c', body: 'C' }] },
      { cursors: true },
    );
    const result = await w.run({
      whyItStops: q.whyItStops,
      now: alwaysDue(),
      onScan: (item) => {
        if (item.key === 'f1/a') q.press();
      },
    });

    expect(w.seen.listed).toEqual(['f1']);
    expect(w.cursorsSet).toEqual(['f1']);
    expect(result.haltPause?.collectionsNotReached).toBe(2);
  });
});

describe('gate 5 — whether the pass may conclude that something is gone', () => {
  it('counts nothing absent in a collection the pause kept it from', async () => {
    const w = world({ f1: [{ key: 'f1/a', body: 'A' }], f2: [{ key: 'f2/b', body: 'B' }, { key: 'f2/c', body: 'C' }] });
    await w.run();

    for (const n of [2, 3, 4]) {
      const q = question();
      const stopped = await w.run({
        whyItStops: q.whyItStops,
        now: alwaysDue(),
        onScan: (item) => {
          if (item.key === 'f1/a') q.press();
        },
      });
      expect(stopped.haltPause, `pass ${n} stopped`).toBeDefined();
      expect(w.seen.listed, `pass ${n}`).toEqual(['f1']);
      expect(stopped.drift, `pass ${n}`).toBe(0);
      expect(stopped.deletions, `pass ${n}`).toEqual([]);
    }
    expect(await w.absences('f2/b')).toBe(0);
    expect(await w.absences('f2/c')).toBe(0);
  });

  it("resolves no removal and reads no bin before it has looked everywhere, and keeps the reporting collection's cursor", async () => {
    // A removal reported by f1 may be an item moved into f2, which this pass
    // never opened. Resolved anyway it would read as a deletion the source
    // reported: the one kind a person may apply, which removes the only copy.
    const w = world(
      { f1: [{ key: 'f1/x', body: 'X', ref: 'href-x' }], f2: [{ key: 'f2/b', body: 'B' }] },
      { cursors: true },
    );
    const emptyBin = async (): Promise<DiscardedListing> => ({ keys: [], unnameable: 0 });
    await w.run({ bin: emptyBin });

    // x is removed from f1 at the source, and the server says so.
    w.state.listing = { f1: [], f2: [{ key: 'f2/b', body: 'B' }] };
    w.state.removed = { f1: ['href-x'] };
    // Pressed once f1 has been read and before f2's gate. f1 has no items
    // left, so its listing is the last thing that happens inside it, and the
    // next question the pass asks is at f2's gate.
    const q = question();
    let asksAfterF1 = 0;
    const result = await w.run({
      bin: emptyBin,
      now: alwaysDue(),
      whyItStops: async () => {
        if (w.seen.listed.includes('f1')) {
          asksAfterF1 += 1;
          q.press();
        }
        return q.whyItStops();
      },
    });

    expect(asksAfterF1).toBe(1);
    expect(w.seen.listed).toEqual(['f1']);
    expect(result.haltPause).toBeDefined();
    expect(result.deletions).toEqual([]);
    expect(result.drift).toBe(0);
    expect(w.seen.binReads).toBe(0);
    // f1 reported a removal, and a removal is handed out once: its cursor waits.
    expect(w.cursorsSet).toEqual([]);
    expect((await w.ledger.find(TENANT, MAPPING, 'file', 'f1/x'))?.deletionReportedAt).toBeUndefined();
  });
});

describe('the question is cheap', () => {
  it("is asked by the pass's own clock, not once per item", async () => {
    // Sixty items, one second each, and nothing ever says stop. A question per
    // item would be sixty database round trips beside the pass's own ledger
    // traffic; by the clock it is one at the start and one per interval.
    const clock = handClock();
    const q = question();
    const items = Array.from({ length: 60 }, (_, i) => ({ key: `f1/${i}`, body: `B${i}` }));
    const w = world({ f1: items });
    const result = await w.run({
      whyItStops: q.whyItStops,
      now: clock.now,
      onFetch: () => clock.advance(1 * SECOND),
    });

    expect(result.created).toBe(60);
    expect(result.haltPause).toBeUndefined();
    expect(q.asked()).toBeGreaterThanOrEqual(2);
    expect(q.asked()).toBeLessThanOrEqual(1 + Math.ceil((60 * SECOND) / PASS_REREAD_EVERY_MS));
  });

  it('is asked exactly once while the clock does not move', async () => {
    const q = question();
    const items = Array.from({ length: 60 }, (_, i) => ({ key: `f1/${i}`, body: `B${i}` }));
    const w = world({ f1: items, f2: [{ key: 'f2/a', body: 'A' }] });
    await w.run({ whyItStops: q.whyItStops, now: () => 0 });

    expect(q.asked()).toBe(1);
  });

  it('is asked one at a time, however many items are in flight', async () => {
    // Four item bodies reach their gate together. Four questions for one
    // answer would be the per-item cost again, four at a time.
    const q = question('no_longer_runs', { slow: true });
    const items = Array.from({ length: 12 }, (_, i) => ({ key: `f1/${i}`, body: `B${i}` }));
    const w = world({ f1: items });
    const result = await w.run({ whyItStops: q.whyItStops, now: alwaysDue(), concurrency: 4 });

    expect(result.created).toBe(12);
    expect(q.asked()).toBeGreaterThanOrEqual(2);
    expect(q.mostInFlight()).toBe(1);
  });
});

describe('each reason is its own sentence, and none of them is a failure', () => {
  for (const reason of EVERY_REASON) {
    it(`${reason}`, async () => {
      const said = vi.spyOn(log, 'info').mockImplementation(() => {});
      const warned = vi.spyOn(log, 'warn').mockImplementation(() => {});
      const failed = vi.spyOn(log, 'error').mockImplementation(() => {});
      const q = question(reason);
      q.press();
      const result = await world(THREE()).run({ whyItStops: q.whyItStops, now: handClock().now });

      expect(result.haltPause?.reason).toBe(reason);
      expect(result.failed).toBe(0);
      const lines = said.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('told to stop'));
      expect(lines).toHaveLength(1);
      const line = lines[0]!;
      expect(line).toContain(HALT_IN_WORDS[reason]);
      expect(line).toContain('not an error');
      // Told apart from the other two stops, which have sentences of their own.
      expect(line).not.toMatch(/deadline/i);
      expect(line).not.toMatch(/download budget/i);
      expect(warned).not.toHaveBeenCalled();
      expect(failed).not.toHaveBeenCalled();
    });
  }

  it('says each reason in words of its own', () => {
    const words = EVERY_REASON.map((r) => HALT_IN_WORDS[r]);
    expect(new Set(words).size).toBe(EVERY_REASON.length);
  });
});

describe('the stop is heard once, and the deadline first', () => {
  it('is never asked again once it said stop, and no later deadline is added to it', async () => {
    // Twenty seconds per fetch, a deadline at fifty, and the clock thrown an
    // hour forward the moment the pause is heard: f2's gate then comes long
    // after the deadline, and must neither ask again nor add a second reason.
    const clock = handClock();
    const q = question();
    const w = world({ ...THREE(), f2: [{ key: 'f2/d', body: 'D' }] });
    const result = await w.run({
      whyItStops: async () => {
        const answer = await q.whyItStops();
        if (answer) clock.advance(60 * 60 * SECOND);
        return answer;
      },
      now: clock.now,
      deadline: 50 * SECOND,
      onFetch: (item) => {
        if (item.key === 'f1/b') q.press();
        clock.advance(20 * SECOND);
      },
    });

    // Asked at the start (no), at item b (no), at item c (yes): three, and
    // none after.
    expect(q.asked()).toBe(3);
    expect(result.haltPause?.reason).toBe('no_longer_runs');
    expect(result.deadlinePause).toBeUndefined();
    expect(w.seen.listed).toEqual(['f1']);
    expect(result.haltPause?.collectionsNotReached).toBe(1);
  });

  it('reports the deadline when both land at the same gate', async () => {
    // Asked first because it is synchronous and free. The next data type's
    // re-read then reports the pause, which is still true then.
    const clock = handClock();
    const q = question();
    q.press();
    const result = await world(THREE()).run({ whyItStops: q.whyItStops, now: clock.now, deadline: 0 });

    expect(result.deadlinePause).toBeDefined();
    expect(result.haltPause).toBeUndefined();
    expect(q.asked()).toBe(0);
  });
});

describe('a question that cannot be answered', () => {
  it('fails the pass rather than reading as "go on" (hard rule 9)', async () => {
    const refused = new Error('the migration could not be read');
    const w = world(THREE());
    await expect(
      w.run({
        now: handClock().now,
        whyItStops: async () => {
          throw refused;
        },
      }),
    ).rejects.toBe(refused);
    expect(w.seen.fetched).toEqual([]);
  });

  it('fails it from inside a collection too', async () => {
    const refused = new Error('the migration could not be read');
    let asks = 0;
    const w = world(THREE());
    await expect(
      w.run({
        now: alwaysDue(),
        whyItStops: async () => {
          asks += 1;
          if (asks > 2) throw refused;
          return null;
        },
      }),
    ).rejects.toBe(refused);
    expect(asks).toBe(3);
  });
});

describe('the mail pass carries the stop out', () => {
  it('returns haltPause from runShadowPass and copies nothing after it', async () => {
    // Mail reshapes the loop's result by hand (`reconcile.ts`), and a field
    // left out of that literal is a stop its dispatcher reads as a finish.
    const source = new MemorySource();
    for (const id of ['a', 'b', 'c']) {
      source.add({ folderPath: 'INBOX', messageId: `<${id}@x>`, rfc822: `Subject: ${id}\r\n\r\n${id}` });
    }
    const target = new MemoryTarget();
    const result = await runShadowPass({
      sourceIsAuthorityOnExistence: true,
      tenantId: TENANT,
      mappingId: MAPPING,
      source,
      target,
      ledger: new MemoryLedger(),
      concurrency: 1,
      now: alwaysDue(),
      whyItStops: async () => (target.size() >= 1 ? 'grant_withdrawn' : null),
    });

    expect(target.size()).toBe(1);
    expect(result.created).toBe(1);
    expect(result.haltPause?.reason).toBe('grant_withdrawn');
  });
});
