# ADR-0049: A door that asked nobody

- **Status:** **Accepted 2026-09-20** — found and built the night after ADR-0048, under the owner's
  standing "work autonomously"; the rules are the existing ones, applied to the one door that did
  not apply them.
- **Date:** 2026-09-20
- **Deciders:** built on the owner's earlier decisions (below); nothing new decided
- **Relates to:** [ADR-0026](./0026-one-operating-ui-one-contract.md) (lifecycle decisions live in
  `@openmig/shared`, and both editions ask them), [ADR-0047](./0047-a-rollback-is-a-setback.md) (a
  rollback is the only way back before a cutover), [ADR-0048](./0048-the-mapping-hears-the-cutover.md)
  (what a cutover stops), workplan 0117 D4 and T1 (after cutover the source is not the authority;
  the continuous lane is entered from `cutover` or `done`), workplan 0038 T1 (finishing refuses
  over unresolved failures; a stable `code` beside the prose).
- **Relates to workplan:** [0101 T7](../workplans/0101-the-paths-no-gate-had-opened.md).

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- **`PUT /api/migrations/:id` asks `updateTransition` in `@openmig/shared` before it writes a
  status**, on the status read inside its own transaction, and answers **409 `lifecycle_refused`**
  — with a stable `code`, a `hint` naming the right door, and nothing written — when the move is
  one the lifecycle does not make through this door.
- **After cutover stays after cutover.** `cutover`, `done` and `continuous` do not go back to
  `active` or `paused` by an update (`after_cutover`). Only a rollback does that, recorded as one.
- **`done` is terminal** with one exit, the continuous lane (`finished` for everything else).
- **A transition with its own door is refused here and sent there** (`own_door`): `active` is
  `POST …/start` (it refuses a grant still being waited on and runs the first pass); `done` is
  `POST …/finish` (it refuses over unresolved failures unless forced).
- **The lane is entered after cutover** — from `cutover` or `done` — and from nowhere else
  (`before_cutover`).
- What the door still does: `active`/`paused` → `cutover` (the declaration), `active` → `paused`
  (pause), `cutover` ↔ `continuous` and `done` → `continuous` (the lane and its stop). Restating
  the status a mapping already has is a request, not a transition: 200, nothing recorded.
- **The Finish page's lane switch sends `PUT`**, the verb this path is served by. A web test pins
  the verb.

## Context

Every lifecycle door in this product decides through `@openmig/shared` first: Start through
`startTransition`, Finish through `finishTransition`, the rollback through `rollbackTransition`
(ADR-0047), the cutover through `cutoverTransition` (ADR-0048). The appliance asks the same
functions. Reading the API for ADR-0048 found the one door that asked nobody: the mapping update
route, `PUT /api/migrations/:id`, admitted every status its schema named — `active`, `paused`,
`cutover`, `done`, `continuous` — and wrote it. Audited (0109 T1) and with the paths moved
(0109 T1b), but decided by nobody.

So `cutover → active` went through here while `POST …/start` refused it with the same predicate
the appliance uses — the 0117 D4 accident, passes with the detectors present after cutover, one
`PUT` away. `done → paused` went through while the rollback, the finish and Start all treat
`done` as terminal. `active → done` skipped the unresolved-failures rule that `POST …/finish`
exists to apply, and `paused → active` skipped both the awaiting-grant refusal and the first pass
that Start performs. `active → continuous` entered a lane whose whole definition is "after
cutover" before any cutover. Two doors to one state, one guarded — the shape of every lifecycle
defect this repository has recorded, and this was the last unguarded door.

The same reading found a second thing on the same door. The Finish page's "keep copying after
cutover" press (0117 T1 slice 3, 2026-09-10) sent `PATCH` to this path, and the API serves it
with `PUT` only. For ten days the lane could be entered from a curl and never from the screen
built for it; the page showed its generic "failed" and nothing was red, because the page's tests
mock the whole service module and the API's spec guard checks routes against the spec, not
against callers.

## Decision

**The update door asks the lifecycle, and the lifecycle's answer is the table the other doors
already imply.** `updateTransition(from, to)`, beside the four decisions it agrees with:

