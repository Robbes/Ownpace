// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CUTOVER THAT STILL COPIES (workplan 0128 T2; the owner, 2026-09-24, D1
 * (a): "bounded by the grace period, and slotless").
 *
 * From execute until its grace period ends, a cutover's migration keeps being
 * copied (`runsPassesNow` in shared), if it was copying when execute ran
 * (`copies_through_grace`, ledger migration 0064): a migration the operator
 * had paused stays stopped. The ledger row says until when: while execute is
 * in progress, `updated_at` is its start; in `GRACE_PERIOD`,
 * `grace_period_started_at` is the period's, and `grace_period_hours` how long
 * either lasts.
 *
 * `CUTOVER_STILL_COPIES_WHERE` is that rule in SQL, over `cutover_state`
 * aliased `c`: for the managed tick, which chooses what to schedule in one
 * statement, for the appliance's gates, and for `cutoverStillCopies` here.
 * `cutoverStillCopiesAt` in shared says the same in TypeScript, and
 * `a-grace-period-that-copies.unit.test.ts` holds the two in step over every
 * state and both sides of the end.
 */

import { sql } from 'drizzle-orm';
import type { PgDatabase } from './db-types.ts';

/** The cutover still copies. Over `cutover_state c`; any other state reads false. */
export const CUTOVER_STILL_COPIES_WHERE =
  "(c.copies_through_grace AND now() < CASE c.state " +
  "WHEN 'GRACE_PERIOD' THEN c.grace_period_started_at + make_interval(hours => c.grace_period_hours) " +
  "WHEN 'CUTOVER_IN_PROGRESS' THEN c.updated_at + make_interval(hours => c.grace_period_hours) END)";

/** Whether this migration's cutover still copies. Read inside the organisation's transaction. */
export async function cutoverStillCopies(db: PgDatabase, tenantId: string, mappingId: string): Promise<boolean> {
  const found = (await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM cutover_state c
       WHERE c.tenant_id = ${tenantId}::uuid AND c.mapping_id = ${mappingId}::uuid
         AND ${sql.raw(CUTOVER_STILL_COPIES_WHERE)}
    ) AS copies
  `)) as unknown as { rows: Array<{ copies: boolean }> };
  return found.rows[0]?.copies === true;
}
