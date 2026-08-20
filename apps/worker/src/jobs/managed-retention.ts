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
 */

import { schedules } from '@trigger.dev/sdk';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schemaPg from '@openmig/ledger/schema-pg';
import {
  pruneRunEvents,
  retentionDaysFromEnv,
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
    const days = retentionDaysFromEnv(process.env.LEDGER_RETENTION_DAYS);
    const result = await pruneRunEvents(db, new Date(), { olderThanDays: days });

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
    return { deleted: result.deleted, moreRemaining: result.moreRemaining, days };
  },
});
