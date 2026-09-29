// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FOLDER THAT WILL NOT LIST IS SKIPPED, NOT THE PASS (2026-09-29; workplan
 * 0055 T3 (e), the owner's "2a").
 *
 * *"Dropbox answered 500 on files/list_folder: unexpected error occurred"*, on
 * one folder, after four asks, ended the whole files pass on 2026-09-25, and
 * every folder after it waited for the next pass, which met the same folder
 * first. The owner chose: skip that folder for the pass, carry on with the
 * others, say which one could not be read, ask for it again on the next pass,
 * and conclude nothing about its files meanwhile, so no deletions.
 *
 * Driven through the real loop, over several passes where it matters, because
 * "nothing is concluded" is a claim about what the NEXT passes do: the
 * detectors run after the folder loop and read what it saw, and a folder that
 * was never listed has seen nothing. And a failure that is the source's
 * rather than one folder's still ends the pass, as it always did.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runDomainSync } from './domain-sync.ts';
import { MemoryCursorStore, MemoryLedger } from './__testing__/memory.ts';
import {
  APP_EVENT_REFERENCE,
  DELETION_CONFIRMATIONS,
  asTenantId,
  asMappingId,
  setAppEventSink,
  setLogLevel,
  resetLogLevel,
  type AppEvent,
  type UpsertResult,
} from '@openmig/shared';

const TENANT = asTenantId('02a00000-e29b-41d4-a716-4466554402aa');
const MAPPING = asMappingId('02a00000-e29b-41d4-a716-4466554402bb');

/** What the owner's migration met, word for word, after the source's own four asks. */
const DROPBOX_500 = 'Dropbox answered 500 on files/list_folder: unexpected error occurred';

beforeEach(() => setLogLevel('error'));
afterEach(() => {
  resetLogLevel();
  setAppEventSink(undefined);
  vi.restoreAllMocks();
});

interface Item {
  readonly key: string;
}

/**
 * Folders of files, each a list of keys, and the folders that refuse to be
 * listed, with what they answer. A file's key is its natural key, as the loop
 * records it.
 */
function files(initial: Record<string, ReadonlyArray<string>>) {
  const listing = new Map(Object.entries(initial));
  const refusing = new Map<string, string>();
  const ledger = new MemoryLedger();
  const cursors = new MemoryCursorStore();
  /** The folders this pass asked the source to list, in order. */
  const asked: string[] = [];
  let pass = 0;

  const run = () => {
    pass += 1;
    asked.length = 0;
    return runDomainSync<unknown, unknown, Item, { path: string }>({
      sourceIsAuthorityOnExistence: true,
      tenantId: TENANT,
      mappingId: MAPPING,
      domain: 'file',
      source: {},
      target: {},
      ledger,
      cursors,
      concurrency: 1,
      listFolders: async () => [...listing.keys()].map((path) => ({ path })),
      listSince: async (folder) => {
        asked.push(folder.path);
        const refusal = refusing.get(folder.path);
        if (refusal !== undefined) throw new Error(refusal);
        return {
          items: (listing.get(folder.path) ?? []).map((key) => ({ key })),
          nextCursor: { value: `pass-${pass}` },
        };
      },
      // Every key a folder holds, so a pass with a cursor still knows what is
      // there, and the detectors run on every pass, not only the first.
      listCollectionKeys: async (folder) => listing.get(folder.path) ?? [],
      fetchRaw: async (item) => ({ raw: item.key, sizeBytes: item.key.length }),
      upsert: async (): Promise<UpsertResult> => ({ targetId: 't', created: true }),
      naturalKey: (item) => item.key,
      contentHash: (raw) => `h:${raw as string}`,
      sourceVersion: () => 'v1',
      ensureCollection: async (folder) => folder.path,
    });
  };

  return {
    listing,
    refusing,
    ledger,
    asked,
    run,
    cursorOf: async (path: string) => (await cursors.get(TENANT, MAPPING, path))?.value,
    absences: async (key: string) => (await ledger.find(TENANT, MAPPING, 'file', key))?.absentPasses ?? 0,
  };
}

