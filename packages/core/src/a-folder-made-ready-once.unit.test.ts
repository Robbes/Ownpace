// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FOLDER MADE READY ONCE (2026-09-29).
 *
 * `runDomainSync` made every collection ready on the target before listing
 * it, on every pass. On a WebDAV target that lists the collection's parent
 * directory there, so a pass that found nothing new still asked the target
 * about every folder it had. The owner's Microsoft migration spent 14 of a
 * pass's 16 minutes doing that, and wrote nothing.
 *
 * What these hold, through the real `runDomainSync` with memory stores:
 *
 *  1. a collection with no cursor, new or never read through, is made ready
 *     before its listing, as before, empty ones included, so an empty source
 *     folder is still made on the target the first time a pass sees it;
 *  2. a collection with a cursor is not made ready by a pass that writes
 *     nothing into it, whether the source answers with no items or with the
 *     same ones again;
 *  3. it is made ready once, when its first item is written, however many are
 *     written at the same time;
 *  4. a refusal to make it ready fails that collection's items, each recorded,
 *     and the pass goes on with the others.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runDomainSync } from './domain-sync.ts';
import { MemoryLedger, MemoryCursorStore } from './__testing__/memory.ts';
import { asTenantId, asMappingId, setLogLevel, resetLogLevel, type UpsertResult } from '@openmig/shared';

const TENANT = asTenantId('7e550000-e29b-41d4-a716-4466554405a1');
const MAPPING = asMappingId('7e550000-e29b-41d4-a716-4466554405a2');

beforeEach(() => setLogLevel('error'));
afterEach(() => resetLogLevel());

interface Item {
  key: string;
  body: string;
}

type Folder = { path: string };

/** A source and a target the passes share, and what the target was asked. */
function world() {
  const ledger = new MemoryLedger();
  const cursors = new MemoryCursorStore();
  /** Every `ensureCollection`, by folder path, in order. */
  const madeReady: string[] = [];
  /** Every write, as `<collection>/<key>`. */
  const written: string[] = [];
  let refuse: string | undefined;

  function pass(folders: Folder[], holds: (folder: Folder) => Item[]) {
    return runDomainSync<unknown, unknown, Item, Folder>({
      sourceIsAuthorityOnExistence: true,
      tenantId: TENANT,
      mappingId: MAPPING,
      domain: 'file',
      source: {},
      target: {},
      ledger,
      cursors,
      concurrency: 4,
      listFolders: async () => folders,
      listSince: async (folder) => ({ items: holds(folder), nextCursor: { value: `listed:${folder.path}` } }),
      fetchRaw: async (i) => ({ raw: i.body, sizeBytes: i.body.length }),
      upsert: async (collectionId, _raw, item): Promise<UpsertResult> => {
        written.push(`${collectionId}/${item.key}`);
        return { targetId: `${collectionId}/${item.key}`, created: true };
      },
      naturalKey: (i) => i.key,
      contentHash: (raw) => `h:${raw as string}`,
      ensureCollection: async (folder) => {
        madeReady.push(folder.path);
        // A moment's wait, so items written at once really do overlap.
        await new Promise((r) => setTimeout(r, 5));
        if (refuse === folder.path) throw new Error(`the target refused to make ${folder.path}`);
        return `target:${folder.path}`;
      },
    });
  }

  return {
    pass,
    madeReady,
    written,
    refuseToMake: (path: string) => {
      refuse = path;
    },
  };
}

const A = { path: 'Work' };
const B = { path: 'Photos' };
const EMPTY = { path: 'Empty' };

const firstHoldings = (folder: Folder): Item[] =>
  folder.path === 'Work'
    ? [{ key: 'Work/plan.txt', body: 'plan' }]
    : folder.path === 'Photos'
      ? [{ key: 'Photos/one.jpg', body: 'one' }]
      : [];

describe('a collection the pass has no cursor for', () => {
  it('is made ready before its listing, an empty one too', async () => {
    const w = world();

    await w.pass([A, B, EMPTY], firstHoldings);

    expect(w.madeReady).toEqual(['Work', 'Photos', 'Empty']);
    expect(w.written.sort()).toEqual(['target:Photos/Photos/one.jpg', 'target:Work/Work/plan.txt']);
  });
});

describe('a collection an earlier pass made ready', () => {
  it('is not made ready again by a pass that finds nothing new in it', async () => {
    const w = world();
    await w.pass([A, B, EMPTY], firstHoldings);
    w.madeReady.length = 0;

    const second = await w.pass([A, B, EMPTY], () => []);

    // The empty folder kept no cursor (a first read that saw nothing claims
    // nothing), so it is asked again. The two that were read through are not.
    expect(w.madeReady).toEqual(['Empty']);
    expect(second.metrics?.collectionsOpened).toBe(3);
  });

  it('nor by one that lists the same items again, all of them already copied', async () => {
    const w = world();
    await w.pass([A, B], firstHoldings);
    w.madeReady.length = 0;

    const again = await w.pass([A, B], firstHoldings);

    expect(w.madeReady).toEqual([]);
    expect(again.created).toBe(0);
  });

  it('is made ready when an item in it is written, and only that one', async () => {
    const w = world();
    await w.pass([A, B], firstHoldings);
    w.madeReady.length = 0;
    w.written.length = 0;

    await w.pass([A, B], (folder) =>
      folder.path === 'Photos' ? [{ key: 'Photos/two.jpg', body: 'two' }] : [],
    );

    expect(w.madeReady).toEqual(['Photos']);
    expect(w.written).toEqual(['target:Photos/Photos/two.jpg']);
  });

  it('once, however many of its items are written at the same time', async () => {
    const w = world();
    await w.pass([A], firstHoldings);
    w.madeReady.length = 0;

    const many = Array.from({ length: 6 }, (_, n) => ({ key: `Work/new-${n}.txt`, body: `new ${n}` }));
    const r = await w.pass([A], () => many);

    expect(w.madeReady).toEqual(['Work']);
    expect(r.created).toBe(6);
  });

  it("fails its own items when the target refuses, and the pass goes on with the others", async () => {
    const w = world();
    await w.pass([A, B], firstHoldings);
    w.refuseToMake('Work');
    w.written.length = 0;

    const r = await w.pass([A, B], (folder) =>
      folder.path === 'Work'
        ? [{ key: 'Work/a.txt', body: 'a' }, { key: 'Work/b.txt', body: 'b' }]
        : [{ key: 'Photos/three.jpg', body: 'three' }],
    );

    expect(r.failed).toBe(2);
    expect(r.created).toBe(1);
    expect(w.written).toEqual(['target:Photos/Photos/three.jpg']);
  });
});
