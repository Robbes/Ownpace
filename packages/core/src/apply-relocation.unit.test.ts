// Copyright 2026 The Ownpace authors (Apache-2.0)

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
import { applyRelocation } from './apply-deletion.ts';
import { MemoryLedger } from './__testing__/memory.ts';
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

/**
 * A target that can both remove AND be asked whether something is there.
 *
 * `hasItem` defaults to true because most tests are about a different gate; the
 * ones about presence pass their own answer. A target with no `hasItem` at all
 * is a separate fixture below, and it must be REFUSED rather than trusted.
 */
function fakeRemover(answer: RemovalResult = { kind: 'deleted' }, present = true) {
  return {
    removeItem: vi.fn(async () => answer),
    hasItem: vi.fn(async () => present),
  };
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
    // NOT `not_found`, which every caller maps to 404 "nothing here to act on"
    // — the opposite of what happened. An operator reading that would believe
    // their copy is still there.
    expect(outcome).toMatchObject({ ok: false, code: 'removed_not_recorded' });
    expect(String((outcome as { reason: string }).reason)).toMatch(/WAS removed/);
  });
});

/**
 * A corpus of `total` migrated files, `relocations` of which have moved.
 *
 * Each relocation is a PAIR of rows sharing one content hash — which is what a
 * relocation is — and every pair gets its own hash, because three rows sharing
 * one is separately refused as ambiguous and would prove nothing about the
 * breaker.
 */
async function corpus(total: number, relocations: number): Promise<MemoryLedger> {
  const ledger = new MemoryLedger();
  for (let i = 0; i < relocations; i += 1) {
    await ledger.recordIfAbsent(
      row({ naturalKeyHash: `old-${i}`, contentHash: `h-${i}`, targetId: `t/old-${i}` }),
    );
    await ledger.recordIfAbsent(
      row({ naturalKeyHash: `new-${i}`, contentHash: `h-${i}`, targetId: `t/new-${i}` }),
    );
    await ledger.recordMove(TENANT, MAPPING, 'file', `old-${i}`, 'Docs', `new-${i}`);
  }
  for (let i = relocations * 2; i < total; i += 1) {
    await ledger.recordIfAbsent(
      row({ naturalKeyHash: `still-${i}`, contentHash: `k-${i}`, targetId: `t/still-${i}` }),
    );
  }
  return ledger;
}

describe('`keep` and `apply` are two answers to one question', () => {
  it('refuses a move the owner already chose to keep', async () => {
    // `mayOfferRelocationApply` has always refused to offer the button here,
    // and its own documentation claimed the server enforced this and more. It
    // did not: the only thing between a recorded decision and a destroyed copy
    // was a button that happened not to render.
    const ledger = await ledgerWithRelocation();
    expect(await ledger.resolveMove(TENANT, MAPPING, OLD_KEY, 'keep')).toBe(true);
    const target = fakeRemover();

    const outcome = await applyRelocation(deps(ledger, target), OLD_KEY);

    expect(outcome).toMatchObject({ ok: false, code: 'already_kept' });
    expect(target.removeItem, 'and nothing was touched').not.toHaveBeenCalled();
    expect((await ledger.find(TENANT, MAPPING, 'file', OLD_KEY))?.status).toBe('copied');
  });

  it('is a DIFFERENT answer from "already removed"', async () => {
    // Both mean "not now", and an operator can tell them apart only if we do:
    // one says the copy is gone, the other says it is still there on purpose.
    const kept = await ledgerWithRelocation();
    await kept.resolveMove(TENANT, MAPPING, OLD_KEY, 'keep');
    const applied = await ledgerWithRelocation();
    await applyRelocation(deps(applied, fakeRemover()), OLD_KEY);

    expect(await applyRelocation(deps(kept, fakeRemover()), OLD_KEY)).toMatchObject({
      code: 'already_kept',
    });
    expect(await applyRelocation(deps(applied, fakeRemover()), OLD_KEY)).toMatchObject({
      code: 'already_applied',
    });
  });

  it('the LEDGER settles it when both answers arrive at once', async () => {
    // Core's check happens before a network call, so two operators answering
    // together both pass it. Gate 7 is where that is decided: the `keep` lands
    // while the removal is in flight, and the conditional UPDATE then matches
    // nothing.
    //
    // The outcome is `removed_not_recorded` — the copy IS gone — and that is
    // the honest report of this race under remove-then-record ordering, not a
    // silent success. What the gate prevents is the second write claiming the
    // removal was a decided, recorded action.
    const ledger = await ledgerWithRelocation();
    const target = {
      hasItem: vi.fn(async () => true),
      removeItem: vi.fn(async () => {
        await ledger.resolveMove(TENANT, MAPPING, OLD_KEY, 'keep');
        return { kind: 'deleted' as const };
      }),
    };

    const outcome = await applyRelocation(deps(ledger, target), OLD_KEY);

    expect(outcome).toMatchObject({ ok: false, code: 'removed_not_recorded' });
    expect(
      (await ledger.find(TENANT, MAPPING, 'file', OLD_KEY))?.status,
      'the ledger refused the write, so the row is NOT tombstoned',
    ).toBe('copied');
  });
});

