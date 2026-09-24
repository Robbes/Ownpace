# Workplan 0128 — The cutover that keeps copying

> **In one line:** The cutover (`run-cutover`, `cutover-gate.ts`): a final sync over every data type via `run-delta-sync`, passes during the grace period, a cutover per data type (`path_lifecycle`), ending or keeping each data type in the continuous lane, and per-data-type stop and resume on both editions.

## Status — 2026-09-24 (update this block at the end of every session)

**2026-09-24, night: T5's second slice, first half (2a): path rows everyone can trust.** Slice 2
is split in two. 2a writes the rows and changes no gate; 2b, now that slice 1 is in, has the
reader read them. Nothing reads these rows for a gate yet, so no pass behaves differently.
- **Ledger migration 0065** gives every migration that has started its path rows, from its own
  status. `active` and `continuous` always get them. `paused` gets them only once it has run a
  pass, since one that never ran is a draft, and a draft's paths are `ready`: free, and absent.
  `cutover` and `done` get them released, `ended_at` at the migration's last change.
  `first_activated_at` is the first pass, or the creation. A row that exists is left alone.
  Until now, only migrations started through the managed API's doors since 2026-08-30 had rows.
- **The appliance** writes its scope rows from its configuration at every start-up, `included`
  as the file has it: a switched-off data type names itself, but is not a path. Then it gives
  its paths their rows by the same rule (`pathsFromTheMapping`, one migration at a time). Its
  Start and Finish go through the ledger's own door (`applyMappingStatusChange`): the status,
  its paths and an audit record in one transaction. Until now they wrote a raw UPDATE that
  moved no path and left no record.
- **Not in 2a, and why:**
  - *`slotsHeld` limited to selected data types*: nothing deselects a path. A stop is kept beside
    the phase (D6), and the one writer of `included = false` is the appliance, which has no bill.
  - *A path audit record*: while every path moves with its migration, the migration's own record
    says it, and a row per path would repeat it. It comes with slice 3, where a path first moves
    on its own.
- **For 2b, decided here so it is not forgotten:** the appliance's Finish tells its operator to
  set the status back by hand to resume, which leaves the path rows behind. So when the rows'
  roll-up disagrees with the migration's status, the reader believes the status. That is
  today's answer, and it never gives back a deletion detector a cutover took away.

Evidence:
- the migration on a database migrated to 0064 and filled, then taken to the end of the chain;
  and `pathsFromTheMapping` on the same rows, migration by migration: the same rows, over a draft,
  a paused migration that ran, one running with no pass yet, a cutover, a finished one, one in the
  lane, a switched-off data type and a row that already existed (3); `recordScope` (1);
- the appliance on PGlite (3): the scope rows at start-up and none for a draft; Start and Finish
  moving the paths with a record of each; an older migration's rows at the next start-up;
- every appliance, ledger, orchestration and guard test (293 files, 3,707 tests).

**2026-09-24, night: T5's first slice built. A pass asks each data type its own phase.** Nothing
changes yet: until a data type can have a phase of its own, every one has the migration's. The
readers go in first, so that no gate can meet a cut-over data type it does not understand.
- **The rules** are in shared (`path-phase.ts`: `PathPhase`, `pathRunsNow`,
  `pathSourceAuthority`). `phasesOfTheMigration` is today's answer for every data type.
- **The one reader** is in the ledger (`readPathPhases`). It reads the migration's row and its
  cutover's grace window. It is the function that will learn to read path rows in slice 2.
- **The managed pass** asks before each data type (`passStepBefore`):
  - stop, when the migration no longer runs or its grant was withdrawn;
  - move on past a data type that no longer runs while the others do, so files are not
    stopped with mail;
  - run it otherwise.
- **Both managed builders** take the deletion answer from their own data type's phase, through
  the reader.
- **The appliance's pass** reads every data type's phase once, and asks that one reading both
  questions: whether each data type still runs, moving on past one that does not, as the managed
  pass does; and whether its source still decides what exists.
- **The standalone worker** keeps running the configuration it is handed, with the migration's
  phase. It has never refused a pass for the migration's state, and gains no refusal.
