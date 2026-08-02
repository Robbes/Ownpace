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
| `run-delta-sync` | the tick, or API `POST .../sync {"type":"delta"}` | Incremental pass over the mapping's **enabled domains only** (the #207 rule). Queue `delta-sync`, concurrency 1 per mapping (`concurrencyKey: mappingId`) — a duplicate run is a wasted idempotent delta, never duplicated data. |
| `run-full-sync` | API `POST .../sync {"type":"full"}` | Full pass, same enabled-domains rule. |
| `run-discovery` | mapping creation / API | Read-only, body-free per-domain counts into `migration_discovery` (the confirm screen's data). |
| `run-verification` | API `POST .../verify/start` | The §20 gate as a job; drives `verification_run` to a terminal report the API serves at `GET .../verify/report`. |
| `run-apply-deletion` | API apply → receipt | Re-runs ALL apply gates in the job, performs the one destructive removal, lands the `apply_receipt` terminal state (`applied`/`refused`/`failed`). |
| `run-cutover` | manual | Cutover **preparation** only: final delta + §20 gate, landing in `READY_FOR_CUTOVER` and stopping there — approving and executing are explicit `--yes` CLI actions it never performs. |
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
  host-perspective `TRIGGER_API_URL` into runners, so any task that calls
  `.trigger()` from inside a runner (the tick does) must
  `configure({ baseURL: process.env.TRIGGER_API_URL_IN_NETWORK ?? 'http://trigger-api:3000' })`.
- Task-runtime env (`DATABASE_URL`, `APP_DATABASE_URL`,
  `SECRET_ENCRYPTION_KEY`) is uploaded once per environment with
  `deploy/compose/set-task-env.sh` — runners do not read the compose `.env`.

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
State-changing subcommands require `--yes`. Run with
`pnpm exec tsx apps/worker/src/cli/index.ts --help`; the operator procedure
is `docs/cutover-runbook.md`.

`src/index.ts` is a separate dev entrypoint (`--config mapping.json`) with no
live caller; its fate is an owner decision tracked in workplan 0021 T5.

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
`docs/testing.md`'s untested-seams appendix.

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
