# ADR-0048: The mapping hears the cutover

- **Status:** Accepted 2026-09-19; built 2026-09-20; amended six times and corrected twice, latest
  2026-09-27 (workplan 0128); consolidated 2026-10-03 (ADR-0051)
- **Date:** 2026-09-19 (decided); 2026-09-20 (built); consolidated 2026-10-03
- **Deciders:** owner
- **Relates to:** [ADR-0047](./0047-a-rollback-is-a-setback.md) (the rollback, the other half),
  [ADR-0049](./0049-a-door-that-asked-nobody.md), [ADR-0014](./0014-cost-recovery-billing.md)
  (slots); workplans [0101 T6](../workplans/0101-the-paths-no-gate-had-opened.md),
  [0128](../workplans/0128-the-cutover-that-keeps-copying.md), [0009](../workplans/0009-cutover-integration.md)
- **History:** the record as it read before consolidation, word for word —
  [history/0048-the-mapping-hears-the-cutover.md](./history/0048-the-mapping-hears-the-cutover.md)

## Operative rules

<!-- What holds NOW, within the ADR-0051 budget: 8 bullets, 60 words a bullet, 250 words in
     all. Amend in place when a later decision changes it, then regenerate OPERATIVE.md:
     node scripts/adr-operative.mjs --write -->

- **`execute` and `complete` write the mapping as well as the ledger**: `active` or `paused`
  becomes `cutover`; `cutover`, `continuous`, `done` stay. Decided by `cutoverTransition`
  (shared), the mirror of `rollbackTransition`. Guard: `cutover-lifecycle.integration.test.ts`.
- **The mapping first, the ledger second, every refusal before either write.** Row, paths and a
  `mapping.status` record (`via: 'cutover'`) commit together; only paths in the phase the mapping
  leaves move (`pathFollows`). See *One transaction, and the paths*.
- **A migration `active` at `execute` copies until its grace period ends**, mirroring no deletion
  and holding no slot; a `paused` one stays stopped. Gates ask `runsPassesNow` with the ledger's
  window. Guard: `a-grace-period-that-copies.unit.test.ts`; see *The window rule*.
- **A data type can be cut over on its own** (`--kind`): its own ledger and path, the
  migration's status their roll-up; only mail waits for DNS. Whole and per-type cutovers never
  overlap (`cutoverBeginRefusal`). See *One data type cut over on its own*.
- **`complete` closes the ledger, not the migration.** Each data type is then ended (`done`,
  refused over its unresolved failures unless forced) or kept copying, by `endOrKeepPath`; one
  whose grace period ended unchosen is named on the Finish page and in the digest (D7).
- **A propagation timeout leaves the mapping `cutover`** and the ledger FAILED: no pass runs, and
  `rollback` is the explicit undo. Guard: `cutover-commands.unit.test.ts`.
- **The operator CLI is the only executor, for both editions.** `run-cutover` and `POST …/cutover`
  only prepare (to READY_FOR_CUTOVER) and write no lifecycle. Guard:
  `cutover-preparation.integration.test.ts`.

## Context

ADR-0047 built the one rollback and recorded what it found beside it: **the cutover flow never
changed `mailbox_mapping.status`.** The CLI's `execute` and `complete` moved the cutover ledger and
left the mapping `active`. The passes believed the mapping: they are scheduled by `runsPasses`,
and each assembles the deletion detectors by `sourceAuthorityFor(status)`. So a CLI-driven cutover
ran with passes scheduled and detectors present, reading a source that had just stopped being the
authority on what exists. That is workplan 0117 §3a's loop (a deletion the person makes on the old
account after the switch, mirrored onto the new one), which
[0117 D4](../workplans/0117-the-conveyor-belt-not-the-home.md) was decided to close. And the
rollback, which puts a `cutover` mapping back to `active`, found nothing to resume.

The owner picked the fix on 2026-09-19, the evening ADR-0047 recorded the gap: *"Go ahead with
the CLI cutover row."* Workplan 0128 later made the grace period copy (D1 (a)) and made a cutover,
and its ending, each data type's own (D8, D3, D7).

