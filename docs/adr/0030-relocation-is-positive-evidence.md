# ADR-0030: A correlated relocation is positive evidence, and may be applied

- **Status:** Accepted (owner decision, 2026-08-15) — built the same day
- **Date:** 2026-08-15
- **Deciders:** owner
- **Relates to:** ADR-0024 (`apply` — the one destructive path, and its gate 3), ADR-0005 (non-destructive by default), ADR-0020 (natural keys preserved on the target). Arch doc §11.1. Workplan 0042 T2.

## Context

**A file that is moved or renamed on the source leaves a copy on the target that this
product will not remove, and offers the owner no way to remove it.** That is not a bug in
one function; it is what the two existing paths add up to, and it was verified rather than
reasoned about (`move-detection.unit.test.ts`).

The file domain keys items by normalized path (§10), so any reorganisation changes the
natural key. Two things then happen, and neither converges the target:

| what the owner did | what the pass reports | what the owner can do about it |
|---|---|---|
| moved `a/report.pdf` → `b/report.pdf` | a **move**, `from: a, to: b`, correlated by content hash | `keep` — acknowledge. Nothing else exists. |
| renamed `a/report.pdf` → `a/summary.pdf` | nothing on the pass it happens; then, after `DELETION_CONFIRMATIONS` clean passes, an **inferred deletion** | `keep`, or `apply` — which **refuses**, because ADR-0024 gate 3 bars `inferred` evidence outright |

In both cases the target ends up holding the old copy *and* the new one, permanently. The
rename case additionally spends two passes pretending it might come back, and then reports
a deletion of a file that was never deleted.

The rename is not detected as a move for one reason: `detectPathKeyedMoves` requires the
arrival to be in a **different collection** (`candidates.findIndex((c) => c.collection !==
row.collection)`). Workplan 0042 T2 described relaxing that as "nearly a one-liner". It is —
and on its own it would make things marginally worse, not better: the queue entry would read
"moved from `a` to `a`", and the record it writes (`movedToCollection`) cannot express what
actually changed, which is the item's NAME. So the one-liner is not the decision. This is.

**Why this matters now.** The owner's stated requirement for the first Google Drive customer
is that the target is not worked in and must follow the source, *including moves*. Drive is
also the source most likely to be reorganised while a migration runs — dragging files between
folders is what Drive is for. A migration that answers "your file moved; here is a duplicate
you must clean up by hand" for every drag is not one anybody would run for long.

## Decision

Treat a **relocation** — a disappeared item correlated by content hash with an arrival in the
same pass — as a distinct, POSITIVE evidence class, and allow `apply` on it.

Three parts:

**1. Relocation is recorded by natural key, not by collection.** The ledger row gains
`movedToNaturalKeyHash` alongside the existing `movedToCollection`. That is what a relocation
actually is: *this item's natural key is now X*. A cross-folder move and a rename in place
become the same event, described the same way, and the nonsensical "moved from `a` to `a`"
never has to be rendered.

**2. Correlation stops requiring a different collection.** With the key recorded, the
same-collection case is representable, so the filter becomes "an arrival with a different
natural key", which is what it always meant. **This is where the care goes**: same folder,
same bytes, different name is *also* exactly what a genuine duplicate looks like — the owner
copying `report.pdf` to `report (1).pdf` and then deleting neither. The existing
consume-the-arrival rule already handles the count correctly (one arrival explains one
disappearance, never several), and the safety argument below does not depend on telling a
rename from a copy: it depends only on the bytes being present at the new key.

**3. `apply` on a relocation removes the OLD copy — and this is categorically safer than
applying a deletion.** Gate 3 of ADR-0024 exists because absence has innocent causes that all
look identical, and removing a target copy on absence alone could destroy the only copy of
something. That argument does not apply here, and the difference is not a matter of degree:

> At the moment a relocation is applied, the ledger holds a row for the arrival, written by
> this pass, saying those same bytes were copied to the target under the new key. Removing
> the old copy therefore cannot lose data — the content is verifiably still on the target.

