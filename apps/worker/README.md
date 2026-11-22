# Worker Package — the Trigger.dev tasks (and the cutover CLI)

This package is **not a running service**. Since workplan 0022 there is no
worker container and no polling scheduler — everything in `src/jobs/` deploys
as **Trigger.dev tasks** and executes in the platform's runners. The managed
edition runs on one execution plane (ADR-0004).

> Corrected 2026-08-02 (workplan 0021 T4): the previous version named a
> `src/trigger-client.ts` that lives in `packages/scheduler`, listed four of
> the eight tasks, pointed at a nonexistent `deploy/compose/trigger.yml`,
> showed the v2 SDK call shape, and documented webhook processing and DNS
> restore that have never existed here.

## The eight tasks (`src/jobs/`)

| Task | Trigger | What it does |
|---|---|---|
| `managed-sync-tick` | declarative schedule, `* * * * *` | Evaluates every active mapping's own cron against the DB (croner; due = nextRun(last run start) ≤ now; invalid cron → loud log + default `*/15` cadence, never a dead stop) and triggers `run-delta-sync` per due mapping. |
| `run-delta-sync` | the tick, or API `POST .../sync` (`"delta"` or `"full"`) | A pass over the mapping's **enabled domains only** (the #207 rule). Queue `delta-sync`, concurrency 1 per mapping (`concurrencyKey: mappingId`) — a duplicate run is a wasted idempotent delta, never duplicated data. `forceFullScan` makes it scan from the beginning: `true` for every domain, or a **list** to redo one without re-reading the others. It withholds the cursor STORE, so a full scan neither reads a saved position nor writes one — the saved position survives and the next ordinary pass resumes from it. |
| `run-discovery` | mapping creation / API | Read-only, body-free per-domain counts into `migration_discovery` (the confirm screen's data). |
| `run-verification` | API `POST .../verify/start` | The §20 gate as a job; drives `verification_run` to a terminal report the API serves at `GET .../verify/report`. |
| `run-apply-deletion` | API apply → receipt | Re-runs ALL apply gates in the job, performs the one destructive removal, lands the `apply_receipt` terminal state (`applied`/`refused`/`failed`). |
| `run-cutover` | manual | Cutover **preparation** only: final delta + §20 gate, landing in `READY_FOR_CUTOVER` and stopping there — approving and executing are explicit `--yes` CLI actions it never performs. Converges: a second run on `READY_FOR_CUTOVER` or `FAILED` records the way back to `PREPARING` and prepares again; a cutover under way, a closed ledger or a test migration (workplan 0162 T3, never switched over) is refused with nothing written (not marked `FAILED`, not retried); a gate FAIL is recorded once and not retried. |
| `run-rollback` | manual | Marks `ROLLED_BACK`, reactivates the mapping. DNS is NOT restored and users are NOT notified — see `docs/rollback-mechanisms.md`. |

Task payloads carry **ids only** — never content, never credentials (SAD §17).

## Configuration

- `trigger.config.ts` (this package) — project ref, dirs, build.
- Client env (the SDK's own names, read by `packages/scheduler`'s
  `trigger-client` — one contract shared by the API, the deploy script and
  the tasks):

```bash
TRIGGER_API_URL=http://localhost:3090   # deploy CLI / API enqueue path
TRIGGER_SECRET_KEY=tr_prod_...
```

- **In-runner gotcha (0022 T3, learned live):** the platform injects the
  host-perspective `TRIGGER_API_URL` into runners, so an enqueue from inside a
  runner (the tick's passes, a cutover's final sync) first calls
  `configure({ baseURL: process.env.TRIGGER_API_URL_IN_NETWORK ?? 'http://trigger-api:3000' })`.
  The purge's `runs.retrieve` and `runs.cancel` are made without it, as they
  always were.
- **No task calls the SDK in its run (workplan 0167 T6).** Each task file
  exports its run, wrapped in `leavesAReference`, which takes a run context
  (`src/jobs/run-context.ts`): the run's id, its attempt and the runner it is
  on. What a run asks of its runner (enqueue a pass, wait for one, ask after
  or cancel a run) goes through the context, and the Trigger.dev runner there
  makes the SDK calls the jobs made, `configure` before each enqueue. The
  task definitions call the run through `onTriggerDev`, under the same ids,
  queues and machines. The pg-boss runner's queues for the same jobs are
  `@openmig/scheduler/pg-boss`'s job catalog, worked by the process below.
- Task-runtime env (`SYSTEM_DATABASE_URL`, `APP_DATABASE_URL`,
  `SECRET_ENCRYPTION_KEY`) is uploaded once per environment with
  `deploy/compose/set-task-env.sh` — runners do not read the compose `.env`.
  No run holds the database owner's `DATABASE_URL`: the script stopped
  uploading it and deletes it from the store (workplan 0138 T3 step 2).
  The per-tenant tasks take their pools from `openTaskPools`
  (`src/jobs/task-pools.ts`): tenant data on `APP_DATABASE_URL`, as `app_user`
  under row security, and one connection on `SYSTEM_DATABASE_URL`, the system
  role `ownpace_system`, for the audit export's key alone. A run without
  either refuses to start; it never falls back to the owner. The digest, the
  drift detector and group discovery take their pools the same way, in their
  run, and read on `SYSTEM_DATABASE_URL` only the list of active
  organisations (`activeOrganisations`, ids only, workplan 0138 T2). The
  other three scheduled jobs (the sync tick, retention, the purge) connect
  with `SYSTEM_DATABASE_URL`: a role that bypasses row security, which their
  questions across organisations need, and is not a superuser, may create no
  role or database, belongs to no role and has no role belonging to it, and
  holds the grants its statements need and no others, a grant to PUBLIC
  counted among them (managed migration 0033, and 0035 for `person_link`;
  workplan 0138, `docs/rls-guide.md`).

## The jobs on pg-boss (`src/runner/`, workplan 0167 T6)

The same seventeen jobs, worked by a process of this package's own instead of
Trigger.dev's runners (ADR-0054), behind the switch `OWNPACE_JOB_RUNNER`
(`trigger` or `pg-boss`; unset or empty is `trigger`). **Inert until started**:
nothing in the stacks starts it yet, and Trigger.dev runs every job until the
switch is turned on.

- `node apps/worker/src/runner/main.ts`, run by Node directly, as the API runs
  its entry. It refuses to start, exit 1 and one line on stderr, unless
  `OWNPACE_JOB_RUNNER=pg-boss` and `JOBS_DATABASE_URL` (the `ownpace_jobs`
  role, through PgBouncer) are set.
- `worker.ts`: starts the runner in the schema `pgboss` (made by the bring-up;
  `createSchema: false`, `useListenNotify: false`), refuses a schema at another
  pg-boss version, declares the catalog's queues, works each with its
  concurrency (the pass `MAX_PASSES_IN_FLIGHT` and one more), registers the
  nine schedules in UTC, each sent `{}`, and answers
  `GET http://127.0.0.1:3002/health`: 200 once all that is done, 503 while it
  starts or stops. On SIGTERM it fetches nothing more, gives the runs going
  45 s, kills what is left (to be retried) and exits 0, inside the compose
  service's grace of 60 s.
- **One process per run.** Each queue's run is forked from its entry,
  `runs/<queue>.ts`, with a 410 MB heap: the entry imports that job's module,
  parses the payload with the job's schema (a payload it refuses fails once,
  as on Trigger.dev), and calls `<job>Run` with a pg-boss context
  (`pg-boss-context.ts`). The worker kills a run's process on a cancel, a lost
  claim, or 30 s before its hour, before pg-boss could start another run on
  its key. A run raises its own `oom_score_adj`, so the kernel takes a run
  before the worker.
