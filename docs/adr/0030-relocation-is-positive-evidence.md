# ADR-0030: A correlated relocation is positive evidence, and may be applied

- **Status:** Accepted 2026-08-15 (owner) and built the same day; amended 7 times (latest 2026-09-28); consolidated 2026-10-03 (ADR-0051)
- **Date:** 2026-08-15; consolidated 2026-10-03
- **Deciders:** owner
- **Relates to:** [ADR-0024](./0024-explicit-owner-deletion-apply.md) (`apply` and its seven gates), [ADR-0031](./0031-auto-apply-relocations.md) (unattended apply), [ADR-0005](./0005-idempotency-ledger-nondestructive.md), [ADR-0020](./0020-ledger-rebuildable-cache-recovery.md); arch doc §11.1; workplans [0042](../workplans/0042-google-drive-source.md) T2 and T10, [0150](../workplans/0150-dropbox-native-formats-and-the-downloads-that-will-not-hand-themselves-over.md) D8
- **History:** the record as it read before consolidation, word for word — [history/0030-relocation-is-positive-evidence.md](./history/0030-relocation-is-positive-evidence.md)

## Operative rules

<!-- What holds NOW, within the ADR-0051 budget that scripts/adr-operative.mjs enforces.
     Amend in place when a later decision changes it, then regenerate OPERATIVE.md:
     node scripts/adr-operative.mjs --write -->

- A **relocation** (a disappeared item paired, by **content hash**, with an arrival of the same pass under a new natural key) is **positive evidence**: `apply` may remove the **old** copy. Recorded by key (`movedToNaturalKeyHash`), so a move and a rename are one event, never a phantom deletion (`move-detection.unit.test.ts`).
- **Every ADR-0024 gate stands**, behind the same `allowApplyDeletions` switch. Gate 3 becomes `relocationCheck`: the arrival is **ours** (`copied`/`updated`, never `adopted`), holds the **same `contentHash`**, is another key and target object, and **no third item shares the hash**; else `relocation_unconfirmed` (`apply-relocation.unit.test.ts`).
- **The target is asked** (`hasItem`, for the arrival) immediately before removal. An error is not absence; a target that cannot be asked refuses (`target_cannot_confirm`). Port: `TargetPresenceCheck` (`ports.ts`).
- **Gate 6 has two halves** on one threshold: pending deletions, and open relocations (`mass_relocation_suspected`). **Gate 7's** `UPDATE` re-checks the arrival and `keep` in the same statement; `keep` and `apply` exclude each other (`already_kept`). Held by `ledger.integration.test.ts`.
- A renamed or moved **exported document** (Google Doc, Sheet, Slides deck or Drawing; Dropbox Paper doc) is paired by its **Drive or Dropbox id**: a bytes pair where both copies' bytes match, else `moved_by_identity`, whose `apply` asks for the **same id** (`source_ref`) in place of the bytes checks (owner, 2026-09-23; 0150 D8; `a-rename-the-bytes-could-not-pair.unit.test.ts`).
- Both editions serve a manual apply: the appliance answers once the old copy is gone; the managed edition queues `run-apply-relocation` and answers on a `relocation` receipt. Unattended apply is ADR-0031's and leaves identity pairs for a person (`paired_by_identity`). Held by `apply-routes.integration.test.ts`.

## Context

**A file moved or renamed on a path-keyed source left a copy on the target that this product
would not remove, and gave the owner no way to remove it** — verified in
`move-detection.unit.test.ts`, not reasoned about. The file domain keys items by normalized path
(§10), so every reorganisation changes the natural key:

| what the owner did | what the pass reported | what the owner could do |
|---|---|---|
| moved `a/report.pdf` → `b/report.pdf` | a **move**, correlated by content hash | `keep`. Nothing else existed. |
| renamed `a/report.pdf` → `a/summary.pdf` | nothing; after `DELETION_CONFIRMATIONS` clean passes, an **inferred deletion** | `keep`, or `apply`, which refuses: ADR-0024 gate 3 bars `inferred` evidence |

