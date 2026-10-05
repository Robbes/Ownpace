// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * EACH TIER AT ITS OWN PACE (workplan 0157 T2; ADR-0014, *Amendment
 * 2026-10-04, evening*).
 *
 * The owner, 2026-10-04: Free runs each migration at one pass a day, *"the
 * first right after the preflight"*; the paid tiers look as often as every 15
 * minutes. So a migration of an organisation the month bills as Free is due 24
 * hours after its last pass STARTED, its first copy included, where a paid
 * tier's first copy runs pass after pass (0156 T5). A migration that never ran
 * is due at once whatever the tier, so the first pass still follows the
 * preflight.
 *
 * WHAT THIS DECIDES, AND WHAT IT DOES NOT. It says how many minutes at least
 * lie between two passes of an organisation's migrations: a number, which
 * `isSyncDue` takes beside its other facts, so `orchestration` never learns
 * what a tier is (AGENTS.md hard rule 5). The tick (`managed-sync-tick.ts`)
 * asks it, and so does *Sync now*, which refuses a press on Free while the
 * pace has not come round.
 *
 * THE TIER IS THE ONE THE MONTH BILLS (`billedTierOf`): what was used, never
 * above the agreed tier. An organisation that said yes to Small but uses what
 * Free holds is billed Free and runs at Free's pace; one billed Small runs at
 * a paid tier's. The pace follows what is paid for.
 *
 * NOT DURING THE ALPHA (the owner, 2026-10-04: *"No, alpha is free for
 * everything that testers want to do. So also the higher tiers are free for
 * them."*): every tier runs at a paid tier's pace while the stage is `alpha`,
 * as the data ceiling does not hold then either. The stage is read as
 * `holdsAtCeiling` reads it, so the two cannot disagree on when the alpha is.
 */

import type { PgDatabase } from '@openmig/ledger/db';
import { PgPathLifecycleStore } from '@openmig/ledger';
import type { TenantId } from '@openmig/shared';
import { allowanceOf, holdsAtCeiling, PgDataAllowanceStore } from './data-ceiling.ts';
import { billedTierOf } from './billed-tier.ts';
import { PgBytesMovedStore } from './bytes-moved.ts';
import { PgOccupancyPeakStore } from './occupancy-peak.ts';
import { observedTier, type ManagedTier } from './tier-calculator.ts';

/** Free's pace: one pass a day, measured from when the last one started. */
export const FREE_PASS_EVERY_MINUTES = 24 * 60;

/**
 * The least minutes between two passes of a migration, for the tier the month
 * bills and the stage this deployment runs. 0 is no floor beyond the schedule's
 * own and the 15-minute one every migration has.
 */
export function leastMinutesBetweenPasses(billed: ManagedTier, stage: string | undefined): number {
  if (!holdsAtCeiling(stage)) return 0;
  return billed.id === 'free' ? FREE_PASS_EVERY_MINUTES : 0;
}

/** Decimal GB, the tier table's unit, as every reader of the meter divides it. */
const BYTES_PER_GB = 1e9;

/**
 * The tier this month bills the organisation, read as the Billing page reads
 * it (`routes/billing`: `observedTier`, then `billedTierOf`), and writing
 * nothing: the tick asks it every minute, and asking prices nothing.
 *
 * Every store filters by the organisation itself, so this is right in the
 * organisation's own transaction (`withTenant`, the API) and over the system
 * role's connection, which bypasses row security (the tick, granted in managed
 * migration 0041).
 */
export async function billedTierNow(db: PgDatabase, tenantId: TenantId, now: Date): Promise<ManagedTier> {
  const grants = await new PgDataAllowanceStore(db).grants(tenantId);
  const peak = await new PgOccupancyPeakStore(db).forMonth(tenantId, now);
  const pathsNow = await new PgPathLifecycleStore(db).slotsHeld(tenantId);
  // What counts toward the tier: the alpha's data does not (managed 0040).
  const gb = Number(await new PgBytesMovedStore(db).counted(tenantId)) / BYTES_PER_GB;
  const measured = observedTier(peak?.peakPaths ?? 0, pathsNow, gb);
  return billedTierOf(measured.tier, allowanceOf(grants), measured.evidence.peakPaths, gb).tier;
}

/** When the pace lets a migration run its next pass: its last start plus the floor. */
export function nextPassByPace(lastStartedAt: Date, leastMinutes: number): Date {
  return new Date(lastStartedAt.getTime() + leastMinutes * 60_000);
}
