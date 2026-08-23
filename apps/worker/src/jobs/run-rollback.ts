// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Rollback Job
 *
 * Reverts a migration to its previous state: reactivates the mapping so
 * shadow sync resumes with the original source authoritative, and marks the
 * cutover ROLLED_BACK. DNS restore is deferred (verify-only DNS — the
 * operator reverts MX manually).
 *
 * WHAT A ROLLBACK IS, decided by the owner 2026-08-23 and written here because
 * this file is where somebody would otherwise build the other thing:
 *
 *   A rollback is a SETBACK. It puts the migration back to syncing, with the
 *   original source live again, and that is all of it.
 *
 *   It NEVER swaps source and target. The mapping's direction is untouched —
 *   after a rollback the sync runs source -> target exactly as before, because
 *   the source is authoritative again and the target is once more the copy.
 *
 *   It NEVER salvages from the target. Anything delivered to the target while
 *   MX pointed there stays on the target. Pulling it back would mean writing to
 *   a source this product only ever reads, and a migration tool that writes to
 *   somebody's live source on an emergency path is not one to trust with the
 *   emergency. The operator is TOLD about that mail rather than surprised by it
 *   (see the notice below); recovering it is theirs to decide.
 *
 * `notifyUsers` is REAL as of workplan 0030 T4: when SMTP is configured, it
 * sends the rollback notice through the same channel every other event uses.
 * When it is NOT configured, `notifyUsers: true` is still refused BEFORE any
 * rollback action — the 0026 T1 shape, now with a different reason. Asking to
 * tell people and being told nothing happened is recoverable; believing they
 * were told when the channel was never configured is not (hard rule 9).
 *
 * Trigger: Manual (user-initiated)
 */

import { z } from 'zod';
import { schemaTask, logger } from '@trigger.dev/sdk';
import { CutoverStore } from '@openmig/ledger';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import { Pool } from 'pg';
import * as schemaPg from '@openmig/ledger/schema-pg';
import { asTenantId, asMappingId, renderEvent } from '@openmig/shared';
import { log } from '@openmig/shared';
import { notifierFromEnv } from '@openmig/connectors';

// Job input schema
const RollbackJobSchema = z.object({
  tenantId: z.string().uuid(),
  mappingId: z.string().uuid(),
  reason: z.string(),
  options: z.object({
    restoreDns: z.boolean().default(true),
    // Still FALSE by default, now for a different reason. It once defaulted
    // `true` and was "handled" by a warn-and-skip — an API shape promising a
    // capability that did not exist (0026 T1 item 3). The capability exists
    // now (0030 T4), but a rollback is an emergency action and mail to every
    // configured recipient is not something to do because nobody said not
    // to. Opting in is one word; un-sending is impossible.
    notifyUsers: z.boolean().default(false),
    dnsDomain: z.string().optional(),
  }).prefault({}),
});

type RollbackJobPayload = z.infer<typeof RollbackJobSchema>;

