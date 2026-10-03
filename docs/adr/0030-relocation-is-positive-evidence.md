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

- A **relocation** (a disappeared item paired, by **content hash**, with an arrival of the same pass under a new key) is **positive evidence**: `apply` may remove the **old** copy. Recorded by key (`movedToNaturalKeyHash`), so a move and a rename are one event, never a phantom deletion (`move-detection.unit.test.ts`).
- **ADR-0024's gates stand**, behind the same `allowApplyDeletions` switch; gate 3 admits the relocation through `relocationCheck`: the arrival is **ours** (`copied`/`updated`, never `adopted`), holds the **same `contentHash`**, is neither the old key nor its target object, and **no third item shares the hash**; else `relocation_unconfirmed` (`apply-relocation.unit.test.ts`).
- **The target is asked** (`hasItem`, for the arrival) immediately before removal. An error is not absence; a target that cannot be asked refuses (`target_cannot_confirm`). The port: `TargetPresenceCheck` (`ports.ts`).
- **Gate 6 has two halves** on one threshold: pending deletions, and open relocations (`mass_relocation_suspected`). **Gate 7's** `UPDATE` re-checks the arrival and `keep` in the same statement; `keep` and `apply` exclude each other (`already_kept`). Held by `ledger.integration.test.ts`.
- A renamed or moved **exported document** (Google Doc, Sheet, Slides deck or Drawing; Dropbox Paper doc) is paired by its **Drive or Dropbox id**: a bytes pair where both copies' bytes match, else `moved_by_identity`, whose `apply` asks for the **same id** (`source_ref`) in place of the bytes checks (owner, 2026-09-23; 0150 D8; `a-rename-the-bytes-could-not-pair.unit.test.ts`).
- Both editions serve a manual apply: the appliance answers once the old copy is gone; the managed edition queues `run-apply-relocation` and answers on a `relocation` receipt. Unattended apply is ADR-0031's and leaves identity pairs for a person (`paired_by_identity`). Held by `apply-routes.integration.test.ts`.

## Context

**A file moved or renamed on a path-keyed source left a copy on the target that this product
would not remove, and gave the owner no way to remove it** (verified in
`move-detection.unit.test.ts`). The file domain keys items by normalized path (§10), so every
reorganisation changes the natural key:

| what the owner did | what the pass reported | what the owner could do |
|---|---|---|
| moved `a/report.pdf` → `b/report.pdf` | a **move**, correlated by content hash | `keep`. Nothing else existed. |
| renamed `a/report.pdf` → `a/summary.pdf` | nothing; after `DELETION_CONFIRMATIONS` clean passes, an **inferred deletion** | `keep`, or `apply`, which refuses: ADR-0024 gate 3 bars `inferred` evidence |

Either way the target kept both copies. The rename was missed because correlation required a
**different collection**; relaxing only that renders "moved from `a` to `a`", since
`movedToCollection` cannot say the NAME changed. The owner's requirement for the first Google
Drive customer is a target nobody works in that follows the source, **including moves**.

An exported document has no bytes of its own. Two Office or OpenDocument exports of an unchanged
Google document differ (measured, workplan 0042 T3), so a renamed one was never paired: two clean
passes later it was reported **deleted in Google** while both copies stayed (0042 T10). Nothing
promises that two exports of a Dropbox Paper doc match either.

## Decision

A **relocation**, an item gone from one natural key and paired with an arrival under another, is
**positive evidence**, and `apply` may remove the target's **old** copy. That is categorically
safer than applying a deletion, which destroys the last copy under this product's control: the
old copy is redundant **once the new one is confirmed on the target, at the moment of acting**.
Detection may be optimistic, because it only reports. The gates in front of a removal may not.

### 1. Recorded by key, paired by bytes

- **Recorded by natural key** (`item.moved_to_natural_key_hash`, migration 0009;
  `ItemMove.toNaturalKeyHash`), so a cross-folder move and a rename in place are one event. A
  move that keeps its key (every mail, calendar and contacts move) is not a relocation: it is
  reported, `keep` is its only answer, and `apply` refuses it (`not_relocated`).
- **`detectPathKeyedMoves` pairs a disappeared row with an arrival created in the same pass with
  the same `contentHash`, in any collection.** An adopted or rewritten item is never an arrival,
  and one arrival explains one disappearance. A row with no hash is never paired, a row whose
  copy was removed takes no part, and a recorded move is remembered, not paired again.
