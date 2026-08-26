// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The stop before the lockout (workplan 0090 T4).
 *
 * Gmail's IMAP ceiling is 2 500 MB of download per day, and the reported
 * penalty for exceeding it is a ~24-hour lockout of the customer's own live
 * mailbox. So at zero remaining the pass STOPS AND SAYS SO — and everything
 * about HOW it stops is load-bearing, because the machinery around it is
 * built to retry failures and retire listed items:
 *
 *   - a pause is not a failure: no ledger row, no retry counter, no entry in
 *     the failure queue — the items were never looked at;
 *   - the paused folder keeps its cursor, so the next pass re-lists it and
 *     the ledger fast-path skips what was already copied without fetching;
 *   - nothing retries into the ceiling: the pass stops taking new work, this
 *     folder and every folder after it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runDomainSync } from './domain-sync.ts';
import { MemoryLedger } from './__testing__/memory.ts';
import {
  asTenantId,
  asMappingId,
  setLogLevel,
  resetLogLevel,
  type ByteBudgetState,
  type DownloadMeter,
  type UpsertResult,
} from '@openmig/shared';

const TENANT = asTenantId('7c110000-e29b-41d4-a716-4466554403aa');
const MAPPING = asMappingId('7c110000-e29b-41d4-a716-4466554403bb');

beforeEach(() => setLogLevel('error'));
afterEach(() => resetLogLevel());

interface Item {
  key: string;
  body: string;
}

/**
 * A meter whose remaining bytes follow a script: one entry per `state()`
 * read, and the LAST entry repeats. The semantics under test are the LOOP's,
 * so the meter itself is a stub — the real ones are pinned in @openmig/shared
 * and @openmig/ledger.
 */
function scriptedMeter(remaining: number[]): DownloadMeter & { reads: number } {
  let reads = 0;
  const stateAt = (): ByteBudgetState => {
    const left = remaining[Math.min(reads, remaining.length - 1)]!;
    reads += 1;
    return {
      spentBytes: 1000 - left,
      ceilingBytes: 1000,
      remainingBytes: left,
      windowResetsAt: new Date('2026-08-27T12:00:00.000Z'),
    };
  };
  const meter = {
    tenantId: TENANT as string,
    provider: 'gmail-imap',
    budget: {
      spend: async () => stateAt(),
      state: async () => stateAt(),
    },
    get reads() {
      return reads;
    },
  };
  return meter;
}

function pass(
  ledger: MemoryLedger,
  items: Item[],
  meter: DownloadMeter | undefined,
  folders: string[] = ['f1'],
) {
  const written: string[] = [];
  const fetched: string[] = [];
  const listed: string[] = [];
  const cursorsSet: string[] = [];
  return {
    written,
    fetched,
    listed,
    cursorsSet,
    run: () =>
      runDomainSync<unknown, unknown, Item, { path: string }>({
        tenantId: TENANT,
        mappingId: MAPPING,
        domain: 'email',
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
        // Concurrency 1 so "stops taking new work" is deterministic — the
        // production overshoot bound (`concurrency` bodies in flight) is
        // documented at the gate, not asserted here.
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
        ...(meter ? { downloadMeter: meter } : {}),
      }),
  };
}

const ITEMS: Item[] = [
  { key: 'a', body: 'A' },
  { key: 'b', body: 'B' },
  { key: 'c', body: 'C' },
];

describe('the pass-start reading', () => {
  it('a pass that begins spent lists NOTHING and reports the pause', async () => {
    const meter = scriptedMeter([0]);
    const p = pass(new MemoryLedger(), ITEMS, meter);
    const result = await p.run();

    expect(p.listed).toEqual([]);
    expect(p.fetched).toEqual([]);
    expect(result.scanned).toBe(0);
    expect(result.created).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.budgetPause).toEqual({
      provider: 'gmail-imap',
      ceilingBytes: 1000,
      spentBytes: 1000,
      windowResetsAt: '2026-08-27T12:00:00.000Z',
    });
  });
});

describe('the mid-pass gate', () => {
  it('stops at the item where the meter runs dry — copied so far, nothing failed, pause reported', async () => {
    // Reads: pass-start, item a, item b, then dry at item c.
    const meter = scriptedMeter([1000, 800, 400, 0]);
    const p = pass(new MemoryLedger(), ITEMS, meter);
    const result = await p.run();

    expect(p.written.sort()).toEqual(['A', 'B']);
    expect(p.fetched.sort()).toEqual(['a', 'b']);
    expect(result.created).toBe(2);
    // The un-fetched item is TOMORROW'S work, in no counter at all: not
    // scanned, not failed, not in the failure queue, no ledger row.
    expect(result.scanned).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.failures).toEqual([]);
    expect(result.needsDecision).toBe(0);
    expect(result.budgetPause?.provider).toBe('gmail-imap');
  });

  it('a paused folder keeps its cursor, so the next pass can re-list what was left', async () => {
    const meter = scriptedMeter([1000, 0]);
    const p = pass(new MemoryLedger(), ITEMS, meter);
    await p.run();
    expect(p.cursorsSet).toEqual([]);
  });

  it('folders after the pause are never listed — nothing retries into the ceiling', async () => {
    const meter = scriptedMeter([1000, 0]);
    const p = pass(new MemoryLedger(), ITEMS, meter, ['f1', 'f2']);
    const result = await p.run();
    expect(p.listed).toEqual(['f1']);
    expect(result.budgetPause).toBeDefined();
  });

  it('leaves no failure residue a retry could ever act on', async () => {
    const ledger = new MemoryLedger();
    const meter = scriptedMeter([1000, 0]);
    await pass(ledger, ITEMS, meter).run();
    // The pause wrote NOTHING: no failed rows for the items it left.
    for (const item of ITEMS) {
      const row = await ledger.find(TENANT, MAPPING, 'email', item.key);
      expect(row?.status).not.toBe('failed');
    }
  });
});

describe('without a meter', () => {
  it('behaves exactly as before — no reads, no pause, everything copied', async () => {
    const p = pass(new MemoryLedger(), ITEMS, undefined);
    const result = await p.run();
    expect(result.created).toBe(3);
    expect(result.budgetPause).toBeUndefined();
  });

  it('a healthy meter never pauses and reads once per item plus the opening', async () => {
    const meter = scriptedMeter([1000]);
    const p = pass(new MemoryLedger(), ITEMS, meter);
    const result = await p.run();
    expect(result.created).toBe(3);
    expect(result.budgetPause).toBeUndefined();
    expect(meter.reads).toBe(1 + ITEMS.length);
  });
});
