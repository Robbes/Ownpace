// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * One bad item must not take its domain down with it.
 *
 * The loop used to rethrow on any item error. `mapWithConcurrency` is
 * fail-fast, so that aborted the folder and therefore the whole domain pass —
 * with the cursor unpersisted, so the next pass redid the same work and
 * stopped at the same item. A single permanently unreadable file could hold a
 * migration at zero indefinitely while everything else sat ready to move, and
 * the operator's only signal was a stack trace in a container log.
 *
 * Two properties have to hold at once, and they pull against each other:
 *
 *   - a BAD ITEM is isolated: recorded, counted, reported, and stepped over;
 *   - a BAD WORLD still stops the pass, because "keep going" with an expired
 *     credential just turns one fault into 50 000 identical ledger rows.
 *
 * And isolation must not become silence (hard rule 9). Every failure lands
 * verbatim on its own ledger row, so the operator can tell a 507 from a 403.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runDomainSync, classifyKnownItem } from './domain-sync';
import { MemoryLedger } from './__testing__/memory';
import {
  asTenantId,
  asMappingId,
  MAX_ITEM_ATTEMPTS,
  isOnTarget,
  setLogLevel,
  resetLogLevel,
  type UpsertResult,
} from '@openmig/shared';

const TENANT = asTenantId('7c110000-e29b-41d4-a716-4466554402aa');
const MAPPING = asMappingId('7c110000-e29b-41d4-a716-4466554402bb');

beforeEach(() => {
  // The loop warns per failed item; these tests deliberately fail many.
  setLogLevel('error');
});
afterEach(() => {
  resetLogLevel();
});

interface Item {
  key: string;
  body: string;
}

/** A domain whose `upsert` fails for the keys in `failing`. */
function pass(
  ledger: MemoryLedger,
  items: Item[],
  failing: ReadonlySet<string>,
  reason = 'source item is unreadable',
) {
  const written: string[] = [];
  return {
    written,
    run: () =>
      runDomainSync<unknown, unknown, Item, { path: string }>({
        tenantId: TENANT,
        mappingId: MAPPING,
        domain: 'file',
        source: {},
        target: {},
        ledger,
        listFolders: async () => [{ path: 'f1' }],
        listSince: async () => ({ items, nextCursor: { value: '1' } }),
        fetchRaw: async (i) => {
          if (failing.has(i.key)) throw new Error(reason);
          return { raw: i.body, sizeBytes: i.body.length };
        },
        upsert: async (_c, raw): Promise<UpsertResult> => {
          written.push(raw as string);
          return { targetId: 't', created: true };
        },
        naturalKey: (i) => i.key,
        contentHash: (raw) => `h:${raw as string}`,
        ensureCollection: async () => 'f1',
      }),
  };
}