That is a stronger claim than `reported` evidence, which gate 3 already accepts: a source
saying "I deleted this" is a claim about the source, and applying it destroys the last copy
under this product's control. Applying a relocation destroys a copy that is, by construction,
redundant. So the evidence class is admitted at gate 3, and **every other gate stands
unchanged** — per-mapping opt-in, target capability, ownership (`adopted` rows are still never
touched), the ETag re-check, the mass-deletion breaker, and the ledger's own conditional
`UPDATE`.

**A new gate joins them, specific to this class.** Before removing the old copy, the ledger is
re-read for the arrival's row, and it must say the arrival is `copied` or `updated` — written
by us — and carry the same `contentHash` as the row being removed. `adopted` does not qualify:
an adopted row means the target already had something under that key, and its bytes are the
account owner's rather than a copy we made, so it is not evidence that these bytes are there.
If the new copy is not verifiably ours and present — the arrival failed, was adopted, or has
since been tombstoned — the apply is refused with `relocation_unconfirmed`.

Half of that check already exists at the other end: `createdThisPass` is populated only for
genuinely created items (`domain-sync.ts`), explicitly excluding adopted and rewritten ones,
so an adopted arrival cannot become a correlation in the first place. The gate is the same
question asked again at the moment of acting, because an owner may press `apply` days later
and the whole safety argument is "the bytes are still there" — which has to be true then, not
merely when the correlation was made.

**Deletion reporting for relocations stops.** A relocated row is no longer counted as absent,
so the rename case stops producing a phantom deletion after two passes. What the owner sees is
one relocation entry, immediately, on the pass it happened.

## What was built, 2026-08-15

Accepted by the owner and implemented in one change. Where each part landed:

| the decision | where it lives |
|---|---|
| relocation recorded by key | `item.moved_to_natural_key_hash` (migration `0009`), `Ledger.recordMove`'s sixth argument, `ItemMove.toNaturalKeyHash` |
| correlate on the key, not the collection | `detectPathKeyedMoves` in `domain-sync.ts` — the arrival filter is gone; a rename in place is now one move report instead of a phantom deletion two passes later |
| `apply` on a relocation | `applyRelocation` / `evaluateApplyRelocation` (`apply-deletion.ts`, beside the deletion path deliberately), `Ledger.applyRelocation`, `applyMappingRelocation`, `POST /mappings/{id}/moves/{hash}/apply` |
| the gate that carries the argument | `relocationCheck` — the arrival must exist, be `copied`/`updated` (never `adopted`), and still carry the same content hash |
| what the UI offers | `mayOfferRelocationApply` in the contract; the Moves screen shows the destructive button only for a relocation, and arms before it acts |

**Two things were deliberately NOT built, and both are stated rather than
implied.**

*The managed edition's route.* Its destructive path runs through a queued job
and an apply receipt, keyed by natural key hash with no room for a second kind
of apply against the same item. Building that properly means a second job, a
receipt discriminator, and its own tests; doing it badly means a destructive
job nobody has thought about carefully. So the managed UI does not offer the
action at all (`isSelfHost()`), rather than offering a button that 404s, and
`applyMove` in the web client refuses with the reason if it is somehow reached.
The appliance — the edition with the customer waiting — is complete.

> **Built, 2026-08-16 — properly, as the paragraph above demanded.** The
> receipt discriminator is migration `0010` (`apply_receipt.action`,
> `'deletion' | 'relocation'`, defaulted to the only value any existing row
> can honestly claim), because one item can be in BOTH destructive queues at
> once — renamed, then the new name deleted — and a poller must be answered
> about the question it asked. The route
> (`POST /:mappingId/moves/:hash/apply`) answers every ledger-side gate on the
> request via `evaluateApplyRelocation` — which this gave its first production
> caller — and the second job (`run-apply-relocation`) re-runs every gate
> freshly, asks the target for the arrival, and lands the outcome on the
> relocation's own receipt. The Moves screen now offers the action in both
> editions and polls the receipt to terminal, exactly as Deletions does. The
> join-don't-stack check is action-scoped, pinned by an integration test in
> which a queued deletion receipt on the same item is NOT joined by a
> relocation apply.

