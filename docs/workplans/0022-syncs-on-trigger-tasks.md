# Workplan 0022 — syncs move onto Trigger.dev tasks (retiring the poller)

## Status — 2026-08-01 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T0 Decision: one tick task, not per-mapping schedule rows | ✅ Decided (in this plan) | Rationale below. |
| T1 Due-ness module | 🟡 Built, PR open | `apps/worker/src/sync-due.ts` + 7 unit tests: never-run → due, not-due-before-next-firing, due-after, null → default cadence, start-anchored (a slow pass never pulls the next one earlier), minute boundaries, invalid cron throws (caller owns the fallback). |
| T2 The `managed-sync-tick` scheduled task | 🟡 Built, PR open | `apps/worker/src/jobs/managed-sync-tick.ts`: `schedules.task` on `* * * * *`; enumerates active mappings with last-start + running flags in one query; skips running mappings; invalid schedules sync on the DEFAULT cadence and log loudly every tick (silently skipping would dead-stop a mapping); domains passed EXPLICITLY from `enabled-domains.ts` (the #207 rule); triggers `run-delta-sync` with `concurrencyKey: mappingId`. `run-delta-sync` gains a concurrency-1 `delta-sync` queue, so tick/manual races serialize instead of overlapping. Typechecked; deploys via the existing `deploy-tasks.sh` (config already globs `src/jobs`). |
| T3 Live cutover on the Spark stack | ✅ **CLOSED 2026-08-01 — second attempt green after the first found a real bug (exactly what the staging exists for)** | First cutover attempt (2026-08-01 ~19:15 UTC): deploy 20260801.6 registered all 8 tasks and the `* * * * *` schedule (trigger-db confirmed `active=t`); idle ticks (19:10–19:14, nothing due) COMPLETED_SUCCESSFULLY — schedule firing ✓, runner→app-DB ✓; then the FIRST due minute (19:15, and every one after) went COMPLETED_WITH_ERRORS and no `run` rows appeared. Root cause: the platform injects `TRIGGER_API_URL` as the HOST-perspective origin (`http://localhost:3090` — deliberately, for the deploy CLI), which inside a runner container is the runner itself; the tick is the first task to call `.trigger()` from within a runner, so the enqueue died on connection refused. Fix: the tick configures the SDK with the in-network `http://trigger-api:3000` (env-overridable). The poller remained one command away throughout — zero user impact beyond paused syncs. **SECOND ATTEMPT CLOSED IT (2026-08-01 19:29 UTC, deployment 20260801.7): the last old-code tick (19:28) errored, the FIRST fixed tick (19:29:00) went `COMPLETED_SUCCESSFULLY` and triggered two `run-delta-sync` runs at 19:29:01 → `run` rows `succeeded` for BOTH mappings at 19:29:03; the 19:30 quarter-hour boundary fired again correctly; 19:31–19:34 ticked green with nothing due — all with the worker container STOPPED. The tick alone runs managed syncs.** |
| T4 Retire the poller | 🟡 **Built, PR open — T3's evidence is in, the lever is no longer needed** | `worker` service removed from `managed.yml` (13 services; a comment records the absence as deliberate), `apps/worker/src/managed-scheduler.ts` and `apps/worker/Dockerfile` DELETED, every comment/doc reference repointed (enabled-domains, trigger.config, seed, runbook scope note + seed section, worker README's Docker section, 0021's untested-seams and README bullets). One execution plane. |
| T5 Docs truth pass | 🟡 Built, in the closing PR | Runbook scope note + seed section (done with T4), `deployment.md`'s "Trigger.dev is added later" clause replaced with the real managed.yml execution-plane pointer, CHANGELOG entry for the whole 0020+0022 arc, workplans index rows and mid-flight line brought current. |

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
