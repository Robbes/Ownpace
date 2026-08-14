// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * Delta Sync Job
 *
 * Performs an incremental sync of changes since the last sync.
 * This job is typically run on a frequent schedule (e.g., every 5-15 minutes).
 *
 * Trigger: Scheduled (cron)
 */

import { z } from 'zod';
import { schemaTask, queue } from '@trigger.dev/sdk';
import { Pool } from 'pg';
import { runShadowPass, runCalendarSync, runContactSync, runFileSync } from '@openmig/core';
import type { TenantId, MappingId } from '@openmig/shared';
import { buildDepsFromMapping, buildDomainDepsFromMapping } from '@openmig/orchestration/build-deps-from-mapping';
import { enabledDomains, describeAbsentDomains } from '@openmig/orchestration/enabled-domains';
import {
  withTenant,
  PgMigrationStatusStore,
  RunStore,
  recordComputeForRun,
  recordApiCallForRun,
  resolveTenantPricing,
} from '@openmig/ledger';
import { log } from '@openmig/shared';

// Job input schema
const DeltaSyncJobSchema = z.object({
  tenantId: z.string().uuid(),
  mappingId: z.string().uuid(),
  domains: z.array(z.enum(['file', 'email', 'calendar', 'contact'])).optional(),
});

type DeltaSyncJobPayload = z.infer<typeof DeltaSyncJobSchema>;

// Database connection from environment
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Create a persistent pool for jobs
const pool = new Pool({ connectionString: DATABASE_URL });

// No pricing literal here any more. This file used to carry
// `const PRICING = { computePricePerHour: 5 }` under a "should come from
// config/env in production" comment, while the API invoiced from its own
// separate copy — two numbers that must agree, in two packages, either of
// which could be changed alone. Metering now prices each pass at the tenant's
// own agreed rates via resolveTenantPricing (@openmig/ledger), which is the
// same function the invoice uses.

/**
 * Get current billing period dates
 */
function getCurrentPeriod(): { periodStart: string; periodEnd: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-11
  
  const periodStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const periodEnd = `${year}-${String(month + 1).padStart(2, '0')}-${lastDay}`;
  
  return { periodStart, periodEnd };
}

// Concurrency 1, partitioned by `concurrencyKey: mappingId` at trigger time
// (the sync tick sets it): one running delta sync per mapping, ever — a slow
// pass serializes the next one instead of overlapping it (0022 T2).
const deltaSyncQueue = queue({ name: 'delta-sync', concurrencyLimit: 1 });

