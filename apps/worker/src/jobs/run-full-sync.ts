// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Full Sync Job
 *
 * Performs a complete sync of all data for a mapping.
 * This job is typically run:
 * - Initially when a new mapping is created
 * - After a rollback
 * - On-demand for re-sync
 *
 * Trigger: Manual or Scheduled (infrequent)
 *
 * DIFFERENCE FROM DELTA-SYNC:
 * - Full sync: Does NOT use cursors, scans ALL items from scratch
 * - Delta sync: Uses stored cursors, only scans items changed since last sync
 * 
 * Implementation: Pass undefined for cursors to runShadowPass, forcing a full scan.
 */

import { z } from 'zod';
import { schemaTask } from '@trigger.dev/sdk';
import { Pool } from 'pg';
import { runShadowPass } from '@openmig/core';
import type { TenantId, MappingId } from '@openmig/shared';
import { buildDepsFromMapping } from '@openmig/orchestration/build-deps-from-mapping';
import { withTenant, RunStore } from '@openmig/ledger';
import { PgBytesMovedStore } from '@openmig/managed';
import { log } from '@openmig/shared';

// Job input schema
const FullSyncJobSchema = z.object({
  tenantId: z.string().uuid(),
  mappingId: z.string().uuid(),
  options: z.object({
    maxItems: z.number().optional(),
    forceFullScan: z.boolean().default(true), // Always force full scan for full-sync job
  }).prefault({}),
});

type FullSyncJobPayload = z.infer<typeof FullSyncJobSchema>;

// Database connection from environment
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Create a persistent pool for jobs
const pool = new Pool({ connectionString: DATABASE_URL });

// Register the job with Trigger.dev
export const runFullSync = schemaTask({
  id: 'run-full-sync',
  description: 'Full Sync',
  schema: FullSyncJobSchema,
  run: async (payload: unknown, context) => {
    // Type assertion since schemaTask validates the payload
    const typedPayload = payload as FullSyncJobPayload;
    
    // SECURITY: Fail closed if tenantId missing
    if (!typedPayload.tenantId) {
      throw new Error('tenantId is required in job payload');
    }

    log.info('Starting full sync', {
      tenantId: typedPayload.tenantId,
      mappingId: typedPayload.mappingId,
      options: typedPayload.options,
    });

    try {
      const tenantId = typedPayload.tenantId as TenantId;
      const mappingId = typedPayload.mappingId as MappingId;

      // Open the run-ledger row up front so an in-flight run is visible and a
      // crash leaves a `running` row rather than no trace at all.
      // The orchestrator's own id for this run — see the note in
      // run-delta-sync.ts. Absent rather than wrong if the shape changes: an
      // absent handle degrades to the erasure quiesce's age-based path, a wrong
      // one would point it at somebody else's run.
      const contextRunId = (context as { ctx?: { run?: { id?: unknown } } } | undefined)?.ctx?.run
        ?.id;
      const orchestratorRef = typeof contextRunId === 'string' ? contextRunId : undefined;
      const runId = await withTenant(pool, tenantId, async (db) =>
        new RunStore(db).startRun({
          tenantId,
          mappingId,
          kind: 'initial_copy',
          trigger: 'manual',
          ...(orchestratorRef ? { orchestratorRef } : {}),
        }),
      );

      // SECURITY: Build deps with tenant scoping (RLS enforced)
      // Note: For full sync, we intentionally pass undefined for cursors
      // to force a complete rescan of all items
      const deps = await buildDepsFromMapping(pool, tenantId, mappingId);
      try {
        // Run the full shadow pass (without cursors = full scan)
        const result = await runShadowPass({
          ...deps,
          cursors: undefined, // Force full scan by not using cursors
        });

        log.info(`Full sync completed: ${result.scanned} scanned, ${result.created} created, ${result.skipped} skipped`);

        // The data axis (0109 T3): same flush as run-delta-sync — the
        // engine's neutral statistic, persisted only by this managed runner.
        const firstCopyBytes = result.firstCopyBytes ?? 0;
        if (firstCopyBytes > 0) {
          await withTenant(pool, tenantId, async (db) => {
            await new PgBytesMovedStore(db).add(tenantId, firstCopyBytes);
          });
        }

        await withTenant(pool, tenantId, async (db) => {
          const runs = new RunStore(db);
          await runs.logEvent(tenantId, runId, 'info',
            `full sync: ${result.scanned} scanned, ${result.created} created, ${result.skipped} skipped`,
            { scanned: result.scanned, created: result.created, skipped: result.skipped });
          await runs.finishRun(runId, 'succeeded', {
            itemsProcessed: result.created + result.skipped,
            errors: 0,
          });
        });

        return {
          success: true,
          tenantId: typedPayload.tenantId,
          mappingId: typedPayload.mappingId,
          scanned: result.scanned,
          created: result.created,
          skipped: result.skipped,
          runId,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        // Record the failure verbatim, then close the run as failed so history
        // shows it rather than leaving a row stuck in `running`. Both are
        // best-effort: a logging failure must not replace the real error.
        try {
          await withTenant(pool, tenantId, async (db) => {
            const runs = new RunStore(db);
            await runs.logEvent(tenantId, runId, 'error', `full sync failed: ${errorMessage}`);
            await runs.finishRun(runId, 'failed', { itemsProcessed: 0, errors: 1 });
          });
        } catch (bookkeepingErr) {
          log.error('Failed to record run failure:', bookkeepingErr);
        }
        throw error;
      } finally {
        // Release the deps' Postgres pool (never leak it across runs).
        await deps.close();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.error('Full sync failed:', errorMessage);
      throw error;
    }
  },
});
