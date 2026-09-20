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
 * It also used to fail its own second run. `initializeCutover` returns the
 * existing row untouched, and the job then wrote READY_FOR_CUTOVER
 * unconditionally — an edge the machine does not have out of
 * READY_FOR_CUTOVER. So the second press of "prepare" on a cutover that was
 * ready threw, the catch below marked it FAILED (that edge exists), and every
 * one of Trigger.dev's default three attempts then found FAILED, where the
 * same write is invalid too: a ready cutover, prepared twice, was a failed
 * one that nothing could retry. Now the job reads the ledger first and follows
 * `prepareTransition` (`@openmig/core`, a view of the state machine): no
 * ledger → create it; PREPARING or APPROVED → prepare (an approval is revoked
 * at the end, as the recorded APPROVED → READY_FOR_CUTOVER it always was);
 * READY_FOR_CUTOVER or FAILED → record the way back to PREPARING first, then
 * prepare, so the trail shows the second attempt; a cutover under way or a
 * closed ledger → refuse, and write nothing. A refusal is not a failed
 * cutover and a gate verdict is not a fault, so neither is retried
 * (`preparationFailurePolicy`).
 *
 * Trigger: Manual (user-initiated)
 */

import { z } from 'zod';
import { asTenantId, asMappingId } from '@openmig/shared';
import { AbortTaskRunError, schemaTask, logger } from '@trigger.dev/sdk';
import { CutoverStore, createLedgerVerificationReader } from '@openmig/ledger';
import {
  CutoverRefused,
  prepareTransition,
  runShadowPass,
  runVerification,
  createRealVerificationDeps,
  type CutoverState,
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
  /** The cutover state this run found — undefined when it created the ledger. */
  from?: CutoverState;
  /**
   * How many times the ledger has entered PREPARING, counted from the trail
   * after this run's own reset (if any) — the same count the CLI's
   * `start-cutover` reports as "attempt N". 1 for a first preparation.
   */
  attempt: number;
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
  cutoverStore: Pick<
    CutoverStore,
    'initializeCutover' | 'loadCutoverState' | 'transitionState' | 'getEventHistory'
  >;
  /** Where progress goes. The Trigger.dev task passes the SDK's `logger`. */
  log: (message: string) => void;
  /** Final delta sync. Omit (or pass undefined) to skip it. */
  runFinalSync?: () => Promise<{ created: number; skipped: number }>;
  /** The §20 verification gate. Omit to skip it. */
  runGate?: () => Promise<VerificationResult>;
}

/**
 * The §20 gate said no. A verdict, not a fault: the task records FAILED and
 * does not try again — three attempts would run three final syncs and three
 * verifications to be told the same thing, and leave three FAILED entries.
 */
export class CutoverGateFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CutoverGateFailed';
  }
}

/**
 * What the task does with an error thrown by `prepareCutover`. Pure, so the
 * catch block's three answers are pinned without a Trigger.dev runtime.
 *
 * - A refusal (`CutoverRefused`) prepared nothing and wrote nothing: not a
 *   failed cutover, so it is not recorded as one, and not worth another
 *   attempt — the ledger would say the same thing.
 * - A gate verdict (`CutoverGateFailed`) is recorded as FAILED, once.
 * - Anything else — the source unreachable mid-sync, the ledger away — is
 *   recorded as FAILED and retried; the retry finds FAILED and
 *   `prepareTransition` takes it back to PREPARING, so the retry converges.
 */
export function preparationFailurePolicy(error: unknown): {
  readonly recordFailed: boolean;
  readonly retry: boolean;
} {
  if (error instanceof CutoverRefused) return { recordFailed: false, retry: false };
  if (error instanceof CutoverGateFailed) return { recordFailed: true, retry: false };
  return { recordFailed: true, retry: true };
}

