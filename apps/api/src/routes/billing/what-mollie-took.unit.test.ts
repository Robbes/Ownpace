// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT MOLLIE TOOK (workplan 0111, slice 5f): the webhook's reading of a
 * payment's amount, which the push books in Moneybird. Mollie writes it with
 * two decimals, as text; anything else is not guessed at, and the books are
 * then told nothing rather than a wrong figure.
 */

import { describe, it, expect } from 'vitest';
import { centsOfMollieAmount } from './webhooks.ts';

describe('centsOfMollieAmount', () => {
  it('reads euros with two decimals exactly, as cents', () => {
    expect(centsOfMollieAmount({ value: '12.10', currency: 'EUR' })).toBe(1210);
    expect(centsOfMollieAmount({ value: '0.01', currency: 'EUR' })).toBe(1);
    expect(centsOfMollieAmount({ value: '96.80', currency: 'EUR' })).toBe(9680);
    // Through a float, 1.15 * 100 is 114.99999999999999: the text is read, never multiplied.
    expect(centsOfMollieAmount({ value: '1.15', currency: 'EUR' })).toBe(115);
  });

  it('reads nothing it cannot read exactly: another currency, another shape, nothing at all', () => {
    for (const amount of [
      { value: '12.10', currency: 'USD' },
      { value: '12.1', currency: 'EUR' },
      { value: '12', currency: 'EUR' },
      { value: '-12.10', currency: 'EUR' },
      { value: '0.00', currency: 'EUR' },
      { value: '1,00', currency: 'EUR' },
    ]) {
      expect(centsOfMollieAmount(amount), amount.value).toBeNull();
    }
    expect(centsOfMollieAmount(undefined)).toBeNull();
  });
});
