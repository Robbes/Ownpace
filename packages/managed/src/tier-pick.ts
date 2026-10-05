// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TIER A PERSON PICKS (workplan 0157 T6; ADR-0014, *Amendment 2026-10-04,
 * evening*).
 *
 * The owner, 2026-10-04: *"yes someone may pick a tier. So Free can pick
 * higher if they see fit."* A tier is derived from what is used; a person may
 * pick a higher one, for its pace or its room. The month then bills the higher
 * of the picked tier and the derived one, and the automatic downgrade stops at
 * the picked tier. Lowering the pick is the person's own action, from the next
 * month (0157 §6).
 *
 * ## One rule for raising and lowering
 *
 * A month bills at least the pick standing when it began, and every pick made
 * during it. So a raise counts at once, as the person agreed to pay it from
 * that day, and a lower pick counts from the next month, the first to begin
 * with it standing. Free is the pick of no floor. Months are UTC, as the
 * peak's are (`occupancy_peak`, managed 0015), so the floor and what was used
 * are measured over the same month.
 *
 * ## A pick is a yes
 *
 * Picking is the person's own yes (*Amendment 2026-10-03*), so a pick above
 * the agreed tier is recorded as a yes as well (`data_allowance`, axis `pick`),
 * and the agreed tier, the highest said yes to, brings the picked tier's room.
 * A lower pick takes no yes back: what was agreed stays agreed, and a month
 * still bills what it used, never above it (`billedTierOf`).
 *
 * ## What is offered
 *
 * Every tier above the one this month bills: picking one at or below it would
 * change nothing this month. While a lower pick waits for the next month, the
 * tier picked now is offered as well, to keep it. Lower: every tier below the
 * pick that stands for the next month, down to Free.
 *
 * The page sends back the tier and the monthly price it showed. When either is
 * not what is offered now (a pick in another tab, a list that changed), the
 * pick is refused as `offer_changed` and the page shows what is offered now,
 * as a yes at the data ceiling is (`decideYes`).
 *
 * ## During the alpha
 *
 * No pick is taken; that is the routes' rule, as it is for every yes. While the
 * alpha lasts every tier's pace and room are a tester's for nothing (the owner,
 * 2026-10-04), so a pick would change nothing a tester sees, and once the
 * alpha ended it would bind them to a price they never ordered.
 */

import { asc, eq } from 'drizzle-orm';
import type { PgDatabase } from '@openmig/ledger/db';
import type { TenantId } from '@openmig/shared';
import { monthlyEur, type Allowance, type AllowanceGrant, type PaidTierId } from './data-ceiling.ts';
import { tierPick } from './schema-managed.ts';
import { MANAGED_TIERS, type ManagedTier } from './tier-calculator.ts';

/** One pick, as the floor reads it. */
export interface TierPickRow {
  readonly tierId: ManagedTier['id'];
  readonly pickedAt: Date;
}

/** The least the picks let a month bill. Null is no floor: what was used decides. */
export interface PickedFloor {
  /** This month: the pick standing when it began, or a higher one made since. */
  readonly now: ManagedTier | null;
  /** The next month, as it stands: the latest pick. */
  readonly next: ManagedTier | null;
  /** When the next month begins, UTC. */
  readonly nextFrom: Date;
}

/** A tier's place in the published table; Free is 0. */
const placeOf = (id: string): number => Math.max(0, MANAGED_TIERS.findIndex((t) => t.id === id));

/** The floor at a place: Free's is none. */
const floorAt = (place: number): ManagedTier | null => (place > 0 ? MANAGED_TIERS[place]! : null);

