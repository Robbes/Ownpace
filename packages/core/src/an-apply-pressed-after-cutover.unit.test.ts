// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN APPLY PRESSED BY HAND AFTER CUTOVER (2026-10-05, the owner's choice).
 *
 * After cutover no pass reads the old system's bin, resolves a removal it
 * reported, or counts what went missing or moved there (0117 D4, and the
 * re-ask before the end of a pass). But the queues keep what was recorded
 * BEFORE the cutover, or by a pass that was still running when it was
 * executed, and the Apply button on each of them removed the copy on the new
 * system, by the rules from before: nothing in the four functions that remove
 * asked the phase. A leaver who cleans up the old account after the switch
 * leaves entries a press turns into removals on the new one.
 *
 * Asked on 2026-10-05, *"should pressing Apply on a deletion or move that was
 * queued before cutover be refused?"*, the owner chose **"Refuse after cutover
 * (Recommended)"**. And D4 (2026-09-09): *"after cutover the source is no
 * longer the authority on what exists, so we will not delete in target based
 * on changes in the source."*
 *
 * So each of the four asks the data type's own phase, fresh, through the
 * question its caller hands in (`stillTheAuthority`), and after cutover
 * refuses with `after_cutover`: nothing is removed. A rollback makes the old
 * system decide again (ADR-0047), and the same press is admitted again.
 *
 * The phases here are the shared ones every edition reads
 * (`phasesOfTheMigration`, `sourceStillDecides`, `rollbackTransition`), so the
 * question asked is the one the editions ask, not a boolean made up for the
 * test.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  applyDeletion,
  applyRelocation,
  evaluateApplyDeletion,
  evaluateApplyRelocation,
} from './apply-deletion.ts';
import { MemoryLedger } from './__testing__/memory.ts';
import {
  asTenantId,
  asMappingId,
  phasesOfTheMigration,
  rollbackTransition,
  sourceStillDecides,
  type DiscoveryDomain,
  type LedgerRecord,
  type PathPhaseOf,
} from '@openmig/shared';

const TENANT = asTenantId('c0060000-e29b-41d4-a716-4466554412aa');
const MAPPING = asMappingId('c0060000-e29b-41d4-a716-4466554412bb');

function row(overrides: Partial<LedgerRecord> & Pick<LedgerRecord, 'itemType' | 'naturalKeyHash'>): LedgerRecord {
  return {
    tenantId: TENANT,
    mappingId: MAPPING,
    contentHash: `h-${overrides.naturalKeyHash}`,
    targetId: `t-${overrides.naturalKeyHash}`,
    createdAt: new Date().toISOString(),
    sizeBytes: 10,
    status: 'copied',
    targetVersion: 'v1',
    collection: 'Personal',
    ...overrides,
  };
}

/**
 * A calendar event the leaver binned at the old system, and a file the leaver
 * renamed there, both recorded while the old system still decided: the
 * deletion queue's and the moves queue's entries, as a pass before cutover
 * left them. The target holds every copy.
 */
async function queuedBeforeCutover() {
  const ledger = new MemoryLedger();
  await ledger.recordIfAbsent(
    row({ itemType: 'calendar', naturalKeyHash: 'ev-binned', deletionTrashedAt: new Date().toISOString() }),
  );
  await ledger.recordIfAbsent(
    row({
      itemType: 'file',
      naturalKeyHash: 'f-old',
      collection: '/docs',
      contentHash: 'h-pair',
      movedToNaturalKeyHash: 'f-new',
      movedToCollection: '/docs',
    }),
  );
  await ledger.recordIfAbsent(row({ itemType: 'file', naturalKeyHash: 'f-new', collection: '/docs', contentHash: 'h-pair' }));
  const onTarget = new Set(['t-ev-binned', 't-f-old', 't-f-new']);
  const target = {
    removeItem: vi.fn(async (id: string) => {
      onTarget.delete(id);
      return { kind: 'deleted' as const };
    }),
    hasItem: vi.fn(async (id: string) => onTarget.has(id)),
  };
  return { ledger, target, onTarget };
}

/** The question an edition hands in: this data type's phase, read when asked. */
const askedOf = (phaseOf: () => PathPhaseOf, domain: DiscoveryDomain) => () =>
  Promise.resolve(sourceStillDecides({ anyRuns: true, grantWithdrawnAt: null, phaseOf: phaseOf() }, domain));

const depsFor = (
  world: Awaited<ReturnType<typeof queuedBeforeCutover>>,
  domain: DiscoveryDomain,
  stillTheAuthority: () => Promise<boolean>,
) => ({
  tenantId: TENANT,
  mappingId: MAPPING,
  domain,
  ledger: world.ledger,
  target: world.target,
  // On: the case in which anything is removed at all.
  allowApplyDeletions: true,
  stillTheAuthority,
});

