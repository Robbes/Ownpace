// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Money in whole cents, and a line's price by treatment (workplan 0111,
 * slice 2; open decision 9).
 *
 * What matters here: the reverse-charge prices the owner agreed to come out
 * to the cent from the published prices and the administration's own rate
 * (Small €4,13, Medium €9,92, Large €33,06, Extra large €66,12); no float
 * touches a cent; and a figure finer than a cent is refused, never rounded.
 */

import { describe, it, expect } from 'vitest';
import {
  basisPointsFromPercentage,
  centsFromDecimal,
  decimalFromCents,
  linePriceFor,
  priceWithoutVatCents,
} from './line-price.ts';
import { MANAGED_TIERS } from './tier-calculator.ts';

describe('decimalFromCents and centsFromDecimal', () => {
  it('cross between cents and Moneybird’s strings without losing a cent', () => {
    expect(decimalFromCents(992)).toBe('9.92');
    expect(decimalFromCents(1200)).toBe('12.00');
    expect(decimalFromCents(5)).toBe('0.05');
    expect(decimalFromCents(-1200)).toBe('-12.00');
    for (const cents of [0, 1, 99, 100, 413, 992, 3306, 6612, 48000, -413]) {
      expect(centsFromDecimal(decimalFromCents(cents))).toBe(cents);
    }
    expect(centsFromDecimal('12.0')).toBe(1200);
    expect(centsFromDecimal('9.920')).toBe(992);
    expect(centsFromDecimal(12)).toBe(1200);
  });

  it('refuses what is not a whole number of cents, or not a number', () => {
    for (const value of ['9.915', '1e3', '12,00', '', ' ', 'twelve', null, undefined, {}, Number.NaN]) {
      expect(centsFromDecimal(value)).toBeNull();
    }
    expect(() => decimalFromCents(9.5)).toThrow(RangeError);
  });
});

describe('basisPointsFromPercentage', () => {
  it('reads Moneybird’s percentage, and nothing it cannot read exactly', () => {
    expect(basisPointsFromPercentage('21.0')).toBe(2100);
    expect(basisPointsFromPercentage('9')).toBe(900);
    expect(basisPointsFromPercentage('0.0')).toBe(0);
    expect(basisPointsFromPercentage('5.55')).toBe(555);
    for (const value of [null, '', '-21.0', '21.005', 'eenentwintig']) {
      expect(basisPointsFromPercentage(value)).toBeNull();
    }
  });
});

describe('priceWithoutVatCents', () => {
  it('gives the reverse-charge prices the owner agreed to, from the published ones (decision 9)', () => {
    const agreed: Record<string, number> = { small: 413, medium: 992, large: 3306, xl: 6612 };
    for (const tier of MANAGED_TIERS.filter((t) => t.monthlyCents > 0)) {
      expect(priceWithoutVatCents(tier.monthlyCents, 2100), tier.name).toBe(agreed[tier.id]);
    }
  });

  it('rounds to the nearest cent, a half up, in integers', () => {
    // 121 cents at 21% is exactly 100; 7320 is 6049.59, so 6050.
    expect(priceWithoutVatCents(121, 2100)).toBe(100);
    expect(priceWithoutVatCents(7320, 2100)).toBe(6050);
    // At 100% a price halves: 1 cent is 0.5, up to 1; 3 is 1.5, up to 2.
    expect(priceWithoutVatCents(1, 10_000)).toBe(1);
    expect(priceWithoutVatCents(3, 10_000)).toBe(2);
    expect(priceWithoutVatCents(1, 0)).toBe(1);
  });
});

describe('linePriceFor', () => {
  it('a consumer’s line is the published price, VAT inside', () => {
    expect(linePriceFor('domestic_standard', 1200, '21.0')).toEqual({ kind: 'priced', cents: 1200, pricesAreInclTax: true });
    expect(linePriceFor('destination_oss', 1200, '21.0')).toEqual({ kind: 'priced', cents: 1200, pricesAreInclTax: true });
  });

  it('reverse charge and outside the EU take the Dutch VAT out, at the administration’s own rate', () => {
    expect(linePriceFor('reverse_charge', 1200, '21.0')).toEqual({ kind: 'priced', cents: 992, pricesAreInclTax: false });
    expect(linePriceFor('outside_eu', 500, '21.0')).toEqual({ kind: 'priced', cents: 413, pricesAreInclTax: false });
    // Another government's rate would give another price, from the books, not from here.
    expect(linePriceFor('reverse_charge', 1200, '20.0')).toEqual({ kind: 'priced', cents: 1000, pricesAreInclTax: false });
  });

  it('refuses by name when the domestic rate gives no percentage, or the price is not one', () => {
    const noRate = linePriceFor('reverse_charge', 1200, null);
    expect(noRate.kind).toBe('refused');
    if (noRate.kind === 'refused') expect(noRate.reason).toContain('MONEYBIRD_TAX_RATE_ID_DOMESTIC');
    expect(linePriceFor('domestic_standard', -1, '21.0').kind).toBe('refused');
    expect(linePriceFor('domestic_standard', 12.5, '21.0').kind).toBe('refused');
  });
});
