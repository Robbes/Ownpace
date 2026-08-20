// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Cutover Preparation Job
 *
 * Runs the two things that must happen BEFORE a cutover can be approved:
 * - a final delta sync, so the target is current
 * - the §20 verification gate, which must PASS
 *
 * On success the mapping lands in READY_FOR_CUTOVER and stops there. Approving
 * and executing the cutover are separate, explicitly-approved operator actions
 * (`approve` / `execute` in the cutover CLI, both gated on `--yes`) — this job
 * never performs them. See docs/architecture/solution-architecture.md §11.2 and
 * AGENTS.md hard rule 2.
 *
 * It used to march straight through READY_FOR_CUTOVER → CUTOVER_IN_PROGRESS →
 * COMPLETED with a comment saying "in real implementation, this would be a
 * manual step". That is an approval bypass, and the state machine rejects it:
 * against a real Postgres the second transition throws "Invalid transition from
 * READY_FOR_CUTOVER to CUTOVER_IN_PROGRESS", so the job could never have
 * succeeded — it would have run the delta sync and verification, then failed and
 * marked the cutover FAILED.
 *
 * Trigger: Manual (user-initiated)
 */

import { z } from 'zod';
import { asTenantId, asMappingId } from '@openmig/shared';
import { schemaTask, logger } from '@trigger.dev/sdk';
import { CutoverStore, createLedgerVerificationReader } from '@openmig/ledger';
import {
  runShadowPass,
  runVerification,
  createRealVerificationDeps,
  type VerificationResult,
} from '@openmig/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schemaPg from '@openmig/ledger/schema-pg';
import { buildDepsFromMapping } from '@openmig/orchestration/build-deps-from-mapping';
import { buildTargetReindexers } from '@openmig/orchestration/build-reindexers';
import { log as appLog } from '@openmig/shared';

// Job input schema
const CutoverJobSchema = z.object({
  tenantId: z.string().uuid(),
  mappingId: z.string().uuid(),
  options: z.object({
    skipFinalSync: z.boolean().default(false),
    skipVerification: z.boolean().default(false),
    dnsDomain: z.string().optional(),
    targetMailServer: z.string().optional(),
  }).prefault({}),
});

type CutoverJobPayload = z.infer<typeof CutoverJobSchema>;

/** What `prepareCutover` reports back. */
export interface CutoverPreparationResult {
  /** True when the mapping is now READY_FOR_CUTOVER. */
  ready: boolean;
  /** The cutover state after this run. */
  state: string;
  finalSync?: { created: number; skipped: number };
  verification?: Pick<VerificationResult, 'overallStatus' | 'score' | 'totalDiscrepancies'>;
}

/**
 * Dependencies for the cutover preparation. Injected rather than constructed so
 * the job body can be driven against a real ledger in tests without a live
 * source/target.
 */
export interface CutoverPreparationDeps {
  tenantId: string;
  mappingId: string;
  cutoverStore: Pick<CutoverStore, 'initializeCutover' | 'loadCutoverState' | 'transitionState'>;
  /** Where progress goes. The Trigger.dev task passes the SDK's `logger`. */
  log: (message: string) => void;
  /** Final delta sync. Omit (or pass undefined) to skip it. */
  runFinalSync?: () => Promise<{ created: number; skipped: number }>;
  /** The §20 verification gate. Omit to skip it. */
  runGate?: () => Promise<VerificationResult>;
}

/**
 * Prepare a cutover: final sync, verification gate, stop at READY_FOR_CUTOVER.
 *
 * Throws on a failed gate — the caller marks the cutover FAILED. Never
 * transitions past READY_FOR_CUTOVER.
 */
export async function prepareCutover(
  deps: CutoverPreparationDeps,
): Promise<CutoverPreparationResult> {
  const tenantId = asTenantId(deps.tenantId);
  const mappingId = asMappingId(deps.mappingId);

  deps.log('Initializing cutover...');
  await deps.cutoverStore.initializeCutover({
    tenantId,
    mappingId,
    startedBy: 'trigger-job',
  });

  const result: CutoverPreparationResult = { ready: false, state: 'PREPARING' };

  if (deps.runFinalSync) {
    deps.log('Running final delta sync...');
    const delta = await deps.runFinalSync();
    result.finalSync = delta;
    deps.log(`Final delta sync: ${delta.created} created, ${delta.skipped} skipped`);
  } else {
    deps.log('Final delta sync SKIPPED at the caller\'s request.');
  }

  if (deps.runGate) {
    deps.log('Running verification checks...');
    const verification = await deps.runGate();
    result.verification = {
      overallStatus: verification.overallStatus,
      score: verification.score,
      totalDiscrepancies: verification.totalDiscrepancies,
    };
    deps.log(
      `Verification ${verification.overallStatus} (score ${verification.score.toFixed(3)}, ` +
        `${verification.totalItemsSource} source / ${verification.totalItemsTarget} target, ` +
        `${verification.totalDiscrepancies} discrepancies)`,
    );

    if (verification.overallStatus === 'FAIL' || !verification.canProceedToCutover) {
      // Surface the failure verbatim; the caller marks the cutover FAILED.
      throw new Error(
        `Cutover verification failed: status=${verification.overallStatus}, ` +
          `score=${verification.score.toFixed(3)}, discrepancies=${verification.totalDiscrepancies}. ` +
          verification.recommendations.join('; '),
      );
    }
  } else {
    // Skipping the gate is a caller decision, but it must never read as a pass.
    deps.log(
      'Verification SKIPPED at the caller\'s request — this cutover has NOT been verified.',
    );
  }

  const ready = await deps.cutoverStore.transitionState(tenantId, mappingId, 'READY_FOR_CUTOVER', {
    readyAt: new Date().toISOString(),
  });
  result.ready = true;
  result.state = ready.currentState ?? ready.state;

  // Deliberately the end of the road. Approval and execution are separate
  // operator actions; this job does not switch DNS and does not complete the
  // cutover (see the file header).
  deps.log('Cutover READY_FOR_CUTOVER — awaiting operator approval ("approve --yes", then "execute --yes").');

  return result;
}

