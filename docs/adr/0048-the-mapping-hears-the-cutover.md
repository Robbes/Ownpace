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

<!-- What holds NOW, within the ADR-0051 budget: 8 bullets, 60 words a bullet, 300 words in
     all. Amend in place when a later decision changes it, then regenerate OPERATIVE.md:
     node scripts/adr-operative.mjs --write -->

- **`execute` and `complete` write the mapping as well as the ledger**: `active` or `paused`
  becomes `cutover`; `cutover`, `continuous`, `done` stay (`done` with a warning). Decided by
  `cutoverTransition` (shared): whatever a cutover stops, a rollback puts back. Guard:
  `cutover-lifecycle.integration.test.ts`.
- **The mapping first, the ledger second, every refusal before either write.** Row, paths and a
  `mapping.status` record (`via: 'cutover'`) commit together, through the rollback's port; only
  paths in the phase the mapping leaves move, where its rows add up to its status (`pathFollows`).
  See *One transaction, and the paths*.
- **A migration `active` at `execute` copies until its grace period ends**, mirroring no deletion
  and holding no slot; a `paused` one stays stopped. Gates ask `runsPassesNow` with each data
  type's window. Guard: `a-grace-period-that-copies.unit.test.ts`; see *The window rule*.
- **A data type can be cut over on its own** (`--kind`): its own ledger and path, the
  migration's status their roll-up; only mail waits for DNS. A data type's own cutover never
  begins while the whole one is under way, nor the whole once a data type has its own
  (`cutoverBeginRefusal`). See *One data type cut over on its own*.
- **`complete` closes the ledger, not the migration.** Each data type is ended (`done`,
  refused over its unresolved failures unless forced) or kept copying, by `endOrKeepPath`; one
  whose grace period ended unchosen is named on the Finish page and in the digest (D7). See *One
  data type ended or kept*.
- **A propagation timeout leaves the mapping `cutover`** and the ledger FAILED: no pass runs, and
  `rollback` is the explicit undo. Guard: `cutover-commands.unit.test.ts`.
- **The operator CLI is the only executor, for both editions.** `run-cutover` and `POST …/cutover`
  only prepare (to READY_FOR_CUTOVER) and write no lifecycle. Guard:
  `cutover-preparation.integration.test.ts`.

## Context

ADR-0047 found that **the cutover flow never changed `mailbox_mapping.status`**: `execute` and
`complete` moved the cutover ledger and left the mapping `active`. The passes believed the mapping
(`runsPasses` scheduled them; `sourceAuthorityFor(status)` decided whether the deletion detectors
were assembled), so a CLI-driven cutover kept reading a source that was no longer the authority on
what exists: workplan 0117 §3a's loop, a deletion made on the old account after the switch
mirrored onto the new one, which [0117 D4](../workplans/0117-the-conveyor-belt-not-the-home.md) was
decided to close. And the rollback found no `cutover` mapping to put back to `active`.

The owner picked the fix the evening ADR-0047 recorded the gap, 2026-09-19: *"Go ahead with the
CLI cutover row."* Workplan 0128 later made the grace period copy (D1 (a)), made a cutover and
its ending each data type's own (D8, D3), and has the owner told when a grace period ends unchosen
(D7).

## Decision

**The cutover ledger's two lifecycle-changing steps write the mapping, through one decision and
one port, in one order.**

### The mapping half

`cutoverTransition(status)` sits in `@openmig/shared` beside `rollbackTransition`, so both editions
answer alike (ADR-0026); the two agree row by row, and whatever a cutover stops, a rollback puts
back to `active`.

| from | to | why |
|---|---|---|
| `active` | `cutover` | the source is no longer the authority |
| `paused` | `cutover` | else Start could resume it after cutover, detectors present; a rollback resumes it |
| `cutover` | — | already stopped, or a re-run: converges (hard rule 1) |
| `continuous` | — | copies after cutover by design (0117 T1), detectors absent |
| `done` | — | left alone with a **warning**: a rollback is refused for it, so reverting means a manual MX change |

Only an unknown status refuses (hard rule 9), and a refusal writes nothing, not the ledger either.

### The two steps, in one order

`enterCutover` performs `execute`'s half: the mapping, then APPROVED → CUTOVER_IN_PROGRESS, its
event recording `stoppedSync`, `mappingStatus` and `copiesThroughGrace`; the CLI then waits for the
MX change to propagate and enters GRACE_PERIOD. `closeCutover` performs `complete` (the mapping,
then GRACE_PERIOD → COMPLETED), so a mapping left `active` by a cutover executed before this
decision stops before its ledger closes. Both are in `packages/core/src/cutover-lifecycle.ts`, sharing a port with `performRollback`.