- **Left for slice 2, on purpose:** the managed tick and the appliance's own gates (its pass's
  first check, its schedule at start-up and its run-now door) still ask whether the migration
  runs. Until a data type can be cut over on its own, that is the same question as whether any of
  its data types runs, so they learn the second with the rows. §3's *one snapshot per pass* is
  refined to *one answer per data type per pass*: the managed pass's stop check reads again
  before each data type, as it always has, to see a Pause or a withdrawn grant.

Evidence:
- the rules (5), the reader on PGlite as `app_user` (9), the pass's decision and its loop (6),
  and the appliance's pass (4): each data type its own answer, moving on past one that no longer
  runs, and the standalone worker's run unchanged;
- the guard on the builders now requires each answer to come from a data type's phase, and pins
  that every builder and the appliance ask the one reader, the appliance both questions of one
  reading;
- the unit suites of every package touched, and the integration tests of the stop check, a
  cutover without mail and a withdrawn grant, on Postgres 16;
- 22 mutations, all killed.

**2026-09-24, evening: the owner answered the five questions for T3 and T4, and split the
cutover.** *"1a 2a 3a 4a 5a. But for 5a: this is only after cutover and we need to split up
cutover, since someone might want to keep syncing some kinds, like keeps files running, while
email cutover/stops."* D3 to D7 record the five answers (§4), each the recommended one. D8 is the
split: a cutover happens **per data type**, so mail can be cut over and stop after its grace
period while files keep running as an ordinary sync, and are cut over on their own day. That is
the grain workplan 0109 T1c extracted and left for the owner; it continues here as T5, and T3's
ending is decided per data type with it (§3). T5 is designed before any code (§3), because MX
switching, the grace period and rollback are the product's most safety-critical machinery: a
path's phase in `path_lifecycle`, a cutover ledger per data type, the migration's status as a
roll-up, and seven slices with the readers first, so no gate can meet a data type it does not
yet understand. T4 is the third slice and T3 the last.

**2026-09-23: opened from the owner's answers.** Two things came out of one conversation about
the cutover.

1. **The cutover's final sync copies mail only.** This was found on 2026-09-22 while checking the
   owner's Google → Nextcloud migration. The owner acknowledged the advice: the final sync runs
   the pass the scheduler runs, over every data type the migration has, and the gate verifies
   those same data types (T1).
2. **The owner's question:** *"reason on if the sync can first stay operational, and one will
   decide after the successful cutover to 1) end the migration or 2) keep syncing (for example if
   someone moves MX before he/she ends contacts). At step 2 (Keep syncing) one might need to be
   able to deactivate kinds, like mail, to explicit keep sync for files and contacts. That is like
   similar to when one keeps android and contacts in Google, while wanting all contact reasonable
   fresh in the target elsewhere."* It can, and §2 says why it is safe. This plan answers in three
   parts (T2–T4), two of which wait on the owner (§4).

**2026-09-24, T1 built.** The preparation's final sync is `run-delta-sync` itself: the job
triggers it and waits, on the migration's own queue, so a scheduled pass already running
finishes first and the two never overlap. The pass now reports what each data type did, and
where it stopped early (`final-sync.ts`). The job logs a count per data type. When the pass did
not finish a data type, because it stopped at its deadline or at the day's download budget, or
the migration was paused before it, the job names it and stops short of ready
(`FinalSyncNotFinished`, recorded once like a gate verdict). So is a pass that failed outright:
it has already been retried by its own task, and retrying the whole preparation would run it
three times more against the source's daily quota. The target is behind the source then, and
verifying it would call a stale copy current. Both gates, the job's and the operator's `verify`,
are now one function (`cutover-gate.ts`). It verifies the data types the migration selected and
no others, so a data type it does not have reads SKIPPED as not part of it, and it no longer
builds the mail source and target, which it never used. That build is what refused a migration
without mail. A Microsoft → Nextcloud migration of calendars, contacts and files is now prepared
and verified like any other (`a-cutover-without-mail.integration.test.ts`, run against Postgres
16). Guards: `a-final-sync-of-every-data-type` (16) and that integration test (4); the
preparation's integration tests read the new report; 23 mutations, all killed.

