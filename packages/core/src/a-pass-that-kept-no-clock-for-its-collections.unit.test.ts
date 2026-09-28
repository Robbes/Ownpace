// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PASS THAT KEPT NO CLOCK FOR ITS COLLECTIONS (2026-09-28).
 *
 * The owner's Dropbox pass ran its full 50 minutes and copied 222 files, all
 * of them in its last ten. Nothing recorded where the first forty went. The
 * pass measured the work it does per ITEM (fetch, write, ledger, hash), and
 * the work it does per COLLECTION had no clock: listing the source's
 * collections, making each one ready on the target (on WebDAV the first also
 * walks everything the target holds), and listing each one's items. The
 * managed runner then dropped even the per-item numbers.
 *
 * These drive the real `runDomainSync` with phases of known length, timed on
 * the instrument's own clock, and hold:
 *
 *  1. each collection phase lands in its own measurement, and nowhere else;
 *  2. the time to the first write is measured from the pass's start;
 *  3. a pass that wrote nothing has no first write, rather than a zero, and
 *     an item the target already held is not a write.
 */

import { describe, it, expect } from 'vitest';
import { asTenantId, asMappingId, type Ledger, type PassMetrics } from '@openmig/shared';
import { runDomainSync } from './domain-sync.ts';

const TENANT = asTenantId('9a150000-e29b-41d4-a716-446655449901' as never);
const MAPPING = asMappingId('9a150000-e29b-41d4-a716-446655449902' as never);

const emptyLedger = {
  find: async () => undefined,
  recordIfAbsent: async () => undefined,
  // A refused write is recorded as a failure, on its first attempt.
  recordFailure: async () => ({ attemptCount: 1 }),
  placedItems: async () => [],
} as unknown as Ledger;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What each phase actually took, measured by the stubs on the instrument's clock. */
interface Spent {
  list: number;
  setup: number;
  listing: number;
}

/** A stub that sleeps `ms` and adds what it really took to `spent[key]`. */
function takes<T>(spent: Spent, key: keyof Spent, ms: number, value: () => T): () => Promise<T> {
  return async () => {
    const t0 = performance.now();
    await sleep(ms);
    spent[key] += performance.now() - t0;
    return value();
  };
}

/**
 * Three collections, opened one after another. Only the last holds an item,
 * so the first write comes after every collection phase has been spent.
 */
async function aPass(upsert: () => Promise<Record<string, unknown>>): Promise<{ metrics: PassMetrics; spent: Spent }> {
  const spent: Spent = { list: 0, setup: 0, listing: 0 };
  const folders = [{ path: 'a' }, { path: 'b' }, { path: 'c' }];
  const result = await runDomainSync({
    tenantId: TENANT,
    mappingId: MAPPING,
    domain: 'file',
    source: {},
    target: {},
    ledger: emptyLedger,
    listFolders: takes(spent, 'list', 40, () => folders),
    ensureCollection: (folder: { path: string }) => takes(spent, 'setup', 25, () => `coll-${folder.path}`)(),
    listSince: (folder: { path: string }) =>
      takes(spent, 'listing', 15, () => ({
        items: folder.path === 'c' ? [{ id: 'c/1' }] : [],
        nextCursor: { value: `cursor-${folder.path}` },
      }))(),
    listCollectionKeys: (folder: { path: string }) =>
      takes(spent, 'listing', 5, () => (folder.path === 'c' ? ['c/1'] : []))(),
    fetchRaw: async () => ({ raw: {}, sizeBytes: 1 }),
    upsert,
    naturalKey: (i: unknown) => (i as { id: string }).id,
    contentHash: () => 'h',
  } as never);
  expect(result.metrics, 'the pass returned no measurements').toBeDefined();
  return { metrics: result.metrics!, spent };
}

/** The instrument's figure and the stubs' own agree: never less, and not far more. */
function agrees(measured: number | undefined, actual: number, what: string) {
  expect(measured, `${what} was not measured`).toBeDefined();
  expect(measured!, `${what}: measured ${measured}ms, spent ${actual.toFixed(1)}ms`).toBeGreaterThanOrEqual(actual - 1);
  expect(measured!, `${what}: measured ${measured}ms, spent ${actual.toFixed(1)}ms`).toBeLessThan(actual + 25);
}

describe('the collections, each where it was spent', () => {
  it('times the collection list, the target set-up and the listings apart', async () => {
    const { metrics, spent } = await aPass(async () => ({ targetId: 't', created: true }));
    agrees(metrics.listCollectionsMs, spent.list, 'listing the collections');
    agrees(metrics.collectionSetupMs, spent.setup, 'making the collections ready on the target');
    agrees(metrics.collectionListingMs, spent.listing, "listing each collection's items");
    expect(metrics.collectionsOpened).toBe(3);
  });

  it('measures the first write from the start of the pass', async () => {
    const { metrics, spent } = await aPass(async () => ({ targetId: 't', created: true }));
    // Every collection phase came before it: the only item is in the last one.
    const before = spent.list + spent.setup + spent.listing;
    expect(metrics.firstWriteAfterMs, 'the first write was not measured').toBeDefined();
    expect(metrics.firstWriteAfterMs!).toBeGreaterThanOrEqual(before - 1);
    expect(metrics.firstWriteAfterMs!).toBeLessThanOrEqual(metrics.wallMs);
  });
});

describe('a pass that wrote nothing', () => {
  it('has no first write, rather than a zero', async () => {
    const { metrics } = await aPass(async () => {
      throw new Error('the target refused it');
    });
    expect(metrics).not.toHaveProperty('firstWriteAfterMs');
  });

  it('does not count an item the target already held as a write', async () => {
    const { metrics } = await aPass(async () => ({ targetId: 't', created: false, adopted: true }));
    expect(metrics).not.toHaveProperty('firstWriteAfterMs');
  });
});