// Register the job with Trigger.dev
export const runDeltaSync = schemaTask({
  id: 'run-delta-sync',
  description: 'Delta Sync',
  schema: DeltaSyncJobSchema,
  queue: deltaSyncQueue,
  run: async (payload: unknown, _context) => {
    // Type assertion since schemaTask validates the payload
    const typedPayload = payload as DeltaSyncJobPayload;
    
    // SECURITY: Fail closed if tenantId missing
    if (!typedPayload.tenantId) {
      throw new Error('tenantId is required in job payload');
    }

    log.info('Starting delta sync', {
      tenantId: typedPayload.tenantId,
      mappingId: typedPayload.mappingId,
      domains: typedPayload.domains,
    });

    const tenantId = typedPayload.tenantId as TenantId;
    const mappingId = typedPayload.mappingId as MappingId;
    // No explicit domain list means "the mapping's OWN selection", never "all
    // four" — scope_selection is the owner's call, and enabledDomains is the
    // same query the sync tick uses, so a manual run and a scheduled one
    // cannot disagree (the #207 lesson, relearned live 2026-08-11: the API's
    // "run now" enqueue passes no domains, and the old all-four default built
    // calendar DAV deps from an email-only mapping's IMAP connection).
    // Resolved even when the caller named its own domains, because the run log
    // below has to tell "the owner did not select this" apart from "this run
    // was asked for less", and only scope_selection knows which is which.
    const selected = await enabledDomains(pool, tenantId, mappingId);
    const domains = typedPayload.domains ?? [...selected];
    const { periodStart, periodEnd } = getCurrentPeriod();

    // Open the run-ledger row up front so an in-flight run is visible in the UI
    // and a crash leaves a `running` row rather than no trace at all.
    const runId = await withTenant(pool, tenantId, async (db) =>
      new RunStore(db).startRun({
        tenantId,
        mappingId,
        kind: 'incremental',
        trigger: 'schedule',
        // orchestratorRef (the Trigger.dev run id) is intentionally not set:
        // the context shape isn't stable across SDK versions here, and a wrong
        // value is worse than an absent one. Wire it when the v4 task model lands.
      }),
    );

    let itemsProcessed = 0;

    try {
      if (domains.length === 0) {
        // Mirrors the tick's rule: no scope_selection rows means "not
        // selected", never "default to everything". Say so in the run log
        // rather than closing a silent empty success.
        await withTenant(pool, tenantId, async (db) => {
          await new RunStore(db).logEvent(tenantId, runId, 'info',
            'no domains are selected for this mapping (scope_selection is empty) — nothing to sync');
        });
      }

      // Account for the domains that are NOT about to run, before any of them
      // do. A run log that lists only what ran leaves the absences unexplained
      // (see describeAbsentDomains).
      for (const line of describeAbsentDomains(selected, domains)) {
        await withTenant(pool, tenantId, async (db) => {
          await new RunStore(db).logEvent(tenantId, runId, 'info', line);
        });
      }
      for (const domain of domains) {
        log.info(`Running delta sync for domain: ${domain}`);

        try {
          // EVERY domain opens and closes its own migration_status row, email
          // included. That row is what the mapping list's "last sync" column
          // reads and what the metering below prices, and until 2026-08-11 the
          // email branch wrote neither: a comment here claimed
          // buildDepsFromMapping managed the email status itself, which was
          // simply not true (nothing in @openmig/core or the ledger touches
          // that table). Live on the Spark, an email-only mapping syncing
          // cleanly every 15 minutes reported "last sync: 9 days ago" —
          // the run history and the mapping list disagreeing about the same
          // passes, with the stale one shown on the screen an owner checks
          // first. `initDomainStatus` is idempotent and makes the row exist
          // before markInProgress, whose UPDATE would otherwise hit nothing.
          await withTenant(pool, tenantId, async (db) => {
            const status = new PgMigrationStatusStore(db);
            await status.initDomainStatus(tenantId, mappingId, domain);
            await status.markInProgress(tenantId, mappingId, domain);
          });

          // Build + run + release the deps' pool per domain. Literal domain
          // args pick the right overload; the finally never leaks the pool.
          let result: { created: number; skipped: number };
          if (domain === 'email') {
            // SECURITY: Build deps with tenant scoping (RLS enforced).
            const deps = await buildDepsFromMapping(pool, tenantId, mappingId);
            try {
              const pass = await runShadowPass(deps);
              result = { created: pass.created, skipped: pass.skipped };
            } finally {
              await deps.close();
            }
          } else if (domain === 'calendar') {
            const deps = await buildDomainDepsFromMapping(pool, tenantId, mappingId, 'calendar');
            try { result = await runCalendarSync(deps); } finally { await deps.close(); }
          } else if (domain === 'contact') {
            const deps = await buildDomainDepsFromMapping(pool, tenantId, mappingId, 'contact');
            try { result = await runContactSync(deps); } finally { await deps.close(); }
          } else {
            const deps = await buildDomainDepsFromMapping(pool, tenantId, mappingId, 'file');
            try { result = await runFileSync(deps); } finally { await deps.close(); }
          }

          await withTenant(pool, tenantId, async (db) => {
            await new PgMigrationStatusStore(db).markCompleted(tenantId, mappingId, domain);
          });
          itemsProcessed += result.created + result.skipped;
          log.info(`${domain} sync completed: ${result.created} created, ${result.skipped} skipped`);
          await withTenant(pool, tenantId, async (db) => {
            await new RunStore(db).logEvent(tenantId, runId, 'info',
              `${domain}: ${result.created} created, ${result.skipped} skipped`,
              { domain, created: result.created, skipped: result.skipped });
          });

          // Metering (all domains): record compute + one sync op from the run's
          // migration_status timing, priced at THIS TENANT's agreed rates
          // (pinned when the tenant was first billed — the operator's template
          // moves on, an existing customer's prices do not). Guarded — skips
          // cleanly if status is absent.
          await withTenant(pool, tenantId, async (db) => {
            const statusStore = new PgMigrationStatusStore(db);
            const statusList = await statusStore.getStatus(tenantId, mappingId);
            const domainStatus = statusList.find((s) => s.domain === domain);
            if (domainStatus && domainStatus.completedAt) {
              await recordComputeForRun(db, {
                tenantId,
                mappingId,
                domain,
                startedAt: new Date(domainStatus.startedAt),
                completedAt: new Date(domainStatus.completedAt),
                periodStart,
                periodEnd,
              }, await resolveTenantPricing(db, tenantId));
              await recordApiCallForRun(db, { tenantId, mappingId, domain, periodStart, periodEnd });
            }
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          log.error(`Domain ${domain} sync failed:`, errorMessage);
          // Record the failure verbatim in the run log (hard rule 9) before
          // surfacing it. Best-effort: a logging failure must not replace the
          // real error with a logging error.
          try {
            await withTenant(pool, tenantId, async (db) => {
              await new RunStore(db).logEvent(tenantId, runId, 'error',
                `${domain} sync failed: ${errorMessage}`, { domain });
            });
          } catch (logErr) {
            log.error('Failed to write run event:', logErr);
          }
          // Mark the domain failed (best-effort) before surfacing the error.
          // Email is no longer excluded: it now owns its status row like every
          // other domain, and a failed email pass that left the row reading
          // `in_progress` forever would be the same silence this job just
          // stopped telling about "last sync".
          try {
            await withTenant(pool, tenantId, async (db) => {
              await new PgMigrationStatusStore(db).markFailed(tenantId, mappingId, domain, errorMessage);
            });
          } catch (statusErr) {
            log.error('Failed to mark domain status failed:', statusErr);
          }
          // Re-throw so Trigger.dev records the failure (hard rule 9 — no masking).
          throw error;
        }
      }

      log.info('Delta sync completed successfully');

      await withTenant(pool, tenantId, async (db) => {
        await new RunStore(db).finishRun(runId, 'succeeded', { itemsProcessed, errors: 0 });
      });

      return {
        success: true,
        tenantId: typedPayload.tenantId,
        mappingId: typedPayload.mappingId,
        runId,
      };
    } catch (error) {
      // Close the run row as failed so history shows the failure instead of a
      // row stuck in `running` forever. Best-effort — never mask the real error.
      try {
        await withTenant(pool, tenantId, async (db) => {
          await new RunStore(db).finishRun(runId, 'failed', { itemsProcessed, errors: 1 });
        });
      } catch (finishErr) {
        log.error('Failed to close run row as failed:', finishErr);
      }
      throw error;
    }
  },
});