**2026-09-24: the owner decided both.** *"D1 a (recommended), D2 c (recommended)"*. D1 (a): passes
keep running through the grace period, bounded by it, and slotless. D2 (c): a stopped data type
keeps its slot while the migration is `active` and releases it in the continuous lane. T3 and T4
are unblocked.

**2026-09-24, T2 built.** From execute until the grace period ends, a migration that was `active`
keeps being copied, under the after-cutover rules: new and changed items are copied, no deletion
is mirrored, and no slot is held (what it copies joins the data meter, as every first copy does).
Then no pass runs, and the owner's ending stays theirs. The
window is read from the cutover's ledger row: in `GRACE_PERIOD`, `grace_period_hours` after
`grace_period_started_at`; while execute waits for the MX record, as long after the row entered
CUTOVER_IN_PROGRESS, so an execute that never finished cannot copy forever. The rule is said once
in SQL (`CUTOVER_STILL_COPIES_WHERE`, ledger) and once in TypeScript (`cutoverStillCopiesAt`,
shared), and `runsPassesNow` joins `runsPasses`. Every gate that read the status alone now asks
it, on both editions: the managed tick's query, the pass's re-read between data types, and the
appliance's startup scan, per-pass re-read and Sync now. **One decision taken in the build:** a
migration the operator had paused stays stopped. ADR-0048 moves a paused migration to `cutover`
at execute too, and D1 (a) alone would have restarted its copying. So execute records, while it
can still see the status, whether the migration copies through the grace period
(`cutover_state.copies_through_grace`, ledger migration 0064): true for `active` only. The
`--yes` confirmation and `status` say which it is, for this mapping. ADR-0048 is amended. The
Finish page's note for `cutover` said *"Still syncing until you finish it"*, which had been false
since ADR-0048; it now says what happens. Guards: `a-grace-period-that-copies` in the worker (46),
on PGlite: the SQL and the TypeScript hold one answer over every cutover state, both answers of
execute and both sides of the end; the real execute over the real store; the tick's own query and
the pass's own re-read. The same name in the appliance (1) boots it on both sides of the end: the
startup scan, Sync now, and the pass's re-read. The execute step and the CLI's sentences are
extended. 34 mutations, all killed; the one that first survived, the store's insert branch, now has
its test.

| Task | Status | Notes |
|---|---|---|
| T1 The final sync covers every data type | ✅ **Built 2026-09-24** | §3. The pass the scheduler runs, not a mail reconcile of its own; the gate verifies the same data types, and a migration without mail no longer fails on email. |
| T2 Passes keep running through the grace period | ✅ **Built 2026-09-24** (D1 (a)) | §3. From execute until the grace period ends, a migration that was `active` keeps being copied under the after-cutover rules, which is what the grace period's own definition promises. A paused one stays stopped. |
| T3 The ending is a choice: end, or keep copying which data types | 📋 **Decided: D3, D5, D7**; with T5 | §3. Where a migration ends, *End the migration* and *Keep copying* stand side by side, and keeping asks which data types continue. Keep enters the lane in one press on step 4's attestation (D3); the grace period's end is said on the Finish page and in the digest (D7). With D8 the ending is chosen per data type, at that data type's cutover. |
| T4 A data type can be stopped and resumed | 📋 **Decided: D2 (c), D4, D5, D6**; next | §3. The managed half of 0125 T7, with the same word: the copies stay, they no longer follow the source, and resuming continues where it stopped. A stopped data type keeps its slot while `active` and releases it in the continuous lane. The appliance gets the same (D4); the last data type still copying cannot be stopped (D5); a stopped one is not verified (D6). |
| T5 A cutover per data type | 🟡 **Decided: D8**; designed 2026-09-24; slice 1 (the readers) built the same night | §3. Mail can be cut over, and stop after its grace period, while files keep running as an ordinary sync until their own cutover. 0109 T1c's grain, extracted there for this decision. Seven slices, readers first; T4 is the third and T3 the last. |

## 1. What happens today

The cutover is the operator's procedure for moving a mail domain (`run-cutover` in
`apps/worker/src/jobs/run-cutover.ts`, and `apps/worker/src/cli/cutover-commands.ts`):

1. **prepare**: a final sync, then the verification gate, stopping at `READY_FOR_CUTOVER`;
2. **approve**;
3. **execute**: the mapping becomes `cutover`, and the cutover ledger moves to
   `CUTOVER_IN_PROGRESS` and then `GRACE_PERIOD`, 72 hours by default
   (`gracePeriodDurationHours`);
