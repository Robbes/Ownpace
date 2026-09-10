# Workplan 0117 — The conveyor belt, not the home

## Status — 2026-09-09 (update this block at the end of every session)

**2026-09-10, later still again: THE TWO HALVES DID NOT FIT, and finding that out
found a shipped bug.** Building slice 4 began by connecting the pass to the store, and
they would not connect — which is how both of these surfaced.

**1. The evidence never crossed the seam.** `confirmEach` yielded the derived
`ConfirmedRow`. The store records the `TargetAnswer`, deliberately (evidence, never the
word). So the answer was computed inside `confirmOne`, used to derive the row, and
dropped: there was no way to run the pass and record what it found. Two slices, built a
day apart, each correct on its own. `ConfirmedFinding` now carries `answer`, `row` and
`consulted` together.

`consulted` is the half that is easy to miss. Where `needsTargetRead` waives a status,
the answer is `NOT_CONSULTED` — a placeholder `rowFor` ignores, not something the target
said. A recorder that stored it would write *we looked and it is not there* about an item
nobody asked about.

**2. And the read side was already wrong, in a way nothing would have caught.**
`rowsFor` read every NULL answer as `unreachable`, so after a pass that completed
perfectly, all seven waived statuses still said **`unchecked`** — *we did not check*.
False twice: nothing needed checking, and the ledger already knew they were never placed.
On the one document somebody deletes their originals from, that turns a fact we hold into
an admission we do not, and pads the "could not tell" pile with rows never in doubt.

The fix is a condition rather than a different constant, because the other half stays
true: a `copied` row with no stored answer genuinely has not been looked at yet, and
`unchecked` is exactly right for it. Six mutations, all caught — including the shipped
bug restored verbatim.

**Worth keeping as a shape.** Both defects lived in the *gap between* two slices that were
each internally consistent and separately guarded. Neither guard could see them, because
neither slice was wrong. What found them was trying to use the two together.

**2026-09-10, evening: T2 SLICE 6 — the bytes are the tenant's (D9).**
`buildTargetWriterFromCredentials` takes neither a throttle limiter nor a meter,
so nothing that reads a TARGET has ever been budgeted. That was fine while
everything only wrote to one, an item at a time, behind a pass already gated on
the source. D7(a) reads a whole account off the target, so this is the first
thing that has to carry the target's side of the tenant's allowance — which is
the gap D9 names rather than a tidy-up.

**The split is 0090's, unchanged: the connector spends, the pass gates.**
`confirmation-reader.ts` spends what a body read cost and waits for a rate
token; `confirmation-run.ts` reads the meter and stops. One instance, two roles,
because only the loop can stop taking new work.

**Stopping matters more here than in a sync**, and that is the rule this slice
exists for. A confirmation that kept going on an exhausted budget would not
merely be slow: the reader's refusal becomes `unreachable`, so every remaining
item would be RECORDED as `unchecked` — *we asked and could not tell* about
items nobody asked about. A NULL answer is the honest state for an item nobody
looked at, and it is what the next pass finds work in.

**One decision that could have gone the other way, so it is pinned:** a domain
that costs nothing — calendar, contacts, tasks, which have no `contentHashFor`
at all (§7d) — stops too. Continuing it would be free, but a report that says
PAUSED beside a domain that quietly finished is a report somebody has to reason
about, on the document they delete their originals from.

**An unmeasured item counts ZERO rather than a guess.** `TargetEntry.sizeBytes`
is what lets a report say a measured number, and its own rule is to leave it
undefined rather than estimate. The meter therefore under-reads, which errs
toward finishing the pass rather than toward stopping a migration that had
budget left — the right direction when the wrong one costs somebody a
twenty-four hour lockout of their live account.

**Visible, per D9**, means the run row: the pause and its numbers ride in
`finishRun`'s stats, and the run still closes `succeeded`, because 0090 T4's
rule is that a scheduled stop is not a failure.

