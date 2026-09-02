// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WAIT THIS LONG, THEN ANSWER WITHOUT IT (2026-09-02, the owner's
 * whole-Dropbox test).
 *
 * A connection door probes, writes the row, then qualifies the account —
 * and the browser gives up at 30 s. The probe has its own deadline
 * (`PROBE_DEADLINE_MS`); the qualification, which measures every face a
 * grant carries, gets what is left of the door's budget. Past it the door
 * answers `pending` and the work finishes on its own: `qualifyAndRemember`
 * writes the row itself, so the next refresh shows what it found.
 *
 * Nothing is cancelled — the work has no abort handle — and nothing is
 * hidden: the caller says "still measuring" rather than showing a blank.
 */
export function withinBudget<T>(work: Promise<T>, ms: number): Promise<T | 'pending'> {
  return new Promise<T | 'pending'>((resolve, reject) => {
    const timer = setTimeout(() => resolve('pending'), Math.max(0, ms));
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}
