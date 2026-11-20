// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT A TEST MIGRATION'S MARKER CHANGES IN THE LOOP, AND WHAT IT LEAVES ALONE
 * (workplan 0162 §4; the owner's decisions of 2026-11-20, §2).
 *
 * A test migration's source lists only the items whose own title carries its
 * marker (`MarkedOnly`, packages/orchestration), says how many it set aside
 * (`unmarked`), and says that it does (`markedOnly`). The loop has to meet it
 * in three places, and this holds each, through the real `runDomainSync` with
 * memory stores, beside the same pass without a marker, which must not change:
 *
 *  1. a first read the marker emptied stores its cursor, where a first read
 *     that saw nothing still stores none (`firstReadSawNothing`);
 *  2. a collection is made on the target at its first marked item, and one
 *     holding none is never made; without a marker, every collection is made
 *     the first time a pass sees it, as before;
 *  3. a file that leaves the marked set (renamed out of the marker) is neither
 *     drift nor, passes later, an inferred deletion (§2 (f)), while a rename
 *     between two marked names is still reported as a move, and a deletion the
 *     source states (its bin, its removal report) still reaches the queue.
 *
 * The listing here plays the wrapper's part by hand, so what is under test is
 * the loop's side of the contract; the wrapper's own side, through the real
 * domain passes, is `a-test-migration-copies-only-what-is-marked` in
 * orchestration.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runDomainSync } from './domain-sync.ts';
import { MemoryLedger, MemoryCursorStore } from './__testing__/memory.ts';
import {
  asTenantId,
  asMappingId,
  setLogLevel,
  resetLogLevel,
  DELETION_CONFIRMATIONS,
  type DiscardedListing,
  type UpsertResult,
} from '@openmig/shared';

const TENANT = asTenantId('01620000-e29b-41d4-a716-4466554401c1');
const MAPPING = asMappingId('01620000-e29b-41d4-a716-4466554401c2');

beforeEach(() => setLogLevel('error'));
afterEach(() => resetLogLevel());

/** One source item: its key (for files, the path), its bytes, and whether its title is marked. */
interface Item {
  readonly key: string;
  readonly body: string;
  readonly marked: boolean;
  /** The source's own handle, which a removal report names. */
  readonly ref?: string;
}

type Folder = { path: string };

/**
 * A source whose folders a test rearranges between passes, a target that
 * records its own rows (as the real writers do), and the choice of whether
 * this migration is a test's. With a marker the listing does what `MarkedOnly`
 * does: keeps the marked items, counts the rest as `unmarked`, and says
 * `markedOnly`. `listCollectionKeys` answers every key a folder holds, marked
 * or not, as a wrapped file source's unfiltered `listKeys` does.
 */