**And the shape was wrong once, which is the fourth time this plan has recorded
it.** `TargetBudget` was `{ meter, rate? }` first — the meter carrying the
`(tenant, provider)` key, the way `DownloadMeter` does. Starting slice 7 found
what that costs: **a target with no published byte ceiling then gets no RATE
limiting either**, because there is no meter to hang the key on. That is every
target this product writes to — a ceiling is a number somebody published, and
the only one we know is Gmail's IMAP download limit, which belongs to a SOURCE.
So the shape switched off the half of D9 that actually bites, on every
deployment, while looking wired. The key is now the carrier and both budgets
hang off it. Same lesson as #915 and #916, one layer up: the consumer found it,
nothing else could have.

Guard: `a-budget-the-confirmation-shares.unit.test.ts`, against a real database
— whether the un-asked rows keep their NULL answer is a fact about the `item`
table. **Ten mutations, all caught.** Two of them are only there because
something was missed: B5 (a domain that spends nothing runs on past the pause,
which nothing else noticed) and B10 (the key hanging off the meter, above).

**Not the route yet.** D9 said the budget lands *with* the route that starts a
pass, and the route is the next slice; the budget is here first because its
consumer — `runConfirmationPass` — already exists and is wired to it in this
same commit, which is the thing the last three seams did not have.

**2026-09-10, evening: T2 SLICE 5 — a real target, asked one item at a time.**
`readerOverTarget` is the bridge slice 2 said would be needed and would not be
`TargetReindexer` itself: that interface streams a whole account, this asks about
one item and has to survive one of them failing.

**One enumeration, then lookups.** `listEntries` is metadata-only and pages, so
walking it once and indexing by natural key beats N requests. The index holds
short strings, not bodies — the cost D7(a) authorised is the BODY fetch behind
`hashOnTarget`, one item at a time. The index is a SNAPSHOT, which is true rather
than merely convenient (nothing writes to the target during a pass) and is
written down instead of left to be discovered.

**The one rule that is not bookkeeping: a target we could not list is not an
empty target.** If `listEntries` throws, every item must read `unchecked`, never
`missing`. An unlistable target read as an empty one puts *we placed it and it is
gone* on every row of somebody's account at once — a whole library reported lost
by one failed request. Slice 2 encoded this for a single item; this is the same
rule one level up, where the blast radius is the account. The failure is captured
and re-thrown per item, which is exactly what `answerFor` turns into
`unreachable`.

**And the build does not throw**, deliberately: failing there would take the
whole pass down over one unlistable domain, when the honest outcome is that
domain's rows unchecked and the others untouched.

**`KEY_OF` is a total `Record`** over the five domains, because there is no
single hashing function — mail normalises a Message-ID, files take a path, the
DAV domains take a UID. A sixth domain is a compile error here rather than a
domain whose every item silently fails to match and reads as `missing`.

**§7d's ceiling now bites somewhere concrete.** `hashOnTarget` exists only when
the reindexer implements `contentHashFor`, and CalDAV/CardDAV deliberately do
not — so calendar, contacts and tasks come out `present`, never `verified`, and
the reason is one line of this file rather than a note in a survey.

Guard: `a-target-we-could-not-list.unit.test.ts`, driven THROUGH the real pass
rather than by poking the reader — the lesson of the last two slices is that a
piece built alone fits its own tests and not its consumer. **Seven mutations, all
caught**, the first being the whole account reading as `missing`. The seventh was
missed on the first run and is worth the line: `hashOnTarget`'s refusal cannot be
reached through the pass at all (`answerFor` asks `isPresent` first, which
refuses), so no test driven through the pass could ever prove it. An unreachable
safety net is the kind that rots, so that one branch is asserted directly — the
only place in this guard where the reader is poked without a reason given.

**2026-09-10, evening: THE DOOR IS OPEN — T5's sentence exists, and T1 slice 3
is built.** The lane has been a state nothing could enter since slice 1. The
condition on opening it was never technical: ADR-0014's amendment gave entering
a price, so somebody entering had to be TOLD their bill does not stop at
cutover, and that sentence was the owner's (D8, taken today, option (a)).

**The pricing page was publishing something the lane makes false**, which is the
part worth noticing: *"Finishing lowers your bill, automatically… the tier falls
on its own"* is true of every other ending and not of this one. So the fix was to
amend that paragraph in the same breath rather than add a note further down — a
correction three paragraphs later is not a correction — and the guard asserts the
two stay within three paragraphs of each other.

