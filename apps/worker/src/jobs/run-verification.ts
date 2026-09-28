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

// The rule for a host a tenant gives us, on before this run connects anywhere (0136 T1).
import './refuse-internal-addresses.ts';
import { z } from 'zod';
import { schemaTask } from '@trigger.dev/sdk';
import { leavesAReference } from './what-a-run-leaves.ts';
import { eq } from 'drizzle-orm';
import { asTenantId, asMappingId, log } from '@openmig/shared';
import { withTenant } from '@openmig/ledger';
import { openTaskPools } from './task-pools.ts';
import * as schemaPg from '@openmig/ledger/schema-pg';
import { runVerification, createRealVerificationDeps } from '@openmig/core';
import type { VerificationResult } from '@openmig/shared';
import { enabledDomains, stoppedDomains } from '@openmig/orchestration/enabled-domains';
import { ledgerReaderFor, verificationConfigFor } from './cutover-gate.ts';
import { buildTargetReindexers } from '@openmig/orchestration/build-reindexers';

const VerificationJobSchema = z.object({
  tenantId: z.string().uuid(),
  mappingId: z.string().uuid(),
  /** The `verification_run` row the API created; this job owns its outcome. */
  runId: z.string().uuid(),
});

// Its pools, from the one module that builds a per-tenant task's (0138 T1):
// the tenant pool on APP_DATABASE_URL, app_user, under row security, and the
// audit key's pool of one on the owner's URL. It points this process's sinks
// too: the operator's log page (0129 T1) at the tenant pool, the audit lines
// (0129 T4) at the key's pool, the one read app_user may not make.
const { tenant: pool } = openTaskPools();

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
  run: leavesAReference('run-verification', async (payload) => {
    const { tenantId, mappingId, runId } = payload;
    log.info(`[run-verification] ${mappingId}: scan starting (run ${runId})`);

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
      // And those its owner stopped (0128 T4, D6): skipped, *stopped by you*.
      const stopped = await stoppedDomains(pool, tenantId, mappingId);

      // One reindexer per domain (a domain with no reindexer reports
      // NOT_VERIFIABLE rather than being measured against another domain's
      // listing), and a ledger reader on this job's pool, each read in the
      // tenant's scope (0138 T1 parts 2 and 3).
      const targets = await buildTargetReindexers(pool, tenantId, mappingId);
      const verificationReader = ledgerReaderFor(pool, tenantId);
      let result: VerificationResult;
      try {
        result = await runVerification(
          createRealVerificationDeps({
            tenantId: asTenantId(tenantId),
            mappingId: asMappingId(mappingId),
            // The gate's own configuration, as the cutover asks it: the
            // selected data types, less those their owner stopped.
            config: verificationConfigFor(enabled, stopped),
            verificationReader,
            targetReindexers: targets.reindexers,
          }),
        );
      } finally {
        await targets.close();
        await verificationReader.close(); // leaves the job's pool open
      }

      // Keyed by mappingId: the contract's ByMapping shape with one key, the
      // same one the appliance uses, so the UI iterates identically.
      await landRun(tenantId, runId, { state: 'done', report: { [mappingId]: result } });
      log.info(
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
      log.error(`[run-verification] ${mappingId}: scan failed: ${message}`);
      await landRun(tenantId, runId, { state: 'failed', error: message });
      throw err;
    }
  }),
});
