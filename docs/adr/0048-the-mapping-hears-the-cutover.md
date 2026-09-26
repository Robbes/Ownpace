# ADR-0048: The mapping hears the cutover

- **Status:** **Accepted 2026-09-19** — the owner's pick the evening ADR-0047 recorded the gap
  ("Go ahead with the CLI cutover row"); **built 2026-09-20** as `enterCutover` and `closeCutover`
  in `@openmig/core`, the CLI over them, gated against a real ledger. **Amended 2026-09-24**: the
  grace period copies (workplan 0128 T2, the owner's D1 (a)); **2026-09-26**: a window per data
  type (0128 T5 slice 4, the owner's D8), and only the paths in the phase the mapping leaves move
  with it (slice 5a); see the amendments at the end.
- **Date:** 2026-09-19 (decided); 2026-09-20 (built)
- **Deciders:** owner
- **Relates to:** [ADR-0047](./0047-a-rollback-is-a-setback.md) (the rollback is the other half of
  this: what a cutover stops, a rollback resumes — and its consequences recorded this gap),
  [ADR-0026](./0026-one-operating-ui-one-contract.md) (lifecycle decisions live in
  `@openmig/shared` so both editions answer them identically), workplan 0117 D4 (after cutover the
  source is not the authority on what exists — the rule the mapping's lifecycle carries and the
  ledger does not), workplan 0109 T1 (every lifecycle write leaves a `mapping.status` record).
- **Relates to workplan:** [0101 T6](../workplans/0101-the-paths-no-gate-had-opened.md) — the
  finding and the build; [0009](../workplans/0009-cutover-integration.md) — the cutover CLI this
  completes.

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- The cutover ledger's **`execute`** (APPROVED → CUTOVER_IN_PROGRESS) and **`complete`**
  (GRACE_PERIOD → COMPLETED) write `mailbox_mapping.status` as well as the ledger. A mapping that
  is `active` or `paused` becomes **`cutover`**, and the source is no longer the authority on what
  exists. `cutover`, `continuous` and `done` are left where they are — `done` with a warning that
  a rollback will be refused for it.
- **A migration that was `active` at `execute` keeps being copied until the grace period ends**
  (amended 2026-09-24, workplan 0128 T2, the owner's D1 (a): "bounded by the grace period, and
  slotless"), under the after-cutover rules: what is new or changed is copied, no deletion is
  mirrored, and no slot is held. Then no pass runs. One that was `paused` stays stopped. `execute`
  records the answer on the ledger row (`copies_through_grace`, ledger migration 0064), and every
  gate asks `runsPassesNow` with the ledger's window: `CUTOVER_STILL_COPIES_WHERE` in SQL (the
  managed tick, the appliance), `cutoverStillCopiesAt` in TypeScript. Since 0128 T5 slice 2b the
  pass and the appliance ask it through the one reader's `anyRuns`, which also asks it of each
  data type's own row, so a data type kept in the lane runs after the migration's window closes.
  **Since slice 4 each data type has its own window** (amended 2026-09-26): its own cutover
  ledger row's (`cutover_state.domain`, ledger migration 0067), or the whole migration's where it
  has none. The tick schedules a migration while any of its windows is open, and its pass moves
  past each data type whose own window is closed.
- The decision is **`cutoverTransition` in `@openmig/shared`**, beside `rollbackTransition`, and
  the two agree row by row: whatever a cutover stops, a rollback puts back to `active`.
- **The mapping first, the ledger second**, and every refusal before either write — the order
  ADR-0047 set, for the same reason: the retryable write goes first, and CUTOVER_IN_PROGRESS beside
  a running mapping is the defect itself.
- The mapping write is recorded in `audit_log` as `mapping.status` with **`via: 'cutover'`**, in
  the same transaction as the row, by the same port the rollback writes through. **The mapping's
  paths move with it in that transaction** (corrected 2026-09-24): `execute` and `complete`
  release their slots, and a rollback takes them back, as the API's doors do (workplan 0109 T1b).
  Only the paths in the phase the mapping leaves move (amended 2026-09-26, 0128 T5 slice 5a),
  where its rows add up to its status: a data type in another phase keeps its own, so a pause or a
  start of the rest never moves one back that was cut over on its own.
- **`complete` closes the ledger, not the migration.** `done` is the end of the shadow sync, decided
  by `finishTransition` with its rule about unresolved failures, and it stays where that rule
  lives — the Finish page. After `complete` the mapping is `cutover` and the CLI says so.
- **A propagation timeout leaves the mapping `cutover`.** Whether the MX record moved is exactly
  what is unknown after a timeout, so no pass runs (FAILED is not a state that copies); `rollback`
  is the explicit undo and resumes the sync.
- The `run-cutover` job is prepare-only (it stops at READY_FOR_CUTOVER) and writes no lifecycle;
  the API executes no cutover. The operator CLI is the only executor, for both editions.

## Context

ADR-0047 built the one rollback and, in its consequences, recorded rather than fixed what it found
beside it: **the cutover flow itself never changed `mailbox_mapping.status`.** The CLI's `execute`
moved the ledger APPROVED → CUTOVER_IN_PROGRESS → GRACE_PERIOD and `complete` moved it to
COMPLETED, and neither touched the mapping. Only the lifecycle `PATCH` — the Finish page's own
declaration — ever wrote `cutover`.

That left three records of one event disagreeing. The **ledger** said the cutover was in progress.
The **mapping** said `active`: syncing, source authoritative. And the **passes** believed the
mapping, because that is what they read: the appliance's tick and the managed poller schedule by
`runsPasses`, and every pass reads `sourceAuthorityFor(status)` to decide whether the deletion
detectors are assembled. So a CLI-driven cutover ran with passes scheduled and detectors present,
reading a source that had just stopped being the authority on what exists — workplan 0117 §3a's
loop (a deletion the person makes on the old account after the switch, mirrored onto the new one),
with a ledger beside it saying the cutover was under way. 0117 D4 was decided precisely to close
that loop, and the CLI walked around it.

It also hollowed out ADR-0047 on the path that mattered most. The rollback's mapping half puts a
`cutover` mapping back to `active`; on a CLI-driven cutover the mapping was never `cutover`, so
the reachable rollback resumed nothing, correctly, and said so. The setback had one half.

## Decision

**The cutover ledger's two lifecycle-changing steps write the mapping, through one decision and
one port, in one order.**

The table, `cutoverTransition(status)`, read with `isAfterCutover` and `runsPasses` beside it:

| from | to | why |
|---|---|---|
| `active` | `cutover` | the shadow sync stops; the source is no longer the authority. The row this exists for |
| `paused` | `cutover` | somebody stopped it before the cutover. After the cutover the phase has moved on, and `paused` would let Start put it back to `active` — a pass with the detectors present, after cutover. The confirmation says the copy is not running; the operator decides, and a rollback afterwards resumes it |
| `cutover` | — | already stopped for a cutover: the Finish page's declaration, or a re-run. Converges (hard rule 1) |
| `continuous` | — | keeps copying after cutover by design (0117 T1), with the detectors absent; the source is already not the authority |
| `done` | — | finished; nothing runs. Left alone with a **warning**: a rollback is refused for a finished migration, so reverting this cutover later means a manual MX change |

Only an unknown status refuses (hard rule 9), and a refusal writes nothing — not the ledger either.

`enterCutover` performs the `execute` half (the mapping, then APPROVED → CUTOVER_IN_PROGRESS with
`stoppedSync` and `mappingStatus` in the event's metadata); the CLI then waits for the operator's
MX change to propagate and moves the ledger on to GRACE_PERIOD or FAILED as before. `closeCutover`
performs `complete` the same way (the mapping, then GRACE_PERIOD → COMPLETED), so a cutover
executed before this decision — ledger in its grace window, mapping still `active` — is stopped on
the way to a terminal state rather than left running behind it forever. Both live in
`packages/core/src/cutover-lifecycle.ts` beside `performRollback`, with the port they share.

## Consequences

- The rollback's "sync resumes" half now fires for a CLI-driven cutover. The round trip is gated
  on a real ledger: `enterCutover`, then `performRollback`, two audit rows (`via: 'cutover'`, then
  `via: 'rollback'`), the mapping back at `active`.
- An `active` mapping at rollback time is no longer the common case; it is a cutover executed
  before this ADR, or one the person never declared. `rollback-mechanisms.md` says so.
- **A paused sync is stopped for the cutover, and a rollback resumes it.** The `--yes` confirmation
  names it ("the copy is not running") before the operator approves, and the rollback's output
  names the resumption. An operator who paused for a reason that outlives the cutover pauses again.
- **The `--yes` confirmation lists the mapping half for THIS mapping**, as the rollback's does:
  "Stop the shadow sync: mapping … `'active'` → `'cutover'`", or "Leave mapping … `'continuous'`:
  it keeps copying after cutover by design".
- **The gate is the integration test, not the E2E smoke**, for ADR-0047's reason: APPROVED and
  GRACE_PERIOD need a verified data gate and real DNS propagation the smoke cannot manufacture.
  `apps/worker/src/cli/cutover-lifecycle.integration.test.ts` drives the real state machine, the
  real `CutoverStore` and the real `mappingLifecyclePort` against Postgres.
- The appliance is unaffected: it has no cutover state machine (ADR-0047), and the operator CLI
  is the one executor for both editions — which is why the decision sits in `shared` and the
  write in `core`, not in either app.
- **Correction, 2026-09-20:** this ADR and ADR-0047 called the lifecycle `PATCH` "the Finish
  page's own declaration" of `cutover`. Nothing in the web writes `cutover`: the Finish page
  reads it. The writers are the operator CLI (this ADR) and a raw `PUT /api/migrations/:id` —
  which, the same night, turned out to ask nobody at all: [ADR-0049](./0049-a-door-that-asked-nobody.md).
- Not done here, on purpose: **`done` at `complete`.** Finishing has a rule (unresolved failures
  block it, `force` overrides knowingly) and one door; a cutover command that finished the
  migration would be a second door with fewer rules — the objection ADR-0047 raised against
  un-finishing on rollback, mirrored.

## Alternatives considered

- **Refuse `execute` on a `paused` mapping** ("a cutover moves mail to a target the copy is not
  keeping up with"). Rejected: a refusal only holds while the operator is at the terminal — the
  Finish page can pause during the grace window too — and it leaves the Start door open after
  cutover, which is the accident D4 exists to prevent. Naming it in the confirmation closes the
  door and keeps the operator's call.
- **Put the mapping back to `active` on a propagation timeout.** Rejected: the MX record may have
  moved for some resolvers and not others; a pass during that window is the D4 loop. FAILED invites
  the rollback, which is the explicit undo.
- **Finish the migration at `complete`.** Rejected as above.
- **Leave `complete` alone; only `execute` writes.** Rejected: every cutover executed before this
  ADR sits in GRACE_PERIOD with an `active` mapping, and `complete` is the last command that will
  ever run on it. Closing a terminal ledger over a running sync would make the old defect
  permanent for exactly those migrations.
- **A separate port per door.** Rejected: one `mappingLifecyclePort` with the door (`via`) named
  per write keeps one audit shape and one transaction helper; two ports would be two places to
  forget the record.

## Amendment, 2026-09-24: the grace period copies

Workplan 0128 asked whether the sync can stay operational after the cutover, and the owner
answered D1 (a): *"bounded by the grace period, and slotless"*. Until then `execute` stopped every
pass at once, while `cutover-state.ts` defined the grace period as *"Both systems active,
monitoring for discrepancies"*. For those 72 hours, mail that still reached the old server while
the MX record propagated was copied by nothing, and so was anything edited in the old account.

**What changed.** From `execute` until the grace period ends, a migration that was `active` keeps
being scheduled, and a pass already running keeps going. It runs as a `cutover` pass always did,
after the cutover: the source is not the authority on what exists, so the deletion detectors are
absent (0117 D4), and nothing is deleted on the target because it went at the source. `cutover`
holds no slot (`holdsASlot`, ADR-0014), so the grace period adds no path to anyone's bill; what it
copies joins the data meter, as every first copy does. When the window closes, passes stop, and
the owner's own ending is still theirs: finishing, or the continuous lane.

**The window** is read from the ledger row. In `GRACE_PERIOD` it ends `grace_period_hours` after
`grace_period_started_at`. While `execute` still waits for the MX record (CUTOVER_IN_PROGRESS) it
ends as long after the row entered that state (`updated_at`), so a cutover whose `execute` never
finished cannot copy forever. COMPLETED, FAILED and ROLLED_BACK copy nothing. The answer depends
on the time, so no status word can say it: `runsPassesNow(status, cutoverStillCopies)` joins
`runsPasses`, and every gate that asked the status now asks it, in both editions: the managed
tick's query, the pass's re-read between data types, and the appliance's startup scan, per-pass
re-read and Sync now.

**A paused migration stays stopped.** This decision's table moves `paused` to `cutover` too, so
that Start cannot later resume it with the detectors present. Under D1 (a) alone, that migration
would have started copying at `execute`: something the operator had stopped, restarted by a
cutover. So `execute` decides, while it can still see the status the migration had, whether it
copies through the grace period (`keepsCopyingThroughGrace`: true for `active` only), and records
the answer on the ledger row in the same transition. A migration already `cutover` when `execute`
runs copies nothing through the grace period either. That covers a cutover declared before
`execute`, and a re-run of an `execute` whose first run moved the mapping and then failed before
the ledger write: nothing here can tell those two apart, so the answer is the one that copies
nothing nobody asked for. An owner who wants that migration copied after all has the continuous
lane, which is entered from `cutover`.

**Where it is said.** The `--yes` confirmation for `execute` now says, for this mapping, whether it
keeps copying until the grace period ends or stays stopped. `status` prints until when a cutover
still copies, from the ledger row. The Finish page's note for `cutover` said *"Still syncing until
you finish it"*, which had been false since this decision; it now says what happens.

Gates: `apps/worker/src/jobs/a-grace-period-that-copies.unit.test.ts` holds the SQL and the
TypeScript to one answer over every cutover state, both answers of `execute` and both sides of
the end. It drives the real `enterCutover` over the real store, and asks the tick's own query and
the pass's own re-read. `apps/selfhost/src/a-grace-period-that-copies.unit.test.ts` boots the
appliance in a grace period and presses Sync now on both sides of the end.

## Correction, 2026-09-24: the paths move with the mapping

The port this decision wrote through moved the mapping row and recorded it, and moved none of
its path rows. The API's doors have moved them since workplan 0109 T1b, and ADR-0014 bills by
them: a path in `cutover` holds no slot. So a cutover executed from the CLI kept every path
`active` and its slot held, through the grace period and after, and a rollback after it left
`cutover` rows beside an `active` mapping. Found while mapping workplan 0128 T3 and T4.

`applyMappingStatusChange` now moves the included paths in the same transaction as the row and
its record, by the one copy of the rule the API's helper uses too (`paths-follow-the-mapping.ts`
in the ledger). The month's peak is the managed edition's table, which the ledger does not
write: the API's doors record it as before, and entering the continuous lane now raises it too,
since the lane takes back the slots a cutover released. A rollback through the CLI is trued up
the next time the tier is read.

## Amendment, 2026-09-26: a window per data type (workplan 0128 T5, slice 4)

The owner's D8 splits the cutover per data type: mail can be cut over, copy through its grace
period and stop, while files keep running until their own cutover. Slice 4 gives each data type a
cutover ledger of its own, before anything writes one (that is slice 5's cutover of one data
type). `cutover_state` and `cutover_event` gain a `domain`, and the ledger's key becomes (tenant,
migration, data type) under its real name. A row with no data type is the whole migration's: every
row written before, and the ledger of each data type that has none of its own.

**What this decision's window rule becomes.** The window is still read from a ledger row, by the
same rule, and `copies_through_grace` is still set by `execute`, now on the row it moves. A data
type in `cutover` asks its own row's window, or the whole migration's where it has none
(`readCutoverWindows`, through `readPathPhases`). The managed tick asks whether any row of the
migration still copies, which is the reader's answer too: a pass it starts moves past each data
type whose own window is closed, and none open starts none. Until slice 5 every migration has
only the whole migration's row, so every answer is the one it was.

Gates: `packages/ledger/src/a-cutover-ledger-per-data-type.unit.test.ts` (the key, the store and
the window, on PGlite as `app_user`), and `apps/worker/src/jobs/a-grace-period-that-copies.unit.test.ts`,
which asks the tick's own query and the pass's step before each data type with a window per data
type.

## Amendment, 2026-09-26: only the paths in the phase the mapping leaves (workplan 0128 T5, slice 5a)

The correction above moved every included path with the mapping. That was right while every
path was in the mapping's phase, and it stops being right once a data type can be cut over on its
own (slice 5b): a pause or a start of the rest would move a cut-over data type back before its
cutover, where its deletion detectors come back (0117 D4). So one rule decides, for
every door that moves the mapping (`pathFollows`, in the ledger's `paths-follow-the-mapping.ts`):
where the mapping's rows add up to the status it leaves, only the paths in that phase move,
`done` ends every path, and a start also starts one that never ran; where they do not add up (a
status written alone), every path moves, as before, since the reader then believes the status for
every data type. Until slice 5b every path is in the mapping's phase, so every door moves the
paths it moved.

Gates: `packages/ledger/src/a-door-moves-only-its-own-paths.unit.test.ts` (the rule), and
`apps/api/src/routes/migrations/path-lifecycle-wiring.unit.test.ts`, which presses managed's
doors and the ledger's own on a migration whose mail was cut over on its own.