function world(opts: { marker: boolean; domain?: 'file' | 'calendar' }) {
  const domain = opts.domain ?? 'file';
  const folders = new Map<string, Item[]>();
  const target = new Map<string, string>();
  const madeReady: string[] = [];
  const ledger = new MemoryLedger();
  const cursors = new MemoryCursorStore();
  /** Keys the source's bin holds, and refs its next listing reports removed. */
  const bin: string[] = [];
  const removals = new Map<string, string[]>();

  const pass = () =>
    runDomainSync<unknown, unknown, Item, Folder>({
      sourceIsAuthorityOnExistence: true,
      stillTheAuthority: async () => true,
      tenantId: TENANT,
      mappingId: MAPPING,
      domain,
      source: {},
      target: {},
      ledger,
      cursors,
      ...(opts.marker ? { markedOnly: true } : {}),
      listFolders: async () => [...folders.keys()].map((path) => ({ path })),
      listSince: async (folder) => {
        const all = folders.get(folder.path) ?? [];
        const items = opts.marker ? all.filter((i) => i.marked) : all;
        const removed = removals.get(folder.path);
        removals.delete(folder.path);
        return {
          items,
          nextCursor: { value: `listed:${folder.path}` },
          ...(removed ? { removed } : {}),
          ...(all.length > items.length ? { unmarked: all.length - items.length } : {}),
        };
      },
      listCollectionKeys: async (folder) => (folders.get(folder.path) ?? []).map((i) => i.key),
      listDiscardedKeys: async (): Promise<DiscardedListing> => ({ keys: [...bin], unnameable: 0 }),
      fetchRaw: async (i) => ({ raw: i.body, sizeBytes: i.body.length }),
      upsert: async (collectionId, raw, i, options): Promise<UpsertResult> => {
        const at = `${collectionId}:${i.key}`;
        target.set(at, raw as string);
        await ledger.recordIfAbsent({
          tenantId: TENANT,
          mappingId: MAPPING,
          itemType: domain,
          naturalKeyHash: i.key,
          contentHash: `h:${raw as string}`,
          targetId: at,
          createdAt: new Date().toISOString(),
          sizeBytes: (raw as string).length,
          status: 'copied',
          ...(options?.collection !== undefined ? { collection: options.collection } : {}),
          ...(options?.sourceRef !== undefined ? { sourceRef: options.sourceRef } : {}),
        });
        return { targetId: at, created: true };
      },
      naturalKey: (i) => i.key,
      sourceRef: (i) => i.ref,
      contentHash: (raw) => `h:${raw as string}`,
      ensureCollection: async (folder) => {
        madeReady.push(folder.path);
        return `t/${folder.path}`;
      },
    });

  return { folders, target, madeReady, ledger, cursors, bin, removals, pass };
}

const marked = (key: string, body = key, ref?: string): Item => ({ key, body, marked: true, ...(ref ? { ref } : {}) });
const plain = (key: string, body = key): Item => ({ key, body, marked: false });

describe('1. a first read the marker emptied stores its cursor', () => {
  it('stores it, so the collection is not listed whole again on every pass', async () => {
    const w = world({ marker: true });
    w.folders.set('Holiday', [plain('Holiday/a.jpg'), plain('Holiday/b.jpg')]);

    const r = await w.pass();

    expect(r.created).toBe(0);
    expect(await w.cursors.get(TENANT, MAPPING, 'Holiday')).toEqual({ value: 'listed:Holiday' });
  });

  it('still stores none for a first read that saw nothing at all, with a marker or without', async () => {
    for (const marker of [true, false]) {
      const w = world({ marker });
      w.folders.set('Empty', []);
      await w.pass();
      expect(await w.cursors.get(TENANT, MAPPING, 'Empty'), `marker: ${marker}`).toBeUndefined();
    }
  });
});

describe('2. a collection is made at its first marked item', () => {
  it('with a marker, only the collections that hold one are made, and only when it is written', async () => {
    const w = world({ marker: true });
    w.folders.set('Test', [marked('Test/[Ownpace-test] plan.pdf')]);
    w.folders.set('Private', [plain('Private/taxes.pdf')]);
    w.folders.set('Empty', []);

    const r = await w.pass();

    expect(r.created).toBe(1);
    expect(w.madeReady).toEqual(['Test']);
    expect([...w.target.keys()]).toEqual(['t/Test:Test/[Ownpace-test] plan.pdf']);
  });

  it('a collection whose first marked item comes later is made then, and not before', async () => {
    const w = world({ marker: true });
    w.folders.set('Later', [plain('Later/old.txt')]);
    await w.pass();
    expect(w.madeReady).toEqual([]);

    w.folders.set('Later', [plain('Later/old.txt'), marked('Later/[Ownpace-test] new.txt')]);
    const r = await w.pass();

    expect(r.created).toBe(1);
    expect(w.madeReady).toEqual(['Later']);
  });

  it('without a marker, every collection is made the first time a pass sees it, as before', async () => {
    const w = world({ marker: false });
    w.folders.set('Test', [marked('Test/[Ownpace-test] plan.pdf')]);
    w.folders.set('Private', [plain('Private/taxes.pdf')]);
    w.folders.set('Empty', []);

    const r = await w.pass();

    expect(r.created).toBe(2);
    expect(w.madeReady).toEqual(['Test', 'Private', 'Empty']);
  });
});