*Auto-apply.* Unchanged from the proposal below: safe to press once, having
looked, is not the same as safe unattended.

## Amendment, 2026-08-15 (same day): the gates were weaker than this document said

An adversarial audit of the shipped code — five independent readers, each finding then attacked
by somebody trying to refute it — confirmed **19 defects**, several able to remove the last copy
of a file. They are corrected, and the corrections belong in the record because three of them
show this ADR's argument was stated more strongly than the code delivered it.

1. **The arrival gate admitted statuses that mean "never written".** The code asked
   `isOnTarget(status) && status !== 'adopted'`, which is a weaker question than this document's
   "written by us": it lets `pending`, `skipped` and `deleted_source` through. Now `copied` or
   `updated`, exactly.

2. **Gate 7 could not see the arrival.** `applyRelocation`'s conditional `UPDATE` constrained
   only the row being removed, so the check that carries the whole argument happened two ledger
   round trips and a NETWORK CALL before the write. A concurrent `applyDeletion` on the arrival —
   entirely reachable, since a renamed file whose new name is then deleted sits in both queues —
   removed and tombstoned it in between, and both copies went. The arrival is now re-checked
   inside the same statement, in SQL and in the in-memory fake.

3. **A correlation is not proof, and this document said it did not need to be.** It argued the
   safety case "does not depend on telling a rename from a copy: it depends only on the bytes
   being present at the new key". That is true only when the pairing is right. Where a THIRD item
   shares the content hash, a folder briefly missing from one listing makes a live file look
   disappeared, an unrelated arrival explains it, and applying removes the target's copy of a file
   nobody touched — after which `classifyKnownItem` refuses to re-copy it, because the row is
   tombstoned. Every empty file in a Drive has the same hash as every other, so this is ordinary
   rather than exotic. **An ambiguous pairing is now refused**, and the owner is told why.

Also corrected: a relocation pointing at its own key (which would verify itself); an arrival
sharing the removed copy's `targetId` (where both keys name one object and the removal takes the
survivor); a tombstoned row still competing for arrivals and stealing the correlation that
explains a live rename; and a confirmed deletion left open on a tombstoned row, which never
leaves the queue and goes on counting towards the mass-deletion breaker until it refuses every
apply in the domain.

### The owner's answer, 2026-08-15: ask the target

The residual the amendment above could not close is that a LEDGER ROW IS A CLAIM. ADR-0024
deliberately removes-then-records — the ordering is right, and it means a crash or a failed write
between the two leaves a row saying `copied` for a copy that is already gone. `applyRelocation`
was trusting exactly such a row as proof the bytes were safe.

So the destructive path now ASKS THE TARGET, as the last thing before it removes anything:
`TargetPresenceCheck.hasItem` on the ARRIVAL's target id. `WebDAVTargetWriter` answers with a
HEAD, `JmapFileTarget` with a one-id `FileNode/get`; both treat "the server could not say" as a
THROW rather than as absence, because a 503 is not evidence that a file is gone.

**A target that cannot be asked does not get to host this operation.** The entire admissibility
argument is presence, and an unanswerable question is not a yes — so a writer that has not
implemented the check makes the apply refuse with `target_cannot_confirm`, naming itself.

That closes the gap between what this ADR claims and what it can demonstrate: the bytes are not
believed to be elsewhere, they are confirmed to be, at the moment of acting, by the system that
holds them.

**What this says about the decision itself.** The decision stands — removing a copy whose content
is verifiably elsewhere is still categorically safer than acting on a deletion. What was wrong was
the assumption that the correlation feeding it needed no scrutiny of its own. Detection may be
optimistic, because it only reports. The gate in front of a removal may not.