Either way the target kept both copies, permanently, and a rename ended as a reported deletion
of a file that was never deleted. The rename was missed because correlation required the
arrival to be in a **different collection**. Relaxing only that would render "moved from `a` to
`a`", because `movedToCollection` cannot say that the NAME changed.

It matters because the owner's requirement for the first Google Drive customer is a target
nobody works in that follows the source, **including moves**, and dragging files between
folders is what Drive is for.

A document a provider exports has a second problem: no bytes of its own. Two Office or
OpenDocument exports of an unchanged Google document are not byte-identical (measured, workplan
0042 T3), so a renamed one was never paired: two clean passes later it was reported **deleted in
Google** while both copies stayed (0042 T10). Nothing promises that two exports of a Dropbox
Paper doc match either.

## Decision

A **relocation**, an item gone from one natural key and paired with an arrival under another, is
a distinct, **positive** evidence class, and `apply` may remove the target's **old** copy. That
is categorically safer than applying a deletion. A deletion destroys the last copy under this
product's control; a relocation's old copy is redundant **once the new one is confirmed on the
target, at the moment of acting**. Detection may be optimistic, because it only reports. The
gates in front of a removal may not.

### 1. Recorded by key, paired by bytes

- **Recorded by natural key**, not by collection: `item.moved_to_natural_key_hash` (migration
  0009) beside `moved_to_collection`, carried as `ItemMove.toNaturalKeyHash`. A cross-folder move
  and a rename in place are one event. A move that keeps its key (every mail, calendar and
  contacts move) is never a relocation: it is reported, `keep` is its only answer, and `apply`
  refuses it (`not_relocated`).
- **`detectPathKeyedMoves` pairs a disappeared row with an arrival created in the same pass that
  carries the same `contentHash`, in any collection.** Only an item the pass created is an
  arrival (`createdThisPass` leaves out adopted and rewritten ones), and an arrival is consumed:
  it explains one disappearance, never several. A row with no hash is never paired, a row whose
  copy was already removed takes no part, and a row whose move is recorded is remembered, not
  paired again.
- **A relocated row is not counted absent.** The owner sees one relocation, on the pass it
  happened.
- Pairing cannot tell a rename from a copy and a delete, and need not: the removal rests on the
  new copy. It can pair the wrong two files, which is what the ambiguity check in gate 3 is for.

### 2. Paired by id: a document a provider exports

A Google document (a Doc, Sheet, Slides deck or Drawing, copied as a Drive export) carries its
**Drive file id** as `FileItem.sourceIdentity`; a Dropbox Paper doc, copied as a Markdown or HTML
export, carries its **Dropbox id**. A rename changes neither.

- **The id pairs first.** A disappeared row whose recorded `source_ref` is an id this pass lists
  under another name, with a copy recorded on the target, is paired with that name. It asks what
  is listed now, so a rename the pass did not see (one already reported as deleted, or one whose
  new name failed its first copy) is paired too, and the absence the old name ran up is cleared
  with any deletion reported from it. A name with no copy pairs nothing yet. The pairing is not
  consumed: an id names one document, and every old name it left is an old copy of it.
- **A bytes pair where the bytes repeat** (PDF and SVG exports do); otherwise the move is
  recorded with `moved_by_identity = true` (migration 0058).
- Such an arrival stays out of the bytes index, so one export's bytes never pair it with another
  file's old name. An earlier export of the same document (a format switch, 0042 T8 (b)) carries
  its own mark and is never paired.

### 3. The gates, in the order `applyRelocation` runs them

`applyRelocation` sits beside `applyDeletion` in `apply-deletion.ts` on purpose, so the
destructive path is one place to read. Every refusal is a sentence an operator can act on.

- **Gate 1, opt-in:** the mapping's `allowApplyDeletions`. One switch for one capability; a
  second would refuse the safer operation to an owner who opted into the more dangerous one.
