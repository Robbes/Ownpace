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
 * highest tier the customer moved up to — Free's until they move — plus every
 * top-up band bought. `bytes_moved` is never touched: a top-up raises the
 * ceiling, it never rewinds the meter, so a past month stays reconstructible.
 *
 * ## What each way out costs
 *
 * - **Moving up** costs the new tier's monthly price, and nothing once: the
 *   price list of 2026-09-29 has no setup fee (ADR-0014, in force with 0152
 *   T6 (d)). It goes to the smallest tier above the current one whose ceiling
 *   is past what has moved, so a yes always lifts the hold.
 * - **A top-up** buys another band of the tier the customer is on, at the
 *   price `topUpPriceEur` names: the tier's monthly price, once. Free has
 *   none: its price is nothing, so a top-up would make the data axis mean
 *   nothing, and from Free the only way out is moving up.
 *
 * Prices come from `MANAGED_TIERS`, the third copy of ADR-0014's table, held
 * to the ADR by `tier-calculator.unit.test.ts`. A yes stores the price the
 * customer was shown (`data_allowance.price_eur`): a move up's monthly price,
 * or a top-up's price once. A later list change never re-prices what was
 * agreed. The column is whole euros; every monthly price on the list is, and
 * `data-ceiling.unit.test.ts` says so.
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
import type { PauseReason, TenantId } from '@openmig/shared';
import { PgBytesMovedStore } from './bytes-moved.ts';
import { dataAllowance } from './schema-managed.ts';
import { MANAGED_TIERS, type ManagedTier } from './tier-calculator.ts';

/** The tiers a yes can name: every one but Free, which is where everybody starts. */
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
  /** The highest tier the customer moved up to; Free until they do. */
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
  let tierIndex = 0; // Free, where everybody starts.
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

/** A tier's monthly price in whole euros, the unit a yes is recorded in. */
export function monthlyEur(tier: ManagedTier): number {
  return tier.monthlyCents / 100;
}

/**
 * What one top-up band of this tier costs, once; `null` on Free, which has none.
 *
 * The tier's monthly price, once: the owner's answer (b) to the list of
 * 2026-09-29 (ADR-0014), in force with 0152 T6 (d). It was the setup fee
 * again until then.
 */
export function topUpPriceEur(tier: ManagedTier): number | null {
  if (tier.id === 'free') return null;
  return monthlyEur(tier);
}

