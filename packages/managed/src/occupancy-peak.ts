// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The month's peak occupancy, written as it happens (workplan 0109 T2).
 *
 * ADR-0014 bills the month's PEAK number of slot-holding paths and wants the
 * invoice to quote its evidence — "6 paths at the same time on 12 August". A
 * peak cannot be recomputed later from current state, so the recorder runs at
 * the one moment occupancy can rise: inside the SAME transaction as a path
 * activation (`movePathsWithMapping`'s `active` branch). It counts what the
 * transaction itself sees (`slotsHeld`, derived from `holdsASlot` — one
 * authority) and raises the month's high-water row, strictly: an equal count
 * later in the month leaves the row alone, so `peak_at` stays the moment the
 * mark was SET.
 *
 * ## What this cannot do, on purpose
 *
 * Two concurrent activations may each count before the other commits and
 * record the lower number; a month where no path activates writes no row even
 * while paths run all month. Both under-record — the direction that cannot
 * over-bill — and the second is closed where it matters: the tier calculator
 * (T4) calls `recordCurrentOccupancy` as a true-up for the month it is about
 * to read, so a standing fleet is counted at invoice time even if nobody
 * pressed anything all month.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { PgDatabase } from '@openmig/ledger/db';
import { PgPathLifecycleStore } from '@openmig/ledger';
import type { TenantId } from '@openmig/shared';
import { occupancyPeak } from './schema-managed.ts';

export interface OccupancyPeak {
  /** ISO date of the month's first day. */
  readonly month: string;
  readonly peakPaths: number;
  /** When the high-water was set — the date the invoice quotes. */
  readonly peakAt: string;
}

export class PgOccupancyPeakStore {
  private readonly db: PgDatabase;

  constructor(db: PgDatabase) {
    this.db = db;
  }

  /**
   * Count the tenant's slot-holding paths right now and raise this month's
   * high-water mark if they exceed it.
   *
   * Call it in the same transaction as whatever changed occupancy upward —
   * outside one it records a moment nothing guarantees was ever committed.
   * Zero slots records nothing: the mark says how high the water stood, and
   * an empty month is told by absence, never by a zero row (the migration's
   * CHECK refuses one).
   */
  async recordCurrentOccupancy(tenantId: TenantId, at: Date = new Date()): Promise<void> {
    const slots = await new PgPathLifecycleStore(this.db).slotsHeld(tenantId);
    if (slots === 0) return;
    await this.db.execute(
      sql`INSERT INTO occupancy_peak (tenant_id, month, peak_paths, peak_at, updated_at)
          VALUES (
            ${tenantId},
            date_trunc('month', ${at.toISOString()}::timestamptz)::date,
            ${slots}, ${at.toISOString()}::timestamptz, now()
          )
          ON CONFLICT (tenant_id, month) DO UPDATE SET
            peak_paths = EXCLUDED.peak_paths,
            peak_at = EXCLUDED.peak_at,
            updated_at = now()
          -- Strictly greater: a tie is not a new peak, and the first date is
          -- the evidence. The migration's trigger refuses a lowering besides.
          WHERE occupancy_peak.peak_paths < EXCLUDED.peak_paths`,
    );
  }

  /**
   * The recorded peak for the month containing `day`, or null when nothing
   * raised the mark that month. The reader T4/T5 quote — remember absence
   * means "never raised", not "nothing ran": true up first for a live month.
   */
  async forMonth(tenantId: TenantId, day: Date): Promise<OccupancyPeak | null> {
    const month = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1))
      .toISOString()
      .slice(0, 10);
    const rows = await this.db
      .select({
        month: occupancyPeak.month,
        peakPaths: occupancyPeak.peakPaths,
        peakAt: occupancyPeak.peakAt,
      })
      .from(occupancyPeak)
      .where(and(eq(occupancyPeak.tenantId, tenantId), eq(occupancyPeak.month, month)));
    const row = rows[0];
    if (!row) return null;
    return { month: row.month, peakPaths: row.peakPaths, peakAt: row.peakAt.toISOString() };
  }
}
