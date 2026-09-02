// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Bytes as a person reads them: the nearest unit, one decimal past KB.
 *
 * Lived in the confirm screen's `DiscoveryCounts` since discovery was the
 * only place bytes were shown; the measured-volume line (2026-09-02) shows
 * them beside a connection too, and a formatter two screens share belongs
 * where both can import it without one importing the other's component.
 */
export function formatBytes(bytes?: number): string {
  if (bytes === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u += 1;
  }
  return `${n.toFixed(u === 0 ? 0 : 1)} ${units[u]}`;
}
