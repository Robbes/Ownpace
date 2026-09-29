// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * COPIED ITEMS, ASKED ABOUT A WINDOW AT A TIME (2026-09-29).
 *
 * The pass asked the ledger about every listed item with a `find` of its own,
 * and on a managed stack each `find` is a transaction. A source with no change
 * feed lists everything it holds on every pass, so the owner's Dropbox spent
 * about 11 ms per file already copied before reaching a new one: 3.8 minutes
 * of a pass at 13,000 files, growing with every file copied, and the same
 * again on every pass after the first copy.
 *
 * What these hold, through the real `runDomainSync` with memory stores:
 *
 *  1. items already copied, unchanged and where they were, are skipped on the
 *     word of their window: one read per `LEDGER_READ_AHEAD` items, and no
 *     `find` of their own;
 *  2. every other item is still asked about on its own, and acted on as
 *     before: a new item is copied, a changed one rewritten, a moved one
 *     recorded as moved, and one the ledger had counted absent is cleared;
 *  3. when the window says anything but a quiet skip, the fresh row decides;
 *  4. a window that cannot be read, or a ledger that cannot read windows,
 *     leaves every item to its own `find`, as before;
 *  5. `ledgerReadAhead` reads each window once, in order, and gives an item
 *     from a window already left no hint rather than a second read.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  runDomainSync,
  ledgerReadAhead,
  quietSkip,
  LEDGER_READ_AHEAD,
} from './domain-sync.ts';
import { MemoryLedger } from './__testing__/memory.ts';
import {
  asTenantId,
  asMappingId,
  setLogLevel,
  resetLogLevel,
  type Ledger,
  type LedgerRecord,
  type UpsertResult,
} from '@openmig/shared';

const TENANT = asTenantId('0a1e0000-e29b-41d4-a716-4466554405b1');
const MAPPING = asMappingId('0a1e0000-e29b-41d4-a716-4466554405b2');

beforeEach(() => setLogLevel('error'));
afterEach(() => resetLogLevel());

interface Item {
  key: string;
  body: string;
  version: string;
}

type Folder = { path: string };

const WORK = { path: 'Work' };
const PHOTOS = { path: 'Photos' };

const files = (n: number, folder = 'Work', version = 'v1'): Item[] =>
  Array.from({ length: n }, (_, i) => ({ key: `${folder}/file-${i}.txt`, body: `body ${i}`, version }));

/** One migration's passes over a source whose holdings the test sets per pass. */
function world(ledger: Ledger = new MemoryLedger()) {
  const written: string[] = [];

  function pass(holdings: ReadonlyArray<readonly [Folder, ReadonlyArray<Item>]>) {
    const byPath = new Map(holdings.map(([f, items]) => [f.path, items]));
    return runDomainSync<unknown, unknown, Item, Folder>({
      sourceIsAuthorityOnExistence: true,
      tenantId: TENANT,
      mappingId: MAPPING,
      domain: 'file',
      source: {},
      target: {},
      ledger,
      concurrency: 4,
      listFolders: async () => holdings.map(([f]) => f),
      listSince: async (folder) => ({ items: byPath.get(folder.path) ?? [], nextCursor: { value: 'listed' } }),
      fetchRaw: async (i) => ({ raw: i.body, sizeBytes: i.body.length }),
      upsert: async (collectionId, _raw, item): Promise<UpsertResult> => {
        written.push(item.key);
        return { targetId: `${collectionId}/${item.key}`, created: true };
      },
      naturalKey: (i) => i.key,
      sourceVersion: (i) => i.version,
      contentHash: (raw) => `h:${raw as string}`,
      ensureCollection: async (folder) => `target:${folder.path}`,
    });
  }

  return { ledger, pass, written };
}

describe('items already copied, unchanged and where they were', () => {
  it('are skipped on the word of their window, one read per window and no find of their own', async () => {
    const ledger = new MemoryLedger();
    const w = world(ledger);
    const many = files(LEDGER_READ_AHEAD * 2 + 200);
    await w.pass([[WORK, many]]);
    w.written.length = 0;
    const before = { ...ledger.reads };

    const again = await w.pass([[WORK, many]]);

    expect(again.skipped).toBe(many.length);
    expect(w.written).toEqual([]);
    expect(ledger.reads.find - before.find).toBe(0);
    expect(ledger.reads.findMany - before.findMany).toBe(3);
    expect(ledger.reads.keysAskedInBatches - before.keysAskedInBatches).toBe(many.length);
  });
});

