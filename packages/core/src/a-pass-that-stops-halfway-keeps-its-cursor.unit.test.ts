// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PASS THAT STOPS HALFWAY MUST NOT RETIRE THE WORK IT DID NOT DO
 * (2026-09-08).
 *
 * A managed pass runs under a runner that kills it at `maxDuration`. A 100 GB
 * first copy does not fit in that hour, and being killed is not merely slow:
 * the task dies mid-item, the run row never closes, and `managed-sync-tick`
 * skips a mapping that still has a `running` row — so the mapping stops
 * syncing altogether, silently and for good.
 *
 * So the pass carries its own earlier deadline and stops CLEANLY at it. That
 * is not a new mechanism: the day's byte ceiling (workplan 0090 T4) already
 * stops a pass this way, and everything about HOW it stops is load-bearing
 * around machinery built to retry failures and retire listed items.
 *
 * FOUR sites have to respect a pause, and the fourth is the one that loses
 * data if it is forgotten:
 *
 *   1. whether to list collections at all;
 *   2. whether to open the next collection;
 *   3. whether to scan the next item;
 *   4. **whether the collection's cursor may advance.**
 *
 * An advanced cursor means "do not show me these items again". Advance it
 * past a pause and the next pass — the one the pause promises — never lists
 * the work, which is a silent partial migration reported as a success.
 *
 * These cases drive the DEADLINE through all four. The byte ceiling's own
 * cases are in `budget-pause.unit.test.ts`; what is asserted here that is not
 * asserted there is that both reasons reach the same four gates, because they
 * do it through one predicate rather than by naming themselves at each site.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runDomainSync } from './domain-sync.ts';
import { MemoryLedger } from './__testing__/memory.ts';
import {
  asTenantId,
  asMappingId,
  setLogLevel,
  resetLogLevel,
  PASS_SOFT_DEADLINE_MS,
  PASS_HARD_LIMIT_MS,
  passDeadlineFrom,
  type UpsertResult,
} from '@openmig/shared';

const TENANT = asTenantId('dead1e00-e29b-41d4-a716-4466554403aa');
const MAPPING = asMappingId('dead1e00-e29b-41d4-a716-4466554403bb');

beforeEach(() => setLogLevel('error'));
afterEach(() => resetLogLevel());

interface Item {
  key: string;
  body: string;
}

/**
 * A clock whose readings follow a script, the LAST one repeating — the same
 * shape `budget-pause.unit.test.ts` gives its meter, and for the same reason:
 * what is under test is which GATE stops the loop, so the test has to be able
 * to say exactly that rather than infer it from arithmetic.
 *
 * The loop reads the clock once when the pass starts and once at each gate it
 * reaches, in this order:
 *
 *   1. the pass's own start
 *   2. before listing collections at all
 *   3. once per collection, before opening it
 *   4. once per item in that collection, before scanning it
 *
 * so a script of `[0, 0, 0, 0, 0, 99]` with a deadline of 1 stops at the
 * SIXTH reading — the third item of the first collection. Written out as
 * numbers rather than a step size because a step size means the reader has to
 * recompute the gate order in their head, and the first draft of this file
 * got it wrong doing exactly that.
 */
function scriptedClock(readings: number[]): () => number {
  let i = 0;
  return () => {
    const at = readings[Math.min(i, readings.length - 1)]!;
    i += 1;
    return at;
  };
}

/** Before the deadline; any number of readings may sit at it. */
const EARLY = 0;
/** At or past the deadline: the reading that stops the pass. */
const LATE = 999;
/** Every scripted clock in this file is read against this deadline. */
const DEADLINE = 500;

