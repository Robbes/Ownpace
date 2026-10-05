// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FIRST COPY RUNS BACK TO BACK (workplan 0156 T5; the owner, 2026-10-03).
 *
 * A migration made with no schedule picked is stored as daily at 02:00, and a
 * managed pass stops itself at 50 minutes, so a large first copy got one
 * 50-minute pass a day. The owner: a daily schedule *"might be reasonable for
 * the free tier and after all sync was done, like as a default sync of only
 * the new additions/changes, but not for the initial bulk."* 0125 T8 offered
 * this as (a) on 2026-09-28: *"While the first copy is unfinished, run passes
 * back to back whatever the schedule, and apply the schedule once everything
 * is copied."* This is it, in `isSyncDue`:
 *
 *  1. while the first copy is unfinished, due at the floor whatever the
 *     schedule, counted from the last pass's START, and not a moment sooner;
 *  2. a day of it: a pass that runs its 50 minutes is followed at the tick
 *     after it ends, and never while it runs (the tick's `running` skip);
 *  3. once every data type has completed a pass, the schedule as before;
 *  4. what held before still holds: the back-off after failures, a schedule
 *     nobody can read, a migration that never ran.
 *
 * Which migrations are unfinished is the tick's SQL, asked of real rows in
 * `apps/worker/src/jobs/a-migration-that-keeps-asking.unit.test.ts`, with the
 * cases that must NOT count: failed items after a completed pass, a paused
 * migration (never enumerated, so its pause holds), a stopped or unstarted
 * data type, a provider's ceiling until its window resets, and a collection the
 * source would not list.
 */

import { describe, it, expect } from 'vitest';
import { isSyncDue, SCHEDULE_FLOOR_MINUTES } from './sync-due.ts';
import { heldBackByFailures } from './failing-backoff.ts';

/**
 * A moment in October 2026, in UTC: the tick reads `0 2 * * *` in UTC, the
 * servers' zone, wherever it runs (`isSyncDue`), so 02:00 here is 02:00 UTC on
 * every machine the tests run on, the self-hosted CI runner's included.
 */
const at = (day: number, hour: number, minute = 0, second = 0): Date =>
  new Date(Date.UTC(2026, 9, day, hour, minute, second));
const DAILY = '0 2 * * *';
const CATCHING_UP = { firstCopyUnfinished: true } as const;
const STEADY = { firstCopyUnfinished: false } as const;

describe('while the first copy is unfinished', () => {
  it('is due at the floor despite a daily schedule', () => {
    const started = at(3, 12);
    const now = at(3, 12, 15);
    expect(isSyncDue(DAILY, started, now, CATCHING_UP)).toBe(true);
    // The same migration, its first copy done: tomorrow at 02:00.
    expect(isSyncDue(DAILY, started, now, STEADY)).toBe(false);
  });

  it('is not due inside the floor, counted from the last pass STARTED', () => {
    const started = at(3, 12);
    expect(SCHEDULE_FLOOR_MINUTES).toBe(15);
    expect(isSyncDue(DAILY, started, at(3, 12, 14, 59), CATCHING_UP)).toBe(false);
    expect(isSyncDue(DAILY, started, at(3, 12, 15), CATCHING_UP)).toBe(true);
  });

  it('is the floor whatever the schedule: hourly, six-hourly, weekly and the quarter hour alike', () => {
    const started = at(3, 12);
    for (const schedule of ['0 * * * *', '0 */6 * * *', '@weekly', '*/15 * * * *', null]) {
      expect(isSyncDue(schedule, started, at(3, 12, 10), CATCHING_UP), String(schedule)).toBe(false);
      expect(isSyncDue(schedule, started, at(3, 12, 16), CATCHING_UP), String(schedule)).toBe(true);
    }
  });

  it('is due at once for a migration that never ran, as before', () => {
    expect(isSyncDue(DAILY, null, at(3, 12), CATCHING_UP)).toBe(true);
  });

  it('still throws on a schedule croner cannot read, so the tick still says so while the first copy runs', () => {
    // Read first: a broken value that hid behind the floor would stop the
    // migration silently the day its first copy finished (hard rule 9).
    expect(() => isSyncDue('not a cron', at(3, 12), at(3, 13), CATCHING_UP)).toThrow();
  });
});

describe('a day of passes on a daily schedule', () => {
  /** How long a managed pass runs before its own deadline stops it, in minutes. */
  const PASS_MINUTES = 50;

  /**
   * The tick's loop, one minute at a time: a migration with a pass still
   * running is skipped (its `running` column), the rest asked `isSyncDue`.
   * Each pass runs its full 50 minutes, as every pass of a large first copy
   * does, and closes its run row after the tick of its 50th minute has
   * looked. Answers the minutes a pass started.
   */
  function aDay(firstCopyUnfinished: boolean): number[] {
    // Its last pass was yesterday's at 02:00.
    let lastStarted: Date = at(2, 2);
    const starts: number[] = [];
    for (let minute = 0; minute < 24 * 60; minute++) {
      const now = at(3, 0, minute);
      const running = now.getTime() - lastStarted.getTime() <= PASS_MINUTES * 60_000;
      if (running) continue;
      if (isSyncDue(DAILY, lastStarted, now, { firstCopyUnfinished })) {
        starts.push(minute);
        lastStarted = now;
      }
    }
    return starts;
  }

  it('was one pass, 50 minutes of copying a day, before', () => {
    expect(aDay(false)).toEqual([2 * 60]);
  });

  it('is pass after pass while the first copy runs, never two at once', () => {
    const starts = aDay(true);
    // Each at the tick after the one before it ended: 51 minutes apart.
    expect(starts.slice(0, 4)).toEqual([0, 51, 102, 153]);
    expect(starts).toHaveLength(29);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(PASS_MINUTES);
    }
  });

  it('waits out the floor after a pass that ended early', () => {
    // A pass that finished its share in five minutes is followed fifteen
    // minutes after it started, not at the next tick.
    const started = at(3, 12);
    expect(isSyncDue(DAILY, started, at(3, 12, 6), CATCHING_UP)).toBe(false);
    expect(isSyncDue(DAILY, started, at(3, 12, 15), CATCHING_UP)).toBe(true);
  });
});

