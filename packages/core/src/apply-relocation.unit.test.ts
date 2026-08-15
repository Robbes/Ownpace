// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The second destructive operation, and the argument that lets it exist.
 *
 * `applyRelocation` (ADR-0030) removes the target's OLD copy of a file the
 * source moved or renamed. That is only defensible because the same bytes are
 * already on the target under the new key — so the tests that matter most here
 * are the ones proving it REFUSES when that is not true, at the moment of
 * acting rather than when the correlation was made.
 *
 * The gates it shares with `applyDeletion` are covered in
 * `apply-deletion.unit.test.ts`; what is exercised here is the gate that
 * replaces the evidence one, plus enough of the shared ones to prove they are
 * still in front of this path too.
 */

import { describe, it, expect, vi } from 'vitest';
import { applyRelocation } from './apply-deletion';
import { MemoryLedger } from './__testing__/memory';
import {
  asTenantId,
  asMappingId,
  type LedgerRecord,
  type RemovalResult,
} from '@openmig/shared';

const TENANT = asTenantId('e2880000-e29b-41d4-a716-4466554407aa');
const MAPPING = asMappingId('e2880000-e29b-41d4-a716-4466554407bb');

const OLD_KEY = 'Docs/report.pdf';
const NEW_KEY = 'Docs/summary.pdf';

function row(overrides: Partial<LedgerRecord> = {}): LedgerRecord {
  return {
    tenantId: TENANT,
    mappingId: MAPPING,
    itemType: 'file',
    naturalKeyHash: OLD_KEY,
    contentHash: 'h-same',
    targetId: 'target/Docs/report.pdf',
    createdAt: new Date().toISOString(),
    sizeBytes: 10,
    status: 'copied',
    collection: 'Docs',
    ...overrides,
  };
}

function fakeRemover(answer: RemovalResult = { kind: 'deleted' }) {
  return { removeItem: vi.fn(async () => answer) };
}

/**
 * A ledger holding the pair a relocation consists of: the old row, with the
 * relocation recorded against it, and the arrival it points at.
 */
async function ledgerWithRelocation(
  arrival: Partial<LedgerRecord> = {},
  old: Partial<LedgerRecord> = {},
): Promise<MemoryLedger> {
  const ledger = new MemoryLedger();
  await ledger.recordIfAbsent(row(old));
  await ledger.recordIfAbsent(
    row({
      naturalKeyHash: NEW_KEY,
      targetId: 'target/Docs/summary.pdf',
      ...arrival,
    }),
  );
  await ledger.recordMove(TENANT, MAPPING, 'file', OLD_KEY, 'Docs', NEW_KEY);
  return ledger;
}

function deps(ledger: MemoryLedger, target: unknown, allow = true) {
  return {
    tenantId: TENANT,
    mappingId: MAPPING,
    domain: 'file' as const,
    ledger,
    target,
    allowApplyDeletions: allow,
  };
}

describe('the happy path', () => {
  it("removes the OLD copy and tombstones its row, leaving the arrival's alone", async () => {
    const ledger = await ledgerWithRelocation();
    const target = fakeRemover({ kind: 'binned' });

    const outcome = await applyRelocation(deps(ledger, target), OLD_KEY);

    expect(outcome).toEqual({ ok: true, kind: 'binned' });
    // The OLD target id, not the new one. Removing the arrival would delete the
    // copy the source still has and leave the stale one standing — the exact
    // inverse of the operation.
    expect(target.removeItem).toHaveBeenCalledWith('target/Docs/report.pdf', expect.anything());

    const oldRow = await ledger.find(TENANT, MAPPING, 'file', OLD_KEY);
    expect(oldRow?.status).toBe('tombstoned');
    expect(oldRow?.deletionAppliedAt).toBeDefined();
    // The move entry closes with it: the decision was made AND carried out.
    expect(oldRow?.moveAcknowledgedAt).toBeDefined();

    const arrivalRow = await ledger.find(TENANT, MAPPING, 'file', NEW_KEY);
    expect(arrivalRow?.status, 'the surviving copy must not be touched').toBe('copied');
  });

  it('reports how recoverable the removal was, rather than assuming', async () => {
    const ledger = await ledgerWithRelocation();

    const outcome = await applyRelocation(deps(ledger, fakeRemover({ kind: 'deleted' })), OLD_KEY);

    expect(outcome).toEqual({ ok: true, kind: 'deleted' });
  });
});

