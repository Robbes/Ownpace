// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A DECISION COUNTED AS A BROKEN WORLD (found live 2026-09-11).
 *
 * A folder holding Google Docs, Forms and Maps under
 * `nativeFilePolicy="refuse"` did three things it should not have:
 *
 *   1. every refusal counted toward the consecutive-failure tripwire, so 25
 *      of them stopped the pass with "this is not an item-level problem";
 *   2. every refusal was retried on the next pass, and the next, until the
 *      failure queue read "5 tries" of a policy that answers the same way
 *      every time;
 *   3. a run that stopped for a refusal was reported as a FAILED pass, so
 *      the files that could have been copied waited on a decision about
 *      the ones that never could.
 *
 * The fix is one bit on the error (`markNeedsDecision`) and one branch in
 * the loop's catch. This pins both halves.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runDomainSync } from './domain-sync.ts';
import { MemoryLedger } from './__testing__/memory.ts';
import {
  asTenantId,
  asMappingId,
  markNeedsDecision,
  MAX_ITEM_ATTEMPTS,
  setLogLevel,
  resetLogLevel,
  type UpsertResult,
  type LedgerRecord,
} from '@openmig/shared';

const TENANT = asTenantId('7d2c0000-e29b-41d4-a716-4466554403aa');
const MAPPING = asMappingId('7d2c0000-e29b-41d4-a716-4466554403bb');

beforeEach(() => setLogLevel('error'));
afterEach(() => resetLogLevel());

interface Item {
  key: string;
  body: string;
  native?: boolean;
  broken?: boolean;
}

function pass(ledger: MemoryLedger, items: Item[]) {
  const written: string[] = [];
  let fetched = 0;
  return {
    written,
    fetchedCount: () => fetched,
    run: () =>
      runDomainSync<unknown, unknown, Item, { path: string }>({
        sourceIsAuthorityOnExistence: true,
        tenantId: TENANT,
        mappingId: MAPPING,
        domain: 'file',
        source: {},
        target: {},
        ledger,
        listFolders: async () => [{ path: 'Docs' }],
        listSince: async () => ({ items, nextCursor: { value: '1' } }),
        fetchRaw: async (i) => {
          fetched += 1;
          if (i.native) {
            throw markNeedsDecision(
              new Error(`"${i.key}" is a Google document and has no file to copy.`),
            );
          }
          if (i.broken) throw new Error('the target is down');
          return { raw: i.body, sizeBytes: i.body.length };
        },
        upsert: async (_c, raw): Promise<UpsertResult> => {
          written.push(raw as string);
          return { targetId: 't', created: true };
        },
        naturalKey: (i) => i.key,
        contentHash: (raw) => `h:${raw as string}`,
        ensureCollection: async () => 'Docs',
      }),
  };
}

/**
 * A ledger that IGNORES `recordFailure`'s `park` option.
 *
 * `park` is the THIRD, OPTIONAL argument of a port method (`Ledger` in
 * `ports.ts`), so an implementation is free not to honour it — and then
 * `attempt_count` comes back at 1 and "attempts exhausted" is false. Whether
 * an item needs a person is the LOOP's judgement about the error it just
 * caught, not a favour the ledger does it, so the loop says so on its own
 * account as well as asking the ledger to remember it.
 *
 * Without that, this branch is invisible: both in-repo ledgers honour `park`,
 * so a mutation removing the loop's own check passes every other test in this
 * file. That is how it was found — the guard was written before this fixture
 * and did not catch it.
 */
class LedgerThatIgnoresPark extends MemoryLedger {
  override recordFailure(record: LedgerRecord, error: string): Promise<LedgerRecord> {
    return super.recordFailure(record, error);
  }
}

const doc = (n: number): Item => ({ key: `doc-${n}`, body: '', native: true });

describe('a refused native file is a decision, not a failure of the world', () => {
  it('thirty refusals in a row do not stop the pass, and the real files after them are copied', async () => {
    const ledger = new MemoryLedger();
    const items: Item[] = [
      ...Array.from({ length: 30 }, (_, n) => doc(n)),
      { key: 'photo.jpg', body: 'jpeg-bytes' },
    ];
    const { run, written } = pass(ledger, items);

    const result = await run();

    expect(written).toEqual(['jpeg-bytes']);
    expect(result.failed).toBe(30);
    expect(result.needsDecision).toBe(30);
    expect(result.created).toBe(1);
  });

  it('is parked at first sight: attempt count at the ceiling, no retry on the next pass', async () => {
    const ledger = new MemoryLedger();
    const items: Item[] = [doc(1), { key: 'photo.jpg', body: 'jpeg-bytes' }];

    const first = pass(ledger, items);
    const r1 = await first.run();
    expect(r1.failures).toHaveLength(1);
    expect(r1.failures[0]?.needsDecision).toBe(true);
    expect(r1.failures[0]?.attempts).toBe(MAX_ITEM_ATTEMPTS);
    expect(r1.failures[0]?.lastError).toContain('has no file to copy');

    const second = pass(ledger, items);
    const r2 = await second.run();
    // Not fetched again: the whole point of parking is not to re-read a file
    // whose answer is a policy.
    // photo.jpg is already on the target (ledger fast-path), the doc is parked.
    expect(second.fetchedCount()).toBe(0);
    expect(r2.needsDecision).toBe(1);
    expect(r2.failures[0]?.attempts).toBe(MAX_ITEM_ATTEMPTS);
  });

  it('a genuine failure still trips the tripwire — decisions in between do not reset it either', async () => {
    const ledger = new MemoryLedger();
    // 25 broken items with a decision wedged in the middle: the decision must
    // not count toward the 25, and must not reset the count to zero.
    const items: Item[] = [
      ...Array.from({ length: 12 }, (_, n) => ({ key: `b-${n}`, body: '', broken: true })),
      doc(99),
      ...Array.from({ length: 13 }, (_, n) => ({ key: `c-${n}`, body: '', broken: true })),
    ];
    const { run } = pass(ledger, items);

    await expect(run()).rejects.toThrow(/25 items failed in a row/);
  });

  it('twenty-four genuine failures plus decisions never reach the tripwire', async () => {
    const ledger = new MemoryLedger();
    const items: Item[] = [
      ...Array.from({ length: 24 }, (_, n) => ({ key: `b-${n}`, body: '', broken: true })),
      ...Array.from({ length: 10 }, (_, n) => doc(n)),
    ];
    const { run } = pass(ledger, items);

    const result = await run();
    expect(result.failed).toBe(34);
    expect(result.needsDecision).toBe(10);
  });

  it('is parked on the loop’s own judgement, not on the ledger honouring `park`', async () => {
    // The ledger here returns `attemptCount: 1`, as an implementation that
    // ignores the optional option would. The refusal must STILL be surfaced
    // as awaiting a decision: it is the same policy, and it will answer the
    // same way on the next pass whatever the ledger counted.
    const ledger = new LedgerThatIgnoresPark();
    const { run } = pass(ledger, [doc(1)]);

    const result = await run();

    expect(result.needsDecision).toBe(1);
    expect(result.failures[0]?.needsDecision).toBe(true);
    // Reported honestly as what the ledger actually holds — the loop does not
    // invent a count to justify its own decision.
    expect(result.failures[0]?.attempts).toBe(1);
  });
});
