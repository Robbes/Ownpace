// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * What an invoice line costs, in cents, and how Moneybird writes it (workplan
 * 0111, slice 2 of §"The build, sliced").
 *
 * Money here is whole euro cents, always. Moneybird writes amounts as decimal
 * strings ("12.0", "9.92"); `decimalFromCents` and `centsFromDecimal` are the
 * only crossings, and a figure that is not a whole number of cents is refused
 * rather than rounded, since an invoice total read wrongly is a legal
 * document misread.
 *
 * ## The price of a line, by treatment (open decision 9, decided 2026-10-05)
 *
 * Every published price includes VAT, and toward a consumer the displayed
 * price is the final one. So:
 *
 *  - **domestic_standard** and **destination_oss**: the published price, with
 *    `prices_are_incl_tax`, so the VAT is inside it and the total is the
 *    published price to the cent;
 *  - **reverse_charge**: the published price without the Dutch VAT in it
 *    (Medium €12 → €9,92), with prices excluding VAT, so every customer pays
 *    the same price before tax. **outside_eu** follows the same rule, for the
 *    same reason; its rate stays unset until the accountant confirms it, so it
 *    is refused before it is priced.
 *
 * The Dutch VAT taken out is the administration's own domestic rate, read at
 * run time from Moneybird (`resolveTaxRateId`'s percentage), never a number in
 * this repository: ADR-0044's rule, the same one `moneybird-tax-rates.ts`
 * keeps. A domestic rate without a percentage refuses the line by name.
 */

import type { VatTreatment } from './vat-treatment.ts';

/** Cents as Moneybird's decimal string: 992 → "9.92", -1200 → "-12.00". */
export function decimalFromCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`not a whole number of cents: ${cents}`);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Moneybird's decimal string (or number) as integer cents, exactly; null when
 * it is not a whole number of cents ("9.915"), or not a number at all.
 */
export function centsFromDecimal(value: unknown): number | null {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== 'string') return null;
  const match = /^(-)?([0-9]+)(?:\.([0-9]+))?$/.exec(text.trim());
  if (!match) return null;
  const [, minus, euros, fraction = ''] = match;
  if (/[1-9]/.test(fraction.slice(2))) return null;
  const cents = Number(euros) * 100 + Number(fraction.slice(0, 2).padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return null;
  return minus && cents !== 0 ? -cents : cents;
}

/**
 * A percentage as Moneybird writes it ("21.0") in basis points (2100); null
 * when it is absent, negative, or finer than a hundredth of a percent.
 */
export function basisPointsFromPercentage(value: string | null): number | null {
  if (value === null) return null;
  const match = /^([0-9]+)(?:\.([0-9]+))?$/.exec(value.trim());
  if (!match) return null;
  const [, whole, fraction = ''] = match;
  if (/[1-9]/.test(fraction.slice(2))) return null;
  return Number(whole) * 100 + Number(fraction.slice(0, 2).padEnd(2, '0'));
}

/**
 * A price that includes VAT at `basisPoints`, without it: rounded half up to
 * the cent, in integers only (Medium: 1200 at 2100 → 992).
 */
export function priceWithoutVatCents(publishedCents: number, basisPoints: number): number {
  const numerator = publishedCents * 10_000;
  const denominator = 10_000 + basisPoints;
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

export type LinePrice =
  | { readonly kind: 'priced'; readonly cents: number; readonly pricesAreInclTax: boolean }
  | { readonly kind: 'refused'; readonly reason: string };

/**
 * The line's price for a treatment, from the published price (cents, VAT
 * included) and the administration's domestic rate's percentage.
 */
export function linePriceFor(
  treatment: VatTreatment,
  publishedCents: number,
  domesticPercentage: string | null,
): LinePrice {
  if (!Number.isSafeInteger(publishedCents) || publishedCents < 0) {
    return { kind: 'refused', reason: `A published price of ${publishedCents} cents is not one an invoice can carry.` };
  }
  if (treatment === 'domestic_standard' || treatment === 'destination_oss') {
    return { kind: 'priced', cents: publishedCents, pricesAreInclTax: true };
  }
  const basisPoints = basisPointsFromPercentage(domesticPercentage);
  if (basisPoints === null) {
    return {
      kind: 'refused',
      reason:
        `The ${treatment} price is the published price without the Dutch VAT in it, and the ` +
        "administration's domestic rate (MONEYBIRD_TAX_RATE_ID_DOMESTIC) gives no percentage to take out.",
    };
  }
  return { kind: 'priced', cents: priceWithoutVatCents(publishedCents, basisPoints), pricesAreInclTax: false };
}