**The mapping first, the ledger second, every refusal before either write** (ADR-0047's order): a
mapping moved beside an APPROVED ledger is a state a re-run finishes; CUTOVER_IN_PROGRESS beside a
running mapping is the defect itself. **A propagation timeout leaves the mapping `cutover`**, the
ledger FAILED: whether the MX record moved is unknown, so no pass runs; `rollback` is the explicit
undo.

### One transaction, and the paths

The write goes through `mappingLifecyclePort` (ledger), the rollback's port: the row, its paths and
an `audit_log` record (`mapping.status`, **`via: 'cutover'`**) in one transaction
(`applyMappingStatusChange`; workplan 0109 T1). The paths follow one rule at every door
(`pathFollows`, `paths-follow-the-mapping.ts`; 0109 T1b): where their rows add up to the status the
mapping leaves, only the paths in that phase move, `done` ends all, and a start also starts one
that never ran; where they do not (a status written alone), all move, since the reader then
believes the status for every data type. So pausing or starting the
rest never returns a data type cut over on its own to its deletion detectors (0117 D4).

A `cutover` path holds no slot (`holdsASlot`, ADR-0014): `execute` and `complete` release slots,
and a rollback takes them back. The month's peak, a managed table the ledger does not write, rises
with the slots in their transaction: at the API's doors, the continuous lane's entry included, and
through `onSlotsTaken` from the CLI and the `run-rollback` job, where the database keeps one (0109
T2).

### The grace period copies, by the window rule

The owner, 2026-09-24, D1 (a): *"bounded by the grace period, and slotless"*. The grace period
promises both systems active, and mail still reaches the old server while the MX record
propagates. So until it ends, a migration `active` at `execute` keeps being scheduled, and a running
pass keeps going, under the after-cutover rules: no deletion detectors, nothing deleted on the
target because it went at the source, no slot held; its copies join the data meter. Then passes
stop; finishing, or the lane, stays the owner's. **A paused migration stays stopped**: `execute`
records, while it still sees the status, whether it copies (`keepsCopyingThroughGrace`;
`copies_through_grace`, ledger migration 0064). One already `cutover` at `execute` (declared
earlier, or a re-run after a failed ledger write; nothing tells them apart) copies nothing through
the grace period; the continuous lane is its way to copy.

**The window rule.** A window is a cutover ledger row's: in GRACE_PERIOD it ends
`grace_period_hours` after `grace_period_started_at`; in CUTOVER_IN_PROGRESS, as long after
`updated_at`, so an `execute` that never finished cannot copy forever; other states copy nothing.
A data type's window is its own row's (`cutover_state` and `cutover_event` carry a `domain`, ledger
migration 0067), or the whole migration's (the row with no data type) where it has none. Every
gate asks
`runsPassesNow(status, cutoverStillCopies)`: `CUTOVER_STILL_COPIES_WHERE` in SQL,
`cutoverStillCopiesAt` in TypeScript. The managed tick schedules a migration while any window is
open; the managed pass and the appliance's startup scan, per-pass re-read and Sync now ask the
reader's `anyRuns` (`readPathPhases`). A pass moves past each data type whose own window is closed,
and runs one kept in the lane after the migration's window closes.

### One data type cut over on its own (the 5b amendment)

The owner's D8: mail can be cut over and stop while files run on. `--kind <data type>` runs
`enterCutover` and `closeCutover` unchanged over that data type's own ledger (`bindCutoverLedger`)
and path (`pathLifecyclePort`): `cutoverTransition` asked of the path's phase, recorded as
`path.phase`. The migration's status is the paths' roll-up, recorded as `mapping.status` when it
moves: mail cut over beside running calendars leaves it `active`; all cut over, `cutover`. Only
mail has DNS; any other data type enters its grace period at `execute`.

A data type's own cutover does not begin while the whole migration's is under way, nor the whole
migration's once a data type has its own (`cutoverBeginRefusal`, core): in the CLI, the managed
preparation and its door, and the store. The managed preparation takes a data type
(`POST /api/migrations/:id/cutover` with a `domain`, slice 5c): its own ledger, final sync and
gate, if the migration carries it. Approval and execution stay the CLI's.

### One data type ended or kept on its own (the 2026-09-26 amendment, slice 7a)

**`complete` closes the ledger, not the migration**: `done` is `finishTransition`'s, with its rule
about unresolved failures, and the CLI says the mapping is `cutover`. The owner's D3 and D8 put the
ending per data type: on the Finish page *End* makes one `done` and *Keep copying* puts it in the
lane, through one door for both editions (`endOrKeepPath`, ledger; `POST …/domains/{domain}/end`
and `…/keep`). End is refused over the data type's own unresolved failures unless forced, as Finish
is; a forced End is recorded as forced. Before its cutover either press is its cutover too, on step
4's attestation (D3): End is one move; Keep is recorded as the cutover, then the lane. The
migration's status is the roll-up, in the same transaction: `done` once every data type has ended.

A whole rollback leaves a data type kept on its own in the lane, and the whole *Keep copying*
leaves one ended on its own ended (slice 5a's rule, as built; the owner, 2026-09-27, 0128 D9 and
D10, both (a)). A whole Finish ends every path.

### A grace period that ended while nobody chose (D7)

The owner's D7: copying stops, and the owner is told on the Finish page and in the organisation's
*what needs attention* digest. When it ended is one rule (`cutoverGraceEndedAt`, shared): in
GRACE_PERIOD once its hours have passed, in COMPLETED when it was closed. The ledger reads it per
cutover ledger (`readGraceEnds`) onto each data type still in its cutover (`graceEndedAt`), and the
digest names those (`readGraceEndedWithoutAChoice`). One ended or kept has chosen; nothing is said.

### Where it is said, and who executes

The `--yes` confirmation names the mapping half for this mapping, including whether it copies
through the grace period; `status` prints until when a cutover copies, and the Finish page's note
for `cutover` says so. `run-cutover` only prepares
(to READY_FOR_CUTOVER) and the API executes no cutover: the operator CLI is the only executor, for
both editions, so the decision is in `shared` and the write in `core` and the ledger.

## Consequences

- The rollback's "sync resumes" half fires for a CLI-driven cutover: `enterCutover`, then
  `performRollback`, leaves two audit rows (`via: 'cutover'`, then `via: 'rollback'`) and the
  mapping back at `active`. The gate is `cutover-lifecycle.integration.test.ts` on a real ledger,
  not the E2E smoke, which cannot manufacture a verified data gate or real DNS propagation
  (ADR-0047).
- An `active` mapping at rollback time is now a cutover executed before this decision, or one never
  declared ([rollback-mechanisms.md](../rollback-mechanisms.md)). A rollback resumes a migration
  paused at `execute`: an operator who paused for a reason that outlives the cutover pauses again.
- **Who declares `cutover` (correction, 2026-09-20).** Not the Finish page, as this ADR and
  ADR-0047 first said: it reads `cutover`. The writers are the operator CLI and a raw
  `PUT /api/migrations/:id`, which asked nobody until [ADR-0049](./0049-a-door-that-asked-nobody.md).
  Since slice 7a a data type's End or Keep pressed before its cutover is its cutover too.
- Guards since 2026-09-24: `a-grace-period-that-copies` (worker and appliance),
  `a-cutover-ledger-per-data-type`, `a-door-moves-only-its-own-paths`, `path-lifecycle-wiring`,
  `a-cutover-of-one-data-type`, `who-may-begin-a-cutover`, `an-ending-per-data-type`,
  `a-data-type-ended-or-kept`, `a-grace-period-that-ended`, `a-grace-period-nobody-chose`,
  `a-grace-period-the-digest-names`; for the peak raised with the slots, `a-peak-the-ledger-door-can-raise`
  (ledger) and `the-peak-where-there-is-one` (worker).

## Alternatives considered

- **Refuse `execute` on a `paused` mapping.** Rejected: a refusal holds only while the operator is
  at the terminal and closes the door, and it leaves Start open after cutover, the accident D4 exists to prevent. Naming it in the confirmation keeps the
  operator's call.
- **Put the mapping back to `active` on a propagation timeout.** Rejected: the MX record may have
  moved for some resolvers and not others, and a pass then is the D4 loop. FAILED invites the
  rollback, the explicit undo.
- **Finish the migration at `complete`.** Rejected: finishing has a rule (unresolved failures block
  it, `force` overrides knowingly) and one door. A cutover that finished would be a second door with
  fewer rules: ADR-0047's objection to un-finishing on rollback, mirrored.
- **Leave `complete` alone; only `execute` writes.** Rejected: cutovers executed before this
  decision sit in GRACE_PERIOD with an `active` mapping, and `complete` is the last command to run
  on them; closing a terminal ledger over a running sync would make the defect permanent.
- **A separate port per door.** Rejected: one `mappingLifecyclePort`, naming the door (`via`) per
  write, keeps one audit shape and one transaction helper; two ports are two places to forget the
  record.
- **Stop every pass at `execute`** (as first built). Rejected by the owner (D1 (a)): it left mail
  reaching the old server during propagation, and edits in the old account, uncopied for the grace
  period's 72 hours.
- **Copy a paused migration through the grace period too.** Rejected in the build (0128 T2): a
  cutover would restart what the operator had stopped.
- **Move every included path with the mapping** (the 2026-09-24 correction's rule). Replaced once a
  data type can be cut over on its own: a pause or a start of the rest would return it to its
  deletion detectors.
- **Begin the whole migration's cutover once a data type has its own.** Refused
  (`cutoverBeginRefusal`): a whole rollback would move back a data type cut over on its own, and the
  tick's question, whether any ledger row still copies, would stop being each data type's.
- **Let a press on the whole migration undo a data type's own ending** (0128 D9 (b), D10 (b)).
  Rejected by the owner, as 0128 recommended: that data type was kept or ended on purpose (mail ends
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
- **2026-09-24, that night** — a rollback's slots are in the month's peak: the CLI and the
  `run-rollback` job raise it in the same transaction (`onSlotsTaken`; workplan 0109 T2). Record:
  none — the record never said it. Now *One transaction, and the paths*.
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
