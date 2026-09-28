// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Managed ledger retention (workplan 0082 T2) — the wiring half.
 *
 * The rules live in `@openmig/ledger`'s `pruneRunEvents`, which decides what is
 * safe to delete and tests that against a real database without a container.
 * THIS FILE IS ONLY THE WIRING: the pool, the schedule and the log line.
 *
 * Nightly, and off the hour. Retention is the least urgent job in the system —
 * nothing is waiting on it — so it runs when the sync ticks are quietest and
 * never competes with the :00 boundary that everything else is drawn to.
 *
 * It runs unpartitioned across all tenants on the system role's connection
 * (`SYSTEM_DATABASE_URL`, `ownpace_system`, workplan 0138 T3 step 2), the same
 * trust boundary the sync tick documents: this is system-level housekeeping
 * over a table whose rows are already scoped by the runs they belong to. The
 * role bypasses row security, is not a superuser, and may delete what this
 * prunes and read what picks it (managed migration 0032); until step 2 this
 * was the owner's connection, a superuser.
 *
 * THE RUN PRUNE IS THE EXCEPTION, and it is partitioned deliberately (0121 T5).
 * Deleting a run row deletes billing evidence, and what makes that safe is the
 * invoice freeze — `invoice-generation.ts` writes the measured quantities onto
 * the invoice, so an issued bill does not re-read the ledger. That proof is PER
 * TENANT: tenant A billed through July and tenant B through May do not share a
 * safe point. One global maximum would delete B's June evidence; one global
 * minimum would let a tenant who signed up yesterday stop retention for
 * everybody. So this loops, and each tenant is pruned only as far as its own
 * newest ISSUED invoice — a tenant with none is skipped entirely, keeping all
 * of its runs and none of anybody else's.
 */

// The rule for a host a tenant gives us, on before this run connects anywhere (0136 T1).
import './refuse-internal-addresses.ts';
import { schedules } from '@trigger.dev/sdk';
import { leavesAReference } from './what-a-run-leaves.ts';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schemaPg from '@openmig/ledger/schema-pg';
import { sql } from 'drizzle-orm';
import {
  pruneRunEvents,
  pruneRuns,
  pruneAppEvents,
  retentionDaysFromEnv,
  runRetentionDaysFromEnv,
  appEventSinkOn, auditExportOn,
  pgDriver,
  type PgDatabase,
} from '@openmig/ledger';
import { pruneDeclinedAccessRequests } from '@openmig/managed';
import { log, setAppEventSink, setAuditExportSink } from '@openmig/shared';

// The system role, `ownpace_system`, which spans organisations and is not a
// superuser (workplan 0138 T3 step 2; managed migration 0032 grants it what
// this job sends and nothing else). Never DATABASE_URL, the database owner,
// which no run holds any more: there is no fallback to it.
const SYSTEM_DATABASE_URL = process.env.SYSTEM_DATABASE_URL?.trim();
if (!SYSTEM_DATABASE_URL) {
  throw new Error(
    'SYSTEM_DATABASE_URL is required: managed-retention spans organisations as the system role, ownpace_system, ' +
      'and never as the database owner (DATABASE_URL), which no run holds. ' +
      'deploy/compose/set-task-env.sh uploads it (workplan 0138 T3 step 2).',
  );
}
const pool = new Pool({ connectionString: SYSTEM_DATABASE_URL });
// Each audit event this task records, also as one JSON line on its output (0129 T4).
setAuditExportSink(auditExportOn(pgDriver(pool), { 'service.name': 'ownpace-worker' }));
// Its errors go to the operator's log page too (0129 T1), under the reference
// its failure carries in the plane (0134, open question 3 (a)).
setAppEventSink(appEventSinkOn(pgDriver(pool)));

export const managedRetention = schedules.task({
  id: 'managed-retention',
  cron: '17 3 * * *',
  run: leavesAReference('managed-retention', async () => {
    const db = drizzle(pool, { schema: schemaPg }) as unknown as PgDatabase;
    const now = new Date();
    const days = retentionDaysFromEnv(process.env.LEDGER_RETENTION_DAYS);
    const result = await pruneRunEvents(db, now, { olderThanDays: days });

    // Only invoices that have LEFT DRAFT count as proof. A draft can still be
    // regenerated from the ledger, which is precisely the re-read the freeze is
    // supposed to have made unnecessary — and `void` is excluded because a
    // voided period may yet be billed again.
    const runDays = runRetentionDaysFromEnv(process.env.LEDGER_RUN_RETENTION_DAYS);
    const billed = (await db.execute(sql`
      SELECT tenant_id::text AS tenant_id, MAX(period_end) AS through
        FROM invoice
       WHERE tenant_id IS NOT NULL
         AND status IN ('sent', 'paid', 'overdue')
       GROUP BY tenant_id
    `)) as unknown as { rows?: { tenant_id: string; through: string }[] };

    let runsDeleted = 0;
    let runsMoreRemaining = false;
    for (const row of billed.rows ?? []) {
      // `period_end` is a DATE string and the period includes its last day, so
      // the safe instant is the START of the following day — the same half-open
      // window `billingWindow` uses, for the same reason (0121 T3, defect 3).
      const safeUpTo = new Date(`${row.through}T00:00:00.000Z`);
      safeUpTo.setUTCDate(safeUpTo.getUTCDate() + 1);
      const pruned = await pruneRuns(db, now, {
        olderThanDays: runDays,
        safeUpTo,
        tenantId: row.tenant_id,
      });
      runsDeleted += pruned.deleted;
      runsMoreRemaining = runsMoreRemaining || pruned.moreRemaining;
    }
    log.info(
      `[retention] deleted ${runsDeleted} runs across ${(billed.rows ?? []).length} invoiced tenant(s), ` +
        `window ${runDays}d, each clamped to its newest issued invoice` +
        (runsMoreRemaining ? '; the batch ceiling stopped this pass, the next continues.' : '.'),
    );

    if (result.moreRemaining) {
      // Said out loud rather than left to look like a quiet success: the first
      // pass over a database that has never been pruned will hit the ceiling,
      // and an operator watching should see that it is working through a
      // backlog rather than that it found nothing.
      log.info(
        `[retention] deleted ${result.deleted} run events older than ${result.cutoff.toISOString()}; ` +
          'the batch ceiling stopped this pass with more still eligible — the next run continues.',
      );
    } else {
      log.info(
        `[retention] deleted ${result.deleted} run events older than ${result.cutoff.toISOString()}; nothing left.`,
      );
    }
    // The application's own errors and warnings (0129 T3): one month, the
    // owner's number, the same on both editions.
    const events = await pruneAppEvents(db, now);
    log.info(
      `[retention] deleted ${events.deleted} application events older than ${events.cutoff.toISOString()}` +
        (events.moreRemaining ? '; the batch ceiling stopped this pass, the next continues.' : '.'),
    );
    // A declined access request, 30 days after the decision (0139 T6, the
    // owner's number). Counts only: the rows are people's names and addresses.
    const declined = await pruneDeclinedAccessRequests(db, now);
    log.info(
      `[retention] deleted ${declined.deleted} access request(s) declined before ${declined.cutoff.toISOString()}.`,
    );

    return {
      deleted: result.deleted,
      moreRemaining: result.moreRemaining || runsMoreRemaining || events.moreRemaining,
      days,
      runsDeleted,
      runDays,
      appEventsDeleted: events.deleted,
      declinedRequestsDeleted: declined.deleted,
    };
  }),
});
