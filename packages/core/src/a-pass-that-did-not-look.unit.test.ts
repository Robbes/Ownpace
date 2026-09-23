// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PASS THAT DID NOT LOOK CANNOT SAY SOMETHING IS GONE.
 *
 * A pass stops early for two reasons, its own deadline and the provider's
 * download budget, and `paused()` is asked at four places so that a stop never
 * loses work: whether to list at all, whether to open the next folder, whether
 * to scan the next item, and whether a folder's cursor may advance.
 *
 * There was a fifth place, and nothing asked it: whether the pass may conclude
 * that something is GONE. The move detector and the former-name step read the
 * pass's seen-sets as "what the source has", and a folder the pass stopped
 * before finishing has a seen-set that is merely short. So a Drive too big for
 * one pass counted every file past its stop as absent, and two stopped passes
 * in a row reported them all as deleted at the source. A run that waited in the
 * queue past its own deadline lists nothing at all, and it counted EVERY file
 * absent. A throwaway probe through this loop showed the first case: drift 2 on
 * each stopped pass, and both files reported deleted on the third.
 *
 * These tests hold the fifth place: nothing is concluded about a folder the
 * pass did not finish, and everything is still concluded about the ones it did.
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

const TENANT = asTenantId('0e1f0000-e29b-41d4-a716-4466554403aa');
const MAPPING = asMappingId('0e1f0000-e29b-41d4-a716-4466554403bb');

beforeEach(() => setLogLevel('error'));
afterEach(() => resetLogLevel());

interface Item {
  readonly key: string;
  readonly body: string;
  readonly ref?: string;
}

type Listing = Record<string, ReadonlyArray<Item>>;

const TWO_FOLDERS = (): Listing => ({
  f1: [{ key: 'f1/a', body: 'A' }],
  f2: [
    { key: 'f2/b', body: 'B' },
    { key: 'f2/c', body: 'C' },
  ],
});

/** A download budget with nothing left before the pass begins. */
const spentMeter = (): DownloadMeter => {
  const state = async (): Promise<ByteBudgetState> => ({
    spentBytes: 1000,
    ceilingBytes: 1000,
    remainingBytes: 0,
    windowResetsAt: new Date('2026-09-24T00:00:00.000Z'),
  });
  return { tenantId: TENANT as string, provider: 'google-drive', budget: { spend: state, state } };
};

function world(initial: Listing) {
  const state = { listing: initial };
  const ledger = new MemoryLedger();
  const run = (
    opts: {
      /** The deadline passes once this item has been scanned. */
      readonly stopAfter?: string;
      /** The deadline had passed before the pass began. */
      readonly late?: boolean;
      readonly meter?: DownloadMeter;
      readonly formerNames?: (item: Item) => string[];
    } = {},
  ) => {
    let late = opts.late ?? false;
    return runDomainSync<unknown, unknown, Item, { path: string }>({
      sourceIsAuthorityOnExistence: true,
      tenantId: TENANT,
      mappingId: MAPPING,
      domain: 'file',
      source: {},
      target: {},
      ledger,
      concurrency: 1,
      listFolders: async () => Object.keys(state.listing).map((path) => ({ path })),
      listSince: async (folder) => ({
        items: state.listing[folder.path] ?? [],
        nextCursor: { value: '1' },
      }),
      fetchRaw: async (item) => ({ raw: item.body, sizeBytes: item.body.length }),
      upsert: async (): Promise<UpsertResult> => ({ targetId: 't', created: true }),
      naturalKey: (item) => {
        if (item.key === opts.stopAfter) late = true;
        return item.key;
      },
      contentHash: (raw) => `h:${raw as string}`,
      sourceVersion: () => 'v1',
      ensureCollection: async (folder) => folder.path,
      deadline: 500,
      now: () => (late ? 999 : 0),
      ...(opts.meter ? { downloadMeter: opts.meter } : {}),
      ...(opts.formerNames
        ? { formerNaturalKeys: opts.formerNames, sourceRef: (item: Item) => item.ref }
        : {}),
    });
  };
  const absences = async (key: string) =>
    (await ledger.find(TENANT, MAPPING, 'file', key))?.absentPasses ?? 0;
  return { state, ledger, run, absences };
}

