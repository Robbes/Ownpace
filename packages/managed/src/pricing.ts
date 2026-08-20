// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * What the product costs, said once (ADR-0014 cost-recovery pricing).
 *
 * THE ONE COPY. Until 2026-08-11 there were two: `defaultPricing` in the API's
 * billing service, and a `PRICING` literal in the worker's delta-sync job
 * carrying its own "should come from config/env in production" comment. The
 * API priced invoices from one and the worker metered compute against the
 * other, so a price change touched invoices and left every metered row behind
 * — two numbers that must agree, kept in two files, which is the failure this
 * repository normally polices (hard rule 5).
 *
 * TWO LAYERS, AND THE DIFFERENCE MATTERS:
 *
 *  - **The template** (`pricingFromEnv`) is the operator's current price list.
 *    It applies to tenants that have not agreed to anything yet.
 *  - **The agreement** (`tenant.pricing`, see @openmig/ledger's
 *    `resolveTenantPricing`) is the snapshot a tenant was signed up at. It is
 *    written once and never follows the template again.
 *
 * That split is the whole point: an operator must be able to change what NEW
 * customers pay without silently re-pricing the ones already being billed.
 * Raising the template should never reach into an existing invoice.
 *
 * VAT IS NOT IN HERE, deliberately. A tax rate is set by a government, not
 * agreed with a customer: when it changes, it changes for everyone, including
 * existing tenants. Pinning it per tenant would encode "this customer keeps
 * the old VAT rate", which is not a discount, it is a tax error.
 *
 * Money is INTEGER CENTS throughout — no float ever reaches an invoice.
 */

/** Prices, in integer cents. One tenant's agreed rates, or the operator's template. */
export interface PricingConfig {
  /** Monthly base fee. */
  readonly baseFee: number;
  /** Per GB of stored data, per month. */
  readonly storagePricePerGB: number;
  /** Per GB transferred out. */
  readonly egressPricePerGB: number;
  /** Per hour of sync compute. */
  readonly computePricePerHour: number;
}

/**
 * The built-in template: what the product charged before any of this was
 * configurable, and therefore what every tenant created up to 2026-08-11 was
 * being billed at. Migration 0007 backfills exactly these numbers into the
 * existing tenants' agreements, so making pricing configurable re-priced
 * nobody.
 */
export const DEFAULT_PRICING: PricingConfig = {
  baseFee: 999, // €9.99/month
  storagePricePerGB: 10, // €0.10/GB/month
  egressPricePerGB: 20, // €0.20/GB
  computePricePerHour: 5, // €0.05/hour
};

/** VAT, one rate, said once — see the header for why it is not per tenant. */
export const VAT_RATE = 0.21;

/** The env var that carries each price, for messages and for documentation. */
const ENV_KEYS: Readonly<Record<keyof PricingConfig, string>> = {
  baseFee: 'PRICING_BASE_FEE_CENTS',
  storagePricePerGB: 'PRICING_STORAGE_PER_GB_CENTS',
  egressPricePerGB: 'PRICING_EGRESS_PER_GB_CENTS',
  computePricePerHour: 'PRICING_COMPUTE_PER_HOUR_CENTS',
};

/**
 * Read one price from the environment. Absent means "keep the built-in";
 * present-but-nonsense THROWS.
 *
 * The loud failure is the point. The likely typo here is euros where cents
 * belong — `PRICING_BASE_FEE_CENTS=9.99` — and a lenient parser would read
 * that as 9 cents and quietly bill a hundredth of the intended amount, on
 * every invoice, until somebody noticed the revenue. A price nobody can
 * misread by accident is worth an unbootable API (hard rule 9).
 */
function readCents(env: NodeJS.ProcessEnv | Record<string, string | undefined>,
                   field: keyof PricingConfig): number {
  const key = ENV_KEYS[field];
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return DEFAULT_PRICING[field];
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `${key} must be a whole number of CENTS (got "${raw}"). ` +
        'Prices are integer cents, never euros: €9.99/month is 999, not 9.99. ' +
        `Leave it unset to keep the built-in ${DEFAULT_PRICING[field]}.`,
    );
  }
  return value;
}

/**
 * The operator's current price list, from `PRICING_*` env vars.
 *
 * Applies to tenants with no agreement of their own yet — which, after the
 * 0007 backfill, means new ones. Changing these values never re-prices an
 * existing tenant; that is what `tenant.pricing` is for.
 */
export function pricingFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): PricingConfig {
  return {
    baseFee: readCents(env, 'baseFee'),
    storagePricePerGB: readCents(env, 'storagePricePerGB'),
    egressPricePerGB: readCents(env, 'egressPricePerGB'),
    computePricePerHour: readCents(env, 'computePricePerHour'),
  };
}

/**
 * Read a tenant's stored agreement back.
 *
 * Returns null for anything that is not a complete, valid price list — a
 * missing column, a half-written object, a string where a number belongs.
 * Null means "this tenant has not agreed to anything", which the resolver
 * answers by pinning the template; guessing the missing halves from the
 * current template instead would silently mix one customer's agreed base fee
 * with today's compute rate, and no invoice would ever say so.
 */
export function parsePinnedPricing(value: unknown): PricingConfig | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const field of Object.keys(ENV_KEYS) as Array<keyof PricingConfig>) {
    const v = raw[field];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return null;
    out[field] = v;
  }
  return out as unknown as PricingConfig;
}
