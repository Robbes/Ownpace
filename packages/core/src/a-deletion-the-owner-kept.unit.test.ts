// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DELETION THE OWNER KEPT IS NEVER APPLIED (2026-11-22; ADR-0024).
 *
 * `keep` and `apply` are the two answers to one question on *Deleted on the
 * old system*, and no press made after a keep removes the copy, as it already
 * held for a move (`already_kept`, ADR-0030). Until this, nothing on the
 * deletion path read the answer: a press on a row somebody had kept removed
 * the copy, and the ledger's write closed the row again as applied, so the
 * keep left no trace. The page offers no button on a kept row; what reached
 * one was a page read before the keep, another tab or another person, a call
 * to the API, and on managed a removal that waited in the queue while
 * somebody kept it. Found in the review of workplan 0164 T3, where a keep
 * pressed in another tab during a *Delete all of these here too* run was
 * removed when the run reached it.
 *
 * Held here over the real `applyDeletion` and `evaluateApplyDeletion` and the
 * real `MemoryLedger` (which mirrors `PgLedger`'s conditional UPDATE; the
 * PGlite and Postgres twins in `packages/ledger` run the ledger's half on the
 * real SQL):
 *  - keep, then a press: refused `already_kept`, the target never asked, the
 *    row still kept;
 *  - the managed order: the route's answer at the press, a keep while the job
 *    waits, and the job's own `applyDeletion` refusing it (the job itself
 *    cannot be run in a test; its source is pinned by
 *    `apps/worker/src/jobs/a-deletion-kept-while-its-removal-waited.unit.test.ts`);
 *  - a keep that lands while the removal is under way cannot stop it: the
 *    press answers deleted, and the row says removed, with the keep's time
 *    kept;
 *  - what it must not change: a removed row still says `already_applied`, an
 *    item that came back and was deleted again is asked afresh (the case calls
 *    `clearAbsent` directly, where a pass calls it on seeing the item again),
 *    and after cutover a kept row says `after_cutover`, as a kept move does.
 */

import { describe, it, expect, vi } from 'vitest';
import { asMappingId, asTenantId, type LedgerRecord, type RemovalResult } from '@openmig/shared';
import { applyDeletion, evaluateApplyDeletion, type ApplyDeletionDeps } from './apply-deletion.ts';
import { MemoryLedger } from './__testing__/memory.ts';

const TENANT = asTenantId('ad24ce00-e29b-41d4-a716-4466554400a1');
const MAPPING = asMappingId('ad24ce00-e29b-41d4-a716-4466554400b2');
const HASH = 'kept-event';

function reported(over: Partial<LedgerRecord> = {}): LedgerRecord {
  return {
    tenantId: TENANT,
    mappingId: MAPPING,
    itemType: 'calendar',
    naturalKeyHash: HASH,
    contentHash: 'h-kept',
    targetId: 't-kept',
    targetVersion: '"v-kept"',
    createdAt: new Date().toISOString(),
    sizeBytes: 10,
    status: 'copied',
    collection: 'Personal',
    deletionReportedAt: new Date().toISOString(),
    ...over,
  };
}

/** A target that removes; `during` runs inside the removal, as a concurrent change would. */
function remover(during?: () => Promise<void>) {
  return {
    removeItem: vi.fn(async (): Promise<RemovalResult> => {
      await during?.();
      return { kind: 'deleted' };
    }),
  };
}

function deps(
  ledger: MemoryLedger,
  target: unknown,
  stillTheAuthority: () => Promise<boolean> = async () => true,
): ApplyDeletionDeps {
  return {
    tenantId: TENANT,
    mappingId: MAPPING,
    domain: 'calendar',
    ledger,
    target,
    stillTheAuthority,
  };
}

const keep = (ledger: MemoryLedger) => ledger.resolveDeletion(TENANT, MAPPING, HASH, 'keep');
const queueRow = async (ledger: MemoryLedger) =>
  (await ledger.listDeletions(TENANT, MAPPING)).find((d) => d.naturalKeyHash === HASH);