describe('gate 6, the half nothing used to measure', () => {
  it('refuses every relocation while a fifth of the domain has relocated at once', async () => {
    // Each apply on its own is locally perfect — the bytes really are on the
    // target under the new key — and no per-item gate can see that the same
    // thing just happened to the whole corpus. That is what a change in how a
    // connector normalises paths looks like, and applying through it removes
    // the target's copies at the ORIGINAL paths for good: the old rows are
    // tombstoned, and `classifyKnownItem` will not re-create a tombstone.
    const ledger = await corpus(30, 8); // 8 of 30 = 27%
    const target = fakeRemover();

    const outcome = await applyRelocation(deps(ledger, target), 'old-0');

    expect(outcome).toMatchObject({ ok: false, code: 'mass_relocation_suspected' });
    expect(target.removeItem, 'refused before anything was touched').not.toHaveBeenCalled();
    expect(String((outcome as { reason: string }).reason)).toContain('8 of 30');
  });

  it('does not fire at or under the threshold', async () => {
    const ledger = await corpus(30, 6); // 6 of 30 = 20%, which is not MORE than 20%

    expect(await applyRelocation(deps(ledger, fakeRemover()), 'old-0')).toMatchObject({ ok: true });
  });

  it('does not fire below the floor, however high the share', async () => {
    // Two files, one relocated, is 50% and means nothing.
    const ledger = await ledgerWithRelocation();

    expect(await applyRelocation(deps(ledger, fakeRemover()), OLD_KEY)).toMatchObject({ ok: true });
  });

  it('counts RELOCATIONS, not every move', async () => {
    // A move recorded with a collection alone cannot be applied at all — it is
    // what every mail and calendar move looks like. Counting those would let a
    // folder reorganisation in one domain refuse a file rename in another.
    const ledger = await corpus(30, 1);
    for (let i = 2; i < 14; i += 1) {
      await ledger.recordMove(TENANT, MAPPING, 'file', `still-${i}`, 'Elsewhere');
    }

    expect(await applyRelocation(deps(ledger, fakeRemover()), 'old-0')).toMatchObject({ ok: true });
  });

  it('stops counting a relocation the owner has closed', async () => {
    // Otherwise a bulk reorganisation stays "an incident" forever, and the
    // breaker becomes a wall rather than a pause.
    const ledger = await corpus(30, 8);
    for (let i = 1; i < 8; i += 1) {
      expect(await ledger.resolveMove(TENANT, MAPPING, `old-${i}`, 'keep')).toBe(true);
    }

    expect(await applyRelocation(deps(ledger, fakeRemover()), 'old-0')).toMatchObject({ ok: true });
  });

  it('still refuses on a mass DELETION, which says the listings cannot be trusted', async () => {
    // A relocation is not a deletion and does not enter that count — but a
    // mapping whose deletion evidence has gone wrong in bulk is one whose
    // listings produced this correlation too.
    const ledger = await corpus(30, 1);
    for (let i = 2; i < 12; i += 1) {
      await ledger.recordReportedDeletion(TENANT, MAPPING, 'file', `still-${i}`);
    }

    const outcome = await applyRelocation(deps(ledger, fakeRemover()), 'old-0');

    expect(outcome).toMatchObject({ ok: false, code: 'mass_deletion_suspected' });
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

/**
 * What an adversarial audit found in this path, the day it shipped.
 *
 * Five independent readers attacked it, each finding then attacked again by
 * somebody trying to refute it. Nineteen survived, several capable of removing
 * the LAST copy of a customer's file — on a path whose entire justification is
 * that it cannot.
 *
 * Every one of them is below, named for what it would have destroyed.
 */
describe('what the audit found', () => {
  it('refuses a relocation that points at its OWN key', async () => {
    // It would verify itself: the arrival lookup returns this same row, every
    // check passes trivially, and the copy is removed on the strength of its
    // own existence.
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent(row());
    await ledger.recordMove(TENANT, MAPPING, 'file', OLD_KEY, 'Docs', OLD_KEY);
    const target = fakeRemover();

    const outcome = await applyRelocation(deps(ledger, target), OLD_KEY);

    expect(outcome).toMatchObject({ ok: false, code: 'relocation_unconfirmed' });
    expect(target.removeItem).not.toHaveBeenCalled();
  });

  it('refuses an arrival that was never WRITTEN, whatever isOnTarget says', async () => {
    // The gate read `isOnTarget(status) && status !== 'adopted'`, and that is a
    // different, much weaker question: it admits `pending`, `skipped` and
    // `deleted_source`, none of which means bytes ever reached the target.
    for (const status of ['pending', 'skipped', 'deleted_source'] as const) {
      const ledger = await ledgerWithRelocation({ status });
      const target = fakeRemover();

      const outcome = await applyRelocation(deps(ledger, target), OLD_KEY);

      expect(outcome, status).toMatchObject({ ok: false, code: 'relocation_unconfirmed' });
      expect(target.removeItem, status).not.toHaveBeenCalled();
    }
  });

  it('refuses when both keys are the SAME OBJECT on the target', async () => {
    // Some writers derive a target id from something coarser than the natural
    // key. Where they do, "remove the old copy" and "the new copy" name the
    // same bytes, and the removal takes the survivor with it.
    const ledger = await ledgerWithRelocation({ targetId: 'target/Docs/report.pdf' });
    const target = fakeRemover();

    const outcome = await applyRelocation(deps(ledger, target), OLD_KEY);

    expect(outcome).toMatchObject({ ok: false, code: 'relocation_unconfirmed' });
    expect(String((outcome as { reason: string }).reason)).toMatch(/same object/);
    expect(target.removeItem).not.toHaveBeenCalled();
  });

  it('refuses when a THIRD item shares the bytes, because the pairing is a guess', async () => {
    // A content-hash match is not proof of a move — it is proof that two files
    // hold the same bytes. With a third sharing them, a folder briefly missing
    // from a listing makes a live file look disappeared, an unrelated arrival
    // explains it, and applying removes the copy of a file nobody touched.
    // Every empty file in a Drive has the same hash as every other.
    const ledger = await ledgerWithRelocation();
    await ledger.recordIfAbsent(
      row({ naturalKeyHash: 'Docs/third.pdf', targetId: 'target/Docs/third.pdf' }),
    );
    const target = fakeRemover();

    const outcome = await applyRelocation(deps(ledger, target), OLD_KEY);

    expect(outcome).toMatchObject({ ok: false, code: 'relocation_unconfirmed' });
    expect(String((outcome as { reason: string }).reason)).toMatch(/which one moved is a guess/);
    expect(target.removeItem).not.toHaveBeenCalled();
  });

  it('the LEDGER refuses too when the arrival is invalidated after the check', async () => {
    // The race the audit executed: core reads the arrival, then two more ledger
    // round trips and a NETWORK CALL happen before the write. A concurrent
    // apply on the arrival removes and tombstones it in between, and both
    // copies go. Gate 7 is meant to be the last word and could only speak about
    // the row being removed.
    //
    // Driven at the ledger directly, because that is the layer that has to hold
    // when core's earlier check has already passed.
    const ledger = await ledgerWithRelocation();
    const arrivalKey = NEW_KEY;
    // Whatever happened to it — a concurrent apply, or a crash that left the
    // row claiming `copied` — the ledger must not take it as proof.
    await ledger.applyRelocation(TENANT, MAPPING, 'file', arrivalKey).catch(() => undefined);
    const rows = (ledger as unknown as { rows: Map<string, { status?: string }> }).rows;
    for (const [, r] of rows) if (r.status === 'copied') break;

    // Tombstone the arrival by hand: this is the state the race produces.
    for (const [k, r] of rows) {
      if (k.includes(arrivalKey)) rows.set(k, { ...r, status: 'tombstoned' });
    }

    expect(await ledger.applyRelocation(TENANT, MAPPING, 'file', OLD_KEY)).toBe(false);
  });

  it('closes a DELETION entry the same row was carrying', async () => {
    // A relocated item can be in both queues at once — renamed, then the new
    // name deleted. A confirmed deletion left open on a tombstoned row never
    // leaves the queue, and goes on counting towards the mass-deletion breaker,
    // which would eventually refuse every apply in the domain on the strength
    // of decisions already carried out.
    const ledger = await ledgerWithRelocation(
      {},
      { deletionReportedAt: new Date().toISOString() },
    );

    expect(await applyRelocation(deps(ledger, fakeRemover()), OLD_KEY)).toMatchObject({ ok: true });

    const after = await ledger.find(TENANT, MAPPING, 'file', OLD_KEY);
    expect(after?.deletionAcknowledgedAt, 'left open, it latches the breaker').toBeDefined();
  });
});

describe('the target is asked, not just the ledger (ADR-0030, amended)', () => {
  it('asks about the ARRIVAL, and removes only when the target says yes', async () => {
    const ledger = await ledgerWithRelocation();
    const target = fakeRemover();

    expect(await applyRelocation(deps(ledger, target), OLD_KEY)).toMatchObject({ ok: true });

    // The NEW copy's target id — asking about the old one would confirm the
    // thing being removed, which proves nothing.
    expect(target.hasItem).toHaveBeenCalledWith('target/Docs/summary.pdf', expect.anything());
  });

  it('refuses when the target does NOT have the relocated copy', async () => {
    // The case the ledger cannot see: ADR-0024 removes-then-records, so a crash
    // between those steps leaves a row claiming `copied` for a copy already
    // gone. This is then the only copy left.
    const ledger = await ledgerWithRelocation();
    const target = fakeRemover({ kind: 'deleted' }, false);

    const outcome = await applyRelocation(deps(ledger, target), OLD_KEY);

    expect(outcome).toMatchObject({ ok: false, code: 'relocation_unconfirmed' });
    expect(String((outcome as { reason: string }).reason)).toMatch(/only copy left/);
    expect(target.removeItem).not.toHaveBeenCalled();
  });

  it('refuses a target that cannot be ASKED at all', async () => {
    // An unanswerable question is not a yes. The whole admissibility argument
    // is presence, so a writer that has not implemented the check does not get
    // to host this operation.
    const ledger = await ledgerWithRelocation();
    const target = { removeItem: vi.fn(async () => ({ kind: 'deleted' as const })) };

    const outcome = await applyRelocation(deps(ledger, target), OLD_KEY);

    expect(outcome).toMatchObject({ ok: false, code: 'target_cannot_confirm' });
    expect(target.removeItem).not.toHaveBeenCalled();
  });

  it('does not treat an ERROR from the target as absence', async () => {
    // A 503 is not evidence that a file is gone. The port says throw rather
    // than answer false, and the throw must reach the caller rather than be
    // turned into a refusal that reads like a fact about the file.
    const ledger = await ledgerWithRelocation();
    const target = {
      removeItem: vi.fn(async () => ({ kind: 'deleted' as const })),
      hasItem: vi.fn(async () => {
        throw new Error('503 from the target');
      }),
    };

    await expect(applyRelocation(deps(ledger, target), OLD_KEY)).rejects.toThrow(/503/);
    expect(target.removeItem).not.toHaveBeenCalled();
  });
});
