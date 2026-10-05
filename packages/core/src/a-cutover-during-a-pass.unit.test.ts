// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CUTOVER EXECUTED WHILE A PASS WAS RUNNING (2026-10-05).
 *
 * A pass decides at its start whether the old system still decides what
 * exists (`sourceIsAuthorityOnExistence`, 0117 D4), and until today it kept
 * that answer to its end. Execute neither waits for a running pass nor stops
 * it: during the grace period the pass is told to carry on. So a pass that
 * was already copying when the owner pressed execute drew its end-of-pass
 * conclusions by the old rules: it resolved the removals the old system
 * reported, read the old system's bin, and counted what had gone missing or
 * moved there. That is up to fifty minutes of a managed pass, and on the
 * appliance a firing that can run for days.
 *
 * The owner, 2026-10-05: *"after cross over the bin reading and deleting on
 * target should stop, because perhaps source-leavers clean up ALL after the
 * cross over."* And D4 (2026-09-09): *"after cutover the source is no longer
 * the authority on what exists, so we will not delete in target based on
 * changes in the source."*
 *
 * So the pass asks again (`stillTheAuthority`), right before its conclusions,
 * and a "no" leaves all of them out: no removal is resolved, the bin is not
 * read, and nothing is counted missing or moved. What it copied stays copied.
 * Each producer has its own case here, as in
 * `a-lane-that-runs-with-the-detector-present.unit.test.ts`, so a leak names
 * the one that leaked; and each case runs once with the cutover and once
 * without, so that a fixture that cannot produce the signal cannot pass.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runDomainSync } from './domain-sync.ts';
import { runShadowPass } from './reconcile.ts';
import { MemoryLedger, MemorySource, MemoryTarget, MemoryCursorStore } from './__testing__/memory.ts';
import {
  asTenantId,
  asMappingId,
  setLogLevel,
  resetLogLevel,
  discardedScanCursorKey,
  type DiscardedListing,
  type PassStopReason,
  type UpsertResult,
} from '@openmig/shared';

const TENANT = asTenantId('c0050000-e29b-41d4-a716-4466554410aa');
const MAPPING = asMappingId('c0050000-e29b-41d4-a716-4466554410bb');

beforeEach(() => setLogLevel('error'));
afterEach(() => {
  resetLogLevel();
  vi.restoreAllMocks();
});

interface Doc {
  readonly path: string;
  readonly href: string;
  readonly body: string;
}

/**
 * The migration's phase as the database would answer it, which the test
 * moves while a pass runs: the owner pressing execute.
 */
function lifecycle() {
  let phase: 'active' | 'cutover' = 'active';
  let asked = 0;
  return {
    execute: () => {
      phase = 'cutover';
    },
    asked: () => asked,
    stillTheAuthority: async (): Promise<boolean> => {
      asked += 1;
      return phase === 'active';
    },
    /** What the pass is told when the cutover holds no grace period it copies through. */
    whyItStops: async (): Promise<PassStopReason | null> => (phase === 'cutover' ? 'no_longer_runs' : null),
  };
}