describe('per-item failure isolation', () => {
  it('migrates everything else when one item is unreadable', async () => {
    const ledger = new MemoryLedger();
    const items = [
      { key: 'a', body: 'A' },
      { key: 'bad', body: 'B' },
      { key: 'c', body: 'C' },
    ];

    const p = pass(ledger, items, new Set(['bad']));
    const result = await p.run();

    // The whole point. Before this, `created` was 0 or 1 and the call threw.
    expect(result.created).toBe(2);
    expect(result.failed).toBe(1);
    expect(p.written.sort()).toEqual(['A', 'C']);
  });

  it('records the failure verbatim, so the operator can act on it', async () => {
    const ledger = new MemoryLedger();
    const result = await pass(
      ledger,
      [{ key: 'bad', body: 'B' }],
      new Set(['bad']),
      'HTTP 507 Insufficient Storage',
    ).run();

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.lastError).toContain('507');
    expect(result.failures[0]!.attempts).toBe(1);
    expect(result.failures[0]!.needsDecision).toBe(false);

    // Durable, not just returned: the next pass and the /failures queue both
    // read it from here.
    const row = await ledger.find(TENANT, MAPPING, 'file', 'bad');
    expect(row?.status).toBe('failed');
    expect(row?.lastError).toContain('507');
  });

  it('retries a failed item on later passes instead of skipping it forever', async () => {
    // The other half of the old bug: a `failed` row was found by the ledger
    // fast-path and treated as "already handled", so the item was never
    // retried AND never reported. Silent loss with a green count beside it.
    const ledger = new MemoryLedger();
    const items = [{ key: 'flaky', body: 'F' }];

    const first = await pass(ledger, items, new Set(['flaky'])).run();
    expect(first.failed).toBe(1);

    // Second pass, now healthy.
    const second = pass(ledger, items, new Set());
    const r2 = await second.run();

    expect(r2.created, 'a failed item must be attempted again').toBe(1);
    expect(r2.failed).toBe(0);
    expect(second.written).toEqual(['F']);
    expect((await ledger.find(TENANT, MAPPING, 'file', 'flaky'))?.status).toBe('copied');
  });

  it('parks an item after MAX_ITEM_ATTEMPTS and stops fetching it', async () => {
    const ledger = new MemoryLedger();
    const items = [{ key: 'broken', body: 'X' }];
    let fetches = 0;

    const runOnce = () =>
      runDomainSync<unknown, unknown, Item, { path: string }>({
        tenantId: TENANT,
        mappingId: MAPPING,
        domain: 'file',
        source: {},
        target: {},
        ledger,
        listFolders: async () => [{ path: 'f1' }],
        listSince: async () => ({ items, nextCursor: { value: '1' } }),
        fetchRaw: async () => {
          fetches += 1;
          throw new Error('permanently unreadable');
        },
        upsert: async (): Promise<UpsertResult> => ({ targetId: 't', created: true }),
        naturalKey: (i) => i.key,
        contentHash: () => 'h',
        ensureCollection: async () => 'f1',
      });

    for (let i = 0; i < MAX_ITEM_ATTEMPTS; i++) await runOnce();
    expect(fetches).toBe(MAX_ITEM_ATTEMPTS);

    // One more pass: parked, so it must not be read again. Re-downloading a
    // file that has failed five times costs real bandwidth every pass.
    const parked = await runOnce();
    expect(fetches, 'a parked item must not be fetched again').toBe(MAX_ITEM_ATTEMPTS);
    expect(parked.needsDecision).toBe(1);
    expect(parked.failed).toBe(0);
    expect(parked.failures[0]!.needsDecision).toBe(true);
    expect(parked.failures[0]!.lastError).toContain('permanently unreadable');
  });

  it('stops the pass when the failures are systemic, not per-item', async () => {
    // An expired token fails every item identically. Isolating those would
    // write tens of thousands of identical ledger rows and produce a failure
    // queue no person could read.
    const ledger = new MemoryLedger();
    const items = Array.from({ length: 200 }, (_, i) => ({ key: `k${i}`, body: 'x' }));

    await expect(pass(ledger, items, new Set(items.map((i) => i.key)), '401 Unauthorized').run())
      .rejects.toThrow(/failed in a row/);
  });

  it('does not trip the systemic guard on scattered failures', async () => {
    const ledger = new MemoryLedger();
    const items = Array.from({ length: 200 }, (_, i) => ({ key: `k${i}`, body: 'x' }));
    // Every tenth item fails — 20 failures, never 25 in a row.
    const failing = new Set(items.filter((_, i) => i % 10 === 0).map((i) => i.key));

    const result = await pass(ledger, items, failing).run();

    expect(result.failed).toBe(20);
    expect(result.created).toBe(180);
  });

  it('holds the cursor back while a failure is still retryable', async () => {
    // Advancing past a retryable failure would retire it silently: the source
    // would stop listing the item, so the retry could never happen.
    const ledger = new MemoryLedger();
    const setCursor = vi.fn(async () => {});
    const cursors = { get: async () => undefined, set: setCursor, clear: async () => {} };

    await runDomainSync<unknown, unknown, Item, { path: string }>({
      tenantId: TENANT,
      mappingId: MAPPING,
      domain: 'file',
      source: {},
      target: {},
      ledger,
      cursors,
      listFolders: async () => [{ path: 'f1' }],
      listSince: async () => ({ items: [{ key: 'bad', body: 'B' }], nextCursor: { value: '9' } }),
      fetchRaw: async () => {
        throw new Error('nope');
      },
      upsert: async (): Promise<UpsertResult> => ({ targetId: 't', created: true }),
      naturalKey: (i) => i.key,
      contentHash: () => 'h',
      ensureCollection: async () => 'f1',
    });

    expect(setCursor, 'a retryable failure must keep the folder in scope').not.toHaveBeenCalled();
  });

  it('lets the cursor advance once a clean pass leaves nothing retryable', async () => {
    const ledger = new MemoryLedger();
    const setCursor = vi.fn(async () => {});
    const cursors = { get: async () => undefined, set: setCursor, clear: async () => {} };

    await runDomainSync<unknown, unknown, Item, { path: string }>({
      tenantId: TENANT,
      mappingId: MAPPING,
      domain: 'file',
      source: {},
      target: {},
      ledger,
      cursors,
      listFolders: async () => [{ path: 'f1' }],
      listSince: async () => ({ items: [{ key: 'ok', body: 'O' }], nextCursor: { value: '9' } }),
      fetchRaw: async (i) => ({ raw: i.body, sizeBytes: 1 }),
      upsert: async (): Promise<UpsertResult> => ({ targetId: 't', created: true }),
      naturalKey: (i) => i.key,
      contentHash: () => 'h',
      ensureCollection: async () => 'f1',
    });

    expect(setCursor).toHaveBeenCalledOnce();
  });
});