**Said twice, on purpose.** On the pricing page beside the promise it qualifies,
and in `lane.why` on the screen that offers the switch, because most people never
read a pricing page twice and the act happens on the screen. The door itself is
two presses: the first opens the sentence, the second acts. A single button with
the explanation beside it lets a fast reader enter without meeting it.

**The old guard was replaced, not deleted** — it said so itself: *"when the door
is built, widen the enum, and replace this test with one that asserts the customer
is told."* Six mutations, all caught: the enum narrowing again; the screen's
sentence reworded past saying it; the English `lane.why` deleted while the Dutch
survives; the pricing exception dropped; the exception drifting away from the
promise; the switch offered on an `active` migration, which would be offering
something already happening.

**D9 and D10 were taken the same day and are recorded in §6.** Neither was built
when this was written; **D9's budget was built the same evening** (slice 6
above), one slice ahead of the route rather than with it. D10's shape still
belongs with the list.

**2026-09-10, later again: T2 SLICE 4 — the job runs, and a second seam did not
fit either.** `runConfirmationPass` drives it: ledger rows in, `confirmEach` over
them, findings recorded, run row closed. It performs no provider I/O itself — the
`ConfirmationReader` is handed in, which is what lets it be tested against a real
database with a fake target, and leaves the adapter over the real connectors to
be built per domain.

**Three rules, each a way the list could lie.** The run row ALWAYS closes (0120):
a person who pressed a button is owed an answer, and "still going" three days
later is not one. Only a CONSULTED finding is recorded, so a waived status keeps
its NULL — #915's rule, and this is its first real caller. And what was confirmed
before a failure STAYS confirmed: fifty thousand answers already written are
fifty thousand real answers.

**The seam again, and this one had no consumer at all.** `confirmEach` yielded
`{ naturalKeyHash, …finding }`. The recorder writes against the LEDGER's id, and
`naturalKeyHash` is not it — so the only consumer that was ever going to exist
could not use it, and its only callers were its own tests. It is now generic:
the caller's row travels through and comes back beside the finding. That is the
second time in two slices a helper and its consumer did not fit, and both times
the helper was built first and looked complete.

