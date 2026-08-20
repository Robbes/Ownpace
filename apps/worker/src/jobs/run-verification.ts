// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Verification Job (workplan 0017 T3, managed edition)
 *
 * The managed half of the §20 start + poll pair. The API's
 * `POST .../verify/start` inserts a `running` row in `verification_run` and
 * enqueues this; the job runs the SAME gate the cutover job runs — counts and
 * samples per enabled domain, one reindexer per domain, read-only against the
 * target — and lands the outcome on that row: `done` with the wire-shaped
 * report as jsonb, or `failed` with the reason. `GET .../verify/report` then
 * serves the row. Target I/O stays in the worker, which is the whole reason
 * this pair exists: the API must never hold connector credentials for the
 * minutes a scan takes (ADR-0026's deliberate gap, closed here).
 *
 * The verification wiring is lifted from `run-cutover.ts`'s gate rather than
 * shared with it yet — the cutover job consumes the result inline where this
 * one persists it, and folding both into one helper is worth doing only when
 * a third caller appears.
 *
 * Trigger: manual (API-initiated).
 */

import { z } from 'zod';
import { schemaTask, logger } from '@trigger.dev/sdk';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { asTenantId, asMappingId } from '@openmig/shared';
import { createLedgerVerificationReader, withTenant } from '@openmig/ledger';
import * as schemaPg from '@openmig/ledger/schema-pg';
import { runVerification, createRealVerificationDeps } from '@openmig/core';
import type { VerificationResult } from '@openmig/shared';
import { enabledDomains } from '@openmig/orchestration/enabled-domains';
import { buildTargetReindexers } from '@openmig/orchestration/build-reindexers';

const VerificationJobSchema = z.object({
  tenantId: z.string().uuid(),
  mappingId: z.string().uuid(),
  /** The `verification_run` row the API created; this job owns its outcome. */
  runId: z.string().uuid(),
});

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

const pool = new Pool({ connectionString: DATABASE_URL });

/** Mark the run terminal. One place, so done and failed cannot diverge on shape. */
async function landRun(
  tenantId: string,
  runId: string,
  outcome:
    | { state: 'done'; report: Record<string, VerificationResult> }
    | { state: 'failed'; error: string },
): Promise<void> {
  await withTenant(pool, tenantId, async (db) => {
    await db
      .update(schemaPg.verificationRun)
      .set({
        state: outcome.state,
        finishedAt: new Date(),
        ...(outcome.state === 'done' ? { report: outcome.report } : { error: outcome.error }),
      })
      .where(eq(schemaPg.verificationRun.id, runId));
  });
}

export const runVerificationTask = schemaTask({
  id: 'run-verification',
  schema: VerificationJobSchema,
  run: async (payload) => {
    const { tenantId, mappingId, runId } = payload;
    logger.info(`[run-verification] ${mappingId}: scan starting (run ${runId})`);

    try {
      // Which domains the owner actually selected. The verify flags below
      // come from here so a domain the mapping does not migrate reports
      // SKIPPED ("your call, nobody checked") instead of NOT_VERIFIABLE
      // (which blocks cutover) — and so this job never touches connector
      // config for a domain the mapping does not have.
      //
      // A mail-deps build used to sit here too, consumed by NOTHING (built,
      // closed, never passed on) — dead wiring that threw on any mapping
      // whose source is not IMAP, found live on the DAV-only demo tenant
      // (0018 T5, 2026-08-01).
      const enabled = await enabledDomains(pool, tenantId, mappingId);

      // One reindexer per domain (a domain with no reindexer reports
      // NOT_VERIFIABLE rather than being measured against another domain's
      // listing), and a ledger reader that owns its pool and must be closed.
      const targets = await buildTargetReindexers(pool, tenantId, mappingId);
      const verificationReader = createLedgerVerificationReader({
        connectionString: DATABASE_URL,
      });
      let result: VerificationResult;
      try {
        result = await runVerification(
          createRealVerificationDeps({
            tenantId: asTenantId(tenantId),
            mappingId: asMappingId(mappingId),
            config: {
              checksumSamplePercentage: 5,
              minSampleSize: 10,
              maxSampleSize: 1000,
              requiredMatchPercentage: 0.99,
              maxDiscrepancyPercentage: 0.01,
              verifyMail: enabled.has('email'),
              verifyCalendar: enabled.has('calendar'),
              verifyContacts: enabled.has('contact'),
              verifyFiles: enabled.has('file'),
            },
            verificationReader,
            targetReindexers: targets.reindexers,
          }),
        );
      } finally {
        await targets.close();
        await verificationReader.close(); // it opens its own pool
      }

      // Keyed by mappingId: the contract's ByMapping shape with one key, the
      // same one the appliance uses, so the UI iterates identically.
      await landRun(tenantId, runId, { state: 'done', report: { [mappingId]: result } });
      logger.info(
        `[run-verification] ${mappingId}: ${result.overallStatus} ` +
          `(score ${result.score.toFixed(3)}, ${result.totalDiscrepancies} discrepancies)`,
      );
      return { runId, overallStatus: result.overallStatus };
    } catch (err) {
      // The RUN failed — carried onto the row with its reason, never left
      // 'running' forever and never silently dropped (hard rule 9). A domain
      // that merely could not be read is NOT_VERIFIABLE inside a done report;
      // this branch is the scan itself crashing.
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[run-verification] ${mappingId}: scan failed: ${message}`);
      await landRun(tenantId, runId, { state: 'failed', error: message });
      throw err;
    }
  },
});