describe('a retry that the writer refuses', () => {
  /**
   * The E2E's real sequence, reproduced.
   *
   * Pass 1 failed the planted item correctly. Pass 2 classified it
   * `retry-failed`, re-fetched it — and the WRITER's own ledger fast-path then
   * saw the `failed` row, said "already there", and did nothing. The loop read
   * that as neither created nor adopted, counted a SKIP, and `recordUpdate`
   * wrote the row as 'updated': the failure vanished from the queue, the item
   * counted toward itemsSynced, and nothing was ever written to the target.
   *
   * Every layer here had already learned that a row is not proof of a copy —
   * the loop's `classifyKnownItem` answers the failure states first — but the
   * three writers keep their own duplicate fast-path, and that one had not.
   */
  it('does not let a writer turn a failed item into a silent success', async () => {
    const ledger = new MemoryLedger();

    // Pass 1: the write is refused.
    const first = pass(ledger, [{ key: 'k', body: 'B' }], new Set(['k']), 'target refused');
    expect((await first.run()).failed).toBe(1);

    // Pass 2: a writer that short-circuits on ANY existing row, as all three
    // did — it reports "already there" and writes nothing.
    let wrote = 0;
    const result = await runDomainSync<unknown, unknown, Item, { path: string }>({
      tenantId: TENANT,
      mappingId: MAPPING,
      domain: 'file',
      source: {},
      target: {},
      ledger,
      listFolders: async () => [{ path: 'f1' }],
      listSince: async () => ({ items: [{ key: 'k', body: 'B' }], nextCursor: { value: '1' } }),
      fetchRaw: async (i) => ({ raw: i.body, sizeBytes: 1 }),
      upsert: async (): Promise<UpsertResult> => {
        const known = await ledger.find(TENANT, MAPPING, 'file', 'k');
        // THE BUG: `if (known)`. The fix is `if (known && isOnTarget(...))`.
        if (known && isOnTarget(known.status)) return { targetId: 't', created: false };
        wrote += 1;
        return { targetId: 't', created: true };
      },
      naturalKey: (i) => i.key,
      contentHash: () => 'h',
      ensureCollection: async () => 'f1',
    });

    expect(wrote, 'the retry must actually reach the target').toBe(1);
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);

    // And the row now reflects a real copy rather than a laundered failure.
    const row = await ledger.find(TENANT, MAPPING, 'file', 'k');
    expect(row?.status).toBe('copied');
    expect(await ledger.listFailures(TENANT, MAPPING)).toHaveLength(0);
  });

  it('isOnTarget refuses exactly the two states that mean "not copied"', () => {
    expect(isOnTarget('failed')).toBe(false);
    expect(isOnTarget('left_behind')).toBe(false);
    for (const s of ['copied', 'updated', 'adopted', 'skipped', undefined] as const) {
      expect(isOnTarget(s), `${s} means the item IS on the target`).toBe(true);
    }
  });
});

