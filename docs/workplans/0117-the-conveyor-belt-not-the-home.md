# Workplan 0117 — The conveyor belt, not the home

## Status — 2026-09-04 (update this block at the end of every session)

**2026-09-04: drafted for the owner's decision, nothing built.** The owner asked:

> *"would a sync-to-target-and-delete-in-source be an interesting feature after cutover for
> file platforms? some keep for instance Google and photos on android are automatically
> stored in cloud. one might want a sync to target platform indefinitely, in combination
> with removal from the source?"*

and then, before this was drafted, named the thing that makes it hard:

> *"reason on the conflicting aspects the trashbin as the justification for delete in the
> target: they dont go well with a 'delete in source because the target now holds it'."*

That second remark is the whole plan. It is right, it goes deeper than it first appears, and
§3 is the answer. **No task here is authorised.** D1 is the only decision that matters; if
the owner says no to it, this document is a record of why and nothing more is wasted.

| Task | Status | Notes |
|---|---|---|
| T0 The owner's decision | 🔨 **The only live item** | D1–D5 in §6. D1 alone decides whether the rest exists. |
| T1 The continuous lane | 📋 Planned (needs D1) | A mapping that keeps copying after cutover, **deleting nothing**. Most of the value, almost none of the risk. |
| T2 The confirmed list | 📋 Planned (needs D1) | "These N items are in your new home, verified by hash." No deletion by us. The ONLY possible answer for Google Photos. |
| T3 The drain | 📋 Planned (needs D1 **and** D2) | Removal at the source, for the file platforms whose API permits it. The dangerous one. |
| T4 The attributed tombstone | 📋 Planned (needs T3) | A deletion we caused is not a deletion we observed. §3's second wall. |
| T5 The words | 📋 Planned | Consent, digest, receipt. Deleting somebody's data on a schedule is not a checkbox. |

## Why this exists

Every task in this repository so far has been **additive**. A bad copy costs bytes and an
apology; a missed item is found by verification and copied next pass; even `applyDeletion`
removes only *our own copy on the target*, which is by construction not the last one.

This plan is different, and it is worth being blunt about the difference in the first
paragraph rather than the fifteenth: **it is the only feature this product has ever
considered where a bug destroys the customer's originals.** Everything below — the phases,
the evidence rules, the gates — exists because of that one sentence.

### What the owner actually spotted

The insight is not "delete the source too". It is that **for the platforms in question the
source is not a store, it is a tap.**

Android's photo backup keeps uploading. Desktop Drive clients keep syncing. So a one-time
migration out of Google Photos is stale the morning after: the person's phone refills the
account they just left. Under the current product they have two options, and both are bad —
turn the backup off and lose the convenience that made them use it, or keep paying Google to
hold a growing copy of everything while also paying for their new home.

A continuous lane makes Google a **conveyor belt** rather than a home. That is the thing
that makes leaving actually stick, and no amount of one-time migration achieves it.

## 1. The blocker on the motivating example, first

**Google Photos cannot be drained.** Not "not yet" — there is no API.

- There is no deletion method for a person's own media items in Google's Photos Library
  API. An application may modify only items it created itself.
- Since **31 March 2025** the Library API does not read a person's library at all for
  general access, which is why [0116](./0116-the-data-they-give-the-person-not-us.md) exists
  and why the only route to those bytes is a Takeout the person downloads.

So for the example the owner gave — photos, on Android, auto-uploaded — neither half of the
drain is available. Not the read, not the delete.

> **Owed before T3 is planned in detail** (0105's never-guess rule): re-read Google's Photos
> Library API reference and confirm both statements against the published page, with the
> date. They are stated here from this repository's own prior research (0112, 0116) and
> should not be re-used a third time without being re-checked.

What *is* available for Photos is T2, and it is not a consolation prize: after an archive
import, tell the person **exactly which items are confirmed present in their new home, by
content hash**, and let them delete in Google's own app, which is the only place they can.
That turns the frightening part of leaving — *am I sure it is all there?* — into a list.

The genuine drain candidates are the file stores whose APIs do delete: **Drive, Dropbox,
OneDrive/SharePoint, Box**. All four are already sources this product reads.

## 2. This inverts the deepest rule here, and that is a decision, not a detail

Hard rule 2. And the retraction of `bidirectional` and `asymmetric` on 2026-08-03 (owner
decision, 0026 T3 rows 7–8), whose stated reason was:

> writing changes back to the source would mean modifying the system being migrated away
> from.

Deleting from the source is the strongest possible form of writing back. The refusal in
`CreateMappingSchema`'s `mode` enum still says so today, in the message a person gets.

This plan does not argue that rule was wrong. It argues that **the rule is about a
migration, and a drain is not a migration** — it begins where the migration ended, the
target is already the home, and the person has asked for the source to be emptied rather
than preserved. That is a coherent position and it may still be the wrong one to take. It is
D1, and it belongs to the owner alone.

## 3. The conflict the owner named, which is worse than it looks

Today a file in the **source's bin** is positive evidence of deletion (`trashed`, the middle
`DeletionEvidence` class), and `ports.ts` permits it to gate a destructive action: we mirror
that deletion onto the target. OneDrive is stronger still — its delta stream reports
deletions outright, which is `reported`, the top class.