describe('a pass that stopped before it finished', () => {
  it('counts nothing in a folder it never reached', async () => {
    const w = world(TWO_FOLDERS());
    await w.run();
    for (const n of [2, 3, 4]) {
      const stopped = await w.run({ stopAfter: 'f1/a' });
      expect(stopped.deadlinePause, `pass ${n} stopped`).toBeDefined();
      expect(stopped.drift, `pass ${n}`).toBe(0);
      expect(stopped.deletions, `pass ${n}`).toEqual([]);
    }
    expect(await w.absences('f2/b')).toBe(0);
    expect(await w.absences('f2/c')).toBe(0);
  });

  it('counts nothing it had not reached in the folder it stopped inside', async () => {
    const w = world(TWO_FOLDERS());
    await w.run();
    for (const n of [2, 3, 4]) {
      const stopped = await w.run({ stopAfter: 'f2/b' });
      expect(stopped.drift, `pass ${n}`).toBe(0);
      expect(stopped.deletions, `pass ${n}`).toEqual([]);
    }
    expect(await w.absences('f2/c')).toBe(0);
  });

  it('concludes nothing when it arrived after its deadline and listed nothing', async () => {
    // A run that waited in the queue longer than its own budget.
    const w = world(TWO_FOLDERS());
    await w.run();
    for (const n of [2, 3, 4]) {
      const late = await w.run({ late: true });
      expect(late.scanned, `pass ${n}`).toBe(0);
      expect(late.drift, `pass ${n}`).toBe(0);
      expect(late.deletions, `pass ${n}`).toEqual([]);
    }
    expect(await w.ledger.listDeletions(TENANT, MAPPING, 'file')).toEqual([]);
  });

  it('concludes nothing when the download budget was spent before it began', async () => {
    const w = world(TWO_FOLDERS());
    await w.run();
    for (const n of [2, 3, 4]) {
      const spent = await w.run({ meter: spentMeter() });
      expect(spent.budgetPause, `pass ${n} paused`).toBeDefined();
      expect(spent.drift, `pass ${n}`).toBe(0);
      expect(spent.deletions, `pass ${n}`).toEqual([]);
    }
    expect(await w.ledger.listDeletions(TENANT, MAPPING, 'file')).toEqual([]);
  });

  it('closes a name a document outgrew only on a pass that finished every folder', async () => {
    // A failure under the name the old export policy gave (0042 T8 (b)). The
    // stopped pass never reached the second folder, so it cannot say that
    // name is no longer given anywhere.
    const w = world({ f1: [{ key: 'f1/Plan.odp', body: 'P', ref: 'deck-1' }], f2: TWO_FOLDERS().f2! });
    await w.ledger.recordIfAbsent({
      tenantId: TENANT,
      mappingId: MAPPING,
      itemType: 'file',
      naturalKeyHash: 'f1/Plan.pptx',
      contentHash: '',
      targetId: '',
      createdAt: '2026-09-23T00:00:00Z',
      status: 'failed',
      collection: 'f1',
      sourceRef: 'deck-1',
    });
    const formerNames = (item: Item) => (item.key === 'f1/Plan.odp' ? ['f1/Plan.pptx'] : []);

    const stopped = await w.run({ stopAfter: 'f1/Plan.odp', formerNames });
    expect(stopped.superseded).toBe(0);
    expect((await w.ledger.find(TENANT, MAPPING, 'file', 'f1/Plan.pptx'))?.status).toBe('failed');

    const finished = await w.run({ formerNames });
    expect(finished.superseded).toBe(1);
    expect((await w.ledger.find(TENANT, MAPPING, 'file', 'f1/Plan.pptx'))?.status).toBe(
      'superseded',
    );
  });
});

describe('what a stopped pass still concludes', () => {
  it('a file gone from a folder it finished is counted, and reported two passes on', async () => {
    const w = world({
      f1: [
        { key: 'f1/a', body: 'A' },
        { key: 'f1/gone', body: 'G' },
      ],
      f2: TWO_FOLDERS().f2!,
    });
    await w.run();
    w.state.listing = { ...w.state.listing, f1: [{ key: 'f1/a', body: 'A' }] };

    const first = await w.run({ stopAfter: 'f1/a' });
    expect(first.deadlinePause).toBeDefined();
    expect(first.drift).toBe(1);
    const second = await w.run({ stopAfter: 'f1/a' });
    expect(second.deletions).toEqual([expect.objectContaining({ naturalKeyHash: 'f1/gone' })]);
  });

  it('a rename inside a folder it finished is still a move', async () => {
    const w = world(TWO_FOLDERS());
    await w.run();
    w.state.listing = { ...w.state.listing, f1: [{ key: 'f1/renamed', body: 'A' }] };

    const stopped = await w.run({ stopAfter: 'f1/renamed' });
    expect(stopped.deadlinePause).toBeDefined();
    expect(stopped.moves).toEqual([
      expect.objectContaining({ naturalKeyHash: 'f1/a', toNaturalKeyHash: 'f1/renamed' }),
    ]);
  });

  it('a pass that finishes afterwards counts what is really gone, as before', async () => {
    const w = world(TWO_FOLDERS());
    await w.run();
    await w.run({ stopAfter: 'f1/a' });
    w.state.listing = { ...w.state.listing, f2: [{ key: 'f2/b', body: 'B' }] };

    const finished = await w.run();
    expect(finished.deadlinePause).toBeUndefined();
    expect(finished.drift).toBe(1);
    expect(await w.absences('f2/c')).toBe(1);
  });
});