describe('3. a file that leaves the marked set', () => {
  it('renamed out of the marker, is neither drift nor ever an inferred deletion, and its copy stays', async () => {
    const w = world({ marker: true });
    w.folders.set('Docs', [marked('Docs/[Ownpace-test] report.pdf', 'R')]);
    expect((await w.pass()).created).toBe(1);

    // The owner takes the marker out of its name: same bytes, a new path.
    w.folders.set('Docs', [plain('Docs/report.pdf', 'R')]);

    for (let n = 0; n <= DELETION_CONFIRMATIONS + 1; n += 1) {
      const r = await w.pass();
      expect(r.created, `pass ${n}`).toBe(0);
      expect(r.drift, `pass ${n}`).toBe(0);
      expect(r.deletions, `pass ${n}`).toEqual([]);
      expect(r.moves, `pass ${n}`).toEqual([]);
    }
    const row = await w.ledger.find(TENANT, MAPPING, 'file', 'Docs/[Ownpace-test] report.pdf');
    expect(row?.absentPasses ?? 0).toBe(0);
    expect(row?.status).toBe('copied');
    expect([...w.target.keys()]).toEqual(['t/Docs:Docs/[Ownpace-test] report.pdf']);
  });

  it('the same absence without a marker is drift, and an inferred deletion after two passes', async () => {
    // The contrast that makes the case above mean something: this is what the
    // loop does with an absence, and what a marked listing must not reach.
    const w = world({ marker: false });
    w.folders.set('Docs', [marked('Docs/[Ownpace-test] report.pdf', 'R')]);
    await w.pass();
    w.folders.set('Docs', []);

    let last;
    for (let n = 0; n < DELETION_CONFIRMATIONS; n += 1) last = await w.pass();
    expect(last!.drift).toBe(1);
    expect(last!.deletions.map((d) => [d.naturalKeyHash, d.evidence])).toEqual([
      ['Docs/[Ownpace-test] report.pdf', 'inferred'],
    ]);
  });

  it('renamed between two marked names, is still reported as a move', async () => {
    const w = world({ marker: true });
    w.folders.set('Docs', [marked('Docs/[Ownpace-test] a.pdf', 'SAME')]);
    await w.pass();

    w.folders.set('Docs', [marked('Docs/[Ownpace-test] b.pdf', 'SAME')]);
    const r = await w.pass();

    expect(r.created).toBe(1);
    expect(r.moves).toEqual([
      {
        domain: 'file',
        naturalKeyHash: 'Docs/[Ownpace-test] a.pdf',
        from: 'Docs',
        to: 'Docs',
        toNaturalKeyHash: 'Docs/[Ownpace-test] b.pdf',
      },
    ]);
  });

  it('deleted into the bin, still reaches the queue on that evidence', async () => {
    const w = world({ marker: true });
    w.folders.set('Docs', [marked('Docs/[Ownpace-test] gone.pdf')]);
    await w.pass();

    w.folders.set('Docs', []);
    w.bin.push('Docs/[Ownpace-test] gone.pdf');
    const r = await w.pass();

    expect(r.deletions.map((d) => [d.naturalKeyHash, d.evidence])).toEqual([
      ['Docs/[Ownpace-test] gone.pdf', 'trashed'],
    ]);
  });

  it('a removal the source reports reaches the queue for a marked copy, and names nothing for one never copied', async () => {
    const w = world({ marker: true, domain: 'calendar' });
    w.folders.set('Cal', [marked('uid-marked', 'M', '/cal/marked.ics'), plain('uid-plain', 'P')]);
    await w.pass();

    // Both are deleted at the source, and its report names both hrefs: the
    // listing passes removals through unfiltered, and the loop skips the one
    // it never copied.
    w.folders.set('Cal', []);
    w.removals.set('Cal', ['/cal/marked.ics', '/cal/plain.ics']);
    const r = await w.pass();

    expect(r.deletions.map((d) => [d.naturalKeyHash, d.evidence])).toEqual([['uid-marked', 'reported']]);
    expect(await w.ledger.find(TENANT, MAPPING, 'calendar', 'uid-plain')).toBeUndefined();
  });
});
