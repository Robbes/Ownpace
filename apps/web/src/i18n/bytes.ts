// Copyright 2026 The Ownpace authors (Apache-2.0)

import type { Locale } from './strings.ts';

/**
 * Bytes as a person reads them: the nearest unit, one decimal past KB.
 *
 * Lived in the confirm screen's `DiscoveryCounts` since discovery was the
 * only place bytes were shown; the measured-volume line (2026-09-02) shows
 * them beside a connection too, and a formatter two screens share belongs
 * where both can import it without one importing the other's component.
 *
 * In the reader's own way of writing a number (the UX sweep, 2026-10-17): a
 * Dutch screen said *3.4 GB* beside a migration page saying *3,1 GB*. English
 * is the default, so a caller that names no language reads as it always did.
 */
export function formatBytes(bytes?: number, locale: Locale = 'en'): string {
  if (bytes === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u += 1;
  }
  const digits = u === 0 ? 0 : 1;
  const figure = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
  return `${figure} ${units[u]}`;
}
