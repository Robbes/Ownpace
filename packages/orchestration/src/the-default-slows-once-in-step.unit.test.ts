// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE DEFAULT SLOWS ONCE IN STEP (workplan 0157 T7; the owner, 2026-10-05:
 * *"sync slow down once a migration is in step: yes"*).
 *
 * A migration with no schedule of its own looks every hour for 14 days, every
 * 6 hours after that, and once a day from 30 days on, counted from when its
 * first copy finished or somebody last looked at it, whichever is later. These
 * are the rules `automaticScheduleFor` keeps, and what `isSyncDue` makes of the
 * cron it returns.
 */

import { describe, it, expect } from 'vitest';
import { Cron } from 'croner';
import {
  AUTOMATIC_DAILY_AFTER_DAYS,
  AUTOMATIC_HOURLY_DAYS,
  automaticScheduleFor,
  automaticSince,
  automaticStep,
  isSyncDue,
  shortestGapMinutes,
} from './sync-due.ts';

const T = (iso: string) => new Date(iso);
const DAY = 24 * 60 * 60_000;
const daysAfter = (from: Date, days: number) => new Date(from.getTime() + days * DAY);
const ID = '0157c000-e29b-41d4-a716-446655440001';

/** Realistic ids: the real input is a v4 UUID, not a counter. */
const ids = Array.from({ length: 400 }, (_, i) =>
  `7c${i.toString(16).padStart(6, '0')}-e29b-41d4-a716-${(i * 7919).toString(16).padStart(12, '0').slice(-12)}`,
);

describe('the step, from the days in step', () => {
  const since = T('2026-10-05T07:00:00Z');

  it('looks every hour for the first 14 days', () => {
    expect(AUTOMATIC_HOURLY_DAYS).toBe(14);
    expect(automaticStep(since, since)).toBe('hourly');
    expect(automaticStep(since, new Date(daysAfter(since, 14).getTime() - 1))).toBe('hourly');
  });

  it('every 6 hours from day 14, and once a day from day 30', () => {
    expect(AUTOMATIC_DAILY_AFTER_DAYS).toBe(30);
    expect(automaticStep(since, daysAfter(since, 14))).toBe('six-hourly');
    expect(automaticStep(since, new Date(daysAfter(since, 30).getTime() - 1))).toBe('six-hourly');
    expect(automaticStep(since, daysAfter(since, 30))).toBe('daily');
    expect(automaticStep(since, daysAfter(since, 400))).toBe('daily');
  });

  it('looks every hour while nothing is in step yet', () => {
    expect(automaticStep(null, since)).toBe('hourly');
  });
});

describe('what the days count from', () => {
  const done = T('2026-09-01T10:00:00Z');
  const looked = T('2026-10-01T09:00:00Z');

  it('nothing while the first copy runs: it runs pass after pass then', () => {
    expect(automaticSince(true, done, looked)).toBeNull();
  });

  it('the first copy, or the last look, whichever is later: opening the migration brings it back to hourly', () => {
    expect(automaticSince(false, done, null)).toEqual(done);
    expect(automaticSince(false, null, looked)).toEqual(looked);
    expect(automaticSince(false, done, looked)).toEqual(looked);
    expect(automaticSince(false, looked, done)).toEqual(looked);
    // In step since 1 September, so daily by 5 October; looked at on 1 October, hourly again.
    const now = T('2026-10-05T12:00:00Z');
    expect(automaticStep(automaticSince(false, done, null), now)).toBe('daily');
    expect(automaticStep(automaticSince(false, done, looked), now)).toBe('hourly');
  });
});

describe('the cron the tick reads', () => {
  const since = T('2026-10-05T07:00:00Z');
  const hourly = automaticScheduleFor(ID, since, since);
  const sixHourly = automaticScheduleFor(ID, since, daysAfter(since, 20));
  const daily = automaticScheduleFor(ID, since, daysAfter(since, 31));

  it('runs each step at its own period: 60 minutes, 6 hours, a day', () => {
    expect(shortestGapMinutes(hourly)).toBe(60);
    expect(shortestGapMinutes(sixHourly)).toBe(360);
    expect(shortestGapMinutes(daily)).toBe(1440);
  });

  it('keeps the same migration on the same minute through every step, and the same schedule every time it asks', () => {
    const minute = (cron: string) => cron.split(' ')[0];
    expect(minute(sixHourly)).toBe(minute(hourly));
    expect(minute(daily)).toBe(minute(hourly));
    expect(automaticScheduleFor(ID, since, since)).toBe(hourly);
    expect(automaticScheduleFor(ID, since, daysAfter(since, 20))).toBe(sixHourly);
  });

  it('spreads migrations over the hour, so the first minute does not start them all', () => {
    const minutes = new Set(ids.map((id) => automaticScheduleFor(id, null, since).split(' ')[0]));
    expect(minutes.size).toBeGreaterThanOrEqual(40);
    const hours = new Set(ids.map((id) => automaticScheduleFor(id, since, daysAfter(since, 31)).split(' ')[1]));
    expect(hours.size).toBeGreaterThanOrEqual(20);
  });

  it('is due at the step, never sooner: 6 hours after the last pass started, in the second fortnight', () => {
    const cron = new Cron(sixHourly, { timezone: 'UTC' });
    const lastStarted = cron.nextRun(daysAfter(since, 20))!;
    expect(isSyncDue(sixHourly, lastStarted, new Date(lastStarted.getTime() + 359 * 60_000))).toBe(false);
    expect(isSyncDue(sixHourly, lastStarted, new Date(lastStarted.getTime() + 360 * 60_000))).toBe(true);
  });

  it('reads the schedule in UTC, whatever zone the machine runs in', () => {
    // The self-hosted CI runner does not run in UTC; the servers do. A cron read
    // in the machine's own zone put the six-hourly steps two hours off there
    // and called a pass due four hours after the last one.
    const was = process.env.TZ;
    process.env.TZ = 'Europe/Amsterdam';
    try {
      const lastStarted = new Cron(sixHourly, { timezone: 'UTC' }).nextRun(daysAfter(since, 20))!;
      expect(isSyncDue(sixHourly, lastStarted, new Date(lastStarted.getTime() + 359 * 60_000))).toBe(false);
      expect(isSyncDue(sixHourly, lastStarted, new Date(lastStarted.getTime() + 360 * 60_000))).toBe(true);
      // Daily at 02:00 is 02:00 UTC, not 02:00 in Amsterdam.
      expect(isSyncDue('0 2 * * *', T('2026-10-05T02:00:00Z'), T('2026-10-06T01:59:00Z'))).toBe(false);
      expect(isSyncDue('0 2 * * *', T('2026-10-05T02:00:00Z'), T('2026-10-06T02:00:00Z'))).toBe(true);
    } finally {
      if (was === undefined) delete process.env.TZ;
      else process.env.TZ = was;
    }
  });

  it('still runs a first copy pass after pass, whatever the step', () => {
    const lastStarted = T('2026-10-05T07:00:00Z');
    const fifteenOn = T('2026-10-05T07:15:00Z');
    expect(isSyncDue(daily, lastStarted, fifteenOn, { firstCopyUnfinished: true })).toBe(true);
  });
});