Now add a drain. We delete an item at the source because the target holds it. On Drive,
Dropbox, OneDrive and Box, "delete" means **move to that platform's own bin**.

### 3a. The loop

1. The drain removes an item from the source. It lands in the source's bin.
2. The next pass reads the source's bin and finds it. That is `trashed` evidence — or, on
   OneDrive, `reported`.
3. The deletion detector concludes the person deleted it, and applies that to the target.
4. **The item now exists nowhere.**

Every step behaves exactly as designed. Nothing errors. The product eats the customer's
library one pass at a time, and the run report says it is mirroring faithfully.

A hard delete instead of a bin delete does not escape it: the item is simply absent, becomes
`inferred` after `DELETION_CONFIRMATIONS` complete scans, and although gate 3 bars
*applying* an inferred deletion, it is still **reported to the customer as a deletion at
source** — which is a lie, because we did it.

### 3b. And it is not about who does the deleting

Consider T2, where this product deletes nothing and the person deletes in Google's own app,
acting on our list of what is safe. Their deletion is genuinely theirs. The bin evidence is
genuinely theirs. And a live mirror would still propagate it to the target and destroy the
copy we just told them was safe.

So the conflict is not caused by the drain, and building the drain carefully does not avoid
it. The real finding is one layer down:

> **A deletion at the source means something different before cutover and after it.**
>
> Before: *I no longer want this.* Mirror it.
> After: *I no longer need this **here**.* Mirroring it is the opposite of what was meant.
>
> The bin cannot tell those apart, because they look identical in it.

### 3c. Today this is safe by accident, and the accident is the design

It is worth stating plainly that **this is not a live defect**: only mappings with status
`active` run passes (selfhost tick, `apps/selfhost/src/index.ts`), and a mapping in
`cutover` or `done` runs nothing at all. So a customer tidying their old Drive after moving
is not mirrored, because nothing is watching.

That accident is exactly the rule §3b asks for, enforced by the crudest possible means:
after cutover, we stop looking. Which yields the design constraint that governs everything
below:

> **A drain must not run in the phase where deletion-mirroring runs.** It cannot be a flag
> on an `active` mapping, because that reintroduces the window the lifecycle currently
> closes by stopping.

## 4. The scenarios, and which of them are coherent

Five shapes were considered. Two work, one works with new machinery, two do not.

### ✅ A. Phase separation — mirror, then drain, never both

The mapping's lifecycle already distinguishes the two meanings. Make it explicit rather than
incidental: a **drain is a lifecycle phase**, entered only from `done`, in which

- new items are still copied from source to target (that is the conveyor);
- **deletion detection is off entirely** — not overridden per item, not gated, *off*, because
  after cutover the source is no longer the authority on what exists;
- removal at the source is what the phase is for.

The conflict dissolves rather than being managed, because the two behaviours belong to
different phases and running both at once is incoherent regardless of any bin.

**What it costs, stated honestly:** an item the person deletes at the source during the drain
window, before it has been copied, simply never arrives on the target. That is correct — but
it is also the one case where "we did what you meant" depends on timing, and the walkthrough
must say so.

### ✅ B. Attributed tombstones — a deletion we caused is not one we observed (T4)

Needed even under A, as the second wall and for the receipt. The ledger already holds a row
per copied item carrying the source's own ref. A drain stamps that row: *removed from source
at T, because the target confirmed the bytes at hash H.* The deletion detector asks the
ledger before treating any absence or bin entry as evidence.

This product already attributes actions it took (`system:auto-apply` audit rows, ADR-0031).
This is the same idea one layer down, and it is what lets the customer be shown a list of
what we removed — which they are owed regardless.

### ✅ C. The rolling window — drain only what arrived after cutover

The narrowest useful version, and it fits the motivating case exactly. What refills the
source is **new** items from the phone. Items that predate cutover are the person's history,
migrated once, and there is no ongoing reason to touch them.

Draining only post-cutover arrivals means **we never delete anything the person owned before
they hired us**. That is a very large reduction in blast radius for a very small reduction in
value, and it is the default this plan recommends.