describe('the gate that carries the whole argument', () => {
  it('refuses when NO relocation is recorded — an ordinary move is not this', async () => {
    // A mail or calendar move keeps its natural key, so there is no second key
    // to point at and nothing here may be removed. Those stay report-only.
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent(row());
    await ledger.recordMove(TENANT, MAPPING, 'file', OLD_KEY, 'Elsewhere');
    const target = fakeRemover();

    const outcome = await applyRelocation(deps(ledger, target), OLD_KEY);

    expect(outcome).toMatchObject({ ok: false, code: 'not_relocated' });
    expect(target.removeItem, 'refused before touching the target').not.toHaveBeenCalled();
  });

  it('refuses once the source has put the file BACK', async () => {
    // `clearMove` runs when a pass finds the item where we copied it from
    // again. If it forgot the arrival key, this row would keep offering a
    // removal on the strength of a relocation that has been undone — and the
    // "new copy" it points at is the one the owner just reverted.
    const ledger = await ledgerWithRelocation();
    await ledger.clearMove(TENANT, MAPPING, 'file', OLD_KEY);
    const target = fakeRemover();

    const outcome = await applyRelocation(deps(ledger, target), OLD_KEY);

    expect(outcome).toMatchObject({ ok: false, code: 'not_relocated' });
    expect(target.removeItem).not.toHaveBeenCalled();
  });

  it('refuses when the arrival is GONE from the ledger', async () => {
    const ledger = await ledgerWithRelocation();
    // Something removed the arrival between the correlation and this call.
    (ledger as unknown as { rows: Map<string, unknown> }).rows.forEach((_v, k) => {
      if (String(k).includes(NEW_KEY)) {
        (ledger as unknown as { rows: Map<string, unknown> }).rows.delete(k);
      }
    });
    const target = fakeRemover();

    const outcome = await applyRelocation(deps(ledger, target), OLD_KEY);

    expect(outcome).toMatchObject({ ok: false, code: 'relocation_unconfirmed' });
    expect(target.removeItem).not.toHaveBeenCalled();
  });

  it('refuses when the arrival was ADOPTED rather than written by us', async () => {
    // Adopted bytes were on the target before this migration arrived. They are
    // the account owner's, and they are not evidence that OUR copy of these
    // bytes is safely elsewhere.
    const ledger = await ledgerWithRelocation({ status: 'adopted' });
    const target = fakeRemover();

    const outcome = await applyRelocation(deps(ledger, target), OLD_KEY);

    expect(outcome).toMatchObject({ ok: false, code: 'relocation_unconfirmed' });
    expect(target.removeItem).not.toHaveBeenCalled();
  });

  it('refuses when the arrival has already been tombstoned', async () => {
    const ledger = await ledgerWithRelocation({ status: 'tombstoned' });

    const outcome = await applyRelocation(deps(ledger, fakeRemover()), OLD_KEY);

    expect(outcome).toMatchObject({ ok: false, code: 'relocation_unconfirmed' });
  });

  it("refuses when the arrival's CONTENT no longer matches", async () => {
    // Moved, then edited. The bytes on the target under the new key are not the
    // bytes about to be removed, so removing them would lose something.
    const ledger = await ledgerWithRelocation({ contentHash: 'h-edited-since' });
    const target = fakeRemover();

    const outcome = await applyRelocation(deps(ledger, target), OLD_KEY);

    expect(outcome).toMatchObject({ ok: false, code: 'relocation_unconfirmed' });
    expect(String((outcome as { reason: string }).reason)).toMatch(/lose something/);
    expect(target.removeItem).not.toHaveBeenCalled();
  });
});

