# ADR-0024: `apply` — an explicit, gated exception to non-destructiveness

- **Status:** Accepted 2026-07-30; amended four times (2026-09-27, 2026-10-05, 2026-11-21, 2026-11-22)
- **Date:** 2026-07-30
- **Relates to:** ADR-0005 (idempotency via ledger, non-destructive by default), ADR-0020 (ledger as rebuildable cache). Arch doc §11.1, §11.2, §20.

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- `apply` is the **only destructive code path**: each item decided by itself, owner-called,
  never automatic. Relocations remove through `applyRelocation` beside it, behind the same gates
  (ADR-0030/0031). `packages/core/src/apply-deletion.ts` holds the only calls to `removeItem`.
- **Seven gates**, enforced by `applyDeletion`; evidence and ownership re-checked in the ledger's
  conditional UPDATE:
  (1) per-mapping opt-in; (2) `TargetRemover` capability; (3) **positive evidence only**,
  `reported`/`trashed`, never `inferred`; (4) ownership, `copied`/`updated` only, never
  `adopted`; (5) no edit since (DAV: the server's `If-Match`; JMAP contacts and files: a
  successful read; IMAP: UIDVALIDITY); (6) mass-deletion breaker, 20% of ≥20; (7)
  concurrent-apply re-check: `packages/core/src/apply-deletion.unit.test.ts`.
- **With no recorded version, nothing is removed** (`version_unknown`); a weak ETag counts as
  none. JMAP mail, which records no version by design, is exempt:
  `packages/engines/src/a-removal-the-server-checks.unit.test.ts`.
- **After cutover nothing is applied, by hand either** (2026-10-05): the four removing functions
  ask the item's data type's phase afresh and refuse `after_cutover`; no Apply is offered. A
  rollback re-admits what nobody answered (ADR-0047); a kept entry stays kept. Guard:
  `packages/core/src/an-apply-pressed-after-cutover.unit.test.ts`.
- **One owner action may apply many** (2026-11-21): offered only where a single delete is, one
  confirmation naming the count over a frozen set, then each row's own apply through the same
  call and all seven gates, the next only after an answer. Guard:
  `packages/core/src/a-delete-all-through-every-gate.unit.test.ts`.
- The breaker, `not_enabled`, `removed_not_recorded`, or a press not answered or not started
  **stops the whole run**; *Stop* or a closed page orders nothing more.
- **A deletion the owner kept is never applied** (2026-11-22): both deletion functions refuse
  `already_kept` before anything is sent to the target. A keep that lands while a removal is
  already under way cannot stop it; the removal is recorded as what it was. Guard:
  `packages/core/src/a-deletion-the-owner-kept.unit.test.ts`.
