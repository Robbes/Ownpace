// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * OF ABOUT HOW MANY (workplan 0154 T2).
 *
 * A data type's progress row set its count against nothing: *"18,234
 * synced"* said how many had arrived, and not of how many. Discovery counted
 * the source before the first Start and kept the counts for Review & confirm;
 * both editions now serve them on each row (`itemsFound`, `bytesFound`), and
 * this reads the row into *"18,234 of ~19,000"*, a bar, and *"3.1 of
 * about 3.4 GB"*.
 *
 * THE RULES, each a sentence of the plan:
 *
 * - **About is literal.** Discovery is a snapshot, and the source keeps
 *   changing. Everything copied or left as it was came from the source, so the
 *   source held at least that many: when the two pass what discovery found,
 *   the total grows with them. The bar is never above 100%.
 * - **Never *"of 0"* for a count nobody took** (hard rule 9). With no count
 *   from discovery the row has no total, and says the total is not known: no
 *   bar, because an empty one would claim nothing arrived. A counted zero is a
 *   real answer, and says none were found.
 * - **The bar has two parts.** What was copied, and after it what was left as
 *   it was: those are in the new system too, so a migration that left 402
 *   contacts alone does not end at 98% with nothing to say why.
 * - **Bytes only when both sides were measured.** No size from discovery, or a
 *   count of copies with no size recorded for any of them, and the row says
 *   nothing about bytes rather than *"0 of ~3.4 GB"*.
 *
 * Pure, so a test can hold every rule; the strip draws what this returns.
 */
import type { Locale } from '../i18n/strings.ts';

/** What a row carries that the totals read. `DomainStatusReport` satisfies it. */
export interface TotalsFacts {
  readonly itemsSynced: number;
  readonly itemsAdopted?: number;
  readonly itemsFound?: number;
  readonly bytesTransferred?: number;
  readonly bytesFound?: number;
}

export type ProgressTotals =
  /** Discovery has no count of this data type: the count stands alone. */
  | { readonly kind: 'notKnown' }
  /** Discovery counted none, and none arrived. */
  | { readonly kind: 'noneFound' }
  | {
      readonly kind: 'ofAbout';
      /** What discovery found, or more when more arrived since. Never 0. */
      readonly total: number;
      /** The copied part of the bar, 0 to 1. */
      readonly copiedShare: number;
      /** The left-as-they-are part after it, so the two never pass 1. */
      readonly leftShare: number;
    };

export function progressTotals(row: TotalsFacts): ProgressTotals {
  if (row.itemsFound === undefined) return { kind: 'notKnown' };
  const left = row.itemsAdopted ?? 0;
  const total = Math.max(row.itemsFound, row.itemsSynced + left);
  if (total === 0) return { kind: 'noneFound' };
  return { kind: 'ofAbout', total, copiedShare: row.itemsSynced / total, leftShare: left / total };
}

/**
 * The bar's value for a screen reader, in whole percent, rounded DOWN: a copy
 * at 99.6% is not announced as done.
 */
export function wholePercent(share: number): number {
  return Math.floor(share * 100);
}

/**
 * One part of the bar, from one share to another, as the width it is drawn
 * at: a percent to two decimals, measured between ROUNDED EDGES.
 *
 * Two decimals, because a width is read back the way the engine keeps it, and
 * engines do not keep the same digits: 210 of 612 is 34.31372549019608%, which
 * jsdom 30 read back whole and jsdom 31 reads back as 34.3137% (2026-11-09),
 * so what the strip drew depended on who read it. A hundredth of a percent of
 * a bar at most 20rem wide is about a thirtieth of a pixel, and two decimals
 * read back as they were written.
 *
 * Edges, not parts: each part starts at the rounded end of the one before it,
 * so the two still meet, and together they still never pass 100%. Rounded on
 * their own, 1 copied and 31 left as they were of 32 are 3.125% and 96.875%,
 * which round to 3.13% and 96.88%: 100.01% of the bar.
 */
export function barWidth(from: number, to: number): string {
  return `${(Math.round(to * 10_000) - Math.round(from * 10_000)) / 100}%`;
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** The largest unit `bytes` reaches, by `formatBytes`'s steps of 1024. */
function unitOf(bytes: number): number {
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < UNITS.length - 1) {
    n /= 1024;
    u += 1;
  }
  return u;
}

function inUnit(bytes: number, u: number, locale: Locale): string {
  if (bytes === 0) return new Intl.NumberFormat(locale).format(0);
  const digits = u === 0 ? 0 : 1;
  return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(
    bytes / 1024 ** u,
  );
}

/** *"3.1"* and *"3.4 GB"*, the two sides of *"3.1 of ~3.4 GB"*. */
export interface BytesOfAbout {
  readonly done: string;
  readonly total: string;
}

/**
 * The bytes pair, or nothing when either side was not measured.
 *
 * In the total's unit, so the pair reads as one quantity, and in the reader's
 * language: *"3,1 van ~3,4 GB"* in Dutch. A part too small to show in
 * that unit carries its own (*"5.0 MB of ~3.4 GB"*), because *"0.0 of
 * about 3.4 GB"* would say nothing had arrived.
 */
export function bytesOfAbout(row: TotalsFacts, locale: Locale): BytesOfAbout | null {
  if (row.bytesFound === undefined || row.bytesTransferred === undefined) return null;
  // Copies with no size recorded for any of them: the bytes were not measured.
  if (row.itemsSynced > 0 && row.bytesTransferred === 0) return null;
  const total = Math.max(row.bytesFound, row.bytesTransferred);
  if (total === 0) return null;
  const u = unitOf(total);
  const totalText = `${inUnit(total, u, locale)} ${UNITS[u]}`;
  const own = unitOf(row.bytesTransferred);
  const fitsTheUnit = row.bytesTransferred === 0 || row.bytesTransferred / 1024 ** u >= 0.1;
  return {
    done: fitsTheUnit ? inUnit(row.bytesTransferred, u, locale) : `${inUnit(row.bytesTransferred, own, locale)} ${UNITS[own]}`,
    total: totalText,
  };
}
