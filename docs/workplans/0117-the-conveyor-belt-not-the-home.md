# Workplan 0117 — The conveyor belt, not the home

## Status — 2026-09-09 (update this block at the end of every session)

**2026-09-10: T1 SLICE 1 MERGED, and it was short by two vocabularies.** The lane exists
in the database, in billing and in `isAfterCutover` (#904). Re-reading before building slice 2
found two more lists that decide something about a lifecycle, and the first of them is the
one that shouts:

- **`MAPPING_LIFECYCLES`** (`packages/shared/src/operating-contract.ts`) — what BOTH status
  readers narrow through, and they **throw** rather than coerce (hard rule 9). A `continuous`
  row admitted by the widened CHECK constraint made `mappingStatus` in the appliance and
  `scope` in the managed API raise, so every page and every pass of that migration failed.
- **`STATE_TABLE.lifecycle`** (`apps/web/src/components/StateChip.tsx`) — the word and the
  colour on every screen. Blue, not the green `active` wears: both run, only one ends.

**Neither was findable by the compiler.** Nothing assigns the literal, so `tsc` had nothing
to say; the fifth was found by reading. Widening the union then made the compiler name the
sixth and four exhaustive `Record<MappingLifecycle, …>` maps besides — which is the shape of
this defect worth remembering: *one list moves, and the places that must move with it are
only partly findable by machine.*

Slice 1's guard now pins all six, plus one more thing it did not before: **the door is
deliberately still shut.** `PATCH /api/migrations/:id` admits four of the five states, and
the guard fails if `continuous` is quietly added to that `z.enum` — because entering the
lane is the act ADR-0014's amendment attached a price to, and T5's sentence has to exist
first. That test is meant to be edited once, by whoever builds the door.

**2026-09-09, later still: T1 and T2 SURVEYED — and each turned out to contain a question
that is not a programmer's to answer.** §7 is the survey: every attachment point read out of
the tree, with file and line, so building these is execution rather than invention. Two
findings worth the top of this page:

- **T1 touches two lifecycle vocabularies, not one.** `mailbox_mapping.status` has four
  values; `PATH_STATES` — the BILLING one — has five, and is documented as *"ADR-0014's
  five"*. A continuous lane needs a value in both, and the second is an amendment to a
  published ADR rather than a new constant. **D6** asks the question underneath it: does a
  path that never ends hold one of the tier's slots?
- **T2 needs a confirmation pass, and §7d says exactly what it can and cannot claim.** For
  files and mail the ledger holds our own SHA-256 and the target can be re-hashed the same
  way, so the comparison is available — easier than feared. For **calendar and contacts
  there is no byte-hash claim at all**, permanently and by design: a DAV server
  re-serialises what it stores. T2's list holds two kinds of row and must say which is
  which. **D7** is then a cost question — how much gets re-read — plus that labelling,
  which is not negotiable.

**Nothing is blocked on me.** D6 and D7 each fit in a sentence and each unblocks a build.
T1's logic (§7b — where the detector must be absent, and the test that tells absent from
gated) needs neither of them and is buildable now.

**2026-09-09, later: D4 TAKEN — after cutover we do not delete in the target because
something changed at the source.** The owner's words, which are better than the drafted
question because they are about the outcome rather than the machinery:

> *"indeed, after cutover the source is no longer the authority on what exists, so we will
> not delete in target based on changes in the source."*

**How it must be built, which §4D already settled and this record keeps attached to the
rule: the detector does not RUN.** Not run-and-filter, not gated per item, not suppressed
downstream — a gate strong enough to tell our deletion from the person's needs T4's
tombstones anyway, and a gate is a thing that can be wrong once. Absence cannot.

**T1 and T2 are now fully unblocked**, and the rule is written into their definition of
done as a break-toward-the-safe-side test, per this plan's own extra rule: a test showing
the lane *refusing* to mirror a post-cutover deletion is the one that matters.

**One consequence to say out loud rather than discover:** somebody deletes a file at the
old provider after cutover, and the copy in their new home stays. That is correct, and it
is the opposite of what the product did before cutover — so it belongs in T5's words, along
with the still-open choice of whether we simply stop noticing or say that we have.

