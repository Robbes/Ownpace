// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The tier calculator — the THIRD copy of the numbers, and its evidence
 * (workplan 0109 T4).
 *
 * ADR-0014's table now exists three times: the ADR itself, `site/prices.mjs`
 * (guarded against the ADR by `site/site.unit.test.ts`), and this file — the
 * managed side cannot import `site/` (it depends on nothing in the workspace,
 * deliberately — 0086 T7), so this is a re-implementation whose agreement is
 * proved by test rather than by sharing: `tier-calculator.unit.test.ts`
 * parses the ADR's own Markdown with the same structurally-identical guard,
 * and drives this derivation and the site's over the same grid. The drift
 * this project has caught twice cannot arrive quietly in the one copy that
 * costs money.
 *
 * ## What decides, and from where
 *
 * Two axes, higher wins (ADR-0014): the month's PEAK of slot-holding paths
 * (`occupancy_peak`, T2 — never current occupancy, which forgets what ran
 * last week) and CUMULATIVE first-copy data (`bytes_moved`, T3 — never a
 * live-row SUM, which tombstones would lower). `currentTier` performs T2's
 * documented true-up first — `recordCurrentOccupancy` — so a month in which
 * nobody pressed anything still counts a standing fleet at the moment it is
 * read. The answer carries its EVIDENCE (the peak, its date, the data moved)
 * because T5's invoice line is a tier name plus exactly that.
 *
 * Past the table the answer is null — "talk to us" — the same deliberate end
 * the site publishes.
 */

import type { PgDatabase } from '@openmig/ledger/db';
import type { TenantId } from '@openmig/shared';
import { PgOccupancyPeakStore } from './occupancy-peak.ts';
import { PgBytesMovedStore } from './bytes-moved.ts';

export const GB_PER_TB = 1000;

export interface ManagedTier {
  readonly id: 'tiny' | 'small' | 'medium' | 'large' | 'xl';
  readonly name: string;
  /** Migrations at the same time this tier fits. */
  readonly paths: number;
  /** Cumulative data ceiling, in GB (decimal — 1 TB = 1000 GB, the site's convention). */
  readonly dataGb: number;
  /** One-off, EUR. */
  readonly setup: number;
  /** Per month, EUR. */
  readonly monthly: number;
}

/** ADR-0014's five, in ascending order. Numbers guarded against the ADR's own table. */
export const MANAGED_TIERS: ReadonlyArray<ManagedTier> = [
  { id: 'tiny', name: 'Tiny', paths: 1, dataGb: 250, setup: 4, monthly: 2 },
  { id: 'small', name: 'Small', paths: 4, dataGb: 750, setup: 8, monthly: 4 },
  { id: 'medium', name: 'Medium', paths: 20, dataGb: 2 * GB_PER_TB, setup: 15, monthly: 8 },
  { id: 'large', name: 'Large', paths: 50, dataGb: 7.5 * GB_PER_TB, setup: 50, monthly: 39 },
  { id: 'xl', name: 'Extra large', paths: 200, dataGb: 15 * GB_PER_TB, setup: 150, monthly: 99 },
];

export interface TierDerivation {
  /** null past the end of the table: the published answer is "talk to us". */
  readonly tier: ManagedTier | null;
  /** Which axis forced the answer — the invoice highlights it (ADR-0014's words). */
  readonly decidedBy: 'paths' | 'data' | 'both';
}

/**
 * The smallest tier that fits both axes; you are on the higher of them.
 *
 * Semantically identical to `site/calculator.mjs`'s `deriveTier` — the
 * agreement is pinned over a grid by the unit test, so a change to either
 * copy that forgets the other turns red rather than quoting two prices.
 */
export function deriveTier(paths: number, gb: number): TierDerivation {
  const byPaths = MANAGED_TIERS.findIndex((t) => t.paths >= paths);
  const byData = MANAGED_TIERS.findIndex((t) => t.dataGb >= gb);
  if (byPaths === -1 || byData === -1) {
    return { tier: null, decidedBy: byPaths === -1 ? (byData === -1 ? 'both' : 'paths') : 'data' };
  }
  const i = Math.max(byPaths, byData);
  return {
    tier: MANAGED_TIERS[i]!,
    decidedBy: byPaths === byData ? 'both' : byPaths > byData ? 'paths' : 'data',
  };
}

export interface TierEvidence {
  /** The month's recorded peak of slot-holding paths, after the true-up. */
  readonly peakPaths: number;
  /** When the peak was set — "6 paths at the same time on 12 August". */
  readonly peakAt?: string;
  /** Cumulative first-copy data, in decimal GB. */
  readonly gbMoved: number;
}

export interface TenantTier extends TierDerivation {
  readonly evidence: TierEvidence;
}

/**
 * The tenant's tier for the CURRENT month, with the evidence an invoice
 * quotes.
 *
 * Runs T2's true-up first: a standing fleet in a quiet month raised no mark,
 * and the moment somebody asks is the moment that gap closes. The data axis
 * reads the meter's lifetime total — never a live-row SUM. Call it inside
 * `withTenant`, like every store here.
 *
 * For a PAST month there is no true-up to run (the recorder writes only the
 * month it is called in): read `PgOccupancyPeakStore.forMonth` directly and
 * derive with the meter total as of period close — T5's scheduled close is
 * where that belongs.
 */
/**
 * The read-only twin of `currentTier`, for surfaces that LOOK without pricing.
 *
 * `currentTier` trues the month up — it writes the peak it is about to read —
 * because it runs at a moment that prices something. The operator's support
 * screen must give the same answer while writing nothing: an operator looking
 * must not move a billing mark, and under the operator subject the tenant-RLS
 * write would be refused anyway. So the caller hands in what the support view
 * serves — the recorded peak (0 when nothing raised the mark), the live count
 * of slot-holding paths, and the meter — and this derives from the higher of
 * the two peaks, which is exactly the number the true-up would have written.
 *
 * `evidence.peakPaths` is that EFFECTIVE peak. `peakAt` is deliberately not
 * set: when the live count is the higher number, the moment it becomes the
 * month's mark is when something records it, and this function records
 * nothing. `support-routes.unit.test.ts` pins the parity with `currentTier`
 * over a real database, which is the guard that matters — a drift between the
 * screen and the invoice is the confusion this whole surface exists to
 * prevent.
 */
export function observedTier(peakRecorded: number, pathsNow: number, gbMoved: number): TenantTier {
  const peakPaths = Math.max(peakRecorded, pathsNow);
  return {
    ...deriveTier(peakPaths, gbMoved),
    evidence: { peakPaths, gbMoved },
  };
}

export async function currentTier(db: PgDatabase, tenantId: TenantId): Promise<TenantTier> {
  const peaks = new PgOccupancyPeakStore(db);
  await peaks.recordCurrentOccupancy(tenantId);
  const now = new Date();
  const peak = await peaks.forMonth(tenantId, now);
  const bytes = await new PgBytesMovedStore(db).total(tenantId);
  // Decimal GB, matching the published table's unit; Number is exact far past
  // any ceiling in it (2^53 bytes ≈ 9 million TB).
  const gbMoved = Number(bytes) / 1e9;
  const peakPaths = peak?.peakPaths ?? 0;
  return {
    ...deriveTier(peakPaths, gbMoved),
    evidence: {
      peakPaths,
      ...(peak?.peakAt ? { peakAt: peak.peakAt } : {}),
      gbMoved,
    },
  };
}
