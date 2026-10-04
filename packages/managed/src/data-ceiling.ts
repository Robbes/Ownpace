// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The data ceiling, and the yes that moves it (workplan 0109 T6, ADR-0014's
 * amendment of 2026-10-03).
 *
 * Every step up is consented and paid for. At the data ceiling the customer
 * chooses between the two ways out ADR-0014 prices — **move up a tier, or buy
 * a one-off top-up** (*tiers buy lanes; top-ups buy room*) — and nothing moves
 * the ceiling without that yes. Both are offered from 80% on.
 *
 * ## The allowance is a sum of granted bands
 *
 * ADR-0014's consequence 5: *"the allowance — a sum of granted bands, so a
 * top-up adds a row and nothing is rewound"*. The rows are `data_allowance`
 * (managed migration 0037), one per yes. The ceiling is the band of the
 * highest tier the customer moved up to — Tiny's until they move — plus every
 * top-up band bought. `bytes_moved` is never touched: a top-up raises the
 * ceiling, it never rewinds the meter, so a past month stays reconstructible.
 *
 * ## What each way out costs
 *
 * - **Moving up** costs the difference in setup fees, once, then the new
 *   tier's monthly price: *"stepping up later costs the difference in setup,
 *   once"*. It goes to the smallest tier above the current one whose ceiling
 *   is past what has moved, so a yes always lifts the hold.
 * - **A top-up** buys another band of the tier the customer is on, at the
 *   price `topUpPriceEur` names. Tiny has none: its fee is nothing, so a
 *   top-up would make the data axis mean nothing, and from Tiny the only way
 *   out is moving up.
 *
 * Prices come from `MANAGED_TIERS`, the third copy of ADR-0014's table, held
 * to the ADR by `tier-calculator.unit.test.ts`. A yes stores the price the
 * customer was shown (`data_allowance.price_eur`), so a later list change
 * never re-prices what was agreed.
 *
 * ## During the alpha
 *
 * The owner's answer of 2026-10-03, *"A"*: while the deployment's stage is
 * `alpha` the ceiling warns and nothing holds, and no yes is taken, since
 * nothing is charged during the alpha (0131 D1). That is the callers' rule
 * (`holdsAtCeiling`), not this file's arithmetic, which is the same either way.
 */

import { asc, eq } from 'drizzle-orm';
import type { PgDatabase } from '@openmig/ledger/db';
import type { TenantId } from '@openmig/shared';
import { dataAllowance } from './schema-managed.ts';
import { MANAGED_TIERS, type ManagedTier } from './tier-calculator.ts';

/** The tiers a yes can name: every one but Tiny, which is where everybody starts. */
export type PaidTierId = 'small' | 'medium' | 'large' | 'xl';

/** One yes, as the ceiling reads it. */
export interface AllowanceGrant {
  readonly kind: 'tier' | 'top_up';
  readonly tierId: PaidTierId;
  /** The band this yes adds, in decimal GB (1 TB = 1000 GB, the table's unit). */
  readonly bandGb: number;
}

/** What the customer has agreed to: their tier, and how far their data may go. */
export interface Allowance {
  /** The highest tier the customer moved up to; Tiny until they do. */
  readonly tier: ManagedTier;
  /** The data ceiling in decimal GB: the tier's band plus every band bought. */
  readonly ceilingGb: number;
  /** How many top-up bands were bought. */
  readonly topUps: number;
}

/** The share of the ceiling from which both ways out are offered (ADR-0014: "at 80%"). */
export const WARN_AT_SHARE = 0.8;

/** The tier with this id, from the published table. */
function tierById(id: ManagedTier['id']): ManagedTier {
  const tier = MANAGED_TIERS.find((t) => t.id === id);
  if (!tier) throw new Error(`no tier '${id}' in the published table`);
  return tier;
}