describe('after cutover, an apply pressed by hand removes nothing', () => {
  for (const phase of ['cutover', 'continuous', 'done'] as const) {
    it(`refuses a deletion queued before cutover, in '${phase}', with after_cutover`, async () => {
      const world = await queuedBeforeCutover();
      const deps = depsFor(world, 'calendar', askedOf(() => phasesOfTheMigration(phase), 'calendar'));

      const evaluated = await evaluateApplyDeletion(deps, 'ev-binned');
      const applied = await applyDeletion(deps, 'ev-binned');

      expect(evaluated.ok ? 'permitted' : evaluated.code).toBe('after_cutover');
      expect(applied.ok ? 'removed' : applied.code).toBe('after_cutover');
      expect(world.target.removeItem).not.toHaveBeenCalled();
      expect(world.onTarget.has('t-ev-binned')).toBe(true);
      // The sentence a queue shows: what happened, and that nothing did.
      expect(applied.ok ? '' : applied.reason).toMatch(/no longer decides what exists/);
      expect(applied.ok ? '' : applied.reason).toMatch(/Nothing was removed/);
    });

    it(`refuses a relocation queued before cutover, in '${phase}', with after_cutover`, async () => {
      const world = await queuedBeforeCutover();
      const deps = depsFor(world, 'file', askedOf(() => phasesOfTheMigration(phase), 'file'));

      const evaluated = await evaluateApplyRelocation(deps, 'f-old');
      const applied = await applyRelocation(deps, 'f-old');

      expect(evaluated.ok ? 'permitted' : evaluated.code).toBe('after_cutover');
      expect(applied.ok ? 'removed' : applied.code).toBe('after_cutover');
      expect(world.target.removeItem).not.toHaveBeenCalled();
      expect(world.onTarget.has('t-f-old')).toBe(true);
    });
  }

  it('before cutover the same presses DO remove, so the fixture can remove what the cases above keep', async () => {
    const world = await queuedBeforeCutover();
    const active = () => phasesOfTheMigration('active');

    const calendar = depsFor(world, 'calendar', askedOf(active, 'calendar'));
    expect((await evaluateApplyDeletion(calendar, 'ev-binned')).ok).toBe(true);
    expect((await applyDeletion(calendar, 'ev-binned')).ok).toBe(true);

    const file = depsFor(world, 'file', askedOf(active, 'file'));
    expect((await evaluateApplyRelocation(file, 'f-old')).ok).toBe(true);
    expect((await applyRelocation(file, 'f-old')).ok).toBe(true);

    expect([...world.onTarget]).toEqual(['t-f-new']);
  });

  it('asks the phase of the data type it removes from: files past their cutover, calendars still copying', async () => {
    const world = await queuedBeforeCutover();
    // A cutover of one data type (0128 T5): files cut over, calendars not.
    const phaseOf = (): PathPhaseOf => (domain) =>
      domain === 'file' ? { phase: 'cutover', stillCopies: false } : { phase: 'active', stillCopies: false };

    const relocation = await applyRelocation(depsFor(world, 'file', askedOf(phaseOf, 'file')), 'f-old');
    const deletion = await applyDeletion(depsFor(world, 'calendar', askedOf(phaseOf, 'calendar')), 'ev-binned');

    expect(relocation.ok ? 'removed' : relocation.code).toBe('after_cutover');
    expect(deletion.ok).toBe(true);
    expect(world.onTarget.has('t-f-old')).toBe(true);
    expect(world.onTarget.has('t-ev-binned')).toBe(false);
  });

  it('asks when the press arrives, not when it was handed the question: a cutover executed in between wins', async () => {
    const world = await queuedBeforeCutover();
    let status = 'active';
    const deps = depsFor(world, 'calendar', askedOf(() => phasesOfTheMigration(status), 'calendar'));
    // The managed route evaluated, and permitted, then the job runs later.
    expect((await evaluateApplyDeletion(deps, 'ev-binned')).ok).toBe(true);
    status = 'cutover';
    const applied = await applyDeletion(deps, 'ev-binned');
    expect(applied.ok ? 'removed' : applied.code).toBe('after_cutover');
    expect(world.target.removeItem).not.toHaveBeenCalled();
  });

  it('a rollback makes the old system decide again, and the same press is admitted', async () => {
    const world = await queuedBeforeCutover();
    let status = 'continuous';
    const file = depsFor(world, 'file', askedOf(() => phasesOfTheMigration(status), 'file'));
    const refused = await applyRelocation(file, 'f-old');
    expect(refused.ok ? 'removed' : refused.code).toBe('after_cutover');

    // ADR-0047: what a rollback does to the migration, as both editions decide it.
    const rolledBack = rollbackTransition(status);
    expect('reactivate' in rolledBack && rolledBack.reactivate).toBe(true);
    status = 'reactivate' in rolledBack && rolledBack.reactivate ? rolledBack.to : status;

    expect((await evaluateApplyRelocation(file, 'f-old')).ok).toBe(true);
    expect((await applyRelocation(file, 'f-old')).ok).toBe(true);
    expect(world.onTarget.has('t-f-old')).toBe(false);
  });

  it('a question that cannot be answered removes nothing and fails, rather than reading as "before cutover"', async () => {
    const world = await queuedBeforeCutover();
    const unanswerable = () => Promise.reject(new Error('the ledger did not answer'));
    await expect(applyDeletion(depsFor(world, 'calendar', unanswerable), 'ev-binned')).rejects.toThrow(
      'the ledger did not answer',
    );
    await expect(applyRelocation(depsFor(world, 'file', unanswerable), 'f-old')).rejects.toThrow(
      'the ledger did not answer',
    );
    expect(world.target.removeItem).not.toHaveBeenCalled();
  });

  it('an item already removed still says so, rather than after_cutover', async () => {
    // The phase is asked of an item there is still something to decide about:
    // "already removed" is the truer answer for one that is gone.
    const world = await queuedBeforeCutover();
    await world.ledger.recordIfAbsent(
      row({
        itemType: 'calendar',
        naturalKeyHash: 'ev-gone',
        deletionTrashedAt: new Date().toISOString(),
        deletionAppliedAt: new Date().toISOString(),
        status: 'tombstoned',
      }),
    );
    const deps = depsFor(world, 'calendar', askedOf(() => phasesOfTheMigration('continuous'), 'calendar'));
    const applied = await applyDeletion(deps, 'ev-gone');
    expect(applied.ok ? 'removed' : applied.code).toBe('already_applied');
  });
});
