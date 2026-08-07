// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The one destructive operation in this product, and its seven gates.
 *
 * Nothing else in the sync loop removes anything from a target; everything else
 * reports and leaves both sides untouched. `applyDeletion` is reached only by an
 * explicit, per-item owner decision, and every gate below exists because of a
 * specific way this could otherwise destroy something it should not have. Each
 * gate gets its own test, in the same order `applyDeletion` checks them, so a
 * change that quietly reorders or drops one is caught here rather than in
 * production.
 */

import { describe, it, expect, vi } from 'vitest';
import { applyDeletion, MASS_DELETION_FRACTION, MASS_DELETION_MIN_ITEMS } from './apply-deletion';
import { MemoryLedger } from './__testing__/memory';
import {
  asTenantId,
  asMappingId,
  type LedgerRecord,
  type RemovalResult,
} from '@openmig/shared';

const TENANT = asTenantId('d1990000-e29b-41d4-a716-4466554405aa');
const MAPPING = asMappingId('d1990000-e29b-41d4-a716-4466554405bb');

/** A minimal, fully-specified ledger row — every test starts from this and overrides. */
function baseRow(overrides: Partial<LedgerRecord> = {}): LedgerRecord {
  return {
    tenantId: TENANT,
    mappingId: MAPPING,
    itemType: 'calendar',
    naturalKeyHash: 'nk-1',
    contentHash: 'h1',
    targetId: 'target-path-1',
    createdAt: new Date().toISOString(),
    sizeBytes: 10,
    status: 'copied',
    collection: 'Personal',
    ...overrides,
  };
}

/**
 * A target writer that can remove, with a scriptable answer.
 *
 * `calls` records every `removeItem` invocation so a test can assert not just
 * the outcome but that the writer was (or was not) actually reached — the
 * distinction between "refused before touching the target" and "the target
 * refused" is exactly what several gates below exist to keep visible.
 */
function fakeRemover(answer: RemovalResult | (() => RemovalResult)) {
  const calls: Array<{ targetId: string; expectedTargetVersion?: string; collection?: string }> =
    [];
  return {
    calls,
    removeItem: vi.fn(
      async (
        targetId: string,
        options?: { expectedTargetVersion?: string; collection?: string },
      ) => {
        calls.push({
          targetId,
          ...(options?.expectedTargetVersion !== undefined ? { expectedTargetVersion: options.expectedTargetVersion } : {}),
          ...(options?.collection !== undefined ? { collection: options.collection } : {}),
        });
        return typeof answer === 'function' ? answer() : answer;
      },
    ),
  };
}

/** A target that plainly does not implement `TargetRemover` — no `removeItem` at all. */
function targetWithNoRemover() {
  return { upsertCalendarEvent: vi.fn() };
}

describe('gate 1: the mapping must opt in', () => {
  it('refuses when allowApplyDeletions is absent, without reading the ledger at all', async () => {
    const ledger = new MemoryLedger();
    const find = vi.spyOn(ledger, 'find');
    const target = fakeRemover({ kind: 'deleted' });

    const outcome = await applyDeletion(
      { tenantId: TENANT, mappingId: MAPPING, domain: 'calendar', ledger, target },
      'nk-1',
    );

    expect(outcome).toMatchObject({ ok: false, code: 'not_enabled' });
    // Refused before the ledger was even consulted — a switched-off mapping
    // must not depend on what happens to be in it.
    expect(find).not.toHaveBeenCalled();
    expect(target.removeItem).not.toHaveBeenCalled();
  });

  it('refuses when allowApplyDeletions is explicitly false', async () => {
    const ledger = new MemoryLedger();
    const target = fakeRemover({ kind: 'deleted' });
    const outcome = await applyDeletion(
      { tenantId: TENANT, mappingId: MAPPING, domain: 'calendar', ledger, target, allowApplyDeletions: false },
      'nk-1',
    );
    expect(outcome).toMatchObject({ ok: false, code: 'not_enabled' });
  });
});

describe('gate 2: the target must be able to remove', () => {
  it('refuses a writer with no removeItem, and says so rather than silently no-opping', async () => {
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent(baseRow({ deletionReportedAt: new Date().toISOString() }));
    const target = targetWithNoRemover();

    const outcome = await applyDeletion(
      { tenantId: TENANT, mappingId: MAPPING, domain: 'calendar', ledger, target, allowApplyDeletions: true },
      'nk-1',
    );

    expect(outcome).toEqual({
      ok: false,
      code: 'target_cannot_remove',
      reason: expect.stringContaining('does not support removing items'),
    });
  });
});

