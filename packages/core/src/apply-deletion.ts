// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Removing the target's copy of an item the owner deleted on the source.
 *
 * THE ONLY DESTRUCTIVE OPERATION IN THIS PRODUCT. Everything else reports:
 * failures, moves and deletions all go into queues that change nothing on either
 * side. This one takes something away, and it is worth being explicit about why it
 * is allowed to exist at all.
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
 * 6. **This does not look like a mass-deletion event.** See
 *    `MASS_DELETION_FRACTION`. The gate is about the EVIDENCE being wrong in
 *    bulk, not about an operator clicking too fast.
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
  canRemove,
  isOnTarget,
  log,
  type Ledger,
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
  | 'mass_deletion_suspected';

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
        'the account owner\'s, not ours to delete (hard rule 2). Remove it yourself if you want ' +
        'it gone, then choose `keep`.',
    };
  }

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
        'the account owner\'s, not ours to delete (hard rule 2). Remove it yourself if you want ' +
        'it gone, then choose `keep`.',
    };
  }

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
      code: 'not_found',
      reason:
        'The copy was removed from the target, but the ledger could not record it. Verification ' +
        'will report this item as missing on the target until that is reconciled.',
    };
  }

  log.warn(
    `[apply] ${domain}: removed the target copy of item ${naturalKeyHash.slice(0, 12)} ` +
      `(${removal.kind}), on ${evidence} evidence, by an explicit owner decision.`,
  );
  return { ok: true, kind: removal.kind };
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
