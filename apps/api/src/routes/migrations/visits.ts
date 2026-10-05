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
 *
 * A VISIT ENDS A SLOWER STEP, AND SAYS SO ONCE (0157 T7, managed 0043). The
 * morning mail claims each slower step it says (`migration_cadence_said`). A
 * visit brings back the hour, so it deletes that row, and answers which step
 * it ended: the migration's page says it then, once, as the step was said by
 * email (*"Everything was in step, so we looked every 6 hours. …"*). With no
 * row, the answer is null, and the page says nothing.
 */

import type { Pool } from 'pg';
import { and, eq, sql } from 'drizzle-orm';
import { migrationCadenceSaid, migrationVisit } from '@openmig/managed/schema-managed';
import { withTenantDb } from '../../middleware/auth.ts';

/** What a visit did beyond recording itself. */
export interface VisitAnswer {
  /** The slower step it ended, once said by email; null when none was in force. */
  readonly broughtBackFrom: 'six-hourly' | 'daily' | null;
}

/**
 * Record a visit to this migration now, unless one was recorded within the
 * hour, and end a slower step said of it, answering which.
 */
export async function recordVisit(tenantId: string, mappingId: string, pool: Pool): Promise<VisitAnswer> {
  return withTenantDb(tenantId, pool, async (db) => {
    await db
      .insert(migrationVisit)
      .values({ mappingId, tenantId })
      .onConflictDoUpdate({
        target: migrationVisit.mappingId,
        set: { visitedAt: sql`now()` },
        setWhere: sql`${migrationVisit.visitedAt} < now() - interval '1 hour'`,
      });
    const [said] = await db
      .delete(migrationCadenceSaid)
      .where(and(eq(migrationCadenceSaid.mappingId, mappingId), eq(migrationCadenceSaid.tenantId, tenantId)))
      .returning({ step: migrationCadenceSaid.step });
    return { broughtBackFrom: said?.step ?? null };
  });
}