describe('owner decisions', () => {
  it('retry puts a parked item back in the queue', async () => {
    const ledger = new MemoryLedger();
    await ledger.recordFailure(
      {
        tenantId: TENANT,
        mappingId: MAPPING,
        itemType: 'file',
        naturalKeyHash: 'broken',
        contentHash: '',
        targetId: '',
        createdAt: new Date().toISOString(),
      },
      'disk was full',
    );
    // Park it.
    for (let i = 1; i < MAX_ITEM_ATTEMPTS; i++) {
      await ledger.recordFailure(
        {
          tenantId: TENANT,
          mappingId: MAPPING,
          itemType: 'file',
          naturalKeyHash: 'broken',
          contentHash: '',
          targetId: '',
          createdAt: new Date().toISOString(),
        },
        'disk was full',
      );
    }
    expect((await ledger.listFailures(TENANT, MAPPING))[0]!.needsDecision).toBe(true);

    expect(await ledger.resolveFailure(TENANT, MAPPING, 'broken', 'retry')).toBe(true);

    // Eligible again, and the loop will now fetch it.
    const after = await ledger.find(TENANT, MAPPING, 'file', 'broken');
    expect(classifyKnownItem(after!, undefined)).toBe('retry-failed');

    const p = pass(ledger, [{ key: 'broken', body: 'B' }], new Set());
    const result = await p.run();
    expect(result.created).toBe(1);
  });

  it('accept leaves the item behind for good, and says so', async () => {
    const ledger = new MemoryLedger();
    await ledger.recordFailure(
      {
        tenantId: TENANT,
        mappingId: MAPPING,
        itemType: 'file',
        naturalKeyHash: 'gone',
        contentHash: '',
        targetId: '',
        createdAt: new Date().toISOString(),
      },
      'source returned 404 forever',
    );

    expect(await ledger.resolveFailure(TENANT, MAPPING, 'gone', 'accept')).toBe(true);

    const p = pass(ledger, [{ key: 'gone', body: 'G' }], new Set());
    const result = await p.run();

    // Never attempted again — and never silently either.
    expect(result.leftBehind).toBe(1);
    expect(result.created).toBe(0);
    expect(result.failed).toBe(0);
    expect(p.written).toHaveLength(0);

    // And it is out of the failure queue, because it is no longer a question.
    expect(await ledger.listFailures(TENANT, MAPPING)).toHaveLength(0);
  });

  it('refuses to resolve something that is not an open failure', async () => {
    // A stale button click on an item that has since succeeded must not
    // reopen it or report a decision that did not happen.
    const ledger = new MemoryLedger();
    expect(await ledger.resolveFailure(TENANT, MAPPING, 'never-seen', 'retry')).toBe(false);
    expect(await ledger.resolveFailure(TENANT, MAPPING, 'never-seen', 'accept')).toBe(false);
  });
});

describe('classifyKnownItem, failure states', () => {
  it('never treats an uncopied item as done', () => {
    // The failure states come FIRST, before any source-version question: for
    // these the item is not on the target at all, so "has it changed?" is the
    // wrong question.
    expect(classifyKnownItem({ status: 'failed', attemptCount: 1 }, 'etag')).toBe('retry-failed');
    expect(classifyKnownItem({ status: 'failed', attemptCount: MAX_ITEM_ATTEMPTS }, 'etag')).toBe(
      'needs-decision',
    );
    expect(classifyKnownItem({ status: 'left_behind', attemptCount: 9 }, 'etag')).toBe(
      'left-behind',
    );
  });

  it('still skips a healthy copy', () => {
    expect(classifyKnownItem({ status: 'copied', sourceVersion: 'e1' }, 'e1')).toBe('skip');
  });
});