describe('every other item is asked about on its own, and acted on as before', () => {
  it('a new item among copied ones is copied', async () => {
    const ledger = new MemoryLedger();
    const w = world(ledger);
    const copied = files(40);
    await w.pass([[WORK, copied]]);
    w.written.length = 0;
    const findsBefore = ledger.reads.find;

    const fresh = { key: 'Work/new.txt', body: 'new', version: 'v1' };
    const r = await w.pass([[WORK, [...copied.slice(0, 20), fresh, ...copied.slice(20)]]]);

    expect(w.written).toEqual(['Work/new.txt']);
    expect(r.created).toBe(1);
    expect(r.skipped).toBe(40);
    expect(ledger.reads.find - findsBefore).toBeGreaterThanOrEqual(1);
  });

  it('a changed item is rewritten', async () => {
    const w = world();
    await w.pass([[WORK, files(10)]]);
    w.written.length = 0;

    const edited = files(10).map((f, i) => (i === 7 ? { ...f, body: 'edited', version: 'v2' } : f));
    const r = await w.pass([[WORK, edited]]);

    expect(w.written).toEqual(['Work/file-7.txt']);
    expect(r.updated).toBe(1);
    expect(r.skipped).toBe(9);
  });

  it('an item listed in another folder is recorded as moved, and nothing is written', async () => {
    const ledger = new MemoryLedger();
    const w = world(ledger);
    const item = { key: 'shared-key', body: 'b', version: 'v1' };
    await w.pass([
      [WORK, [item]],
      [PHOTOS, []],
    ]);
    w.written.length = 0;

    const r = await w.pass([
      [WORK, []],
      [PHOTOS, [item]],
    ]);

    // By the row, not by `r.moved`: the pass reports this one move twice, once
    // from the listing and once from the end-of-pass reconciliation, with or
    // without the read-ahead.
    expect((await ledger.find(TENANT, MAPPING, 'file', 'shared-key'))?.movedToCollection).toBe('Photos');
    expect(r.moves.map((m) => `${m.from}>${m.to}`)).toContain('Work>Photos');
    expect(w.written).toEqual([]);
  });

  it('an item the ledger had counted absent is cleared when it is listed again', async () => {
    const ledger = new MemoryLedger();
    const w = world(ledger);
    const two = files(2);
    await w.pass([[WORK, two]]);
    await w.pass([[WORK, two.slice(0, 1)]]);
    const counted = await ledger.find(TENANT, MAPPING, 'file', 'Work/file-1.txt');
    expect(counted?.absentPasses).toBe(1);

    await w.pass([[WORK, two]]);

    const cleared = await ledger.find(TENANT, MAPPING, 'file', 'Work/file-1.txt');
    expect(cleared?.absentPasses).toBe(0);
  });
});

describe('when the window says anything but a quiet skip, the fresh row decides', () => {
  it('a row read failed in the window, copied when asked again, is skipped and not written again', async () => {
    const ledger = new MemoryLedger();
    const w = world(ledger);
    await w.pass([[WORK, files(3)]]);
    w.written.length = 0;
    // The window answers with an older word about file 1: failed.
    const stale = ledger.findMany.bind(ledger);
    ledger.findMany = async (...args) => {
      const rows = new Map(await stale(...args));
      const row = rows.get('Work/file-1.txt');
      if (row) rows.set('Work/file-1.txt', { ...row, status: 'failed', attemptCount: 1 });
      return rows;
    };

    const r = await w.pass([[WORK, files(3)]]);

    expect(w.written).toEqual([]);
    expect(r.skipped).toBe(3);
  });
});