// Register the job with Trigger.dev
export const runCutover = schemaTask({
  id: 'run-cutover',
  description: 'Cutover preparation (final sync + verification gate)',
  schema: CutoverJobSchema,
  run: async (payload: unknown) => {
    const { tenantId, mappingId, options } = payload as CutoverJobPayload;

    appLog.info('Starting cutover preparation', { tenantId, mappingId, options });

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('DATABASE_URL environment variable required');
    }
    const pool = new Pool({ connectionString: dbUrl });
    const db = drizzle(pool, { schema: schemaPg });
    const cutoverStore = new CutoverStore(db);

    try {
      return await prepareCutover({
        tenantId,
        mappingId,
        cutoverStore,
        // The SDK's `logger`, not `ctx.logger`: Trigger.dev v4's TaskRunContext
        // carries run metadata only (task/attempt/run/queue/environment/...) and
        // has no logger, so every `await ctx.logger.log(...)` in this file threw
        // "Cannot read properties of undefined (reading 'log')" on the FIRST
        // statement of the job — including the one in the catch block, which
        // then replaced the real error and skipped the FAILED transition.
        log: (message) => logger.info(message),
        runFinalSync: options.skipFinalSync
          ? undefined
          : async () => {
              const deps = await buildDepsFromMapping(pool, tenantId, mappingId);
              try {
                const delta = await runShadowPass(deps);
                return { created: delta.created, skipped: delta.skipped };
              } finally {
                await deps.close(); // release the deps' pool
              }
            },
        runGate: options.skipVerification
          ? undefined
          : async () => {
              const deps = await buildDepsFromMapping(pool, tenantId, mappingId);
              const targets = await buildTargetReindexers(pool, tenantId, mappingId);
              // Declared out here so `finally` can close it: it owns its own pool.
              const verificationReader = createLedgerVerificationReader({ connectionString: dbUrl });
              try {
                return await runVerification(
                  createRealVerificationDeps({
                    tenantId: asTenantId(tenantId),
                    mappingId: asMappingId(mappingId),
                    config: {
                      checksumSamplePercentage: 5,
                      minSampleSize: 10,
                      maxSampleSize: 1000,
                      requiredMatchPercentage: 0.99,
                      maxDiscrepancyPercentage: 0.01,
                      verifyMail: true,
                      verifyCalendar: true,
                      verifyContacts: true,
                      verifyFiles: true,
                    },
                    verificationReader,
                    // One reindexer per domain, each reading its own target.
                    // A domain with no reindexer is reported NOT_VERIFIABLE
                    // rather than measured against another domain's listing —
                    // which is what happened when a single (mail) reindexer was
                    // handed to all four, making every calendar/contact/file
                    // item look missing.
                    targetReindexers: targets.reindexers,
                  }),
                );
              } finally {
                await targets.close();
                await verificationReader.close(); // it opens its own pool
                await deps.close();
              }
            },
      });
    } catch (error) {
      const err = error as Error;
      appLog.error('Cutover preparation failed', { error: err.message });
      logger.error(`Cutover preparation failed: ${err.message}`);

      // Record the failure. Best-effort: a mapping with no cutover row (the very
      // first step failed) has nothing to transition, and that must not mask the
      // real error.
      try {
        await cutoverStore.transitionState(asTenantId(tenantId), asMappingId(mappingId), 'FAILED', {
          failedAt: new Date().toISOString(),
          failureReason: err.message,
        });
      } catch (transitionErr) {
        appLog.error('Could not mark cutover FAILED', { error: transitionErr });
      }

      throw error;
    } finally {
      // Always release the Postgres pool (never leak it across job runs).
      await pool.end();
    }
  },
});
