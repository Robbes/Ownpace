# Workplan 0022 — syncs move onto Trigger.dev tasks (retiring the poller)

## Status — 2026-08-01: ✅ ALL TASKS CLOSED (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T0 Decision: one tick task, not per-mapping schedule rows | ✅ Decided (in this plan) | Rationale below. |
| T1 Due-ness module | ✅ Done — merged (PR #218, CI green) | `apps/worker/src/sync-due.ts` + 7 unit tests: never-run → due, not-due-before-next-firing, due-after, null → default cadence, start-anchored (a slow pass never pulls the next one earlier), minute boundaries, invalid cron throws (caller owns the fallback). |
| T2 The `managed-sync-tick` scheduled task | ✅ Done — merged (#218 + the in-network API-URL fix #219, CI green) | `apps/worker/src/jobs/managed-sync-tick.ts`: `schedules.task` on `* * * * *`; enumerates active mappings with last-start + running flags in one query; skips running mappings; invalid schedules sync on the DEFAULT cadence and log loudly every tick (silently skipping would dead-stop a mapping); domains passed EXPLICITLY from `enabled-domains.ts` (the #207 rule); triggers `run-delta-sync` with `concurrencyKey: mappingId`. `run-delta-sync` gains a concurrency-1 `delta-sync` queue, so tick/manual races serialize instead of overlapping. Typechecked; deploys via the existing `deploy-tasks.sh` (config already globs `src/jobs`). **2026-09-08 — a THIRD overlap layer, because the first two shared a hole.** Both trusted the `running` row, and nothing closed that row when a pass was KILLED rather than finished (`maxDuration`, OOM, a supervisor restart). A killed pass therefore left `running` set for ever and this tick skipped its mapping on every subsequent firing — the migration stopped, silently, with nothing to reap it (`retention` deliberately never touches a `running` run). Now: (a) the pass carries its own soft deadline and ends cleanly before the kill (`PASS_SOFT_DEADLINE_MS`, `packages/shared/src/pass-deadline.ts`); (b) `run-delta-sync` closes its run row through one `closeRun` reached from the success path, the catch AND a `finally`; (c) this tick treats a `running` row older than `2 × PASS_HARD_LIMIT_MS` as dead, enqueues the mapping anyway, and says so with a `warn` naming how long it stood still. Twice the ceiling rather than a little over it: the queue's `concurrencyKey` still guards against two live writers, so being slow here costs one cadence and being fast costs correctness. Guards: `a-pass-that-stops-halfway-keeps-its-cursor.unit.test.ts` (9), `a-domain-that-ignores-its-deadline.unit.test.ts` (3), `scripts/a-pass-that-outlives-its-runner.unit.test.ts` (4) — each proved by breaking. **2026-09-08 — a drain, and words to go with it.** Updating the platform means stopping new passes, letting the ones in flight finish, deploying, and starting again. The stopping half was always possible (stop the scheduler); the SAYING half had nowhere to live, because `PlatformStatus` (0110 T5) is probed facts with nothing writable in it. Managed migration 0023 adds `platform_pause` — a log, not a switch: the open hold is the row with `ended_at IS NULL`, a partial unique index means there is at most one, and closed rows stay because "when were we down, and what did we tell people" gets asked afterwards. The tick reads it BEFORE enumerating and returns having enqueued nothing, logging how many passes are still in flight (the only number that says whether the drain is done). Nothing is cancelled: a hold that killed work would lose the pass and leave its run row open, which is what this task's own deadline work spent a PR fixing. Every signed-in customer sees the operator's own sentence, or a default one, so a drain is never wordless. **2026-09-08 — a migration that cannot succeed stops asking every fifteen minutes.** Found on a live deployment: one mapping, 3 items, **4796 run rows**. Its source credential had become unreadable after a `SECRET_ENCRYPTION_KEY` rotation, so every pass failed at the credential and this tick enqueued the next one on schedule — fifty days of it. Nothing malfunctioned: `ACTIVE_MAPPINGS_SQL` selects `status = 'active'` and `isSyncDue` honours the mapping's own cron, and retrying IS the right default (a credential fixed at any moment resumes the migration with nobody pressing anything). What was missing is that nothing noticed the retry was not working — ~96 failed passes a day, each a **billable** sync operation, since `usage-metering.ts` counts finished runs of a billable kind and does not filter on status. Owner's decision: back off, do not stop. `packages/orchestration/src/failing-backoff.ts` holds a ladder (3 failures → 1 h between attempts, 6 → 4 h, 12 → 24 h), a floor on top of the mapping's own cron and never a ceiling, so a daily mapping is never made more frequent. NOT a `paused` state: `pause-reason.ts` defines a pause as "a scheduled stop, never a failure", so borrowing the word would put two different things behind one badge — the mapping stays `active`, its card already says it is failing, it is simply asked less often, and one successful pass puts it straight back on cadence. Gated on the category (0110 T3): `rate_limited`, `quota_exceeded` and `network` clear by themselves, so a mapping reporting any of those on ANY domain keeps its cadence — only `auth_expired`, `target_refused` and `unknown` are slowed. The two new columns are computed in the tick's existing query. The count is restricted to `BILLABLE_RUN_KINDS` — a failed discovery or verify is a real failure and belongs on the customer's screen, but it is not evidence that COPYING is broken, and counting it would hold back the first sync of a mapping whose discovery failed a dozen times before somebody fixed the credential; a SUCCEEDED run of such a kind is likewise no reset. And both scans are bounded by `FAILURE_WINDOW_MINUTES`: unbounded, "failures since the last success" is a scan back to the beginning of history for a mapping that never succeeded, which is migration 0023's pathology reintroduced by the feature meant to stop the waste (measured on PGlite with 3000 rows: 671 read, not 3000, and it does not grow with time). Guards: `a-migration-that-cannot-succeed.unit.test.ts` (11 — the ladder walked from `LADDER`, the self-healing complement, the window recomputed from the climb) and `a-migration-that-keeps-asking.unit.test.ts` (16 — the two columns against real Postgres, plus the tick's own ordering, since every other assertion would pass with the module imported by nobody). Each proved by breaking. |
| T3 Live cutover on the Spark stack | ✅ **CLOSED 2026-08-01 — second attempt green after the first found a real bug (exactly what the staging exists for)** | First cutover attempt (2026-08-01 ~19:15 UTC): deploy 20260801.6 registered all 8 tasks and the `* * * * *` schedule (trigger-db confirmed `active=t`); idle ticks (19:10–19:14, nothing due) COMPLETED_SUCCESSFULLY — schedule firing ✓, runner→app-DB ✓; then the FIRST due minute (19:15, and every one after) went COMPLETED_WITH_ERRORS and no `run` rows appeared. Root cause: the platform injects `TRIGGER_API_URL` as the HOST-perspective origin (`http://localhost:3090` — deliberately, for the deploy CLI), which inside a runner container is the runner itself; the tick is the first task to call `.trigger()` from within a runner, so the enqueue died on connection refused. Fix: the tick configures the SDK with the in-network `http://trigger-api:3000` (env-overridable). The poller remained one command away throughout — zero user impact beyond paused syncs. **SECOND ATTEMPT CLOSED IT (2026-08-01 19:29 UTC, deployment 20260801.7): the last old-code tick (19:28) errored, the FIRST fixed tick (19:29:00) went `COMPLETED_SUCCESSFULLY` and triggered two `run-delta-sync` runs at 19:29:01 → `run` rows `succeeded` for BOTH mappings at 19:29:03; the 19:30 quarter-hour boundary fired again correctly; 19:31–19:34 ticked green with nothing due — all with the worker container STOPPED. The tick alone runs managed syncs.** |
| T4 Retire the poller | ✅ **Done — merged (PR #220, CI green); the stopped container removed on the Spark box and a `SMOKE PASS` re-certified the poller-free stack (2026-08-01 19:45 UTC)** | `worker` service removed from `managed.yml` (13 services; a comment records the absence as deliberate), `apps/worker/src/managed-scheduler.ts` and `apps/worker/Dockerfile` DELETED, every comment/doc reference repointed (enabled-domains, trigger.config, seed, runbook scope note + seed section, worker README's Docker section, 0021's untested-seams and README bullets). One execution plane. |
| T5 Docs truth pass | ✅ Done — merged (PR #221) | Runbook scope note + seed section (done with T4), `deployment.md`'s "Trigger.dev is added later" clause replaced with the real managed.yml execution-plane pointer, CHANGELOG entry for the whole 0020+0022 arc, workplans index rows and mid-flight line brought current. |

## Why this exists

**Owner decision, 2026-08-01 (0020 T8): option A — one execution plane.** The
polling `managed-scheduler` has run every managed sync since 0011 T7 closed,
but it always described itself as the pragmatic interim, and ADR-0004's
architecture put jobs behind Trigger.dev from the start. With the task path
now live-proven end to end (0018: deploy → runner → job → row, verify AND
apply), keeping a second, zero-test execution plane for the core loop is the
deviation, not the plan. This workplan closes it — with the explicit
trade-off on record: syncs now depend on the trigger stack's health (webapp,
supervisor, redis, registry), which 0020 spent a day making boringly
reliable (restart policies, fail-closed secrets, the smoke as acceptance).
The rollback lever during cutover is the poller container itself, which is
why T4 (deleting it) strictly follows T3 (live evidence).

## T0 — one tick task, not per-mapping schedule rows

Two ways to schedule per-mapping syncs on Trigger.dev:

1. **Per-mapping schedule rows** (`schedules.create` keyed by mapping id):
   the platform fires each mapping directly — but now every mapping
   lifecycle change (create, start, finish, delete, schedule edit) must
   create/update/delete external schedule state, and drift between
   `mailbox_mapping` and the platform's schedule table becomes a new failure
   class that needs a reconciler.
2. **One declarative tick** (`managed-sync-tick`, every minute) that reads
   `mailbox_mapping` and evaluates each mapping's own `schedule` cron with
   croner: the DB stays the single source of truth, lifecycle changes are
   picked up within a minute with zero orchestration code, and the tick is
   the same trusted owner-pool enumeration the poller performed.

**Decision: the tick.** The reconciler that option 1 requires is exactly the
kind of state-synchronization machinery this codebase avoids; a minute of
scheduling granularity is already the poller's own resolution (its poll
interval was 60 s). Cost accepted: one tiny runner container per minute even
when nothing is due.

## T2 — overlap safety (two layers, and why wasted work is the failure mode)

- The tick skips any mapping with a `run` row in `running`.
- `run-delta-sync` runs on a concurrency-1 queue partitioned by
  `concurrencyKey: mappingId` — a tick/manual race serializes.
- If a duplicate still gets queued behind a slow pass (a queued task has no
  `run` row yet, so the next tick can't see it), the second run is a cheap
  idempotent delta: create-if-absent is the product's core property, proven
  by the restart-resume gates. The failure mode is wasted work, never
  duplicated data.

## T3 — live cutover (the rollback lever stays armed)

On the Spark box, in this order — the poller keeps running until the tick is
proven, and remains one `docker compose start worker` away until T4:

```bash
cd ~/open-migrate-live && git pull origin main
./deploy/compose/deploy-tasks.sh          # registers managed-sync-tick (8 tasks now)
# watch two tick firings in the dashboard Tasks tab or:
docker logs -f trigger-supervisor 2>&1 | grep -m2 sync-tick
docker compose -f deploy/compose/managed.yml stop worker    # poller OFF
# wait ~2 minutes, then prove syncs still happen without it:
docker exec open-migrate-db sh -lc "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -Atc \
  \"SELECT mapping_id, status, started_at FROM run ORDER BY started_at DESC LIMIT 5\""
./deploy/compose/smoke-managed.sh         # acceptance unchanged: SMOKE PASS
```

Acceptance: recent `run` rows with `started_at` AFTER the poller stopped,
and a green smoke. Rollback at any point: `docker compose start worker`.

## T4 — retire the poller (only after T3's evidence)

Remove the `worker` service from `managed.yml` (nothing else needs the
container — the API triggers tasks over HTTP, and task env comes from
`set-task-env.sh`), delete `apps/worker/src/managed-scheduler.ts`, drop it
from 0021 T3's untested-seams list, and update the runbook's scope note
(division of labour becomes: EVERYTHING runs as deployed tasks).

## Hard rules that bite here

- **Rule 9:** an invalid mapping schedule logs loudly and syncs on the
  default cadence — a silent skip would dead-stop a mapping.
- **The #207 rule:** the tick passes enabled domains explicitly; a job never
  touches a domain the owner did not select.
- **Rule 5:** all of this is managed infrastructure; the appliance's
  in-process scheduler is untouched.