describe('a folder the source will not list', () => {
  it('is skipped, and the folders after it are listed and copied in the same pass', async () => {
    const w = files({ Invoices: ['Invoices/1'], Photos: ['Photos/1'], Letters: ['Letters/1'] });
    w.refusing.set('Photos', DROPBOX_500);

    const result = await w.run();

    expect(w.asked).toEqual(['Invoices', 'Photos', 'Letters']);
    expect(result.created).toBe(2);
    expect(await w.ledger.find(TENANT, MAPPING, 'file', 'Letters/1')).toBeDefined();
    expect(await w.ledger.find(TENANT, MAPPING, 'file', 'Photos/1')).toBeUndefined();
  });

  it('is named, with what the source said, how it is filed, and the reference its log line carries', async () => {
    const events: AppEvent[] = [];
    setAppEventSink({ record: async (e) => void events.push(e) });
    const said = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setLogLevel('warn');
    const w = files({ Invoices: ['Invoices/1'], 'Tax returns 2024': ['Tax returns 2024/1'] });
    w.refusing.set('Tax returns 2024', DROPBOX_500);

    const result = await w.run();

    expect(result.unreadCollections).toEqual([
      {
        collection: 'Tax returns 2024',
        name: 'Tax returns 2024',
        error: DROPBOX_500,
        // The owner's "1c": a Dropbox 5xx that outlasts the retries stays a
        // failure nobody could classify.
        category: 'unknown',
        reference: expect.stringMatching(APP_EVENT_REFERENCE),
      },
    ]);
    const reference = result.unreadCollections![0]!.reference;
    expect(events).toEqual([
      expect.objectContaining({ level: 'warn', event: 'sync.file.collection-unread', reference }),
    ]);
    // The operator's line: the reference and the source's words, and never the
    // folder's name, which is the owner's and reaches them through the result.
    const lines = said.mock.calls.map((c) => c.join(' ')).filter((l) => l.includes(reference));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(DROPBOX_500);
    expect(lines[0]).not.toContain('Tax returns');
    expect(JSON.stringify(events)).not.toContain('Tax returns');
  });

  it("files a refusal as the source's, which is what sent nothing to the destination", async () => {
    const w = files({ Invoices: ['Invoices/1'], Shared: ['Shared/1'] });
    w.refusing.set('Shared', 'Dropbox answered 409 on files/list_folder: path/restricted_content');

    const result = await w.run();

    expect(result.unreadCollections).toEqual([
      expect.objectContaining({ collection: 'Shared', category: 'source_refused' }),
    ]);
  });

  it('keeps its cursor where it was, while the folders the pass did list move theirs on', async () => {
    const w = files({ Invoices: ['Invoices/1'], Photos: ['Photos/1'], Letters: ['Letters/1'] });
    await w.run();
    expect(await w.cursorOf('Photos')).toBe('pass-1');

    w.refusing.set('Photos', DROPBOX_500);
    await w.run();

    expect(await w.cursorOf('Invoices')).toBe('pass-2');
    expect(await w.cursorOf('Photos')).toBe('pass-1');
    expect(await w.cursorOf('Letters')).toBe('pass-2');
  });

  it('is asked for again on the next pass, which copies what it holds then', async () => {
    const w = files({ Invoices: ['Invoices/1'], Photos: ['Photos/1', 'Photos/2'] });
    w.refusing.set('Photos', DROPBOX_500);
    expect((await w.run()).created).toBe(1);

    w.refusing.delete('Photos');
    const next = await w.run();

    expect(w.asked).toContain('Photos');
    expect(next.created).toBe(2);
    expect(next.unreadCollections).toBeUndefined();
  });

  it('has nothing in it counted absent or reported deleted, however many passes it stays unread', async () => {
    const w = files({ Invoices: ['Invoices/1', 'Invoices/2'], Photos: ['Photos/1'] });
    await w.run();

    // Photos stops listing, and one invoice really is deleted at the source.
    w.refusing.set('Photos', DROPBOX_500);
    w.listing.set('Invoices', ['Invoices/1']);
    const passes = DELETION_CONFIRMATIONS + 2;
    for (let n = 1; n <= passes; n += 1) {
      const result = await w.run();
      expect(result.unreadCollections?.map((u) => u.collection), `pass ${n + 1}`).toEqual(['Photos']);
      expect(result.deletions.map((d) => d.naturalKeyHash), `pass ${n + 1}`).not.toContain('Photos/1');
    }

    expect(await w.absences('Photos/1')).toBe(0);
    // The folders the passes did read are still concluded about: the deleted
    // invoice was counted on every pass and reported once it repeated.
    expect(await w.absences('Invoices/2')).toBe(passes);
    expect(await w.absences('Invoices/1')).toBe(0);
  });
});

