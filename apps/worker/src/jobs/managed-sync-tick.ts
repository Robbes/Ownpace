// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The managed sync tick (workplan 0022 T2) — the scheduled Trigger.dev task
 * that replaces the polling `managed-scheduler` as the thing that STARTS
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
import { log } from '@openmig/shared';
import { isSyncDue, DEFAULT_SYNC_SCHEDULE } from '../sync-due';
import { enabledDomains } from '../enabled-domains';
import { runDeltaSync } from './run-delta-sync';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}
const pool = new Pool({ connectionString: DATABASE_URL });

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

    let triggered = 0;
    let notDue = 0;
    let skippedRunning = 0;
    let skippedNoDomains = 0;

    for (const m of rows) {
      if (m.running) {
        skippedRunning++;
        continue;
      }

      let due: boolean;
      try {
        due = isSyncDue(m.schedule, m.last_started, now);
      } catch (err) {
        // Loud, every tick, and the mapping keeps syncing on the default
        // cadence while somebody fixes the value.
        log.error(
          `[sync-tick] mapping ${m.id}: invalid schedule ${JSON.stringify(m.schedule)} — ` +
            `using the default (${DEFAULT_SYNC_SCHEDULE}) until it is fixed:`,
          err
        );
        due = isSyncDue(DEFAULT_SYNC_SCHEDULE, m.last_started, now);
      }
      if (!due) {
        notDue++;
        continue;
      }

      const domains = [...(await enabledDomains(pool, m.tenant_id, m.id))];
      if (domains.length === 0) {
        skippedNoDomains++;
        continue;
      }

      await runDeltaSync.trigger(
        { tenantId: m.tenant_id, mappingId: m.id, domains },
        {
          concurrencyKey: m.id,
          tags: [`tenant:${m.tenant_id}`, `mapping:${m.id}`],
        }
      );
      triggered++;
    }

    const summary = { active: rows.length, triggered, notDue, skippedRunning, skippedNoDomains };
    log.info('[sync-tick]', summary);
    return summary;
  },
});
