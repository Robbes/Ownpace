# Workplan 0167 — A job runner on our own Postgres

> **In one line:** pg-boss (MIT) on our own Postgres in place of self-hosted Trigger.dev for the managed edition's jobs: a spike that proved nine points against a real Postgres, directly and through PgBouncer, then the replacement in steps, from the runner, imported by nothing, to Trigger.dev's removal.

## Status — 2026-11-22 (update this block at the end of every session)

**2026-11-22, later still: the worker on pg-boss, inert until started (T6's second step).** On
branch `claude/ownpace-pgboss-worker-process`, from the catalog's branch with the runner's gaps
merged (#2043, #2040). Nothing starts it: no compose service, no script and no workflow changes,
and Trigger.dev runs every job. No migration in either chain.

- **Built.** `apps/worker/src/runner/`: `main.ts`, the process (refuses, exit 1 and one line,
  unless `OWNPACE_JOB_RUNNER=pg-boss` and `JOBS_DATABASE_URL`); `worker.ts`, the runner started on
  `pgboss` (supervise 15 s), the catalog declared, each queue worked with its concurrency, one
  forked process per run (410 MB heap, killed on a cancel, a lost claim or 30 s before its hour),
  the nine schedules in UTC sent `{}`, `/health` on `127.0.0.1:3002`, and the stop (no fetch, 45 s
  for the runs going, then killed to be retried, exit 0); `runs/<queue>.ts` × 17, static imports
  ending in `serveRuns`; `serve-job.ts`, the payload parsed with the job's schema before the run
  (a refusal is `ZodError`, not retried, as Trigger.dev 4.8.8's `TaskPayloadParsedError` is
  `skipped`), and `oom_score_adj` raised; `pg-boss-context.ts`, the pg-boss half of the run
  context, which only the entries import. The tick's pg-boss half of the interlock: it also holds
  while the shared beat is fresh and newer than its own. `apps/worker/package.json` declares `pg`
  and `drizzle-orm`.
- **Proved, on a throwaway cluster from `scripts/local-pg.sh`** (PostgreSQL 16; CI's
  Testcontainers run is the one for 18, on amd64 and arm64): `worker.integration.test.ts`
  **19 passed, 1 skipped** (the harness's Nextcloud case; no Nextcloud here), 86 s, on #2040's
  head `61394c96`. The tick's
  schedule fired on the minute and enqueued `run-delta-sync` keyed by the migration with its tags;
  a refused payload failed once as `ZodError`; a real `run-discovery` completed and wrote its row
  as `app_user`; a cutover's wait ran behind a pass already running on its migration; the purge's
  verdicts (live, finished, gone, `run_…`); a SIGKILL the worker did not send failed the run on
  its first attempt, not retried, as Trigger.dev 4.8.8 reads it (`TASK_PROCESS_MAYBE_OOM_KILLED`,
  the coordinator's correction of the contract's point 8); a worker killed mid-run (a test-only
  worker in its own process) took its run's process with it, and the next worker ran attempt 2,
  never two on one key; a run past its limit
  killed before the next on its key started (`RunTimedOut`, not retried); a cancel killed within a
  heartbeat; a stop killed at its grace and retried; the interlock's two rules, its own beat, and
  two runners left running; `main.ts` healthy and exiting 0 on SIGTERM.
- **Unit**: `worker.unit.test.ts` 53 passed; the guards: `a-pass-that-opened-the-owners-pool`
  (rule 10: the runner reads `JOBS_DATABASE_URL` alone, its parent loads no job, no Trigger.dev task
  loads pg-boss) 194, `an-image-that-shipped-what-it-never-runs` (the worker's closure) 25,
  `runs-without-a-transpiler` (the fork paths) 5, the tick's two anchor tests 14.
- **Mutations**, each restored (sha256 checked): 17, every one failing its test; and 4 more for the
  review's points below.
- **Gates on the final tree** (#2040 at `61394c96`, `main` at `2f86401c`): `tsc --noEmit` 0;
  `pnpm lint` 0; the whole unit tier, **1,178 files, 18,554 passed, 62 skipped**; every integration
  file of `apps/worker` and `packages/scheduler` on the local cluster, **155 passed, 3 skipped**
  (the two Stalwart files, and the Nextcloud case).
- **The review of #2043, its points on the catalog's consumers (fixed here).** (1) `run-cutover`
  gets three hours, not one: Trigger.dev 4.8.8 counts `maxDuration` on CPU time, wall time less its
  pauses, and `triggerAndWait` is one (`usage.pauseAsync`), while pg-boss's limit is the wall clock
  and a run that reaches it is not retried; the two catalog tests exempt it by name, with that
  reason. (2) One list of "not retried", the runner's `NOT_RETRIED_ERROR_NAMES`:
  `what-a-run-leaves.ts` keeps its two names private for its Trigger.dev mapping, and its exported
  `failsOnceByName`/`FAILS_ONCE_NAMES` (this plan's entry above names them) are gone. (4) The
  catalog's `pollingIntervalSeconds` is dropped, since `work` takes one interval for the whole
  runner (#2040 has no option per queue). (5) The owners-pool guard's `valueImports` reads
  `import { type X } from …` and `import {} from …` as a load, as Node keeps them. (6) The job's
  and the runner's `RunContext` are imported under their own names where both meet. (7) The
  CHANGELOG line and the worker README's `configure` sentence corrected.
- **Concurrency, recorded, not redesigned, for alpha.16** (also ADR-0054's *Pending*): each queue
  of a job somebody asks for is worked one run at a time across every organisation (Trigger.dev
  runs a count per migration side by side, and bounds none of verification, confirmation, the
  applies, the cutover and the rollback); and the worker may run `MAX_PASSES_IN_FLIGHT` + 17 runs
  at once where the plane admits `MAX_PASSES_IN_FLIGHT` + 2. Follow-up: a worker-wide cap of
  `MAX_PASSES_IN_FLIGHT` + 2.
- **Memory, measured** (`worker.integration.test.ts`, peak resident, Node 22 here): the tick's
  process 196 MB, a real count's 203 MB, a real pass's with its module and pools loaded 198 MB, the
  worker's parent 120 MB. A copying pass peaked at 307 MiB on Trigger.dev's `small-1x` (0150). The
  realistic peak, (`MAX_PASSES_IN_FLIGHT` + 1) passes, the three schedules of :23 (the tick, the
  month's invoices, the purge) and one of each of the seven other on-demand kinds, with each pass
  at 307 MB, each other run at 203 MB and the parent at 120 MB: 3,378 MB at a cap of 3 (the limit
  is 3,328 MB: short by 50 MB) and 4,299 MB at 6 (4,864 MB: holds). With each pass at its 512 MB budget and each other
  run at 256 MB, the formula that holds is (`MAX_PASSES_IN_FLIGHT` + 1) × 512 MB + 2,816 MB:
  4,864 MB at 3, 6,400 MB at 6.
- **Next:** the API's doors, the operator's commands, the worker's service, then the switch (T7).

**2026-11-22, latest: the second review of #2040, fixed (T5a).** On the same branch, after `main`
(#2043, the job catalog) was merged in. The coordinator's second review, at `5fe0d0b6`, confirmed
the first round's fixes 3, 4, 5, 7 and 8. It found two blocking bugs and three more fixes, and
decided one retry question:

- **Blocking: a run's last words were lost.** In a forked run the pipes to the parent do not
  block. `serveRuns` exited right after its answer, and what was still waiting in the pipe was
  dropped: of 5,000 lines of 100 bytes, the old code forwarded a part. It now waits for stdout and
  stderr to drain before it exits, and all 5,000 arrive.
- **Blocking: the heap test was flaky** for the same reason. Its fixture now drains stderr before
  it runs away, and the test asks that all 400 warnings arrive.
- **Decided: a run's process ended by a SIGKILL the runner did not send, or by SIGABRT, is not
  retried.** This is Trigger.dev 4.8.8's `TASK_PROCESS_MAYBE_OOM_KILLED`, which `shouldRetryError`
  does not retry. In a container with a memory limit, the usual sender is the kernel's
  out-of-memory killer.
  - A SIGKILL from outside is `RunPossiblyOutOfMemory`.
  - SIGABRT, or V8's line, is `RunOutOfMemory`. V8's line can be lost when the worker has not
    drained the pipe, which is why SIGABRT alone counts too.
  - A run the runner stopped itself keeps its own settlement: `RunTimedOut` at its limit, and a
    cancel stays a cancel.
  - A claim lost because the worker died or restarted is retried, by pg-boss's sweep.
  - This reverses the first round's "a process killed from outside is retried". ADR-0054 §2's
    table, its sentence, the *Pending* bullet and the amendment log say so.
- **The fixes:**
  - a run in the worker's own process that stops at its limit with its own error (a pass's
    "stopped", an `AbortError`) is `RunTimedOut`, not retried. The limit now overrides any error
    that would be retried, not only a `ChildRunDied`;
  - a line over 16 KiB is forwarded in prefixed pieces, instead of being held whole by `readline`;
  - the records: the lines of the entries below that the reviews changed, §3 point 8, and the
    wording of the `recentFailures` bound when a queue holds fewer failures than the limit.
- **For the other sessions, unchanged:** on a fresh stack a producer is refused with "pg-boss is
  not installed" until the worker has started once.

**The evidence**, on `scripts/local-pg.sh`'s cluster (PostgreSQL 16):

- `job-runner.integration.test.ts`: `Tests 29 passed (29)`. The second review added 4 tests and
  replaced 1:
  - an outside SIGKILL and an outside SIGABRT each failed the run on attempt 1, with no second
    attempt;
  - a worker killed outright took its run's process with it, and another worker ran attempt 2,
    starting after the first one's last write;
  - a run in the worker's own process, stopped with its own error and with an `AbortError`, was
    `RunTimedOut` on attempt 1.
- `run-in-child.unit.test.ts`: 23 passed, 3 runs in a row; 5 tests are new.
- **Gates at `61394c9`:**
  - `pnpm lint` 0 and `pnpm typecheck` 0.
  - `pnpm test`: 22,375 passed, 40 skipped, and 1 failed. The failure is
    `every-release-is-a-starting-point`, for this checkout's 5 tags.
  - The integration file passed 29 of 29 again, in 152.1 s, beside that unit run.
- **Mutations**, each restored byte for byte. Each of these failed its test:
  - the drain before exit removed;
  - the 16 KiB split removed;
  - every SIGKILL read as from outside;
  - SIGABRT not read as out of memory;
  - `RunPossiblyOutOfMemory` taken out of the names (unit and integration);
  - the limit overriding only a `ChildRunDied`;
  - the `disconnect` exit removed (the worker-death test).
**2026-11-22, later still: the API's doors on the switch (T6, the API's step).** On branch
`claude/ownpace-pgboss-api-doors`, from T6's first step (`claude/ownpace-public-readiness-y7orc6-pgboss-a1-catalog`)
with the runner's gaps (`claude/ownpace-pgboss-runner-gaps`) merged in. Only `apps/api` changed, with one guard under `scripts/`, this plan
and the CHANGELOG: nothing in `packages/`, `apps/worker`, `deploy/` or `.github/`, no migration, and nothing sets the switch, so
the API runs every job on Trigger.dev as before.

- **The switch**, `apps/api/src/job-runner.ts`: `OWNPACE_JOB_RUNNER` is `trigger` or `pg-boss`, and unset or empty is
  `trigger`; any other value is refused in one sentence, which stops the API's start (`index.ts` logs the runner it
  read). It lives in the API, so the tests that mock `@openmig/scheduler` with a bare factory need no new export.
- **The enqueue**, `enqueue-unless-held.ts`. `Enqueue` is neutral, `(taskId, payload, { tags, concurrencyKey,
  idempotencyKey, idempotencyKeyTTL }) => Promise<{ id }>`. On Trigger.dev it is still `getTriggerClient().tasks.trigger(…)`,
  so every existing mock hears it. On pg-boss it is the producer's: `concurrencyKey` as `serializeBy`, the idempotency
  key with its `'15m'` as `{ key, ttlSeconds: 900 }`, the tags. A run turned away without an id is an error, never a
  run. `DISCOVERY_JOIN_WINDOW_SECONDS` (900) beside the window, held to it by a test.
- **The producer.** One a process, #2040's `PgBossProducer` with the catalog's seventeen queues on `JOBS_DATABASE_URL`
  and the schema `pgboss`, imported dynamically on the first pg-boss enqueue or cancel. The URL is read once and never
  logged; unset, the enqueue is refused in one sentence. A producer whose start failed is closed and forgotten, so the
  next press tries again. It is closed on SIGTERM and SIGINT, after which the signal does its default, and by the
  operator's script before it ends its pool.
- **The cancel**, `cancelRun(ref)`, handed to the close by `routes/support.ts`, `routes/tenants/index.ts` and
  `scripts/operator.ts`. Each runner cancels its own refs (`run_…` on Trigger.dev, a UUID on pg-boss) and refuses the
  other's in one sentence, which the close logs and leaves to the quiesce. A pg-boss run gone or settled reads as
  finished, in a log line.
- **Readiness**, `routes/ready.ts`: `off` when Trigger.dev has no `TRIGGER_SECRET_KEY` or pg-boss no
  `JOBS_DATABASE_URL`; else the shared beat, `managed-sync-tick`, whichever runner, so Gatus's row needs no change. A
  switch it cannot read is `down`, the sentence in the log.
- **Tests.**
  - New: `job-runner` (27), `a-runner-the-api-does-not-load` (5): in trigger mode the whole app and the operator's script
    load neither `pg-boss` nor `@openmig/scheduler/pg-boss`, and no shipped file imports either but for types, but
    `job-runner.ts`'s one dynamic import. `a-job-on-pg-boss.integration` (6), on a real pg-boss: two discovery presses
    are one job, the second `joined`; a press after the migration changed is a new job on the same singleton key, which
    a worker with a free slot does not start while the first runs; *Sync now* answers a UUID, its job singleton by the
    migration with its tags; a queue the worker never made lands on *Start*'s answer as `queued: false` with the
    producer's sentence; the close cancels the queued pass by its `orchestrator_ref`; readiness reads the shared beat,
    not the runner's own. Trigger.dev's client throws if asked.
  - Changed: `a-hold-that-holds-every-door` (the producer is reached from the one function and the cancel only, and the
    runner's module named only there), `a-tick-that-says-it-ran` (four cases on the switch).
  - Guard: `scripts/a-route-that-opened-the-owners-pool` counted `JOBS_DATABASE_URL` as the owner's URL, as it counts
    every `*DATABASE_URL` but `APP_DATABASE_URL`. It is the jobs role's, so it joins `APP_DATABASE_URL` as a name that
    is not the owner's, and the guard's compose case now holds it, once compose hands it to the API, to `ownpace_jobs`.
- **Mutated**, each once, and restored byte for byte (`cmp`), each failing the test meant for it, 13 in all: the switch
  admitting `pgboss`; `concurrencyKey` dropped; the join's window 0; trigger mode sent to pg-boss; a value import of the
  runner's module; readiness by Trigger.dev's key alone; a UUID cancelled on Trigger.dev; the pg-boss cancel never
  asked; a door reaching the producer; readiness on the runner's own beat; a failed start kept; and in the guard, an
  owner's name exempted, and the jobs URL not.
- **Gates.**
  - `tsc --noEmit` 0, and ESLint 0 on the 13 changed TypeScript files.
  - Unit, every file of `apps/api` and every guard under `scripts/`: 483 files, 9,895 tests passed, 36 skipped. Before
    the change, the API's 177 files: 2,383 passed.
  - `a-job-on-pg-boss.integration` on a throwaway cluster from `scripts/local-pg.sh`: 6 passed (PostgreSQL 16 here;
    CI's Testcontainers run is the one to trust for 18).
- **Next:** the worker, the operator's `jobs` commands, compose and the scripts, then the switch on (T7).
**2026-11-22, later still: T6's operator commands, `operator.sh jobs` (pg-boss mode).** On branch
`claude/ownpace-pgboss-operator-jobs`, from the catalog's branch (#2043) with the runner's gaps
(#2040) merged in. Nothing that runs changes: Trigger.dev is still the default, and there every
`jobs` command says so in one sentence and exits 1. No migration; `deploy/compose` changes only in
`operator.sh`'s usage text.

- **`apps/api/src/scripts/operator-jobs.ts`**, dispatched from `operator.ts` (`case 'jobs'`, loaded
  by a dynamic import so no other verb loads pg-boss) and `apps/api/package.json`
  (`operator:jobs`). Through #2040's `PgBossProducer` only, no SQL of its own on pg-boss's tables:
  `jobs` (`overview`: per catalog queue, queued, active, failed, active keys), `jobs failures
  [<task>] [--limit n]` (`recentFailures`, every queue merged newest first and cut at the limit),
  `jobs show <id>` and `jobs cancel <id>` (`status` and `cancel` by id alone; a `run_…` ref refused),
  `jobs run <task> '<json>' [--despite-hold]` (`enqueue`, with the catalog's key for a singleton
  queue and the tags `operator`, `tenant:…`, `mapping:…`).
- **As `ownpace_jobs`**: `JOBS_DATABASE_URL` when set, else operator.sh's own URL with that role and
  `JOBS_DB_PASSWORD` in place of the owner; any other role refused, and no refusal quotes a URL.
  The owner pool operator.ts already holds reads the hold, with `readOpenPause`, and nothing else.
- **What it prints**: ids, counts, states, tags, times in UTC, and of an error its `name` and
  `message` on one line, cut at 300 characters. No payload value, no run output.
- **`jobs run` imports no job module**: it checks a JSON object, `{}` for a schedule, and a
  `mappingId` for a singleton queue; the run's own schema refuses the rest, failing once, not
  retried (`ZodError` by name).
- **Tests.** `operator-jobs.unit.test.ts`, 51: the switch, the arguments, the connection, the hold,
  what is printed, and what the module imports. `operator-jobs.integration.test.ts`, 5, on a real
  pg-boss worked by `PgBossJobRunner`: the 17 queues listed, a real `platform_pause` hold refusing
  `jobs run` with nothing queued and `--despite-hold` starting it, a failure read back without
  its payload, the active key of a pass, and a cancel by id that stops it.
  `scripts/a-route-that-opened-the-owners-pool` gets an entry for the new file, pinned to its two
  reads in `jobsConnectionString()`.
- **Mutated**, each restored byte for byte (`cmp`), each failing its test: the hold ignored (unit
  1 of 51, integration 1 of 5), trigger mode passed through (6), the whole error printed (3), any
  role accepted (2), active keys dropped (integration 1 of 5), failures oldest first (1), no
  `serializeBy` (1), a `run_…` ref accepted (2), a schedule given a payload (1), `operator:jobs`
  removed from package.json (`a-verb-three-files-have-to-agree-on`, 1 of 6), the guard's pin cut
  (1 of 13).
- **Gates.** `tsc --noEmit` 0; ESLint 0 on the changed files. Unit, every file under `scripts/`
  and `apps/api/`: 482 files, 9,911 passed, 36 skipped. The integration file on a throwaway cluster
  from `scripts/local-pg.sh` (PostgreSQL 16 here; CI's Testcontainers run is the one to trust for
  18): 5 passed, 18.4 s.

**2026-11-22, later still: T6's first step, the job catalog and the jobs made runner-neutral.**
On branch `claude/ownpace-public-readiness-y7orc6-pgboss-a1-catalog`, from `main` with T5 merged
(#2038). Nothing that runs changes: Trigger.dev runs every job under the same ids, queues, machines
and retries, nothing runs on pg-boss, and nothing reads a switch. No migration in either chain, and
`deploy/compose` is untouched.

- **The job catalog**, `packages/scheduler/src/pg-boss/catalog.ts`, exported from
  `@openmig/scheduler/pg-boss`. Seventeen queues named by the tasks' ids: nine schedules on their
  crons, `stately`; eight on demand, `singleton` by the migration for the pass and the count, by
  `confirm:` and the migration for a confirmation, `standard` for the rest. Every queue: three
  attempts, from 5 s doubling to at most 60 s, an hour, a beat every 30 s and a 410 MB heap. One run
  at a time on a worker, but the pass: `MAX_PASSES_IN_FLIGHT` and one more (`concurrencyOf`). Polling
  every 2 s for a job asked for, 10 s for the tick and 30 s for the other schedules. Data: it
  imports nothing, and each entry is a `QueueSpec`. No subpath of its own, since nothing reads it at
  run time yet; the leakage guard's pattern for the subpath covers one.
- **The run context**, `apps/worker/src/jobs/run-context.ts`. `RunContext` carries `runId`,
  `attempt` and `runner`; `JobRunnerPort` offers `enqueue`, `enqueueAndWait`, `verdict` and `cancel`,
  and names its runner. The Trigger.dev half, `onTriggerDev`, holds the SDK calls the jobs made, with
  the arguments they had: the tick's `runDeltaSync.trigger(…)` with its `concurrencyKey` and tags,
  the cutover's `configure` and `triggerAndWait`, the purge's `runs.retrieve` and `runs.cancel`, and
  the pass's `ctx.run.id`, read as defensively as before.
  - The tick's `configure` now comes right before each enqueue, as the cutover's always did. Nothing
    else in the tick calls the SDK, and a tick that enqueues nothing no longer calls it.
  - Every job imports the module, so it loads only the SDK's two calls and does nothing when it is
    imported (rule 9 of `a-pass-that-opened-the-owners-pool`).
  - A pass's task reaches it from the job that enqueues one, as a loader, so each process loads the
    pass's module when it did before.
- **The seventeen jobs.** Each exports its run, `<job>Run`, wrapped in `leavesAReference` and taking a
  `RunContext`, and its zod schema: the eight on demand their own, each schedule an empty strict one.
  Each Trigger.dev definition is `run: onTriggerDev(<job>Run)` under the same id, queue and machine.
  Every run's body is as it was, at its own indentation, but for the calls above.
- **"Fails once" by name**, `failsOnceByName` and `FAILS_ONCE_NAMES` (`AbortTaskRunError`,
  `RunNotRetried`) in `what-a-run-leaves.ts`, for a runner that hears only an error's name. A task's
  own `RunNotRetried` is a verdict too; `AbortTaskRunError` is still the class the plane is handed.
- **The tick's interlock across runners, its Trigger.dev half.** Each runner's tick has a beat of
  its own, `managed-sync-tick-trigger` and `managed-sync-tick-pg-boss` (`SYNC_TICK_BEAT_ON` in
  `@openmig/managed`). Before the operator's hold, the tick reads the other runner's beat
  (`readTickBeat`, which takes a window now: 90 s). While that is fresh it starts no pass, says so,
  and beats as its runner alone. Otherwise it writes the shared beat and its runner's, at one time.
  The rule is written once for either runner; the pg-boss half's second rule, the shared beat newer
  than its own, is the worker's. No migration: 0030's CHECK admits both names, and 0033 grants the
  system role INSERT, SELECT and UPDATE (beat_at) on the whole table. A test reads both migrations
  and writes both beats as `ownpace_system` on PGlite.
- **Not taken: loading the pass lazily in the tick**, which would end the idle tenant pool the tick
  opens at import. The pass's module points the process's sinks at its own pools when it is
  imported, so loaded during the tick's run it would take them from the system pool. A throwaway
  test set a sink, imported the module, and the sink heard nothing after. The tick loads it at its
  top, as before.
- **Tests.**
  - New: `the-catalog-is-the-tasks` (17), `a-tick-that-holds-for-the-other-runner` (10) and
    `run-context` (12).
  - Changed: `a-run-that-kept-a-testers-words` and the five tests that read a run's body as text;
    `a-machine-every-task-names` (the catalog's heap); `a-deliberate-stop-that-was-retried` (the
    decision by name); `a-tick-that-says-it-ran` (five beats).
  - `a-failed-type-ends-no-pass` calls `runDeltaSyncRun` with a context, without mocking the SDK,
    and sees the context's id on the run row.
  - Guards: `scripts/a-pass-that-outlives-its-runner` (the catalog's hour), and the owners-pool
    guard's rule 9. `apps/selfhost/src/no-managed-leakage` now holds that no file under
    `packages/scheduler/src/pg-boss/` is reached: the catalog imports nothing, so a relative import
    of it passed the specifier check.
  - `a-system-role-that-is-not-the-owner`: the tick, as the system role, holds while the pg-boss
    runner's beat is fresh, and starts passes again once it is gone.
- **Mutated**, each once, and restored byte for byte (`cmp`), each failing the test meant for it, 17
  in all:
  - the catalog: a cron, a key, the attempts, the hour, the heap;
  - the tick: its hold beating the shared beat, its last beat of its runner, a window of 0 ms
    (integration, 1 of 41 failed);
  - the beats: a key the CHECK refuses, the window ignored;
  - the run context: `configure` dropped, the verdict's order swapped, a job module imported;
  - the rest: `RunNotRetried` dropped from the names, the pass's id lost, the appliance importing
    the catalog by a relative path, a definition that does not call `onTriggerDev`.
- **Gates.**
  - `tsc --noEmit` 0, and ESLint 0 on the 40 changed TypeScript files.
  - Unit, every file of `apps/worker` and `packages/scheduler`: 54 files, 656 tests.
    `packages/managed`, the appliance's leakage guard and the API's two beat tests: 69 files, 868.
  - Every guard under `scripts/`: 307 of 310 files, 7,570 tests, 37 skipped. Two failed because
    they run pnpm, which could not run here: `ui-build-output` and
    `a-measurement-that-could-not-reach-the-deployments-client`. `lessons` failed until
    `docs/LESSONS.md` was regenerated. The 58 that read the jobs, the catalog, `trigger.config.ts`,
    the workplans or the CHANGELOG all passed, 2,162 tests.
  - The worker's integration files on a throwaway cluster from `scripts/local-pg.sh` (PostgreSQL
    16.15 here; CI's Testcontainers run is the one to trust for 18): 8 files, 107 tests. The two that
    need a Stalwart server skip.
  - The six docs checks pass.
- **CHANGELOG:** one line under *Unreleased*, *Changed*.
- **Next:** T6's other steps: the worker that runs the jobs on pg-boss, the API's doors and the
  operator's commands.

**2026-11-22, last: the review of #2040, fixed (T5a).** On the same branch, after `main`
(#2036) was merged in. The coordinator's review found one blocking bug and seven fixes, and
decided two retry questions:

- **Blocking: the heap verdict read the wrong part of stderr.** V8 writes its
  `FATAL ERROR: … heap` line as the process dies, after everything the run already wrote. Since
  E4, that includes the run's own warnings on the same stream. A run that wrote 20 kB first was
  read as `killed`. `runInChild` now tests every line as it forwards it, and the death is a
  `RunOutOfMemory`. In the new test, V8's line sits past byte 16,000, the most T5 read. A heap
  abort can drop the tail of what the run wrote: one loaded run passed the parent 17,875 bytes of
  the 20,200 written. So the fixture writes about 40 kB.
- **Decided: settle as Trigger.dev 4.8.8 does.** ADR-0054 §2's table, its *Pending* rules and its
  new amendment log record it.
  - `RunTimedOut` is not retried, as Trigger.dev does not retry `MAX_DURATION_EXCEEDED`.
  - `RunOutOfMemory` is not retried either.
  - A process killed from outside is retried, as point 2 proved: the passes converge. *The second
    review reversed this for a SIGKILL or SIGABRT the runner did not send (the entry above).*
- **The fixes:**
  - status and cancel by id look at every queue in the schema, so a live run on a queue the
    asking client does not declare is never read as finished;
  - the producer's `supervise`, `schedule` and `migrate` are checked in pg-boss's own `instance`
    rows;
  - the kill is timed from the job row's `expireInSeconds`, which pg-boss goes by, not from the
    spec;
  - once the limit has fired, only a `ChildRunDied` becomes `RunTimedOut`, so an answer the run
    gave first stands;
  - `serveRuns` answers only in a process `runInChild` forked, which it marks with an argument;
  - both clients read the schema's version before pg-boss starts, so a newer schema is refused
    before pg-boss registers on it or runs a cron pass;
  - `stop()` closes pg-boss's pool after a `start()` that threw;
  - T5 is marked merged, the `recentFailures` bound is worded as it is, and the planner settings
    behind the plan are said.
- **Found while proving them:**
  - pg-boss runs a cron pass at most once per `cronMonitorIntervalSeconds`, 30 s by default,
    claimed across every instance. So the schedule test's control, waiting 20 s, passed or not
    by where it fell in that window.
  - A producer that scheduled could not claim a pass within 8 s of the worker's last one, so the
    earlier `schedule: true` mutation had timed out on the control and proved nothing. pg-boss
    also does not send a schedule's first occurrence again once it has sent it.
  - The runner now takes `cronMonitorIntervalSeconds`, and the tests use 1. The test clears
    `cron_on` and copies in a schedule no pass has sent yet.

**The evidence**, on `scripts/local-pg.sh`'s cluster:

- `job-runner.integration.test.ts`: `Tests 26 passed (26)`, 125.7 s; 6 tests are new.
- `run-in-child.unit.test.ts`: 18 passed; 3 are new.
- `pnpm lint` and `pnpm typecheck` passed. `pnpm test`: 22,317 tests passed and 2 failed:
  - the heap test's 20,000-byte precondition, since loosened (above);
  - `every-release-is-a-starting-point`, for this checkout's 5 tags.
- **Mutations**, each restored byte for byte. Each of these failed its test:
  - `RunTimedOut`, then `RunOutOfMemory`, taken out of the names;
  - the by-id lookup cut back to the declared queues;
  - the producer with `supervise` on;
  - the producer with `schedule` on;
  - the spec's limit in place of the row's;
  - the substitution for any error;
  - the version pre-check removed;
  - `stop()` skipping pg-boss after a failed start;
  - the verdict read from the first 16 kB only;
  - the marker check removed.

**2026-11-22, later still: the runner's production gaps (T5a).** On branch
`claude/ownpace-pgboss-runner-gaps`, from T5's branch at `6d6e299d`. Only
`packages/scheduler/src/pg-boss/` and this plan changed; nothing imports the runner yet. The
coordinator listed what T6 and T7 need from the runner as E1 to E8. E1 was already there. Checked
against T5's code, and closed:

- **E2, a producer.** `PgBossProducer` is for the API and for runs that enqueue. It takes the
  queue specs in its constructor and runs pg-boss with `migrate`, `supervise` and `schedule` off.
  It has no `work` and no `schedule`, and never creates a queue. It refuses a jobs schema the
  worker has not installed, or one at another version. Enqueueing to a queue the worker has not
  made fails, naming the queue and the reason, and creates nothing.
- **E3, status and cancel by the run id alone.** `status(runId)` and `cancel(runId)` look the id up
  on every queue's `(name, id)` key (the declared queues' only, until the first review). That is one statement per job table, and every queue
  shares `job_common` unless it is partitioned. An id that is not a UUID (`run_…`) is refused
  before pg-boss is asked. One that no queue holds reads `null`. The `(queue, runId)` forms stay.
- **E4, the run's lines.** The child's stdout and stderr reach the worker's own, line by line,
  prefixed `[<queue> <run id>] `. A death is told by a fixed sentence and a `verdict`
  (`out-of-memory`, `killed`, `exited`), read from stderr and never quoted: from its first 16 kB
  here, and from every line since the first review.
  T5's `ChildRunDied` had put stderr's first line into the stored error.
- **E5, the time limit and the claim.** `work` aborts the run's signal itself,
  `killMarginSeconds` before the queue's `expireInSeconds` and fails it as `RunTimedOut`. That
  was retried here, and is not retried since the first review, as on Trigger.dev (the entries
  above). The margin is 30 s, a tenth of a test's short limit, and at least 1 s, and the code says
  why. A lost claim (a cancel, another supervisor) aborts the same signal. `workInChild`
  kills the run's process on it and settles only after the process has exited. A run's process
  exits when its IPC channel closes, so a worker killed outright leaves no run writing behind it.
- **E6, the names.** `work` decided "not retried" with `instanceof RunNotRetried`, which an error
  from a forked process never is. It now goes by name: `RunNotRetried`, `AbortTaskRunError` and
  `ZodError` go to `deadletter`, anything else is retried (`settlementFor`).
- **E7.** Already met for the worker: T5's schema refusal and pin guard. The producer now refuses
  in the same way.
- **E8.** `overview` already read only pg-boss's queue table, whose counters the monitor keeps.
  `recentFailures` read up to 100,000 rows and sorted them in memory. It now returns at most its
  limit (1,000 at most), read backwards on pg-boss's `<table>_i16` index, `(name, completed_on)`,
  and stopped there. The read passes the completed runs newer than the oldest failure it returns;
  when the queue holds fewer failures than the limit, that is every completed run it keeps, which
  pg-boss's retention bounds (7 days by default).

**The evidence**, on a throwaway cluster from `scripts/local-pg.sh` (PostgreSQL 16 here; CI's
Testcontainers run is the one to trust for 18):

- `job-runner.integration.test.ts`: `Tests 20 passed (20)`, 131.9 s, at this entry's head. That
  is T5's 11 and 9 new tests; 29 since the two reviews (the entries above).
  - E5: with an 8 s limit, both attempts of one singleton key were killed under 8 s, with
    `RunTimedOut`, in different processes, both dead. The retry's process started after the
    first one's last write.
  - E5: a cancel from the producer killed the run's process within one heartbeat.
  - E2: a schedule due every second fired from a worker and never from a producer alone in 8 s.
  - E8: the read is a `Limit` over `Index Scan Backward using job_common_i16`, with no sort. That
    plan was taken with `enable_seqscan` and `enable_sort` off, because on a handful of rows the
    planner scans; it shows the index can serve the order, not what the planner picks on a small
    table.
- `run-in-child.unit.test.ts`: 15 passed, 11 of them new, at this entry's head: forwarding, the
  death in its own words, six error names across the IPC, and the child that dies with its parent.
  23 since the two reviews.
- **Mutations**, each restored byte for byte. Each of these failed its test:
  - the margin made negative;
  - the producer with `migrate` on;
  - the producer with `schedule` on, as listed then. It proved nothing: that run timed out on its
    control (the first review's entry says why);
  - the by-id lookup finding nothing;
  - the names set cut to `RunNotRetried`;
  - the failures read oldest first;
  - the queue-not-found message unmapped;
  - `workInChild` without the signal;
  - stderr put back into the death's message (1 of 15 failed);
  - the prefix dropped (3 failed);
  - the `disconnect` exit removed (1 failed).
- Found on the way: a test that imported an entry module (one ending in `serveRuns`) served runs
  inside vitest's own forked worker, and so did `process.exit` there. The key-holder fixture's
  table helper is now a module of its own, `key-holder-table.ts`.
**2026-11-22, later still, after the second review: a NOLOGIN jobs role is not "not made yet", and four smaller holes.**
The coordinator's second review of #2041 confirmed the first five fixes, and E2E (managed) run
45044295985 passed at `3fc7556b`, with the role made, fit, set and proven on the OTA stack. `main`
(#2043, T6's first step) is merged in, with both Status entries kept, main's T5 and T6 rows and this
branch's T7 row.

- **`rotate-db-passwords.sh` and a NOLOGIN `ownpace_jobs`.** `db_roles_list` lists login roles only,
  so `--check` and `--sync` took a NOLOGIN role for one not made yet: exit 0 and "done". Both now ask
  the fit question whenever the role is not a login role. They skip only on its empty answer
  (`DB_ROLES_JOBS_MISSING`). `--check` then names the refusal and exits 2; `--sync` sets the two,
  leaves the jobs role and exits 1. Taking the old shortcut in either fails the NOLOGIN test.
- **`--sync`'s exit merges the skip** by the script's own rule (a refusal anywhere is 1, otherwise
  a question not asked is 2). The NOT DONE line is printed whatever the two's proof found, and the
  Exit codes block names the skip. Saying it only when the two passed fails its test.
- **A temporary table no longer counts as owned elsewhere** (`pg_temp_N`, `pg_toast_temp_N`). In
  transaction pooling, a temporary table can outlive its client on a server connection. A test holds a
  fit role with a temporary table; without the clause it fails.
- **Two more privileges are counted:**
  - **A `public` relation whose ACL names the role or PUBLIC** (`aclexplode`, grantee 0 or the
    role), on every version. This counts PostgreSQL 17's MAINTAIN, which the privilege functions'
    list does not name. Its test grants MAINTAIN through PUBLIC on 17 and later, so it runs on CI's
    18; here, on 16, it checks that 16 has no MAINTAIN.
  - **EXECUTE on `pgbouncer_auth`'s functions**, through PUBLIC as well, as a new last field. The
    bring-up revokes PUBLIC's EXECUTE just before the question; `--sync` does not. Not counting it
    fails its test.
- **`a-system-role-that-is-not-the-owner`** failed 1 of 41 while `pg_stat_statements` existed in the
  shared database. Its relations query now leaves extension-owned relations out, and it passes 41 of
  41 with the extension and without it.
- **`docs/managed-bring-up.md`'s grants query** filters by database (run here against a database
  grant and a column grant), and names the lookup function's remedy.
- **Evidence.** On a `scripts/local-pg.sh` cluster (PostgreSQL 16.15):
  - **The integration file:** `Tests 40 passed (40)`.
  - **`a-system-role-that-is-not-the-owner`:** `41 passed (41)`, with the extension and without it
    (1 failed with it before).
  - **`rotate-db-passwords`:** `68 passed (68)`.
  - **Every unit file under `scripts/` and `deploy/`:** 7,644 tests, 7,610 passed. The one failure is
    `every-release-is-a-starting-point`, for this checkout's 12 tags.
  - **Broken once each, then restored byte for byte:**
    - the temporary-schema clause: 1 failed;
    - the lookup count: 1 failed;
    - `--check`'s and `--sync`'s NOLOGIN shortcut: 1 each;
    - the skip said only at rc 0: 1.
  - **Gates:** `pnpm typecheck` 0 and `pnpm lint` 0.

**2026-11-22, later still, after review: the fit question no longer refuses every real stack.**
The coordinator's review of #2041 found the question refused every stack that has
`pg_stat_statements`. The data phase creates that extension in the app's database just before the
question runs, and its install script grants PUBLIC SELECT on its two views in `public`. So the
answer counted 2 relations of `public`, and the bring-up died: E2E (managed) and live's alpha.16
deploy after its copy and checkout. The integration test had passed because the Testcontainers
database has no such extension, and the unit stubs answer a canned line.

- **Fixed.** The `public` count leaves out relations an extension owns (`pg_depend` `e`). The test
  now runs what the phase runs before the file, in the phase's order: `setup-auth.sql`, then the
  extension, in the shared database and in the copy's. Against the old question the new file failed
  28 of 36. Against the new one it passes 37 of 37, and taking only the extension clause out fails 28.
- **Three new answers**, for the roles the review found that still read as fit:
  - **Grants naming the role** (`pg_shdepend` `a`): a table, column, schema, function, default
    privilege or the database. This covers USAGE and EXECUTE on `pgbouncer_auth.user_lookup`, CREATE
    or USAGE on `public` by name, and `ALTER DEFAULT PRIVILEGES … TO ownpace_jobs`.
  - **CREATE on the database**, by name or through PUBLIC.
  - **CREATE on `public`**, by name or through PUBLIC.

  A sequence's USAGE is now counted with the `public` relations. Each case has its own test, 11 new
  in all; with the by-name count disabled 4 fail, and with the sequence clause out 1 fails.
- **`jobs-role.sql` has no REVOKE any more.** It would take back a PUBLIC grant on an existing
  schema before the question saw it, against the file's own "repairs nothing". A new schema grants
  PUBLIC nothing anyway. A case runs the file again after such a grant and expects the refusal; with
  the REVOKE put back it fails.
- **`rotate-db-passwords.sh --sync` no longer lets an unfit jobs role block the other two.** It names
  the jobs role and leaves it exactly as it is, still sets and proves the owner and `app_user`, then
  exits 1 (2 when the question could not be asked). `--sync` is how the operator puts the two back
  while the stack may be down; a changed jobs role is a separate fault. Making it refuse again, or
  exit 0, each fails its test.
- **Docs.** `docs/managed-bring-up.md` gains *The jobs role*: every refusal with its remedy, and
  the query that lists what names the role (run here against real grants). The refusal points there.
  `docs/operator-runbook.md`'s roles line names `ownpace_jobs` (and `ownpace_system`, which it had
  left out). The rls-guide row says what the question leaves out and counts.
- **Evidence.** On a `scripts/local-pg.sh` cluster (PostgreSQL 16.15), with the shared database put
  back afterwards (no `ownpace_jobs`, `pgbouncer_auth`, `pgboss` or extension left):
  - **The integration file:** `Tests 37 passed (37)`.
  - **Every unit file under `scripts/` and `deploy/`:** 310 files, 7,634 tests, 7,600 passed. The one
    failure is `every-release-is-a-starting-point`, because this checkout holds only 12 tags (it
    passed on CI's full checkout of this branch).
  - **`a-password-the-repository-knows` and `rotate-db-passwords`:** `Tests 170 passed (170)`, with 3
    new unfit lines in (f).
  - **Broken once each, then restored byte for byte:**
    - `jobs-role.sql`'s REVOKE put back: 2 failed.
    - The bash check of the by-name grants made a no-op: 1 failed.
    - `--sync` refusing on an unfit jobs role: 1 failed.
    - The skip exiting 0: 1 failed.
  - **Gates:** `pnpm typecheck` 0 and `pnpm lint` 0.

**2026-11-22, later still: the jobs' role and schema, made by the managed bring-up (T7, its first part).**
On branch `claude/ownpace-public-readiness-y7orc6-jobs-role`, from T5's branch. Nothing connects as
the role yet, and no service in `managed.yml` changed; no file in either migration chain and none of
the Trigger.dev, identity-provider and ClickHouse image lines moved, so live's deploy of alpha.16
from alpha.14 stays reversible by `deploy-live.sh`'s own rule.

- **Why the bring-up and not a migration, read from the scripts.** Alpha.14's `deploy-live.sh`
  takes the copy with its own `copy-before-update.sh`, then `git checkout --detach <tag>`, then runs
  that tag's `bootstrap-managed.sh --from data`. So the data phase of the release being deployed is
  the first code of it that runs, and every `--from data` passes `load_env` first. The role is made
  there, as `pgbouncer_auth` is (`setup-auth.sql`), between postgres and the pooler.
- **What was built.** `deploy/compose/jobs-role.sql`: `ownpace_jobs`
  (`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`, no password) when
  it does not exist, `CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION ownpace_jobs`, and
  `REVOKE ALL ON SCHEMA pgboss FROM PUBLIC`. It creates and never alters, so a role that was changed
  is refused, not repaired. `db-roles.sh` gains `db_roles_jobs_ensure`, `db_roles_jobs_fit`,
  `db_roles_jobs_set` and `db_roles_jobs_prove`. The data phase runs ensure, fit and set after
  `setup-auth.sql`, and prove after the pooler is up. `load_env` seeds a missing
  `JOBS_DB_PASSWORD`, before the file is sourced and before any Compose call, through
  `ensure-env-secrets.sh --only JOBS_DB_PASSWORD`, a new mode that fills in that key and nothing
  else (a whole run there would generate the database passwords `load_env` refuses as missing on a
  real address). Also: `managed.env.example`, `rotate-db-passwords.sh` (`--check` asks the role,
  `--sync` judges it and then sets it), `stand-up-live.sh` (generates it, in `URL_PASSWORDS`, and
  no volume keeps it), `docs/rls-guide.md` and `SECURITY.md`.
- **The question, field by field.** Superuser, create role, create database, replication,
  BYPASSRLS, login, inherit; roles it belongs to and roles that belong to it; whether it owns
  `pgboss`; objects it owns outside it but for TOAST (relations, functions, types, schemas and
  databases, and anything else through `pg_shdepend`); relations of `public` it holds any privilege
  on, a column's included, through itself or PUBLIC; and privileges on `pgboss`, or on a relation
  in it, granted to anyone but the role.
- **The copy and the rollback (the open question).** `scripts/a-jobs-role-that-owns-only-its-queue.integration.test.ts`
  makes a database of its own, with both chains, the file and pg-boss with one job queued. It dumps
  it with `copy-before-update.sh`'s flags and restores it over itself with the runbook's rollback
  flags (`pg_restore -d postgres --clean --if-exists --create`), both read from those files. The
  schema is still the role's, the job is in it, the question answers fit, and the runner starts on it
  as the role. The roles are cluster-wide and not in the dump, as the runbook says for the others: on
  a new server the roles' dump comes first (step 7's note).
- **Evidence.** On a throwaway cluster from `scripts/local-pg.sh` (PostgreSQL 16.15; CI's
  Testcontainers run on 18 is the one to trust for the version):
  - **The new integration file:** `Tests 26 passed (26)`, 2.1 s, with `pg_dump` and `pg_restore`
    this machine's (their major is the server's; on CI the harness image's, on the host network).
    Afterwards no `ownpace_jobs`, no `pgboss` and no copy database are left.
  - **The guards that read what changed** (the ten files touched or run by the phase): `Tests 1079
    passed (1079)`. Every unit file under `scripts/` and `deploy/`: 310 files, 7,631 tests. The first
    run failed 2: `a-demo-on-a-real-address`, whose checkout has no `ensure-env-secrets.sh` (its OTA
    `.env` now carries the key), and `lessons`, regenerated. Both pass now.
  - **Broken once each, then restored byte for byte** (sha256 the same):
    - `NOINHERIT` dropped from `jobs-role.sql`: 20 of 26 integration tests failed.
    - The fit question's `public` privilege clause made `false`: the PUBLIC column grant case failed.
    - `--no-owner` added to the runbook's restore: the restore test failed, the schema no longer
      the role's.
    - In `a-password-the-repository-knows` (f): no `jobs_role_proven` failed 2; the seed running the
      whole generator failed 1; the fit answer ignored failed 9.
    - In `rotate-db-passwords`: no `check_jobs` failed 2; `--sync` without the question failed 2.
    - `managed-env-contract`: load_env without the seed failed 1.
    - `bootstrap-managed`: `--only` going on past its key failed 2.
    - `a-first-bring-up-of-live`: the key judged by `postgres_data` failed 1.
    - `a-connection-the-docs-did-not-know-about`: the guide's row changed failed 1.
  - **Gates:** `pnpm typecheck` 0 and `pnpm lint` 0.
- **Next:** T6 and the rest of T7 (the worker service, `JOBS_DATABASE_URL`, the switch).

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
| T5 This runner, merged | builder | ✅ **Merged 2026-11-22**, as #2038 (`98e9bc34`) | The spike as production code, imported by nothing at run time; ADR-0054; the pin guard and the schema refusal (the Status entry of 2026-11-22, later). |
| T5a The runner's production gaps | builder | 🟡 **Built 2026-11-22**, on `claude/ownpace-pgboss-runner-gaps` | E2–E8 from the coordinator's plan: `PgBossProducer`, status and cancel by id, the child's lines forwarded and never stored, the worker's own time limit and kill on a lost claim, "not retried" by name, a bounded `recentFailures` (the Status entry "later still"). Done when its pull request merges. |
| T6 The jobs on the runner, behind a switch | builder | 🟡 **Started 2026-11-22**: its first step, the job catalog and the jobs made runner-neutral, merged as #2043 (`2f86401c`); the worker built on `claude/ownpace-pgboss-worker-process`; the API's doors, cancels and readiness on the switch built on `claude/ownpace-pgboss-api-doors`; the operator's commands built on `claude/ownpace-pgboss-operator-jobs` | §5: the tasks under `apps/worker/src/jobs` and the API's enqueue paths (`enqueue-unless-held.ts`, `job-resolution.ts`) on the runner, one at a time, from `managed-sync-tick` and `run-delta-sync`; `orchestrator_ref` the job id. The switch is off, so Trigger.dev stays the path that runs. The first step (the Status entry of 2026-11-22, later still) changes nothing that runs: the catalog of the seventeen queues, each job's run behind a run context with the Trigger.dev calls moved into it, and the Trigger.dev half of the tick's interlock across runners. The API's step (the Status entry "the API's doors on the switch") reads `OWNPACE_JOB_RUNNER` in `apps/api/src/job-runner.ts`: on `pg-boss` every door enqueues through one producer on `JOBS_DATABASE_URL`, a close cancels by the pg-boss id, and readiness reads the shared beat; on `trigger`, unset or empty, nothing changes and no pg-boss module loads. Its second step, the worker (the Status entry "the worker on pg-boss, inert until started"), built on `claude/ownpace-pgboss-worker-process`: `apps/worker/src/runner/`, the seventeen jobs worked one process per run, the pg-boss half of the run context and of the tick's interlock; nothing starts it yet. The operator's commands, `operator.sh jobs` (overview, failures, show, cancel, run, refused while the hold is open unless `--despite-hold`), built on `claude/ownpace-pgboss-operator-jobs` (the Status entry of 2026-11-22, later still, T6's operator commands). |
| T7 The worker service, and the switch on | builder, owner | 🟡 **Started 2026-11-22**: the role and schema, built on `claude/ownpace-public-readiness-y7orc6-jobs-role` | A worker service in `managed.yml`, with `cpus: 0.5` and a memory limit, and the jobs' schema and role made by the bring-up; the switch on; the deploy and the managed E2E moved to it. ADR-0054 comes into force here (its *Pending*), and ADR-0004's first rule then names pg-boss. |
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
| 8 | Per-worker limits stop a runaway pass the way `small-1x` does | 🟡 passed in part | Memory: `point 8` and `run-in-child.unit.test.ts`. A pass that runs away dies alone at its heap cap, and the same worker then completes the next run. In the spike V8's `FATAL ERROR … heap limit` was in the run's error and the run was failed after its attempts; since T5a (#2040) V8's words go to the worker's output only, and the run fails once as `RunOutOfMemory`, not retried, as on Trigger.dev. CPU: no process can cap its own CPU. That stays the worker container's `cpus:` or Kubernetes `resources.limits`, the same cgroup mechanism Trigger.dev's runner containers use. On this machine a cgroup with a quota of 50000/100000 throttled a busy child in 31 of 33 periods, which shows the mechanism, not this code. |
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
