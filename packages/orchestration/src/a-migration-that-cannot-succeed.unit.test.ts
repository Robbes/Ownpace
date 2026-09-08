// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MIGRATION THAT CANNOT SUCCEED SHOULD STOP ASKING EVERY FIFTEEN MINUTES
 * (2026-09-08).
 *
 * Found on a live deployment: one mapping, 3 items, 4796 run rows. Its
 * source credential had become unreadable after a key rotation, so every pass
 * failed at the credential and the tick enqueued the next one on schedule.
 * Fifty days of that, and each finished pass is a billable sync operation —
 * `usage-metering.ts` counts finished runs of a billable kind and does NOT
 * filter on status, so the customer is invoiced daily for a migration that has
 * never worked.
 *
 * What this file pins is the shape of the answer, which was chosen against two
 * plausible wrong ones:
 *
 *  - NOT a stop. A mapping that is merely slowed resumes by itself the moment
 *    the cause clears. A stopped one waits for a human to notice.
 *  - NOT `paused`. `shared/src/pause-reason.ts` defines a pause as "a
 *    scheduled stop, never a failure", so borrowing the word would put two
 *    different states behind one badge.
 *
 * Every assertion here was proved by breaking the thing it guards.
 */

import { describe, it, expect } from 'vitest';
import { FAILURE_CATEGORIES, type FailureCategory } from '@openmig/shared';
import {
  FAILURE_WINDOW_MINUTES,
  LADDER,
  SELF_HEALING_CATEGORIES,
  heldBackByFailures,
  minGapMinutes,
  type FailingState,
} from './failing-backoff.ts';

const NOW = new Date('2026-09-08T12:00:00.000Z');

/** A failing mapping, `minutesAgo` since its last attempt started. */
function failing(consecutiveFailures: number, minutesAgo: number): FailingState {
  return {
    consecutiveFailures,
    anySelfHealing: false,
    lastStartedAt: new Date(NOW.getTime() - minutesAgo * 60_000),
  };
}

describe('the ladder', () => {
  it('leaves the first failures alone', () => {
    // A blip the next pass would have ridden out must not cost an hour of
    // latency. The first rung is where "something is briefly wrong" ends.
    for (let failures = 0; failures < LADDER[0]!.afterFailures; failures++) {
      expect(minGapMinutes(failing(failures, 0))).toBe(0);
      expect(heldBackByFailures(failing(failures, 0), NOW)).toBe(false);
    }
  });

  it('gives a mapping at least two free failures, as a number and not as a walk', () => {
    // Pinned concretely BECAUSE the loop above is derived: walking the ladder
    // keeps the shape honest but makes it self-fulfilling, so moving the first
    // rung down to 1 passes every derived assertion while quietly costing a
    // one-off blip an hour of latency. That is a product promise, so it gets a
    // number of its own.
    expect(LADDER[0]!.afterFailures).toBeGreaterThanOrEqual(3);
    expect(heldBackByFailures(failing(1, 0), NOW)).toBe(false);
    expect(heldBackByFailures(failing(2, 0), NOW)).toBe(false);
  });

  it('holds every rung, walked from the ladder rather than copied from it', () => {
    // Walked, so a rung added or a number changed is covered without editing
    // this test — and so the test cannot silently keep asserting a ladder the
    // code no longer has.
    for (const step of LADDER) {
      const state = failing(step.afterFailures, 0);
      expect(minGapMinutes(state)).toBe(step.minGapMinutes);
      // Just inside the gap: held.
      expect(heldBackByFailures(failing(step.afterFailures, step.minGapMinutes - 1), NOW)).toBe(
        true,
      );
      // Just outside it: attempted.
      expect(heldBackByFailures(failing(step.afterFailures, step.minGapMinutes + 1), NOW)).toBe(
        false,
      );
    }
  });

  it('only ever widens, so climbing a rung cannot make a mapping ask more often', () => {
    let previous = -1;
    for (const step of LADDER) {
      expect(step.minGapMinutes).toBeGreaterThan(previous);
      previous = step.minGapMinutes;
    }
    // And the rungs are reached in order. Out of order, the `>=` walk in
    // minGapMinutes would settle on whichever came last rather than the
    // highest one earned.
    let reachedAt = -1;
    for (const step of LADDER) {
      expect(step.afterFailures).toBeGreaterThan(reachedAt);
      reachedAt = step.afterFailures;
    }
  });

  it('takes the highest rung earned, not the first one passed', () => {
    const top = LADDER[LADDER.length - 1]!;
    expect(minGapMinutes(failing(top.afterFailures * 10, 0))).toBe(top.minGapMinutes);
  });
});