|              | active   | paused   | cutover  | done     | continuous |
|--------------|----------|----------|----------|----------|------------|
| `active`     | ·        | pause    | declare  | own door | not yet    |
| `paused`     | own door | ·        | declare  | own door | not yet    |
| `cutover`    | after    | after    | ·        | own door | enter      |
| `done`       | finished | finished | finished | ·        | enter      |
| `continuous` | after    | after    | stop     | own door | ·          |

Six moves, five no-ops, fourteen refusals. A refusal writes nothing and carries a stable `code`,
so a screen can offer the right door without matching sentence text (the 0038 T1 shape).
`a-door-that-asked-nobody.unit.test.ts` in `shared` pins all twenty-five cells and, separately,
that the table agrees with `startTransition`, `finishTransition`, `rollbackTransition` and
`cutoverTransition` — nothing an update allows is something another door refuses, and every
transition with a door of its own is sent there.

The route asks inside its transaction, after reading the current status there, so a decision is
never made against a row that moved in between; the source-level guard beside it pins that the
question is asked, and asked before the write. `a-door-that-asked-nobody.integration.test.ts`
drives the real route on Postgres through the whole table's reachable path — paused, the three
refusals, the declaration, the way back refused, the lane and its stop, a finish through its own
door, `done` terminal but for the lane — and pins the verb finding where it was found.

The web's `keepCopyingAfterCutover` now PUTs, and `a-verb-no-route-answered.unit.test.ts` mocks
the axios instance without a `patch` at all, so a regression fails as a missing function.

## Consequences

- **Nothing the web or the gates send today is refused.** Pause is `active → paused`; the lane is
  `cutover|done → continuous`; Start and Finish use their own routes. The E2E smokes PUT no
  status. A raw API caller who used this door to un-cutover or un-finish a migration now gets a
  409 that names the rollback or the lane.
- **`cutover` is declared by two writers only**: this route, and the operator CLI's `execute`
  (ADR-0048). ADR-0047 and ADR-0048 described the declaration as the Finish page's; the Finish
  page reads `cutover` and never writes it. Corrected in ADR-0048's consequences.
- **The continuous lane can be entered from the screen built for it**, for the first time since
  it was built.
- **Not decided here, on purpose:** whether a `continuous` mapping may be *paused*. The table
  refuses it as a step back before the cutover (`paused` is a before-cutover word, and Start would
  resume it with the detectors present). Stopping the lane is `continuous → cutover`, which the
  table allows. If a pause inside the lane is wanted, that is a lifecycle decision for the owner —
  a sixth word, or `paused` made phase-aware — and not one to take by loosening a refusal.

- **The cutover door asks too (2026-09-20, workplan 0009 T10).** `POST …/cutover` enqueued the
  preparation without reading the cutover ledger, so a press on a cutover under way or a finished
  ledger was answered 202 and refused minutes later inside a Trigger.dev run, and a press on an
  `APPROVED` cutover revoked the approval behind a 202 that said nothing. It now asks
  `prepareTransition` — the rule the job itself follows — before it enqueues: 409
  `cutover_refused` with the reason and a stable `code`, or a 202 that says what the job will do.
  The same shape as this ADR's decision, one door further along: the decision function is shared
  with the worker, the door only relays it, and the job re-reads and stays the authority.

## Alternatives considered

- **Add a `PATCH` handler on the mapping path** rather than change the web's verb. Rejected: the
  route is documented and served as `PUT`, `pause` already PUTs, and a second verb on the same
  path is a second thing the spec guard and every caller have to know.
- **Narrow the schema's `status` enum** to what the web sends. Rejected: `cutover` has no other
  API door and the operator needs one; `continuous` is the lane's door. The enum names what the
  door can reach; the table says from where.
- **Consult `finishTransition` here with a failure count** so an update may finish. Rejected: a
  second finish door with the same rule is a second place for the rule to drift, and the Finish
  button already exists.
- **Let `paused → active` through as a resume.** Rejected: Start is where the awaiting-grant
  refusal and the first pass live (workplan 0108 T4, task "run the first sync at activation");
  a resume that skips both is a migration that believes it started and did not.