/** Moving up: to which tier, and what it costs. There is nothing to pay once. */
export interface MoveUpOffer {
  readonly tier: ManagedTier;
  /** Each month, the new tier's price. */
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
  /** Null on Free, which has no top-up. */
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
          monthlyEur: monthlyEur(next),
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

/** The days a month counts for the break-even: an estimate said as "about". */
const DAYS_PER_MONTH = 30;

/** Topping up against moving up, side by side. */
export interface BreakEven {
  /** What the top-up costs once; a move up costs nothing once. */
  readonly extraOnceEur: number;
  /** What staying on the tier saves each month, against the move up's monthly price. */
  readonly savedMonthlyEur: number;
  /** About how many days until the top-up has paid back its extra; 0 when it costs no more once. */
  readonly paysBackInDays: number;
}

/**
 * The break-even between the two ways on, when both are offered.
 *
 * ADR-0014: *"at 80%, offer both and show the break-even"*. On Small, another
 * band is €5 once and the monthly stays €5; Medium is €12 a month and nothing
 * once. The top-up costs €5 more once and saves €7 a month, so it pays back
 * in about three weeks. The ADR also says *"say plainly when the tier is the
 * better buy"*: that is when more migrations must run at once, which the page
 * says beside this, from each tier's paths.
 */
export function breakEvenOf(ceiling: Ceiling): BreakEven | null {
  const { moveUp, topUp } = ceiling;
  if (!moveUp || !topUp) return null;
  const extraOnceEur = topUp.priceEur;
  const savedMonthlyEur = moveUp.monthlyEur - monthlyEur(ceiling.allowance.tier);
  if (savedMonthlyEur <= 0) return null;
  const paysBackInDays = extraOnceEur <= 0 ? 0 : Math.ceil((extraOnceEur / savedMonthlyEur) * DAYS_PER_MONTH);
  return { extraOnceEur, savedMonthlyEur, paysBackInDays };
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
       * `no_top_up_on_free`: Free has none. `talk_to_us`: there is no tier past
       * this one. `offer_changed`: the tier or the price the page sent is not
       * what is offered now, so nobody agrees to a price they were not shown.
       */
      readonly reason: 'no_top_up_on_free' | 'talk_to_us' | 'offer_changed';
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
    if (!offer) return { ok: false, reason: 'no_top_up_on_free' };
    if (yes.tierId !== offer.tierId || yes.priceEur !== offer.priceEur) return { ok: false, reason: 'offer_changed' };
    return { ok: true, grant: { kind: 'top_up', tierId: offer.tierId, bandGb: offer.bandGb, priceEur: offer.priceEur } };
  }
  const offer = ceiling.moveUp;
  if (!offer) return { ok: false, reason: 'talk_to_us' };
  if (yes.tierId !== offer.tier.id || yes.priceEur !== offer.monthlyEur) return { ok: false, reason: 'offer_changed' };
  return {
    ok: true,
    grant: {
      kind: 'tier',
      tierId: offer.tier.id as PaidTierId,
      bandGb: tierById(offer.tier.id).dataGb,
      priceEur: offer.monthlyEur,
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

/** Decimal, like the published table: the meter counts bytes, the table GB. */
const BYTES_PER_GB = 1_000_000_000;

/**
 * The question a pass asks before each new first copy (the hold, workplan 0109
 * T6): is the meter, with what this pass has copied so far, still below the
 * ceiling? `PassClock.firstCopyAllowed` in the engine's words.
 *
 * Asked before the copy, so within one pass the copy that crosses the ceiling
 * is the last one. A ceiling already reached when the pass starts holds every
 * new first copy from the first.
 *
 * The meter is read when the data type's pass begins and added to when it
 * ends, so passes of one organisation running at once each count from the
 * meter as it stood then, and together can pass the ceiling by up to the room
 * left, once per pass. That errs toward copying more than was paid for, never
 * less: ADR-0014, "it must under-bill, never halt".
 */
export function firstCopyGate(ceiling: Ceiling): (firstCopyBytesThisPass: number) => boolean {
  const before = ceiling.gbMoved * BYTES_PER_GB;
  const room = ceiling.allowance.ceilingGb * BYTES_PER_GB;
  return (firstCopyBytesThisPass) => before + firstCopyBytesThisPass < room;
}

/**
 * What the migration's status says while new first copies wait: how many
 * waited, the ceiling, and both ways on with their prices. ADR-0014: the hold
 * is announced with both prices, never a silent throttle.
 */
export function ceilingHoldReason(ceiling: Ceiling, held: number): PauseReason {
  return {
    kind: 'data-ceiling',
    ceilingGb: ceiling.allowance.ceilingGb,
    held,
    moveUp: ceiling.moveUp ? { name: ceiling.moveUp.tier.name, monthlyEur: ceiling.moveUp.monthlyEur } : null,
    topUp: ceiling.topUp ? { bandGb: ceiling.topUp.bandGb, priceEur: ceiling.topUp.priceEur } : null,
  };
}

/**
 * The organisation's ceiling as it stands: its yeses and its meter, read in the
 * caller's transaction (inside `withTenant`). The Billing page reads it, and so
 * does each data type's pass before it starts, for the hold.
 */
export async function readCeiling(db: PgDatabase, tenantId: TenantId): Promise<Ceiling> {
  const grants = await new PgDataAllowanceStore(db).grants(tenantId);
  const bytes = await new PgBytesMovedStore(db).total(tenantId);
  return ceilingOf(allowanceOf(grants), Number(bytes) / BYTES_PER_GB);
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

  /**
   * Record one yes. Append-only: the table refuses UPDATE and DELETE to the app.
   * `axis` says which limit asked (managed 0039): the data ceiling, or the
   * paths at *Start*. The tier agreed is one for both.
   */
  async record(
    tenantId: TenantId,
    grant: AllowanceGrant & { readonly priceEur: number },
    consentedBy: string,
    axis: 'data' | 'paths' = 'data',
  ): Promise<void> {
    await this.db.insert(dataAllowance).values({
      tenantId,
      kind: grant.kind,
      tierId: grant.tierId,
      bandGb: grant.bandGb,
      priceEur: grant.priceEur,
      consentedBy,
      axis,
    });
  }
}