4. the MX record is switched by hand;
5. **complete**.

It runs from the command line or the API (`POST /api/migrations/:id/cutover`). The web app has
no button for it: `mappingApi.triggerCutover` has no caller. The web app's own ending is the
Finish checklist (ADR-0026). Its final pass is the ordinary pass (`requestFinalPass` →
`run-delta-sync`), which already covers every data type.

Three facts decide the rest.

- **The final sync is mail only** *(until 2026-09-24, when T1 was built)*. `prepareCutover`'s `runFinalSync` builds
  `buildDepsFromMapping` and runs `runShadowPass`, the mail reconcile. On a migration with more
  than mail, calendars, contacts, files and tasks that changed since the last scheduled pass are
  not in it. On a migration without mail, building the mail target refuses
  (`refuseDomainTheTargetCannotCarry('mail', kind)`), so preparation fails at its first step,
  with a sentence about email nobody selected. The gate builds `buildDepsFromMapping` first as
  well, and fails the same way.
- **Nothing is copied after execute** *(until 2026-09-24, when T2 was built)*. `runsPasses` is `active | continuous`, so a mapping in
  `cutover` is never scheduled, and a manual pass answers 409. Yet `cutover-state.ts` defines the
  grace period as *"Both systems active, monitoring for discrepancies"*. For those 72 hours, mail
  that still reaches the old server while the MX change propagates is copied only if the owner
  later enters the continuous lane, and never if they finish. So is anything edited in the old
  account in that time.
- **Keeping on copying is all or nothing.** The continuous lane (0117 T1) is entered from
  `cutover` or `done`, and it runs every data type the migration has. Contacts cannot keep flowing
  while mail stops. After the MX move the old mailbox receives next to nothing. Once its account
  is closed, every mail pass fails, while the contacts the owner wanted kept fresh are still in
  Google.

## 2. Why the sync can keep running after the cutover

0117 did the hard part. After cutover the source is no longer the authority on what exists
(0117 D4). In every state `isAfterCutover` names, the deletion detectors are absent rather than
gated, and `cutover` is one of those states. A pass in that mode copies what is new and what
changed at the source, and never mirrors a deletion. The continuous lane runs exactly that way
today. So T2 adds no new kind of pass: it changes **when** the existing one runs.

**What it costs.** `cutover` holds no slot (`holdsASlot`, ADR-0014). A grace period with passes
running is short and bounded: a courtesy, not a lane. When it ends, passes stop as they do today
unless the owner chose to keep copying. The continuous lane holds a slot (0117 D6, D8). So T2
does not change what anybody pays.

## 3. The tasks

### T1 — the final sync covers every data type (decided)

The final sync runs the pass the scheduler runs, which is the per-data-type loop in
`run-delta-sync` over `enabledDomains`, rather than a mail reconcile of its own. The gate verifies
the same data types, and builds only what the migration has. A test drives a cutover preparation
of a calendar, contacts and files migration through the real preparation step: before the change
it fails on email, and after it the final sync reports a count per data type.

### T2 — passes keep running through the grace period (decided: D1 (a); built 2026-09-24)

From execute until the grace period ends, the migration keeps being scheduled, under the
after-cutover rules. That is what the grace period's own definition promises, and it is exactly
the window in which mail still reaches the old server. When the grace period ends and the owner
has chosen nothing, passes stop as they do today. Nothing is ended for them, and T3's choice
stays open.

For the build: the rule depends on the time, which `runsPasses` cannot read from a status word
alone. The appliance's tick and the managed poller's query (`PASS_RUNNING_STATES`) both need the
grace period's end. The ledger row holds it as `grace_period_started_at` plus
`grace_period_hours`; `gracePeriodEndsAt` on the status was never filled. One rule says it for
both: `runsPassesNow`, with `CUTOVER_STILL_COPIES_WHERE` as its SQL, held in step by one test.

Built with one more rule, because ADR-0048 moves a paused migration to `cutover` at execute too:
only a migration that was `active` at execute copies through the grace period. The operator who
paused one did not ask for it to start again.