describe('a failure that is the source rather than one folder', () => {
  it('ends the pass at the third folder in a row that will not list, with that folder’s error', async () => {
    const w = files({ A: ['A/1'], B: ['B/1'], C: ['C/1'], D: ['D/1'], E: ['E/1'] });
    w.refusing.set('B', 'the source is down (B)');
    w.refusing.set('C', 'the source is down (C)');
    w.refusing.set('D', 'the source is down (D)');

    await expect(w.run()).rejects.toThrow('the source is down (D)');
    expect(w.asked).toEqual(['A', 'B', 'C', 'D']);
  });

  it('is not what a run broken by a folder that lists looks like', async () => {
    const w = files({ A: ['A/1'], B: ['B/1'], C: ['C/1'], D: ['D/1'], E: ['E/1'], F: ['F/1'] });
    for (const bad of ['B', 'D', 'E']) w.refusing.set(bad, DROPBOX_500);

    const result = await w.run();

    expect(result.unreadCollections?.map((u) => u.collection)).toEqual(['B', 'D', 'E']);
    expect(result.created).toBe(3);
  });

  it('ends the pass when no folder listed at all, however few there were, with the first error', async () => {
    const w = files({ A: ['A/1'], B: ['B/1'] });
    w.refusing.set('A', 'the first answer');
    w.refusing.set('B', 'the second answer');

    await expect(w.run()).rejects.toThrow('the first answer');
    expect(w.asked).toEqual(['A', 'B']);
  });

  it.each([
    ['a credential that has expired', 'Dropbox answered 401 on files/list_folder: invalid_access_token'],
    ['a source that asked us to slow down', 'Dropbox answered 429 on files/list_folder: too_many_requests'],
    ["a day's allowance spent", 'Quota exceeded for quota metric Queries'],
  ])('ends the pass at the first folder for %s, without asking about the next', async (_what, answer) => {
    const w = files({ A: ['A/1'], B: ['B/1'], C: ['C/1'] });
    w.refusing.set('A', answer);

    await expect(w.run()).rejects.toThrow(answer);
    expect(w.asked).toEqual(['A']);
  });

  it('leaves a network failure to the run of three, since a timeout can be one large folder’s', async () => {
    const w = files({ A: ['A/1'], B: ['B/1'], C: ['C/1'] });
    w.refusing.set('B', 'read ETIMEDOUT');

    const result = await w.run();

    expect(result.unreadCollections).toEqual([
      expect.objectContaining({ collection: 'B', category: 'network' }),
    ]);
    expect(w.asked).toEqual(['A', 'B', 'C']);
  });
});

describe('the name a skipped collection is given', () => {
  const pass = (domain: 'calendar' | 'email', folders: ReadonlyArray<{ path: string; name?: string }>) =>
    runDomainSync<unknown, unknown, Item, { path: string; name?: string }>({
      sourceIsAuthorityOnExistence: true,
      tenantId: TENANT,
      mappingId: MAPPING,
      domain,
      source: {},
      target: {},
      ledger: new MemoryLedger(),
      concurrency: 1,
      listFolders: async () => folders,
      listSince: async (folder) => {
        if (folder.path !== 'ok') throw new Error(DROPBOX_500);
        return { items: [], nextCursor: { value: '1' } };
      },
      fetchRaw: async (item) => ({ raw: item.key, sizeBytes: 1 }),
      upsert: async (): Promise<UpsertResult> => ({ targetId: 't', created: true }),
      naturalKey: (item) => item.key,
      contentHash: (raw) => `h:${raw as string}`,
      ensureCollection: async (folder) => folder.path,
    });

  it("is a calendar's own name, not its address", async () => {
    const result = await pass('calendar', [{ path: 'ok' }, { path: '/calendars/someone/7f3a/', name: 'Team' }]);
    expect(result.unreadCollections).toEqual([
      expect.objectContaining({ collection: '/calendars/someone/7f3a/', name: 'Team' }),
    ]);
  });

  it("is a mail folder's path, which says which of two folders of the same name it is", async () => {
    const result = await pass('email', [{ path: 'ok' }, { path: 'Archive/2019/Projects', name: 'Projects' }]);
    expect(result.unreadCollections).toEqual([
      expect.objectContaining({ collection: 'Archive/2019/Projects', name: 'Archive/2019/Projects' }),
    ]);
  });
});

