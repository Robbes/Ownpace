# 0101 — The paths no gate had opened

## Status — 2026-09-20 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 Find out what the gates actually cover | ✅ **Done 2026-08-23** | Grep of both gates: `shared-addresses`, `permissions`, `billing`, `invoices` and `rollback` returned **nothing at all**, and `/api/ready` — added precisely to be asked — was asked by nobody. The api image's HEALTHCHECK hits `/health`, not `/ready`. |
| T2 Ask for the reports | ✅ **Done 2026-08-23** | New `reports` phase in `smoke-managed.sh`: readiness (`.database` pinned to `up`), shared addresses, the group runbook, the permission report, billing usage, invoices. Asserted on SHAPE — a 200 that dropped a key fails, and markdown is checked for its heading rather than its length. |
| T3 Exercise offboarding where it can be undone | ✅ **Done 2026-08-23** | `close` then `reopen` on T1, the throwaway tenant the invitation phase creates and deletes. The closure ROW is asserted, not the response; the window is checked to be a window (`purge_after > closed_at`); reopen must clear the row. |
| T4 Stop the coverage list from going stale | ✅ **Done 2026-08-23** | `scripts/gate-coverage.unit.test.ts` — 12 cases. The route families are DERIVED from `index.ts`; each must be requested by the smoke or carry a written reason. Both directions checked: an undecided family fails, and a reason that outlived its route fails. |
| T5 Rollback | ✅ **Done 2026-09-19 — it exists once, and it is gated** | **What a rollback IS was decided 2026-08-23: a setback, never a reversal, never a salvage** — now [ADR-0047](../adr/0047-a-rollback-is-a-setback.md). `performRollback` in `@openmig/core` is the one implementation; the CLI and the `run-rollback` job call it, in the same order (mapping first, ledger second, refusals before either). The mapping half is `rollbackTransition` in `shared` (`cutover`/`continuous` → `active`; `done` refused). `canRollback` derives from the state machine and `rollbackAvailable` on a read is no longer a constant. The worker's mapping write is audited like the API's. **Gate:** `run-rollback.integration.test.ts` over the real state machine and the real ledger port — not the E2E smoke, which cannot reach GRACE_PERIOD without real DNS. No API route, deliberately: the API is prepare-only for cutovers. See below. |
| T6 The cutover the mapping never heard of | ✅ **Done 2026-09-20 — [ADR-0048](../adr/0048-the-mapping-hears-the-cutover.md)** | Found while building T5: the CLI's `execute` and `complete` moved the cutover ledger and never `mailbox_mapping.status`, so a CLI-driven cutover ran with the mapping `active` — passes scheduled, deletion detectors present, a source that had just stopped being the authority (0117 D4) still mirrored — and the rollback's mapping half had nothing to resume. Now `enterCutover` / `closeCutover` in `@openmig/core` write the mapping first (`active`/`paused` → `cutover`; `cutover`/`continuous`/`done` left alone, `done` with a warning) and the ledger second, decided by `cutoverTransition` in `shared` beside `rollbackTransition` — the two agree row by row. Recorded in `audit_log` with `via: 'cutover'`. `complete` closes the ledger, not the migration. **Gate:** `cutover-lifecycle.integration.test.ts` on the real ledger, including the round trip: the cutover stops it, the rollback resumes it, two audit rows. See below. |
| T7 A door that asked nobody | ✅ **Done 2026-09-20 — [ADR-0049](../adr/0049-a-door-that-asked-nobody.md)** | Found while reading the API for T6: `PUT /api/migrations/:id` wrote whatever status its schema admitted — `cutover` → `active` while `/start` refused it, `done` → `paused` while everything else treats `done` as terminal, `active` → `done` past the unresolved-failures rule, `paused` → `active` past Start's grant check and first pass, `active` → `continuous` before any cutover. Now `updateTransition` in `shared` (25 cells, agreeing with the four doors beside it) is asked inside the transaction; a refusal is 409 `lifecycle_refused` with a stable `code` and the door named, nothing written. **Also found:** the Finish page's lane switch sent `PATCH` to a path served by `PUT` — the continuous lane had never been enterable from its own screen. **Gate:** the real route on Postgres through the whole reachable table, plus the verb pinned in the web. See below. |