### T3 — the ending is a choice (decided with T4)

Wherever a migration ends, which means the Finish checklist's last step, and the end of the grace
period, the owner gets two answers side by side:

- **End the migration**: `done`. Passes stop, the slot is released, and what is copied stays.
- **Keep copying**: the continuous lane, under the after-cutover rules. It holds a slot, and the
  offer carries D8's sentence as it does now. Keeping asks **which data types** continue, with
  all of them ticked, so mail can be left out while contacts and calendars keep flowing.

Today the lane is a second step after finishing, and it takes every data type at once.

**Decided 2026-09-24 (D3, D7, D8).** *Keep copying* enters the lane in one press, on the
attestation step 4 already asks for, and open failures do not block it (D3). When a grace period
ends and nobody chose, copying stops, and the Finish page and the digest say so (D7). And the
ending is chosen **per data type** (D8): the Finish checklist lists the migration's data types,
each with its own *End* and *Keep copying*, and asks step 4 (moving delivery) for mail only. A data
type still running is simply not ended yet. T5 is what makes a data type's ending its own.

### T4 — stop and resume a data type (decided: D2 (c))

On a running migration (`active` or `continuous`), each data type can be **stopped** and
**resumed** from the migration page, beside the add panel (0125 T6). Stopped means what 0125 T7
makes it mean on the appliance, with the same word. The copies stay, the record stays, they no
longer follow the source, and resuming continues where it stopped. This is the part of the
owner's example that T3 alone does not cover. Mail can be stopped later, on the day the old
mailbox closes, without touching the rest.

It revisits 0125 T6's *adding only*. That decision refused removal because nothing decided what
the copies of a removed data type then are. 0125 T7 decides it now: they are stopped, the
product says so, and they can be resumed. A stop is not the removal T6 refused; it is a pause for one data type.

The word already exists (0125 T7, built 2026-09-23): `migration_status.state = 'stopped'`
(migration 0057), which the progress strip, the Finish checklist and the completion report
render in both editions. T4 is the managed writer, and one difference from the appliance: a
data type the owner stops on purpose is stopped even with nothing copied yet.

**Decided 2026-09-24 (D4, D5, D6).** The appliance gets the same, with the stop kept in its own
database rather than in its configuration file (D4). The last data type still copying cannot be
stopped: the refusal points at *End the migration* (D5). A stopped data type is not verified by
the Finish checklist, which says *stopped by you* (D6). The stop is kept per path, beside the
path's phase (T5), and not in `migration_status`, which is pass state that every pass rewrites.

### T5 — a cutover per data type (decided: D8)

**What changes.** Today a migration has one lifecycle (`mailbox_mapping.status`) and one cutover
ledger (`cutover_state`, one row per migration), and every gate reads them. After T5 each data
type, a *path* in ADR-0014's word, has its own phase and its own cutover: mail can be cut over,
copy through its grace period and stop, while files keep running as an ordinary sync until
their own cutover.

**The model.**
- **A path's phase lives in `path_lifecycle.state`**, one row per migration and data type. It is
  already there, in both editions, with ADR-0014's words (active, paused, cutover, done,
  continuous) and row security, and migration 0035 kept it in the shared chain so that a cutover
  per data type would never be a paid feature. Today it records billing only. After T5 it is the
  truth every gate reads: whether that data type's passes run, whether its source still decides
  what exists (the deletion detectors), whether its shares may be announced, and its slot.
- **Each data type has its own cutover ledger.** `cutover_state` and `cutover_event` gain a
  `domain`, and the unique key becomes (tenant, migration, data type). The state machine is
  unchanged. The grace window and `copies_through_grace` are per row. Mail keeps the DNS check
  and the wait for the MX record; the other data types have neither.
- **The migration's status becomes a roll-up**, written with every path change by one shared
  function, so the lists, the digest and the dashboard keep working: `paused` while the owner
  holds the whole migration, `active` while any data type is before its cutover, `cutover` once
  every data type is at or past its cutover and one is in it, `continuous` once every data type
  has ended or is kept, with one kept, and `done` when every data type has ended.
- **What stays per migration:** creating and starting it, the whole-migration Pause (a hold on
  everything that still runs, not a stop), a grant's withdrawal, the schedule, the run and its
  queue, the connections.