- **Gate 2, capability:** the target implements `TargetRemover`.
- **Gate 3, the relocation in place of deletion evidence** (`relocationCheck`). A move answered
  with `keep` is refused (`already_kept`: the copy is there on purpose, where `already_applied`
  says it is gone); a row with no relocation is `not_relocated`. Otherwise it is
  `relocation_unconfirmed` unless:
  - the arrival exists under another key and is **written by us**: `copied` or `updated`
    exactly. Not `adopted`, whose bytes are the account owner's, and not the other statuses
    `isOnTarget` admits (`pending`, `skipped`, `deleted_source`), which never wrote bytes;
  - it is a different object on the target, since a shared `targetId` would take the survivor
    with the removal;
  - for **a bytes pair**, both hashes are recorded and equal, and **no third item in the
    migration shares the hash**. A folder briefly missing from a listing can make a live file look
    gone and an unrelated arrival explain it, and every empty file shares one hash;
  - for **an identity pair**, the arrival carries the same `source_ref`. There is no hash to
    compare and nothing to be ambiguous: an id names one document.
- **Gate 4, ownership** of the old copy: `copied`/`updated`.
- **Gate 6, two halves**, on ADR-0024's threshold and floor (over `MASS_DELETION_FRACTION`, 20%,
  of at least `MASS_DELETION_MIN_ITEMS`, 20): pending deletions (`mass_deletion_suspected`), and
  open relocations (`mass_relocation_suspected`). Every other gate reads one row, and each is
  satisfied by a locally perfect correlation; none can see a whole corpus relocate at once, which
  is what a connector change in how paths are normalised, or a misbehaving desktop sync client,
  looks like. A collection-only move is not counted.
- **The target is asked**, last: `TargetPresenceCheck.hasItem` on the arrival. **A ledger row is
  a claim**: ADR-0024 removes, then records, so a failure between the two leaves a row saying
  `copied` for a copy already gone. `WebDAVTargetWriter` asks with a HEAD and `JmapFileTarget`
  with a one-id `FileNode/get`; both throw when the server cannot say, because a 503 is not
  absence. Absent is `relocation_unconfirmed`. A target without the check refuses
  (`target_cannot_confirm`): the argument is presence, and an unanswerable question is not a yes.
- **Gate 5, no edit since**, inside the removal: `edited_on_target`, or `version_unknown` where
  no version was recorded.
- **Gate 7, the ledger's conditional `UPDATE`** (`Ledger.applyRelocation`), written after the
  removal: the row still holds a relocation, is not applied, is `copied`/`updated` and is **not
  kept** (`move_acknowledged_at IS NULL`: of two answers at once, the first write wins). An
  `EXISTS` **re-checks the arrival in the same statement** (another key, `copied`/`updated`, the
  same non-empty hash or, for an identity pair, the same non-empty `source_ref`), so a concurrent
  apply on the arrival cannot take both copies. It tombstones the row and closes any deletion
  entry the row carried. `ledger.integration.test.ts` runs it against Postgres; its
  `moved_to_natural_key_hash IS NOT NULL` clause is implied by the `EXISTS` and commented as
  known-redundant.

### 4. Who presses it

- **Both editions serve a manual apply.** The appliance's `POST /mappings/{id}/moves/{hash}/apply`
  (`applyMappingRelocation`) answers once the old copy is removed. The managed route answers
  every ledger-side gate on the request (`evaluateApplyRelocation`, held to `applyRelocation` by
  `apply-deletion-evaluate.unit.test.ts`), then queues `run-apply-relocation`, which re-runs every
  gate, asks the target, and lands the outcome on the relocation's own receipt
  (`apply_receipt.action`, migration 0010). One item can sit in both destructive queues, and a
  poller is answered about the question it asked.
- The Moves screen offers the destructive button only where `mayOfferRelocationApply` allows (a
  relocation, still open), arms before it acts, and polls the managed receipt. It decides what is
  shown; the server decides what happens.
