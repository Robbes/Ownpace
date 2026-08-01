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
import { buildDepsFromMapping, buildDomainDepsFromMapping } from '../build-deps-from-mapping';
import {
  withTenant,
  PgMigrationStatusStore,
  RunStore,
  recordComputeForRun,
  recordApiCallForRun,
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

// Pricing configuration (should come from config/env in production)
const PRICING = {
  computePricePerHour: 5, // €0.05/hour
};

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

    // Perform delta sync for each domain
    const domains = typedPayload.domains ?? ['email', 'calendar', 'contact', 'file'];
    const tenantId = typedPayload.tenantId as TenantId;
    const mappingId = typedPayload.mappingId as MappingId;
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
      for (const domain of domains) {
        log.info(`Running delta sync for domain: ${domain}`);

        try {
          if (domain === 'email') {
            // SECURITY: Build deps with tenant scoping (RLS enforced).
            // buildDepsFromMapping wraps all DB ops in withTenant() and manages
            // the email domain's migration_status itself.
            const deps = await buildDepsFromMapping(pool, tenantId, mappingId);
            try {
              const result = await runShadowPass(deps);
              itemsProcessed += result.created + result.skipped;
              log.info(`Mail sync completed: ${result.created} created, ${result.skipped} skipped`);
              await withTenant(pool, tenantId, async (db) => {
                await new RunStore(db).logEvent(tenantId, runId, 'info',
                  `email: ${result.created} created, ${result.skipped} skipped`,
                  { domain: 'email', created: result.created, skipped: result.skipped });
              });
            } finally {
              // Release the deps' Postgres pool (never leak it across runs).
              await deps.close();
            }
          } else {
            // Native DAV domains (calendar/contact/file) via the generalized
            // domain-sync loop. Track migration_status explicitly (mirrors the
            // worker's runAllDomains) so status pages + metering see the run.
            await withTenant(pool, tenantId, async (db) => {
              await new PgMigrationStatusStore(db).markInProgress(tenantId, mappingId, domain);
            });
            // Build + run + release the deps' pool per domain. Literal domain
            // args pick the right overload; the finally never leaks the pool.
            let result: { created: number; skipped: number };
            if (domain === 'calendar') {
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
          }

          // Metering (all domains): record compute + one sync op from the run's
          // migration_status timing. Guarded — skips cleanly if status is absent.
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
              }, PRICING);
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
          if (domain !== 'email') {
            try {
              await withTenant(pool, tenantId, async (db) => {
                await new PgMigrationStatusStore(db).markFailed(tenantId, mappingId, domain, errorMessage);
              });
            } catch (statusErr) {
              log.error('Failed to mark domain status failed:', statusErr);
            }
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