- Order is **remove-then-record**; rows are tombstoned, never deleted; a deleted item's
  reappearance is **never re-copied** (a relocated one's is: ADR-0030) (`packages/core/src/tombstone-not-restored.unit.test.ts`); outcomes state
  `kind: binned|deleted`, understating recoverability.

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
- **Implemented for every target this product has** — CalDAV, CardDAV, WebDAV, JMAP and IMAP/DAV. That is the whole list: `parseTarget` accepts `jmap`, `imap-dav`, `caldav`, `carddav` and `webdav` and rejects everything else. Microsoft Graph is a **source** family only (calendar, contacts, drive), because this product migrates off Microsoft 365 rather than onto it, and Graph is a Microsoft-proprietary API no other vendor implements. Earlier revisions of this ADR and of the runbook said "the Graph target writer does not implement removal", which described a writer that has never existed.
- **`removeItem` takes the ledger row's `collection`,** because not every target id is globally unique. A JMAP Email id and a DAV href identify an object on their own and those writers ignore it; an IMAP UID is mailbox-scoped, so `ImapDavMailTarget` requires it and REFUSES rather than guessing when it is absent — a guessed mailbox would remove a different message under the same number. Rows written before the `collection` column was populated therefore cannot be applied against that target, which is the correct failure.
- **Gate 5 means UIDVALIDITY on IMAP, not an ETag.** An IMAP message cannot be edited in place (RFC 3501 has no such command; a client that "edits" one appends and deletes, producing a new UID), so the thing that invalidates our handle is the MAILBOX being recreated — which resets UIDVALIDITY and re-issues every UID. `ImapDavMailTarget` records the mailbox UIDVALIDITY as `targetVersion` on write and refuses the removal outright if it has changed. That is a thrown error rather than `conflicted: true`, because `conflicted` tells an operator "somebody edited your copy", which here would be a specific and false explanation.
- `DomainSyncResult`/`ReconcileResult` gain `reappearedAfterRemoval`, and `Ledger` gains `applyDeletion`, mirrored in both `PgLedger` and the in-memory test fake with the same evidence/ownership gates duplicated in SQL — consistent with every other ledger write in this codebase that has ever mattered for safety.
- Every other consequence of ADR-0005 stands unchanged: deletions are still never auto-propagated, the target still defaults to becoming a fuller archive than a shrinking source, and `apply` changes nothing about that for any mapping that has not explicitly opted in.

## Alternatives considered
- **Keep `keep` as the only action, forever.** Rejected — it was always the intended second half of "surfaced as a user decision" (§11.1's own words), and leaving an owner's only recourse as "go delete it by hand outside this tool" is a worse operator experience than a well-gated in-product action, not a safer one.
- **Bulk/batch apply.** Rejected for this slice. A batch action is easier to fire by accident and harder to reason about per-item; per-item calls, one at a time, keep the blast radius of any single mistake to one item. Revisit if operators need it for large cleanups, but only alongside stronger confirmation (e.g. requiring the caller to state an expected count).
- **Act on `inferred` evidence once confirmed (i.e., after `DELETION_CONFIRMATIONS` passes).** Rejected — absence is never strong enough on its own, however many times it repeats; more repetitions of a weak signal do not make it a strong one.
- **No mass-deletion breaker.** Rejected — the other six gates all reason about a single item in isolation, and none of them would catch a systemic misread (a wrong account, an outage) that made many items look deletable at once. The breaker is the one gate that reasons about the queue as a whole.

## Amendment, 2026-09-27: the server checks the version, and without one nothing is removed

Workplan 0149 T3, from the owner's D1: *apply deletions* is offered to testers, so removal has
to fail closed. Gate 5 did not, in two ways.

- **The check had a gap.** The writer HEADed the copy, compared ETags, and then sent the DELETE
  as a separate request; an edit that landed between the two was removed. A HEAD that failed
  meant "proceed". The DELETE now carries `If-Match` with the recorded version, so the server
  decides in the request itself. A 412 is read with one HEAD: gone is already removed, present
  is `edited_on_target`, and a HEAD that cannot say throws with nothing removed. The rewrite PUT
  carries the same condition, and a 412 there is a conflict, counted and left alone.
- **No version meant no check.** A row written before versions existed, from a server that
  returns no ETag on PUT, or recorded `copied` after a 412 on create (0149 T1), was removed with
  nothing compared. Such a removal now sends nothing: the writer answers `unversioned`, and core
  refuses with a new code, `version_unknown` (the closed set above gains one). A weak ETag counts
  as none, because `If-Match` compares strongly and could never match; the writers record a weak
  one with its `W/` so they can tell (D4).

On JMAP contacts and files there is no condition for one object on `/set`, so the read and the
destroy stay two calls, and what changes is that a read that fails refuses instead of proceeding.
On IMAP a row without UIDVALIDITY is refused the same way. JMAP mail is unchanged: it records no
version, because JMAP gives no per-message ETag and a message is immutable apart from its flags.

A **rewrite** without a version still goes ahead, as the owner kept it (0149 D3): refusing would
stop source changes from reaching every such row. What changed for rewrites is how the check is
made, not which rows are rewritten.

## Amendment, 2026-10-05: after cutover nothing is applied, by hand either

After cutover the old system no longer decides what exists (workplan 0117 D4, 2026-09-09:
*"after cutover the source is no longer the authority on what exists, so we will not delete in
target based on changes in the source"*), and no pass draws a deletion or a move from it any
more. But the Deletions and Moves queues keep what was recorded before the cutover, or by a pass
still running when it was executed, and `apply` on one of those removed the copy on the target by
the rules from before: none of `evaluateApplyDeletion`, `applyDeletion`,
`evaluateApplyRelocation` and `applyRelocation` asked the phase, and the button showed regardless,
after Finish too. Asked on 2026-10-05 *"should pressing Apply on a deletion or move that was
queued before cutover be refused?"*, the owner chose **"Refuse after cutover (Recommended)"**.

So `ApplyDeletionDeps` carries a REQUIRED `stillTheAuthority`, the data type's phase read afresh
from `readPathPhases` through `sourceStillDecides` each time it is asked, and each of the four
asks it once the item is found (an item already removed still answers `already_applied`) and
before any evidence or relocation gate, refusing with the stable code `after_cutover` and a
reason that says nothing was removed. The managed route asks it on the request and the job asks
it again at the removal; the appliance hands its reader to `applyMappingDeletion` and
`applyMappingRelocation`. Both editions' queues carry `afterCutover` (`dataTypesPastCutover`),
and `mayOfferApply` and `mayOfferRelocationApply` take it as a required argument: no button for
a data type past its cutover, and one sentence above the rows saying why. A rollback makes the
old system the authority again (ADR-0047) and re-admits the same press.

## Amendment, 2026-11-21: per item reads as each item decided by itself

Workplan 0164 T0 (b), decided by the owner on 2026-11-21 as advised: *bulk apply yes, with one
confirmation and every gate kept*. The owner wants the old and the new system kept in step during
a migration, and a removal on *Deleted on the old system* took one press per item. So "per item"
reads as **each item decided by itself**: one owner action may apply many, and each item goes
through all seven gates by itself, through the code path a single press uses. The Decision's
"nothing here is automatic, scheduled, or batched" reads the same way: a press for many is many
single presses, one after another. As built after the pull request's two reviews (2026-11-22):

- **The press.** *Delete all of these here too*, on the Deletions page, is offered only where a
  single *Delete it here too* is: deleting by hand on, rows that `mayOfferApply` offers (positive
  evidence, not past their data type's cutover), two at least.
- **The confirmation, and how it relates to "the caller states an expected count".** The rejected
  alternative above asked, before bulk apply was revisited, for stronger confirmation, "e.g.
  requiring the caller to state an expected count". T0 (b) asked for one confirmation that names
  how many. Here the person states the count by confirming it. The button opens a confirmation
  of its own, over the rows as they were when it opened (the set is frozen then), which names
  their number. A double click cannot pass it: its *Cancel* comes first and takes the focus, and
  its *Delete N* ignores the second click of a double click and any click within 800 ms of
  opening. The focus stays in it until it closes, and Escape closes it from anywhere in it.
  Nothing is ordered unless the page's rows at that press, and the list read again from the
  server, are both the frozen set. From that press on, no row of the run has a button of its
  own, the reading of the list included, so nothing is kept or pressed on it beside the run. So what is ordered is never more than the rows the
  person counted. The check is the page's: the server is told no count. It sees single presses,
  each through every gate.
- **The same path.** The page presses each row's own apply (`applyEachInTurn` in
  `@openmig/shared`, `DeleteAllPanel` in the web app): the same request, the same route, the same
  `evaluateApplyDeletion` and `applyDeletion`, and on managed the same receipt, audit row
  (`apply_deletion.ordered`, with the person who pressed) and job per item. No route was added,
  and nothing on the server can tell a row of a run from one pressed by hand.
- **The next only once one has answered.** The appliance's answer, or a managed receipt read to
  `applied`, `refused` or `failed` within five minutes, is read before the next row is pressed.
  A press that did not answer stops the run, with its row *not known*. That covers a fault, a
  time-out, a receipt that failed (its job may be tried again) or did not land, and any answer
  that is not a gate's refusal (a 403 or 404 with a refusal code, or the 500
  `removed_not_recorded`). Its removal may still be running, and a next press beside it could
  pass a refusal it never got to say. A press the server started nothing for (a 409 hold or
  closed account, or the 502 that could not queue the removal) is known not to be deleted, and
  stops the run too, as the next press would meet the same. So a run has one removal at a time
  under way for its migration, as a person pressing would. It does not wait for a single press
  still under way, for another migration's run on the same page (each migration's breaker
  counts by itself), or for a run on another page or by another person.
- **A refusal that speaks for every item stops the run.** Gate 6 refuses every apply while the
  queue looks like a source problem, because no single item in it is trustworthy then. What it
  suspects, a restored account, an outage or the wrong place read, is the whole account's. So
  once an item of a run is refused as a mass deletion, on the request or on its receipt, no
  later item of any data type is ordered in that run, even if the share has dropped by the time
  it is reached. Deleting by hand turned off (`not_enabled`) stops it the same way. So does
  `removed_not_recorded`, the one answer that proves the ledger changed under a removal (a pass
  saw the item back, or another tab removed it first): when the owner restores a folder at the
  source mid-run, its next items are still reported until the pass reaches them, and a run that
  went on would remove them. A press made afterwards, by hand or in a new run, is decided
  afresh.
- **Every other refusal is that item's answer**, said with its reason, and the next item is
  ordered. That includes `already_kept`: a row somebody kept during the run, in another tab or
  by another person, is refused if the keep was recorded before its removal began (*Amendment,
  2026-11-22*).
- **Afterwards** the page says what was deleted, what was not, and what is not known, with each
  reason, in English and Dutch: a sentence per refusal code in the reader's language, the
  server's own words and code beside it, verbatim.
- **Still never by itself.** Hard rule 2 stands: nothing is removed without a person's press, and
  removal by itself (workplan 0164 §4.3, T4) stays parked. A run orders nothing more once the
  person presses *Stop*, offered from the reading of the list on, or the page closes; what was
  ordered finishes where it runs.

## Amendment, 2026-11-22: a deletion the owner kept is never applied

On *Deleted on the old system*, `keep` and `apply` are the two answers to one question, and
nothing on the deletion path read the first. `applyDeletion` and `evaluateApplyDeletion` never
looked at `deletion_acknowledged_at`, and the ledger's conditional UPDATE did not either, so a
press on a row somebody had kept removed the copy, and the write closed the row again as
applied: it then said *deleted on the new system too*, and nothing was left of the keep. The
page offers no button on a kept row. What reached one was a page read before the keep (another
tab, another person), a call to the API, and on managed a removal still waiting for its job
while somebody kept the copy. It was found in the review of workplan 0164 T3, the press for all
rows, where a keep pressed in another tab during a run was removed when the run reached it; it
held for a single press as well, so it is fixed on its own. It is the correction ADR-0030 made
for a move on 2026-08-15 (*`keep` was enforced by a button*), made for a deletion.

- **Core refuses it, in both functions, at the same point.** After `already_applied`, because a
  removal's own write sets `deletion_acknowledged_at` beside `deletion_applied_at` and a second
  press on a removed row must still say it is removed; after the phase, as `already_kept` comes
  after it for a move (a kept row past its cutover says `after_cutover`); before the evidence
  gate and the removal, so nothing is sent to the target. The code is `already_kept`, already in
  the closed set, with its own reason. The managed job asks `applyDeletion` again at the removal,
  so a keep recorded while the job waited wins there too, and the receipt says `refused
  already_kept`.
- **A keep that lands while a removal is already under way cannot stop it.** The copy is removed
  before the row is recorded, so such a keep is too late for that removal, and the ledger records
  the removal as what it was: tombstoned and applied. `PgLedger.applyDeletion` (and `MemoryLedger`)
  writes `deletion_acknowledged_at` as `COALESCE(deletion_acknowledged_at, now())`, so the keep's
  own time stays on the row.
- **Not forever, for the rows `clearAbsent` clears.** It clears the acknowledgement when an item
  with a recorded absence or deletion is seen on the old system again, so such an item that comes
  back and is deleted again is asked afresh. Known and older than this amendment: a keep given in
  the earlier-exports queue (workplan 0042 T8 (b)) is not cleared by `clearEarlierExport`, so a
  later deletion of that item arrives already kept; that queue already files it as decided and
  never offers it. Whether `clearEarlierExport` should clear it is a follow-up in workplan 0164.
- **The `after_cutover` reason says what holds.** It advised *keep* to clear the entry and said a
  rollback lets the old system decide again. A keep is final, for a deletion now as for a move
  since 2026-08-15, so the reason says a kept entry stays kept and a rollback admits the press
  again only while nobody has answered it.

No route changed: both editions answer the refusal as they answer the others (403, the code and
the reason), and the screens show the reason as served.

## Amendment log

- **2026-11-22** — A deletion the owner kept is never applied: `already_kept` in
  `evaluateApplyDeletion` and `applyDeletion`, and the `after_cutover` reason no longer says a
  rollback re-opens a kept entry. The change follows the review finding on workplan 0164 T3.
  Record: *Amendment, 2026-11-22: a deletion the owner kept is never applied*.

- **2026-11-21** — Per item reads as each item decided by itself: one owner action may apply many,
  each through all seven gates, after one confirmation over a frozen set, the next only once one
  has answered; a breaker refusal, `not_enabled`, `removed_not_recorded`, or a press that did not
  answer or started nothing stops the run (workplan 0164 T0 (b), T3). Record: *Amendment, 2026-11-21: per item reads as each item decided
  by itself*.

- **2026-10-05** — After cutover nothing is applied, by hand either: `after_cutover`, and no Apply
  offered (the owner's "Refuse after cutover (Recommended)"). Record: *Amendment, 2026-10-05: after
  cutover nothing is applied, by hand either*.

- **2026-09-27** — The server checks the version on removal and rewrite, and without a recorded
  version nothing is removed (workplan 0149 T3). Record: *Amendment, 2026-09-27: the server checks
  the version, and without one nothing is removed*.
- **2026-10-03** — Operative rules cut to the [ADR-0051](./0051-an-adr-reads-as-it-stands.md) budget; nothing was
  decided. Their earlier wording, with the reasons and examples the budget left out, is in the
  record: [history/0024-explicit-owner-deletion-apply.md](./history/0024-explicit-owner-deletion-apply.md).