/**
 * The allowance a set of yeses adds up to.
 *
 * The highest tier wins, whatever order the rows came in: the data axis never
 * falls, so a yes to a smaller tier after a bigger one changes nothing. Every
 * top-up counts, whichever tier it was bought on: a purchase never expires.
 */
export function allowanceOf(grants: ReadonlyArray<AllowanceGrant>): Allowance {
  let tierIndex = 0; // Tiny, where everybody starts.
  let topUpGb = 0;
  let topUps = 0;
  for (const grant of grants) {
    if (grant.kind === 'tier') {
      tierIndex = Math.max(tierIndex, MANAGED_TIERS.findIndex((t) => t.id === grant.tierId));
    } else {
      topUpGb += grant.bandGb;
      topUps += 1;
    }
  }
  const tier = MANAGED_TIERS[tierIndex]!;
  return { tier, ceilingGb: tier.dataGb + topUpGb, topUps };
}

/**
 * What one top-up band of this tier costs, once; `null` on Tiny, which has none.
 *
 * The rule in force: *"pay your setup fee again and your allowance grows by
 * another whole band"* (ADR-0014). The accepted list of 2026-09-29 prices it at
 * a month's price instead, and comes into force with 0152 T6 (d), which changes
 * this one function.
 */
export function topUpPriceEur(tier: ManagedTier): number | null {
  if (tier.id === 'tiny') return null;
  return tier.setup;
}

/** Moving up: to which tier, and what it costs. */
export interface MoveUpOffer {
  readonly tier: ManagedTier;
  /** Once: the new tier's setup fee less the one already paid. */
  readonly setupEur: number;
  /** Then each month, the new tier's price. */
  readonly monthlyEur: number;
  /** The ceiling after the yes, top-ups already bought included. */
  readonly ceilingGb: number;
}

/** A top-up: one more band of the tier the customer is on. */
export interface TopUpOffer {
  readonly tierId: PaidTierId;
  readonly bandGb: number;
  /** Once; the monthly price does not change. */
  readonly priceEur: number;
  /** The ceiling after the yes. */
  readonly ceilingGb: number;
}

export interface Ceiling {
  readonly allowance: Allowance;
  /** Cumulative first-copy data, in decimal GB (`bytes_moved`). */
  readonly gbMoved: number;
  /** `gbMoved` over the ceiling: 1 or more at the ceiling. */
  readonly share: number;
  /**
   * `under` below 80%; `near` from 80%, where both ways out are offered;
   * `reached` at the ceiling, where new first copies hold for the yes.
   */
  readonly state: 'under' | 'near' | 'reached';
  /** Null past Extra large, where the published answer is "talk to us". */
  readonly moveUp: MoveUpOffer | null;
  /** Null on Tiny, which has no top-up. */
  readonly topUp: TopUpOffer | null;
}

/** The customer's ceiling, where their data stands against it, and the two ways on. */
export function ceilingOf(allowance: Allowance, gbMoved: number): Ceiling {
  const topUpGb = allowance.ceilingGb - allowance.tier.dataGb;
  const from = MANAGED_TIERS.findIndex((t) => t.id === allowance.tier.id);
  // The smallest tier above this one whose ceiling is past what has moved, so
  // a yes to it lifts the hold rather than landing on it.
  const next = MANAGED_TIERS.slice(from + 1).find((t) => t.dataGb + topUpGb > gbMoved) ?? null;
  const topUpPrice = topUpPriceEur(allowance.tier);
  const share = allowance.ceilingGb > 0 ? gbMoved / allowance.ceilingGb : 1;
  return {
    allowance,
    gbMoved,
    share,
    state: gbMoved >= allowance.ceilingGb ? 'reached' : share >= WARN_AT_SHARE ? 'near' : 'under',
    moveUp: next
      ? {
          tier: next,
          setupEur: Math.max(0, next.setup - allowance.tier.setup),
          monthlyEur: next.monthly,
          ceilingGb: next.dataGb + topUpGb,
        }
      : null,
    topUp:
      topUpPrice === null
        ? null
        : {
            tierId: allowance.tier.id as PaidTierId,
            bandGb: allowance.tier.dataGb,
            priceEur: topUpPrice,
            ceilingGb: allowance.ceilingGb + allowance.tier.dataGb,
          },
  };
}