describe('once every data type has completed a pass', () => {
  it('follows the schedule as written: one pass a day for what is new or changed', () => {
    const started = at(3, 2);
    expect(isSyncDue(DAILY, started, at(3, 2, 15), STEADY)).toBe(false);
    expect(isSyncDue(DAILY, started, at(4, 1, 59), STEADY)).toBe(false);
    expect(isSyncDue(DAILY, started, at(4, 2), STEADY)).toBe(true);
  });

  it('is what a caller that says nothing gets', () => {
    const started = at(3, 2);
    const now = at(3, 2, 15);
    expect(isSyncDue(DAILY, started, now)).toBe(isSyncDue(DAILY, started, now, STEADY));
  });
});

describe('what held before still holds', () => {
  it('the back-off: a first copy failing for a cause only a person can clear is still held back', () => {
    // The tick asks `heldBackByFailures` after `isSyncDue` says due. Three
    // failed passes in a row put the gap at an hour: the floor says due at 20
    // minutes, and the ladder still holds it.
    const lastStartedAt = at(3, 12);
    const now = at(3, 12, 20);
    expect(isSyncDue(DAILY, lastStartedAt, now, CATCHING_UP)).toBe(true);
    expect(heldBackByFailures({ consecutiveFailures: 3, anySelfHealing: false, lastStartedAt }, now)).toBe(true);
    // A cause that clears by itself keeps the cadence, which is now the floor.
    expect(heldBackByFailures({ consecutiveFailures: 3, anySelfHealing: true, lastStartedAt }, now)).toBe(false);
  });

  it('a schedule faster than the floor, stored before the doors refused it, still runs at the floor', () => {
    const started = at(3, 12);
    for (const facts of [CATCHING_UP, STEADY]) {
      expect(isSyncDue('* * * * *', started, at(3, 12, 14), facts)).toBe(false);
      expect(isSyncDue('* * * * *', started, at(3, 12, 15), facts)).toBe(true);
    }
  });
});