**2026-09-19: T5 closed.** Read again with a month's distance, the finding was three
inconsistencies, not two: the two implementations, `rollbackAvailable` hardcoded `false` on every
read, and `canRollback` naming two states while the machine admitted `ROLLED_BACK` from four —
including `FAILED`, where `execute` lands a propagation timeout beside its own *"Consider
rollback."* All three are one rule now. What was NOT touched, and is recorded in ADR-0047's
consequences: the cutover flow itself never writes `cutover` onto `mailbox_mapping` — neither the
CLI's `execute` nor `run-cutover` does — so in a CLI-driven cutover the mapping is `active`
throughout and the rollback's mapping half is a no-op that says so. That belongs to whichever plan
next touches execution.

**2026-09-20: T6 closed** — the plan that next touched execution was this one, the same evening.
The owner picked it as soon as T5 recorded it; [ADR-0048](../adr/0048-the-mapping-hears-the-cutover.md)
has the decision, and the section below has the finding and the proof.

## What the grep found

Four route families the product ships, sells and renders screens for had never
once been requested from a running stack:

| Family | What it answers |
|---|---|
| `/api/ready` | the readiness probe added so a stack could say it was NOT ready |
| `/api/shared-addresses` | the Pattern D list runbook — the steps a person has to do by hand |
| `/api/permissions` | who can see what, and what happens to it |
| `/api/billing` | usage, and the invoices built from it |

They are all reads. They cost the gate a handful of HTTP round trips and change
nothing, which is precisely why there was no excuse for their absence.

Offboarding was the fifth, and the one with the most weight behind it: `close`
starts an erasure clock and `purge_after` is the date somebody's data stops
existing. It shipped with integration tests and nothing that ran it against RLS,
a real tenant row and the API's own auth.

## What is asserted, and what deliberately is not

Each report must answer **200 AND return the shape its route documents**. What
is NOT asserted is the content: the demo tenants have no shared addresses and no
invoices, so `0` is the true answer, and seeding fixtures to make a bigger number
would be testing the fixture. `null`, a missing key, or a 500 all fail; an honest
empty list passes.

The one exception is `readiness.database`, which may only be `up` — a count of
zero is a true answer, a database that is down is not, and one helper cannot
treat them alike. `readiness.signIn` is deliberately **not** pinned: the issuer
is unreachable from inside the API container until `ZITADEL_EXTERNALDOMAIN`
names an address both a browser and that container resolve, the identity phase
already says so precisely, and a second report of the same outage is noise.

## T5: rollback exists twice, and the two do different things — RESOLVED 2026-09-19, see ADR-0047

**Two earlier drafts of this section were wrong** — first "no route, no
handler", then "nothing reaches `CUTOVER_IN_PROGRESS` or `GRACE_PERIOD`". Both
came from grepping `apps/api/src` and stopping. The picture after reading
`apps/worker` as well:

### The state machine has an operator path, and it is a CLI

`apps/worker/src/cli/cutover-commands.ts` drives the whole thing —
`start` → `verify` → `approve` (APPROVED) → `execute` (CUTOVER_IN_PROGRESS →
GRACE_PERIOD) → `complete` (COMPLETED), with `rollback` (ROLLED_BACK) beside it.
So the states DO get reached; a person reaches them, from a terminal.

The API is prepare-only by design: `POST /api/migrations/:mappingId/cutover`
enqueues `run-cutover`, whose own comment says it "prepares and verifies a
cutover and stops at `READY_FOR_CUTOVER`; it does not execute one". Nothing in
`apps/api` or `apps/web` advances past that, and nothing there rolls back.

### And rollback is implemented twice, differently