**The safety rules, before any code.**
- **Readers before writers.** Every gate must read a data type's phase before any data type can
  have a phase of its own. Otherwise mail that was cut over would meet a gate still reading the
  migration as `active`, and the deletion detectors would come back for it.
- **One answer per data type per pass.** A data type's phase is read once for its turn in a pass
  and holds for the whole of it, so a data type cannot change its answer halfway through its own
  copy. The appliance reads every data type's phase once, when its pass starts. The managed pass
  reads each one when its turn comes, because its stop check has always read the migration again
  before each data type, to see a Pause or a withdrawn grant. The builder's reading is the later
  one, so the deletion answer follows the phase as it is when the copy starts (slice 1).
- **No row is not `ready`.** For billing, a missing path row means `ready`, and holds nothing.
  For a gate that would be wrong: every migration activated before 2026-08-30, and every
  appliance migration, has no rows. A gate falls back to the migration's own status, and the rows
  are backfilled from it.
- **Shares per data type.** `share_grant.subject` already says which data type a share belongs to
  (`drive_item`, `calendar`, `mailbox`), so each share waits for its own data type's cutover, and
  each data type's shares are announced once, then (D8).

**Taken from earlier answers, so not asked again.** Every data type gets the grace period, 72
hours by default: D1 (a) is about what "both systems active" promises, and that holds for files
as much as for mail. *Complete* closes a data type's ledger and leaves the data type in `cutover`
until its owner chooses (ADR-0048, D7). The whole-migration Pause stays, and is offered only while
something still runs before its cutover (it fixes the Pause offered on a `continuous` migration,
which is always refused). A data type can be added while any data type is still before its
cutover; once every one is past it, a new data type is a new migration, as today.

**Found while mapping it, to fix on the way.**
- The unique key's real name is `cutover_state_tenant_id_mapping_id_key`
  (`0001_baseline.sql`); the Drizzle schema calls it `uk_cutover_state_mapping`, so a migration
  that dropped it by that name would silently drop nothing.
- The share gate allows `done` only, where ADR-0032 says *done or cutover*.
- `slotsHeld` counts path rows without asking whether the data type is still selected. Nothing
  deselects one today, but a stop must not strand a slot.
- The appliance writes no path rows and no scope rows, and its Start and Finish write the status
  with raw SQL, with no audit record.
- The CLI's `--domain` is the mail domain, so the data type's flag is `--kind`.

**The order, one pull request each.**
1. **The readers**, with no change in behaviour: every data type's phase, today each equal to the
   migration's status, read by one reader (`readPathPhases`) and threaded through the managed
   pass and its stop check (which moves past a data type that no longer runs rather than stopping
   the whole pass), the dependency builders' source authority, and the appliance's pass, which
   moves past one the same way. *Built 2026-09-24.*
2. **Path rows everyone can trust:** a backfill from the migration's status, the appliance writing
   its scope and path rows and moving its status through the ledger's own door with an audit
   record, a path audit record, and `slotsHeld` limited to selected data types. Then the reader
   reads the rows, and the managed tick and the appliance's own gates (its pass's first check,
   its schedule at start-up, its run-now door) ask whether any data type runs, rather than
   whether the migration does. Until slice 5 the two are the same answer.
3. **T4**, stop and resume a data type, on that record (D2 (c), D4, D5, D6).
4. **The cutover ledger per data type:** the `domain` column, the key replaced by its real name,
   the store and the grace window per data type, old rows read as the whole migration.
5. **The cutover per data type:** `--kind` on the CLI, the cutover and rollback transitions per
   path, and `POST /api/migrations/:id/cutover` taking the data type; its final sync and its gate
   cover that data type only; DNS and MX for mail only.
6. **Shares per data type**, announced once at each data type's cutover.
7. **T3 on the Finish page**, per data type: *End* and *Keep copying* each, step 4 for mail only,
   the lane per data type, the appliance's missing lane route (D4), and the grace period's end in
   the digest (D7).

ADR-0048, ADR-0047, ADR-0049, ADR-0032, ADR-0014's consequence 4 and 0117 D4 are amended with the
slice that changes each of their rules.

## 4. Decisions for the owner