## Decision

**The cutover ledger's two lifecycle-changing steps write the mapping, through one decision and
one port, in one order.** A cutover copies through its grace period, and a cutover and its ending
are each data type's own.

### The mapping half

`cutoverTransition(status)` sits in `@openmig/shared` beside `rollbackTransition`, so both editions
answer it identically (ADR-0026), and the two agree row by row: whatever a cutover stops, a
rollback puts back to `active`.

| from | to | why |
|---|---|---|
| `active` | `cutover` | the source is no longer the authority. The row this exists for |
| `paused` | `cutover` | `paused` would let Start put it back to `active` after cutover, detectors present. The confirmation says it is not copying; a rollback resumes it |
| `cutover` | — | already stopped for a cutover, or a re-run. Converges (hard rule 1) |
| `continuous` | — | copies after cutover by design (0117 T1), detectors absent |
| `done` | — | finished. Left alone with a **warning**: a rollback is refused for it, so reverting this cutover means a manual MX change |

Only an unknown status refuses (hard rule 9), and a refusal writes nothing, not the ledger either.

### The two steps, in one order

`enterCutover` performs `execute`'s half: the mapping, then APPROVED → CUTOVER_IN_PROGRESS, with
`stoppedSync`, `mappingStatus` and `copiesThroughGrace` in the event's metadata. The CLI then waits
for the operator's MX change to propagate and moves the ledger to GRACE_PERIOD. `closeCutover`
performs `complete` (the mapping, then GRACE_PERIOD → COMPLETED), so a cutover executed before this
decision, its mapping still `active`, is stopped before its ledger closes. Both are in
`packages/core/src/cutover-lifecycle.ts`, sharing their port with `performRollback`.

**The mapping first, the ledger second, every refusal before either write** (ADR-0047's order): a
mapping moved beside a ledger still APPROVED is a state a re-run finishes; CUTOVER_IN_PROGRESS
beside a running mapping is the defect itself.

**A propagation timeout leaves the mapping `cutover`** and the ledger FAILED. Whether the MX record
moved is exactly what is unknown, so no pass runs; `rollback` is the explicit undo, and resumes the
sync.

**`complete` closes the ledger, not the migration.** `done` is decided by `finishTransition`, with
its rule about unresolved failures, on the Finish page. After `complete` the mapping, or the data
type, is `cutover`, and the CLI says so.

### One transaction, and the paths

The write goes through `mappingLifecyclePort` (ledger), the rollback's port: the row, its paths and
an `audit_log` record, `mapping.status` with **`via: 'cutover'`**, in one transaction
(`applyMappingStatusChange`; workplan 0109 T1).

The paths follow one rule at every door (`pathFollows`, `paths-follow-the-mapping.ts`; 0109 T1b).
Where the path rows add up to the status the mapping leaves, only the paths in that phase move,
`done` ends every path, and a start also starts one that never ran. Where they do not (a status
written alone), every path moves. So a pause or a start of the rest never moves a data type cut
over on its own back before its cutover, where its deletion detectors return (0117 D4).

A `cutover` path holds no slot (`holdsASlot`, ADR-0014): `execute` and `complete` release slots,
and a rollback takes them back. The month's peak is the managed edition's table, which the ledger
does not write: the API's doors raise it, entering the continuous lane included, and the CLI and
the `run-rollback` job pass `onSlotsTaken`, so the peak rises in the transaction that takes the
slots, where the database keeps one (0109 T2).

### The grace period copies

The owner, 2026-09-24, D1 (a): *"bounded by the grace period, and slotless"*. The grace period
promises both systems active, and while the MX record propagates, mail still reaches the old
server. So from `execute` until the grace period ends, a migration that was `active` keeps being
scheduled, and a running pass keeps going, under the after-cutover rules: no deletion detectors,
so nothing is deleted on the target because it went at the source, and no slot held. What it
copies joins the data meter. When the window closes, passes stop; finishing, or the lane, stays
the owner's.

**A paused migration stays stopped.** `execute` decides while it still sees the status
(`keepsCopyingThroughGrace`: `active` only) and records the answer on the ledger row in the same
transition (`copies_through_grace`, ledger migration 0064). A migration already `cutover` at
`execute` (declared earlier, or a re-run after a failed ledger write; nothing tells the two apart)
copies nothing nobody asked for. The continuous lane, entered from `cutover`, is its way to keep
copying.

### The window rule

A window is a cutover ledger row's. In GRACE_PERIOD it ends `grace_period_hours` after
`grace_period_started_at`; in CUTOVER_IN_PROGRESS, as long after `updated_at`, so an `execute`
that never finished cannot copy forever. COMPLETED, FAILED and ROLLED_BACK copy nothing.
`cutover_state` and `cutover_event` carry a `domain` (ledger migration 0067; the key is tenant,
migration, data type), and a data type's window is its own row's, or the whole migration's (no
data type) where it has none.

