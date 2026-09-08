// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A migration that cannot succeed should stop asking every fifteen minutes.
 *
 * ## What was found, and what it was not
 *
 * A demo mapping in Demo Tenant A carried 4796 run rows against 3 items. Its
 * source connection's credentials had become unreadable — the deployment's
 * `SECRET_ENCRYPTION_KEY` had been rotated — so every pass failed at the
 * credential, and the tick enqueued it again on the next due minute. Fifty
 * days of that.
 *
 * **Nothing malfunctioned.** `ACTIVE_MAPPINGS_SQL` selects `status = 'active'`
 * and `isSyncDue` honours the mapping's own cron; both did exactly what they
 * say. Retrying is also the RIGHT default: a credential fixed at any moment
 * resumes the migration with nobody pressing anything, which is the behaviour
 * worth protecting.
 *
 * What is missing is only that nothing notices the retry is not working. At
 * the default cadence that is ~96 failed passes a day, each one a billable
 * sync operation (`usage-metering.ts` counts finished runs of a billable kind
 * and does not filter on status). A customer would be invoiced, every day, for
 * a migration that has never worked.
 *
 * ## Back off, do not stop — and why not a pause
 *
 * The owner's decision (2026-09-08) was to widen the interval rather than move
 * the mapping to a state. Two reasons it is the better shape:
 *
 *  - **Self-healing survives.** A stopped mapping needs a human to notice and
 *    press something. A slowed one resumes by itself the moment the cause
 *    clears; it just asks less often while it does not.
 *  - **`paused` would be a lie.** `shared/src/pause-reason.ts` defines a pause
 *    as "a scheduled stop, never a failure: nothing threw, nothing is owed a
 *    retry", and says a screen rendering one in error colours claims something
 *    the data does not support. A mapping held back BECAUSE it keeps throwing
 *    is the opposite of that. Borrowing the word would put two different
 *    states behind one badge.
 *
 * So nothing here changes a mapping's status, writes a row, or needs a
 * migration. The mapping stays `active` and stays honest: it is failing, its
 * card already says so (workplan 0094 T5), and it is simply asked less often.
 *
 * ## Only failures that cannot heal themselves
 *
 * The categories split cleanly (workplan 0110 T3) and the owner's second
 * decision was to respect the split. A daily ceiling that resumes tomorrow, a
 * rate limit that clears in minutes and a network blip are all EXPECTED to
 * recover on the normal cadence — slowing those would delay exactly the
 * recovery the cadence exists for. Only the ones that need somebody to act
 * (`auth_expired`, `target_refused`, `unknown`) are worth asking about less.
 *
 * Conservative on purpose: if ANY domain of a mapping reports a self-healing
 * cause, the whole mapping keeps its cadence. A mapping whose mail is rate
 * limited and whose files need a new credential is one that will move again
 * shortly, and the file half costs one request per pass to keep trying.
 */

import type { FailureCategory } from '@openmig/shared';

/**
 * The causes that clear WITHOUT anybody doing anything.
 *
 * Derived from what each category means rather than from a hand-kept list of
 * the others: a category not named here is one whose remedy is a person, and
 * the union is checked against `FAILURE_CATEGORIES` by the guard so a seventh
 * category cannot be added and silently treated as needing a human.
 */
export const SELF_HEALING_CATEGORIES: ReadonlySet<FailureCategory> = new Set([
  // The provider asked us to slow down. It clears in minutes.
  'rate_limited',
  // A daily ceiling is spent. It clears tomorrow, and 0090 T4 already refuses
  // before the lockout rather than after.
  'quota_exceeded',
  // The network did not reach. Transient by definition.
  'network',
]);

/**
 * The ladder, in minutes of minimum gap between attempts.
 *
 * Read as: after this many consecutive failures, do not attempt again until
 * this many minutes have passed since the last attempt STARTED. The mapping's
 * own cron still applies on top — this is a floor, never a ceiling, so a
 * mapping scheduled daily is never made MORE frequent by any of this.
 *
 * The first two failures are free. A blip that the third pass would have
 * ridden out should not cost an hour of latency, and two failures in a row is
 * still comfortably inside "something is briefly wrong".
 *
 * At the default 15-minute cadence a permanently broken mapping therefore
 * goes: three attempts in the first half hour, three more an hour apart, six
 * four hours apart, and daily from there — about 27 hours to the bottom rung.
 * Roughly 96 attempts a day becomes 1, while a credential repaired at any
 * point along that curve still resumes on its own, at worst a day later, and
 * immediately if anybody presses Sync.
 */