### The gate that saw only one item at a time, 2026-08-15

Every gate in front of `applyRelocation` reads ONE row. Each is satisfied by a correlation that
is locally perfect — the bytes really are on the target under the new key — and none of them can
see that the same thing just happened to the whole corpus. `MASS_DELETION_FRACTION` was the one
gate positioned to notice, and it counted pending DELETIONS only, which a relocation is not. So a
whole migration could relocate at once and every individual apply would sail through, each one
truthfully reporting redundancy.

The bad case is not exotic and it is not recoverable. A connector change that alters how paths
are normalised gives every file a new natural key, so every file "moves"; a desktop sync client
misbehaving does the same to ten thousand files an owner is about to restore from backup.
Applying removes the target's copies at the ORIGINAL paths — and restoring the source does not
undo it, because the old rows are tombstoned and `classifyKnownItem` will not re-create a
tombstone. The target is then permanently missing the files at the paths that were correct.

So the breaker now has two halves, sharing one threshold and one floor: pending deletions, as
before, and pending RELOCATIONS — moves that changed the natural key and are still open —
against the same corpus. A collection-only move is not counted, because it cannot be applied at
all and counting it would let a mail reorganisation refuse a file rename.

**This has a cost and it is not hypothetical.** Dragging one large folder somewhere else
relocates every file under it, which is a legitimate thing to do, and it will trip this. The
owner is not stuck — the refusal says what to do, and closing the entries with `keep` clears the
count — but they are made to tidy the old copies in the target system themselves. That is the
same trade ADR-0024 already accepts for a genuine mass deletion, taken for the same reason: at
the moment the share is that high, this code cannot tell the deliberate reorganisation from the
accident, and only one of the two is recoverable.

### `keep` was enforced by a button, 2026-08-15

`mayOfferRelocationApply` has always required an OPEN move, and said in its own documentation
that the server enforced that and more. The server did not: neither `applyRelocation` nor the
ledger's conditional `UPDATE` looked at `move_acknowledged_at`, so an apply on a move somebody had
already answered with `keep` succeeded. The only thing between a recorded decision and a destroyed
copy was a UI that happened not to render a button — and where nothing renders at all, two
operators answering the same question at once both succeeded, and the copy went despite a decision
on the row saying it should not.

`keep` and `apply` are the two mutually exclusive answers to one question. Both halves now say so:
core refuses with `already_kept` (distinct from `already_applied`, which means the copy is gone
rather than still there on purpose), and gate 7's statement carries `move_acknowledged_at IS NULL`,
which is what settles the race — first write wins, the loser is told what happened.

**The cost:** an owner who chose `keep` and later changes their mind cannot undo it here. Nothing
in this product re-opens a carried-out decision, and the refusal says what every other refusal on
this path says — do it in the target system yourself.

The same audit pass found that `applyRelocation`'s statement had never run against Postgres at
all: only `MemoryLedger` executed its `EXISTS` subquery and its deletion-closing `CASE`. A fake
mirroring a statement nobody executes proves the fake is self-consistent, which is not the claim.
`ledger.integration.test.ts` now runs it.

### The fourth audit, 2026-08-15: one claim, refuted

A fourth adversarial pass ran over everything above after it merged. One finding reached full
verification — that no test fails when `applyRelocation`'s `moved_to_natural_key_hash IS NOT NULL`
clause is deleted — and verification REFUTED it as a defect: the clause is logically subsumed by
the `EXISTS` conjunct, whose correlated key comparison is never true when the column is NULL, so
its deletion is an equivalent mutant that no test could ever kill, by construction. The behaviour
it states is enforced twice over and both enforcements have killing tests (core's `not_relocated`
gate by three unit tests; the `EXISTS` conjunct by the arrival-gone and bytes-differ integration
cases, confirmed by executing the real statement under PGlite). The clause now carries a comment
saying it is known-redundant, so nobody counts it as independently tested — which is the whole
finding, and the correct resolution of it.

