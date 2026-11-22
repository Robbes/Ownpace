# ADR-0054: The managed edition's jobs run on pg-boss, on our own Postgres

- **Status:** **Accepted 2026-11-22** by the owner (workplan 0167 T4), in place of self-hosted
  Trigger.dev; supersedes ADR-0004's managed half. **In force since workplan 0167 T7**, which
  turns the switch on (`managed.yml`'s default for `OWNPACE_JOB_RUNNER` is `pg-boss`); Trigger.dev
  is kept installed and stopped as the fallback.
- **Date:** 2026-11-22
- **Deciders:** owner. The spike was approved earlier that day; after it: *"Put in the successful
  spike (replace triggerdev)."*
- **Supersedes (in part):** [ADR-0004](./0004-orchestration-triggerdev-and-inprocess.md), its
  managed half (Trigger.dev). Its self-host half, its `Scheduler`/`JobRunner` seam and its rule
  that the orchestrator never sees content stand.
- **Relates to:** [ADR-0036](./0036-the-managed-edition-is-its-own-package-and-its-own-chain.md)
  (the appliance never loads managed orchestration), [ADR-0017](./0017-migration-tooling.md) and
  [ADR-0045](./0045-migrations-are-hand-written-sql.md) (our chains, and the refusal of a schema
  newer than the code), [workplan 0167](../workplans/0167-a-job-runner-on-our-own-postgres.md)
  (the spike, its nine points, and the steps T5 to T9)

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- **The managed edition's jobs run on pg-boss** (in force since workplan 0167 T7), each on a
  queue named by its Trigger.dev task id, through `PgBossJobRunner` at
  `@openmig/scheduler/pg-boss`, which the appliance may not reach. The switch is
  `OWNPACE_JOB_RUNNER`, `pg-boss` by `managed.yml`'s default.
- **pg-boss is pinned exactly, and the runner runs only on its release's schema version**
  (`scripts/a-job-schema-the-runner-was-not-proved-on.unit.test.ts`).
- **Its schema `pgboss` is owned by `ownpace_jobs`**, no superuser and no grant on the ledger,
  made by the bring-up and by neither chain; reached through PgBouncer, polling, never LISTEN.
- **The `worker` container works the jobs**: a process per run, its heap capped; half a CPU and
  512 MB a run. One pass per mapping; discovery joins its run; a cutover waits. **At most
  `MAX_PASSES_IN_FLIGHT` + 2 runs at once, every queue together**: a run past it waits in its
  queue (`run-slots.ts`).
- **A run settles as Trigger.dev 4.8.8 settles it**, decided by the error's name: an hour,
  three for a cutover (§2's table).
- **The operator sees the work through `operator.sh jobs`**; there is no dashboard.
- **Trigger.dev's plane is kept installed and stopped**, in profile `trigger`, its volumes the
  way back (`OWNPACE_JOB_RUNNER=trigger`); removed only on the owner's word.
- **A job carries ids only** (ADR-0004). Self-host keeps its in-process scheduler. The rules in
  full: *In force from workplan 0167 T7*, below.

## Context

Since ADR-0004 (2026-06-20) the managed edition's background jobs have run on self-hosted
Trigger.dev. What the edition takes from it, read from the code on 2026-11-22 (workplan 0167 §1,
counted again on `main` for this ADR):

- 9 cron schedules, one of them every minute (`managed-sync-tick`), and 8 on-demand
  `schemaTask`s, all under `apps/worker/src/jobs`;
- one pass per mapping (`queue({ concurrencyLimit: 1 })` with `concurrencyKey: mappingId`, on
  `run-delta-sync` and `run-discovery`);
- discovery's join window (`idempotencyKey` with `idempotencyKeyTTL`, `job-resolution.ts`);
- whole-task retries, 3 attempts with exponential backoff, and `AbortTaskRunError` to stop them;
- a one-hour `maxDuration`, and `machine: 'small-1x'`;
- one `triggerAndWait`, in `run-cutover.ts`; `runs.retrieve` and `runs.cancel`, in
  `managed-purge-closed.ts`; and tags on runs.

It uses no checkpoint and no `wait.*`, the durable-execution half of Trigger.dev.

What it costs: about ten services in `deploy/compose/managed.yml` (the webapp, its own Postgres,
Redis, ClickHouse, MinIO, a registry, the supervisor, a Docker socket proxy and a TLS front, and
two that run once); the supervisor's access to Docker, which starts the runs' containers and,
through each stack's proxy, can start one on any network of the machine (workplan 0132 §1); a
steady stream of advisories against those images; and a one-way migration of Trigger.dev's
database at every version move, since its webapp migrates on boot and Prisma has no
down-migrations (`deploy/compose/trigger-version.sh`).

A comparison of replacements on 2026-11-22, which the owner holds and which is not in this
repository, recommended spiking pg-boss first: MIT, no new service, the ledger's Postgres. The
owner approved the spike. Workplan 0167 is that spike: a runner over pg-boss 12.38.2 and nine
points, each run against a real Postgres, directly and through PgBouncer 1.22 in transaction
mode, as a role that is not a superuser. Eight passed and one passed in part: a pass that runs
away dies alone at its heap cap, but no process can cap its own CPU, so that half is the
container's (§3 there). CI ran the same file on both architectures against Postgres 18.7, green.

## Decision

### 1. pg-boss in place of Trigger.dev, for the managed edition

The managed edition's background jobs move to pg-boss, pinned exactly, on the managed edition's
own Postgres. Its tables live in a schema of their own, owned by a role of their own that is not
a superuser, may create no schema and reaches no ledger table (0167, point 7). The schema is made
by whoever provisions the role; pg-boss installs and migrates only inside it. The jobs are worked
by a worker container, one forked process per run. The runner is `PgBossJobRunner`, as built and
proved in 0167, behind `@openmig/scheduler/pg-boss`.

### 2. Each thing the edition takes from Trigger.dev has its answer in the runner

| Trigger.dev | The runner (0167 point) |
|---|---|
| `schedules.task` | `schedule(queue, cron, payload)`, in UTC; the minute's tick on a `stately` queue, so it never overlaps itself (6) |
| `schemaTask` | a queue declared at `start()`, worked by `work()` |
| `concurrencyLimit: 1` with `concurrencyKey` | a `singleton` queue and `serializeBy: mappingId` (1) |
| `idempotencyKey` with `idempotencyKeyTTL` | `idempotency: { key, ttlSeconds }`, measured from the earlier run's creation, under `pg_advisory_xact_lock` (4) |
| retries, and `AbortTaskRunError` | `attempts` (3, from 5 s to 60 s), and `RunNotRetried`, settled as pg-boss's `deadletter` (5) |
| `maxDuration` | `maxDurationSeconds`, 3600 by default |
| `machine: 'small-1x'` | `runInChild`: a process per run with V8's heap capped (8); its CPU capped by the container |
| `triggerAndWait` | `enqueueAndWait`, which polls the child's row (5) |
| `runs.retrieve`, `runs.cancel` | `status`, `cancel`: the handler's `signal` aborts within a heartbeat (3) |
| tags | `tags`, carried in the job's data |
| the dashboard | `overview()` and `recentFailures()` (9) |
| `MAX_DURATION_EXCEEDED`, not retried (`shouldRetryError`) | `RunTimedOut`, not retried: the worker stops the run's process a margin before the row's `expireInSeconds` itself (0167 T5a, E5) |
| an out-of-memory run, not retried unless a task asks (none does) | `RunOutOfMemory` (V8's heap line, or SIGABRT), not retried: the retry would meet the same heap (T5a) |
| `TASK_PROCESS_MAYBE_OOM_KILLED` (a SIGKILL or SIGABRT ending the run's process), not retried | `RunPossiblyOutOfMemory` (a SIGKILL the runner did not send), and SIGABRT as `RunOutOfMemory`, not retried: in a container with a memory limit the usual sender is the kernel's out-of-memory killer (T5a) |
| a run whose worker was lost (a crash, a restart), retried | a claim lost because the worker died or restarted, handed back by pg-boss's sweep, retried: the passes converge (point 2) |
| `runs.retrieve(id)`, `runs.cancel(id)`, by the id alone | `status(runId)`, `cancel(runId)`, on every queue of the schema; the API's client is `PgBossProducer`, which never migrates, supervises, schedules or works (T5a) |

The last five rows were added on 2026-11-22 by the coordinator's decisions on #2040's two reviews: a
run settles on pg-boss as Trigger.dev 4.8.8 settles it today (`taskRunErrorEnhancer` and
`shouldRetryError` in `@trigger.dev/core`'s `v3/errors.js`), so moving changes no retry. A run the
runner stops itself keeps its own settlement: its limit is `RunTimedOut`, and a cancel is a cancel.

A run whose worker dies is picked up again by pg-boss's heartbeat sweep, which the runner runs
every 15 seconds rather than pg-boss's default 60 (point 2).

### 3. Only the schema version it was proved on

pg-boss migrates its own schema at `start()`: it installs it, or migrates an older one up to the
version its release names (`pgboss.schema` in its `package.json`). A schema that a later release
has migrated further it leaves as it is and runs on. So the pin is exact, and the runner reads
`PgBoss#schemaVersion()` after pg-boss starts and refuses any version but `PG_BOSS_SCHEMA_VERSION`.
A guard holds that constant to the pinned release's own, so a pin moved to a release with another
schema fails until somebody has read its migration and moved the constant with it. This is
ADR-0017's refusal of a schema newer than the code, for the one schema in our Postgres that our
chains (ADR-0045) do not hold.

### 4. Self-host is unchanged

The appliance keeps its in-process scheduler (croner) behind the `Scheduler` port, as ADR-0004
decided, and never loads pg-boss: the leakage walk forbids both `pg-boss` and the subpath.

### 5. In steps, one pull request each (workplan 0167 T5 to T9)

- **T5:** the runner as production code, imported by nothing at run time, with this ADR and the
  pin guard.
- **T6:** the jobs and the API's enqueue paths on the runner, behind a switch that is off.
- **T7:** the worker service in `managed.yml`, the switch on, the deploy and the managed E2E
  moved. This is when the decision comes into force.
- **T8:** Trigger.dev's services stopped, their volumes kept as the way back.
- **T9:** later, and only on the owner's word: Trigger.dev's code, images, scripts, pins and
  volumes removed.

### 6. How ADR-0004 reads from now on

Its self-host half stands as written: the appliance's in-process scheduler. Its seam and its rule
that the orchestrator never sees content stand for both editions. Its managed half, Trigger.dev
self-hosted via Docker or in its cloud, is superseded by this ADR. Until T7 Trigger.dev still runs
the managed edition's jobs, so ADR-0004's first operative rule still names it, and points here.
Its status entry and its amendment log say so; its Context, Decision, Consequences and
Alternatives are left as they were written, since a record is never edited (ADR-0051). At T7 its
first rule names pg-boss.

## In force from workplan 0167 T7 — the managed edition's jobs on pg-boss (accepted 2026-11-22; was *Pending*)

Accepted by the owner on 2026-11-22: *"Put in the successful spike (replace triggerdev)."* In
force since workplan 0167 T7 turned the switch on (`managed.yml`'s default, `pg-boss`). The
operative rules above say them in short; these are the rules in full:

- **The managed edition's jobs run on pg-boss**, each schedule and each on-demand task on a queue
  of its own, through `PgBossJobRunner`.
- **pg-boss's tables are in a schema of their own, in the managed edition's Postgres, owned by a
  role of their own**: not a superuser, no `BYPASSRLS`, no right to create a schema, no grant on a
  ledger table. Neither migration chain holds that schema and `runMigrations` never touches it;
  pg-boss migrates it, at the pin's version only.
- **The runner polls, and never LISTENs**: it reaches Postgres through PgBouncer in transaction
  mode, where LISTEN does not hold.
- **The jobs are worked by a container of their own**: a process per run with its heap capped
  (`runInChild`), and the container's CPU and memory capped (`cpus:` and a memory limit in
  `managed.yml`; `resources.limits` on Kubernetes).
- **One pass per mapping** by `serializeBy: mappingId`; **discovery joins the run it started** by
  `idempotency`; **the minute's tick never overlaps itself** on a `stately` queue; **cutover waits
  for its final sync** with `enqueueAndWait`.
- **An operator sees queued, running and failed work through `overview()` and
  `recentFailures()`**; there is no dashboard.
- **A run settles as Trigger.dev 4.8.8 settles it** (§2's table): `RunNotRetried`,
  `AbortTaskRunError`, `ZodError`, `RunTimedOut`, `RunOutOfMemory` and `RunPossiblyOutOfMemory`
  are not retried, decided by the error's name; a claim lost because the worker died or
  restarted is.
- **A run's time limit is the hour Trigger.dev gives every task, on the wall clock; a cutover's is
  three hours**, since Trigger.dev never counted a run's waits for another (`triggerAndWait` is a
  pause of the run's CPU time) and a cutover waits for a pass ahead of it and its own before the
  gate.
- **Known, and kept for alpha.16: two ways the worker's concurrency is not Trigger.dev's.** Each
  queue of a job somebody asks for is worked one run at a time across every organisation, where
  Trigger.dev runs a count per migration side by side and puts no limit on verification,
  confirmation, the applies, the cutover and the rollback; and the worker may run
  `MAX_PASSES_IN_FLIGHT` + 17 runs at once, where the plane admits `MAX_PASSES_IN_FLIGHT` + 2. A
  worker-wide cap of `MAX_PASSES_IN_FLIGHT` + 2 is the recorded follow-up (workplan 0167).
- **Trigger.dev's services are stopped on a stack whose jobs run on pg-boss, their volumes kept
  as the way back** (T8): in the compose profile `trigger`, started again only by
  `OWNPACE_JOB_RUNNER=trigger` and the bring-up. Its code, images, scripts, pins and volumes go at
  T9, on the owner's word only.

## Consequences

- **What goes, at T8 and T9**: about ten services, the supervisor's access to Docker, the
  advisories against their images, and the one-way migration of Trigger.dev's database at every
  version move. The jobs keep their state in Postgres alone.
- **What we now own, which was Trigger.dev's**:
  - **per-key serialisation.** A `singleton` queue lets one run per key be active, but which
    waiting run goes next is not promised (0167 §4, finding 2); Trigger.dev's queues keep order.
    Nothing needs the order, since every pass is an idempotent delta. If something ever does,
    pg-boss's `key_strict_fifo` keeps it, at a different contract: it holds a failed job's key
    until somebody deals with it.
  - **the join window**: about forty lines and one advisory lock, since pg-boss has no
    idempotency key with a time to live measured from the first run (finding 3).
  - **the per-run process**: `runInChild` forks one process per run with V8's heap capped, and a
    cancel kills it with SIGKILL. A pass that runs away dies alone, and the worker goes on.
  - **CPU limits, by the container**: no process can cap its own CPU, so the worker container's
    `cpus:` (Compose) or `resources.limits` (Kubernetes) does, by the same cgroup mechanism
    Trigger.dev's run containers use. In the spike a cgroup quota of half a CPU throttled a busy
    child in 31 of 33 periods, which shows the mechanism and not this code (point 8).
  - **no dashboard**: `overview()` lists what waits, runs and failed per queue, and
    `recentFailures()` gives each failure verbatim with its attempt and tags. pg-boss's own
    dashboard (`@pg-boss/dashboard`, MIT) was not tried.
  - **the heartbeat sweep**: pg-boss's default of a minute put a crashed run's pickup at 59 s;
    the runner sets 15 s.
- **pg-boss has one main maintainer.** The answer is the exact pin and the guard, as the other
  pins here are watched: no version moves by a lockfile's resolution, a move is a change
  somebody reads, and the runner refuses a schema it was not proved on, so a worker rolled back
  past a migration stops rather than runs. pg-boss publishes the SQL that rolls a schema version
  back (`getRollbackPlans`). The runner is the only module that imports pg-boss, so replacing it
  replaces one module.
- **A Kubernetes path**: the worker is a Deployment with `resources.limits` and Postgres the only
  state, with no Redis, ClickHouse, object store, registry or Docker socket beside it. Two workers
  shared one queue in point 1, one pass per mapping between them.
- **pg-boss's schema is outside our chains.** `runMigrations` applies the ledger's and the managed
  chains; pg-boss applies its own, in its schema, under its own advisory locks. Once the jobs run
  there, they are in the managed edition's own database, so whatever backs that database up, or
  restores it, takes the jobs with it.
- **Until T7 nothing changes at run time.** The managed edition enqueues through
  `trigger-client.ts`, its tasks are Trigger.dev tasks, and the deploy, the images and the
  release scripts are untouched.

## Alternatives considered

- **Keep self-hosted Trigger.dev.** Its costs are the Context's, and what it offers beyond the
  runner, durable checkpoints and `wait.*`, the managed edition does not use.
- **The other replacements**, ADR-0004's alternatives (Temporal, Hatchet, Windmill, n8n) and the
  rest of the comparison of 2026-11-22, are not weighed again here: that comparison is the owner's
  and not in this repository, and it is the spike, not the comparison, that this decision rests
  on.
- **pg-boss's `singletonSeconds` for the join window.** Rejected: it is a clock-aligned slot, not
  a window measured from the first run, and it shares `singletonKey` with the per-key limit, so
  one key cannot answer both questions (0167 §2).
- **`key_strict_fifo` for one run per key.** Not taken: nothing needs the order, and it changes
  what a failure does to the key's other runs (Consequences).
- **Handlers in the worker's own process.** Rejected: a pass that runs away would take the worker,
  and every run on it, with it (point 8).
- **LISTEN/NOTIFY to wake the workers.** Rejected: it does not survive PgBouncer's transaction
  pooling; the runner polls, every 2 seconds by default.
- **pg-boss creating its own schema.** Rejected: the jobs role may not create one (point 7a);
  whoever provisions the role makes it, and pg-boss migrates inside it.
- **pg-boss's migration at start, trusted alone.** Rejected: it migrates an older schema up and
  runs on a newer one without a word, which is the state a rollback leaves (Decision 3).

## Amendment log

- **2026-11-22 (workplan 0167 T5a, #2040, second review):** a run's process ended by a SIGKILL
  the runner did not send, or by SIGABRT, is not retried, as Trigger.dev's
  `TASK_PROCESS_MAYBE_OOM_KILLED`; §2's table, its sentence and the *Pending* bullet say so. Only a
  lost worker is retried.
- **2026-11-22 (workplan 0167 T5a, #2040):** §2's table gains four rows: the time limit and out of
  memory not retried, a lost process retried, status and cancel by id through `PgBossProducer`.
  The *Pending* rules gain the bullet that says so. §3's refusal also reads the schema's version
  before pg-boss starts, so a newer schema is refused before pg-boss registers on it or runs a
  cron pass; the reading after start stays.
- **2026-11-22 (workplan 0167 T6, the worker's pull request):** the *Pending* rules gain two
  bullets: a cutover's limit of three hours, and the two known differences from Trigger.dev's
  concurrency, kept for alpha.16 with a worker-wide cap as the follow-up.
- **2026-11-22 (workplan 0167 T7, the switch on):** in force. The *Pending* bullet is gone and the
  operative rules state the rules in short; the *Pending* section is kept, word for word but its
  heading and opening line, as *In force from workplan 0167 T7*, since the operative budget
  (ADR-0051) cannot hold its eleven bullets. Its T8 bullet says the plane is stopped in the
  profile `trigger`. ADR-0004's first rule names pg-boss.
- **2026-11-22 (workplan 0167, the T9 row's alpha.17 part):** the follow-up is done. The worker
  holds every queue together to `MAX_PASSES_IN_FLIGHT` + 2 runs at once, counted before each
  fetch (`packages/scheduler/src/pg-boss/run-slots.ts`), so a run past it stays `created` in its
  queue: no attempt spent, no time limit counting, nothing lost at a stop, and the queues taking
  turns at a freed slot, no kind of run ahead of another, as Trigger.dev's plane dequeues at its
  environment limit.
  pg-boss's own `work()` fetches whenever a loop is idle, so each queue is worked on its public
  `fetch`, `touch`, `complete` and `fail`. The operative bullet on the worker says so, and that
  its size is per run; the *In force* bullet on the +17 stands as the record of alpha.16.