- **A relocated row is not counted absent**: one relocation is reported, on the pass it happened.

### 2. Paired by id: a document a provider exports

A Google document (a Doc, Sheet, Slides deck or Drawing, copied as a Drive export) carries its
**Drive file id** as `FileItem.sourceIdentity`; a Dropbox Paper doc, copied as a Markdown or HTML
export, carries its **Dropbox id**. A rename changes neither.

- **The id pairs first.** A disappeared row whose `source_ref` is an id this pass lists under
  another name, with a copy recorded on the target, is paired with that name. It asks what is
  listed now, so a rename the pass did not see (already reported as deleted, or whose new name
  failed its first copy) is paired too, and the old name's absence is cleared with any deletion
  reported from it. A name with no copy pairs nothing yet. Not consumed: an id names one
  document, and every old name it left is an old copy of it.
- **A bytes pair where the bytes repeat** (PDF and SVG exports do); otherwise the move is
  recorded with `moved_by_identity` (migration 0058).
- Such an arrival stays out of the bytes index, so one export's bytes never pair it with another
  file. An earlier export of the same document (a format switch, 0042 T8 (b)) is never paired.

### 3. The gates, in the order `applyRelocation` runs them

`applyRelocation` sits beside `applyDeletion` in `apply-deletion.ts`. Every refusal is a sentence
an operator can act on.

- **Gate 1, opt-in:** `allowApplyDeletions`. One capability, one switch: a second would refuse
  the safer operation to an owner who opted into the more dangerous one.
