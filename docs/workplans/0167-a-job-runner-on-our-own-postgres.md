# Workplan 0167 — A job runner on our own Postgres

> **In one line:** pg-boss (MIT) on our own Postgres in place of self-hosted Trigger.dev for the managed edition's jobs: a spike that proved nine points against a real Postgres, directly and through PgBouncer, then the replacement in steps, from the runner, imported by nothing, to Trigger.dev's removal.

## Status — 2026-11-22 (update this block at the end of every session)

**2026-11-22: the privacy policy's *Server logs* row, decided by the owner.** Under Trigger.dev
each run had its own container, whose log went when the run ended; under the runner, runs are
processes in one long-lived worker container, whose log goes when the worker is replaced, at each
update of the service. So privacy §9's *"for a background task, when its run ends"* stops being
true once the runner runs the jobs. The owner, verbatim: *"Option A, but keep the policy on 1.0,
since no tester has yet accepted it."* Option A: the background tasks' logs go at each update of
the service, as the app's do. Both languages say so, still 1.0, edited in place and dated
2026-11-22, with the two privacy pins in `ACCEPTED_WORDS` moved
(`scripts/a-version-the-tester-accepted.unit.test.ts`). It merges together with T7's pull request,
which turns the runner on, so the published text never says more than the running service does.
§4.5 and the *Records of the background tasks* row rest on #2040, which merges before this one:
the worker writes every line a run writes to stdout or stderr to its own output, prefixed with the
queue and the run id; a child that dies is reported by a fixed sentence and a verdict, never by its
text; and a run that fails on its own stores only its error's `{ name, message }`, which the jobs'
wrapper makes a category and a reference. It merges only while no tester has accepted any version,
which the owner confirms on the day it merges: if one has by then, the words take 1.1 instead, in
both languages, `LEGAL_VERSIONS` and `ACCEPTED_WORDS`, with §13's notice. If it merges on a later
day, both *Last updated* lines and both pins move to that day, in the same pull request. The row
holds for the worker only with what T7 carries (its row below). `site/legal/README.md` records the
edit, as every earlier change of the policy's words did.

**2026-11-22, later: the owner's yes, and the runner as production code (T4, T5).**
The owner, after the spike: *"Put in the successful spike (replace triggerdev)."* Earlier the same
day they had approved the spike. [ADR-0054](../adr/0054-the-managed-editions-jobs-run-on-pg-boss.md)
records the decision: the managed edition's jobs move from self-hosted Trigger.dev to pg-boss on
our own Postgres, worked by a worker container, and ADR-0004's self-host half stands. It is
accepted and *Pending*: in force at T7, and until then Trigger.dev runs every job. ADR-0004 is
amended in place, as ADR-0051 prescribes: its status, its first operative rule and a new
amendment log.