describe('gate 3: only positive evidence may be acted on', () => {
  it('refuses an item nothing has said anything about', async () => {
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent(baseRow());
    const target = fakeRemover({ kind: 'deleted' });

    const outcome = await applyDeletion(
      { tenantId: TENANT, mappingId: MAPPING, domain: 'calendar', ledger, target, allowApplyDeletions: true },
      'nk-1',
    );

    expect(outcome).toMatchObject({ ok: false, code: 'not_confirmed' });
    expect(target.removeItem).not.toHaveBeenCalled();
  });

  it('refuses an INFERRED deletion, however many passes it has been absent', async () => {
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent(baseRow({ absentPasses: 50 }));
    const target = fakeRemover({ kind: 'deleted' });

    const outcome = await applyDeletion(
      { tenantId: TENANT, mappingId: MAPPING, domain: 'calendar', ledger, target, allowApplyDeletions: true },
      'nk-1',
    );

    expect(outcome).toEqual({
      ok: false,
      code: 'weak_evidence',
      reason: expect.stringContaining('INFERRED'),
    });
    // The number of passes is not a substitute for evidence — absence never
    // becomes strong enough to act on no matter how long it has repeated.
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain('50');
    expect(target.removeItem).not.toHaveBeenCalled();
  });

  it('accepts REPORTED evidence and proceeds', async () => {
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent(baseRow({ deletionReportedAt: new Date().toISOString() }));
    const target = fakeRemover({ kind: 'deleted' });

    const outcome = await applyDeletion(
      { tenantId: TENANT, mappingId: MAPPING, domain: 'calendar', ledger, target, allowApplyDeletions: true },
      'nk-1',
    );

    expect(outcome).toEqual({ ok: true, kind: 'deleted' });
  });

  it('accepts TRASHED evidence and proceeds', async () => {
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent(
      baseRow({ itemType: 'email', deletionTrashedAt: new Date().toISOString() }),
    );
    const target = fakeRemover({ kind: 'binned' });

    const outcome = await applyDeletion(
      { tenantId: TENANT, mappingId: MAPPING, domain: 'email', ledger, target, allowApplyDeletions: true },
      'nk-1',
    );

    expect(outcome).toEqual({ ok: true, kind: 'binned' });
  });
});

describe('gate 4: only an item this tool wrote', () => {
  it('refuses adopted bytes — those were the customer\'s before this migration existed', async () => {
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent(
      baseRow({ status: 'adopted', deletionReportedAt: new Date().toISOString() }),
    );
    const target = fakeRemover({ kind: 'deleted' });

    const outcome = await applyDeletion(
      { tenantId: TENANT, mappingId: MAPPING, domain: 'calendar', ledger, target, allowApplyDeletions: true },
      'nk-1',
    );

    expect(outcome).toEqual({
      ok: false,
      code: 'not_ours',
      reason: expect.stringContaining("account owner's"),
    });
    expect(target.removeItem).not.toHaveBeenCalled();
  });

  it('refuses an item that was never copied at all (failed)', async () => {
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent(
      baseRow({ status: 'failed', deletionReportedAt: new Date().toISOString() }),
    );
    const target = fakeRemover({ kind: 'deleted' });

    const outcome = await applyDeletion(
      { tenantId: TENANT, mappingId: MAPPING, domain: 'calendar', ledger, target, allowApplyDeletions: true },
      'nk-1',
    );

    expect(outcome).toMatchObject({ ok: false, code: 'not_ours' });
  });

  it('accepts an item this tool rewrote (updated), not only the original copy', async () => {
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent(
      baseRow({ status: 'updated', deletionReportedAt: new Date().toISOString() }),
    );
    const target = fakeRemover({ kind: 'deleted' });

    const outcome = await applyDeletion(
      { tenantId: TENANT, mappingId: MAPPING, domain: 'calendar', ledger, target, allowApplyDeletions: true },
      'nk-1',
    );

    expect(outcome).toEqual({ ok: true, kind: 'deleted' });
  });
});