export const LADDER: ReadonlyArray<{
  readonly afterFailures: number;
  readonly minGapMinutes: number;
}> = [
  { afterFailures: 3, minGapMinutes: 60 },
  { afterFailures: 6, minGapMinutes: 4 * 60 },
  { afterFailures: 12, minGapMinutes: 24 * 60 },
];

/**
 * How far back the tick looks for failures, in minutes.
 *
 * The count has to be bounded by something. Left open, "failed runs since the
 * last successful one" is a scan whose cost grows with elapsed time on exactly
 * the mappings this file exists for — a mapping that has NEVER succeeded makes
 * it read the whole history, once a minute, for ever. That is the pathology
 * migration 0023 was written to remove, and reintroducing it here would be a
 * poor trade for a number whose largest interesting value is twelve.
 *
 * Seven days, and the derivation is the ladder's own: climbing to the top rung
 * takes about 27 hours (three failures at the cadence, three an hour apart,
 * then six four hours apart), and SITTING there costs another day per attempt.
 * So the window has to cover the climb plus at least one top-rung gap — about
 * 51 hours — or the oldest failures age out faster than the newest arrive and
 * a mapping falls back down a ladder it has already climbed. Seven days is
 * roughly three times that. `a-migration-that-cannot-succeed.unit.test.ts`
 * recomputes the walk from `LADDER`, so changing a rung either keeps the
 * window sufficient or fails.
 *
 * What the bound COSTS: a mapping whose last success is older than the window
 * is read as never having succeeded. That is the same answer by a different
 * route — a mapping that last worked over a week ago is failing — so the
 * approximation only ever agrees with the unbounded count on the cases the
 * ladder can distinguish.
 */
export const FAILURE_WINDOW_MINUTES = 7 * 24 * 60;

/** What the tick knows about a mapping's recent failing. */
export interface FailingState {
  /**
   * Failed data-moving passes since the last successful one, within
   * `FAILURE_WINDOW_MINUTES`; 0 when the last pass worked. Discovery, verify
   * and cutover runs are not counted on either side — they are real failures
   * and belong on the customer's screen, but they say nothing about whether
   * COPYING is broken, which is the only thing this ladder throttles.
   */
  readonly consecutiveFailures: number;
  /**
   * Whether ANY domain of this mapping last failed for a cause that clears by
   * itself. True keeps the mapping on its normal cadence.
   */
  readonly anySelfHealing: boolean;
  /** When the last attempt STARTED — the same clock `isSyncDue` measures from. */
  readonly lastStartedAt: Date | null;
}

/**
 * The minimum gap this mapping has earned, in minutes. Zero means no floor.
 *
 * Exported beside `LADDER` so the guard walks the rungs rather than trusting
 * three numbers copied into a test — and so the window's own derivation can be
 * recomputed from the same walk the tick performs.
 */
export function minGapMinutes(state: FailingState): number {
  if (state.anySelfHealing) return 0;
  let gap = 0;
  for (const step of LADDER) {
    if (state.consecutiveFailures >= step.afterFailures) gap = step.minGapMinutes;
  }
  return gap;
}

/**
 * Should this mapping's attempt be held back, having been judged due?
 *
 * Composed with `isSyncDue` rather than replacing it: the schedule decides
 * when a healthy mapping runs, and this only ever removes attempts from a
 * failing one. A mapping that has never run, or whose last pass succeeded,
 * takes the `consecutiveFailures === 0` branch and is never held.
 */
export function heldBackByFailures(state: FailingState, now: Date): boolean {
  const gap = minGapMinutes(state);
  if (gap === 0) return false;
  // No last attempt is not a failing mapping — `consecutiveFailures` counts
  // runs, so it cannot be above zero with nothing to count.
  if (state.lastStartedAt === null) return false;
  const elapsedMinutes = (now.getTime() - state.lastStartedAt.getTime()) / 60_000;
  return elapsedMinutes < gap;
}
