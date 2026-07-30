# ADR-0024: `apply` — an explicit, gated exception to non-destructiveness

- **Status:** Accepted
- **Date:** 2026-07-30
- **Relates to:** ADR-0005 (idempotency via ledger, non-destructive by default), ADR-0020 (ledger as rebuildable cache). Arch doc §11.1, §11.2, §20.

## Context
Hard rule 2 and ADR-0005 say the target is never auto-deleted or overwritten, and that source deletions surface as user decisions rather than being propagated. That produced a **deletions queue** (§11.1): items the source no longer lists, evidenced as `reported` (the source's own removal report), `trashed` (found in the owner's bin) or `inferred` (repeated absence), reported at `GET /deletions` with a `keep` action that only ever acknowledges.

"Surfaced as a user decision" implied a second action alongside `keep` from the moment the queue existed — an owner who reviews a confirmed deletion and wants the target to match has had no way to say so except leaving this tool's scope entirely and deleting the item by hand in the target system. That gap was accepted as a placeholder ("Removing the target's copy is the first destructive operation this product would perform, and it needs its own path, its own confirmation and its own review") until this ADR.

## Decision
Add `apply`, reached only via an explicit, single-item operator call (`POST /mappings/{id}/deletions/{hash}/apply`, `applyDeletion` in `@openmig/core`). It is the **only** code path in the product that removes anything from a target. Hard rule 2's "never auto-delete" is preserved in full: nothing here is automatic, scheduled, or batched — an owner deciding about their own data is what §11.2 already reserved to them, and `apply` is that decision made real rather than a new exception to the rule.

Seven gates stand in front of every call, enforced in `applyDeletion` and re-checked in the ledger's own conditional `UPDATE`:

1. **Per-mapping opt-in.** Off unless `MappingConfig.allowApplyDeletions === true`. A destructive capability must be turned on, never turned off.
2. **Target capability.** The target writer must implement `TargetRemover` (`canRemove()`); one that does not refuses with `target_cannot_remove` rather than silently no-opping.
3. **Positive evidence only.** `reported` or `trashed` — never `inferred`. Absence has innocent causes that all look identical (a throttled listing, a permissions blip, a connector having a bad ten minutes), and acting on it would be the single worst outcome this feature could produce.
4. **Ownership.** Only `copied`/`updated` rows — items this tool actually wrote. An `adopted` row was on the target before the migration existed, and hard rule 2 forbids touching it regardless of what the source now says.
5. **No edit since.** The writer re-checks the recorded target ETag at the moment of removal (the same mechanism as the shadow-sync overwrite guard) and refuses with `edited_on_target` if it no longer matches.
6. **Mass-deletion circuit breaker.** If more than `MASS_DELETION_FRACTION` (20%) of a domain's migrated items — with at least `MASS_DELETION_MIN_ITEMS` (20) in the corpus — are confirmed-pending deletion at once, every `apply` call for that domain is refused (`mass_deletion_suspected`) until the share drops. The premise: that pattern is far more likely to be a source outage, a restored account or a misconfigured connector than genuine bulk owner intent, and once the evidence looks that wrong in bulk, no single item in the queue — including the one an operator is looking at — is trustworthy either.
7. **Ledger re-check.** The status/evidence conditions are re-verified inside the same conditional `UPDATE` that flips the row, so two concurrent `apply` calls cannot both succeed.

**Write order is remove-then-record.** A crash between the two leaves the ledger claiming an item is still on the target when it is not; §20 verification then reports it as `missingOnTarget` — loud, and correctable by hand. The reverse order (record then remove) would leave the ledger claiming an item gone while the copy still sits on the target, which nothing in the system would ever notice — the worse failure of the two, so the ordering is deliberate.

**Rows are never deleted, only tombstoned.** A successful `apply` sets `status = 'tombstoned'` (a value the schema's CHECK constraint has permitted since migration 0001 and that nothing had ever written) plus `deletion_applied_at`, and closes the queue entry the same way `keep` does. The row remains as the audit trail: this item existed, was migrated, and was removed on this date by this decision. `isOnTarget()` treats `tombstoned` as NOT on the target — the one status this product creates by destroying something.

**A reappearance is never re-copied.** If the source later lists the same natural key again — legitimate for `trashed` evidence, since an owner may `apply` a removal for an item the source still technically has — `classifyKnownItem` returns a `'tombstoned'` action ahead of every version rule, and the sync loop leaves the row exactly as it is, counting the event (`reappearedAfterRemoval`) rather than treating it as an ordinary "source changed, rewrite" case. The reasoning: this code cannot distinguish "the owner changed their mind" from "this was an erasure request, and restoring it is a compliance failure" — so the only answer that is never wrong in an unrecoverable way is to leave the tombstone standing and say so.

**Recoverability is reported, not assumed.** The outcome carries a `kind`: `binned` when the target's own removal goes to a recoverable place (a JMAP account's `\Trash`-role mailbox; a Nextcloud files DELETE, which lands in that account's trashbin), `deleted` when it does not (a plain WebDAV DELETE; calendar/contact removals always, since whether a given Nextcloud version retains a deleted calendar object is not something this code can determine from the outside — understating recoverability is the safe direction to be wrong in).

## Consequences
- The product now has exactly one destructive code path, and it is small, gated, and shaped so that every refusal is a sentence an operator can read as-is (`ApplyRefusal` is a closed set of stable string codes).
- Implemented for the CalDAV, CardDAV, WebDAV and JMAP target writers. The combined IMAP/DAV mail target does not implement `TargetRemover`; `apply` against it refuses with `target_cannot_remove` until that writer gains the capability.
- `DomainSyncResult`/`ReconcileResult` gain `reappearedAfterRemoval`, and `Ledger` gains `applyDeletion`, mirrored in both `PgLedger` and the in-memory test fake with the same evidence/ownership gates duplicated in SQL — consistent with every other ledger write in this codebase that has ever mattered for safety.
- Every other consequence of ADR-0005 stands unchanged: deletions are still never auto-propagated, the target still defaults to becoming a fuller archive than a shrinking source, and `apply` changes nothing about that for any mapping that has not explicitly opted in.

## Alternatives considered
- **Keep `keep` as the only action, forever.** Rejected — it was always the intended second half of "surfaced as a user decision" (§11.1's own words), and leaving an owner's only recourse as "go delete it by hand outside this tool" is a worse operator experience than a well-gated in-product action, not a safer one.
- **Bulk/batch apply.** Rejected for this slice. A batch action is easier to fire by accident and harder to reason about per-item; per-item calls, one at a time, keep the blast radius of any single mistake to one item. Revisit if operators need it for large cleanups, but only alongside stronger confirmation (e.g. requiring the caller to state an expected count).
- **Act on `inferred` evidence once confirmed (i.e., after `DELETION_CONFIRMATIONS` passes).** Rejected — absence is never strong enough on its own, however many times it repeats; more repetitions of a weak signal do not make it a strong one.
- **No mass-deletion breaker.** Rejected — the other six gates all reason about a single item in isolation, and none of them would catch a systemic misread (a wrong account, an outage) that made many items look deletable at once. The breaker is the one gate that reasons about the queue as a whole.
