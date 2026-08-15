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

*Auto-apply.* Unchanged from the proposal below: safe to press once, having
looked, is not the same as safe unattended.

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
