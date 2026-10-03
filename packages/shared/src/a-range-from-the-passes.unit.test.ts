// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * HOW LONG, DURING THE COPY (workplan 0154 T3 (b)): a range from the last
 * passes' own pace, its width their spread, and nothing said that was not
 * measured. Each case is one sentence of `time-while-copying.ts`'s header.
 */
import { describe, it, expect } from 'vitest';
import { remainingItemsOf, timeWhileCopying, type PassFacts } from './time-while-copying.ts';

const T0 = Date.parse('2026-10-01T02:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A pass `startedAfter` ms after T0, running 50 minutes, copying `items`. */
const pass = (startedAfter: number, items: number, status = 'success'): PassFacts => ({
  status,
  startedAt: new Date(T0 + startedAfter).toISOString(),
  finishedAt: new Date(T0 + startedAfter + 50 * 60_000).toISOString(),
  itemsProcessed: items,
});
/** Newest first, as the run history serves them. */
const daily = (...items: number[]) => items.map((n, i) => pass((items.length - 1 - i) * DAY, n));

describe('a range from the last passes', () => {
  it('is what is left at the best pass’s pace to the worst’s, a day apart', () => {
    // 1,200 to 2,000 items a pass, a pass a day, 9,000 left: 4.5 to 7.5 days.
    expect(timeWhileCopying({ remainingItems: 9_000, passes: daily(2_000, 1_500, 1_200) })).toEqual({
      kind: 'range',
      unit: 'days',
      low: 4,
      high: 8,
      passes: 3,
      slowed: false,
    });
  });

  it('reads the schedule from how far apart the passes started: hourly is hours', () => {
    const hourly = [3, 2, 1, 0].map((h) => pass(h * HOUR, 500));
    expect(timeWhileCopying({ remainingItems: 2_000, passes: hourly })).toMatchObject({ unit: 'hours', low: 4, high: 5 });
  });

  it('takes the median gap, so one late pass does not stretch the estimate', () => {
    const passes = [pass(5 * DAY, 1_000), pass(2 * DAY, 1_000), pass(DAY, 1_000), pass(0, 1_000)];
    // Gaps of 1, 1 and 3 days: one day.
    expect(timeWhileCopying({ remainingItems: 3_000, passes })).toMatchObject({ unit: 'days', low: 3, high: 4 });
  });

  it('counts at most the last five passes', () => {
    const passes = daily(1_000, 1_000, 1_000, 1_000, 1_000, 10);
    expect(timeWhileCopying({ remainingItems: 3_000, passes })).toMatchObject({ passes: 5, high: 4 });
  });

  it('says up to, not from zero, when the best pace finishes within the unit', () => {
    expect(timeWhileCopying({ remainingItems: 500, passes: daily(2_000, 400, 1_000) })).toMatchObject({
      unit: 'days',
      low: 0,
      high: 2,
    });
  });

  it('says the provider slowed it down, where a data type’s last error said so', () => {
    expect(timeWhileCopying({ remainingItems: 9_000, passes: daily(2_000, 1_500, 1_200), slowed: true })).toMatchObject({
      slowed: true,
    });
  });
});

describe('what the rate is not taken from', () => {
  /** A pass that found nothing new says nothing about how fast the rest will come. */
  it('skips failed passes, passes that copied nothing, and passes still running', () => {
    const passes = [
      pass(4 * DAY, 0),
      { ...pass(3 * DAY, 900), finishedAt: null },
      pass(2 * DAY, 1_000, 'failed'),
      ...daily(1_000, 1_000),
    ];
    expect(timeWhileCopying({ remainingItems: 3_000, passes })).toEqual({ kind: 'afterThreePasses', passesSoFar: 2 });
  });

  it('waits for three passes, and says how many it has', () => {
    expect(timeWhileCopying({ remainingItems: 3_000, passes: daily(1_000) })).toEqual({
      kind: 'afterThreePasses',
      passesSoFar: 1,
    });
  });
});

/** Hard rule 9: no range of part of what is left, and nothing once nothing is. */
describe('when nothing is said', () => {
  it('nothing left: the migration is catching up to its own last pass', () => {
    expect(timeWhileCopying({ remainingItems: 0, passes: daily(1_000, 1_000, 1_000) })).toBeUndefined();
  });

  it('a total not known', () => {
    expect(timeWhileCopying({ remainingItems: undefined, passes: daily(1_000, 1_000, 1_000) })).toBeUndefined();
  });
});

describe('what is left', () => {
  it('is each total less what arrived and what was left as it was', () => {
    expect(
      remainingItemsOf([
        { itemsSynced: 18_234, itemsFound: 19_000 },
        { itemsSynced: 210, itemsAdopted: 402, itemsFound: 612 },
      ]),
    ).toBe(766);
  });

  it('is never below zero for a total the copy passed', () => {
    expect(remainingItemsOf([{ itemsSynced: 19_250, itemsFound: 19_000 }])).toBe(0);
  });

  it('is unknown where any data type has no total', () => {
    expect(remainingItemsOf([{ itemsSynced: 10, itemsFound: 20 }, { itemsSynced: 412 }])).toBeUndefined();
  });
});
