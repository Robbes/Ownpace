# 0101 — The paths no gate had opened

## Status — 2026-08-23 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 Find out what the gates actually cover | ✅ **Done 2026-08-23** | Grep of both gates: `shared-addresses`, `permissions`, `billing`, `invoices` and `rollback` returned **nothing at all**, and `/api/ready` — added precisely to be asked — was asked by nobody. The api image's HEALTHCHECK hits `/health`, not `/ready`. |
| T2 Ask for the reports | ✅ **Done 2026-08-23** | New `reports` phase in `smoke-managed.sh`: readiness (`.database` pinned to `up`), shared addresses, the group runbook, the permission report, billing usage, invoices. Asserted on SHAPE — a 200 that dropped a key fails, and markdown is checked for its heading rather than its length. |
| T3 Exercise offboarding where it can be undone | ✅ **Done 2026-08-23** | `close` then `reopen` on T1, the throwaway tenant the invitation phase creates and deletes. The closure ROW is asserted, not the response; the window is checked to be a window (`purge_after > closed_at`); reopen must clear the row. |
| T4 Stop the coverage list from going stale | ✅ **Done 2026-08-23** | `scripts/gate-coverage.unit.test.ts` — 12 cases. The route families are DERIVED from `index.ts`; each must be requested by the smoke or carry a written reason. Both directions checked: an undecided family fails, and a reason that outlived its route fails. |
| T5 Rollback | ⛔ **Cannot be gated — implemented, and nothing calls it** | `apps/worker/src/jobs/run-rollback.ts` is a complete, deployed Trigger.dev task (`trigger.config.ts` registers everything under `src/jobs`). What is missing is every caller: no API route, no `resolveRollbackJob` beside `resolveCutoverJob`, no UI. `grep -rn "run-rollback\|runRollback"` across the repo returns two lines, both inside that file. See below. |

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

## T5: rollback is built, deployed, and unreachable

**An earlier draft of this section said "no route, no handler". The handler part
was wrong**, and the correction matters because it changes what is missing.

`apps/worker/src/jobs/run-rollback.ts` is a complete implementation, and a
careful one: it refuses `notifyUsers: true` BEFORE touching anything when no
channel is configured, it reactivates the mapping so shadow sync resumes, it
transitions the cutover to `ROLLED_BACK` with a reason and a timestamp, and it
logs loudly rather than claiming a DNS restore that the verify-only DNS decision
means it does not perform. `trigger.config.ts` has `dirs: ['./src/jobs']`, so it
is registered and deployed like every other task.

What is missing is every **caller**:

```
$ grep -rn "run-rollback\|runRollback" --include="*.ts" .
apps/worker/src/jobs/run-rollback.ts:52:export const runRollback = schemaTask({
apps/worker/src/jobs/run-rollback.ts:53:  id: 'run-rollback',
```

Two lines, both inside the file that defines it. No API route, no
`resolveRollbackJob` beside `resolveCutoverJob` in `job-resolution.ts`, no
button in `apps/web`. The only way to run it today is to trigger the task by
hand from the Trigger.dev dashboard.

Two more things found while establishing that, both concrete:

1. **`rollbackAvailable` is hardcoded `false` on the read path.**
   `cutover-state.ts` computes `rollbackAvailable: canRollback(newState)` on
   transition, and `CutoverStore`'s row-to-status mapping throws that away and
   returns `false` unconditionally. Anything that reads a cutover's status is
   told rollback is unavailable, whatever state the row is in.

2. **`canRollback` is only true in `CUTOVER_IN_PROGRESS` or `GRACE_PERIOD`**,
   and nothing in the product reaches either: `resolveCutoverJob`'s own comment
   says the task "prepares and verifies a cutover and stops at
   `READY_FOR_CUTOVER`; it does not execute one".

So the gate cannot cover rollback, and neither can a customer. Whether that is a
missing route, a missing execute-the-cutover step, or a state machine that
outgrew its plan is a decision — written here rather than worked around.

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
