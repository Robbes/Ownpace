// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Removing the target's copy of an item — the only place this product destroys
 * anything.
 *
 * TWO REASONS TO REMOVE, IN ONE FILE, deliberately. `applyDeletion` acts on an
 * item the owner deleted on the source. `applyRelocation` (ADR-0030) acts on the
 * OLD copy of an item that moved or was renamed, once the same bytes are on the
 * target under the new key. They share every gate but the evidence one, and
 * keeping them together is what makes "the destructive path" a place a reviewer
 * can read rather than a phrase. Everything else in this product reports:
 * failures, moves and deletions all go into queues that change nothing on either
 * side.
 *
 * The rest of this comment is about `applyDeletion`; `applyRelocation` states
 * its own differences at its definition, and there are exactly two.
 *
 * Hard rule 2 forbids this tool deleting or overwriting on a target OF ITS OWN
 * ACCORD, and §11.1 says source deletions are never auto-propagated. Neither says
 * the OWNER may not decide about their own data — §11.2 reserves exactly that to
 * them. So the distinction this file has to keep true is: nothing here is ever
 * automatic, batched, or inferred. One item, one decision, one call.
 *
 * SEVEN GATES, and each one exists because of a specific way this could destroy
 * something it should not have:
 *
 * 1. **Turned on for this mapping.** Off unless `allowApplyDeletions` is set, so
 *    an appliance nobody configured for it cannot delete at all, however the
 *    endpoint is called.
 * 2. **The target can remove.** A writer that has not implemented
 *    `TargetRemover` makes this refuse and SAY so. Silently doing nothing would
 *    report success for a removal that never happened.
 * 3. **Positive evidence only.** `reported` (the source named the object) or
 *    `trashed` (we found it in the owner's bin). Never `inferred`, however many
 *    passes it has been absent: a throttled listing, a permissions blip and a
 *    connector having a bad ten minutes all look identical to a deletion, and
 *    acting on that is the worst thing this product could do.
 * 4. **We wrote it.** `copied` or `updated` only. `adopted` bytes are the
 *    customer's own — they were on the target before we arrived — and removing
 *    them would delete data this migration never created.
 * 5. **They have not edited our copy.** The recorded target ETag must still
 *    match, which the writer checks at the moment of removal so there is no gap
 *    between reading and acting. An item the owner has changed in the new system
 *    is theirs now.
 * 6. **This does not look like a mass event.** See `MASS_DELETION_FRACTION`.
 *    The gate is about the EVIDENCE being wrong in bulk, not about an operator
 *    clicking too fast. `applyRelocation` measures relocations as well as
 *    deletions, because nothing else in this file can see past one item.
 * 7. **The ledger still agrees.** The row is flipped by a conditional UPDATE that
 *    re-checks 3 and 4 in SQL, so two concurrent applies cannot both succeed.
 *
 * ORDER MATTERS: remove first, record second. A failure between them leaves the
 * row claiming the item is on the target when it is not, which §20 verification
 * reports as `missingOnTarget` — loud, and correctable by hand. The other order
 * leaves the row claiming the item is gone while the copy sits there, which
 * nothing in the system would ever notice.
 */

import {
  canConfirmPresence,
  canRemove,
  isOnTarget,
  log,
  type Ledger,
  type LedgerRecord,
  type MappingId,
  type RemovalKind,
  type TenantId,
} from '@openmig/shared';

/**
 * Share of a domain's migrated items that may be pending deletion before every
 * apply is refused.
 *
 * The circuit breaker, and it guards against the wrong thing being believed
 * rather than against a hasty operator. If a fifth of a corpus is suddenly
 * "deleted on the source", by far the likeliest explanations are a source outage
 * misread, a mailbox that was wiped and is being restored, or a connector
 * enumerating the wrong account — not that the owner deleted a fifth of their
 * data between two passes. In that situation NO individual removal is trustworthy,
 * including the one an operator happens to be looking at, so the honest answer is
 * to refuse all of them and say why.
 *
 * A fraction rather than a count, because "200 deletions" means something
 * completely different in a 300-item mailbox and a 2,000,000-item one.
 */
export const MASS_DELETION_FRACTION = 0.2;

/**
 * Below this many migrated items, the fraction is not applied.
 *
 * One deletion out of three items is 33% and means nothing; a corpus that small
 * makes the breaker fire on ordinary tidying. The floor is what keeps the gate a
 * signal instead of an obstacle.
 */
export const MASS_DELETION_MIN_ITEMS = 20;

/** Why an apply was refused, or how it succeeded. */
export type ApplyDeletionOutcome =
  /** The copy was removed. `kind` says how final that was. */
  | { readonly ok: true; readonly kind: RemovalKind }
  /** Nothing was removed. `reason` is safe to show an operator verbatim. */
  | { readonly ok: false; readonly code: ApplyRefusal; readonly reason: string };

/** The distinct ways this refuses. Stable strings, for an API to switch on. */
export type ApplyRefusal =
  | 'not_enabled'
  | 'target_cannot_remove'
  | 'not_found'
  | 'not_confirmed'
  | 'weak_evidence'
  | 'not_ours'
  | 'already_applied'
  | 'edited_on_target'
  | 'mass_deletion_suspected'
  /**
   * So much of this domain has relocated at once that the correlation itself
   * is in doubt (ADR-0030).
   *
   * Its own code rather than `mass_deletion_suspected` because an operator can
   * act on it and the two actions differ: a mass deletion means check the
   * SOURCE, a mass relocation means the paths this connector reports have
   * changed wholesale, and the thing to check is why.
   */
  | 'mass_relocation_suspected'
  /** No relocation is recorded against this item (ADR-0030). */
  | 'not_relocated'
  /** A relocation is recorded, but the new copy is not verifiably on the target. */
  | 'relocation_unconfirmed'
  /** The target cannot be asked whether the relocated copy is there (ADR-0030). */
  | 'target_cannot_confirm'
  /**
   * The copy WAS removed and the ledger would not record it.
   *
   * Its own code because the alternative was `not_found`, which every caller
   * maps to 404 "there is nothing here to act on" — the opposite of what
   * happened. An operator reading that would believe their copy is still there.
   */
  | 'removed_not_recorded';

export interface ApplyDeletionDeps {
  readonly tenantId: TenantId;
  readonly mappingId: MappingId;
  readonly domain: 'email' | 'calendar' | 'contact' | 'file';
  readonly ledger: Ledger;
  /** The domain's target writer. Removal happens only if it implements `TargetRemover`. */
  readonly target: unknown;
  /**
   * Whether this mapping is allowed to remove anything at all.
   *
   * Defaults to FALSE. A destructive capability that is on unless disabled is one
   * somebody gets by accident.
   */
  readonly allowApplyDeletions?: boolean;
}

/**
 * The LEDGER-side gates alone — no target, no removal (workplan 0017 T4).
 *
 * The managed edition's route calls this synchronously before it enqueues
 * anything: a refusal is an answer to the operator's question and must come
 * back on the request they made, not as "check back later" from a job result.
 * Five of the seven gates need only the ledger and the mapping's flag; the two
 * that need the TARGET — whether it can remove at all (gate 2) and whether the
 * owner has edited our copy (gate 5, checked at the moment of removal, where
 * the ETag is) — cannot be answered from a request thread and land on the
 * receipt instead.
 *
 * This deliberately DUPLICATES those gates rather than being called by
 * `applyDeletion`: folding it in would reorder gate 2 relative to the ledger
 * reads and change which refusal wins when several apply, on the one path in
 * the product that destroys data. The two are locked together by
 * `apply-deletion-evaluate.unit.test.ts`, which runs BOTH against the same
 * ledger for every ledger-side case and fails on any divergence in code — so
 * the route can never promise what the job then refuses.
 *
 * A permitted outcome here is a PREDICTION, not a guarantee: the job re-runs
 * every gate (including these, freshly) and the ledger's conditional UPDATE
 * (gate 7) stays the final word under concurrency.
 */
export async function evaluateApplyDeletion(
  deps: Omit<ApplyDeletionDeps, 'target'>,
  naturalKeyHash: string,
): Promise<{ ok: true; domain: ApplyDeletionDeps['domain'] } | Extract<ApplyDeletionOutcome, { ok: false }>> {
  const { tenantId, mappingId, domain, ledger } = deps;

  // GATE 1: switched on at all.
  if (deps.allowApplyDeletions !== true) {
    return {
      ok: false,
      code: 'not_enabled',
      reason:
        'Removing items from the target is switched off for this mapping. Set ' +
        '`allowApplyDeletions: true` in its config to enable it, and read the runbook first — ' +
        'this is the only operation here that destroys anything.',
    };
  }

  const row = await ledger.find(tenantId, mappingId, domain, naturalKeyHash);
  if (!row) {
    return { ok: false, code: 'not_found', reason: 'No migrated item under that natural key.' };
  }

  if (row.deletionAppliedAt !== undefined || row.status === 'tombstoned') {
    return {
      ok: false,
      code: 'already_applied',
      reason: 'The target copy of this item has already been removed.',
    };
  }

  // GATE 3: positive evidence only.
  const evidence =
    row.deletionReportedAt !== undefined
      ? 'reported'
      : row.deletionTrashedAt !== undefined
        ? 'trashed'
        : 'inferred';
  if (evidence === 'inferred') {
    const absent = row.absentPasses ?? 0;
    return {
      ok: false,
      code: absent > 0 ? 'weak_evidence' : 'not_confirmed',
      reason:
        absent > 0
          ? `This item is only INFERRED to be deleted: it has been missing from ${absent} ` +
            'complete scan(s) and nothing has stated it was deleted. Absence has innocent causes ' +
            'that all look identical, so it is never enough to remove anything. Delete it in the ' +
            'target system yourself if you are sure, then choose `keep`.'
          : 'Nothing says this item was deleted on the source.',
    };
  }

  // GATE 4: it is ours to remove.
  const ownership = ownershipCheck(row);
  if (ownership) return ownership;

  // GATE 6: does this look like a mass-deletion event?
  const breaker = await massDeletionCheck(deps);
  if (breaker) return breaker;

  return { ok: true, domain };
}

/**
 * Apply one owner decision to remove the target's copy of a deleted item.
 *
 * Returns rather than throws for every refusal, because each one is a sentence an
 * operator needs to read — "this looks like a mass deletion" and "somebody edited
 * that item in the new system" are answers, not errors.
 */
export async function applyDeletion(
  deps: ApplyDeletionDeps,
  naturalKeyHash: string,
): Promise<ApplyDeletionOutcome> {
  const { tenantId, mappingId, domain, ledger, target } = deps;

  // GATE 1: switched on at all.
  if (deps.allowApplyDeletions !== true) {
    return {
      ok: false,
      code: 'not_enabled',
      reason:
        'Removing items from the target is switched off for this mapping. Set ' +
        '`allowApplyDeletions: true` in its config to enable it, and read the runbook first — ' +
        'this is the only operation here that destroys anything.',
    };
  }

  // GATE 2: the target is capable of it. Checked before anything is read, so a
  // target that cannot remove never produces a half-finished decision.
  if (!canRemove(target)) {
    return {
      ok: false,
      code: 'target_cannot_remove',
      reason:
        `The ${domain} target does not support removing items, so this cannot be carried out ` +
        'automatically. Delete the item in the target system yourself, then choose `keep`.',
    };
  }

  const row = await ledger.find(tenantId, mappingId, domain, naturalKeyHash);
  if (!row) {
    return { ok: false, code: 'not_found', reason: 'No migrated item under that natural key.' };
  }

  if (row.deletionAppliedAt !== undefined || row.status === 'tombstoned') {
    return {
      ok: false,
      code: 'already_applied',
      reason: 'The target copy of this item has already been removed.',
    };
  }

  // GATE 3: positive evidence only. The whole safety argument in one condition.
  const evidence =
    row.deletionReportedAt !== undefined
      ? 'reported'
      : row.deletionTrashedAt !== undefined
        ? 'trashed'
        : 'inferred';
  if (evidence === 'inferred') {
    const absent = row.absentPasses ?? 0;
    return {
      ok: false,
      code: absent > 0 ? 'weak_evidence' : 'not_confirmed',
      reason:
        absent > 0
          ? `This item is only INFERRED to be deleted: it has been missing from ${absent} ` +
            'complete scan(s) and nothing has stated it was deleted. Absence has innocent causes ' +
            'that all look identical, so it is never enough to remove anything. Delete it in the ' +
            'target system yourself if you are sure, then choose `keep`.'
          : 'Nothing says this item was deleted on the source.',
    };
  }

  // GATE 4: it is ours to remove.
  const ownership = ownershipCheck(row);
  if (ownership) return ownership;

  // GATE 6: does this look like a mass-deletion event? Read before touching the
  // target, since the point is to refuse while the evidence is in doubt.
  const breaker = await massDeletionCheck(deps);
  if (breaker) return breaker;

  // GATE 5 happens INSIDE the removal, where the ETag is: the writer refuses if
  // the target no longer reports the version we recorded. Doing it here would
  // leave a window between reading the version and acting on it.
  // `collection` goes down with it because an IMAP UID is only meaningful
  // inside the mailbox it was issued in — see `TargetRemover.removeItem`. Every
  // other writer's id stands on its own and ignores it.
  const removal = await target.removeItem(row.targetId, {
    ...(row.targetVersion !== undefined ? { expectedTargetVersion: row.targetVersion } : {}),
    ...(row.collection !== undefined ? { collection: row.collection } : {}),
  });

  if (removal.conflicted) {
    return {
      ok: false,
      code: 'edited_on_target',
      reason:
        'Somebody has edited this item in the new system since we copied it, so it was left ' +
        'alone — those changes are theirs (hard rule 2). Nothing was removed.',
    };
  }
  if (!removal.kind) {
    return {
      ok: false,
      code: 'target_cannot_remove',
      reason: 'The target reported no removal, so nothing has been changed.',
    };
  }

  // GATE 7: the ledger re-checks the evidence and ownership in SQL. Recorded only
  // now, after the copy is actually gone — see the note at the top on ordering.
  const recorded = await ledger.applyDeletion(tenantId, mappingId, domain, naturalKeyHash);
  if (!recorded) {
    // The copy IS gone and the row says otherwise. Said loudly rather than
    // swallowed (hard rule 9): §20 will report it as missing on the target, which
    // is the correct thing for an operator to be shown.
    log.error(
      `[apply] ${domain}: removed the target copy of item ${naturalKeyHash.slice(0, 12)} but the ` +
        'ledger refused to record it — the row still claims the item is on the target. ' +
        'Verification will report it as missing until this is reconciled by hand.',
    );
    return {
      ok: false,
      code: 'removed_not_recorded',
      reason:
        'The copy WAS removed from the target, and the ledger could not record it. Nothing is ' +
        'left to retry: the removal happened. Verification will report this item as missing on ' +
        'the target until that is reconciled by hand.',
    };
  }

  log.warn(
    `[apply] ${domain}: removed the target copy of item ${naturalKeyHash.slice(0, 12)} ` +
      `(${removal.kind}), on ${evidence} evidence, by an explicit owner decision.`,
  );
  return { ok: true, kind: removal.kind };
}

/**
 * The LEDGER-side gates for a relocation — no target, no removal (ADR-0030).
 *
 * The managed route's half, exactly as `evaluateApplyDeletion` is for a
 * deletion, and duplicated from `applyRelocation` for the same reason: folding
 * one into the other would reorder the target gate relative to the ledger reads
 * on the path that destroys data. `apply-deletion-evaluate.unit.test.ts` runs
 * both against the same ledger and fails on any divergence.
 */
export async function evaluateApplyRelocation(
  deps: Omit<ApplyDeletionDeps, 'target'>,
  naturalKeyHash: string,
): Promise<
  { ok: true; domain: ApplyDeletionDeps['domain'] } | Extract<ApplyDeletionOutcome, { ok: false }>
> {
  const { tenantId, mappingId, domain, ledger } = deps;

  if (deps.allowApplyDeletions !== true) return notEnabled();

  const row = await ledger.find(tenantId, mappingId, domain, naturalKeyHash);
  if (!row) {
    return { ok: false, code: 'not_found', reason: 'No migrated item under that natural key.' };
  }
  if (row.deletionAppliedAt !== undefined || row.status === 'tombstoned') {
    return {
      ok: false,
      code: 'already_applied',
      reason: 'The target copy of this item has already been removed.',
    };
  }

  const relocation = await relocationCheck(deps, row);
  if (relocation) return relocation;

  const ownership = ownershipCheck(row);
  if (ownership) return ownership;

  // Both halves of gate 6, in the same order as `applyRelocation`.
  const breaker = (await massDeletionCheck(deps)) ?? (await massRelocationCheck(deps));
  if (breaker) return breaker;

  return { ok: true, domain };
}

/**
 * Remove the target's OLD copy of an item the source moved or renamed (ADR-0030).
 *
 * TWO DIFFERENCES FROM `applyDeletion`, and no others.
 *
 * **1. The evidence.** A deletion needs `reported` or `trashed` — somebody must
 * have SAID the item is gone, because absence alone has innocent causes that all
 * look identical. A relocation needs neither, because nothing was deleted: what
 * stands in place of the evidence is a recorded relocation, written by the pass
 * that correlated the disappearance with an arrival carrying the same bytes.
 *
 * **2. What that buys, which is the whole argument for allowing this at all.**
 * Applying a deletion destroys the last copy under this product's control.
 * Applying a relocation destroys a copy that is, by construction, redundant —
 * `relocationCheck` re-reads the ledger and refuses unless the arrival is on the
 * target, was written BY US (`copied`/`updated`, never `adopted`), and carries
 * the same content hash. So this is strictly safer than the operation ADR-0024
 * already permits, which is why it is admitted on evidence a deletion could not
 * use.
 *
 * Everything else is identical and deliberately so: the per-mapping opt-in, the
 * target capability check, the ownership rule, the ETag re-check inside the
 * removal, the remove-then-record ordering, and the ledger's own conditional
 * UPDATE having the final word. The mass breaker is the one gate that is WIDER
 * here: it measures relocations as well as deletions, because the per-item
 * argument above is exactly what a bulk correlation failure satisfies.
 *
 * IT SHARES `allowApplyDeletions` rather than adding a flag. This is the same
 * capability — removing our copy from the target — and a second switch would
 * mean an owner who opted into the more dangerous operation is refused the safer
 * one, which nobody would predict from the names.
 */
export async function applyRelocation(
  deps: ApplyDeletionDeps,
  naturalKeyHash: string,
): Promise<ApplyDeletionOutcome> {
  const { tenantId, mappingId, domain, ledger, target } = deps;

  // GATE 1: switched on at all.
  if (deps.allowApplyDeletions !== true) return notEnabled();

  // GATE 2: the target is capable of it, checked before anything is read.
  if (!canRemove(target)) {
    return {
      ok: false,
      code: 'target_cannot_remove',
      reason:
        `The ${domain} target does not support removing items, so this cannot be carried out ` +
        'automatically. Delete the old copy in the target system yourself, then choose `keep`.',
    };
  }

  const row = await ledger.find(tenantId, mappingId, domain, naturalKeyHash);
  if (!row) {
    return { ok: false, code: 'not_found', reason: 'No migrated item under that natural key.' };
  }
  if (row.deletionAppliedAt !== undefined || row.status === 'tombstoned') {
    return {
      ok: false,
      code: 'already_applied',
      reason: 'The target copy of this item has already been removed.',
    };
  }

  // GATE 3, in its relocation form: a recorded relocation whose arrival is
  // verifiably on the target. See the note above on why this is admissible.
  const relocation = await relocationCheck(deps, row);
  if (relocation) return relocation;

  // GATE 4: it is ours to remove.
  const ownership = ownershipCheck(row);
  if (ownership) return ownership;

  // GATE 6, BOTH HALVES: does the queue look like an incident?
  //
  // A relocation is not a deletion and does not enter that count, but a mapping
  // whose deletion evidence has gone wrong in bulk is one whose listings cannot
  // be trusted — including the listing that produced this correlation. So the
  // deletion breaker still applies here.
  //
  // And relocations are counted in their own right, because until this they
  // were measured by nothing at all: a whole corpus could relocate and every
  // individual apply would sail through, each one truthfully reporting that the
  // bytes are on the target under the new key.
  const breaker = (await massDeletionCheck(deps)) ?? (await massRelocationCheck(deps));
  if (breaker) return breaker;

  // THE ARRIVAL, ASKED OF THE TARGET ITSELF (ADR-0030, amended).
  //
  // Everything above this consulted the LEDGER, and the ledger is a claim.
  // ADR-0024 deliberately removes-then-records, so a crash or a failed write
  // between those two steps leaves a row saying `copied` for a copy that is
  // already gone — and trusting such a row is exactly how the last copy of a
  // file gets destroyed by an operation that reports the opposite.
  //
  // So the last thing before removing anything is to ask the target whether the
  // NEW copy is really there. A target that cannot answer does not get to host
  // this operation: the whole admissibility argument is presence, and an
  // unanswerable question is not a yes.
  const arrivalRow = await ledger.find(tenantId, mappingId, domain, row.movedToNaturalKeyHash!);
  if (!canConfirmPresence(target)) {
    return {
      ok: false,
      code: 'target_cannot_confirm',
      reason:
        `The ${domain} target cannot be asked whether the relocated copy is really there, and ` +
        'removing this one is only safe if it is. Remove the old copy in the target system ' +
        'yourself if you are sure, then choose `keep`.',
    };
  }
  const present = await target.hasItem(arrivalRow!.targetId, {
    ...(arrivalRow!.collection !== undefined ? { collection: arrivalRow!.collection } : {}),
  });
  if (!present) {
    return {
      ok: false,
      code: 'relocation_unconfirmed',
      reason:
        'The target does not have the relocated copy, whatever the ledger says — so this is the ' +
        'only copy left and it will not be removed. Verification will report the other one as ' +
        'missing until that is reconciled.',
    };
  }

  // GATE 5 happens INSIDE the removal, where the ETag is.
  const removal = await target.removeItem(row.targetId, {
    ...(row.targetVersion !== undefined ? { expectedTargetVersion: row.targetVersion } : {}),
    ...(row.collection !== undefined ? { collection: row.collection } : {}),
  });

  if (removal.conflicted) {
    return {
      ok: false,
      code: 'edited_on_target',
      reason:
        'Somebody has edited this item in the new system since we copied it, so it was left ' +
        'alone — those changes are theirs (hard rule 2). Nothing was removed.',
    };
  }
  if (!removal.kind) {
    return {
      ok: false,
      code: 'target_cannot_remove',
      reason: 'The target reported no removal, so nothing has been changed.',
    };
  }

  // GATE 7: the ledger re-checks the relocation and ownership in SQL. Recorded
  // only now, after the copy is actually gone — same ordering, same reason.
  const recorded = await ledger.applyRelocation(tenantId, mappingId, domain, naturalKeyHash);
  if (!recorded) {
    log.error(
      `[apply] ${domain}: removed the target's old copy of relocated item ` +
        `${naturalKeyHash.slice(0, 12)} but the ledger refused to record it — the row still ` +
        'claims the item is on the target. Verification will report it as missing until this ' +
        'is reconciled by hand.',
    );
    return {
      ok: false,
      code: 'removed_not_recorded',
      reason:
        "The old copy WAS removed from the target, and the ledger could not record it. Nothing " +
        'is left to retry: the removal happened. Verification will report this item as missing ' +
        'on the target until that is reconciled by hand.',
    };
  }

  log.warn(
    `[apply] ${domain}: removed the target's OLD copy of relocated item ` +
      `${naturalKeyHash.slice(0, 12)} (${removal.kind}) — the same bytes remain on the target ` +
      'under the key the source moved it to, by an explicit owner decision.',
  );
  return { ok: true, kind: removal.kind };
}

/** Gate 1's refusal, written once so both paths say the same thing. */
function notEnabled(): Extract<ApplyDeletionOutcome, { ok: false }> {
  return {
    ok: false,
    code: 'not_enabled',
    reason:
      'Removing items from the target is switched off for this mapping. Set ' +
      '`allowApplyDeletions: true` in its config to enable it, and read the runbook first — ' +
      'this is the only operation here that destroys anything.',
  };
}

/**
 * Gate 4, shared: only a copy this migration actually wrote may be removed.
 *
 * MIRRORS THE LEDGER'S OWN WHERE CLAUSE — `status IN ('copied','updated')` —
 * and this has to be an equality, not an approximation. It used to be
 * `isOnTarget(status) && status !== 'adopted'`, which is WIDER: `pending`,
 * `skipped`, `deleted_source` and a row with no status at all pass that and are
 * refused by the SQL. The consequence was not a harmless extra refusal, because
 * of the ordering this file insists on: the removal happens FIRST and the ledger
 * records it second. So such a row went all the way to `target.removeItem`, the
 * copy was destroyed, and the conditional UPDATE then matched nothing — landing
 * in `removed_not_recorded`, the one outcome with nothing left to retry. The
 * gate did not race into that state, it guaranteed it.
 *
 * `isOnTarget` is still consulted first, because "this item is not on the target"
 * is a better sentence for `failed`/`left_behind`/`tombstoned` than the general
 * one, and an operator reading a refusal deserves the specific reason.
 */
function ownershipCheck(row: {
  readonly status?: LedgerRecord['status'];
}): Extract<ApplyDeletionOutcome, { ok: false }> | undefined {
  if (row.status === 'copied' || row.status === 'updated') return undefined;

  if (!isOnTarget(row.status)) {
    return {
      ok: false,
      code: 'not_ours',
      reason: `This item is not on the target (status ${row.status ?? 'unknown'}), so there is nothing to remove.`,
    };
  }
  if (row.status === 'adopted') {
    return {
      ok: false,
      code: 'not_ours',
      reason:
        'The copy on the target was already there before this migration ran — those bytes are ' +
        "the account owner's, not ours to delete (hard rule 2). Remove it yourself if you want " +
        'it gone, then choose `keep`.',
    };
  }
  // Everything else: on the target as far as the status column is concerned,
  // but not recorded as something we wrote. The ledger would refuse to record
  // the removal, so it must not happen.
  return {
    ok: false,
    code: 'not_ours',
    reason:
      `The ledger does not record this copy as one this migration wrote (status ` +
      `${row.status ?? 'unknown'}). Only items recorded as \`copied\` or \`updated\` can be ` +
      'removed. Delete it in the target system yourself if you want it gone, then choose `keep`.',
  };
}

/**
 * The gate that carries ADR-0030's whole safety argument.
 *
 * Removing the old copy of a relocated item is allowed BECAUSE the same bytes
 * are already on the target under the new key. That has to be true at the moment
 * of acting, not merely when the correlation was made — an owner may press this
 * days later, and in between the arrival could have been tombstoned by another
 * decision, or the row could turn out to be one the target already had.
 *
 * So all three are re-read here: the arrival exists, it is ON the target and was
 * written by US (`adopted` bytes are the account owner's and prove nothing about
 * ours), and its content hash still matches the copy about to be removed.
 */
async function relocationCheck(
  deps: Omit<ApplyDeletionDeps, 'target'>,
  row: {
    readonly naturalKeyHash: string;
    readonly movedToNaturalKeyHash?: string;
    readonly contentHash?: string;
    readonly targetId?: string;
  },
): Promise<Extract<ApplyDeletionOutcome, { ok: false }> | undefined> {
  const { tenantId, mappingId, domain, ledger } = deps;
  const arrivalKey = row.movedToNaturalKeyHash;
  if (arrivalKey !== undefined && arrivalKey === row.naturalKeyHash) {
    // A row pointing at ITSELF would verify itself: the arrival lookup returns
    // this same row, every check passes trivially, and the copy is removed on
    // the strength of its own existence. Detection cannot produce one — an
    // arrival is a key the ledger did not already hold — but this is the gate
    // that must not be talked into it.
    return {
      ok: false,
      code: 'relocation_unconfirmed',
      reason:
        'This item records a relocation to its own key, which cannot be evidence of anything. ' +
        'Nothing was removed.',
    };
  }
  if (!arrivalKey) {
    return {
      ok: false,
      code: 'not_relocated',
      reason:
        'No relocation is recorded for this item, so there is no new copy to point at and ' +
        'nothing here may be removed. A move that only changed FOLDER on a source keyed by a ' +
        'stable id — mail, calendar, contacts — is reported for you to look at, and the target ' +
        'is left exactly as it is (§11.1).',
    };
  }

  const arrival = await ledger.find(tenantId, mappingId, domain, arrivalKey);
  if (!arrival) {
    return {
      ok: false,
      code: 'relocation_unconfirmed',
      reason:
        'The item this one was relocated to is no longer in the ledger, so the bytes cannot be ' +
        'confirmed present on the target. Nothing was removed.',
    };
  }
  // `copied` or `updated`, EXACTLY — not `isOnTarget`, which is a different and
  // much weaker question. It admits `pending`, `skipped` and `deleted_source`,
  // none of which means bytes were ever written; ADR-0030 says written by us,
  // and this is the gate that has to mean it.
  if (arrival.status !== 'copied' && arrival.status !== 'updated') {
    return {
      ok: false,
      code: 'relocation_unconfirmed',
      reason:
        `The relocated copy is not one we can vouch for (status ${arrival.status ?? 'unknown'}). ` +
        'Removing this copy is only safe while the same bytes are on the target under the new ' +
        'key, WRITTEN BY THIS MIGRATION. Nothing was removed.',
    };
  }
  if (arrival.targetId && arrival.targetId === row.targetId) {
    // Both keys resolved to ONE object on the target. Some writers derive a
    // target id from something coarser than the natural key, and where they do,
    // "remove the old copy" and "the new copy" name the same bytes — so the
    // removal would take the survivor with it.
    return {
      ok: false,
      code: 'relocation_unconfirmed',
      reason:
        'The old copy and the relocated copy are the same object on the target, so removing ' +
        'one would remove both. Nothing was removed.',
    };
  }
  // An UNKNOWN hash is not a matching hash. Both sides default to `''` when a
  // row never recorded one, and `'' === ''` would sail through this gate on two
  // rows that say nothing about each other — on the one path that destroys a
  // copy. Detection cannot currently produce such a pair (it correlates only
  // rows that have a hash), which is exactly why this belongs here: the gate has
  // to hold on its own, for a caller that does not exist yet.
  if (!row.contentHash || !arrival.contentHash) {
    return {
      ok: false,
      code: 'relocation_unconfirmed',
      reason:
        'This item has no recorded content hash, so there is no way to confirm the relocated ' +
        'copy holds the same bytes. Nothing was removed.',
    };
  }
  if (arrival.contentHash !== row.contentHash) {
    return {
      ok: false,
      code: 'relocation_unconfirmed',
      reason:
        'The relocated copy no longer has the same content as this one, so removing this copy ' +
        'would lose something. The item was probably edited after it was moved. Nothing was ' +
        'removed.',
    };
  }

  // AMBIGUITY. The correlation that produced this relocation is a content-hash
  // match, and a content-hash match is not proof of a move — it is proof that
  // two files hold the same bytes. Where a THIRD item shares the hash, the pass
  // could have paired the wrong two: a folder briefly missing from a listing
  // makes a live file look disappeared, an unrelated arrival with identical
  // content explains it, and applying that removes the target's copy of a file
  // nobody touched. It is not exotic — every empty file in a Drive has the same
  // hash as every other.
  //
  // Detection is allowed to be optimistic; it only reports. This is the gate in
  // front of a removal, so here the answer is no.
  const sharing = (await ledger.placedItems(tenantId, mappingId, domain)).filter(
    (item) => item.contentHash === row.contentHash,
  );
  if (sharing.length > 2) {
    return {
      ok: false,
      code: 'relocation_unconfirmed',
      reason:
        `${sharing.length} items in this migration hold exactly these bytes, so which one moved ` +
        'is a guess — and removing the wrong copy takes a file nobody touched. This is what an ' +
        'empty file looks like, and what a duplicate looks like. Remove the old copy in the ' +
        'target system yourself if you are sure, then choose `keep`.',
    };
  }
  return undefined;
}

/**
 * Refuse everything while the deletion queue looks like an incident.
 *
 * Deliberately compares against what is actually ON the target for this domain
 * rather than a configured absolute: the same number of pending deletions is
 * routine in one mailbox and alarming in another.
 *
 * The denominator is `placedItems`, which — deliberately, for its OTHER
 * purpose of move-detection — keeps a `tombstoned` row (one already removed
 * by a previous `apply`) in the count rather than dropping it. That means the
 * corpus size used here only ever grows, never shrinks, as individual
 * deletions are legitimately carried out one at a time; the practical effect
 * is that the computed share is, if anything, an UNDERESTIMATE once a mapping
 * has some history of ordinary, one-by-one applies behind it. Accepted rather
 * than "fixed" by adding a new ledger query for one narrower count: the
 * evidence-and-ownership gates above are the load-bearing safety checks, this
 * breaker is a second layer against a sudden spike, and the one existing
 * corpus-size query already answers that question well enough not to justify
 * a new one.
 */
async function massDeletionCheck(
  deps: Omit<ApplyDeletionDeps, 'target'>,
): Promise<Extract<ApplyDeletionOutcome, { ok: false }> | undefined> {
  const { tenantId, mappingId, domain, ledger } = deps;

  const placed = await ledger.placedItems(tenantId, mappingId, domain);
  if (placed.length < MASS_DELETION_MIN_ITEMS) return undefined;

  const pending = (await ledger.listDeletions(tenantId, mappingId, domain)).filter(
    (d) => d.confirmed && d.acknowledgedAt === undefined,
  );
  const share = pending.length / placed.length;
  if (share <= MASS_DELETION_FRACTION) return undefined;

  const percent = Math.round(share * 100);
  return {
    ok: false,
    code: 'mass_deletion_suspected',
    reason:
      `${pending.length} of ${placed.length} migrated ${domain} items (${percent}%) are pending ` +
      'deletion, which is more likely to be a source problem — an outage, a restored account, a ' +
      'connector reading the wrong place — than an owner deleting that much on purpose. While ' +
      'that is true, no individual removal is trustworthy either, so all of them are refused. ' +
      'Check the source, let a pass run, and if the deletions are real, remove the items in the ' +
      'target system yourself.',
  };
}

/**
 * The same breaker for RELOCATIONS, which until now nothing measured.
 *
 * Every gate in front of `applyRelocation` reads one item. Each is satisfied by
 * a correlation that is locally perfect — the bytes really are on the target
 * under the new key — and none of them can see that the same thing just happened
 * to the entire corpus. So a whole migration could relocate at once and every
 * individual apply would sail through, truthfully reporting redundancy each time.
 *
 * WHAT THAT LOOKS LIKE WHEN IT IS WRONG, and it is not exotic: a connector
 * change that alters how paths are normalised gives every file a new natural
 * key, so every file "moves". Or a sync client on somebody's desktop renames
 * ten thousand files and they are about to restore from backup. Applying the
 * relocations removes the target's copies at the ORIGINAL paths — and restoring
 * the source does not undo it, because the old rows are tombstoned and
 * `classifyKnownItem` refuses to re-create a tombstone. The target is then
 * permanently missing the files at the paths that were correct, which is a loss
 * no later pass repairs.
 *
 * THE COST OF THIS GATE, said plainly because it is real: dragging one large
 * folder to another place in a path-keyed source relocates every file under it,
 * which is a legitimate thing to do and will trip this. The owner is not stuck —
 * the refusal says what to do — but they are made to do it in the target system
 * instead. That is the same trade ADR-0024 already accepts for a genuine mass
 * deletion, and it is accepted here for the same reason: at the moment the share
 * is that high, this code cannot tell the deliberate reorganisation from the
 * accident, and only one of those is recoverable.
 *
 * The threshold and the floor are shared with the deletion breaker deliberately.
 * Two numbers to tune would be two numbers to get wrong, and nothing about a
 * relocation makes 20% mean something different from what it means for a
 * deletion.
 */
async function massRelocationCheck(
  deps: Omit<ApplyDeletionDeps, 'target'>,
): Promise<Extract<ApplyDeletionOutcome, { ok: false }> | undefined> {
  const { tenantId, mappingId, domain, ledger } = deps;

  const placed = await ledger.placedItems(tenantId, mappingId, domain);
  if (placed.length < MASS_DELETION_MIN_ITEMS) return undefined;

  // RELOCATIONS only — a move that changed the natural key. A move recorded
  // with a collection alone cannot be applied at all, so counting it would let
  // a mail folder reorganisation refuse a file rename in the same mapping.
  const pending = (await ledger.listMoves(tenantId, mappingId, domain)).filter(
    (m) => m.toNaturalKeyHash !== undefined && m.acknowledgedAt === undefined,
  );
  const share = pending.length / placed.length;
  if (share <= MASS_DELETION_FRACTION) return undefined;

  const percent = Math.round(share * 100);
  return {
    ok: false,
    code: 'mass_relocation_suspected',
    reason:
      `${pending.length} of ${placed.length} migrated ${domain} items (${percent}%) are recorded ` +
      'as moved or renamed and still open. At that scale the correlation itself is in doubt — a ' +
      'change in how this connector reports paths gives every file a new key, and looks exactly ' +
      'like this. Removing the old copies is not undoable by a later pass, so all of them are ' +
      'refused while it is true. If the reorganisation is real, close these entries with `keep` ' +
      'and tidy the old copies in the target system yourself.',
  };
}