describe('gate 5: an edit on the target refuses the removal', () => {
  it('reports edited_on_target when the writer refuses with conflicted, and records nothing', async () => {
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent(
      baseRow({ targetVersion: 'etag-1', deletionReportedAt: new Date().toISOString() }),
    );
    const target = fakeRemover({ conflicted: true });

    const outcome = await applyDeletion(
      { tenantId: TENANT, mappingId: MAPPING, domain: 'calendar', ledger, target, allowApplyDeletions: true },
      'nk-1',
    );

    expect(outcome).toEqual({
      ok: false,
      code: 'edited_on_target',
      reason: expect.stringContaining('edited this item'),
    });
    // Nothing was recorded — the row must still read as it did before.
    const row = await ledger.find(TENANT, MAPPING, 'calendar', 'nk-1');
    expect(row?.status).toBe('copied');
    expect(row?.deletionAppliedAt).toBeUndefined();
  });

  it('passes the recorded targetVersion through to the writer, so it can check at the moment of removal', async () => {
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent(
      baseRow({ targetVersion: 'etag-recorded', deletionReportedAt: new Date().toISOString() }),
    );
    const target = fakeRemover({ kind: 'deleted' });

    await applyDeletion(
      { tenantId: TENANT, mappingId: MAPPING, domain: 'calendar', ledger, target, allowApplyDeletions: true },
      'nk-1',
    );

    expect(target.calls).toEqual([
      { targetId: 'target-path-1', expectedTargetVersion: 'etag-recorded', collection: 'Personal' },
    ]);
  });

  it('passes the recorded collection through, because not every target id is globally unique', async () => {
    // A JMAP Email id and a DAV href identify an object on their own; an IMAP
    // UID does not — the same number names a different message in the next
    // mailbox. Without this, `ImapDavMailTarget.removeItem` has nothing to open
    // and refuses; with the wrong one it would remove somebody else's message.
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent(
      baseRow({ collection: 'Archive/2024', deletionReportedAt: new Date().toISOString() }),
    );
    const target = fakeRemover({ kind: 'binned' });

    await applyDeletion(
      { tenantId: TENANT, mappingId: MAPPING, domain: 'calendar', ledger, target, allowApplyDeletions: true },
      'nk-1',
    );

    expect(target.calls).toEqual([{ targetId: 'target-path-1', collection: 'Archive/2024' }]);
  });

  it('omits expectedTargetVersion when the row never recorded one', async () => {
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent(baseRow({ deletionReportedAt: new Date().toISOString() }));
    const target = fakeRemover({ kind: 'deleted' });

    await applyDeletion(
      { tenantId: TENANT, mappingId: MAPPING, domain: 'calendar', ledger, target, allowApplyDeletions: true },
      'nk-1',
    );

    expect(target.calls).toEqual([{ targetId: 'target-path-1', collection: 'Personal' }]);
  });
});

describe('the write order: target first, ledger second', () => {
  it('records tombstoned + deletionAppliedAt only after a successful removal', async () => {
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent(baseRow({ deletionReportedAt: new Date().toISOString() }));
    const target = fakeRemover({ kind: 'binned' });

    const outcome = await applyDeletion(
      { tenantId: TENANT, mappingId: MAPPING, domain: 'calendar', ledger, target, allowApplyDeletions: true },
      'nk-1',
    );

    expect(outcome).toEqual({ ok: true, kind: 'binned' });
    const row = await ledger.find(TENANT, MAPPING, 'calendar', 'nk-1');
    expect(row?.status).toBe('tombstoned');
    expect(row?.deletionAppliedAt).toBeDefined();
    // Closes the queue entry too, exactly as `keep` does — an applied
    // decision must not still read as open.
    expect(row?.deletionAcknowledgedAt).toBeDefined();
  });

  it('reports target_cannot_remove when the writer answers with no kind at all', async () => {
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent(baseRow({ deletionReportedAt: new Date().toISOString() }));
    // A writer that answers `{}` — neither a kind nor conflicted.
    const target = fakeRemover({});

    const outcome = await applyDeletion(
      { tenantId: TENANT, mappingId: MAPPING, domain: 'calendar', ledger, target, allowApplyDeletions: true },
      'nk-1',
    );

    expect(outcome).toMatchObject({ ok: false, code: 'target_cannot_remove' });
    const row = await ledger.find(TENANT, MAPPING, 'calendar', 'nk-1');
    expect(row?.status).toBe('copied');
  });

  it('does NOT report success when the copy is gone but the ledger refused to record it', async () => {
    // The worst state this function can end in, and the only one it cannot
    // undo: the target copy is deleted, and the row still says the item is
    // there. Gate 7 re-checks evidence and ownership in SQL, so it can refuse
    // after the removal has already happened — a concurrent `keep` decision, a
    // row edited between the read and the write, an RLS context that changed.
    //
    // Found by mutation on 2026-08-07, the only survivor of seven against this
    // function: deleting the `if (!recorded)` branch let it return
    // `{ ok: true }`. The operator is told the deletion worked, §20 later
    // reports the item MISSING ON TARGET, and nothing connects the two — the
    // exact shape hard rule 9 forbids, in the one place where the damage is
    // already done and only the reporting is left to get right.
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent(baseRow({ deletionReportedAt: new Date().toISOString() }));
    const target = fakeRemover({ kind: 'deleted' });

    // Everything else is a real MemoryLedger; only the final write refuses.
    const refusing = new Proxy(ledger, {
      get(t, prop, recv) {
        if (prop === 'applyDeletion') return async () => false;
        return Reflect.get(t, prop, recv) as unknown;
      },
    });

    const outcome = await applyDeletion(
      {
        tenantId: TENANT,
        mappingId: MAPPING,
        domain: 'calendar',
        ledger: refusing,
        target,
        allowApplyDeletions: true,
      },
      'nk-1',
    );

    expect(outcome.ok, 'a removal the ledger did not record is not a success').toBe(false);
    // The reason has to say the copy IS gone. "Could not apply" would send an
    // operator to retry something that already happened.
    expect(outcome).toMatchObject({
      ok: false,
      reason: expect.stringContaining('removed from the target'),
    });
    expect(
      (outcome as { reason: string }).reason,
      'the operator is not told where this will resurface',
    ).toMatch(/[Vv]erification/);
    // And the removal really was attempted — otherwise this passes on a
    // refusal that happened before the target was ever touched.
    expect(target.calls).toHaveLength(1);
  });
});

