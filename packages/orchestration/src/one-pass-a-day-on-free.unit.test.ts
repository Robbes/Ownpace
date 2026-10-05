// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONE PASS A DAY ON FREE (workplan 0157 T2; ADR-0014, Amendment 2026-10-04,
 * evening).
 *
 * The tick reads the least minutes between two passes from the tier the
 * organisation's month bills (`leastMinutesBetweenPasses`, `@openmig/managed`)
 * and hands it to `isSyncDue` as a plain number. These are the rules that
 * number keeps: a day on Free, from the last pass's START, the first copy's
 * passes included; only ever later than the schedule would run, never sooner;
 * a migration that never ran still due at once; and a schedule nobody can
 * read still refused out loud.
 */

import { describe, it, expect } from 'vitest';
import { isSyncDue } from './sync-due.ts';

const T = (iso: string) => new Date(iso);
const DAY = 24 * 60;
const free = (firstCopyUnfinished = false) => ({ firstCopyUnfinished, leastMinutesBetweenPasses: DAY });

describe("a tier's pace holds every pass back from the last one's start (0157 T2)", () => {
  it('a Free migration that started a pass 23 hours ago is not due; at 24 hours it is', () => {
    const last = T('2026-10-05T07:12:00Z');
    expect(isSyncDue('0 * * * *', last, T('2026-10-06T06:12:00Z'), free())).toBe(false);
    expect(isSyncDue('0 * * * *', last, T('2026-10-06T07:11:59Z'), free())).toBe(false);
    expect(isSyncDue('0 * * * *', last, T('2026-10-06T07:12:00Z'), free())).toBe(true);
  });

  it('holds a first copy too: on Free its passes are a day apart, where a paid tier runs them back to back', () => {
    const last = T('2026-10-05T12:00:00Z');
    const twentyMinutesOn = T('2026-10-05T12:20:00Z');
    expect(isSyncDue('0 2 * * *', last, twentyMinutesOn, { firstCopyUnfinished: true })).toBe(true);
    expect(isSyncDue('0 2 * * *', last, twentyMinutesOn, free(true))).toBe(false);
    expect(isSyncDue('0 2 * * *', last, T('2026-10-06T12:00:00Z'), free(true))).toBe(true);
  });

  it('a migration that never ran is due at once, whatever the pace: the first pass follows the preflight', () => {
    expect(isSyncDue('0 * * * *', null, T('2026-10-05T07:12:00Z'), free(true))).toBe(true);
  });

  it('never runs a pass sooner than the schedule would: a weekly schedule stays weekly', () => {
    // Mondays at 03:00; started Monday 5 October at 03:00.
    const last = T('2026-10-05T03:00:00Z');
    expect(isSyncDue('0 3 * * 1', last, T('2026-10-06T03:01:00Z'), free())).toBe(false);
    expect(isSyncDue('0 3 * * 1', last, T('2026-10-12T03:00:00Z'), free())).toBe(true);
  });

  it('no floor at all when the number is 0 or absent: a paid tier keeps its schedule', () => {
    const last = T('2026-10-05T07:00:00Z');
    const anHourOn = T('2026-10-05T08:00:00Z');
    expect(isSyncDue('0 * * * *', last, anHourOn, { firstCopyUnfinished: false, leastMinutesBetweenPasses: 0 })).toBe(true);
    expect(isSyncDue('0 * * * *', last, anHourOn, { firstCopyUnfinished: false })).toBe(true);
  });

  it('reads the schedule first: one croner cannot read is refused out loud, also while the pace holds it back', () => {
    expect(() => isSyncDue('not a cron', T('2026-10-05T07:00:00Z'), T('2026-10-05T08:00:00Z'), free())).toThrow();
  });
});
