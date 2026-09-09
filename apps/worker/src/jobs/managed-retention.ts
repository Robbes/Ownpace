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
 * It runs unpartitioned across all tenants on the owner connection, the same
 * trust boundary the sync tick documents: this is system-level housekeeping
 * over a table whose rows are already scoped by the runs they belong to.
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

import { schedules } from '@trigger.dev/sdk';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schemaPg from '@openmig/ledger/schema-pg';
import { sql } from 'drizzle-orm';
import {
  pruneRunEvents,
  pruneRuns,
  retentionDaysFromEnv,
  runRetentionDaysFromEnv,
  type PgDatabase,
} from '@openmig/ledger';
import { log } from '@openmig/shared';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}
const pool = new Pool({ connectionString: DATABASE_URL });

export const managedRetention = schedules.task({
  id: 'managed-retention',
  cron: '17 3 * * *',
  run: async () => {
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
    return {
      deleted: result.deleted,
      moreRemaining: result.moreRemaining || runsMoreRemaining,
      days,
      runsDeleted,
      runDays,
    };
  },
});