/** The first moment of the UTC month that `at` falls in. */
export function monthStartOf(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

/** The first moment of the UTC month after the one `at` falls in. */
export function nextMonthStartOf(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
}

/**
 * The least the month that `at` falls in bills by the picks made up to `at`,
 * and the least the next month will, as things stand.
 */
export function pickedFloorOf(picks: ReadonlyArray<TierPickRow>, at: Date): PickedFloor {
  const monthStart = monthStartOf(at).getTime();
  let standing = 0; // the pick standing when the month began: none until a pick
  let since = 0; // the highest pick made during the month
  let latest = 0;
  const made = picks
    .filter((p) => p.pickedAt.getTime() <= at.getTime())
    .sort((a, b) => a.pickedAt.getTime() - b.pickedAt.getTime());
  for (const pick of made) {
    const place = placeOf(pick.tierId);
    if (pick.pickedAt.getTime() < monthStart) standing = place;
    else since = Math.max(since, place);
    latest = place;
  }
  return { now: floorAt(Math.max(standing, since)), next: floorAt(latest), nextFrom: nextMonthStartOf(at) };
}

/** What a person may pick now. */
export interface PickOffers {
  /** At once: every tier above the one this month bills, and the one picked now while a lower pick waits. */
  readonly raise: readonly ManagedTier[];
  /** From the next month: every tier below the pick standing for it, Free for none. */
  readonly lower: readonly ManagedTier[];
}

/** The picks offered, from the tier this month bills and the floor the picks make. */
export function pickOffers(billed: ManagedTier, floor: PickedFloor): PickOffers {
  const billedPlace = placeOf(billed.id);
  const nowPlace = floor.now ? placeOf(floor.now.id) : 0;
  const nextPlace = floor.next ? placeOf(floor.next.id) : 0;
  const keep = nextPlace < nowPlace ? nowPlace : -1;
  return {
    raise: MANAGED_TIERS.filter((_, place) => place > billedPlace || place === keep),
    lower: MANAGED_TIERS.filter((_, place) => place < nextPlace),
  };
}

/** A pick as the page sends it: the tier, and the monthly price it showed. */
export interface Pick {
  readonly tierId: string;
  readonly priceEur: number;
}

export type PickDecision =
  | {
      readonly ok: true;
      /** The row the pick becomes. */
      readonly pick: { readonly tierId: ManagedTier['id']; readonly priceEur: number };
      /** At once, or from the next month. */
      readonly from: 'now' | 'next_month';
      /** The yes it carries when the tier is above the agreed one; null otherwise. */
      readonly yes: (AllowanceGrant & { readonly priceEur: number }) | null;
    }
  | {
      readonly ok: false;
      /** The tier or the price sent is not what is offered now. */
      readonly reason: 'offer_changed';
    };

/**
 * The rows a pick becomes, checked against what is offered now and the tier
 * agreed, so nobody picks a tier or a price they were not shown.
 */
export function decidePick(offers: PickOffers, allowance: Allowance, pick: Pick): PickDecision {
  const raise = offers.raise.find((t) => t.id === pick.tierId);
  const tier = raise ?? offers.lower.find((t) => t.id === pick.tierId);
  if (!tier || pick.priceEur !== monthlyEur(tier)) return { ok: false, reason: 'offer_changed' };
  const aboveAgreed = placeOf(tier.id) > placeOf(allowance.tier.id);
  return {
    ok: true,
    pick: { tierId: tier.id, priceEur: monthlyEur(tier) },
    from: raise ? 'now' : 'next_month',
    yes:
      raise && aboveAgreed
        ? { kind: 'tier', tierId: tier.id as PaidTierId, bandGb: tier.dataGb, priceEur: monthlyEur(tier) }
        : null,
  };
}

/** The picks on record. Call inside `withTenant`, like every store here. */
export class PgTierPickStore {
  private readonly db: PgDatabase;

  constructor(db: PgDatabase) {
    this.db = db;
  }

  /**
   * Oldest first. Which tier and when, nothing else: what the system role may
   * read when the tick asks what a month bills (managed 0044).
   */
  async picks(tenantId: TenantId): Promise<TierPickRow[]> {
    return this.db
      .select({ tierId: tierPick.tierId, pickedAt: tierPick.pickedAt })
      .from(tierPick)
      .where(eq(tierPick.tenantId, tenantId))
      .orderBy(asc(tierPick.pickedAt));
  }

  /**
   * Record one pick. Append-only: the table refuses UPDATE and DELETE to the app.
   * `pickedAt` is the moment the pick was decided at, so the month it counts in
   * is the one its decision read, whatever the database's clock says.
   */
  async record(
    tenantId: TenantId,
    pick: { readonly tierId: ManagedTier['id']; readonly priceEur: number },
    pickedBy: string,
    pickedAt: Date,
  ): Promise<void> {
    await this.db
      .insert(tierPick)
      .values({ tenantId, tierId: pick.tierId, priceEur: pick.priceEur, pickedBy, pickedAt });
  }
}
