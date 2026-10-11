// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MOVE RECORDED BEFORE CUTOVER, APPLIED UNATTENDED AFTER IT (2026-10-05).
 *
 * After cutover a pass correlates no moves (0117 D4: the detector does not
 * run), so a file renamed at the old system is copied to its new name and the
 * old copy stays. But a move recorded BEFORE the cutover stayed open: nothing
 * closes open moves at cutover, and the pass that would have cleared them no
 * longer runs. The last pass before cutover always leaves its own moves open
 * for one more pass (ADR-0031's survived-a-pass gate). So on the first file
 * pass after cutover, a mapping with both switches on removed the old copy on
 * the new system, signed `system:auto-apply`, with nobody pressing anything —
 * in both editions, because neither the two dispatchers nor this function
 * asked the phase.
 *
 * The owner, 2026-10-05: *"after cross over the bin reading and deleting on
 * target should stop, because perhaps source-leavers clean up ALL after the
 * cross over."* And D4 (2026-09-09): *"after cutover the source is no longer
 * the authority on what exists, so we will not delete in target based on
 * changes in the source."*
 *
 * So `autoApplyRelocations` asks the data type's phase itself, fresh, before
 * it reads the moves queue, and after cutover removes nothing: stop code
 * `after_cutover`. Turning auto-apply on after cutover therefore applies none
 * of the old moves either.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runDomainSync } from './domain-sync.ts';
import { autoApplyRelocations } from './apply-deletion.ts';
import { MemoryLedger } from './__testing__/memory.ts';
import { asTenantId, asMappingId, log, setLogLevel, resetLogLevel, type UpsertResult } from '@openmig/shared';

const TENANT = asTenantId('c0050000-e29b-41d4-a716-4466554411aa');
const MAPPING = asMappingId('c0050000-e29b-41d4-a716-4466554411bb');

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
 * A file migration whose last pass before cutover recorded a rename, and whose
 * first pass after it copied the new name. Returns the target, the ledger and
 * the moment the pass after cutover started, which is what the auto-apply
 * after that pass is handed.
 */
async function aMoveLeftOpenAtCutover() {
  const files = new Map<string, Doc[]>();
  const target = new Map<string, string>();
  const ledger = new MemoryLedger();
  const run = (authority: boolean) =>
    runDomainSync<unknown, unknown, Doc, { path: string }>({
      sourceIsAuthorityOnExistence: authority,
      stillTheAuthority: async () => authority,
      tenantId: TENANT,
      mappingId: MAPPING,
      domain: 'file',
      source: {},
      target: {},
      ledger,
      listFolders: async () => [...files.keys()].map((path) => ({ path })),
      listSince: async (folder) => ({ items: files.get(folder.path) ?? [], nextCursor: { value: 'x' } }),
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
          targetVersion: 'v1',
          ...(options?.collection !== undefined ? { collection: options.collection } : {}),
        });
        return { targetId: at, created: true, targetVersion: 'v1' };
      },
      naturalKey: (d) => d.path,
      sourceRef: (d) => d.href,
      contentHash: (raw) => `h:${raw as string}`,
      ensureCollection: async (folder) => folder.path,
    });

  files.set('/docs', [{ path: '/docs/report.pdf', href: 'h-r', body: 'R' }]);
  await run(true);
  // Renamed at the old system, and the last pass before cutover records it.
  files.set('/docs', [{ path: '/docs/summary.pdf', href: 'h-r', body: 'R' }]);
  const last = await run(true);
  expect(last.moves.map((m) => m.toNaturalKeyHash), 'the fixture recorded no move').toEqual(['/docs/summary.pdf']);
  await run(true);

  // --- execute: the file data type is now past its cutover ---
  await new Promise((r) => setTimeout(r, 5));
  const passStartedAt = new Date().toISOString();
  const after = await run(false);
  expect(after.moved).toBe(0);

  const remover = {
    removeItem: vi.fn(async (id: string) => {
      target.delete(id);
      return { kind: 'deleted' as const };
    }),
    hasItem: vi.fn(async (id: string) => target.has(id)),
  };
  return { ledger, target, remover, passStartedAt };
}