- **What a run asks of its runner**: enqueue a pass (`serializeBy` = the
  migration, its tags), wait for one (polling every second), ask after a run
  by its id (a `run_…` ref, Trigger.dev's, reads `unknown`; a job that is gone
  reads `finished`, said in a line) and cancel one, all through a producer the
  run opens only when it asks, on `JOBS_DATABASE_URL`, and closes when it ends.
- **Retries** as Trigger.dev 4.8.8's: three attempts, 5 s doubling to 60 s; a
  deliberate stop, a refused payload, the time limit and the heap are not
  retried; a process killed from outside or a lost claim is.
- **Logs**: stdout and stderr only; every line a run writes is forwarded with
  its queue and run id in front.
- The parent process loads no job module and opens one pool, the jobs
  schema's; only a run's own process loads its job and opens its pools
  (`scripts/a-pass-that-opened-the-owners-pool`, rule 10). No Trigger.dev task
  loads pg-boss.

## Deploy

Every code change to `src/jobs/*` or its dependencies needs a task deploy:

```bash
./deploy/compose/deploy-tasks.sh
```

The script preflights `uname -m` against `DEPLOY_IMAGE_PLATFORM` (an
amd64-image-on-arm64 mismatch dies log-less in the runner; override with
`SKIP_PLATFORM_CHECK=1`), builds, pushes to the local registry, and registers
the new version. Smoke-test the deployed plane end to end with
`./deploy/compose/smoke-managed.sh`. Full procedure: `docs/operator-runbook.md`.

