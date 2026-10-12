// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A YEAR, AS THE BILLING PAGE OFFERS IT (workplan 0111 T11, slice Y2).
 *
 * What a year bought now would be, read in the organisation's own scope: the
 * tiers it may be bought for (the tier the month bills or a higher one, the
 * owner's answer 3), each at six months of its monthly price (the price agreed
 * to for it, else the list's); where it would fall (`placeYear`); the credit
 * left and whether this month is one of a year's; and the years bought since
 * the latest withdrawal.
 *
 * The page sends back the tier, the price it showed and how many years it saw.
 * When any of them is not what is offered now (a second press, another tab, a
 * year bought in between), the order is refused as `offer_changed`, and the
 * page shows what is offered now, as a pick is (`decidePick`).
 */

import type { PgDatabase } from '@openmig/ledger/db';
import type { TenantId } from '@openmig/shared';
import { monthOf } from './billing-from.ts';
import { priceOfTier, readAgreedPrices } from './month-invoice.ts';
import { readBilledNow } from './pace.ts';
import type { ManagedTier } from './tier-calculator.ts';
import {
  creditForMonth,
  readDraws,
  readYearPlacement,
  readYears,
  yearTiers,
  type CreditForMonth,
  type YearBought,
  type YearPlacement,
} from './year-credit.ts';

/** A tier a year may be bought for, at its price. */
export interface YearOfferTier {
  readonly id: Exclude<ManagedTier['id'], 'free'>;
  readonly name: string;
  /** Its monthly price, agreed or the list's, in cents. */
  readonly monthlyCents: number;
  /** The year: six months of it, in cents. */
  readonly yearCents: number;
  readonly priceFrom: 'agreed' | 'list';
}

/** What a year bought now would be, and what the organisation holds. */
export interface YearOffer {
  /** The tier this month bills. */
  readonly billed: { readonly id: ManagedTier['id']; readonly name: string };
  readonly tiers: readonly YearOfferTier[];
  readonly placement: YearPlacement;
  /** The credit this month may draw, and whether it is one of a year's twelve. */
  readonly credit: CreditForMonth;
  /**
   * The credit held: what the years since the latest withdrawal gave, less
   * every draw, whether or not its first month has come. A year bought in a
   * month already billed pays from the next, so this month may draw none of
   * it, and yet it is held.
   */
  readonly heldCents: number;
  readonly years: readonly YearBought[];
}

/** How many months of the monthly price a year costs (ADR-0014: *"a year costs six months"*). */
export const YEAR_IN_MONTHLY_PRICES = 6;

/** The offer, read in the organisation's own scope. */
export async function readYearOffer(db: PgDatabase, tenantId: TenantId, now: Date): Promise<YearOffer> {
  const state = await readBilledNow(db, tenantId, now);
  const agreed = await readAgreedPrices(db, tenantId, now);
  const years = await readYears(db, tenantId);
  const draws = await readDraws(db, tenantId);
  const tiers = yearTiers(state.billed.tier).map((tier) => {
    const price = priceOfTier(tier, agreed);
    return {
      id: tier.id as YearOfferTier['id'],
      name: tier.name,
      monthlyCents: price.cents,
      yearCents: price.cents * YEAR_IN_MONTHLY_PRICES,
      priceFrom: price.from,
    };
  });
  return {
    billed: { id: state.billed.tier.id, name: state.billed.tier.name },
    tiers,
    placement: await readYearPlacement(db, tenantId, now),
    credit: creditForMonth(monthOf(now), years, draws),
    heldCents: years.reduce((sum, y) => sum + y.cents, 0) - draws.reduce((sum, d) => sum + d.cents, 0),
    years,
  };
}

/** What the page sent: the tier, the year's price it showed, and how many years it saw. */
export interface YearAsk {
  readonly tierId: string;
  readonly yearCents: number;
  readonly yearsBefore: number;
}

export type YearDecision =
  | { readonly ok: true; readonly tier: YearOfferTier }
  | { readonly ok: false; readonly reason: 'offer_changed' };

/** Whether what the page sent is what is offered now. */
export function decideYear(offer: YearOffer, ask: YearAsk): YearDecision {
  const tier = offer.tiers.find((t) => t.id === ask.tierId);
  if (!tier || tier.yearCents !== ask.yearCents || offer.years.length !== ask.yearsBefore) {
    return { ok: false, reason: 'offer_changed' };
  }
  return { ok: true, tier };
}