/**
 * A calendar world whose server keeps a change log per collection, as a sync
 * token does, so a removal is handed out again to a cursor that did not move.
 * The same shape as `a-removal-the-pass-could-not-check.unit.test.ts`.
 */
function calendars() {
  let clock = 0;
  const ledger = new MemoryLedger();
  const cursors = new MemoryCursorStore();
  const refusing = new Set<string>();
  const collections = new Map<
    string,
    { items: Map<string, { uid: string; href: string; at: number }>; removed: Array<{ at: number; href: string }> }
  >();
  const collection = (path: string) => {
    let c = collections.get(path);
    if (!c) {
      c = { items: new Map(), removed: [] };
      collections.set(path, c);
    }
    return c;
  };
  const add = (path: string, uid: string, href: string) => {
    collection(path).items.set(uid, { uid, href, at: ++clock });
  };
  /** Dragged to another calendar: a removal from one, an arrival in the other. */
  const move = (from: string, to: string, uid: string, href: string) => {
    const gone = collection(from).items.get(uid)!;
    collection(from).items.delete(uid);
    collection(from).removed.push({ at: ++clock, href: gone.href });
    add(to, uid, href);
  };
  const run = () =>
    runDomainSync<unknown, unknown, { uid: string; href: string }, { path: string }>({
      sourceIsAuthorityOnExistence: true,
      tenantId: TENANT,
      mappingId: MAPPING,
      domain: 'calendar',
      source: {},
      target: {},
      ledger,
      cursors,
      concurrency: 1,
      listFolders: async () => [...collections.keys()].map((path) => ({ path })),
      listSince: async (folder, cursor) => {
        if (refusing.has(folder.path)) throw new Error(DROPBOX_500);
        const since = cursor ? Number(cursor.value) : 0;
        const c = collection(folder.path);
        return {
          items: [...c.items.values()].filter((o) => o.at > since),
          nextCursor: { value: String(clock) },
          removed: c.removed.filter((r) => r.at > since).map((r) => r.href),
        };
      },
      fetchRaw: async (o) => ({ raw: o.uid, sizeBytes: 1 }),
      upsert: async (collectionId, raw, o, options): Promise<UpsertResult> => {
        await ledger.recordIfAbsent({
          tenantId: TENANT,
          mappingId: MAPPING,
          itemType: 'calendar',
          naturalKeyHash: o.uid,
          contentHash: `h:${raw as string}`,
          targetId: `${collectionId}:${o.uid}`,
          createdAt: new Date().toISOString(),
          sizeBytes: 1,
          status: 'copied',
          ...(options?.collection !== undefined ? { collection: options.collection } : {}),
          ...(options?.sourceRef !== undefined ? { sourceRef: options.sourceRef } : {}),
        });
        return { targetId: `${collectionId}:${o.uid}`, created: true };
      },
      naturalKey: (o) => o.uid,
      sourceRef: (o) => o.href,
      contentHash: (raw) => `h:${raw as string}`,
      ensureCollection: async (folder) => `t/${folder.path}`,
    });
  return { ledger, refusing, add, move, collection, run };
}

describe('an event moved into a calendar the pass could not list', () => {
  it('is not taken for a deletion, and the next pass that lists it sees the move', async () => {
    const w = calendars();
    w.add('Work', 'uid-1', '/cal/work/1.ics');
    w.collection('Personal');
    expect((await w.run()).created).toBe(1);

    w.move('Work', 'Personal', 'uid-1', '/cal/personal/1.ics');
    w.refusing.add('Personal');
    const skipped = await w.run();

    expect(skipped.unreadCollections?.map((u) => u.collection)).toEqual(['Personal']);
    expect(skipped.deletions).toEqual([]);
    expect(await w.ledger.listDeletions(TENANT, MAPPING)).toEqual([]);

    w.refusing.delete('Personal');
    const next = await w.run();

    expect(next.deletions).toEqual([]);
    expect(next.moves).toEqual([
      { domain: 'calendar', naturalKeyHash: 'uid-1', from: 'Work', to: 'Personal' },
    ]);
  });
});