describe('not found and already applied', () => {
  it('reports not_found for a hash with no ledger row', async () => {
    const ledger = new MemoryLedger();
    const target = fakeRemover({ kind: 'deleted' });

    const outcome = await applyDeletion(
      { tenantId: TENANT, mappingId: MAPPING, domain: 'calendar', ledger, target, allowApplyDeletions: true },
      'nk-missing',
    );

    expect(outcome).toMatchObject({ ok: false, code: 'not_found' });
    expect(target.removeItem).not.toHaveBeenCalled();
  });

  it('refuses a second apply on an already-tombstoned row', async () => {
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent(
      baseRow({
        status: 'tombstoned',
        deletionReportedAt: new Date().toISOString(),
        deletionAppliedAt: new Date().toISOString(),
      }),
    );
    const target = fakeRemover({ kind: 'deleted' });

    const outcome = await applyDeletion(
      { tenantId: TENANT, mappingId: MAPPING, domain: 'calendar', ledger, target, allowApplyDeletions: true },
      'nk-1',
    );

    expect(outcome).toMatchObject({ ok: false, code: 'already_applied' });
    expect(target.removeItem).not.toHaveBeenCalled();
  });
});

describe('gate 6: the mass-deletion circuit breaker', () => {
  /** Seeds `count` migrated, placed rows in `calendar`, none of them pending deletion. */
  async function seedCorpus(ledger: MemoryLedger, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      await ledger.recordIfAbsent(
        baseRow({ naturalKeyHash: `bulk-${i}`, targetId: `t-${i}`, collection: 'Personal' }),
      );
    }
  }

  it('does not fire below MASS_DELETION_MIN_ITEMS, however high the share', async () => {
    const ledger = new MemoryLedger();
    // One item total, and it is the one being deleted — 100% pending, but the
    // corpus is far too small for a percentage to mean anything.
    await ledger.recordIfAbsent(baseRow({ deletionReportedAt: new Date().toISOString() }));
    const target = fakeRemover({ kind: 'deleted' });

    const outcome = await applyDeletion(
      { tenantId: TENANT, mappingId: MAPPING, domain: 'calendar', ledger, target, allowApplyDeletions: true },
      'nk-1',
    );

    expect(outcome).toEqual({ ok: true, kind: 'deleted' });
  });

  it(`fires when more than ${MASS_DELETION_FRACTION * 100}% of a large-enough corpus is pending`, async () => {
    const ledger = new MemoryLedger();
    await seedCorpus(ledger, MASS_DELETION_MIN_ITEMS);
    // Push just over the fraction: confirmed-pending deletions on more than
    // MASS_DELETION_FRACTION of the corpus, via recordReportedDeletion so
    // `listDeletions` marks them confirmed the way a real pass would.
    const pendingCount = Math.floor(MASS_DELETION_MIN_ITEMS * MASS_DELETION_FRACTION) + 1;
    for (let i = 0; i < pendingCount; i++) {
      await ledger.recordReportedDeletion(TENANT, MAPPING, 'calendar', `bulk-${i}`);
    }
    const target = fakeRemover({ kind: 'deleted' });

    // Try to apply ONE of the pending items — not the mass of them, a single
    // one, which is exactly the case the breaker has to catch: a single
    // seemingly-reasonable click during what is actually a bulk incident.
    const outcome = await applyDeletion(
      { tenantId: TENANT, mappingId: MAPPING, domain: 'calendar', ledger, target, allowApplyDeletions: true },
      'bulk-0',
    );

    expect(outcome).toMatchObject({ ok: false, code: 'mass_deletion_suspected' });
    expect(target.removeItem).not.toHaveBeenCalled();
  });

  it('does not fire when the share is at or under the threshold', async () => {
    const ledger = new MemoryLedger();
    await seedCorpus(ledger, MASS_DELETION_MIN_ITEMS);
    const pendingCount = Math.floor(MASS_DELETION_MIN_ITEMS * MASS_DELETION_FRACTION);
    for (let i = 0; i < pendingCount; i++) {
      await ledger.recordReportedDeletion(TENANT, MAPPING, 'calendar', `bulk-${i}`);
    }
    const target = fakeRemover({ kind: 'deleted' });

    const outcome = await applyDeletion(
      { tenantId: TENANT, mappingId: MAPPING, domain: 'calendar', ledger, target, allowApplyDeletions: true },
      'bulk-0',
    );

    expect(outcome).toEqual({ ok: true, kind: 'deleted' });
  });

  it('does not count an already-acknowledged (kept or applied) entry as pending', async () => {
    const ledger = new MemoryLedger();
    await seedCorpus(ledger, MASS_DELETION_MIN_ITEMS);
    // Enough reported deletions to exceed the fraction, but all but one are
    // already resolved via `keep` — so they must not inflate the "pending" count.
    const reportedCount = Math.floor(MASS_DELETION_MIN_ITEMS * MASS_DELETION_FRACTION) + 3;
    for (let i = 0; i < reportedCount; i++) {
      await ledger.recordReportedDeletion(TENANT, MAPPING, 'calendar', `bulk-${i}`);
    }
    for (let i = 1; i < reportedCount; i++) {
      await ledger.resolveDeletion(TENANT, MAPPING, `bulk-${i}`, 'keep');
    }
    const target = fakeRemover({ kind: 'deleted' });

    const outcome = await applyDeletion(
      { tenantId: TENANT, mappingId: MAPPING, domain: 'calendar', ledger, target, allowApplyDeletions: true },
      'bulk-0',
    );

    // Only bulk-0 is still open/pending — nowhere near the fraction.
    expect(outcome).toEqual({ ok: true, kind: 'deleted' });
  });

  it('scopes the corpus to (tenant, mapping, domain): another domain\'s incident does not block this one', async () => {
    const ledger = new MemoryLedger();
    await seedCorpus(ledger, MASS_DELETION_MIN_ITEMS);
    // A calendar item to actually apply.
    await ledger.recordIfAbsent(
      baseRow({ naturalKeyHash: 'cal-item', targetId: 't-cal', deletionReportedAt: new Date().toISOString() }),
    );
    // A mass deletion happening in EMAIL, a different domain of the same
    // mapping — must not leak into the calendar check.
    for (let i = 0; i < MASS_DELETION_MIN_ITEMS; i++) {
      await ledger.recordIfAbsent(
        baseRow({ itemType: 'email', naturalKeyHash: `mail-${i}`, targetId: `mt-${i}` }),
      );
    }
    for (let i = 0; i < MASS_DELETION_MIN_ITEMS; i++) {
      await ledger.recordReportedDeletion(TENANT, MAPPING, 'email', `mail-${i}`);
    }
    const target = fakeRemover({ kind: 'deleted' });

    const outcome = await applyDeletion(
      { tenantId: TENANT, mappingId: MAPPING, domain: 'calendar', ledger, target, allowApplyDeletions: true },
      'cal-item',
    );

    expect(outcome).toEqual({ ok: true, kind: 'deleted' });
  });
});
