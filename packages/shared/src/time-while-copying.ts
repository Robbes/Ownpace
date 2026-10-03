// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * HOW LONG, DURING THE COPY: A RANGE FROM THE RECENT PASSES (workplan 0154 T3 (b)).
 *
 * Before the first pass, the time is a range from the count and Gmail's
 * ceiling (`time-before-start.ts`). Once passes have run, they are the better
 * answer: they measured this source, at this schedule, through this network.
 *
 * - **What is left** is the copying data types' totals less what arrived or
 *   was left as it was (T2's *of ~*). A data type with no total leaves it
 *   unknown, and nothing is said rather than a range of part of it.
 * - **How fast** is the last passes' own: the items each one copied, and how
 *   far apart they started. Measured that way the schedule is in the answer
 *   without being read: a daily migration's passes are a day apart, an hourly
 *   one's an hour, on either edition.
 * - **The range** is what is left at the best pass's pace to the worst's, so
 *   its width is the spread of those rates, as the plan asks. Under a day it
 *   is said in hours.
 * - **Three passes first.** One or two passes are not yet a rate: the line
 *   says how many it has, and that it will know after three.
 * - **Slowed down**: where a copying data type's last error says the provider
 *   asked us to slow down, the sentence names the provider. The slowing is
 *   honoured, never worked around (hard rule 4), and it is in the rate.
 *
 * Pure, so a test holds each rule; the screens draw what this returns.
 */

/** One pass, as the run history reports it. */
export interface PassFacts {
  readonly status: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly itemsProcessed: number;
}

export type TimeWhileCopying =
  | {
      readonly kind: 'range';
      readonly unit: 'hours' | 'days';
      readonly low: number;
      readonly high: number;
      /** How many passes the rate is from. */
      readonly passes: number;
      /** The provider asked us to slow down, and the rate shows it. */
      readonly slowed: boolean;
    }
  | { readonly kind: 'afterThreePasses'; readonly passesSoFar: number };

/** The passes a rate is taken from, newest first: at most this many. */
export const RATE_PASSES = 5;
/** And at least this many, before a range is said. */
export const PASSES_BEFORE_A_RANGE = 3;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The time left, or undefined where nothing should be said: nothing left to
 * copy (the migration is catching up to its own last pass), or a total that
 * is not known.
 *
 * `passes` is the run history, newest first, as the server serves it. Only
 * finished, successful passes that copied something count: a pass that found
 * nothing new says nothing about how fast the rest will come.
 */
export function timeWhileCopying(input: {
  readonly remainingItems: number | undefined;
  readonly passes: ReadonlyArray<PassFacts>;
  /** A copying data type's last error says the provider asked us to slow down. */
  readonly slowed?: boolean;
}): TimeWhileCopying | undefined {
  const { remainingItems, passes, slowed = false } = input;
  if (remainingItems === undefined || !(remainingItems > 0)) return undefined;

  const counted = passes
    .filter((p) => p.status === 'success' && p.itemsProcessed > 0 && p.startedAt !== null && p.finishedAt !== null)
    .slice(0, RATE_PASSES);
  if (counted.length < PASSES_BEFORE_A_RANGE) return { kind: 'afterThreePasses', passesSoFar: counted.length };

  // How far apart they started: the median gap, so one late pass (a restart,
  // a held platform) does not stretch every estimate.
  const starts = counted.map((p) => Date.parse(p.startedAt!)).sort((a, b) => a - b);
  const gaps = starts.slice(1).map((s, i) => s - starts[i]!).sort((a, b) => a - b);
  const gap = gaps[Math.floor(gaps.length / 2)]!;
  if (!(gap > 0)) return { kind: 'afterThreePasses', passesSoFar: counted.length };

  const perPass = counted.map((p) => p.itemsProcessed);
  const fastest = Math.max(...perPass);
  const slowest = Math.min(...perPass);
  const soonestMs = (remainingItems / fastest) * gap;
  const latestMs = (remainingItems / slowest) * gap;

  // In days where the latest is a day or more, else in hours. A low of 0 is
  // said as *up to*, never as *0 to*.
  const unit = latestMs < DAY_MS ? 'hours' : 'days';
  const size = unit === 'hours' ? HOUR_MS : DAY_MS;
  const low = Math.floor(soonestMs / size);
  const high = Math.max(low + 1, Math.ceil(latestMs / size));
  return { kind: 'range', unit, low, high, passes: counted.length, slowed };
}

/**
 * What is left to copy, from each copying data type's counts: its total less
 * what arrived and what was left as it was (T2). Undefined where any of them
 * has no total, rather than a remainder of only the ones that have one.
 */
export function remainingItemsOf(
  rows: ReadonlyArray<{
    readonly itemsSynced: number;
    readonly itemsAdopted?: number;
    readonly itemsFound?: number;
  }>,
): number | undefined {
  let left = 0;
  for (const row of rows) {
    if (row.itemsFound === undefined) return undefined;
    left += Math.max(0, row.itemsFound - row.itemsSynced - (row.itemsAdopted ?? 0));
  }
  return left;
}