| | CLI `rollback` | job `run-rollback` |
|---|---|---|
| Marks the cutover `ROLLED_BACK` | ✅ | ✅ |
| Reactivates the mapping so shadow sync resumes | ❌ **no** | ✅ `status → active` |
| Notifies (`rollback_finished`) | ❌ — says so in its own prompt | ✅ opt-in, refused up front if no channel |
| Reverts MX | ❌ deferred — verify-only DNS, a manual step | ❌ same, and it logs rather than claiming otherwise |
| Reachable | operator terminal | **nothing calls it** |

`grep -rn "run-rollback\|runRollback" --include="*.ts" .` returns two lines,
both inside the file that defines it. `trigger.config.ts` has
`dirs: ['./src/jobs']`, so it IS registered and deployed — the Trigger.dev
dashboard is the only place it can be started from.

The divergence is the finding: **the reachable rollback is the one that does not
resume syncing.** An operator who rolls back from the CLI has a mapping marked
rolled back and a migration that is not running.

### And a third thing, concrete

`rollbackAvailable` is hardcoded `false` on `CutoverStore`'s read path.
`cutover-state.ts` computes `rollbackAvailable: canRollback(newState)` on
transition; the row-to-status mapping discards it and returns `false`
unconditionally. So anything reading a cutover's status is told rollback is
unavailable even in `GRACE_PERIOD`, where it is exactly what the operator is
being invited to consider.

None of this is a test's decision to make, so it is recorded rather than worked
around.

### What a rollback IS — decided 2026-08-23

The open question above was what rollback should mean. The owner settled it:

> A rollback is a **setback**. It puts the migration back to syncing, with the
> original source live again, and that is all of it.

Two things it explicitly never does:

- **It never swaps source and target.** The mapping's direction is untouched;
  after a rollback the sync runs source → target exactly as before, because the
  source is authoritative again and the target is once more the copy.
- **It never salvages from the target.** Mail delivered to the target while MX
  pointed there stays on the target. Pulling it back would mean writing to a
  source this product only ever reads, and a migration tool that writes to
  somebody's live source on an emergency path is not one to trust with the
  emergency.

That closes the design question and opens a smaller, sharper one, because the
decision makes the divergence above a defect rather than a curiosity:

**By this definition the reachable rollback does not perform one.** The CLI
writes the ledger and never touches `mailbox_mapping`, so the migration stays
stopped — the label without the thing. The job that would resume it is the one
nothing can call.

Pending a decision on how to reconcile the two, both now SAY what they do. The
job warns that mail on the target stays there. The CLI warns that the sync does
not resume and names the job that would resume it — printed **after** the
transition rather than in the consequence list, because `confirmed()` returns
early on `--yes` and never prints those bullets, so a warning living only there
is invisible to every operator who actually performs a rollback rather than
being refused one. Both pinned by tests proved by breaking them.

## T6: the cutover the mapping never heard of — RESOLVED 2026-09-20, see ADR-0048

**Found while building T5.** The rollback's mapping half puts a `cutover` mapping back to
`active`. Tracing where `cutover` gets written turned up exactly one writer: the lifecycle
`PATCH` — the Finish page's own declaration. The CLI's `execute` moved the ledger APPROVED →
CUTOVER_IN_PROGRESS → GRACE_PERIOD, `complete` moved it to COMPLETED, and neither touched
`mailbox_mapping.status`. (`run-cutover`, the Trigger.dev job, is prepare-only and stops at
READY_FOR_CUTOVER; it was never a door.)

### Three records of one event, disagreeing

| Record | What it said during a CLI-driven cutover | Who reads it |
|---|---|---|
| the cutover ledger | CUTOVER_IN_PROGRESS, then GRACE_PERIOD | the operator, `status`, `rollback` |
| `mailbox_mapping.status` | `active` — syncing, source authoritative | the appliance's tick, the managed poller (`runsPasses`), every pass (`sourceAuthorityFor`) |
| the passes | kept running, deletion detectors present | — |

The passes believe the mapping. So the product kept scheduling passes against a source that had
just stopped being the authority on what exists, with the detectors assembled — 0117 §3a's loop,
the one D4 was decided to close, with a ledger beside it saying the cutover was under way. And
the reachable rollback, built in T5, resumed nothing on this path — correctly, and said so — because
there was nothing stopped to resume.

