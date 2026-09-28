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

// The rule for a host a tenant gives us, on before this run connects anywhere (0136 T1).
import './refuse-internal-addresses.ts';
import { z } from 'zod';
import { schemaTask } from '@trigger.dev/sdk';
import { leavesAReference } from './what-a-run-leaves.ts';
import { tenantCutoverStore, mappingLifecyclePort, appEventSinkOn, auditExportOn, pgDriver, withTenant } from '@openmig/ledger';
import { performRollback, RollbackRefused } from '@openmig/core';
import { and, eq } from 'drizzle-orm';
import { Pool } from 'pg';
import * as schemaPg from '@openmig/ledger/schema-pg';
import { asTenantId, asMappingId, renderEvent } from '@openmig/shared';
import { raiseThePeakWhereThereIsOne } from '../the-peak-where-there-is-one.ts';
import { log, setAppEventSink, setAuditExportSink } from '@openmig/shared';
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

/**
 * What the customer called this migration, for the rollback's notice. They
 * know it as "Gmail to Nextcloud"; the UUID appears on no screen they have
 * ever seen (owner report, 2026-09-14). Read inside the tenant's scope, like
 * every other read here (0138 T1 part 4), so that on `app_user` it finds the
 * row. `name` is nullable and `mappingLabel` falls back to the id, so a
 * migration nobody named still sends.
 */
export async function mappingNameOf(
  pool: Pool,
  tenantId: string,
  mappingId: string,
): Promise<string | null | undefined> {
  const [row] = await withTenant(pool, tenantId, (db) =>
    db
      .select({ name: schemaPg.mailboxMapping.name })
      .from(schemaPg.mailboxMapping)
      .where(and(eq(schemaPg.mailboxMapping.id, mappingId), eq(schemaPg.mailboxMapping.tenantId, tenantId)))
      .limit(1),
  );
  return row?.name;
}

// Register the job with Trigger.dev
export const runRollback = schemaTask({
  id: 'run-rollback',
  description: 'Rollback',
  schema: RollbackJobSchema,
  run: leavesAReference('run-rollback', async (payload: unknown) => {
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
    // Each audit event this run records, also as one JSON line on its output (0129 T4).
    setAuditExportSink(auditExportOn(pgDriver(pool), { 'service.name': 'ownpace-worker' }));
    // Its errors go to the operator's log page too (0129 T1), under the reference
    // its failure carries in the plane (0134, open question 3 (a)).
    setAppEventSink(appEventSinkOn(pgDriver(pool)));
    // The cutover ledger is row-secured since migration 0055: every call
    // inside `withTenant`, or a non-superuser session reads nothing.
    const cutoverPersistence = tenantCutoverStore(pool, asTenantId(tenantId));

    try {
      // DNS is DEFERRED by owner decision (verify-only DNS, 2026-07-16). Do
      // not claim a restore that did not happen; the operator reverts the MX
      // record manually.
      if (options.restoreDns && options.dnsDomain) {
        log.warn(
          `DNS restore for ${options.dnsDomain} is DEFERRED (verify-only DNS) — revert the MX record manually.`,
        );
      }

      const outcome = await performRollback({
        tenantId: asTenantId(tenantId),
        mappingId: asMappingId(mappingId),
        cutoverStore: cutoverPersistence,
        // The month's peak rises with the slots a rollback takes back (0109 T2).
        mapping: mappingLifecyclePort(pool, tenantId, mappingId, 'trigger-job', {
          onSlotsTaken: raiseThePeakWhereThereIsOne(asTenantId(tenantId)),
        }),
        rolledBackBy: 'trigger-job',
        reason,
        // The shared log, not `ctx.logger`: Trigger.dev v4's TaskRunContext
        // carries run metadata only and has no logger. Nor the SDK's, which
        // writes into Trigger.dev's own database (0134, open question 3 (a)).
        log: (message) => log.info(message),
        ...(options.notifyUsers
          ? {
              notify: async () => {
                // What the customer called it, read at send time.
                const name = await mappingNameOf(pool, tenantId, mappingId);
                await channel.notifier.notify(
                  renderEvent(
                    { kind: 'rollback_finished', mapping: { id: mappingId, name }, reason },
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
        log.error(
          `The rollback succeeded but its notification did not send: ${outcome.notified.failed}. ` +
            'Nobody has been told — tell them by hand.',
        );
      } else if (outcome.notified === 'sent') {
        log.info('Rollback notification sent');
      }

      log.info('Rollback completed successfully');
      log.info('Rollback completed successfully');

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
        log.error(`Rollback refused: ${error.message}${error.hint ? ` ${error.hint}` : ''}`);
        throw error;
      }

      const err = error as Error;
      log.error('Rollback failed', { error: err.message });
      log.error(`Rollback failed: ${err.message}`);

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
  }),
});
