// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT A WINDOW CHANGES IN THE LOOP, AND WHAT IT LEAVES ALONE (workplan 0170
 * §3.2), through the real `runDomainSync` with memory stores, beside the same
 * pass without a window, which must not change:
 *
 *  1. the listing is asked for `since`, and what the window does not hold is
 *     set aside: not copied, not recorded;
 *  2. a mail window takes Inbox, then Sent, then the rest;
 *  3. phase A reads and writes no content cursor; a 90-day migration's pass
 *     keeps its own under `windowCursorKey`;
 *  4. nothing outside the window is read as deleted: no absence is counted,
 *     no move or deletion inferred, and a removal the source reports for an
 *     item the window set aside resolves to nothing;
 *  5. the result says whether the window is in (`windowComplete`).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { inboxThenSent, runDomainSync, splitByWindow } from './domain-sync.ts';
import { MemoryLedger, MemoryCursorStore } from './__testing__/memory.ts';
import {
  asTenantId,
  asMappingId,
  setLogLevel,
  resetLogLevel,
  windowCursorKey,
  type DiscardedListing,
  type ListOptions,
  type UpsertResult,
} from '@openmig/shared';

const TENANT = asTenantId('01700000-e29b-41d4-a716-4466554401c1');
const MAPPING = asMappingId('01700000-e29b-41d4-a716-4466554401c2');
const SINCE = new Date('2026-08-26T00:00:00Z');

beforeEach(() => setLogLevel('error'));
afterEach(() => resetLogLevel());

/** One source item: its key (for files, the path), its date, and its source handle. */
interface Item {
  readonly key: string;
  readonly at: string;
  readonly ref?: string;
}

type Folder = { path: string; specialUse?: string };

const recent = (key: string, ref?: string): Item => ({ key, at: '2026-11-01T00:00:00Z', ...(ref ? { ref } : {}) });
const older = (key: string, ref?: string): Item => ({ key, at: '2024-01-01T00:00:00Z', ...(ref ? { ref } : {}) });

function world(domain: 'file' | 'email' | 'calendar' = 'file', opts: { keys?: boolean } = {}) {
  const folders = new Map<string, { use?: string; items: Item[] }>();
  const ledger = new MemoryLedger();
  const cursors = new MemoryCursorStore();
  const asked: Array<{ path: string; cursor?: string; since?: string }> = [];
  const removals = new Map<string, string[]>();
  const unreadable = new Set<string>();

  const pass = (window?: { only: boolean }) =>
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
      ...(window
        ? { window: { since: SINCE, only: window.only, holds: (i: Item) => Date.parse(i.at) >= SINCE.getTime() } }
        : {}),
      listFolders: async () =>
        [...folders.entries()].map(([path, f]) => ({ path, ...(f.use ? { specialUse: f.use } : {}) })),
      listSince: async (folder, cursor, options?: ListOptions) => {
        asked.push({
          path: folder.path,
          ...(cursor ? { cursor: cursor.value } : {}),
          ...(options?.since ? { since: options.since.toISOString() } : {}),
        });
        if (unreadable.has(folder.path)) throw new Error('503 Service Unavailable');
        const removed = removals.get(folder.path);
        removals.delete(folder.path);
        // A source that ignores `since`, which the port allows: the loop decides.
        return {
          items: folders.get(folder.path)?.items ?? [],
          nextCursor: { value: `listed:${folder.path}` },
          ...(removed ? { removed } : {}),
        };
      },
      ...(domain === 'file' && opts.keys !== false
        ? { listCollectionKeys: async (folder: Folder) => (folders.get(folder.path)?.items ?? []).map((i) => i.key) }
        : {}),
      listDiscardedKeys: async (): Promise<DiscardedListing> => ({ keys: [], unnameable: 0 }),
      fetchRaw: async (i) => ({ raw: i.key, sizeBytes: i.key.length }),
      upsert: async (collectionId, raw, i, options): Promise<UpsertResult> => {
        const at = `${collectionId}:${i.key}`;
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
      ensureCollection: async (folder) => `t/${folder.path}`,
    });

  return { folders, ledger, cursors, asked, removals, unreadable, pass };
}