### What was built

- **`cutoverTransition` in `@openmig/shared`**, beside `rollbackTransition`: `active` and `paused`
  → `cutover`; `cutover`, `continuous` and `done` left alone, `done` with a warning that a rollback
  will be refused for it; an unknown status refuses. `the-mapping-hears-the-cutover.unit.test.ts`
  pins every row against `MAPPING_LIFECYCLES`, and pins the round trip: whatever a cutover stops,
  `rollbackTransition` takes back to `active`.
- **`enterCutover` and `closeCutover` in `@openmig/core`** (`cutover-lifecycle.ts`, beside
  `performRollback`, with the `MappingLifecyclePort` they now share): the mapping first, the
  ledger second, refusals before either — the T5 order, for the T5 reason. `via: 'cutover'` in the
  audit row, `stoppedSync` and `mappingStatus` in the ledger event.
- **The CLI over them.** `execute` reads the mapping and lists the mapping half in its `--yes`
  confirmation ("Stop the shadow sync: mapping … `'active'` → `'cutover'`"), then `enterCutover`,
  then the DNS wait as before. On a propagation timeout the mapping stays `cutover` and the output
  says `rollback --yes` resumes it. `complete` stops a mapping still `active` — every cutover
  executed before this — on its way to COMPLETED, and says that it closes the ledger, not the
  migration: `done` keeps its one door and its unresolved-failures rule.

### Gate