function pass(
  ledger: MemoryLedger,
  items: Item[],
  opts: { deadline?: number; now?: () => number; folders?: string[] } = {},
) {
  const written: string[] = [];
  const fetched: string[] = [];
  const listed: string[] = [];
  const cursorsSet: string[] = [];
  const folders = opts.folders ?? ['f1'];
  return {
    written,
    fetched,
    listed,
    cursorsSet,
    run: () =>
      runDomainSync<unknown, unknown, Item, { path: string }>({
        sourceIsAuthorityOnExistence: true,
        tenantId: TENANT,
        mappingId: MAPPING,
        domain: 'file',
        source: {},
        target: {},
        ledger,
        cursors: {
          get: async () => undefined,
          set: async (_t, _m, key) => {
            cursorsSet.push(key);
          },
          clear: async () => {},
        },
        // Concurrency 1 so "stops taking new work" is deterministic, exactly
        // as the byte-ceiling cases do it.
        concurrency: 1,
        listFolders: async () => folders.map((path) => ({ path })),
        listSince: async (folder) => {
          listed.push(folder.path);
          return { items, nextCursor: { value: '1' } };
        },
        fetchRaw: async (i) => {
          fetched.push(i.key);
          return { raw: i.body, sizeBytes: i.body.length };
        },
        upsert: async (_c, raw): Promise<UpsertResult> => {
          written.push(raw as string);
          return { targetId: 't', created: true };
        },
        naturalKey: (i) => i.key,
        contentHash: (raw) => `h:${raw as string}`,
        ensureCollection: async (f) => f.path,
        ...(opts.deadline !== undefined ? { deadline: opts.deadline } : {}),
        ...(opts.now ? { now: opts.now } : {}),
      }),
  };
}

const ITEMS: Item[] = [
  { key: 'a', body: 'A' },
  { key: 'b', body: 'B' },
  { key: 'c', body: 'C' },
];

describe('a pass with no deadline', () => {
  it('runs to the end, exactly as it always did', async () => {
    const p = pass(new MemoryLedger(), ITEMS);
    const result = await p.run();

    expect(p.written.sort()).toEqual(['A', 'B', 'C']);
    expect(result.created).toBe(3);
    expect(result.deadlinePause).toBeUndefined();
    // …and the cursor advances, because nothing was left behind.
    expect(p.cursorsSet).toEqual(['f1']);
  });
});

describe('gate 1 — whether to list at all', () => {
  it('a pass whose deadline has already gone lists NOTHING', async () => {
    // Not hypothetical: a run that waited in the queue longer than its own
    // budget arrives exactly like this. Listing a mailbox it cannot act on
    // would spend the source's rate budget to learn nothing.
    const p = pass(new MemoryLedger(), ITEMS, { deadline: DEADLINE, now: () => LATE });
    const result = await p.run();

    expect(p.listed).toEqual([]);
    expect(p.fetched).toEqual([]);
    expect(result.scanned).toBe(0);
    expect(result.created).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.deadlinePause?.deadlineAt).toBe(new Date(DEADLINE).toISOString());
  });
});

describe('gate 3 — whether to scan the next item', () => {
  it('stops mid-collection, keeps what it copied, and fails nothing', async () => {
    // One collection can BE the migration — a hundred thousand messages, or a
    // file store holding a hundred gigabytes. A pass that could only stop
    // between collections would run until its runner killed it.
    //
    // start, pre-list, f1's gate, item a, item b — then the deadline lands on
    // item c.
    const now = scriptedClock([EARLY, EARLY, EARLY, EARLY, EARLY, LATE]);
    const p = pass(new MemoryLedger(), ITEMS, { deadline: DEADLINE, now });
    const result = await p.run();

    expect(p.written.sort()).toEqual(['A', 'B']);
    expect(p.fetched.sort()).toEqual(['a', 'b']);
    expect(result.created).toBe(2);
    // The un-fetched item is the NEXT pass's work, in no counter at all: not
    // scanned, not failed, not in the failure queue, no ledger row.
    expect(result.scanned).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.failures).toEqual([]);
    expect(result.needsDecision).toBe(0);
    expect(result.deadlinePause).toBeDefined();
  });
});