### ❌ D. Drain with mirroring left on, made safe by better gates

The shape that looks reasonable and is not. Any gate strong enough to tell our own deletion
from the person's needs B anyway — at which point A is simpler and does not depend on the
gate being right every time. And per §3b, mirroring after cutover is wrong even with no
drain, so this preserves a defect in order to work around it.

### ❌ E. "Free up space" by expiry rather than deletion

Attractive because it sounds gentler, and empty: no file platform here exposes a retention
policy a third party can set. It collapses into T2 — telling the person what is safe — with
extra words.

## 5. If T3 is built, the evidence rule is already written down

ADR-0030's relocation rule is: *the old copy is removed only after the target itself confirms
the bytes exist under the new key.* A drain is that same rule with the old copy in a
different **account** rather than a different path. So the bar is not new; it is re-read
across an account boundary:

- **Confirm by re-reading the target**, comparing content hash — never "we wrote it and got a
  200". The gate is the target's answer, not our memory of our own request.
- **Delete to the source's own bin** wherever it has one, so the customer keeps their own
  30-day undo. This is *not* a weakening: it means our worst case is recoverable by them.
- **A settling period.** Nothing that arrived this pass is drained this pass.
- **A rolling window** (§4C): post-cutover arrivals only, by default.
- **Per-pass cap and the mass breaker** (`MASS_DELETION_FRACTION`), because a correlation
  failure in bulk is exactly what the per-item argument satisfies.
- **Attributed, audited, and in the digest** — what was removed, when, and the hash that
  justified it.
- **Armed separately**, after `done`, never inherited from the migration and never implied by
  `allowApplyDeletions`, which is a different capability against a different account.

Note what quota does **not** do: a Drive deletion moves to Trash and the storage is not freed
until the bin is emptied or 30 days pass. So "frees your Google storage" is not true on the
day it runs, and the words must not say it is.

## 6. The owner's decisions

**D1 — is this a product this company sells at all?** It inverts the retraction of
2026-08-03. Everything else here is downstream.
*Recommendation: **the continuous lane yes, the drain not yet.*** T1+T2 deliver most of the
value at almost none of the risk, and T2 is the only thing that can ever exist for Photos.
Revisit T3 once T1 has run against real accounts for a while.

**D2 — if the drain is built, on which platforms?** Drive, Dropbox, OneDrive, Box are
possible; Photos is not.
*Recommendation: **one platform first**, whichever the first customer actually asks for.*

**D3 — the window.** Everything, or post-cutover arrivals only (§4C)?
*Recommendation: **post-cutover arrivals only**, with "everything" as an explicit later
decision that needs its own consent.*

**D4 — where mirroring stops.** Make §3b explicit — deletion detection off in the drain
phase — or leave the lifecycle's incidental protection to carry it?
*Recommendation: **make it explicit**, whatever is decided about D1. It is a one-line rule in
a place somebody will otherwise "fix" by making the drain phase run passes.*

**D5 — the consent.** Deleting a customer's data on a schedule is not the same permission as
copying it.
*Recommendation: **a separate, named, re-confirmable consent**, with the first drain
run reported before it becomes routine.*

## Not in this plan

- Mail, calendars and contacts. The argument here is about stores that keep being refilled by
  a device; a mailbox is not one, and the retracted modes stay retracted for them.
- Deleting the customer's account at the source. That is theirs to close, and the erasure
  timeline already says what outlives us.
- Anything that would let a drain run without a completed, verified migration behind it.

## Definition of done, per task

The repo's rules apply unchanged, plus one that is specific to this plan: **every task here
must be provable by breaking it toward the safe side.** A test that shows the drain deleting
what it should is worth much less than one that shows it refusing to delete what it must not
— an item the target never confirmed, an item outside the window, an item the person edited
on the target, an item whose absence we ourselves caused.

## Sources

- Workplan [0116](./0116-the-data-they-give-the-person-not-us.md) — why Photos and iCloud
  Drive have no live route, and the content hash the confirmed list would be built on.
- Workplan [0112](./0112-google-photos-through-takeout.md) — Takeout, and the Photos API's
  closure.
- ADR-0030 and its amendments — the relocation rule this plan re-reads across accounts.
- ADR-0031 — the unattended-apply gates, and attribution as data.
- `packages/core/src/apply-deletion.ts` — the seven gates, and `MASS_DELETION_FRACTION`.
- `packages/shared/src/ports.ts` — `DeletionEvidence`, and which classes may gate a
  destructive action.
- 0026 T3 rows 7–8 (owner decision 2026-08-03) — the retraction this plan would qualify.