`apps/worker/src/cli/cutover-lifecycle.integration.test.ts`, the real state machine, the real
`CutoverStore` and the real `mappingLifecyclePort` on Postgres — the E2E smoke cannot reach
APPROVED without a verified data gate and real DNS (T5's reason). From APPROVED the mapping is
`cutover`, the ledger CUTOVER_IN_PROGRESS, the audit row names the door and the event carries the
mapping half; `paused` is stopped and recorded from `paused`; `continuous` is left alone with no
audit row; READY_FOR_CUTOVER is refused before the mapping is touched; `complete` stops a mapping
left `active` by an older cutover and writes no row for one already `cutover`; and the round trip
— `enterCutover`, then `performRollback` — leaves the mapping `active` with two rows, `via:
'cutover'` then `via: 'rollback'`.

| Break | Case that fails |
|---|---|
| ledger written before the mapping | the two order tests (core, CLI) |
| `paused` left alone instead of stopped | "stops a 'paused' mapping too" (shared, core) |
| `complete` leaves the mapping alone | "stops a mapping still 'active' … BEFORE COMPLETED" (core, CLI) |
| the audit row says `via: 'rollback'` | the `setStatus` shape (core, CLI) and the row itself (integration) |
| the confirmation drops the mapping line | "tells the person approving what will happen to THIS mapping" |
| the `done` warning dropped | "WARNS that a rollback will be refused" (shared, core, CLI) |

## T7: a door that asked nobody — RESOLVED 2026-09-20, see ADR-0049

**Found while reading the API for T6.** Every lifecycle door decides through `shared` first —
Start, Finish, the rollback (T5), the cutover (T6), the appliance — except one. `PUT
/api/migrations/:id` admitted every status its schema named and wrote it, audited and with the
paths moved, decided by nobody:

| Sent | What happened | Which door refuses it |
|---|---|---|
| `cutover` → `active` | written | `/start` and the appliance (`isAfterCutover`); D4's accident, one PUT away |
| `done` → `paused` / `active` / `cutover` | written | the rollback, the finish, Start — `done` is terminal everywhere else |
| `active` → `done` | written | `/finish` — the unresolved-failures rule, skipped |
| `paused` → `active` | written | `/start` — the awaiting-grant refusal and the first pass, skipped |
| `active` → `continuous` | written | 0117 T1: the lane is entered from `cutover` or `done` |

**And the same door had a second finding.** The Finish page's "keep copying after cutover" press
(0117 T1 slice 3) sent `PATCH` to this path; the API serves it with `PUT` and has no PATCH
handler there. For ten days the lane could be entered from a curl and never from the screen built
for it, and nothing was red — the page's tests mock the whole service, and the spec guard checks
routes against the spec, not against callers.

### What was built

- **`updateTransition(from, to)` in `@openmig/shared`**: six moves, five no-ops, fourteen
  refusals, each refusal with a stable code (`own_door`, `after_cutover`, `finished`,
  `before_cutover`) and a hint naming the door that does what was asked. The shared test pins all
  twenty-five cells and that the table agrees with the four decisions beside it.
- **The route asks it inside its transaction**, on the status it read there, and returns before
  the write: 409 `lifecycle_refused` with `code`, `hint`, `from`, `to`. A source-level guard pins
  that the question is asked and asked before the write. OpenAPI documents the second 409.
- **The web PUTs.** `keepCopyingAfterCutover` sends the verb the route serves, and
  `a-verb-no-route-answered.unit.test.ts` mocks the axios instance without a `patch` at all.

### Gate

`a-door-that-asked-nobody.integration.test.ts` drives the real route on Postgres: a mapping
created paused; `active`, `done` and `continuous` refused with their codes and nothing written;
`cutover` declared and recorded `via: 'update'`; restating it records nothing; `active` and
`paused` refused from `cutover` with the rollback named; the lane entered and stopped, both
recorded; a finish through its own door; `done` refused for everything but the lane. And PATCH
on this path answers 404 — pinned where it was found.

| Break | Case that fails |
|---|---|
| `cutover → active` allowed again | the table cell (shared); "refuses the way back" (integration) |
| `done → paused` allowed | the `done` row (shared); "'done' is terminal here" (integration) |
| `to: 'done'` allowed | "never reaches 'done'" (shared); "refuses 'done'" (integration) |
| the route stops asking | the source-level guard; every refusal case in the integration test |
| the web PATCHes again | `a-verb-no-route-answered`: `patch is not a function` |

## What is still not covered, and why

| Family | Why not |
|---|---|
| `/api/access-requests` | granting one sends a real email to a real address; `access-requests.integration.test.ts` does not |
| `/api/scope-manifest` | a static description of provider scopes — nothing about it can be true on a laptop and false on the Spark |
| `/api/setup` | the first-run path; a stack this gate can talk to is past it by definition |
| `/api/connections` | every connection the gate uses is written by the demo seed, encrypted with the stack's key. Exercising the route means writing credentials from a script (hard rule 3) |
| `/api/decisions` | needs a drift decision to exist, which needs a source that produced one; manufacturing it tests the fixture |
| `/api/billing/webhooks` | a payment provider's signed callback — forging one proves the signature check can be fooled, which is worse than no coverage |

These reasons live in `gate-coverage.unit.test.ts` beside the assertion that
uses them, so a family added to `index.ts` without a decision fails the build,
and a reason that outlives its route fails too.

## Gates

| Break | Case that fails |
|---|---|
| a new `app.use('/api/…')` nobody decided about | leaves no route family undecided |
| a route removed, its excuse left behind | does not carry reasons for families that no longer exist |
| readiness no longer pinned to `up` | pins the one answer that may only be `up` |
| the closure-row assertion replaced by the response | asserts the closure ROW, not the response |
| `close` pointed at a demo tenant | runs on the throwaway tenant, not on a demo one |

`pnpm lint` clean · `pnpm typecheck` clean (all four projects) · `pnpm test`
320 files, 3580 tests, all passing (2026-08-23).

**The new phases are proved against stubs, not against the Spark** — this
environment has no Docker daemon. Both were run with `http` and `q` answering
from a table: every report green on a healthy-but-degraded stack (which is what
the Spark is today), and failing on a 500, on a 200 with the key missing, on an
error page the size of a real report, on a 400, and on a database reporting
`down`. Offboarding was run the same way: clean close-and-reopen passes; a 200
with no closure row, a window that ends before it starts, a reopen that leaves
the clock running, and a refused close each fail.