describe('1. the listing is asked for since, and what the window does not hold is set aside', () => {
  it('copies the last 90 days and nothing older, and records nothing of what it set aside', async () => {
    const w = world();
    w.folders.set('Docs', { items: [recent('Docs/new.txt'), older('Docs/old.txt')] });

    const r = await w.pass({ only: false });

    expect(r.created).toBe(1);
    expect(w.asked).toEqual([{ path: 'Docs', since: SINCE.toISOString() }]);
    expect(await w.ledger.find(TENANT, MAPPING, 'file', 'Docs/new.txt')).toBeDefined();
    expect(await w.ledger.find(TENANT, MAPPING, 'file', 'Docs/old.txt')).toBeUndefined();
  });

  it('without a window, asks as it always asked and copies everything', async () => {
    const w = world();
    w.folders.set('Docs', { items: [recent('Docs/new.txt'), older('Docs/old.txt')] });

    const r = await w.pass();

    expect(r.created).toBe(2);
    expect(w.asked).toEqual([{ path: 'Docs' }]);
    expect(r.windowComplete).toBeUndefined();
  });
});

describe('2. a mail window takes Inbox, then Sent, then the rest', () => {
  it('in a window pass, and keeps the source order otherwise', async () => {
    const order = async (window?: { only: boolean }) => {
      const w = world('email');
      w.folders.set('Archive', { items: [] });
      w.folders.set('Verzonden', { use: 'sent', items: [] });
      w.folders.set('Projects', { items: [] });
      w.folders.set('INBOX', { use: 'inbox', items: [] });
      await w.pass(window);
      return w.asked.map((a) => a.path);
    };
    expect(await order({ only: false })).toEqual(['INBOX', 'Verzonden', 'Archive', 'Projects']);
    expect(await order()).toEqual(['Archive', 'Verzonden', 'Projects', 'INBOX']);
  });

  it('is stable, and blind to folders with no special use', () => {
    const f = (path: string, specialUse?: string) => ({ path, ...(specialUse ? { specialUse } : {}) });
    expect(inboxThenSent([f('b'), f('s', 'sent'), f('a'), f('i', 'inbox')]).map((x) => x.path)).toEqual([
      'i',
      's',
      'b',
      'a',
    ]);
  });
});

describe('3. the cursor', () => {
  it('phase A reads none and writes none, so phase B lists in full', async () => {
    const w = world();
    w.folders.set('Docs', { items: [recent('Docs/new.txt'), older('Docs/old.txt')] });
    await w.cursors.set(TENANT, MAPPING, 'Docs', { value: 'from-before' });

    await w.pass({ only: false });

    expect(w.asked[0]).toEqual({ path: 'Docs', since: SINCE.toISOString() });
    expect(await w.cursors.get(TENANT, MAPPING, 'Docs')).toEqual({ value: 'from-before' });
    expect(await w.cursors.get(TENANT, MAPPING, windowCursorKey('Docs'))).toBeUndefined();
  });

  it('a 90-day migration keeps its own, apart from the content cursor, and reads it next time', async () => {
    const w = world();
    w.folders.set('Docs', { items: [recent('Docs/new.txt')] });

    await w.pass({ only: true });
    await w.pass({ only: true });

    expect(await w.cursors.get(TENANT, MAPPING, 'Docs')).toBeUndefined();
    expect(await w.cursors.get(TENANT, MAPPING, windowCursorKey('Docs'))).toEqual({ value: 'listed:Docs' });
    expect(w.asked[1]).toEqual({ path: 'Docs', cursor: 'listed:Docs', since: SINCE.toISOString() });
  });

  it('after it is broadened, the full pass finds no content cursor and copies the older items', async () => {
    const w = world();
    w.folders.set('Docs', { items: [recent('Docs/new.txt'), older('Docs/old.txt')] });
    await w.pass({ only: true });

    const r = await w.pass();

    expect(w.asked[1]).toEqual({ path: 'Docs' });
    expect(r.created).toBe(1);
    expect(r.skipped).toBe(1);
  });

  it('a first read the window emptied is not one that saw nothing', async () => {
    const w = world();
    w.folders.set('Old', { items: [older('Old/a.txt')] });
    await w.pass({ only: true });
    expect(await w.cursors.get(TENANT, MAPPING, windowCursorKey('Old'))).toEqual({ value: 'listed:Old' });
  });
});