/** A file migration with every deletion signal reachable: reports, a bin, and absence. */
function world() {
  const files = new Map<string, Doc[]>();
  const removals = new Map<string, string[]>();
  let binned: string[] = [];
  const target = new Map<string, string>();
  const ledger = new MemoryLedger();
  const binReads = vi.fn(async (): Promise<DiscardedListing> => ({ keys: [...binned], unnameable: 0 }));

  const run = (opts: {
    readonly life: ReturnType<typeof lifecycle>;
    /** Called when a collection is listed: where the test presses execute. */
    readonly onList?: (path: string) => void;
    readonly halts?: boolean;
  }) =>
    runDomainSync<unknown, unknown, Doc, { path: string }>({
      // The pass STARTED with the old system still deciding what exists.
      sourceIsAuthorityOnExistence: true,
      stillTheAuthority: opts.life.stillTheAuthority,
      tenantId: TENANT,
      mappingId: MAPPING,
      domain: 'file',
      source: {},
      target: {},
      ledger,
      concurrency: 1,
      listFolders: async () => [...files.keys()].map((path) => ({ path })),
      listSince: async (folder) => {
        opts.onList?.(folder.path);
        const reported = removals.get(folder.path) ?? [];
        removals.set(folder.path, []);
        return {
          items: files.get(folder.path) ?? [],
          nextCursor: { value: 'x' },
          ...(reported.length > 0 ? { removed: reported } : {}),
        };
      },
      listDiscardedKeys: binReads,
      fetchRaw: async (d) => ({ raw: d.body, sizeBytes: d.body.length }),
      upsert: async (collectionId, raw, d, options): Promise<UpsertResult> => {
        const at = `${collectionId}:${d.path}`;
        target.set(at, raw as string);
        await ledger.recordIfAbsent({
          tenantId: TENANT,
          mappingId: MAPPING,
          itemType: 'file',
          naturalKeyHash: d.path,
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
      naturalKey: (d) => d.path,
      sourceRef: (d) => d.href,
      contentHash: (raw) => `h:${raw as string}`,
      ensureCollection: async (folder) => folder.path,
      ...(opts.halts
        ? {
            whyItStops: opts.life.whyItStops,
            // Every asking is due, so the stop is heard at the first gate after execute.
            now: (() => {
              let at = 0;
              return () => (at += 60_000);
            })(),
          }
        : {}),
    });

  return {
    files,
    removals,
    target,
    ledger,
    binReads,
    bin: (keys: string[]) => {
      binned = keys;
    },
    run,
  };
}

/** Copy everything once, before any cutover. */
async function seeded(w: ReturnType<typeof world>) {
  const first = await w.run({ life: lifecycle() });
  expect(first.created, 'the fixture copied nothing, so nothing below can be lost').toBeGreaterThan(0);
}

/** The ledger writes each producer makes, spied so a leak names itself. */
function spies(ledger: MemoryLedger) {
  return {
    reported: vi.spyOn(ledger, 'recordReportedDeletion'),
    trashed: vi.spyOn(ledger, 'recordTrashedDeletion'),
    absent: vi.spyOn(ledger, 'recordAbsent'),
    moved: vi.spyOn(ledger, 'recordMove'),
  };
}

describe('a cutover executed while a pass runs: the pass concludes nothing about deletions', () => {
  it('a removal the old system reported is not resolved', async () => {
    const scenario = async (executeDuringThePass: boolean) => {
      const w = world();
      w.files.set('/docs', [
        { path: '/docs/keep.txt', href: 'h-keep', body: 'K' },
        { path: '/docs/gone.txt', href: 'h-gone', body: 'G' },
      ]);
      await seeded(w);
      w.files.set('/docs', [{ path: '/docs/keep.txt', href: 'h-keep', body: 'K' }]);
      w.removals.set('/docs', ['h-gone']);
      const s = spies(w.ledger);
      const life = lifecycle();
      const result = await w.run({ life, onList: () => (executeDuringThePass ? life.execute() : undefined) });
      return { result, s, life, w };
    };

    // Without the cutover the report is heard: the fixture can produce it.
    const before = await scenario(false);
    expect(before.result.deletions.map((d) => d.evidence)).toContain('reported');

    const after = await scenario(true);
    expect(after.result.deletions, 'a removal reported by the old system was resolved after cutover').toEqual([]);
    expect(after.life.asked(), 'the pass did not ask again, once, before its conclusions').toBe(1);
    expect(after.s.reported).not.toHaveBeenCalled();
    expect([...after.w.target.keys()].length, 'the target lost a copy').toBe(2);
  });

  it("the old system's bin is not read", async () => {
    const scenario = async (executeDuringThePass: boolean) => {
      const w = world();
      w.files.set('/docs', [
        { path: '/docs/keep.txt', href: 'h-keep', body: 'K' },
        { path: '/docs/trashed.txt', href: 'h-trash', body: 'T' },
      ]);
      await seeded(w);
      w.files.set('/docs', [{ path: '/docs/keep.txt', href: 'h-keep', body: 'K' }]);
      w.bin(['/docs/trashed.txt']);
      w.binReads.mockClear();
      const s = spies(w.ledger);
      const life = lifecycle();
      const result = await w.run({ life, onList: () => (executeDuringThePass ? life.execute() : undefined) });
      return { result, s, w };
    };

    const before = await scenario(false);
    expect(before.result.deletions.map((d) => d.evidence)).toContain('trashed');

    const after = await scenario(true);
    expect(after.w.binReads, 'the bin was read after cutover').not.toHaveBeenCalled();
    expect(after.result.deletions).toEqual([]);
    expect(after.s.trashed).not.toHaveBeenCalled();
  });

  it('nothing is counted missing', async () => {
    const scenario = async (executeDuringThePass: boolean) => {
      const w = world();
      w.files.set('/docs', [
        { path: '/docs/keep.txt', href: 'h-keep', body: 'K' },
        { path: '/docs/vanished.txt', href: 'h-vanish', body: 'V' },
      ]);
      await seeded(w);
      w.files.set('/docs', [{ path: '/docs/keep.txt', href: 'h-keep', body: 'K' }]);
      const s = spies(w.ledger);
      const life = lifecycle();
      const result = await w.run({ life, onList: () => (executeDuringThePass ? life.execute() : undefined) });
      return { result, s, w };
    };

    const before = await scenario(false);
    expect(before.s.absent).toHaveBeenCalled();

    const after = await scenario(true);
    expect(after.s.absent, 'absence was counted after cutover').not.toHaveBeenCalled();
    expect(after.result.deletions).toEqual([]);
    expect(after.result.drift).toBe(0);
  });

  it('a rename is not correlated into a move, so no auto-apply can remove the old copy', async () => {
    const scenario = async (executeDuringThePass: boolean) => {
      const w = world();
      w.files.set('/docs', [{ path: '/docs/report.pdf', href: 'h-r', body: 'R' }]);
      await seeded(w);
      w.files.set('/docs', [{ path: '/docs/summary.pdf', href: 'h-r', body: 'R' }]);
      const s = spies(w.ledger);
      const life = lifecycle();
      const result = await w.run({ life, onList: () => (executeDuringThePass ? life.execute() : undefined) });
      return { result, s, w };
    };

    const before = await scenario(false);
    expect(before.result.moves.map((m) => m.toNaturalKeyHash)).toEqual(['/docs/summary.pdf']);

    const after = await scenario(true);
    expect(after.result.moves, 'a move was correlated after cutover').toEqual([]);
    expect(after.result.moved).toBe(0);
    expect(after.s.moved).not.toHaveBeenCalled();
    // The new name is still copied: after cutover we add, and never take away.
    expect(after.result.created).toBe(1);
    expect([...after.w.target.keys()].sort()).toEqual(['/docs:/docs/report.pdf', '/docs:/docs/summary.pdf']);
  });

  it('a file pass halted by a declared cutover counts nothing missing in the folders it finished', async () => {
    // Execute on a migration that does not copy through its grace period: the
    // pass is told to stop (`no_longer_runs`) at its next gate. The folders it
    // finished before that were still counted for absence, by the old rules.
    const scenario = async (executeDuringThePass: boolean) => {
      const w = world();
      w.files.set('/a', [{ path: '/a/vanished.txt', href: 'h-v', body: 'V' }]);
      w.files.set('/b', [{ path: '/b/keep.txt', href: 'h-k', body: 'K' }]);
      await seeded(w);
      // Gone from /a, which now lists nothing: its listing is the last thing
      // that happens inside it, and the next gate is /b's.
      w.files.set('/a', []);
      const s = spies(w.ledger);
      const life = lifecycle();
      const result = await w.run({
        life,
        halts: true,
        onList: (path) => (executeDuringThePass && path === '/a' ? life.execute() : undefined),
      });
      return { result, s };
    };

    const before = await scenario(false);
    expect(before.result.haltPause).toBeUndefined();
    expect(before.s.absent).toHaveBeenCalled();

    const after = await scenario(true);
    expect(after.result.haltPause?.reason, 'the pass was not halted by the cutover').toBe('no_longer_runs');
    expect(after.s.absent, 'a halted pass counted absence after cutover').not.toHaveBeenCalled();
    expect(after.result.deletions).toEqual([]);
  });

  it('a pass that STARTED after cutover asks nothing again: it has no conclusions to withhold', async () => {
    const w = world();
    w.files.set('/docs', [{ path: '/docs/keep.txt', href: 'h-keep', body: 'K' }]);
    await seeded(w);
    const life = lifecycle();
    life.execute();
    const asked = vi.fn(life.stillTheAuthority);
    await runDomainSync<unknown, unknown, Doc, { path: string }>({
      sourceIsAuthorityOnExistence: false,
      stillTheAuthority: asked,
      tenantId: TENANT,
      mappingId: MAPPING,
      domain: 'file',
      source: {},
      target: {},
      ledger: w.ledger,
      listFolders: async () => [{ path: '/docs' }],
      listSince: async () => ({ items: [], nextCursor: { value: 'x' } }),
      fetchRaw: async (d) => ({ raw: d.body, sizeBytes: 1 }),
      upsert: async () => ({ targetId: 't', created: true }),
      naturalKey: (d) => d.path,
      contentHash: (raw) => `h:${raw as string}`,
      ensureCollection: async (folder) => folder.path,
    });
    expect(asked).not.toHaveBeenCalled();
  });

  it('a question that cannot be answered fails the pass, rather than reading as "still the authority"', async () => {
    // Hard rule 9: a swallowed error here would draw deletion conclusions on
    // the one read that decides whether they may be drawn at all.
    const w = world();
    w.files.set('/docs', [{ path: '/docs/keep.txt', href: 'h-keep', body: 'K' }]);
    await seeded(w);
    const life = lifecycle();
    const broken = { ...life, stillTheAuthority: async (): Promise<boolean> => Promise.reject(new Error('the ledger did not answer')) };
    await expect(w.run({ life: broken })).rejects.toThrow('the ledger did not answer');
  });
});

describe('the mail pass, whose only deletion evidence is the bin', () => {
  function mailbox() {
    const source = new MemorySource();
    source.add({ folderPath: 'INBOX', messageId: '<a@dev.local>', rfc822: 'Subject: a\r\n\r\nbody' });
    source.add({ folderPath: 'INBOX', messageId: '<b@dev.local>', rfc822: 'Subject: b\r\n\r\nbody' });
    source.add({ folderPath: 'Trash', specialUse: 'trash', messageId: '<old@dev.local>', rfc822: 'Subject: old\r\n\r\nbody' });
    return source;
  }

  it('does not list Trash, and leaves the bin scan cursor where it was', async () => {
    const scenario = async (executeDuringThePass: boolean) => {
      const source = mailbox();
      const target = new MemoryTarget();
      const ledger = new MemoryLedger();
      const cursors = new MemoryCursorStore();
      const life = lifecycle();
      const pass = (l: ReturnType<typeof lifecycle>) =>
        runShadowPass({
          sourceIsAuthorityOnExistence: true,
          stillTheAuthority: l.stillTheAuthority,
          tenantId: TENANT,
          mappingId: MAPPING,
          source,
          target,
          ledger,
          cursors,
        });
      await pass(lifecycle());
      const binCursorBefore = await cursors.get(TENANT, MAPPING, discardedScanCursorKey('Trash'));
      expect(binCursorBefore, 'the first pass read no bin, so nothing below could be held still').toBeDefined();

      // The owner deletes a message in the old system: it moves to the bin.
      expect(source.move('<a@dev.local>', 'INBOX', 'Trash')).toBe(true);
      const listed: string[] = [];
      const listSince = source.listSince.bind(source);
      vi.spyOn(source, 'listSince').mockImplementation(async (folder, cursor) => {
        listed.push(folder.path);
        if (executeDuringThePass && folder.path === 'INBOX') life.execute();
        return listSince(folder, cursor);
      });
      const result = await pass(life);
      const binCursorAfter = await cursors.get(TENANT, MAPPING, discardedScanCursorKey('Trash'));
      return { result, listed, target, binCursorBefore, binCursorAfter };
    };

    const before = await scenario(false);
    expect(before.listed).toContain('Trash');
    expect(before.result.deletions?.map((d) => d.evidence)).toEqual(['trashed']);

    const after = await scenario(true);
    expect(after.listed, 'Trash was listed after cutover').not.toContain('Trash');
    expect(after.result.deletions ?? []).toEqual([]);
    expect(after.binCursorAfter, "the bin's scan cursor moved after cutover").toEqual(after.binCursorBefore);
    expect(after.target.size()).toBe(2);
  });
});
