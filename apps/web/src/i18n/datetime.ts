// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Locale-aware date, time and number formatting (workplan 0024 T3, ADR-0013).
 *
 * One shared helper, keyed on the ACTIVE locale — not the browser's. The
 * language switcher governs everything a screen renders, and a timestamp that
 * says "5 minutes ago" next to Dutch prose (or "1,234" with an English
 * thousands separator on a Dutch screen) is the switcher only half working.
 * `Intl` covers all of it natively, which is also why `date-fns` could leave:
 * its one caller was `formatDistanceToNow`, and `Intl.RelativeTimeFormat`
 * speaks both of our languages for free.
 *
 * Pure functions only — the locale-bound `useFormatters()` hook lives in
 * `index.tsx` with the other hooks. (Also a root-typecheck constraint: the
 * workspace tsconfig sweeps `.ts` files without `--jsx`, so a `.ts` module
 * must not import from a `.tsx` one.)
 */

import type { Locale } from './strings.ts';

// Largest-fitting-unit ladder for relative times. `numeric: 'auto'` lets Intl
// say "yesterday"/"gisteren" instead of the stilted "1 day ago".
const RELATIVE_UNITS: Array<{
  limit: number;
  divisor: number;
  unit: Intl.RelativeTimeFormatUnit;
}> = [
  { limit: 60, divisor: 1, unit: 'second' },
  { limit: 3_600, divisor: 60, unit: 'minute' },
  { limit: 86_400, divisor: 3_600, unit: 'hour' },
  { limit: 2_592_000, divisor: 86_400, unit: 'day' },
  { limit: 31_536_000, divisor: 2_592_000, unit: 'month' },
  { limit: Infinity, divisor: 31_536_000, unit: 'year' },
];

/** "5 minutes ago" / "5 minuten geleden". `now` is injectable for tests. */
export function formatRelativeToNow(
  when: string | Date,
  locale: Locale,
  now: Date = new Date(),
): string {
  const then = when instanceof Date ? when : new Date(when);
  const diffSeconds = Math.round((then.getTime() - now.getTime()) / 1000);
  const magnitude = Math.abs(diffSeconds);
  const { divisor, unit } = RELATIVE_UNITS.find((u) => magnitude < u.limit)!;
  const value = Math.trunc(diffSeconds / divisor);
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(value, unit);
}

/**
 * An absolute timestamp in the active language's conventions, medium date +
 * short time. `options` may refine (tests pin `timeZone: 'UTC'` with it).
 */
export function formatDateTime(
  when: string | Date,
  locale: Locale,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = when instanceof Date ? when : new Date(when);
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...options,
  }).format(date);
}

/** Grouped integer/decimal in the active language: en "1,234" — nl "1.234". */
export function formatNumber(n: number, locale: Locale): string {
  return new Intl.NumberFormat(locale).format(n);
}

/**
 * Money, in the active language (0039 T6): en "€12.34" — nl "€ 12,34".
 *
 * Takes CENTS (the integer the whole billing path carries, ADR-0014) and the
 * currency CODE the server serves (`invoice.currency` — dead data until this
 * existed, while every amount was a hardcoded `€{(x/100).toFixed(2)}` that
 * would render EN-style punctuation on the NL screen).
 */
export function formatCurrency(cents: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}
