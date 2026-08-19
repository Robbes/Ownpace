// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The managed sync tick (workplan 0022 T2) — the scheduled Trigger.dev task
 * that replaces the (now-retired) polling managed-scheduler as the thing that STARTS
 * syncs (owner decision 2026-08-01, 0020 T8: one execution plane; this
 * restores ADR-0004's original architecture, which the poller was always an
 * interim for).
 *
 * Every minute: enumerate `status = 'active'` mappings across ALL tenants
 * (the owner `DATABASE_URL` connection bypasses RLS for this trusted,
 * system-level enumeration — the exact trust boundary the poller documented),
 * evaluate each mapping's own `schedule` cron via `isSyncDue`, and trigger
 * `run-delta-sync` for the due ones with the mapping's ENABLED domains passed
 * explicitly (the scheduler's scope_selection query — a job must never touch
 * a domain the owner did not select, the #207 lesson).
 *
 * Overlap safety, two layers:
 *  - a mapping with a `run` row currently `running` is skipped this tick;
 *  - `run-delta-sync` runs on a concurrency-1 queue partitioned by
 *    `concurrencyKey: mappingId`, so even a tick/start race serializes
 *    instead of overlapping. (If a duplicate does get queued behind a slow
 *    pass, the second run is a cheap idempotent delta — create-if-absent is
 *    the product's core property — so the failure mode is wasted work, never
 *    duplicated data.)
 *
 * A mapping with an INVALID cron schedule is synced on the DEFAULT cadence
 * and logged loudly every tick — silently skipping would dead-stop the
 * mapping and mask the bad value (hard rule 9). A mapping with no enabled
 * domains is skipped: no row in scope_selection means "not selected", never
 * "default to everything".
 */

import { schedules, configure } from '@trigger.dev/sdk';
import { Pool } from 'pg';
import { log, mapWithConcurrency } from '@openmig/shared';
import { isSyncDue, DEFAULT_SYNC_SCHEDULE, defaultScheduleFor } from '@openmig/orchestration/sync-due';
import {
  enabledDomainsForMappings,
  type SyncDomain,
} from '@openmig/orchestration/enabled-domains';
import { runDeltaSync } from './run-delta-sync.ts';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}
const pool = new Pool({ connectionString: DATABASE_URL });

/**
 * How many mappings the tick may enqueue at once.
 *
 * Not a sync concurrency — enqueueing is a short API call, and the runs
 * themselves are serialized per mapping by the queue. This exists because the
 * enqueues used to be `await`ed one after another inside the loop, so the
 * tick's wall time was the number of due mappings times a round trip. On a
 * one-minute cron that is a countdown: cross sixty seconds and ticks overlap.
 *
 * Bounded rather than unbounded because the failure mode of `Promise.all` over
 * every due mapping is a burst against the trigger API that looks, to it, the
 * same as an attack.
 */
const ENQUEUE_CONCURRENCY = 8;

interface TickRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly schedule: string | null;
  readonly last_started: Date | null;
  readonly running: boolean;
}