/** What the customer says yes to, as the page sends it back: the offer they were shown. */
export interface Yes {
  readonly choice: 'move_up' | 'top_up';
  readonly tierId: string;
  readonly priceEur: number;
}

/** The row a yes becomes, or why it is not taken. */
export type YesDecision =
  | { readonly ok: true; readonly grant: AllowanceGrant & { readonly priceEur: number } }
  | {
      readonly ok: false;
      /**
       * `no_top_up_on_tiny`: Tiny has none. `talk_to_us`: there is no tier past
       * this one. `offer_changed`: the tier or the price the page sent is not
       * what is offered now, so nobody agrees to a price they were not shown.
       */
      readonly reason: 'no_top_up_on_tiny' | 'talk_to_us' | 'offer_changed';
    };

/**
 * The row a yes becomes, checked against what is offered now.
 *
 * The page sends back the tier and the price it showed. A meter that moved,
 * or a yes given in another tab, can change the offer between the showing and
 * the press; then the yes is refused and the page shows the new offer, rather
 * than the customer agreeing to a tier or a price they never saw.
 */
export function decideYes(ceiling: Ceiling, yes: Yes): YesDecision {
  if (yes.choice === 'top_up') {
    const offer = ceiling.topUp;
    if (!offer) return { ok: false, reason: 'no_top_up_on_tiny' };
    if (yes.tierId !== offer.tierId || yes.priceEur !== offer.priceEur) return { ok: false, reason: 'offer_changed' };
    return { ok: true, grant: { kind: 'top_up', tierId: offer.tierId, bandGb: offer.bandGb, priceEur: offer.priceEur } };
  }
  const offer = ceiling.moveUp;
  if (!offer) return { ok: false, reason: 'talk_to_us' };
  if (yes.tierId !== offer.tier.id || yes.priceEur !== offer.setupEur) return { ok: false, reason: 'offer_changed' };
  return {
    ok: true,
    grant: {
      kind: 'tier',
      tierId: offer.tier.id as PaidTierId,
      bandGb: tierById(offer.tier.id).dataGb,
      priceEur: offer.setupEur,
    },
  };
}

/**
 * Does the ceiling hold new first copies in this deployment?
 *
 * Not during the alpha (the owner, 2026-10-03: *"A"*): the alpha is free and
 * nothing is charged, so a tester's migration is never stopped by a price
 * they would not pay, and no yes is taken. Everywhere else, yes.
 */
export function holdsAtCeiling(stage: string | undefined): boolean {
  return stage?.trim().toLowerCase() !== 'alpha';
}

/** The yeses on record, oldest first. Call inside `withTenant`, like every store here. */
export class PgDataAllowanceStore {
  private readonly db: PgDatabase;

  constructor(db: PgDatabase) {
    this.db = db;
  }

  async grants(tenantId: TenantId): Promise<AllowanceGrant[]> {
    const rows = await this.db
      .select({ kind: dataAllowance.kind, tierId: dataAllowance.tierId, bandGb: dataAllowance.bandGb })
      .from(dataAllowance)
      .where(eq(dataAllowance.tenantId, tenantId))
      .orderBy(asc(dataAllowance.consentedAt));
    return rows;
  }

  /** Record one yes. Append-only: the table refuses UPDATE and DELETE to the app. */
  async record(
    tenantId: TenantId,
    grant: AllowanceGrant & { readonly priceEur: number },
    consentedBy: string,
  ): Promise<void> {
    await this.db.insert(dataAllowance).values({
      tenantId,
      kind: grant.kind,
      tierId: grant.tierId,
      bandGb: grant.bandGb,
      priceEur: grant.priceEur,
      consentedBy,
    });
  }
}