const applyWith = (
  world: Awaited<ReturnType<typeof aMoveLeftOpenAtCutover>>,
  stillTheAuthority: () => Promise<boolean>,
) =>
  autoApplyRelocations(
    {
      tenantId: TENANT,
      mappingId: MAPPING,
      domain: 'file',
      ledger: world.ledger,
      target: world.remover,
      // Both switches on: the case in which anything is removed at all.
      allowApplyDeletions: true,
      autoApplyRelocations: true,
      stillTheAuthority,
    },
    world.passStartedAt,
  );

describe('after cutover, unattended relocation apply removes nothing', () => {
  it('a move recorded before cutover is not applied after it, and says why', async () => {
    const world = await aMoveLeftOpenAtCutover();
    const listMoves = vi.spyOn(world.ledger, 'listMoves');
    const said = vi.spyOn(log, 'info').mockImplementation(() => {});

    const report = await applyWith(world, async () => false);

    expect(report.applied, 'the old copy was removed after cutover').toEqual([]);
    expect(world.remover.removeItem).not.toHaveBeenCalled();
    expect([...world.target.keys()].sort()).toEqual(['/docs:/docs/report.pdf', '/docs:/docs/summary.pdf']);
    // Refused before the queue is read: a stable code, and nothing considered.
    expect(report.stoppedCode).toBe('after_cutover');
    expect(report.considered).toBe(0);
    expect(listMoves).not.toHaveBeenCalled();
    const lines = said.mock.calls.map((c) => String(c[0]));
    expect(lines).toContainEqual(
      expect.stringContaining('relocation auto-apply not run: after cutover the old system no longer decides what exists'),
    );
  });

  it('before cutover the same move IS applied, so the fixture can remove what the case above keeps', async () => {
    const world = await aMoveLeftOpenAtCutover();
    const report = await applyWith(world, async () => true);
    expect(report.applied.map((a) => a.naturalKeyHash)).toEqual(['/docs/report.pdf']);
    expect([...world.target.keys()]).toEqual(['/docs:/docs/summary.pdf']);
  });

  it('asks the phase when it applies, not when it was handed the question', async () => {
    // Auto-apply switched on, or a pass that straddled execute: what decides
    // is the phase at the moment of removal.
    const world = await aMoveLeftOpenAtCutover();
    let phase: 'active' | 'cutover' = 'active';
    const question = vi.fn(async () => phase === 'active');
    phase = 'cutover';
    const report = await applyWith(world, question);
    expect(question).toHaveBeenCalledTimes(1);
    expect(report.applied).toEqual([]);
    expect(world.remover.removeItem).not.toHaveBeenCalled();
  });

  it('a question that cannot be answered removes nothing and fails, rather than reading as "before cutover"', async () => {
    const world = await aMoveLeftOpenAtCutover();
    await expect(applyWith(world, async () => Promise.reject(new Error('the ledger did not answer')))).rejects.toThrow(
      'the ledger did not answer',
    );
    expect(world.remover.removeItem).not.toHaveBeenCalled();
  });

  it('a mapping that never opted in is not asked at all', async () => {
    const world = await aMoveLeftOpenAtCutover();
    const question = vi.fn(async () => true);
    const report = await autoApplyRelocations(
      {
        tenantId: TENANT,
        mappingId: MAPPING,
        domain: 'file',
        ledger: world.ledger,
        target: world.remover,
        allowApplyDeletions: true,
        autoApplyRelocations: false,
        stillTheAuthority: question,
      },
      world.passStartedAt,
    );
    expect(report.enabled).toBe(false);
    expect(question).not.toHaveBeenCalled();
  });
});