- **Gate 2, capability:** `TargetRemover`.
- **Gate 3, the relocation in place of deletion evidence** (`relocationCheck`). A kept move is
  refused (`already_kept`: the copy is there on purpose; `already_applied` says it is gone), and
  a row with no relocation is `not_relocated`. Otherwise it is `relocation_unconfirmed` unless the
  arrival:
  - exists under another key and is **written by us**: `copied` or `updated` exactly, never
    `adopted` (the account owner's bytes) nor `pending`, `skipped` or `deleted_source`;
  - is another object on the target (a shared `targetId` would take the survivor too);
  - for **a bytes pair**, holds the same recorded hash, and **no third item in the migration
    shares it**: a folder briefly missing from a listing can make a live file look gone and an
    unrelated arrival explain it, and all empty files share one hash;
  - for **an identity pair**, carries the same `source_ref`; an id names one document, so there
    is nothing to be ambiguous.
- **Gate 4, ownership** of the old copy: `copied`/`updated`.
- **Gate 6, two halves**, on ADR-0024's threshold and floor (over 20% of at least 20 items):
  pending deletions (`mass_deletion_suspected`) and open relocations (`mass_relocation_suspected`).
  The other gates each read one row; only this one sees a whole corpus relocate at once, as a
  connector that changes how it normalises paths, or a misbehaving desktop sync client, would make
  it. A collection-only move is not counted.
- **The target is asked**, last (`TargetPresenceCheck.hasItem`, on the arrival), because **a
  ledger row is a claim**: remove-then-record can leave `copied` on a copy already gone.
  `WebDAVTargetWriter` sends a HEAD and `JmapFileTarget` a one-id `FileNode/get`; both throw when
  the server cannot say, since a 503 is not absence. Absent is `relocation_unconfirmed`; a target
  that cannot be asked refuses (`target_cannot_confirm`).
- **Gate 5, no edit since**, inside the removal (`edited_on_target`; `version_unknown` when no
  version was recorded).
- **Gate 7, the conditional `UPDATE`** (`Ledger.applyRelocation`), after the removal: the row
  holds a relocation, is unapplied, `copied`/`updated` and **not kept** (`move_acknowledged_at IS
  NULL`: the first of two answers wins), and an `EXISTS` **re-checks the arrival in the same
  statement** (another key, `copied`/`updated`, the same non-empty hash or, for an identity pair,
  `source_ref`), so a concurrent apply on the arrival cannot take both copies. It tombstones the
  row and closes any deletion entry on it. `ledger.integration.test.ts` runs it on Postgres; its
  `moved_to_natural_key_hash IS NOT NULL` clause, implied by the `EXISTS`, is commented as
  known-redundant.

### 4. Who presses it

- **Both editions serve a manual apply.** The appliance's `POST /mappings/{id}/moves/{hash}/apply`
  answers once the old copy is removed. The managed route answers the ledger-side gates on the
  request (`evaluateApplyRelocation`, held to `applyRelocation` by
  `apply-deletion-evaluate.unit.test.ts`), then queues `run-apply-relocation`, which re-runs every
  gate, asks the target, and lands the outcome on the relocation's own receipt
  (`apply_receipt.action`, migration 0010).
- The Moves screen shows the button only where `mayOfferRelocationApply` allows (an open
  relocation), and arms before it acts; the server decides.
- **Unattended apply is [ADR-0031](./0031-auto-apply-relocations.md)'s**, behind four more gates,
  and leaves an identity pair for a person (`paired_by_identity`): its argument is that the bytes
  are the proof when nobody is looking.

## Consequences

- **The target can converge** without the owner leaving this product. `apply` is still the only
  destructive path; what may enter it widens, on a specific, checkable argument.
- **A deliberate large reorganisation trips the breaker**, as dragging one large folder does. The
  refusal says what to do: close the entries with `keep`, which clears the count, and tidy the old
  copies in the target system. It is ADR-0024's trade for a mass deletion: at that share this
  code cannot tell a reorganisation from an accident.
- **`keep` is final here.** Nothing in this product re-opens a carried-out decision; an owner who
  changes their mind acts in the target system.
- **A duplicate may be reported as a relocation.** Copying a file and deleting the original in
  one pass looks like a rename, with the same outcome. The report must not claim to know which
  happened.
- **One item can sit in both queues.** If an arrival is missed once (a listing not fully
  enumerated), the old row can bank an absence before it is paired by bytes. Left so: the
  deletion is `inferred` and refuses, the relocation is gated, and the worst case is one question
  asked twice. An identity pair clears that absence (§2); an applied relocation closes the
  deletion entry (gate 7).
- **A relocation's tombstone is not an erasure.** If the source lists the old key again,
  `classifyKnownItem` returns `relocated-away` and the item is copied again; a deletion's
  tombstone never is (`move-detection.unit.test.ts`).

## Alternatives considered

- **Leave it as it is.** Defensible while every source was DAV; indefensible for Drive, and a
  rename ended as a reported deletion of a file that still exists, which is worse than silence.
- **Relax the collection filter only (the "one-liner").** It records `movedToCollection = a` for a
  file still in `a` and renders "moved from a to a": no convergence, and a queue entry that reads
  as a bug.
- **Report relocations as `reported` deletions.** It reuses `apply` untouched and is a lie:
  nothing reported anything, and gate 3 stops being readable once that class stops meaning "the
  source told us".
- **Key files by an opaque source id instead of the path.** Moves and renames would become
  invisible. Rejected under ADR-0020 and in workplan 0042 T2: a content hash is recoverable from
  the target, a Drive `fileId` never is. The id in §2 only pairs; the key stays the path.
- **Have the sync loop move the target copy.** Most writers have no move or rename (a JMAP
  `Email/set` move is not a file rename; plain DAV servers vary on `MOVE`), and the loop would
  become destructive, which hard rule 2 forbids.
- **Trust the pairing, and the ledger.** This ADR first held that safety "does not depend on
  telling a rename from a copy", and took the arrival's row as proof of its bytes. The first
  holds only for a right pairing, so an ambiguous one is refused; the second is a claim, so the
  target is asked (owner, 2026-08-15).
- **Count collection-only moves in the relocation breaker.** They cannot be applied, and counting
  them would let a mail reorganisation refuse a file rename.
- **Clear the absence run whenever a relocation is recorded.** `clearAbsent` also wipes
  `deletionReportedAt`/`deletionTrashedAt`, by design for "the item is back", and silently
  discarding a source's own deletion report is a bigger change to the destructive path than the
  duplicate entry it tidies. An identity pair does clear it: its id is listed under the new name.
- **One receipt per item for both destructive actions.** One item can be in both queues (renamed,
  then the new name deleted), and a poller must be answered about the question it asked.
- **Let unattended apply take identity pairs.** Its safety rests on the bytes being the proof
  when nobody is looking, and an identity pair has no such proof.
- **Auto-apply as part of this decision.** "The bytes are demonstrably elsewhere" makes one
  reviewed apply safe, not an unattended loop. Decided separately, with its own failure analysis,
  in ADR-0031.

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