Recorded here because the refutation is itself the useful result: the destructive path has now
survived an audit round without producing a defect, which is the first time that has been true.

## Consequences

- **The target can converge.** For the first time, an owner whose source was reorganised has a
  supported way to make the target match, without leaving this product.
- **The queue gains a second appliable class**, and with it a second reason to read ADR-0024's
  runbook. `apply` remains the only destructive path; this widens what may enter it, on an
  argument that is specific and checkable rather than a loosening of gate 3's principle.
- **Auto-apply is now conceivable, and is still NOT decided here.** Workplan 0042 T2's second
  item — a per-mapping setting that applies relocations without a human — becomes a small
  change on top of this. It is deliberately left out: "the bytes are demonstrably elsewhere"
  makes a single reviewed apply safe; it does not by itself make an unattended loop safe, and
  that wants its own decision with its own failure analysis.
- **A migration key
  that is not a path is unaffected.** Mail, calendar and contacts key on a stable id, so their
  moves never change the key and never reach this path; `classifyKnownItem`'s `'moved'` action
  keeps its current meaning (report, touch nothing) unchanged.
- **The ledger schema changes** (one nullable column, one migration), and `ItemMove` gains the
  new key. Both are additive; existing rows read as they do today.
- **A duplicate may be reported as a relocation.** If an owner copies a file and deletes the
  original in the same pass, that is indistinguishable from a rename — and the outcome is the
  same either way, because what the apply removes is a copy whose content is present under the
  other key. The report's wording must not claim to know which happened.
- **One item can, in an unusual order of events, sit in BOTH queues.** Correlation normally
  happens on the pass the arrival appears, so a relocated item never accumulates absences at
  all. But if the arrival is missed once — a listing that was not fully enumerated — the old
  row can bank an absence first and be correlated later, leaving an open deletion entry beside
  an open relocation entry. Left as it is, deliberately: both paths are correctly gated (the
  deletion is `inferred` and refuses; the relocation checks the arrival and permits), so the
  worst case is that a person is asked the same question twice rather than that the wrong
  thing is removed. **Clearing the absence run when a relocation is recorded would also clear
  `deletionReportedAt`/`deletionTrashedAt`** — `clearAbsent` wipes the evidence with the count,
  by design, for the "the item is back" case — and silently discarding a source's own deletion
  report is a bigger change to the destructive path than the duplicate entry it would tidy up.

## Alternatives considered

**Leave it as it is.** Defensible while every source was DAV and reorganisation was rare;
indefensible for Drive, and it is what the owner asked about directly. It also leaves the
rename case reporting a *deletion of a file that still exists*, which is worse than silence.

**Relax the collection filter only (the "one-liner").** Detects the rename, records
`movedToCollection = a` for a file that is still in `a`, and renders "moved from a to a". No
convergence, and a queue entry that reads as a bug. Rejected — it is the cosmetic half of this
decision without the part that helps.

**Report relocations as ordinary deletions with `reported` evidence.** Would reuse `apply`
untouched, and is a lie: nothing reported anything, and the class that means "the source told
us" must keep meaning that or gate 3 stops being readable.

**Key files by an opaque source id instead of the path.** Would make moves and renames
invisible — the key would not change. Rejected under ADR-0020, and rejected on its own merits
in workplan 0042 T2: a content hash is recoverable from the target, and a Drive `fileId` never
is, which is precisely why the ledger is allowed to depend on one and not the other.

**Have the sync loop move the target copy instead of copying + removing.** Closer to what the
owner did, and it requires every target writer to implement a move/rename that most of them do
not have (a JMAP `Email/set` move is not a file rename; WebDAV has `MOVE`, Nextcloud honours it,
plain DAV servers vary). It would also make the sync loop itself destructive, which hard rule 2
forbids and ADR-0024 deliberately kept out of the loop and behind an explicit owner action.
