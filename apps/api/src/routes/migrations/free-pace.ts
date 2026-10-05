// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * FREE'S PACE HOLDS AT EVERY DOOR (workplan 0157 T2, T4).
 *
 * On Free a migration runs one pass a day, 24 hours after the last one
 * started; the tick keeps that (`leastMinutesBetweenPasses` in
 * `@openmig/managed`'s `pace.ts`). The doors that start a pass without the
 * tick, or set how often it runs, keep it too:
 *
 *  - *Sync now* inside the day is refused, with the time of the next pass, and
 *    what changes it: a higher tier (`freePaceRefusal`, T2);
 *  - *Start* on a paused migration that ran inside the day activates it, and
 *    its pass waits for the pace instead of starting at once (T4);
 *  - a schedule faster than the pace is refused at create and on the
 *    migration page, saying why (`scheduleRefusalAtPace`, T4). *Automatic*
 *    (no schedule) is never refused: on Free it runs once a day;
 *  - the migration's page reads the pace (`paceFor`), so its chooser offers
 *    what the tier allows and says when the next pass starts.
 *
 * WHAT IS NOT HELD:
 *
 *  - the final pass before the switch, which *Finish* asks for (`final`): the
 *    switch is the one moment the person needs the newest copy, whatever the
 *    tier (0157 §7, *"the switch, which runs its own final sync on demand"*);
 *  - a migration that never ran, which is due at once on every tier;
 *  - anything during the alpha, when every tier runs at a paid tier's pace
 *    (the owner, 2026-10-04), the stage read as `holdsAtCeiling` reads it;
 *  - a paid tier, which has no floor beyond its schedule's.
 *
 * The tier is the one the month bills, read in the organisation's own
 * transaction as the Billing page reads it (`billedTierNow`). The last start is
 * the newest run of the migration, any kind, as the tick reads it.
 */

import type { Pool } from 'pg';
import { and, eq, sql } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import type { PgDatabase } from '@openmig/ledger';
import {
  billedTierNow,
  FREE_PASS_EVERY_MINUTES,
  holdsAtCeiling,
  leastMinutesBetweenPasses,
  nextPassByPace,
} from '@openmig/managed';
import { shortestGapMinutes } from '@openmig/orchestration/sync-due';
import type { TenantId } from '@openmig/shared';
import { withTenantDb } from '../../middleware/auth.ts';

/** The refusal's body: the code the app words it by, the English, and when the next pass runs. */
export interface FreePaceRefusal {
  readonly error: 'free_pace';
  readonly message: string;
  /** When the pace lets the next pass run, ISO 8601. */
  readonly nextPassAt: string;
}

/** The pace one migration runs at now, as its page reads it. */
export interface Pace {
  /** The least minutes between two passes: 1,440 on Free outside the alpha, else 0. */
  readonly leastMinutesBetweenPasses: number;
  /** When the pace lets the next pass run, ISO 8601, while that is still to come; else null. */
  readonly nextPassAt: string | null;
}

/** The least minutes between passes for this organisation now, in its own transaction. */
async function leastMinutesIn(db: PgDatabase, tenantId: string, now: Date): Promise<number> {
  const stage = process.env.OWNPACE_STAGE;
  if (!holdsAtCeiling(stage)) return 0;
  return leastMinutesBetweenPasses(await billedTierNow(db, tenantId as TenantId, now), stage);
}

/** The pace of this migration now: the tier's floor, and when it lets the next pass run. */
export async function paceFor(tenantId: string, mappingId: string, pool: Pool, now: Date = new Date()): Promise<Pace> {
  if (!holdsAtCeiling(process.env.OWNPACE_STAGE)) return { leastMinutesBetweenPasses: 0, nextPassAt: null };
  return withTenantDb(tenantId, pool, async (db) => {
    const least = await leastMinutesIn(db, tenantId, now);
    if (least === 0) return { leastMinutesBetweenPasses: 0, nextPassAt: null };
    const [row] = await db
      .select({ last: sql<string | Date | null>`max(${schema.run.startedAt})` })
      .from(schema.run)
      .where(and(eq(schema.run.tenantId, tenantId), eq(schema.run.mappingId, mappingId)));
    if (!row?.last) return { leastMinutesBetweenPasses: least, nextPassAt: null };
    const next = nextPassByPace(new Date(row.last), least);
    return { leastMinutesBetweenPasses: least, nextPassAt: next.getTime() > now.getTime() ? next.toISOString() : null };
  });
}

/** The refusal for a press on this migration now, or undefined when the pace allows it. */
export async function freePaceRefusal(
  tenantId: string,
  mappingId: string,
  pool: Pool,
  now: Date = new Date(),
): Promise<FreePaceRefusal | undefined> {
  const { nextPassAt } = await paceFor(tenantId, mappingId, pool, now);
  if (nextPassAt === null) return undefined;
  return {
    error: 'free_pace',
    message:
      `On Free a migration runs one pass a day, and this one's next pass starts at ${nextPassAt}. ` +
      'A higher tier looks for changes as often as every 15 minutes.',
    nextPassAt,
  };
}

/** The refusal of a schedule faster than the pace: the code, the English, and the pace. */
export interface ScheduleAtPaceRefusal {
  readonly error: 'free_pace_schedule';
  readonly message: string;
  readonly leastMinutesBetweenPasses: number;
}

/**
 * The refusal of `schedule` for this organisation now, or undefined when the
 * pace allows it. Null (*Automatic*) is always allowed. Read after the
 * schedule has been found readable, as both doors do.
 */
export async function scheduleRefusalAtPace(
  tenantId: string,
  schedule: string | null | undefined,
  pool: Pool,
  now: Date = new Date(),
): Promise<ScheduleAtPaceRefusal | undefined> {
  if (typeof schedule !== 'string' || !holdsAtCeiling(process.env.OWNPACE_STAGE)) return undefined;
  // A schedule no tier's pace is slower than needs no tier read: daily or
  // slower is allowed everywhere.
  if (shortestGapMinutes(schedule) >= FREE_PASS_EVERY_MINUTES) return undefined;
  const least = await withTenantDb(tenantId, pool, (db) => leastMinutesIn(db, tenantId, now));
  if (least === 0 || shortestGapMinutes(schedule) >= least) return undefined;
  return {
    error: 'free_pace_schedule',
    message:
      'On Free a migration looks for changes once a day, so this schedule would run no more often than that. ' +
      'Choose Automatic or Daily, or a higher tier on the Billing page, which looks as often as every 15 minutes.',
    leastMinutesBetweenPasses: least,
  };
}