There are no Helm charts in this repo.

## The cutover CLI (`src/cli/`)

Operator CLI for the cutover lifecycle — `start-cutover`, `verify`,
`approve`, `execute`, `complete`, `rollback`, `status`, `runbook`.
State-changing subcommands require `--yes`; `approve`, `execute` and
`complete` refuse a test migration, which is never switched over (workplan
0162 T3). Run with
`pnpm exec tsx apps/worker/src/cli/index.ts --help`; the operator procedure
is `docs/cutover-runbook.md`.

## The dev entrypoint (`src/index.ts`)

**Kept deliberately** (owner decision 2026-08-02, workplan 0021 T5): a
standalone dev tool — not an operator procedure — that runs a shadow
migration for ONE mapping from a JSON config, outside both editions'
control planes:

```
pnpm exec tsx apps/worker/src/index.ts --config mapping.json --once
```

Secrets come from env only, never the config file. It takes its pools the
way the per-tenant tasks do (`openTaskPools`, workplan 0138 T1), so it needs
both URLs: `APP_DATABASE_URL`, `app_user`, for the ledger, whose every
statement runs in the config's tenant's scope, and `SYSTEM_DATABASE_URL`, the
system role's (`ownpace_system`, which has no password until one is set on it,
as the bring-up does), for the audit key alone. It calls the same `runAllDomains` the editions run, so it cannot
drift from them silently, and the sync it runs is the ordinary
non-destructive shadow pass. Each firing (`--once`, and every cron tick in
scheduled mode) reads the migration's phases from that database first, as the
appliance does: a data type past its cutover gets no deletion detectors, one
paused or stopped does not run, and a mapping whose phases cannot be read (no
row, or a database that does not answer) is a firing refused, not a guess. Use it to debug a connector or reproduce a
support case end to end without booting an edition; it has no live caller
in either edition, by design.

## Monitoring

- **`run` / `run_event` tables** — the ledger's own record of every pass
  (status, counts, verbatim errors).
- **Trigger.dev dashboard** — through the compose stack's TLS front
  (`https://$TRIGGER_TLS_HOST:$TRIGGER_TLS_PORT`); the Runs page may be
  empty when ClickHouse analytics lag (accepted, 0020 T7) — the `run` table
  is ground truth.

## Testing

The task **logic** is tested through extracted seams: `sync-due.unit.test.ts`
(the tick's due-evaluation), `cutover-preparation.integration.test.ts`
(`prepareCutover` against a real ledger), the apply/verify suites in
`@openmig/core`, and the connector/target integration suites in this package
(`imap-dav-target`, `jmap-reindex`, `shared-mailbox`). The `schemaTask`
wrappers themselves run only in the live smoke — an honest gap recorded in
`docs/testing.md`'s untested-seams appendix. The pg-boss worker's wrapper is
not: `src/runner/worker.integration.test.ts` runs it against a real Postgres.

```bash
pnpm test               # workspace unit gate (repo root)
pnpm test:integration   # testcontainers (Postgres + Stalwart + Nextcloud)
```

## References

- [`docs/operator-runbook.md`](../../docs/operator-runbook.md) — deploy, env upload, smoke
- [`docs/cutover-runbook.md`](../../docs/cutover-runbook.md) — the CLI procedure
- [Workplan 0022](../../docs/workplans/0022-syncs-on-trigger-tasks.md) — why there is no worker container
- [ADR-0004](../../docs/adr/0004-orchestration-triggerdev-and-inprocess.md) — orchestration
- [Trigger.dev docs](https://trigger.dev/docs)


## A task that used to be here: `run-full-sync`

Deleted 2026-09-08. It existed because a full pass passes no cursor store —
that was its only real difference from `run-delta-sync`, and everything else
about it was that file as of a much earlier release: no per-domain
`migration_status` rows, no pause handling, no deadline, no failure category.

The row above used to claim it obeyed "the same enabled-domains rule". **It did
not.** It called `runShadowPass` directly instead of looping the mapping's
domains, so it synced MAIL AND NOTHING ELSE — a customer pressing a full
re-sync on a mapping carrying calendars, contacts, files and tasks had their
mail copied and was told it succeeded.

A full scan is now an option on the one job. Anything still holding the task id
`run-full-sync` — a queued run, an operator script — should send
`{"type":"full"}` to `POST .../sync` instead.