describe('a window that cannot be read, or a ledger that cannot read windows', () => {
  it('a window read that fails leaves each item to its own find, and the pass completes', async () => {
    const ledger = new MemoryLedger();
    const w = world(ledger);
    await w.pass([[WORK, files(12)]]);
    ledger.findMany = () => Promise.reject(new Error('the ledger is unavailable'));
    const findsBefore = ledger.reads.find;

    const r = await w.pass([[WORK, files(12)]]);

    expect(r.skipped).toBe(12);
    expect(ledger.reads.find - findsBefore).toBe(12);
  });

  it('a ledger without findMany is asked one item at a time, as before', async () => {
    const memory = new MemoryLedger();
    const oneAtATime: Ledger = new Proxy(memory, {
      get: (target, prop, receiver) =>
        prop === 'findMany' ? undefined : Reflect.get(target, prop, receiver),
    });
    const w = world(oneAtATime);
    await w.pass([[WORK, files(12)]]);
    const findsBefore = memory.reads.find;

    const r = await w.pass([[WORK, files(12)]]);

    expect(r.skipped).toBe(12);
    expect(memory.reads.find - findsBefore).toBe(12);
    expect(memory.reads.findMany).toBe(0);
  });
});

describe('ledgerReadAhead', () => {
  const row = (key: string): LedgerRecord => ({
    tenantId: TENANT,
    mappingId: MAPPING,
    itemType: 'file',
    naturalKeyHash: key,
    contentHash: 'h',
    targetId: 't',
    createdAt: '2026-09-29T00:00:00.000Z',
  });

  function reader(keys: ReadonlyArray<string | undefined>, size: number) {
    const asked: string[][] = [];
    const ahead = ledgerReadAhead(
      keys,
      (k) => k,
      async (window) => {
        asked.push([...window]);
        return new Map(window.map((k) => [k, row(k)]));
      },
      size,
    );
    return { ahead, asked };
  }

  it('reads each window once, when its first item is asked about, and leaves out keyless items', async () => {
    const { ahead, asked } = reader(['a', 'b', undefined, 'd', 'e'], 2);

    expect((await ahead.get(0, 'a'))?.naturalKeyHash).toBe('a');
    expect((await ahead.get(1, 'b'))?.naturalKeyHash).toBe('b');
    expect(asked).toEqual([['a', 'b']]);
    expect(await ahead.get(3, 'd')).toMatchObject({ naturalKeyHash: 'd' });
    expect(asked).toEqual([['a', 'b'], ['d']]);
    expect(await ahead.get(4, 'e')).toMatchObject({ naturalKeyHash: 'e' });
    expect(asked).toEqual([['a', 'b'], ['d'], ['e']]);
  });

  it('gives an item from a window already left no hint, rather than reading it again', async () => {
    const { ahead, asked } = reader(['a', 'b', 'c', 'd'], 2);
    await ahead.get(2, 'c');

    expect(await ahead.get(1, 'b')).toBeUndefined();
    expect(asked).toEqual([['c', 'd']]);
  });

  it('answers nothing for a key the window holds no row for', async () => {
    const ahead = ledgerReadAhead(['a', 'b'], (k) => k, async () => new Map(), 2);

    expect(await ahead.get(0, 'a')).toBeUndefined();
  });
});

describe('quietSkip', () => {
  const copied: LedgerRecord = {
    tenantId: TENANT,
    mappingId: MAPPING,
    itemType: 'file',
    naturalKeyHash: 'k',
    contentHash: 'h',
    targetId: 't',
    createdAt: '2026-09-29T00:00:00.000Z',
    status: 'copied',
    sourceVersion: 'v1',
    collection: 'Work',
    absentPasses: 0,
  };

  it('is a copied row, unchanged and where it was, with nothing waiting to be written down', () => {
    expect(quietSkip(copied, 'v1', 'Work')).toBe(true);
  });

  it.each<[string, Partial<LedgerRecord>, string, string]>([
    ['counted absent', { absentPasses: 1 }, 'v1', 'Work'],
    ['reported deleted', { deletionReportedAt: '2026-09-28T00:00:00.000Z' }, 'v1', 'Work'],
    ['trashed at the source', { deletionTrashedAt: '2026-09-28T00:00:00.000Z' }, 'v1', 'Work'],
    ['a move recorded', { movedToCollection: 'Photos' }, 'v1', 'Work'],
    ['changed at the source', {}, 'v2', 'Work'],
    ['listed in another folder', {}, 'v1', 'Photos'],
    ['failed', { status: 'failed', attemptCount: 1 }, 'v1', 'Work'],
  ])('is not a row %s', (_what, over, version, collection) => {
    expect(quietSkip({ ...copied, ...over }, version, collection)).toBe(false);
  });
});
