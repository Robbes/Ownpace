// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PASS A MINUTE (workplan 0143 T2b): the tick's half.
 *
 * The screens offer four cadences, the fastest every 15 minutes, but the API
 * stored any cron expression it could read. `* * * * *` asked the tick for a
 * pass a minute, on a machine sized for twenty organisations doing their first
 * copies. Both doors now refuse a schedule faster than the floor (the API's
 * half has its own test). Here:
 *
 *  1. `shortestGapMinutes` answers what croner, and so the tick, would do with
 *     a schedule: the shortest gap between two runs;
 *  2. a schedule stored before the doors refused it runs at the floor, so it
 *     starts at most four passes an hour;
 *  3. every other schedule is read exactly as before, the default included.
 */

import { describe, it, expect } from 'vitest';
import { isSyncDue, SCHEDULE_FLOOR_MINUTES, shortestGapMinutes } from './sync-due.ts';

const T = (iso: string) => new Date(iso);

describe('the shortest gap a schedule asks for', () => {
  it.each([
    ['* * * * *', 1],
    ['*/5 * * * *', 5],
    ['0,5 * * * *', 5],
    ['*/15 * * * *', 15],
    ['7,22,37,52 * * * *', 15],
    ['0 * * * *', 60],
    ['@hourly', 60],
    ['0 9-17 * * 1-5', 60],
    ['0 */6 * * *', 360],
    ['0 2 * * *', 1440],
  ])('%s: %d minutes', (expression, minutes) => {
    expect(shortestGapMinutes(expression)).toBe(minutes);
  });

  it('is endless for a schedule that runs once a week or less', () => {
    expect(shortestGapMinutes('@weekly')).toBe(Number.POSITIVE_INFINITY);
    expect(shortestGapMinutes('30 1 1 * *')).toBe(Number.POSITIVE_INFINITY);
  });

  it('is 15 minutes, the fastest cadence the screens offer', () => {
    expect(SCHEDULE_FLOOR_MINUTES).toBe(15);
  });
});

describe('a schedule faster than the floor, stored before the doors refused it', () => {
  it.each([['* * * * *'], ['*/5 * * * *']])('%s waits the floor after the last start', (schedule) => {
    const started = T('2026-08-01T12:00:00Z');
    expect(isSyncDue(schedule, started, T('2026-08-01T12:01:00Z'))).toBe(false);
    expect(isSyncDue(schedule, started, T('2026-08-01T12:14:59Z'))).toBe(false);
    expect(isSyncDue(schedule, started, T('2026-08-01T12:15:00Z'))).toBe(true);
  });

  it('starts at most four passes an hour, where it asked for sixty', () => {
    let lastStarted: Date | null = null;
    let passes = 0;
    for (let minute = 0; minute < 60; minute++) {
      const now = new Date(Date.UTC(2026, 7, 1, 12, minute));
      if (isSyncDue('* * * * *', lastStarted, now)) {
        passes += 1;
        lastStarted = now;
      }
    }
    expect(passes).toBe(4);
  });
});

describe('every other schedule', () => {
  it('is read as written: a pass started late is followed at the next firing', () => {
    // Started 12:14 by hand, every 15 minutes: due at 12:15, as before.
    expect(isSyncDue('*/15 * * * *', T('2026-08-01T12:14:00Z'), T('2026-08-01T12:15:00Z'))).toBe(true);
    expect(isSyncDue('0 * * * *', T('2026-08-01T12:50:00Z'), T('2026-08-01T13:00:00Z'))).toBe(true);
  });

  it('including the default', () => {
    expect(isSyncDue(null, T('2026-08-01T12:00:00Z'), T('2026-08-01T12:10:00Z'))).toBe(false);
    expect(isSyncDue(null, T('2026-08-01T12:00:00Z'), T('2026-08-01T12:15:00Z'))).toBe(true);
  });
});