describe('4. nothing outside the window is read as deleted', () => {
  it('a file older than the window is not counted absent, moved or deleted, pass after pass', async () => {
    // A source with no listing of a folder's keys (`listKeys`), so nothing but
    // the window stands between an item it did not ask for and a deletion.
    const w = world('file', { keys: false });
    w.folders.set('Docs', { items: [recent('Docs/new.txt'), older('Docs/old.txt')] });
    await w.pass();
    expect(await w.ledger.find(TENANT, MAPPING, 'file', 'Docs/old.txt')).toBeDefined();
    // The source still has both; the window lists one. Three window passes in a row.
    for (let i = 0; i < 3; i += 1) {
      const r = await w.pass({ only: true });
      expect(r.deletions, `pass ${i}`).toEqual([]);
      expect(r.moves).toEqual([]);
      expect(r.drift).toBe(0);
    }
    expect((await w.ledger.find(TENANT, MAPPING, 'file', 'Docs/old.txt'))?.absentPasses ?? 0).toBe(0);
  });

  it('the same absence WITHOUT a window is counted, so the guard above is not vacuous', async () => {
    const w = world('file', { keys: false });
    w.folders.set('Docs', { items: [recent('Docs/new.txt'), older('Docs/old.txt')] });
    await w.pass();
    w.folders.set('Docs', { items: [recent('Docs/new.txt')] });
    // Listed from the beginning, as the window pass above lists: no cursor.
    await w.cursors.clear(TENANT, MAPPING);
    const r = await w.pass();
    const absent = (await w.ledger.find(TENANT, MAPPING, 'file', 'Docs/old.txt'))?.absentPasses ?? 0;
    expect(r.drift + r.deletions.length + absent).toBeGreaterThan(0);
  });

  it('a removal reported for an item the window set aside is no deletion while the source lists it', async () => {
    const w = world('calendar');
    w.folders.set('Work', { items: [older('ev-1', '/cal/work/ev-1.ics')] });
    w.folders.set('Home', { items: [] });
    await w.pass();
    // Moved from Work to Home, still old: Work reports it removed, Home lists it.
    w.folders.set('Work', { items: [] });
    w.folders.set('Home', { items: [older('ev-1', '/cal/home/ev-1.ics')] });
    w.removals.set('Work', ['/cal/work/ev-1.ics']);

    const r = await w.pass({ only: true });

    expect(r.deletions).toEqual([]);
  });
});

describe('5. the result says whether the window is in', () => {
  it('in, when every collection was reached', async () => {
    const w = world();
    w.folders.set('Docs', { items: [recent('Docs/new.txt')] });
    expect((await w.pass({ only: false })).windowComplete).toBe(true);
  });

  it('not in, when a collection could not be listed', async () => {
    const w = world();
    w.folders.set('Docs', { items: [recent('Docs/new.txt')] });
    w.folders.set('Broken', { items: [] });
    w.unreadable.add('Broken');
    expect((await w.pass({ only: false })).windowComplete).toBe(false);
  });
});

describe('splitByWindow', () => {
  it('keeps what it holds, and adds the rest to what a marker set aside', () => {
    const split = splitByWindow([1, 2, 3, 4], [9], (n) => n % 2 === 0);
    expect(split).toEqual({ items: [2, 4], unmarked: [9, 1, 3] });
    expect(splitByWindow([2], undefined, () => true)).toEqual({ items: [2], unmarked: undefined });
  });
});
