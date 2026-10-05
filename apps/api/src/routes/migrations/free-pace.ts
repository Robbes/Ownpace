// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * FREE'S PACE HOLDS FOR A PRESS TOO (workplan 0157 T2).
 *
 * On Free a migration runs one pass a day, 24 hours after the last one
 * started; the tick keeps that (`leastMinutesBetweenPasses` in
 * `@openmig/managed`'s `pace.ts`). *Sync now* starts a pass without the tick,
 * so on Free it would be the way round the pace. So a press inside the day is
 * refused, with the time of the next pass, and what changes it: a higher tier.
 *
 * WHAT IS NOT REFUSED:
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
import { billedTierNow, holdsAtCeiling, leastMinutesBetweenPasses, nextPassByPace } from '@openmig/managed';
import type { TenantId } from '@openmig/shared';
import { withTenantDb } from '../../middleware/auth.ts';

/** The refusal's body: the code the app words it by, the English, and when the next pass runs. */
export interface FreePaceRefusal {
  readonly error: 'free_pace';
  readonly message: string;
  /** When the pace lets the next pass run, ISO 8601. */
  readonly nextPassAt: string;
}

/** The refusal for a press on this migration now, or undefined when the pace allows it. */
export async function freePaceRefusal(
  tenantId: string,
  mappingId: string,
  pool: Pool,
  now: Date = new Date(),
): Promise<FreePaceRefusal | undefined> {
  const stage = process.env.OWNPACE_STAGE;
  if (!holdsAtCeiling(stage)) return undefined;
  return withTenantDb(tenantId, pool, async (db) => {
    const least = leastMinutesBetweenPasses(await billedTierNow(db, tenantId as TenantId, now), stage);
    if (least === 0) return undefined;
    const [row] = await db
      .select({ last: sql<string | Date | null>`max(${schema.run.startedAt})` })
      .from(schema.run)
      .where(and(eq(schema.run.tenantId, tenantId), eq(schema.run.mappingId, mappingId)));
    if (!row?.last) return undefined;
    const next = nextPassByPace(new Date(row.last), least);
    if (next.getTime() <= now.getTime()) return undefined;
    return {
      error: 'free_pace',
      message:
        `On Free a migration runs one pass a day, and this one's next pass starts at ${next.toISOString()}. ` +
        'A higher tier looks for changes as often as every 15 minutes.',
      nextPassAt: next.toISOString(),
    };
  });
}