describe('gate 4 — whether the cursor may advance', () => {
  it('a paused collection keeps its cursor, so the next pass lists it again', async () => {
    // THE ONE THAT LOSES DATA IF IT IS FORGOTTEN. An advanced cursor means
    // "do not show me these items again"; advancing it past a pause retires
    // work nobody did, and the pass that the pause promises would never see
    // it.
    const now = scriptedClock([EARLY, EARLY, EARLY, EARLY, EARLY, LATE]);
    const p = pass(new MemoryLedger(), ITEMS, { deadline: DEADLINE, now });
    await p.run();

    expect(p.cursorsSet).toEqual([]);
  });

  it('advances the cursor of a collection it DID finish', async () => {
    // The other half, and it has to hold or the deadline would turn every
    // pass into a full re-list: a collection completed before the deadline
    // arrived is finished, and its cursor moves.
    // start, pre-list, f1's gate, its three items — then the deadline lands on
    // f2's gate, after f1 has finished.
    const now = scriptedClock([EARLY, EARLY, EARLY, EARLY, EARLY, EARLY, LATE]);
    const p = pass(new MemoryLedger(), ITEMS, { deadline: DEADLINE, now, folders: ['f1', 'f2'] });
    const result = await p.run();

    expect(p.cursorsSet).toEqual(['f1']);
    expect(p.listed).toEqual(['f1']);
    expect(result.created).toBe(3);
    expect(result.deadlinePause).toBeDefined();
  });
});

describe('gate 2 — whether to open the next collection', () => {
  it('counts the collections it never reached, and never calls that zero', async () => {
    // start, pre-list, f1's gate (it is empty, so no item gates) — then the
    // deadline lands on f2's, leaving f2 and f3 unreached.
    const now = scriptedClock([EARLY, EARLY, EARLY, LATE]);
    const p = pass(new MemoryLedger(), [], { deadline: DEADLINE, now, folders: ['f1', 'f2', 'f3'] });
    const result = await p.run();

    // f1 is listed (empty, so no item gates), then the deadline stops f2 and
    // f3 at the collection gate.
    expect(p.listed).toEqual(['f1']);
    expect(result.deadlinePause?.collectionsNotReached).toBe(2);
  });

  it('reports no count at all when it stopped inside the last collection', async () => {
    // Absent is not zero. Zero would say "every collection was reached",
    // which is true of a finished pass and not of this one — and the reader
    // has no other way to tell them apart.
    const now = scriptedClock([EARLY, EARLY, EARLY, EARLY, EARLY, LATE]);
    const p = pass(new MemoryLedger(), ITEMS, { deadline: DEADLINE, now });
    const result = await p.run();

    expect(result.deadlinePause).toBeDefined();
    expect(result.deadlinePause?.collectionsNotReached).toBeUndefined();
  });
});

describe('the budget itself', () => {
  it('leaves the runner room to finish the item in flight and close its books', () => {
    // The margin is not decoration. When the deadline lands, the item already
    // in flight still finishes, then the cursor decision, the ledger writes,
    // the domain status row and the run row all have to land — and the runner
    // has to tear down. A soft deadline at or above the hard kill would mean
    // the pass never stops itself at all, which is the defect this exists to
    // remove rather than a smaller version of it.
    expect(PASS_SOFT_DEADLINE_MS).toBeLessThan(PASS_HARD_LIMIT_MS);
    expect(PASS_HARD_LIMIT_MS - PASS_SOFT_DEADLINE_MS).toBeGreaterThanOrEqual(5 * 60 * 1000);
  });

  it('measures from when the pass started, not from a wall clock', () => {
    // A deadline anchored to the hour would give a pass that started at :49
    // one minute. It is a budget, and it starts when the pass does.
    expect(passDeadlineFrom(1_000_000)).toBe(1_000_000 + PASS_SOFT_DEADLINE_MS);
    expect(passDeadlineFrom(0, 1234)).toBe(1234);
  });
});
