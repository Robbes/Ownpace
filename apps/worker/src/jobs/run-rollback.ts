// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Rollback Job — a caller of `performRollback` (ADR-0047), nothing more.
 *
 * WHAT A ROLLBACK IS, decided by the owner 2026-08-23:
 *
 *   A rollback is a SETBACK. It puts the migration back to syncing, with the
 *   original source live again, and that is all of it. It NEVER swaps source
 *   and target. It NEVER salvages from the target — mail delivered there while
 *   MX pointed at it stays there, because pulling it back would mean writing
 *   to a source this product only ever reads.
 *
 * For a month this file was one of two rollbacks: it reactivated the mapping
 * and marked the ledger, and nothing called it; the operator CLI marked the
 * ledger and left the mapping stopped. The setback now lives once, in
 * `@openmig/core`, and this job hands it a store, the mapping port, and —
 * when asked — a notification. Nothing here decides anything.
 *
 * `notifyUsers` is REAL as of workplan 0030 T4: when SMTP is configured, it
 * sends the rollback notice through the same channel every other event uses.
 * When it is NOT configured, `notifyUsers: true` is still refused BEFORE any
 * rollback action — the 0026 T1 shape, now with a different reason. Asking to
 * tell people and being told nothing happened is recoverable; believing they
 * were told when the channel was never configured is not (hard rule 9).
 *
 * DNS restore is deferred (verify-only DNS — the operator reverts MX by hand).
 *
 * Trigger: Manual (user-initiated) — the Trigger.dev dashboard. No API route
 * enqueues it, on purpose: the API is prepare-only for cutovers, and nothing
 * there executes one either (workplan 0101 T5).
 */

import { z } from 'zod';
import { schemaTask, logger } from '@trigger.dev/sdk';
import { tenantCutoverStore, mappingLifecyclePort } from '@openmig/ledger';
import { performRollback, RollbackRefused } from '@openmig/core';
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
    // The cutover ledger is row-secured since migration 0055: every call
    // inside `withTenant`, or a non-superuser session reads nothing.
    const cutoverPersistence = tenantCutoverStore(pool, asTenantId(tenantId));

    try {
      // DNS is DEFERRED by owner decision (verify-only DNS, 2026-07-16). Do
      // not claim a restore that did not happen; the operator reverts the MX
      // record manually.
      if (options.restoreDns && options.dnsDomain) {
        logger.warn(
          `DNS restore for ${options.dnsDomain} is DEFERRED (verify-only DNS) — revert the MX record manually.`,
        );
      }

      const outcome = await performRollback({
        tenantId: asTenantId(tenantId),
        mappingId: asMappingId(mappingId),
        cutoverStore: cutoverPersistence,
        mapping: mappingLifecyclePort(pool, tenantId, mappingId, 'trigger-job'),
        rolledBackBy: 'trigger-job',
        reason,
        // `logger` from the SDK, not `ctx.logger`: Trigger.dev v4's
        // TaskRunContext carries run metadata only and has no logger.
        log: (message) => logger.info(message),
        ...(options.notifyUsers
          ? {
              notify: async () => {
                // What the customer called it, read at send time. They know
                // this migration as "Gmail to Nextcloud"; the UUID appears on
                // no screen they have ever seen (owner report, 2026-09-14).
                // `name` is nullable and `mappingLabel` falls back to the id,
                // so a migration nobody named still sends.
                const [row] = await db
                  .select({ name: schemaPg.mailboxMapping.name })
                  .from(schemaPg.mailboxMapping)
                  .where(
                    and(
                      eq(schemaPg.mailboxMapping.id, mappingId),
                      eq(schemaPg.mailboxMapping.tenantId, tenantId),
                    ),
                  )
                  .limit(1);
                await channel.notifier.notify(
                  renderEvent(
                    { kind: 'rollback_finished', mapping: { id: mappingId, name: row?.name }, reason },
                    channel.locale,
                  ),
                );
              },
            }
          : {}),
      });

      // The notification ran AFTER the rollback and inside a guard, so a mail
      // server that is down cannot undo a rollback that succeeded. But nobody
      // has been told — say so loudly rather than let "success" imply it.
      if (typeof outcome.notified === 'object') {
        log.error('Rollback notification FAILED to send', { error: outcome.notified.failed });
        logger.error(
          `The rollback succeeded but its notification did not send: ${outcome.notified.failed}. ` +
            'Nobody has been told — tell them by hand.',
        );
      } else if (outcome.notified === 'sent') {
        logger.info('Rollback notification sent');
      }

      log.info('Rollback completed successfully');
      logger.info('Rollback completed successfully');

      return {
        success: true,
        tenantId,
        mappingId,
        reason,
        rolledBackAt: new Date().toISOString(),
        from: outcome.from,
        mapping: outcome.mapping,
      };
    } catch (error) {
      if (error instanceof RollbackRefused) {
        // Nothing was written. A refused rollback is not a failed cutover,
        // and marking it FAILED would turn "we did not do this" into "we
        // tried and broke it" in the event trail.
        logger.error(`Rollback refused: ${error.message}${error.hint ? ` ${error.hint}` : ''}`);
        throw error;
      }

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