export const managedSyncTick = schedules.task({
  id: 'managed-sync-tick',
  cron: '* * * * *',
  run: async () => {
    // In-network API URL (found live, 2026-08-01, the tick's first due firing):
    // the platform injects TRIGGER_API_URL as the HOST-perspective API origin
    // (http://localhost:3090 — correct for the deploy CLI, which is why
    // API_ORIGIN is set that way), but inside a runner container `localhost`
    // is the runner itself. This is the FIRST task that calls the API from
    // within a runner — idle ticks succeeded, and the first DUE tick died on
    // the .trigger() call with connection refused. Point the SDK at the
    // compose-network address instead; secretKey keeps resolving from the
    // injected TRIGGER_SECRET_KEY env. Scoped to this run's own process (each
    // task run executes in its own TaskRunProcess).
    configure({
      baseURL: process.env.TRIGGER_API_URL_IN_NETWORK ?? 'http://trigger-api:3000',
    });

    const now = new Date();
    // The tick runs on a one-minute cron, so its own duration is the number
    // that decides whether it still fits (workplan 0083). 0082 fixed three
    // things that made it slow and could argue only from reading the code —
    // this is what makes the next such claim measurable instead. Logged every
    // tick rather than sampled: it is one line, and the interesting value is
    // the tail, which sampling is exactly what loses.
    const startedAt = Date.now();
    const { rows } = await pool.query<TickRow>(
      `SELECT m.id, m.tenant_id, m.schedule,
              (SELECT max(r.started_at) FROM run r
                WHERE r.tenant_id = m.tenant_id AND r.mapping_id = m.id) AS last_started,
              EXISTS (SELECT 1 FROM run r
                WHERE r.tenant_id = m.tenant_id AND r.mapping_id = m.id
                  AND r.status = 'running') AS running
         FROM mailbox_mapping m
        WHERE m.status = 'active'`
    );

    let notDue = 0;
    let skippedRunning = 0;
    let skippedNoDomains = 0;

    // Phase 1 — decide, in memory. No I/O in here, so the set of due mappings
    // is evaluated against ONE `now` rather than drifting as the loop runs.
    const due: TickRow[] = [];
    for (const m of rows) {
      if (m.running) {
        skippedRunning++;
        continue;
      }

      // An explicit schedule is the owner's decision and is used as written.
      // Only the absent one gets a per-mapping offset, so the mappings that
      // never chose a cadence stop all firing in the same minute.
      const schedule = m.schedule ?? defaultScheduleFor(m.id);
      let isDue: boolean;
      try {
        isDue = isSyncDue(schedule, m.last_started, now);
      } catch (err) {
        // Loud, every tick, and the mapping keeps syncing on the default
        // cadence while somebody fixes the value.
        log.error(
          `[sync-tick] mapping ${m.id}: invalid schedule ${JSON.stringify(m.schedule)} — ` +
            `using the default (${DEFAULT_SYNC_SCHEDULE}) until it is fixed:`,
          err
        );
        isDue = isSyncDue(defaultScheduleFor(m.id), m.last_started, now);
      }
      if (!isDue) {
        notDue++;
        continue;
      }
      due.push(m);
    }

    // Phase 2 — one query for every due mapping's scope, instead of one per
    // mapping inside the loop.
    const domainsByMapping = await enabledDomainsForMappings(
      pool,
      due.map((m) => ({ id: m.id, tenantId: m.tenant_id }))
    );

    const toEnqueue: { row: TickRow; domains: SyncDomain[] }[] = [];
    for (const m of due) {
      // Absent from the map means no included rows: no scope_selection row is
      // "not selected", never "default to everything".
      const domains = [...(domainsByMapping.get(m.id) ?? [])];
      if (domains.length === 0) {
        skippedNoDomains++;
        continue;
      }
      toEnqueue.push({ row: m, domains });
    }

    // Phase 3 — enqueue concurrently, bounded. A failure to enqueue ONE
    // mapping must not cost the others their turn: before this the loop threw
    // out of the whole tick, so a single bad mapping stopped every mapping
    // after it in the list, once a minute, invisibly.
    let triggered = 0;
    const failures: string[] = [];
    await mapWithConcurrency(toEnqueue, ENQUEUE_CONCURRENCY, async ({ row, domains }) => {
      try {
        await runDeltaSync.trigger(
          { tenantId: row.tenant_id, mappingId: row.id, domains },
          {
            concurrencyKey: row.id,
            tags: [`tenant:${row.tenant_id}`, `mapping:${row.id}`],
          }
        );
        triggered++;
      } catch (err) {
        failures.push(row.id);
        log.error(`[sync-tick] mapping ${row.id}: could not enqueue this pass:`, err);
      }
    });

    const summary = {
      active: rows.length,
      triggered,
      notDue,
      skippedRunning,
      skippedNoDomains,
      failedToEnqueue: failures.length,
      ms: Date.now() - startedAt,
    };
    // Said loudly when the tick is approaching the interval it runs on. A tick
    // that takes longer than its own period does not fail — it overlaps, and
    // the fan-out gets least predictable exactly when there is most of it. By
    // the time that is visible in behaviour it is hard to attribute, so it is
    // announced while there is still headroom.
    if (summary.ms >= 30_000) {
      log.warn(
        `[sync-tick] took ${summary.ms}ms of its 60000ms period — at 60000ms ticks begin to ` +
          'overlap. Enumerated ' + `${summary.active} active mappings, enqueued ${summary.triggered}.`
      );
    }
    log.info('[sync-tick]', summary);
    return summary;
  },
});
