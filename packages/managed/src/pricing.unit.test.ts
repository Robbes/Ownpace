// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The price template and the stored agreement.
 *
 * Two properties carry real money and are pinned here: a misread env var must
 * THROW rather than silently become a wrong price, and a half-written stored
 * agreement must read as "no agreement" rather than half-merge with today's
 * template.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PRICING,
  VAT_RATE,
  parsePinnedPricing,
  pricingFromEnv,
  type PricingConfig,
} from './pricing.ts';

describe('pricingFromEnv — the operator template', () => {
  it('is the built-in price list when nothing is set', () => {
    expect(pricingFromEnv({})).toEqual(DEFAULT_PRICING);
  });

  it('treats a blank value as unset rather than as zero', () => {
    // `PRICING_BASE_FEE_CENTS=` in a .env file is somebody who has not filled
    // it in yet, not somebody offering a free product.
    expect(pricingFromEnv({ PRICING_BASE_FEE_CENTS: '   ' }).baseFee).toBe(DEFAULT_PRICING.baseFee);
  });

  it('reads each price independently, keeping the built-in for the rest', () => {
    const p = pricingFromEnv({ PRICING_COMPUTE_PER_HOUR_CENTS: '12' });
    expect(p.computePricePerHour).toBe(12);
    expect(p.baseFee).toBe(DEFAULT_PRICING.baseFee);
    expect(p.storagePricePerGB).toBe(DEFAULT_PRICING.storagePricePerGB);
    expect(p.egressPricePerGB).toBe(DEFAULT_PRICING.egressPricePerGB);
  });

  it('accepts zero — a deliberately free component is a real choice', () => {
    expect(pricingFromEnv({ PRICING_EGRESS_PER_GB_CENTS: '0' }).egressPricePerGB).toBe(0);
  });

  it('THROWS on euros where cents belong, naming the variable', () => {
    // The dangerous typo: 9.99 would round to 9 cents and bill a hundredth of
    // the intended amount on every invoice, forever, silently.
    expect(() => pricingFromEnv({ PRICING_BASE_FEE_CENTS: '9.99' })).toThrow(
      /PRICING_BASE_FEE_CENTS.*CENTS/s,
    );
  });

  it('THROWS on a negative price and on text', () => {
    expect(() => pricingFromEnv({ PRICING_STORAGE_PER_GB_CENTS: '-1' })).toThrow(
      /PRICING_STORAGE_PER_GB_CENTS/,
    );
    expect(() => pricingFromEnv({ PRICING_COMPUTE_PER_HOUR_CENTS: 'five' })).toThrow(
      /PRICING_COMPUTE_PER_HOUR_CENTS/,
    );
  });
});

describe('parsePinnedPricing — reading a tenant agreement back', () => {
  const agreed: PricingConfig = {
    baseFee: 1499,
    storagePricePerGB: 8,
    egressPricePerGB: 15,
    computePricePerHour: 3,
  };

  it('round-trips a complete agreement', () => {
    expect(parsePinnedPricing({ ...agreed })).toEqual(agreed);
  });

  it('ignores extra keys — a stored row may outlive this shape', () => {
    expect(parsePinnedPricing({ ...agreed, legacyDiscount: 5 })).toEqual(agreed);
  });

  it('reads a PARTIAL agreement as no agreement at all', () => {
    // Half-merging would combine this customer's agreed base fee with today's
    // compute rate, producing an invoice no document anywhere describes.
    const { computePricePerHour: _dropped, ...partial } = agreed;
    expect(parsePinnedPricing(partial)).toBeNull();
  });

  it('rejects non-integer, negative and non-numeric prices', () => {
    expect(parsePinnedPricing({ ...agreed, baseFee: 14.99 })).toBeNull();
    expect(parsePinnedPricing({ ...agreed, baseFee: -1 })).toBeNull();
    expect(parsePinnedPricing({ ...agreed, baseFee: '1499' })).toBeNull();
  });

  it('rejects the empty and absent cases', () => {
    expect(parsePinnedPricing(null)).toBeNull();
    expect(parsePinnedPricing(undefined)).toBeNull();
    expect(parsePinnedPricing({})).toBeNull();
    expect(parsePinnedPricing('999')).toBeNull();
  });
});

describe('VAT is not part of the agreement', () => {
  it('is a single rate, not a per-tenant field', () => {
    expect(VAT_RATE).toBe(0.21);
    expect(Object.keys(DEFAULT_PRICING)).not.toContain('vatRate');
    // A stored agreement carrying a vatRate must not gain one by being parsed:
    // a tax rate set by a government cannot be pinned to a customer.
    expect(parsePinnedPricing({ ...DEFAULT_PRICING, vatRate: 0.09 })).toEqual(DEFAULT_PRICING);
  });
});
