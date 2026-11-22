# Workplan 0167 — A job runner on our own Postgres

> **In one line:** A time-boxed spike: can pg-boss (MIT) on the ledger's Postgres do what the managed edition asks of self-hosted Trigger.dev? Nine points to prove, each run against a real Postgres, directly and through PgBouncer, with Trigger.dev left the only path that runs.

## Status — 2026-11-22 (update this block at the end of every session)

**2026-11-22: the spike, the nine points run, and a stop for the owner's decision.**
On branch `spike/pg-boss-orchestrator`, from `main` at `9c63582`. Nothing outside
`packages/scheduler`, this plan and the workplan index changed. Trigger.dev is still the only
orchestrator the editions run: the runner is reachable only through the new
`@openmig/scheduler/pg-boss` subpath, and nothing imports it. So the branch has no runtime switch
to set, because it has nothing at runtime to switch. `deploy/compose`, the images, the release
scripts and every Trigger.dev code path are untouched. No CHANGELOG line, by the coordinator's
instruction (alpha.15's fold is in flight).

**The evidence.** `packages/scheduler/src/pg-boss/pg-boss-spike.integration.test.ts`, 10 tests,
run twice on a throwaway cluster from `scripts/local-pg.sh` (PostgreSQL 16 here; production runs 18,
so CI's Testcontainers run is the one to trust for the version):

- **Run A, directly against Postgres:** `Tests 10 passed (10)`, 71.9 s.
- **Run B, through PgBouncer 1.22 with `pool_mode = transaction`:** `Tests 10 passed (10)`, 71.8 s.
  PgBouncer's own `SHOW STATS` counted 2,197 transactions through it to the test database.
- **The per-run process:** `run-in-child.unit.test.ts`, 4 passed. The repository gates on the branch:
  `pnpm typecheck` 0 and `pnpm lint` 0; `pnpm test` in the table's T3 row.

| Task | Owner | Status | Notes |
|---|---|---|---|
| T0 The runner | builder | ✅ **Done 2026-11-22** | `job-runner.ts`, `run-in-child.ts`, `child-entry.ts`; §2. |
| T1 The nine points | builder | ✅ **Done 2026-11-22**, 8 passed, 1 passed in part | §3: point 8's CPU half is the worker container's, not the runner's. |
| T2 Through PgBouncer and a plain role | builder | ✅ **Done 2026-11-22** | Run B above; point 7. |
| T3 Gates | builder | 🟡 **Typecheck and lint 0**; unit suite in the Status entry | |
| T4 The owner's decision | owner | ⏸️ **Waiting** | §5. Nothing beyond the spike until then. |

## 1. Why, and what was asked

The research of 2026-11-22 (not in the repository; an artifact the owner holds) compared
replacements for self-hosted Trigger.dev, which brings about ten services, Docker-socket access for
its supervisor, a steady stream of advisories and one-way migrations at every version move. It
recommended spiking pg-boss first: MIT, no new service, the ledger's Postgres. The owner approved
the spike the same day. This plan is that spike and nothing more.

What the managed edition actually takes from Trigger.dev, read from the code on `9c63582`:

- 9 cron schedules, one every minute (`managed-sync-tick`);
- 8 on-demand `schemaTask`s;
- one pass per mapping (`queue({ concurrencyLimit: 1 })` plus `concurrencyKey: mappingId`, on
  `run-delta-sync` and `run-discovery`);
- discovery's join window (`idempotencyKey` plus `idempotencyKeyTTL`, `job-resolution.ts`);
- whole-task retries, 3 attempts with exponential backoff, and `AbortTaskRunError` to stop them;
- a one-hour `maxDuration`, and `machine: 'small-1x'`;
- one `triggerAndWait`, in `run-cutover.ts`;
- `runs.retrieve` and `runs.cancel`, in `managed-purge-closed.ts`;
- tags on runs.

No checkpoints, no `wait.*`.

## 2. What was built

`packages/scheduler/src/pg-boss/`, behind its own subpath so neither edition loads pg-boss:

- **`job-runner.ts`, `PgBossJobRunner`.** Queues declared at start, each with its retry policy,
  time limit and heartbeat. It offers:
  - `enqueue` with `serializeBy` (the per-key limit), `idempotency` (key plus TTL) and `tags`;
  - `enqueueAndWait`;
  - `work`, with `RunNotRetried` settled as pg-boss's `deadletter`;
  - `status`, `cancel`, `schedule` and `unschedule`;
  - `overview` and `recentFailures`.

  The join window is ours, not pg-boss's. Its `singletonSeconds` is a clock-aligned slot that
  shares `singletonKey` with the per-key limit, so the runner looks for an earlier run with the
  same key inside a transaction holding `pg_advisory_xact_lock`.
- **`run-in-child.ts`.** One forked Node process per run, with V8's heap capped. A cancel kills it
  with SIGKILL.
- **`spike-fixtures/`.** A create-if-absent copy pass, a worker process that is killed, and a
  runaway pass, all for the tests.
- **Dependencies.** `pg-boss@12.38.2`, MIT, published 2026-11-10, inside the three-day floor's
  limit with nothing to exclude. Its dependencies are `pg`, `cron-parser`, `rrule-temporal` and
  `serialize-error`. `pg` is now a direct dependency of `@openmig/scheduler` too, from the catalog.

## 3. The nine points

The tests use a role made for them: `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`, owning only
a fresh schema. The schema is created for it, because the role may not create one.

| # | Point | Result | Evidence (test in the spike file) |
|---|---|---|---|
| 1 | A tick racing a manual start yields one running pass per mapping | ✅ passed | `point 1`: 6 enqueues for one mapping and 2 for another, at once, on two workers of 4 slots each. All 8 completed. At most 1 active per mapping, 2 side by side across mappings, and each run of the first mapping started after the one before it ended. |
| 2 | A pass killed with SIGKILL is picked up again, and converges | ✅ passed | `point 2`: the worker process was killed at item 11 of 40. The run settled 18.1 s later (run B), on attempt 2 in another process, with exactly 40 rows, attempts `[1, 2]`, and the second attempt copying 29. |
| 3 | A cancel reaches the running pass within one heartbeat | ✅ passed | `point 3`: the handler's `signal` aborted under 10 s after `cancel()`, and the run reads `cancelled`. |
| 4 | Discovery's join window keeps its semantics | ✅ passed | `point 4`: 10 concurrent asks with one key gave 1 run and 9 joins. A reload after it finished, inside the window, joined it. Past the window, measured from that run's creation, a new run started. A different key on the same mapping was a new run that never overlapped the first. |
| 5 | Cutover waits for its final sync without an await primitive | ✅ passed | `point 5`: `enqueueAndWait` polls the child's row. The child waited behind the pass already running on its mapping and carried the cutover's tags. A `RunNotRetried` came back verbatim after 1 attempt of the 3 allowed, and a failure that cleared on its third attempt came back `ok`. |
| 6 | The every-minute tick never overlaps itself | ✅ passed | `point 6`: a `stately` queue. 6 ticks offered in a burst were let in at most 2 (one running, one waiting). The `* * * * *` schedule fired, and at most 1 tick ever ran at a time. |
| 7 | Through PgBouncer in transaction mode, as a non-superuser role, RLS intact | ✅ passed | Run B. `point 7a`: the role is not a superuser and may not create a schema. It owns nothing outside its schema (and `pg_toast`), can read no `public` table, and added no extension. `7b`: every `public` table's `relrowsecurity` and `relforcerowsecurity` are as they were before the run. |
| 8 | Per-worker limits stop a runaway pass the way `small-1x` does | 🟡 passed in part | Memory: `point 8` and `run-in-child.unit.test.ts`. A pass that runs away dies alone at its heap cap with V8's `FATAL ERROR … heap limit` in the run's error, is failed after its attempts, and the same worker then completes the next run. CPU: no process can cap its own CPU. That stays the worker container's `cpus:` or Kubernetes `resources.limits`, the same cgroup mechanism Trigger.dev's runner containers use. On this machine a cgroup with a quota of 50000/100000 throttled a busy child in 31 of 33 periods, which shows the mechanism, not this code. |
| 9 | An operator can see queued, running and failed work | ✅ passed | `point 9`: `overview()` showed 1 active, 1 queued and 1 failed, with the active key. `recentFailures()` gave the failed run's error verbatim, with its attempt and tags. There is no dashboard; pg-boss's own (`@pg-boss/dashboard`, MIT) was not tried. |

## 4. What the spike found that the research did not say

1. **The heartbeat sweep defaults to a minute.** A run whose worker died is failed and retried by
   pg-boss's supervise pass, `superviseIntervalSeconds`, default 60. On the first run of point 2
   that put the pickup at 59 s. The runner now sets 15 by default; the tests use 1.
2. **One run per key is not first in, first out.** A `singleton` queue limits a key to one active
   run, but which waiting run goes next is not promised. In point 4 the edited count ran before the
   original. Trigger.dev's queues keep order. Nothing here needs the order, since every pass is an
   idempotent delta, but if something ever did, `key_strict_fifo` is pg-boss's answer: it
   holds a failed job's key until it is dealt with, which is a different contract.
3. **The join window is ours to keep.** pg-boss has no idempotency key with a TTL measured from the
   first run. The runner's is about forty lines and one advisory lock.
4. **No await, and no tags field.** Cutover polls the child's row (1 s by default). Tags ride in the
   job's data.
5. **Unhandled `error` events.** pg-boss reports trouble as an `error` event. The runner logs it
   verbatim rather than let it kill the process or swallow it (hard rule 9).

## 5. For the owner: what a decision would start

Nothing below is done, and none of it starts without the owner's word.

- **If yes:**
  - an ADR superseding ADR-0004's managed half;
  - the tasks under `apps/worker/src/jobs` moved behind the runner, one at a time, starting with
    `managed-sync-tick` and `run-delta-sync`;
  - `enqueue-unless-held.ts` and `job-resolution.ts` changed to it;
  - `orchestrator_ref` becoming the job id;
  - a worker service in `managed.yml` with `cpus: 0.5` and a memory limit;
  - then, last, the Trigger.dev services, scripts and pins removed.
- **If not yet:** the branch can stay a draft, or be closed; it changes nothing that runs.
- **What it would not settle:** pg-boss has one main maintainer, so if it were taken, a guard
  should pin the version and watch its schema version (`schemaVersion()`), as the other pins are
  watched.
