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
 * statement, and for `readCutoverWindows` here, which every gate asks through
 * `readPathPhases`. `cutoverStillCopiesAt` in shared says the same in
 * TypeScript, and `a-grace-period-that-copies.unit.test.ts` holds the two in
 * step over every state and both sides of the end.
 *
 * **A window per data type** (0128 T5, slice 4, ledger migration 0067). Each
 * cutover ledger row has its own window, and a data type's is its own row's,
 * or the whole migration's where it has none, as the store reads a ledger
 * (`CutoverStore`). The tick asks whether any of a migration's rows still
 * copies: a pass it starts moves past each data type whose own window is
 * closed, so any is enough to start one, and none is enough to start none.
 */

import { sql } from 'drizzle-orm';
import type { PgDatabase } from './db-types.ts';

/** The cutover still copies. Over `cutover_state c`; any other state reads false. */
export const CUTOVER_STILL_COPIES_WHERE =
  "(c.copies_through_grace AND now() < CASE c.state " +
  "WHEN 'GRACE_PERIOD' THEN c.grace_period_started_at + make_interval(hours => c.grace_period_hours) " +
  "WHEN 'CUTOVER_IN_PROGRESS' THEN c.updated_at + make_interval(hours => c.grace_period_hours) END)";

/** A migration's cutover windows, read once for a pass. */
export interface CutoverWindows {
  /** Whether any of its cutover ledgers still copies: the managed tick's question. */
  readonly any: boolean;
  /**
   * Whether a ledger's cutover still copies: a data type's own, or the whole
   * migration's where it has none; without a data type, the whole migration's.
   */
  readonly of: (domain?: string) => boolean;
}

/** A migration that is not in its cutover: no window is asked. */
export const NO_CUTOVER_WINDOWS: CutoverWindows = { any: false, of: () => false };

/** Each of a migration's cutover windows, in one statement. Read inside the organisation's transaction. */
export async function readCutoverWindows(db: PgDatabase, tenantId: string, mappingId: string): Promise<CutoverWindows> {
  const found = (await db.execute(sql`
    SELECT c.domain, COALESCE(${sql.raw(CUTOVER_STILL_COPIES_WHERE)}, false) AS copies
      FROM cutover_state c
     WHERE c.tenant_id = ${tenantId}::uuid AND c.mapping_id = ${mappingId}::uuid
  `)) as unknown as { rows: Array<{ domain: string | null; copies: boolean }> };
  const whole = found.rows.find((r) => r.domain === null)?.copies === true;
  const own = new Map(found.rows.filter((r) => r.domain !== null).map((r) => [r.domain!, r.copies === true]));
  return {
    any: found.rows.some((r) => r.copies === true),
    of: (domain) => (domain === undefined ? whole : (own.get(domain) ?? whole)),
  };
}

/**
 * Whether a ledger's cutover still copies, as `readCutoverWindows` answers it:
 * a data type's own or the whole migration's, or the whole migration's.
 */
export async function cutoverStillCopies(
  db: PgDatabase,
  tenantId: string,
  mappingId: string,
  domain?: string,
): Promise<boolean> {
  return (await readCutoverWindows(db, tenantId, mappingId)).of(domain);
}