describe('a mapping that is not failing', () => {
  it('is never held back after a success', () => {
    // The count is failures SINCE the last success, so a pass that worked
    // resets it and the mapping is back on its own cadence immediately. This
    // is the self-healing property the whole shape was chosen for.
    expect(heldBackByFailures({ ...failing(0, 0), consecutiveFailures: 0 }, NOW)).toBe(false);
  });

  it('is never held back having never run', () => {
    // A mapping with no last attempt cannot be measured against a gap. It is
    // also not failing — there is nothing for the count to have counted.
    expect(
      heldBackByFailures(
        { consecutiveFailures: 99, anySelfHealing: false, lastStartedAt: null },
        NOW,
      ),
    ).toBe(false);
  });
});

describe('only failures that cannot heal themselves', () => {
  it('keeps a mapping on its cadence when any domain reports a self-healing cause', () => {
    // Deliberately conservative, and it is the direction that costs least: a
    // mapping whose mail is rate limited and whose files need a new credential
    // will move again shortly, and the file half costs one request per pass.
    const top = LADDER[LADDER.length - 1]!;
    const state = { ...failing(top.afterFailures * 10, 0), anySelfHealing: true };
    expect(minGapMinutes(state)).toBe(0);
    expect(heldBackByFailures(state, NOW)).toBe(false);
  });

  it('names only categories that exist', () => {
    // A typo here is silent: a name no category has simply never matches, and
    // the mapping is slowed for a cause that was going to clear by itself.
    for (const category of SELF_HEALING_CATEGORIES) {
      expect(FAILURE_CATEGORIES).toContain(category);
    }
  });

  it('leaves the ones that need a person on the other side', () => {
    // Stated as the complement rather than as a second list, so a seventh
    // category cannot be added and land on the wrong side unnoticed. Slowing
    // a cause that clears by itself would delay the recovery the cadence
    // exists for; NOT slowing one that needs a person is the whole defect.
    const needsAPerson = FAILURE_CATEGORIES.filter(
      (c: FailureCategory) => !SELF_HEALING_CATEGORIES.has(c),
    );
    expect(needsAPerson).toEqual(['auth_expired', 'target_refused', 'unknown']);
  });
});

describe('the window the tick counts failures in', () => {
  it('is long enough to climb the whole ladder and stay there', () => {
    // The count is bounded so the tick's cost does not grow with history
    // (migration 0023). A window SHORTER than the climb would forget failures
    // faster than they accumulate, and the top rungs would be unreachable —
    // the back-off would look implemented and never engage. Recomputed from
    // LADDER, so changing a rung either keeps the window sufficient or fails.
    const top = LADDER[LADDER.length - 1]!;
    let climbMinutes = 0;
    for (let failures = 0; failures < top.afterFailures; failures++) {
      climbMinutes += minGapMinutes({
        consecutiveFailures: failures,
        anySelfHealing: false,
        lastStartedAt: null,
      });
    }
    // The climb itself, plus room to sit at the top rung rather than fall off
    // it the moment the oldest failure ages out.
    expect(FAILURE_WINDOW_MINUTES).toBeGreaterThan(climbMinutes + top.minGapMinutes);
  });
});