- **Unattended apply is [ADR-0031](./0031-auto-apply-relocations.md)'s**, behind four further
  gates. It leaves an identity pair for a person (`paired_by_identity`), because its argument is
  that the bytes are the proof when nobody is looking.

## Consequences

- **The target can converge.** An owner whose source was reorganised can make the target match
  without leaving this product. `apply` stays the only destructive path; this widens what may
  enter it, on an argument that is specific and checkable.
- **A deliberate large reorganisation trips the breaker.** Dragging one large folder relocates
  every file under it. The refusal says what to do: close the entries with `keep`, which clears
  the count, and tidy the old copies in the target system. It is the trade ADR-0024 accepts for a
  mass deletion: at that share this code cannot tell a reorganisation from an accident.
- **`keep` is final here.** An owner who changes their mind removes the old copy in the target
  system; nothing in this product re-opens a carried-out decision.
- **A duplicate may be reported as a relocation.** A copy and a deletion of the original in one
  pass look like a rename, and the outcome is the same. The report must not claim to know which
  happened.
- **One item can sit in both queues.** If an arrival is missed once (a listing not fully
  enumerated), the old row can bank an absence before it is paired by bytes, leaving an open
  deletion beside an open relocation. Left so: the deletion is `inferred` and refuses, the
  relocation is gated, and the worst case is one question asked twice. An identity pair clears
  that absence (§2); an applied relocation closes the deletion entry (gate 7).
- **A relocation's tombstone is not an erasure.** If the source lists the old key again,
  `classifyKnownItem` returns `relocated-away` and the item is copied again; an applied
  deletion's tombstone is never re-created (`move-detection.unit.test.ts`, "the old path after an
  applied relocation").
- **Schema:** `item.moved_to_natural_key_hash` (0009), `apply_receipt.action` (0010) and
  `item.moved_by_identity` (0058), all additive.

## Alternatives considered

- **Leave it as it is.** Defensible while every source was DAV and reorganisation was rare;
  indefensible for Drive. It also left a rename reporting a deletion of a file that still exists,
  which is worse than silence.
- **Relax the collection filter only (the "one-liner").** It detects the rename, records
  `movedToCollection = a` for a file still in `a`, and renders "moved from a to a": no
  convergence, and a queue entry that reads as a bug.
- **Report relocations as `reported` deletions.** It would reuse `apply` untouched, and it is a
  lie: nothing reported anything, and the class that means "the source told us" must keep meaning
  that, or gate 3 stops being readable.
- **Key files by an opaque source id instead of the path.** Moves and renames would become
  invisible. Rejected under ADR-0020 and in workplan 0042 T2: a content hash is recoverable from
  the target, and a Drive `fileId` never is. The id that pairs an exported document (§2) only
  pairs; the key stays the path.
- **Have the sync loop move the target copy.** Closer to what the owner did, but every target
  writer would need a move or rename most do not have (a JMAP `Email/set` move is not a file
  rename; plain DAV servers vary on `MOVE`), and the loop itself would become destructive, which
  hard rule 2 forbids and ADR-0024 keeps behind an explicit owner action.
- **Trust the pairing.** This ADR first argued that safety "does not depend on telling a rename
  from a copy". That holds only when the pairing is right; where a third item shares the hash it
  is a guess, so an ambiguous pairing is refused.
- **Trust the ledger's row as proof that the new copy is there.** The row is a claim, so the
  owner's answer (2026-08-15) was to ask the target.
- **Count collection-only moves in the relocation breaker.** They cannot be applied, and counting
  them would let a mail reorganisation refuse a file rename.
- **Clear the absence run whenever a relocation is recorded.** `clearAbsent` wipes
  `deletionReportedAt`/`deletionTrashedAt` with the count, by design, for "the item is back".
  Silently discarding a source's own deletion report is a bigger change to the destructive path
  than the duplicate entry it would tidy. An identity pair does clear it: the same id is listed
  under its new name.