**2026-09-09: D1 TAKEN — the continuous lane yes, the drain not yet.** The owner's words:

> *"0117 D1 — yes to T1 + T2, not yet to the drain. I guess this is only something for after
> the cutover?"*

Yes, and not by coincidence: T1 has no pre-cutover meaning at all (before cutover, "keeps
copying" is simply the migration), and T2 is the artefact you hand somebody once they have
moved. **T1 and T2 are unblocked. T3, T4 and the drain half of T5 are deferred**, and D2/D3
go with them — neither needs an answer while T3 does not exist.

**But D1's answer promotes D4 from a detail to a precondition, and widens it.** §3c's
protection is that after cutover the product *stops looking*: only `active` mappings run
passes. T1 is precisely a mapping that keeps running after cutover, so **T1 reopens the
window the lifecycle currently closes by stopping** — and §3b showed the conflict does not
need a drain to bite: under T2 the person deletes in the source's own app, acting on our
verified list, and a live mirror propagates that deletion onto the target and destroys the
copy we just told them was safe.

So D4 is no longer "deletion detection off *in the drain phase*". It is **off after
cutover, full stop**, and it now blocks T1 and T2 rather than T3. It is a one-line rule and
it is the one thing standing between "most of the value at almost none of the risk" and a
product that eats a library one pass at a time while reporting success. **D4 is the live
item; no T1 code should be written before it is answered.**

Previous status (2026-09-04): drafted for the owner's decision, nothing built. The owner asked:

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
| T0 The owner's decision | ✅ **D1 and D4 taken 2026-09-09** | D1: the continuous lane yes, the drain not yet. D4: after cutover we do not delete in the target on the strength of a source change — and the detector does not run, per §4D. D2/D3/D5 park with T3. What is left of T0 is **the words** (T5), not a decision. |
| T1 The continuous lane | 🔨 **Vocabulary built 2026-09-10** (ledger migration 0044, `holdsASlot`, `isAfterCutover`, ADR-0014 amended). Nothing can enter or run the lane yet — the tick and the door are the next two slices | A mapping that keeps copying after cutover, **deleting nothing**. Its first design constraint is D4's rule: the deletion detector does not run in this phase at all. Proof obligation is the refusal, not the copy — a post-cutover deletion at the source must leave the target untouched, and the test must fail if detection is merely gated rather than absent. |
| T2 The confirmed list | 📋 **Unblocked 2026-09-10 — D7 taken, branch (a)**: confirm every item by re-reading the target, as a job the person starts. §7d has what it may claim, and the calendar/contacts limit it must state | "These N items are in your new home, verified by hash." No deletion by us — and §3b's trap is now closed by D4: the person deletes in the source's own app on the strength of our list, and nothing propagates that onto the target. The list is only safe to hand over because of D4. |
| T3 The drain | ⏸️ **Deferred by D1 (2026-09-09)** | Removal at the source. Revisit once T1 has run against real accounts for a while — the owner's own condition, and the plan's recommendation. D2 (which platform) and D3 (the window) are parked with it. |
| T4 The attributed tombstone | ⏸️ **Deferred with T3** | A deletion we caused is not a deletion we observed. §3's second wall — needed only once something of ours deletes. |
| T5 The words | 🔨 **The live item now** | The drain's consent (D5) defers with T3. What T1 and T2 need is smaller and real, and D4 added to it: a person must be told that a mapping keeps copying after cutover (continued access to a system they think they have left), that deletions at the source are **no longer mirrored** and why, and T2's list must say what "verified" covers before anybody deletes on the strength of it. |

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

> ✅ **TAKEN 2026-09-09, as recommended.** *"yes to T1 + T2, not yet to the drain."* The
> owner also asked whether this is only for after the cutover: **yes**, and definitionally
> so — T1 before cutover is just the migration, and T2 is what you hand somebody once they
> have moved. Revisit trigger unchanged: T3 comes back after T1 has run against real
> accounts for a while.

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

> 🔨 **NOW THE LIVE DECISION, and wider than drafted (2026-09-09).** D1 deferred the drain,
> which looks like it defers D4 too. It does the opposite. The protection in §3c is that
> after cutover **nothing runs**; T1 is a mapping that keeps running after cutover, and T2
> hands someone a list they will act on inside the source's own app. Either one restores
> the §3a loop without a drain existing anywhere — §3b said as much and it was easy to read
> as a remark about the drain. It is not.
>
> So the question is no longer *"off in the drain phase?"* but **"off after cutover, in
> every phase that keeps running?"** — and the answer gates T1's first line of code rather
> than T3's.
>
> *Recommendation, unchanged in substance and now urgent: **make it explicit.** Deletion
> detection does not run after cutover. Not gated per item, not overridden, off — the same
> words §4A already uses for the drain phase, for the same reason: after cutover the source
> is no longer the authority on what exists.*
>
> ✅ **TAKEN 2026-09-09, as recommended.** *"indeed, after cutover the source is no longer
> the authority on what exists, so we will not delete in target based on changes in the
> source."*
>
> The owner stated it as an outcome; §4D fixes the mechanism, and the two are kept together
> deliberately, because the outcome is reachable by a gate and the gate is the thing this
> plan rejected. **The detector does not run.** A phase in which the code is absent cannot
> be wrong on a Tuesday; a filter can.
>
> Scope, in one line for whoever implements it: **off after cutover, in every phase that
> keeps running** — T1's continuous lane today, the drain if it is ever built.
>
> Consequence, for T5's words rather than for the code: a post-cutover deletion at the
> source leaves the target copy in place. Correct, and the opposite of pre-cutover
> behaviour, so it has to be said. Whether we also *report* the divergence ("N items you
> removed at the old provider are still in your new home") is open and belongs with T5.

**D5 — the consent.** Deleting a customer's data on a schedule is not the same permission as
copying it.
*Recommendation: **a separate, named, re-confirmable consent**, with the first drain
run reported before it becomes routine.*

---

The two below were not in the original draft. They surfaced on 2026-09-09 while surveying
where T1 and T2 actually attach (§7), and both are the same kind of thing: a question that
sits inside an authorised task, that a programmer would otherwise answer by accident.

**D6 — does a mapping in the continuous lane hold a billing slot?** 🔨 **OPEN — blocks T1's
schema, not its logic.**

ADR-0014's occupancy axis is *paths at once*, and `holdsASlot` is `active || paused`
(`packages/ledger/src/path-lifecycle-store.ts`), whose own module comment calls it *"the one
rule the tier calculator, the honesty surface and any future invoice all have to agree
on"*. Every state in that vocabulary belongs to a migration, which is a thing that ends.
**The continuous lane is a path that does not end**, so whichever way this goes, a pricing
axis built for a finite job acquires an infinite one.

And it is not only a code change. `PATH_STATES` is documented as *"ADR-0014's five, in the
order a path travels them"* — `ready, active, paused, cutover, done`. A sixth is an
**amendment to a published ADR**, and ADR-0014 has been amended for pricing before
(2026-08-20, metered → tiers). So the answer here decides a document, not just a constant.

- **(a) It holds a slot, like any other path.** The tier stands as it is; a customer running
  a belt keeps paying the tier that belt occupies. The machine genuinely is working for
  them, month after month.
- **(b) It holds no slot.** After cutover the lane is free. Generous, and it makes leaving
  stickier — but an unmetered resource is a resource somebody eventually leaves running by
  the hundred, and this one costs real bytes every pass.
- **(c) Its own line, priced separately** — the honest shape if the answer is "yes but not
  at migration rates", and the most work.

*Recommendation: **(a)**, on the grounds that it needs no new machinery and no new words on
the invoice, and that the occupancy really is occupancy. But it carries an obligation that
is not the code's: **the customer has to be told before they enter the lane that their bill
does not stop at cutover.** Somebody who believes the price ends when the migration ends and
finds a tier still charging is a complaint, and a fair one. That sentence belongs to T5.*

> ✅ **TAKEN 2026-09-10, as recommended.** *"a. yes it holds a slot"*.
>
> Built the same day: ledger migration 0044 widens BOTH vocabularies together —
> `mailbox_mapping.status` and `path_lifecycle.state` — because widening one leaves a lane
> that runs while billing believes those paths ended. `holdsASlot` returns true for
> `continuous`, and ADR-0014 is amended, since `PATH_STATES` is documented there as "ADR-0014's
> five" and this makes it six. The capacity sentence gains its third clause: a paused path is
> reserved capacity, a finished path is released capacity, **a continuous path is occupied
> capacity that is never released.**
>
> **The obligation travels with the decision and is not discharged yet.** T1 must not ship a
> door into the lane until T5 has the sentence that says the bill does not stop at cutover.
> The guard holds ADR-0014 to carrying that sentence, so it cannot quietly go missing.

**D7 — how much does T2 re-read, and what does the list say for calendar and contacts?**
🔨 **OPEN — blocks T2's first line.**

§5's rule is that our memory of our own write is not the gate; §7d establishes that the
target-side comparison T2 needs **is** available and algorithm-safe for files and mail (both
sides are our SHA-256). So this is a cost question after all, plus one thing that is not:

- **(a) Confirm every item** by re-reading it from the target. What a list somebody deletes
  on actually deserves. For a family-sized file account it is a full download **from the
  target** — hundreds of gigabytes and hours, per list.
- **(b) Confirm presence for every item from the listing** — which is cheap, since the
  target's listing already carries name, size and often a hash — and re-read a bounded
  sample. Much faster, and a strictly weaker claim.
- **(c) Presence and size only**, said in exactly those words.

*Recommendation: **(a) for files and mail, offered as a job the person starts and we report
on, rather than something that must finish before the list appears.*** The cost is real but
it is once per migration, at the moment somebody is deciding whether to delete their
originals — the one moment in this product where paying for certainty is obviously right.
(b) is the fallback if (a) turns out to be intolerable in practice, and it must then be
labelled as a sample rather than a confirmation.

> ✅ **TAKEN 2026-09-10, as recommended.** *"approved: (a) — confirm every item by re-reading
> it from the target, for files and mail, offered as a job the person starts and we report on
> rather than a wait before the list appears."*
>
> Note for whoever builds T2: the owner approved this recommendation **as corrected**. An
> earlier draft of D7 recommended (b) and carried a research debt against Drive, Dropbox and
> OneDrive; that draft asked the wrong side of the migration and is withdrawn — see the
> provenance note in §7d. Nothing about (b) is authorised.

**And the part that is not a cost question:** for **calendar and contacts** there is no
byte-hash claim available at all (§7d), by design and permanently. Whatever (a)/(b)/(c)
decides, T2's list has to carry two kinds of row and say which is which — the fingerprint
claim is real but weaker, and presenting it as the same thing would be the most dangerous
sentence in the product.

*One thing D7 does not get to decide either way: **whatever "verified" turns out to mean, the
list says so on its face.** A person deleting their originals on the strength of a list is
owed the definition next to the number, not in a footnote. That is the T2 half of T5's
words, and it is not optional in any branch.*

## 7. T1 and T2, as they have to be built HERE (added 2026-09-09)

D1 and D4 authorised these two and settled what they must not do. Neither says where they
attach to this codebase, and both turn out to contain a question that is not a
programmer's to answer. This section is the survey — every claim below was read out of the
tree on 2026-09-09, with the file and line, so the build is execution rather than
invention — and the two questions are raised as **D6** and **D7** in §6.

### 7a. T1 — where the phase attaches

**A fifth lifecycle value.** `mailbox_mapping.status` is `active | paused | cutover | done`
(managed migration 0001's CHECK, `packages/ledger/src/schema-pg.ts`). The continuous lane
is a phase, per §4A, so it is a fifth value — `continuous` — entered from `cutover` or
`done` and left to `done`. Not a flag on `active`: §3c already rejected that, because a
flag reopens the window the lifecycle closes by stopping.

**Three places decide today whether a mapping runs, and all three say `active`:**

| where | what it does now | what T1 needs |
|---|---|---|
| `apps/selfhost/src/index.ts:842` | `if (status === 'active') scheduleMapping(m)` | schedules `continuous` too |
| `apps/selfhost/src/index.ts:2686` | the manual trigger answers **409** `mapping is '<status>', not 'active'`, hinting *"A mapping in cutover or done no longer syncs"* | the hint stops being true for one value, and must say so |
| `packages/shared/src/lifecycle.ts` | `isAfterCutover(status)` = `cutover \|\| done` (#899) | `continuous` joins it — it IS after cutover, and that membership is what makes the detector absent |

That last row is the load-bearing one. D4's rule is expressed as "after cutover"; if
`continuous` is not *in* `isAfterCutover`, the lane runs with the detector present and §3a's
loop is back with no drain anywhere. **Adding the status and adding it to `isAfterCutover`
are one commit, never two.**

**Two vocabularies, not one, and it is easy to miss.** `mailbox_mapping.status` is
`active, paused, cutover, done`; `PATH_STATES`
(`packages/ledger/src/path-lifecycle-store.ts`) is `ready, active, paused, cutover, done` —
five, with a `ready` the mapping has no equivalent of. 0109 T1 built the per-path store
precisely so a path can end on its own, and its module comment records that the routes
still read the mapping's column. **T1's new value has to land in both**, or the lane runs
while the billing ledger believes those paths ended at cutover. Which is D6.

### 7b. T1 — what "absent, not gated" means in this code

Deletions reach the target through three sites, all read on 2026-09-09:

- **`detectPathKeyedMoves`** (`packages/core/src/domain-sync.ts:1929`) — absence and move
  correlation for path-keyed domains. This is where `deletions` come from for files.
- **the reported stream** (`domain-sync.ts:1700`) — a source that announces its own
  deletions, which is OneDrive's delta.
- **`applyDeletion` / `autoApplyRelocations`** (`packages/orchestration/src/orchestration.ts:528`,
  `:1078`) — the application, gated on `allowApplyDeletions`.

§4D rejects the third as the place to stop, and it is right to: `allowApplyDeletions` is a
gate, and a gate can be wrong once. **Absence means the first two are not called.** The pass
for a mapping in `isAfterCutover` is assembled without them, so there is no code path — not
even a disabled one — that can produce a deletion.

**The test that tells absent from gated**, which is the definition-of-done rule D4 added:

> Set `allowApplyDeletions: **true**` on a `continuous` mapping — the switch that normally
> enables everything above. Delete an item at the source. Run a pass. Assert the target copy
> is untouched **and that the pass reports `deletions: 0`**.

A gated implementation passes the first half and fails the second: it reports "1 detected, 0
applied". Only absence reports nothing detected. Turning the switch **on** is what makes the
test mean something — a test that leaves it off proves only that the default is off.

### 7c. T2 — the ledger cannot make this claim yet, and that is the whole task

T2 hands somebody a list they will delete on the strength of. §5's rule for the drain
applies with full force to the list as well, because the consequence is identical:

> Confirm by re-reading the target, comparing content hash — never "we wrote it and got a
> 200". The gate is the target's answer, not our memory of our own request.

What the ledger holds per item (`item`, `packages/ledger/src/schema-pg.ts`):
`contentHash` — **the source's hash at copy time**; `targetRef` and `targetVersion` — our
memory of our own write; `status`, `lastSyncedAt`. There is no target-side confirmation
anywhere in the row. `verification.ts` re-reads the target, but it is **sampled** (5% by
default, `checksumSamplePercentage`) and answers per domain, not per item. A sample cannot
tell one person which of their files is safe.

So T2 is not a query over existing data. It is a **confirmation pass** that re-reads the
target per item, plus somewhere to record what it found, plus the list.

Two item states need naming before the list can be honest:

- **`adopted`** — *"Already on the target under our natural key; nothing was written"*
  (migration 0017). We never wrote these and never hashed them. They are the most likely to
  be genuinely fine and the ones we have said least about.
- **`skipped`** and **`left_behind`** — never placed. They must not appear as confirmed, and
  a list that silently omits them tells somebody their library is smaller than it is.

**How much of the library that re-read touches is D7**, and it is a cost question, not a
correctness one — which is exactly why it is not settled here.

### 7d. What `item.content_hash` actually holds, and the one domain pair T2 cannot serve

Worth reading out of the tree rather than assumed, because T2's whole claim rests on it.
Traced 2026-09-09, and it took two wrong answers to get right — both recorded below, since
the wrong ones are the ones a reader would arrive at independently.

**The ledger column is written from ONE place per domain**, the `contentHash` function each
sync path injects into `runDomainSync` (`packages/core/src/domain-sync.ts:499`, applied at
`:1296` with the comment *"the target stores what we wrote, and §20 checksum sampling
compares against it"*):

| domain | injected at | what it is |
|---|---|---|
| files | `dav-sync.ts:392` | `fileContentHash` — **SHA-256** of the bytes actually fetched (`hash.ts:171`) |
| mail | `reconcile.ts:184` | `contentHash` — **SHA-256** of the RFC822 bytes (`hash.ts:136`) |
| calendar | `dav-sync.ts:110`, `:199` | `calendarContentHash` — a **canonical fingerprint**, not a hash of bytes |
| contacts | `dav-sync.ts:256` | `contactContentHash` — likewise |

So for **files and mail the column is our own SHA-256**, and it is the same SHA-256 that
`contentHashFor` computes off the target (`jmap-file-target.ts:828`,
`imapflow-dav-target.ts:739`). **T2's comparison is available and algorithm-safe.** That is
the useful finding, and it makes T2 easier rather than harder.

**For calendar and contacts there is no byte-hash claim to be made at all.** `hash.ts:143`
says why, and it is not a gap to be closed: *"CalDAV servers re-serialize what they store —
refolding lines, reordering properties, adding their own PRODID/VERSION/X- properties — so a
byte hash computed on the source can never equal one computed back off the target."*
`jmap-contact-target.ts:782` implements no `contentHashFor` for the same reason, deliberately
and with a note. **T2's list therefore holds two different kinds of claim**, and has to say
per row which one it is — "verified" cannot mean both.

> **Two corrections, kept rather than tidied away.** The first draft of this section asked
> what Drive, Dropbox and OneDrive publish; wrong side of the migration — those are sources,
> and `TARGET_TYPES` (`packages/shared/src/credential-fields.ts`) is
> `jmap, imap, caldav, carddav, webdav, soverin, nextcloud`. The second claimed the ledger
> column held five algorithms, one per source, and that T2 would be comparing MD5 to
> SHA-256. Also wrong: those provider hashes are set on the connectors' LISTING items, and
> the sync re-hashes the bytes it fetched before storing anything. Both errors read
> plausibly from a grep and are what a reader will conclude without following the injection
> through `runDomainSync`, which is why they are written down here instead of deleted.

**One loose end, traced rather than left open.** Four connectors populate
`FileItem.contentHash` from the provider's own algorithm — `google-drive-source.ts:802`
(MD5), `box-file-source.ts:384` (SHA-1), `dropbox-file-source.ts:408` (its block hash),
`graph-drive-source.ts:348` (quickXorHash, under the comment *"Use quickXorHash as content
hash for change detection"*). **Nothing reads it.** Change detection is
`classifyKnownItem` (`domain-sync.ts:295`), and it decides on topology and then
`sourceVersion` — `if (known.sourceVersion === sourceVersion) return 'skip'` — never on a
hash. The only consumer of a source item's `contentHash` anywhere is
`archive-file-source.ts`, which uses its own SHA-256 as an item identity.

Two consequences, neither T2's business, both worth someone's attention:

1. Those four connectors carry a field with no reader. Harmless, but `graph-drive-source.ts`
   states a purpose for it that is not what happens.
2. `google-drive-source.ts:799` justifies excluding Google-native files with *"with no
   checksum there is nothing to compare and every pass would look like a change"* — a
   mechanism this codebase does not use. **The exclusion is still right**, for the better
   reason 0116 gives: a native file has no bytes to download at all, only an export in a
   different format. The comment should say that, because the wrong reason is the kind that
   survives for years and misleads whoever next changes the listing.

Both are one-line comment fixes on a source connector, so they want their own change rather
than riding a workplan — flagged here, not done here.

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

**Added by D4 (2026-09-09), binding on T1 and T2:** a post-cutover deletion at the source
must leave the target copy in place, and the test must distinguish *absent* from *gated* —
it has to fail if the detector runs and its output is filtered, not only if the filter is
removed. Wiring the detector into a phase that keeps running is the regression this rule
exists to catch, and it is one someone will otherwise introduce while fixing something
else.

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
