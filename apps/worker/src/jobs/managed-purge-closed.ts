// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Erase the tenants whose window has run out (workplan 0085 T2/T8) — the
 * wiring half.
 *
 * The rules live in `@openmig/ledger`'s `offboarding.ts`, which decides what is
 * purged, what survives and why, and tests that against a real database. THIS
 * FILE IS ONLY THE WIRING: the pool, the schedule, the quiesce check and the
 * log line.
 *
 * ## Why it refuses to purge a tenant with a run in flight
 *
 * `item` IS the idempotency ledger. Purging it while a pass is running tells
 * the next pass that nothing has been copied — and the next pass copies it all
 * again, **into the leaving customer's target**. Duplicating the mail of
 * somebody who just asked to be forgotten is the worst outcome this workplan
 * has, so the check is a precondition rather than a nicety, and a tenant that
 * cannot be quiesced is skipped and said out loud rather than forced.
 *
 * Closing already stops the sync tick picking the mapping up (status is no
 * longer `active`), so a run still in flight means one that was already
 * underway. Waiting a day is the correct response.
 */

import { schedules } from '@trigger.dev/sdk';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schemaPg from '@openmig/ledger/schema-pg';
import { purgeTenant, type PgDatabase } from '@openmig/ledger';
import { log } from '@openmig/shared';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}
const pool = new Pool({ connectionString: DATABASE_URL });

/** Tenants closed long enough ago that their window has expired. */
interface DueRow {
  readonly id: string;
  readonly running: boolean;
}

export const managedPurgeClosed = schedules.task({
  id: 'managed-purge-closed',
  // Hourly, not per-minute: nothing is waiting on this, and an immediate close
  // promises "as soon as the purge next runs" rather than "instantly" for
  // exactly this reason. Off the hour, away from the retention pass.
  cron: '23 * * * *',
  run: async () => {
    const db = drizzle(pool, { schema: schemaPg }) as unknown as PgDatabase;
    const now = new Date();

    const { rows } = await pool.query<DueRow>(
      `SELECT t.id,
              EXISTS (SELECT 1 FROM run r
                       WHERE r.tenant_id = t.id AND r.status IN ('running', 'queued')) AS running
         FROM tenant t
        WHERE t.status = 'closed' AND t.purge_after IS NOT NULL AND t.purge_after <= $1`,
      [now],
    );

    let purged = 0;
    let skippedRunning = 0;
    const failed: string[] = [];

    for (const row of rows) {
      if (row.running) {
        skippedRunning++;
        // Loud, because a tenant that never quiesces would otherwise sit past
        // its promised window in silence — and the promise was to the person
        // who asked to be forgotten.
        log.warn(
          `[purge] tenant ${row.id} is past its erasure window but still has a run in flight; ` +
            'skipped this pass rather than purging under it. If this repeats, the run is stuck.',
        );
        continue;
      }

      try {
        // One transaction: a half-purged tenant is worse than an un-purged one,
        // because it is neither a customer nor gone and nothing expects it.
        await db.execute(sql`BEGIN`);
        await db.execute(sql`UPDATE tenant SET status = 'deleting' WHERE id = ${row.id}::uuid`);
        const result = await purgeTenant(db, row.id, now);
        await db.execute(sql`COMMIT`);
        purged++;
        // The tenant id is logged because at this point it identifies nothing —
        // the row it named is gone. The erasure record holds only its hash.
        log.info(
          `[purge] erased tenant ${row.id}: ${Object.values(result.counts).reduce((a, b) => a + b, 0)} rows removed, ` +
            `${result.retainedInvoiceIds.length} invoice(s) retained and detached.`,
        );
      } catch (err) {
        await db.execute(sql`ROLLBACK`).catch(() => undefined);
        failed.push(row.id);
        log.error(`[purge] tenant ${row.id}: erasure failed and was rolled back:`, err);
      }
    }

    const summary = { due: rows.length, purged, skippedRunning, failed: failed.length };
    log.info('[purge]', summary);
    return summary;
  },
});