On branch `claude/ownpace-public-readiness-y7orc6-pgboss-runner`, from `main` at `0683eb04`
(alpha.15's fold), with the spike's changes brought in squashed. The spike's own commits fail
`commit-convention`, the one job that failed on draft PR #2034, with `ci-complete`, which waits
on it (CI run 45025459438, where `integration-tests` passed the runner's 10 tests on both
architectures against Postgres 18.7). Nothing imports the runner at run time, and its API is §2's.

- **Names.** The test is `job-runner.integration.test.ts`. Its fixtures are in `__testing__/`, the
  repository's place for modules only tests load: `copy-pass.ts`, `worker-to-kill.ts` and
  `forked-passes.ts`. Its role is `ownpace_jobs_test`. No title or comment says "spike".
- **The pin guard §5 asked for**, `scripts/a-job-schema-the-runner-was-not-proved-on.unit.test.ts`:
  - pg-boss exact in every manifest that names it, and one version in the lockfile;
  - the installed package the pinned one;
  - the runner's `PG_BOSS_SCHEMA_VERSION`, 46, equal to pg-boss 12.38.2's own `pgboss.schema` in
    its `package.json`. That is the version pg-boss installs and migrates to, and the one
    `PgBoss#schemaVersion()` reads back.
  - Mutated: a caret range failed 3 of its 6 tests, and the constant at 47 failed 1.
- **The run-time half.** pg-boss runs on a schema that a later release migrated further, without
  a word. So `start()` now refuses any version but 46, and stops pg-boss before it throws. A test
  of it joins the integration file, which now has 11.
- **The appliance.** `no-managed-leakage` forbids `pg-boss` and `@openmig/scheduler/pg-boss`.
  Mutated: the appliance's entry importing the subpath failed it, with both reasons named.
- **The evidence**, on a throwaway cluster from `scripts/local-pg.sh` (PostgreSQL 16.15 here; CI's
  Testcontainers run is the one to trust for 18):
  - **Run A, directly:** `Tests 11 passed (11)`, 73.5 s. Point 2 was killed at item 11 of 40 and
    settled 18.4 s after the kill.
  - **Run B, through PgBouncer 1.22.0 with `pool_mode = transaction`:** `Tests 11 passed (11)`,
    73.2 s; point 2 settled 18.9 s after the kill. PgBouncer's `SHOW STATS` counted 2,289
    transactions to the test database, on the pools of both roles.
  - **Gates:** `tsc --noEmit` 0, and ESLint 0 on the 11 changed TypeScript files. The scheduler's
    3 unit files and the 72 guards that read what this changes: 74 of 75 files passed, 3,001
    tests, 23 skipped. The one failure is `ui-build-output`, which builds `apps/web` through pnpm,
    and this session may not run pnpm. Every guard under `scripts/`, with those: 314 of 316 files,
    the other failure being `a-measurement-that-could-not-reach-the-deployments-client`, which
    runs `pnpm exec tsx`. The six docs checks pass, and so does `commit-convention`.
- **CHANGELOG:** one line under *Unreleased*, *Added*. The API's image installs
  `@openmig/scheduler`'s dependencies, so it now carries pg-boss; the appliance's bundle does not.
- **Next:** T6. T6 to T9 are not started.

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

- **Run A, directly against Postgres:** `Tests 10 passed (10)`, 73.0 s.
- **Run B, through PgBouncer 1.22 with `pool_mode = transaction`:** `Tests 10 passed (10)`, 71.6 s.
  PgBouncer's own `SHOW STATS` counted the suite's transactions through it to the test database
  (4,361 across two runs).
- Both are runs of the committed code. Point 2 settled 18.6 s after the kill in each.
- **The per-run process:** `run-in-child.unit.test.ts`, 4 passed.
- **The repository gates on the branch:**
  - `pnpm typecheck` 0 and `pnpm lint` 0.
  - `pnpm test`: 1367 of 1368 files and 22,282 tests passed, 40 skipped. The 1 failure is
    `scripts/every-release-is-a-starting-point.unit.test.ts` ("lists no release that is not
    tagged"). This checkout carries 4 tags, so alpha.1 onward read as untagged. The branch
    touches neither tags nor `CHANGELOG.md`, and CI's full checkout is the one to read it.
- **Three guards the first unit run caught, now fixed:**
  - `an-image-that-shipped-what-it-never-runs`: no `import()` of a computed name, so the run's
    module is now the forked entry (`serveRuns`).
  - `a-subpath-the-alias-swallowed`: the new subpath is pinned in `tsconfig.base.json` and
    `vitest.aliases.ts`.

| Task | Owner | Status | Notes |
|---|---|---|---|
| T0 The runner | builder | ✅ **Done 2026-11-22** | `job-runner.ts`, and `run-in-child.ts` with `serveRuns`, the forked run's entry; §2. |
| T1 The nine points | builder | ✅ **Done 2026-11-22**, 8 passed, 1 passed in part | §3: point 8's CPU half is the worker container's, not the runner's. |
| T2 Through PgBouncer and a plain role | builder | ✅ **Done 2026-11-22** | Run B above; point 7. |
| T3 Gates | builder | ✅ **Done 2026-11-22** | Typecheck and lint 0; unit 22,282 passed, 1 failed for missing tags in this checkout (Status entry). CI not dispatched, by instruction. |
| T4 The owner's decision | owner | ✅ **Decided 2026-11-22: yes** | The owner, after the spike: *"Put in the successful spike (replace triggerdev)."* They had approved the spike earlier that day. ADR-0054 records it; §5 lists what it starts. |
| T5 This runner, merged | builder | 🟡 **Built 2026-11-22**, on `claude/ownpace-public-readiness-y7orc6-pgboss-runner` | The spike as production code, imported by nothing at run time; ADR-0054; the pin guard and the schema refusal (the Status entry of 2026-11-22, later). Done when its pull request merges. |
| T6 The jobs on the runner, behind a switch | builder | ⬜ **Not started** | §5: the tasks under `apps/worker/src/jobs` and the API's enqueue paths (`enqueue-unless-held.ts`, `job-resolution.ts`) on the runner, one at a time, from `managed-sync-tick` and `run-delta-sync`; `orchestrator_ref` the job id. The switch is off, so Trigger.dev stays the path that runs. |
| T7 The worker service, and the switch on | builder, owner | ⬜ **Not started** | A worker service in `managed.yml`, with `cpus: 0.5` and a memory limit, and the jobs' schema and role made by the bring-up; the switch on; the deploy and the managed E2E moved to it. ADR-0054 comes into force here (its *Pending*), and ADR-0004's first rule then names pg-boss. For privacy §9's *Server logs* row (2026-11-22) to be true, the switch also carries: the worker's image built and its container recreated at every deploy, like the API's (a container whose image does not change keeps its output: `a-journal-that-outlived-the-container`); a run's output forwarded to the worker's log (#2040); *How long they stay* in `docs/operator-runbook.md` and the log collector's paragraph in `docs/managed-bring-up.md` no longer saying "when its run ends" for a task; and `docs/ending-the-alpha.md` step 3 also emptying pg-boss's schema, read by `the-end-of-the-alpha-empties-the-task-history`. It merges together with the privacy PR (#2042). |
| T8 Trigger.dev's services stopped | builder, owner | ⬜ **Not started** | Stopped on the stacks, their volumes kept as the way back. |
| T9 Trigger.dev removed | owner | ⬜ **Not started** | Later, and only on the owner's word: Trigger.dev's code, images, scripts, pins and volumes removed. |

## 1. Why, and what was asked

The research of 2026-11-22 (not in the repository; an artifact the owner holds) compared
replacements for self-hosted Trigger.dev, which brings about ten services, Docker-socket access for
its supervisor, a steady stream of advisories and one-way migrations at every version move. It
recommended spiking pg-boss first: MIT, no new service, the ledger's Postgres. The owner approved
the spike the same day. This plan was that spike; since the owner's decision (T4) it also holds
the steps that replace Trigger.dev (T5 to T9).

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
  with SIGKILL. The run's module is the process's entry and ends in `serveRuns({...})`, so nothing
  imports a computed name.
- **`__testing__/`** (`spike-fixtures/` in the spike). A create-if-absent copy pass
  (`copy-pass.ts`), a worker process that is killed (`worker-to-kill.ts`), and the passes a forked
  process runs, the runaway among them (`forked-passes.ts`), all for the tests.
- **Dependencies.** `pg-boss@12.38.2`, MIT, published 2026-11-10, inside the three-day floor's
  limit with nothing to exclude. Its dependencies are `pg`, `cron-parser`, `rrule-temporal` and
  `serialize-error`. `pg` is now a direct dependency of `@openmig/scheduler` too, from the catalog.

## 3. The nine points

The tests use a role made for them: `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`, owning only
a fresh schema. The schema is created for it, because the role may not create one.

| # | Point | Result | Evidence (test in `job-runner.integration.test.ts`) |
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

**Decided 2026-11-22: yes** (T4). [ADR-0054](../adr/0054-the-managed-editions-jobs-run-on-pg-boss.md)
records it, and the steps are T5 to T9, one pull request each. What follows is the section as it
was written before the decision.

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
  watched. Built in T5: `scripts/a-job-schema-the-runner-was-not-proved-on.unit.test.ts`, and
  `start()`'s refusal of any other schema version.