The answer depends on the time, so every gate asks `runsPassesNow(status, cutoverStillCopies)`:
`CUTOVER_STILL_COPIES_WHERE` in SQL, `cutoverStillCopiesAt` in TypeScript. The managed tick
schedules a migration while any of its windows is open. The managed pass and the appliance's
startup scan, per-pass re-read and Sync now ask the one reader's `anyRuns` (`readPathPhases`,
`readCutoverWindows`): a pass moves past each data type whose own window is closed, and a data type
kept in the lane runs after the migration's window closes.

### One data type cut over on its own (the 5b amendment)

The owner's D8: mail can be cut over and stop while files run on until their own cutover. `--kind
<data type>` runs `enterCutover` and `closeCutover` unchanged over one data type's own ledger
(`bindCutoverLedger`) and own path (`pathLifecyclePort`), decided by `cutoverTransition` asked of
the path's phase, moved alone and recorded as `path.phase`. The migration's status is its paths'
roll-up, recorded as `mapping.status` when it moves: mail cut over beside running calendars is an
`active` migration with mail's path in `cutover`; with every data type cut over, it is `cutover`.

Only mail has DNS: `execute` for any other data type enters the grace period at once. A data
type's own cutover does not begin while the whole migration's is under way, nor the whole
migration's once a data type has its own (`cutoverBeginRefusal`, core): in the CLI, the managed
preparation and its door, and the store. The managed preparation takes a data type
(`POST /api/migrations/:id/cutover` with a `domain`, slice 5c): its own ledger, final sync and
gate, and only a data type the migration carries. Approval and execution stay the CLI's.

### One data type ended or kept on its own (the 2026-09-26 amendment, slice 7a)

The owner's D3 and D8. `complete` leaves its data type in `cutover`; then, on the Finish page,
*End* makes it `done` and *Keep copying* puts it in the lane (`continuous`). One door decides and
writes both, for both editions (`endOrKeepPath`, the ledger's `an-ending-per-data-type.ts`; behind
`POST …/domains/{domain}/end` and `…/keep`). End is refused over the data type's own unresolved
failures unless forced, as `finishTransition` refuses Finish, and a forced End is recorded as
forced. Before its cutover either press is its cutover too, on step 4's attestation (D3): End is
one move; Keep is recorded as the cutover, then the lane. The migration's status is the roll-up,
in the same transaction: `done` once every data type has ended.

A press on the whole migration moves only the paths in the phase it leaves, and the owner settled
what that means on 2026-09-27 (0128 D9 and D10, both (a)): a whole rollback leaves a data type kept
on its own in the lane, and the whole *Keep copying* leaves one ended on its own ended.

### A grace period that ended while nobody chose (D7)

The owner's D7: copying stops (above), and the owner is told on the Finish page and in the
organisation's *what needs attention* digest. When it ended is one rule (`cutoverGraceEndedAt`,
shared): in GRACE_PERIOD once its hours from the start have passed; in COMPLETED when it was
closed. The ledger reads it per cutover ledger (`readGraceEnds`) onto each data type still in its
cutover (`graceEndedAt`), and the digest names those (`readGraceEndedWithoutAChoice`). A data type
ended or kept has chosen, and nothing is said of it.

### Where it is said, and who executes

The `--yes` confirmation names the mapping half for this mapping: whether it keeps copying until
the grace period ends or stays stopped, that the shadow sync stops at `complete`, or why it is
left alone. `status` prints the lifecycle and until when a cutover still copies. The Finish page's
note for `cutover` says that, if it was running, it copies until the grace period ends.

`run-cutover` is prepare-only (it stops at READY_FOR_CUTOVER) and writes no lifecycle; the API
executes no cutover. The operator CLI is the only executor, for both editions, which is why the
decision sits in `shared` and the write in `core` and the ledger, not in either app.

## Consequences

- The rollback's "sync resumes" half fires for a CLI-driven cutover. The round trip is gated on a
  real ledger (`cutover-lifecycle.integration.test.ts`, worker): `enterCutover`, then
  `performRollback`, two audit rows (`via: 'cutover'`, then `via: 'rollback'`), the mapping back
  at `active`. Not the E2E smoke, for ADR-0047's reason: APPROVED and GRACE_PERIOD need a verified
  data gate and real DNS propagation the smoke cannot manufacture.
- An `active` mapping at rollback time is now a cutover executed before this decision, or one
  never declared. [rollback-mechanisms.md](../rollback-mechanisms.md) says so.
- A rollback resumes a migration that was paused at `execute`. An operator who paused for a reason
  that outlives the cutover pauses again.
- The appliance executes no cutover of its own. It asks the same gates, so its migrations copy
  through a grace period, and it serves each data type's End and Keep through the same door.
- **Who declares `cutover` (correction, 2026-09-20).** This ADR and ADR-0047 first called the
  lifecycle `PATCH` "the Finish page's own declaration". Nothing in the web declares `cutover`: the
  Finish page reads it. The writers are the operator CLI (this decision) and a raw
  `PUT /api/migrations/:id`, which asked nobody until [ADR-0049](./0049-a-door-that-asked-nobody.md).
  Since slice 7a, a data type's End or Keep pressed before its cutover is that data type's
  cutover, recorded as one.
- Guards for the rules added since 2026-09-24: `a-grace-period-that-copies` (worker and
  appliance); `a-cutover-ledger-per-data-type`, `a-door-moves-only-its-own-paths`,
  `a-cutover-of-one-data-type`, `an-ending-per-data-type`, `a-grace-period-nobody-chose` (ledger);
  `path-lifecycle-wiring`, `a-data-type-ended-or-kept` (API); `who-may-begin-a-cutover` (core);
  `a-grace-period-that-ended`, `a-grace-period-the-digest-names` (shared).

## Alternatives considered

- **Refuse `execute` on a `paused` mapping** ("a cutover moves mail to a target the copy is not
  keeping up with"). Rejected: a refusal only holds while the operator is at the terminal (the
  Finish page can pause during the grace window too), and it leaves the Start door open after
  cutover, the accident D4 exists to prevent. Naming it in the confirmation closes the door and
  keeps the operator's call.
- **Put the mapping back to `active` on a propagation timeout.** Rejected: the MX record may have
  moved for some resolvers and not others, and a pass then is the D4 loop. FAILED invites the
  rollback, the explicit undo.
- **Finish the migration at `complete`.** Rejected: finishing has a rule (unresolved failures block
  it, `force` overrides knowingly) and one door; a cutover command that finished the migration
  would be a second door with fewer rules, the objection ADR-0047 raised against un-finishing on
  rollback, mirrored.
- **Leave `complete` alone; only `execute` writes.** Rejected: every cutover executed before this
  decision sits in GRACE_PERIOD with an `active` mapping, and `complete` is the last command that
  will run on it. Closing a terminal ledger over a running sync would make the defect permanent
  for exactly those migrations.
- **A separate port per door.** Rejected: one `mappingLifecyclePort`, with the door (`via`) named
  per write, keeps one audit shape and one transaction helper; two ports would be two places to
  forget the record.
- **Stop every pass at `execute`** (this decision as first built). Replaced by D1 (a): for the
  grace period's 72 hours, mail that still reached the old server while the MX record propagated,
  and anything edited in the old account, was copied by nothing.
- **Copy a paused migration through the grace period too** (D1 (a) alone). Rejected: a cutover
  would restart what the operator had stopped.
- **Move every included path with the mapping, always** (the 2026-09-24 correction's rule).
  Replaced once a data type can be cut over on its own: a pause or a start of the rest would move
  a cut-over data type back before its cutover, where its deletion detectors come back.
- **Begin the whole migration's cutover beside a data type's own.** Refused by
  `cutoverBeginRefusal`: a whole rollback would move back a data type cut over on its own, and the
  tick's question, whether any ledger row still copies, would stop being each data type's.
- **Let a press on the whole migration undo a data type's own ending** (0128 D9 (b), D10 (b)): a
  whole rollback taking a kept data type out of the lane, or the whole *Keep copying* bringing an
  ended one back. Rejected by the owner: that data type was kept or ended on purpose (mail ends
  because the old mailbox closes), and a rollback is about the cutover that went wrong.

## Amendment log

- **2026-09-19** — accepted by the owner; built 2026-09-20 as `enterCutover` and `closeCutover`
  and the CLI over them, gated on a real ledger (workplan 0101 T6). Record: the *Status* entry
  and *Decision*.
- **2026-09-20** — correction: the Finish page never declared `cutover` (found with ADR-0049).
  Record: the "Correction, 2026-09-20" bullet in *Consequences*. Now in *Consequences*.
- **2026-09-24** — the grace period copies (0128 T2, the owner's D1 (a)); extended in place the
  same day by slice 2b (the gates ask through `anyRuns`, in the second operative rule). Record:
  *Amendment, 2026-09-24: the grace period copies*. Now *The grace period copies* and *The window
  rule*.
- **2026-09-24** — correction: the paths move with the mapping (found mapping 0128 T3 and T4).
  Record: *Correction, 2026-09-24: the paths move with the mapping*. Now *One transaction, and the
  paths*. Its last sentence, that a rollback through the CLI "is trued up the next time the tier
  is read", was overtaken that night (workplan 0109, "a rollback's slots are in the month's
  peak"), which this record never said; the code's behaviour is stated above.
- **2026-09-26** — a window per data type (0128 T5 slice 4, D8). Record: *Amendment, 2026-09-26:
  a window per data type (workplan 0128 T5, slice 4)*. Now *The window rule*.
- **2026-09-26** — only the paths in the phase the mapping leaves (slice 5a). Record: *Amendment,
  2026-09-26: only the paths in the phase the mapping leaves (workplan 0128 T5, slice 5a)*. Now
  *One transaction, and the paths*.
- **2026-09-26** — one data type cut over on its own (slice 5b, D8), with slice 5c's managed
  preparation added to the same section that day. Record: *Amendment, 2026-09-26: one data type
  cut over on its own (workplan 0128 T5, slice 5b)*. Now *One data type cut over on its own (the
  5b amendment)*.
- **2026-09-26** — one data type ended or kept on its own (slice 7a, D3 and D8). Record:
  *Amendment, 2026-09-26: one data type ended or kept on its own (workplan 0128 T5, slice 7a)*.
  Now *One data type ended or kept on its own*.
- **2026-09-27** — a grace period that ended while nobody chose is said (0128 D7, slice 7c).
  Record: *Amendment, 2026-09-27: a grace period that ended while nobody chose is said (workplan
  0128 D7, T5 slice 7c)*. Now *A grace period that ended while nobody chose (D7)*.
- **2026-09-27, evening** — the owner answered 0128 D9 and D10, both (a), as built; the record
  still called them open (the end of the slice 7a amendment). Recorded in workplan 0128's Status
  block; no code changed. Folded in at consolidation.
- **2026-10-03** — consolidated in place (ADR-0051).

The full record, word for word as it read before this consolidation:
[history/0048-the-mapping-hears-the-cutover.md](./history/0048-the-mapping-hears-the-cutover.md).
