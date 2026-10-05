// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A VISIT BRINGS BACK THE HOUR (workplan 0157 T7; the owner, 2026-10-05:
 * *"sync slow down once a migration is in step: yes"*).
 *
 * A migration with no schedule of its own looks every hour for 14 days from the
 * later of its first copy and its last visit, then every 6 hours, then once a
 * day from 30 days (`automaticScheduleFor` in `sync-due.ts`; the tick reads the
 * visits with `VISITS_SQL`). A visit is the migration's page opened
 * (`POST /:mappingId/visit`, which the page sends as it opens) or *Sync now*
 * pressed: somebody who looks is somebody checking.
 *
 * One row per migration (managed 0042), moved forward at most once an hour, so
 * a page open all day writes once an hour and not once a render. Never who
 * visited: the cadence needs when, not who.
 */

import type { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { migrationVisit } from '@openmig/managed/schema-managed';
import { withTenantDb } from '../../middleware/auth.ts';

/** Record a visit to this migration now, unless one was recorded within the hour. */
export async function recordVisit(tenantId: string, mappingId: string, pool: Pool): Promise<void> {
  await withTenantDb(tenantId, pool, async (db) => {
    await db
      .insert(migrationVisit)
      .values({ mappingId, tenantId })
      .onConflictDoUpdate({
        target: migrationVisit.mappingId,
        set: { visitedAt: sql`now()` },
        setWhere: sql`${migrationVisit.visitedAt} < now() - interval '1 hour'`,
      });
  });
}
