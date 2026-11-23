# ADR-0004: Orchestration via Trigger.dev (managed) + in-process scheduler (self-host)

- **Status:** Accepted; **its managed half superseded by
  [ADR-0054](./0054-the-managed-editions-jobs-run-on-pg-boss.md)**, accepted 2026-11-22 and in
  force since workplan 0167 T7: pg-boss runs the managed edition's jobs, and alpha.18 removes
  Trigger.dev (0167 T9). The self-host half stands. Amended three times (2026-11-22, 2026-11-23).
- **Date:** 2026-06-20

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- One `Scheduler`/`JobRunner` seam: **in-process scheduler** on the appliance; on managed **pg-boss** on our own Postgres ([ADR-0054](./0054-the-managed-editions-jobs-run-on-pg-boss.md), in force since workplan 0167 T7); self-hosted Trigger.dev is removed from the managed edition (alpha.18, workplan 0167 T9).
- The orchestrator never sees content: task payloads carry ids only; bytes move inside the task process (SAD §17).

> **Update 2026-08-02:** "imapsync/rclone move data directly source->target"
> is historical — the bytes now flow through OUR connector code executing as
> deployed Trigger.dev tasks (workplans 0018/0022; since 0022 the managed
> edition runs on exactly one execution plane, this ADR as originally drawn).
> The privacy property survives in its real form: the ORCHESTRATOR still never
> sees content, because task payloads carry ids only and content moves inside
> the task process (SAD §17).

## Context
We need robust scheduling, retries, concurrency budgets, and long-running tasks. The ledger already holds durable migration state, so full durable-execution is helpful but not essential. Self-host must remain possible, including local dev on an arm64 machine.

## Decision
Define a **`Scheduler`/`JobRunner` interface** with two implementations:
- **Self-host:** in-process scheduler (croner/node-cron), no heavy orchestrator.
- **Managed:** **Trigger.dev** (Apache-2.0, TS-native, durable long-running tasks, retries, idempotency, tenant-scoped concurrency), **self-hostable via Docker** or Trigger.dev Cloud.
Workers run on our/the user's infra; because imapsync/rclone move data directly source->target, the orchestrator never sees message content (only metadata).

## Consequences
- Matches the Apache-2.0 + TypeScript + low-ops goals.
- Self-host stays light; managed can be self-hosted or cloud.
- Orchestrator is swappable behind the interface.

## Alternatives considered
- Temporal (MIT): strongest durable execution but heavier self-host (own DB + services) and a monthly Cloud floor (~$100-200). Kept as a heavyweight fallback.
- Hatchet (Postgres-only): viable lighter option; reuses Postgres.
- Windmill: AGPL core + commercial clause on re-exposing to users — conflicts with maximal-use.
- n8n: fair-code, not OSI-open — rejected as core.

## Amendment log

- **2026-11-22** — The managed half is superseded by
  [ADR-0054](./0054-the-managed-editions-jobs-run-on-pg-boss.md) (the owner, workplan 0167 T4:
  *"Put in the successful spike (replace triggerdev)."*): the managed edition's jobs move to
  pg-boss on our own Postgres, worked by a worker container. Not in force until 0167 T7; until
  then Trigger.dev runs them, and the first operative rule says so and points there. The
  self-host half, the seam and the rule that the orchestrator never sees content stand; the
  sections above are left as they were written. Record: ADR-0054, decision 6.
- **2026-11-22** — ADR-0054 is in force (workplan 0167 T7, the switch on): the first operative
  rule names pg-boss on managed, with Trigger.dev kept installed and stopped as the fallback. The
  sections above are left as they were written.
- **2026-11-23** — The managed half is superseded in full: alpha.18 removes self-hosted
  Trigger.dev from the managed edition, its code, images, scripts, pins and services (workplan
  0167 T9; the owner, 2026-11-23: *"i will remove trigger.dev, but the machine runs OTA and
  managed, so both have to be move out of triggerdev."*). The first operative rule says so. The
  self-host half, the seam and the rule that the orchestrator never sees content stand; the
  sections above are left as they were written.