**D1 — keep copying through the grace period (T2)?** **Decided 2026-09-24: (a)**, *"D1 a
(recommended)"*.

- **(a) Yes, bounded by the grace period, and slotless.** *Recommended.* It catches the mail
  that arrives during the MX change, keeps what "both systems active" promises, and changes no
  price.
- **(b) Yes, until the owner chooses, however long that takes.** A free continuous lane for
  anyone who never chooses.
- **(c) No.** Keep today's stop at execute, and rely on T3's choice being made quickly.

**D2 — does a stopped data type keep its slot (T4)?** **Decided 2026-09-24: (c)**, *"D2 c
(recommended)"*. Pausing keeps its slot on purpose: it is
reserved capacity, and the pricing page says so. The case that motivates a stop is different.
The mail of an account that no longer exists will never be resumed, and billing a slot for it for as long
as contacts keep flowing would charge for nothing.

- **(a) It releases its slot.** Simple, and fair to the dead mailbox. The side effect is that
  stopping every data type becomes a pause that costs nothing.
- **(b) It keeps its slot, like a pause.** Simple, but the dead mailbox is billed for as long as
  the contacts flow.
- **(c) It keeps its slot while the migration is `active`, and releases it in the continuous
  lane.** *Recommended.* Before cutover, a stop is usually short, for example a data type that
  keeps failing while the rest finishes. That is what a pause is for, and a pause keeps its slot.
  After cutover, a stop is usually for good. The tier reads the month's peak (0109 T2), so
  stopping and resuming within a month cannot lower a bill. It needs one sentence on the pricing
  page, beside D8's.

**D3 — Keep copying at the Finish checklist's last step (T3)?** **Decided 2026-09-24: (a)**,
*"1a"*. Step 5 usually finds the migration still running. *Keep copying* stands beside *End* and
enters the continuous lane in one press, on the attestation step 4 already asked for
(*"Delivery now goes to the new system"*), as *End* does, recorded as a cutover and then the
lane. Open failures block *End* unless it is forced; they do not block *Keep*, which goes on
retrying them. (b) was to keep the lane a second press after finishing.

**D4 — the appliance (T3, T4)?** **Decided 2026-09-24: (a)**, *"2a"*. The appliance gets the same
choice, data types included, with a stopped data type kept in its own database. Its *Keep
copying* button fails today: it calls a route the appliance does not serve, and is answered 404.
(b) was managed only, with the appliance's button hidden until then.

**D5 — stopping the last data type still copying (T4)?** **Decided 2026-09-24: (a)**, *"3a"*.
Refused, with a pointer to *End the migration*. (b) was to allow a migration with everything
stopped, which under D2 (c) would go on holding its slots while `active`, for nothing.

**D6 — verifying a stopped data type (T4)?** **Decided 2026-09-24: (a)**, *"4a"*. The Finish
checklist's check that everything arrived skips it and says *stopped by you*. (b) was to go on
checking it against a source it no longer follows, where it falls behind and shows as missing.

**D7 — the grace period ends and nobody chose (T3)?** **Decided 2026-09-24: (a)**, *"5a"*, with
the owner's note that it applies after a cutover only. Copying stops then (T2), and the owner is
told on the Finish page and in the organisation's *what needs attention* digest (0030). (b) was
the Finish page only.

**D8 — one cutover per migration, or one per data type?** **Decided 2026-09-24: per data type**,
the owner's own addition: *"we need to split up cutover, since someone might want to keep
syncing some kinds, like keeps files running, while email cutover/stops."* It answers the
question 0109 T1c extracted and left for the owner. That question was about workplan 0104's rule
that a cutover announces **once**: shares held back during the migration are created on the
target at the cutover, and the platform's own mail goes out in one wave, never per file. Per data
type, the rule holds for each of them: a data type's shares are announced once, at that data
type's cutover. Mail carries no shares. So the moment is the one the owner chooses for each data
type, and never a trickle.

## Not in this plan

- Two-way sync, or writing back to the old account.
- Removing anything at the source: that is 0117 T3, the drain, deferred by 0117 D1.
- A button for the operator's cutover procedure in the web app. The Finish checklist is the web
  app's ending (ADR-0026), and T3 changes its last step, not its order.