**A property that was nearly asserted backwards.** The first draft of the guard
tested "a pass that dies" by making the TARGET throw. It does not die:
`answerFor` catches everything the reader throws and calls it `unreachable`
(slice 2's first rule, and why `unchecked` exists). A flaky provider produces
honest rows, not a failed job — and a later change that made a throwing target
fail the run would turn one bad afternoon into a job somebody has to start again
from nothing. What actually kills a pass is the LEDGER going away, and that is
what the guard now makes fail.

**The items stream in keyset pages**, ordered by `id` — not `LIMIT/OFFSET`,
which re-walks what it skipped and gets slower the further it gets, and not one
big `SELECT`, which exhausts memory on exactly the family file account D7(a)
authorised. Ordered by `id` rather than anything recognisable because the order
only has to be STABLE: `natural_key` is not unique across collections, and a page
boundary on a non-unique column silently drops or repeats rows.

Guard: `a-job-the-person-starts.unit.test.ts` on PGlite — real database, fake
target, which is the right way round. **Eight mutations, all caught**: a waived
item recorded anyway; the run row left running; a domain with no reader silently
counted; the pass arriving on a schedule rather than a press; the tally never
reaching the row; the stream stopping after one page; the stream repeating rows
(caught as a hang — that mutation never terminates); the stream ignoring its
domain.

**Still missing: the route and the list.** Nothing calls this yet, and there is
no adapter from a real target to `ConfirmationReader`. Both are the next slice.

**2026-09-10, later still: T2 SLICE 3 — the findings land, and what lands is
EVIDENCE.** Migration 0045 gives the pass somewhere to write: `item.confirmed_answer`
(five values, the ones `TargetAnswer` can distinguish), `confirmed_at`, and
`confirmed_by_run`. `ConfirmationStore` writes them and reads them back as rows.

**The column holds what the target SAID, never the word a person reads.** That is
the slice's one contestable decision and this plan argued it against itself: slice 1
shipped seven row states and slice 2 found an eighth (`unchecked`). Had slice 1's
derived words been persisted, every row written before that fix would still say
`missing` — *we placed it and it is gone* — about items that were merely unreachable,
on the one document somebody deletes their originals from. Evidence does not go stale;
an interpretation does, and this one has already been corrected once. So `rowFor`
derives the claim on every read, and a NULL answer reads as `{ unreachable: true }`
— *we did not look* — rather than as an absence.

**`confirm` is a seventh run kind, not a seventh table.** D7(a) made this *"a job the
person starts and we report on"*, which `run`/`run_event` already is: a row per
execution, `trigger: 'manual'` for one a person pressed, a status that always closes
(0120), an event log. Widening the vocabulary meant checking what moves with it —
this plan's own lesson — and there were three places: the CHECK constraint, the
drizzle enum, and `toRunReport`, which maps every kind but `incremental` to
`type: 'full'`. That inheritance is right here (D7(a) IS a full scan) and is now
asserted rather than left to luck.

**And one place that deliberately does NOT move: `BILLABLE_RUN_KINDS`.** The pass
re-reads the whole target, so the reflex is to meter it. `verify` is unmetered for the
same reason, and a meter running while somebody decides whether their data is safe to
delete would change the answer they give. The guard fails if `confirm` is ever added
to it.

Guard: `an-answer-a-later-word-would-have-frozen.unit.test.ts` on PGlite, **eight
mutations, all caught** — `unreachable` collapsing into absence; a NULL answer read as
"not on the target"; the store writing the derived word; the CHECK accepting any
string; an unknown stored value coercing rather than throwing; `confirm` becoming
billable; the answer written without its timestamp; the run table refusing the kind.

**Still missing after this: nothing starts a confirmation run.** No route, no job. That
is deliberate — the place and the vocabulary are reviewable before anything can offer
somebody a button whose output they will delete on the strength of.

**2026-09-10, later: T2 SLICE 2 — and the discipline paid twice.** `confirmation-pass.ts`
turns ledger rows into `ConfirmedRow`s, every one through `rowFor`, and building it found
what slice 1's vocabulary could not say. §7e records both findings; the short version is
that `TargetAnswer` could say *there* and *not there* and had no way to say *we could not
tell*, so a timeout had nowhere to go but `missing` — the loudest row on the page somebody
deletes their originals from, produced by a network blip. D7(a)'s cost half is
`needsTargetRead`: seven of the ten statuses are decided without a request, and the guard
asserts *why that is safe* rather than assuming it.

**2026-09-10: T2 SLICE 1 — the vocabulary before the machinery.** T1 slice 2 is merged,
so the lane runs and deletes nothing; T2 is the list somebody deletes on the strength of,
and its first slice is `packages/shared/src/confirmed-list.ts`: **what a row is allowed to
claim**, with no I/O in it at all.

Built first, deliberately. The failure mode here is not a pass that crashes — it is a pass
that **succeeds and says the wrong word**, which no integration test catches because the
machinery worked perfectly. So the words exist, and are guarded, before anything can
produce them.

- **Two claim kinds, and the word must not travel.** `byte-hash` for files and mail (our
  SHA-256 both sides, §7d); `fingerprint` for calendar, contacts and tasks (a DAV server
  re-serialises, so the comparison is real and the word "hash" is not). The claim never
  exceeds the domain's ceiling: two strings agreeing does not make them bytes.
- **Seven row states**, and the split between `present`, `differs` and `never-placed` is
  the point: "we did not check", "we checked and it is wrong" and "it was never put there"
  are three different things, and a list that renders any two the same way is a list
  somebody deletes the wrong folder on.
- **§7c's `adopted` paragraph was wrong and is corrected below** — two different rows wear
  that status, and one of them is *expected* to differ from the ledger. This is the finding
  of the slice.

Guard: `a-list-somebody-deletes-on-the-strength-of.unit.test.ts`, eleven mutations, all
caught — including the naive adopted comparison, a never-placed row confirmed because the
re-read happened to match, tasks inheriting the file answer, and an uncomparable re-read
scored as a pass.

**2026-09-10: T1 SLICE 2 BUILT — the lane runs, and the deletion detectors are absent from
it.** D4's rule now has code under it rather than a predicate waiting for one.

**Four run gates, one predicate.** `status === 'active'` appeared four times in code that
cannot see itself: the appliance's startup scan, the status re-read before every firing, the
`POST /mappings/{id}/run` route, and the managed tick's `WHERE m.status = 'active'` in SQL.
All four now ask `runsPasses`, and the SQL reads `PASS_RUNNING_STATES` as a parameter. Widen
three of four and you get a migration that copies on a tick and refuses the button — or one
that copies for self-host customers and stands still for managed ones, which is the edition
split hard rule 5 forbids in the half where nobody is watching.

**The pass carries its phase, and the detectors are not built for it.**
`sourceIsAuthorityOnExistence` is a REQUIRED field on every domain's deps
(`!isAfterCutover(status)`, read from the mapping's own row — never from a config file and
never from a caller's opinion). When it is false, all three deletion producers are
unreachable: the reported hrefs are not collected, the bin closure is stripped from the deps
before the loop ever sees it, and `detectPathKeyedMoves` is not called.

**§7b's survey said "three sites" and named two detectors. There are three**, and the one it
missed is the one the mail domain depends on entirely:

| producer | what it is | domain |
|---|---|---|
| `removed` from `listSince` | the source announcing its own removals | calendar, contacts, OneDrive files |
| **`listDiscardedKeys`** | the owner's BIN — positive evidence a person deleted something | **mail's only evidence**, and files |
| `detectPathKeyedMoves` | absence-counting, and move correlation with it | files |

§7d is amended below. The guard tests each producer separately, and each scenario runs twice
— once before cutover, where the signal MUST be seen — so "nothing was detected" can never be
an accident of the fixture.

**One consequence, said out loud rather than discovered.** Moves go with the third producer,
because they are the same correlation: a move is a disappearance matched to an arrival, and
the disappearance is the deletion signal. So **after cutover, a file the person moves at the
source is copied to its new place and the old copy stays** — the target holds two. A
duplicate is the safe side of this trade; the alternative is `applyRelocation` removing a
copy from somebody's new home because they reorganised the old one, which is the operation D4
forbids wearing a different name. This belongs in T5's words beside the deletion sentence.

**A bug this found in its own first run, worth keeping.** `withSides` originally dropped the
bin closure with a conditional spread — `...deps` followed by
`...(deps.listDiscardedKeys && authority ? {…} : {})`. That does not work: a conditional
spread can OVERRIDE a key, it cannot DELETE one the earlier spread already put there. The
false branch contributed nothing, the closure survived, and the bin scan ran after cutover
exactly as before. The guard caught it on its first run, which is precisely why it asserts
per producer rather than on a total.

**Slice 3 (the door) stays parked**, and its shape is unchanged: nothing can enter the lane
until the customer is told their bill does not stop at cutover (ADR-0014, amended
2026-09-10), and that sentence is T5's and is the owner's. The `PATCH` route still admits
four of the five states, pinned by a test that says it is meant to be edited once, by
whoever builds that door.

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
| T1 The continuous lane | ✅ **Slices 1–3 built 2026-09-10.** The lane exists in every vocabulary, runs with the deletion detectors absent, and can now be ENTERED: `PATCH /api/migrations/:id` admits `continuous`, offered on the Finish page from `cutover` or `done`, behind two presses and the sentence D8 settled. | A mapping that keeps copying after cutover, **deleting nothing**. Its first design constraint is D4's rule: the deletion detector does not run in this phase at all. Proof obligation is the refusal, not the copy. |
| T2 The confirmed list | 🔨 **Slices 1–6 built 2026-09-10**: what a row may claim, the machinery, migration 0045 + the store, the job that runs it, `readerOverTarget` — a real target asked one item at a time — and D9's budget, shared with the migration and stopping the pass rather than painting the rest `unchecked`. Three seams did not fit when connected and all three are recorded in §7e. **Left: the route that starts a pass and the list itself (where D10 lands).** | "These N items are in your new home, verified by hash." No deletion by us — §3b's trap is closed by D4. |
| T3 The drain | ⏸️ **Deferred by D1 (2026-09-09)** | Removal at the source. Revisit once T1 has run against real accounts for a while — the owner's own condition, and the plan's recommendation. D2 (which platform) and D3 (the window) are parked with it. |
| T4 The attributed tombstone | ⏸️ **Deferred with T3** | A deletion we caused is not a deletion we observed. §3's second wall — needed only once something of ours deletes. |
| T5 The words | 🔨 **The lane's half done 2026-09-10** (D8): the pricing page's "finishing lowers your bill" paragraph gained the exception beside it, and `lane.*` says it again where the switch is — including that deletions at the source stop being mirrored. The drain's consent (D5) defers with T3. **Left: T2's half** — the list must say what "verified" covers before anybody deletes on the strength of it (D10 settled its shape). | A person must be told that a mapping keeps copying after cutover, that deletions at the source are no longer mirrored and why, and what "verified" covers. |

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

### D8 — T5's sentence, and what the lane costs (TAKEN 2026-09-10)

The question put to the owner: the lane holds a slot (D6), but `pricing.md`
publishes *"Finishing lowers your bill, automatically… the tier falls on its own"*
— which the lane makes **false as published**. So this was never "add a
sentence"; it was "decide what the lane costs, then correct a live promise".

Three shapes were offered: **(a)** the full slot D6 already decided; (b) a
reduced belt rate; (c) free while a real migration also runs.

> ✅ **(a), as recommended.** *"1: a"*

The recommendation's reasoning, kept because it is the reason the other two were
not taken: the machine really is working every month, (a) was already coded, and
(b)/(c) buy a kinder sentence by spending the page's two-numbers-decide-your-tier
simplicity, which is its main asset.

**Built the same day**, and the shape of the telling matters as much as the
words: the exception sits BESIDE the promise it qualifies, not in a footnote,
and it is repeated on the screen that offers the switch — because most people
never read a pricing page twice, and the act happens on the screen.

### D9 — does a confirmation pass share the migration's budget? (TAKEN 2026-09-10)

D7(a) re-reads every item's BYTES off the target. 0090 already built byte-aware
daily budgets and refuse-before-the-lockout. So: one budget or two?

> ✅ **(a) it shares the tenant's budget.** *"2: a"*

The limit belongs to the PROVIDER, not to us, so splitting it into two budgets
is pretending we have twice the allowance we do. The cost is real and is
accepted: a large confirmation will slow a migration running at the same time.
That slowdown must be **visible** rather than avoided — a person who pressed
"confirm everything" and finds their copying crawling deserves to see why.

**Not yet built.** This lands with the route that starts a pass (T2's next
slice); until something can start one, there is nothing to budget.

### D10 — what the confirmed list shows, and who may see it (TAKEN 2026-09-10)

Two halves, both put to the owner because both are about what a person is owed
rather than what is cheap.

**How much.** A list of a hundred thousand verified files is unusable; §7c warns
that silently omitting rows "tells somebody their library is smaller than it is".

> ✅ **(a): a headline count, every row that is NOT verified, the total stated,
> and a full export.** *"3: a, the recommended"*

Nothing is omitted from the account — the total says how many there are — and
what is on screen is the part somebody can act on.

**Who.** Does 0122's view-link holder — somebody with no account — see it?

> ✅ **(a): no.** *"view-link holder: a"*

The view link carries counts and states; a per-item list is CONTENT, and that is
the rule the link was built on (0122 §2). Same shape as 0122 T8, which is
deferred for the same reason: it is a question about authority, not about API.

**Not yet built**, and it belongs with the list itself.

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
  (migration 0017).

  > **Corrected 2026-09-10 (T2 slice 1), and the correction changes the design.** This
  > paragraph used to end *"We never wrote these and never hashed them."* Read out of
  > `domain-sync.ts`, that is wrong on both halves, and **two different rows wear the
  > status**:
  >
  > - **adopted at first sight** (`:1426`, `status: result.adopted ? 'adopted' : …`) — the
  >   target already held an item under our natural key, so nothing was written; but the
  >   source item HAD been fetched and hashed, and `contentHash: ch` on that row is our
  >   SHA-256 of the SOURCE's bytes.
  > - **adopted by conflict** (`:1399`, `recordUpdate({ ...rewriteOf!, status: 'adopted' })`)
  >   — we wrote this item once, the customer has since edited our copy, and hard rule 2
  >   leaves it alone. The row keeps the `contentHash` of what **we** wrote, and the target
  >   has deliberately moved away from it.
  >
  > The ledger cannot tell the two apart after the fact: same status, same columns. So the
  > naive comparison — `item.contentHash` against a re-read — answers a different question
  > for each, and for the second it is **expected to differ**. A list that ran it would
  > report a customer's own edited file as changed, in the one document where alarm is most
  > expensive.
  >
  > Hence the row state `yours`: on the target, and the bytes are the customer's. True of
  > both shapes, it is what the person needs before deleting, and it claims nothing it
  > cannot support. An adopted row is therefore **never `verified`**.
- **`skipped`** and **`left_behind`** — never placed. They must not appear as confirmed, and
  a list that silently omits them tells somebody their library is smaller than it is.

**How much of the library that re-read touches is D7**, and it is a cost question, not a
correctness one — which is exactly why it is not settled here.

### 7e. What building the pass found that writing the words did not (2026-09-10)

Slice 1 built the vocabulary first on the grounds that the dangerous failure is a pass which
succeeds and says the wrong word. Slice 2 proved the point from the other side: the machinery
found two things the words were missing, and both are about the same reader.

**1. There was no way to say "we could not tell".** `TargetAnswer` had two arms — on the
target, and not on it — so a timeout, a 500 or a dropped connection had nowhere to go but
`{ onTarget: false }`, which `rowFor` reads as **`missing`**: *we placed it and it is gone.*
That is the loudest row on the list, on the document somebody deletes their originals from,
produced by a network blip. `ports.ts` already states the rule for the write side —
*"treating an outage as absence is how a removal gets authorised by a broken network"* — and
this is the same rule on the reading side, where the consequence is worse: on the write side
the product acts, and here a person does.

So `{ unreachable: true }` and the row state **`unchecked`**, honoured **before** the status
switch. That ordering is deliberate and guarded: `skipped` would answer `never-placed` from
the ledger alone and be right, and the list would then quietly mix rows we checked with rows
we did not.

**2. D7's cost half needed a boundary, and the boundary needed a reason.**
`needsTargetRead(status)` waives seven of the ten statuses: nothing was placed, the bytes are
the customer's, or we removed our own copy. Reading the target for those would spend a
request per item to learn nothing, on the one pass whose cost was a decision.

What makes that safe is not obvious and is therefore asserted: **wherever the waiver applies,
`rowFor` produces the same row for every answer the target could have given.** The guard
sweeps it. A mutation that made `needsTargetRead` demand a read for `skipped` slipped through
the first version of that test — because `unreachable` alone made every status look
answer-dependent — and a second mutation showed the pass's own `try/catch` swallowing a
throwing test sentinel, so the "we did not read the target" assertion passed while the read
happened. Both are fixed and both are recorded here, because the harness found them and
review would not have.

**One thing this does NOT change: the `fingerprint` ceiling is currently unreachable.**
`claimCeilingFor` says calendar, contacts and tasks may claim `fingerprint`, and no target
implements a canonical-fingerprint read-back — `contentHashFor` is deliberately absent for
CalDAV and CardDAV (§7d). So those rows come out `present`, never `verified`, and the
headline count is files and mail. That is correct rather than a gap: the ceiling is a ceiling,
and nothing may claim up to it that cannot reach it.

### 7d. What `item.content_hash` actually holds, and the one domain pair T2 cannot serve

Worth reading out of the tree rather than assumed, because T2's whole claim rests on it.
Traced 2026-09-09, and it took two wrong answers to get right — both recorded below, since
the wrong ones are the ones a reader would arrive at independently.

> **Amended 2026-09-10 (T1 slice 2).** The paragraph below is about the CONTENT HASH and
> stands. What §7b said about DETECTION does not: it named two detectors and there are
> three. The owner's bin (`listDiscardedKeys`) is the third, and it is the mail domain's
> only deletion evidence — so "the first two are not called" was one short of the rule.
> All three are now absent after cutover, each with its own test.

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