/**
 * Prepare a cutover: final sync, verification gate, stop at READY_FOR_CUTOVER.
 *
 * Reads the ledger first and follows `prepareTransition`, so a second run
 * converges: a ready cutover is re-verified and ready again, a failed attempt
 * is retried, and a cutover under way or a closed ledger is refused with
 * nothing written. Throws `CutoverGateFailed` on a failed gate (the task
 * records FAILED) and `CutoverRefused` when there is nothing to prepare (the
 * task records nothing). Never transitions past READY_FOR_CUTOVER.
 */
export async function prepareCutover(
  deps: CutoverPreparationDeps,
): Promise<CutoverPreparationResult> {
  const tenantId = asTenantId(deps.tenantId);
  const mappingId = asMappingId(deps.mappingId);

  // Read before anything is written, and decide from what is there.
  const existing = await deps.cutoverStore.loadCutoverState(tenantId, mappingId);
  const decision = prepareTransition(existing ? (existing.currentState ?? existing.state) : undefined);

  if ('refuse' in decision) {
    deps.log(`${decision.refuse} ${decision.hint}`);
    throw new CutoverRefused(decision.refuse, decision.hint);
  }

  let attempt = 1;
  let from: CutoverState | undefined;
  if ('initialize' in decision) {
    deps.log('Initializing cutover...');
    await deps.cutoverStore.initializeCutover({
      tenantId,
      mappingId,
      startedBy: 'trigger-job',
    });
  } else {
    from = decision.from;
    // Counted from the trail, the way start-cutover counts it: every entry
    // into PREPARING is an attempt at preparation.
    const events = await deps.cutoverStore.getEventHistory(tenantId, mappingId);
    const entries = events.filter((e) => e.toState === 'PREPARING').length;
    if (decision.resetFirst) {
      attempt = entries + 1;
      const reason =
        decision.from === 'FAILED'
          ? `Retrying the preparation after a failed attempt (attempt ${attempt})`
          : 'Re-preparing: the final sync and the gate run again, so the earlier ready ' +
            `verdict no longer describes the data (attempt ${attempt})`;
      await deps.cutoverStore.transitionState(tenantId, mappingId, 'PREPARING', {
        retriedBy: 'trigger-job',
        retriedAt: new Date().toISOString(),
        attempt,
        reason,
      });
      deps.log(`Cutover ${decision.from} -> PREPARING (attempt ${attempt}): ${reason}.`);
    } else {
      attempt = Math.max(entries, 1);
      deps.log(`Cutover ledger exists (${decision.from}); preparing (attempt ${attempt}).`);
    }
  }

  const result: CutoverPreparationResult = { ready: false, state: 'PREPARING', from, attempt };

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
      // Surface the failure verbatim; the task marks the cutover FAILED, once.
      throw new CutoverGateFailed(
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

  // Valid from PREPARING and from APPROVED — the two states a `prepare`
  // decision leaves the ledger in — so no state check is needed here: the
  // decision above already made this edge exist.
  const ready = await deps.cutoverStore.transitionState(tenantId, mappingId, 'READY_FOR_CUTOVER', {
    readyAt: new Date().toISOString(),
    verifiedBy: 'trigger-job',
    attempt,
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
                      verifyTasks: true,
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
      const policy = preparationFailurePolicy(error);

      if (!policy.recordFailed) {
        // Nothing was prepared and nothing was written — see the policy.
        const hint = error instanceof CutoverRefused && error.hint ? ` ${error.hint}` : '';
        appLog.warn('Cutover preparation refused', { tenantId, mappingId, reason: err.message });
        logger.warn(`Cutover preparation refused: ${err.message}${hint}`);
        throw new AbortTaskRunError(err.message);
      }

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

      // A verdict is an answer; a fault is worth another go (and the retry
      // converges: it finds FAILED and takes it back to PREPARING).
      if (!policy.retry) throw new AbortTaskRunError(err.message);
      throw error;
    } finally {
      // Always release the Postgres pool (never leak it across job runs).
      await pool.end();
    }
  },
});