// Register the job with Trigger.dev
export const runRollback = schemaTask({
  id: 'run-rollback',
  description: 'Rollback',
  schema: RollbackJobSchema,
  run: async (payload: unknown) => {
    const typedPayload = payload as RollbackJobPayload;
    const { tenantId, mappingId, reason, options } = typedPayload;
    
    // Built here, before any rollback action, for one reason: if the channel
    // is not configured, the caller finds out while everything is still
    // untouched and can resubmit without the flag. Discovering it AFTER the
    // rollback would leave a system that had been rolled back and nobody
    // told — the state 0026 T1 called out and rule 9 forbids.
    const channel = notifierFromEnv(process.env, (m) => log.warn(m));
    if (options.notifyUsers && !channel.config.enabled) {
      throw new Error(
        `notifyUsers: true was requested, but no notification channel is configured: ` +
          `${channel.config.reason}. Configure SMTP or resubmit without the flag — ` +
          'the rollback itself has not run.',
      );
    }

    log.info('Starting rollback process', {
      tenantId,
      mappingId,
      reason,
      options,
    });

    // Initialize database
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('DATABASE_URL environment variable required');
    }
    const pool = new Pool({ connectionString: dbUrl });
    const db = drizzle(pool, { schema: schemaPg });
    const cutoverPersistence = new CutoverStore(db);

    try {
      // Step 0: Load current cutover state
      const state = await cutoverPersistence.loadCutoverState(asTenantId(tenantId), asMappingId(mappingId));
      if (!state) {
        throw new Error('No cutover state found - nothing to rollback');
      }
      
      // `logger` from the SDK, not `ctx.logger`: Trigger.dev v4's TaskRunContext
      // carries run metadata only and has no logger, so this line used to throw
      // "Cannot read properties of undefined (reading 'log')" — the first thing
      // the job did after loading state, on every run.
      logger.info(`Rolling back cutover from state: ${state.currentState || state.state}`);
      logger.info(`Reason: ${reason}`);

      // Step 1: DNS is DEFERRED by owner decision (verify-only DNS, 2026-07-16 —
      // deSEC provider writes not implemented). Do not claim a restore that did
      // not happen; the operator reverts the MX record manually.
      if (options.restoreDns && options.dnsDomain) {
        logger.warn(
          `DNS restore for ${options.dnsDomain} is DEFERRED (verify-only DNS) — revert the MX record manually.`,
        );
      }

      // Step 2: Reactivate the mapping so shadow sync resumes with the original
      // source authoritative again (the real, in-scope rollback action).
      log.info('Reactivating mapping (status → active)');
      logger.info('Reactivating mapping so shadow sync resumes...');
      await db
        .update(schemaPg.mailboxMapping)
        .set({ status: 'active', updatedAt: new Date() })
        .where(
          and(
            eq(schemaPg.mailboxMapping.id, mappingId),
            eq(schemaPg.mailboxMapping.tenantId, tenantId),
          ),
        );

      // Step 3: Update cutover status to ROLLED_BACK
      log.info('Marking cutover as rolled back');
      await cutoverPersistence.transitionState(asTenantId(tenantId), asMappingId(mappingId), 'ROLLED_BACK', {
        rolledBackAt: new Date().toISOString(),
        rolledBackBy: 'trigger-job',
        rollbackReason: reason,
      });
      logger.info('Cutover marked as rolled back');

      // THE ONE THING A ROLLBACK CANNOT GIVE BACK, said out loud rather than
      // left for somebody to discover from a customer. While MX pointed at the
      // target, mail was delivered THERE. The sync that just resumed runs
      // source -> target, so it will never carry those messages back, and by
      // the decision in this file's header it is not going to try. An operator
      // who is not told this believes a rollback restored a state it did not.
      logger.warn(
        'Mail delivered to the TARGET while MX pointed at it stays on the target. ' +
          'The resumed sync runs source -> target and will not bring it back. ' +
          'Recover it from the target by hand if you need it.',
      );

      // Tell people, if asked to (workplan 0030 T4). AFTER the rollback, so
      // the mail only ever describes something that actually happened, and
      // guarded, so a mail server that is down cannot undo a rollback that
      // succeeded: the failed SEND is logged loudly and the job still
      // reports success, because the rollback IS complete. A thrown error
      // here would tell the operator their rollback failed when it did not.
      if (options.notifyUsers) {
        try {
          await channel.notifier.notify(
            renderEvent({ kind: 'rollback_finished', mappingId, reason }, channel.locale),
          );
          logger.info('Rollback notification sent');
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.error('Rollback notification FAILED to send', { error: message });
          logger.error(
            `The rollback succeeded but its notification did not send: ${message}. ` +
              'Nobody has been told — tell them by hand.',
          );
        }
      }

      // There is deliberately no "cancel the pending grace-period task" step.
      // It used to call `ctx.cancel({ id: 'grace-period-<mapping>' })` — two
      // things wrong with that: TaskRunContext has no `cancel`, and the task it
      // claimed to cancel (`run-grace-period-end`, scheduled by the old cutover
      // job) does not exist anywhere in this repo. Grace-period monitoring is
      // not implemented, so there is nothing pending to cancel.

      log.info('Rollback completed successfully');
      logger.info('Rollback completed successfully');

      return {
        success: true,
        tenantId,
        mappingId,
        reason,
        rolledBackAt: new Date().toISOString(),
      };
    } catch (error) {
      const err = error as Error;
      log.error('Rollback failed', { error: err.message });
      logger.error(`Rollback failed: ${err.message}`);

      // Try to log the failure even if rollback failed
      try {
        await cutoverPersistence.transitionState(asTenantId(tenantId), asMappingId(mappingId), 'FAILED', {
          failedAt: new Date().toISOString(),
          failureReason: `Rollback failed: ${err.message}`,
        });
      } catch (rollbackError) {
        log.error('Failed to update cutover status after rollback failure', { error: rollbackError });
      }

      throw error;
    } finally {
      // Always release the Postgres pool (never leak it across job runs).
      await pool.end();
    }
  },
});