describe('keep, then a press', () => {
  it('is refused as already kept, asks nothing of the target, and the row stays kept', async () => {
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent(reported());
    expect(await keep(ledger)).toBe(true);
    const target = remover();

    const outcome = await applyDeletion(deps(ledger, target), HASH);

    expect(outcome).toMatchObject({ ok: false, code: 'already_kept' });
    expect(outcome.ok ? '' : outcome.reason).toMatch(/chose to keep the target's copy/);
    expect(target.removeItem).not.toHaveBeenCalled();
    const row = await ledger.find(TENANT, MAPPING, 'calendar', HASH);
    expect(row?.status).toBe('copied');
    expect(row?.deletionAppliedAt).toBeUndefined();
    expect(await queueRow(ledger)).toMatchObject({ decided: 'kept' });
  });

  it('is refused by the route’s own question too, so nothing is queued for it', async () => {
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent(reported());
    expect(await keep(ledger)).toBe(true);

    expect(await evaluateApplyDeletion(deps(ledger, undefined), HASH)).toMatchObject({
      ok: false,
      code: 'already_kept',
    });
  });
});

describe('on managed: a keep recorded while the removal waits in the queue', () => {
  it('wins: the route permitted the press, and the job, which asks every gate again, refuses it', async () => {
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent(reported());
    const target = remover();

    // The press: the route's ledger-side answer, on the request.
    expect(await evaluateApplyDeletion(deps(ledger, undefined), HASH)).toEqual({ ok: true, domain: 'calendar' });
    // The removal waits for its job; meanwhile somebody keeps the copy.
    expect(await keep(ledger)).toBe(true);
    // The job: the same `applyDeletion` a press on the appliance reaches.
    const outcome = await applyDeletion(deps(ledger, target), HASH);

    expect(outcome).toMatchObject({ ok: false, code: 'already_kept' });
    expect(target.removeItem).not.toHaveBeenCalled();
    expect(await queueRow(ledger)).toMatchObject({ decided: 'kept' });
  });
});

describe('a keep that lands while the removal is under way', () => {
  it('cannot stop it: the press answers deleted, and the row says removed, with the keep’s time kept', async () => {
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent(reported());
    // Between core's read and the ledger's write: the removal is happening.
    let keptAt: string | undefined;
    const target = remover(async () => {
      expect(await keep(ledger)).toBe(true);
      keptAt = (await ledger.find(TENANT, MAPPING, 'calendar', HASH))?.deletionAcknowledgedAt;
      // So the write that records the removal comes measurably later.
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    const outcome = await applyDeletion(deps(ledger, target), HASH);

    // The copy went (the removal comes first), and the row says so.
    expect(target.removeItem).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ ok: true, kind: 'deleted' });
    const row = await ledger.find(TENANT, MAPPING, 'calendar', HASH);
    expect(row?.status).toBe('tombstoned');
    expect(row?.deletionAppliedAt).toBeDefined();
    expect(await queueRow(ledger)).toMatchObject({ decided: 'applied' });
    // And the keep's own time stays as it was written.
    expect(keptAt).toBeDefined();
    expect(row?.deletionAcknowledgedAt).toBe(keptAt);
  });
});

describe('what the keep does not change', () => {
  it('a press on a row already removed still says it is removed, though its own write closed the entry', async () => {
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent(reported());
    expect(await applyDeletion(deps(ledger, remover()), HASH)).toEqual({ ok: true, kind: 'deleted' });
    expect((await ledger.find(TENANT, MAPPING, 'calendar', HASH))?.deletionAcknowledgedAt).toBeDefined();

    const again = remover();
    expect(await applyDeletion(deps(ledger, again), HASH)).toMatchObject({ ok: false, code: 'already_applied' });
    expect(await evaluateApplyDeletion(deps(ledger, undefined), HASH)).toMatchObject({
      ok: false,
      code: 'already_applied',
    });
    expect(again.removeItem).not.toHaveBeenCalled();
  });

  it('an item that came back after the keep, and was deleted again, is asked afresh', async () => {
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent(reported());
    expect(await keep(ledger)).toBe(true);
    // Seen on the old system again: the claim and the answer to it both go.
    await ledger.clearAbsent(TENANT, MAPPING, 'calendar', HASH);
    expect((await ledger.find(TENANT, MAPPING, 'calendar', HASH))?.deletionAcknowledgedAt).toBeUndefined();
    // Deleted there once more: a new question, with nobody's answer on it yet.
    await ledger.recordReportedDeletion(TENANT, MAPPING, 'calendar', HASH);
    const target = remover();

    expect(await applyDeletion(deps(ledger, target), HASH)).toEqual({ ok: true, kind: 'deleted' });
    expect(target.removeItem).toHaveBeenCalledTimes(1);
  });

  it('after cutover a kept deletion says after_cutover, as a kept move does, and before it already_kept', async () => {
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent(reported());
    expect(await keep(ledger)).toBe(true);
    const target = remover();
    const pastCutover = async () => false;

    expect(await applyDeletion(deps(ledger, target, pastCutover), HASH)).toMatchObject({
      ok: false,
      code: 'after_cutover',
    });
    expect(await evaluateApplyDeletion(deps(ledger, undefined, pastCutover), HASH)).toMatchObject({
      ok: false,
      code: 'after_cutover',
    });
    expect(await applyDeletion(deps(ledger, target), HASH)).toMatchObject({ ok: false, code: 'already_kept' });
    expect(target.removeItem).not.toHaveBeenCalled();
  });
});