describe('the gates it shares with a deletion are still in front of it', () => {
  it('refuses unless the mapping opted in, without reading the ledger', async () => {
    const ledger = await ledgerWithRelocation();
    const find = vi.spyOn(ledger, 'find');

    const outcome = await applyRelocation(deps(ledger, fakeRemover(), false), OLD_KEY);

    expect(outcome).toMatchObject({ ok: false, code: 'not_enabled' });
    expect(find, 'gate 1 comes before every read').not.toHaveBeenCalled();
  });

  it('refuses a target that cannot remove, rather than silently doing nothing', async () => {
    const ledger = await ledgerWithRelocation();

    const outcome = await applyRelocation(deps(ledger, { putFile: vi.fn() }), OLD_KEY);

    expect(outcome).toMatchObject({ ok: false, code: 'target_cannot_remove' });
  });

  it('refuses to remove a copy that is not OURS', async () => {
    // The old row itself was adopted: those bytes were on the target before
    // this migration existed, whatever the source has since done with the file.
    const ledger = await ledgerWithRelocation({}, { status: 'adopted' });
    const target = fakeRemover();

    const outcome = await applyRelocation(deps(ledger, target), OLD_KEY);

    expect(outcome).toMatchObject({ ok: false, code: 'not_ours' });
    expect(target.removeItem).not.toHaveBeenCalled();
  });

  it('leaves a copy the owner has EDITED on the target alone', async () => {
    const ledger = await ledgerWithRelocation();

    const outcome = await applyRelocation(
      deps(ledger, fakeRemover({ conflicted: true })),
      OLD_KEY,
    );

    expect(outcome).toMatchObject({ ok: false, code: 'edited_on_target' });
    // And the row must NOT be tombstoned: nothing was removed.
    expect((await ledger.find(TENANT, MAPPING, 'file', OLD_KEY))?.status).toBe('copied');
  });

  it('refuses a second apply on an already-removed copy', async () => {
    const ledger = await ledgerWithRelocation();
    await applyRelocation(deps(ledger, fakeRemover()), OLD_KEY);

    const again = await applyRelocation(deps(ledger, fakeRemover()), OLD_KEY);

    expect(again).toMatchObject({ ok: false, code: 'already_applied' });
  });

  it('removes FIRST and records second, so a crash cannot claim a phantom removal', async () => {
    // The ordering ADR-0024 fixed: if the ledger write fails after the copy is
    // gone, §20 reports the item missing — loud and correctable. The reverse
    // would leave the row saying it is gone while the copy sits there, which
    // nothing would ever notice.
    const ledger = await ledgerWithRelocation();
    vi.spyOn(ledger, 'applyRelocation').mockResolvedValue(false);
    const target = fakeRemover();

    const outcome = await applyRelocation(deps(ledger, target), OLD_KEY);

    expect(target.removeItem, 'the removal happened').toHaveBeenCalled();
    expect(outcome).toMatchObject({ ok: false, code: 'not_found' });
  });
});

describe('an UNKNOWN hash is not a matching hash', () => {
  it('refuses when neither row recorded a content hash', async () => {
    // `LedgerRecord.contentHash` falls back to `''`, so two rows that say
    // nothing about each other compare EQUAL. On the one path that destroys a
    // copy, that would have sailed through the gate carrying the whole safety
    // argument.
    //
    // Detection cannot produce such a pair today — it correlates only rows that
    // have a hash — which is precisely why this is pinned here: the gate has to
    // hold on its own, for a caller that does not exist yet.
    const ledger = await ledgerWithRelocation({ contentHash: '' }, { contentHash: '' });
    const target = fakeRemover();

    const outcome = await applyRelocation(deps(ledger, target), OLD_KEY);

    expect(outcome).toMatchObject({ ok: false, code: 'relocation_unconfirmed' });
    expect(String((outcome as { reason: string }).reason)).toMatch(/no recorded content hash/);
    expect(target.removeItem).not.toHaveBeenCalled();
  });

  it('refuses when only the ARRIVAL has no hash', async () => {
    const ledger = await ledgerWithRelocation({ contentHash: '' });

    const outcome = await applyRelocation(deps(ledger, fakeRemover()), OLD_KEY);

    expect(outcome).toMatchObject({ ok: false, code: 'relocation_unconfirmed' });
  });
});
