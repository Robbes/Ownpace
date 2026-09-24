// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AS MANY LIVE GRANT LINKS AS THE TIER RUNS MIGRATIONS (workplan 0108 T8 (d);
 * the owner, 2026-09-24: "the Recommended").
 *
 * An organisation may hold as many grant links that can still be used as its
 * tier runs migrations at the same time: Tiny 1, Small 4, Medium 20, Large 50,
 * Extra large 200. The tier is the one the organisation's own usage screen
 * shows, derived from what was measured without writing anything
 * (`observedTier`, as `routes/billing` reads it): a customer growing into the
 * next tier gets its number as they do. Past the end of the table the
 * published answer is "talk to us", and the largest tier's number stands until
 * somebody has.
 *
 * The operator may set another number for one organisation, for a burst or
 * below the tier, until a date or until cleared (`grant_link_allowance`,
 * managed migration 0028, written by `operator.sh links`). An override past
 * its date is no override: the tier's number stands again, without anybody
 * having to remember to take it back.
 *
 * Read inside the organisation's own transaction (`withTenant`): the override
 * is read under its policy, and the issue route counts and inserts in the same
 * transaction, so what was counted is what the limit was held against.
 */

import { sql } from 'drizzle-orm';
import type { PgDatabase } from '@openmig/ledger/db';
import { PgPathLifecycleStore } from '@openmig/ledger';
import type { TenantId } from '@openmig/shared';
import { PgOccupancyPeakStore } from './occupancy-peak.ts';
import { PgBytesMovedStore } from './bytes-moved.ts';
import { MANAGED_TIERS, observedTier, type ManagedTier } from './tier-calculator.ts';

/** The live grant links an organisation past the tier table may hold: the largest tier's. */
export const LIVE_LINKS_PAST_THE_TABLE = MANAGED_TIERS[MANAGED_TIERS.length - 1]!.paths;

/** The most and the fewest an override may set (the table's CHECK says the same). */
export const ALLOWANCE_MIN = 1;
export const ALLOWANCE_MAX = 1000;

/** The operator's number for one organisation, as the table holds it. */
export interface GrantLinkAllowance {
  readonly liveLinks: number;
  /** When it stops applying by itself; null keeps it until it is cleared. */
  readonly until: Date | null;
  readonly setBy: string;
  readonly setAt: Date;
  readonly note: string | null;
}

/** An organisation's limit, and where the number came from. */
export interface LiveLinkLimit {
  readonly limit: number;
  readonly from:
    | { readonly kind: 'tier'; readonly tier: ManagedTier }
    | { readonly kind: 'past_the_table' }
    | { readonly kind: 'override'; readonly until: Date | null };
}

/**
 * The limit, from the tier and the override: the override while it stands,
 * the tier's migrations at the same time otherwise, and the largest tier's
 * past the end of the table.
 */
export function liveLinkLimit(
  tier: ManagedTier | null,
  allowance: Pick<GrantLinkAllowance, 'liveLinks' | 'until'> | undefined,
  now: Date = new Date(),
): LiveLinkLimit {
  if (allowance && (allowance.until === null || allowance.until.getTime() > now.getTime())) {
    return { limit: allowance.liveLinks, from: { kind: 'override', until: allowance.until } };
  }
  if (tier) return { limit: tier.paths, from: { kind: 'tier', tier } };
  return { limit: LIVE_LINKS_PAST_THE_TABLE, from: { kind: 'past_the_table' } };
}

/**
 * The last day an override applies, as a person names it: `until` is the
 * moment it stops, the start of the next day for one set `--until` a day.
 */
export function lastDayOf(until: Date): string {
  return new Date(until.getTime() - 1).toISOString().slice(0, 10);
}

type Row = Record<string, unknown>;

/** The organisation's override, whether or not it still stands. */
export async function readGrantLinkAllowance(
  db: PgDatabase,
  tenantId: string,
): Promise<GrantLinkAllowance | undefined> {
  const found = (await db.execute(sql`
    SELECT live_links, until, set_by, set_at, note
      FROM public.grant_link_allowance
     WHERE tenant_id = ${tenantId}::uuid
  `)) as unknown as { rows: Row[] };
  const row = found.rows[0];
  if (!row) return undefined;
  return {
    liveLinks: Number(row.live_links),
    until: row.until === null || row.until === undefined ? null : new Date(String(row.until)),
    setBy: String(row.set_by),
    setAt: new Date(String(row.set_at)),
    note: row.note === null || row.note === undefined ? null : String(row.note),
  };
}

/**
 * The organisation's tier now, read as its usage screen reads it: this
 * month's recorded peak, the paths holding a slot now, and the meter. Nothing
 * is written: issuing a link prices nothing.
 */
export async function tierNow(db: PgDatabase, tenantId: string): Promise<ManagedTier | null> {
  const id = tenantId as TenantId;
  const peak = await new PgOccupancyPeakStore(db).forMonth(id, new Date());
  const pathsNow = await new PgPathLifecycleStore(db).slotsHeld(id);
  const bytes = await new PgBytesMovedStore(db).total(id);
  // Decimal GB, the tier table's unit, as every reader of the meter divides it.
  return observedTier(peak?.peakPaths ?? 0, pathsNow, Number(bytes) / 1e9).tier;
}

/** The organisation's limit now: its tier's number, or the operator's while it stands. */
export async function liveGrantLinkLimit(
  db: PgDatabase,
  tenantId: string,
  now: Date = new Date(),
): Promise<LiveLinkLimit> {
  return liveLinkLimit(await tierNow(db, tenantId), await readGrantLinkAllowance(db, tenantId), now);
}