- **One receipt per item for both destructive actions.** One item can be in both queues
  (renamed, then the new name deleted), so the receipt says which action it records and
  join-don't-stack is scoped to the action.
- **Pair an exported document by its bytes, like every other file.** Its exports differ, so a
  rename was never paired.
- **Let unattended apply take identity pairs.** Its safety rests on the bytes being the proof
  when nobody is looking, and an identity pair has no such proof.
- **Auto-apply as part of this decision.** "The bytes are demonstrably elsewhere" makes a single
  reviewed apply safe; it does not by itself make an unattended loop safe. Decided separately,
  with its own failure analysis, in ADR-0031.

## Amendment log

- **2026-08-15** — Accepted by the owner and built the same day: recorded by key, paired on the
  key, `apply` behind the arrival gate (workplan 0042 T2). Record: *Decision* and *What was
  built, 2026-08-15*.
- **2026-08-15** — A same-day audit (five readers, each finding attacked) confirmed 19 defects.
  Three showed the gates weaker than this ADR's argument: the arrival gate admitted statuses that
  never wrote bytes, gate 7 could not see the arrival, and an ambiguous pairing was accepted.
  Also fixed: a relocation to its own key, an arrival sharing the old copy's `targetId`, a
  tombstoned row competing for arrivals, and a deletion entry left open on a tombstoned row.
  Record: *Amendment, 2026-08-15 (same day): the gates were weaker than this document said*.
- **2026-08-15** — The owner's answer: the target is asked before anything is removed, and a
  target that cannot be asked refuses. Record: *The owner's answer, 2026-08-15: ask the target*.
- **2026-08-15** — Gate 6 gained its relocation half. Record: *The gate that saw only one item at
  a time, 2026-08-15*.
- **2026-08-15** — `keep` enforced by the server (`already_kept`, and in gate 7's statement),
  where only a button had held it; the statement first run against Postgres. Record: *`keep` was
  enforced by a button, 2026-08-15*.
- **2026-08-15** — A fourth audit's one verified claim (no test kills the
  `moved_to_natural_key_hash IS NOT NULL` clause) was refuted as an equivalent mutant; the clause
  is commented as known-redundant. No change to the decision. Record: *The fourth audit,
  2026-08-15: one claim, refuted*.
- **2026-08-16** — Built: the managed route, `run-apply-relocation`, the receipt's `action`
  (migration 0010), and apply on the Moves screen in both editions (workplan 0042 T2). Record:
  the "Built, 2026-08-16" note under *What was built, 2026-08-15*.
- **2026-09-23** — Correction: the operative rule added on 2026-08-19 (ADR-0038) said manual
  relocation apply was appliance-only; both editions have served it since 2026-08-16. Record:
  the last bullet of the history file's *Operative rules*.
- **2026-09-23** — The owner: a renamed Google document is paired by its Drive id, and `apply`
  may remove its old copy; unattended apply leaves such pairs for a person (workplan 0042 T10,
  migration 0058). Record: *Amendment, 2026-09-23: a renamed Google document is paired by its
  Drive id*.
- **2026-09-28** — A Dropbox Paper doc, now copied as an export, is paired by its Dropbox id the
  same way (workplan 0150 D8, T3 and T4). Record: *2026-09-28: a Dropbox Paper doc is paired by
  its Dropbox id (workplan 0150 D8)*.
- **2026-10-03** — Consolidated in place (ADR-0051). One reason was restated to match the code:
  the record said an applied mass relocation could not be undone by restoring the source, because
  `classifyKnownItem` will not re-create a tombstone. A relocation's tombstone has been re-copied
  since the same day (`relocated-away`), so the breaker rests on the pairing being in doubt.

The full record, word for word as it read before this consolidation:
[history/0030-relocation-is-positive-evidence.md](./history/0030-relocation-is-positive-evidence.md).
