// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * OF ABOUT HOW MANY (workplan 0154 T2): the rules that turn a progress row's
 * counts into *"18,234 of about 19,000"*, its bar, and *"3.1 of about
 * 3.4 GB"*. Each case is one sentence of the plan.
 */
import { describe, it, expect } from 'vitest';
import { bytesOfAbout, progressTotals, wholePercent } from './progress-totals.ts';

const GB = 1024 ** 3;
const MB = 1024 ** 2;

describe('the total a row is set against', () => {
  it('is what discovery found', () => {
    const totals = progressTotals({ itemsSynced: 18_234, itemsFound: 19_000 });
    expect(totals).toEqual({ kind: 'ofAbout', total: 19_000, copiedShare: 18_234 / 19_000, leftShare: 0 });
  });

  /**
   * ABOUT IS LITERAL. The source keeps changing after discovery counted it, and
   * everything that arrived came from it: the total grows with what arrived,
   * and the bar is never above 100%.
   */
  it('grows with what arrived when that passes it, so the bar stops at 100%', () => {
    const totals = progressTotals({ itemsSynced: 19_250, itemsFound: 19_000 });
    expect(totals).toMatchObject({ kind: 'ofAbout', total: 19_250, copiedShare: 1 });
  });

  it('counts what was left as it was among what arrived', () => {
    const totals = progressTotals({ itemsSynced: 18_700, itemsAdopted: 402, itemsFound: 19_000 });
    expect(totals).toMatchObject({ kind: 'ofAbout', total: 19_102 });
    if (totals.kind !== 'ofAbout') throw new Error('unreachable');
    expect(totals.copiedShare + totals.leftShare).toBe(1);
  });

  it('gives the left-as-they-are part its own share, after the copies', () => {
    const totals = progressTotals({ itemsSynced: 200, itemsAdopted: 402, itemsFound: 612 });
    expect(totals).toEqual({ kind: 'ofAbout', total: 612, copiedShare: 200 / 612, leftShare: 402 / 612 });
  });

  /** Hard rule 9: no count from discovery is no total, never *"of 0"*. */
  it('is not known when discovery has no count', () => {
    expect(progressTotals({ itemsSynced: 412 })).toEqual({ kind: 'notKnown' });
    expect(progressTotals({ itemsSynced: 0, itemsAdopted: 3 })).toEqual({ kind: 'notKnown' });
  });

  /** A counted zero is an answer: the source held none, and none arrived. */
  it('says none were found when discovery counted none and none arrived', () => {
    expect(progressTotals({ itemsSynced: 0, itemsFound: 0 })).toEqual({ kind: 'noneFound' });
    expect(progressTotals({ itemsSynced: 0, itemsAdopted: 0, itemsFound: 0 })).toEqual({ kind: 'noneFound' });
  });

  it('grows from a counted zero when items arrived since', () => {
    expect(progressTotals({ itemsSynced: 5, itemsFound: 0 })).toMatchObject({ kind: 'ofAbout', total: 5, copiedShare: 1 });
  });

  it('starts at an empty bar before anything arrived: a counted zero, not an unknown', () => {
    expect(progressTotals({ itemsSynced: 0, itemsFound: 2_000 })).toMatchObject({ kind: 'ofAbout', copiedShare: 0 });
  });
});

describe("the bar's value for a screen reader", () => {
  it('is whole percent, rounded down, so 99.6% is not announced as done', () => {
    expect(wholePercent(18_234 / 19_000)).toBe(95);
    expect(wholePercent(0.996)).toBe(99);
    expect(wholePercent(1)).toBe(100);
    expect(wholePercent(0)).toBe(0);
  });
});

describe('the bytes, as one quantity', () => {
  it('reads both sides in the total’s unit', () => {
    expect(bytesOfAbout({ itemsSynced: 18_234, bytesTransferred: 3.1 * GB, bytesFound: 3.4 * GB }, 'en')).toEqual({
      done: '3.1',
      total: '3.4 GB',
    });
  });

  it('writes the decimals the way the reader’s language does', () => {
    expect(bytesOfAbout({ itemsSynced: 18_234, bytesTransferred: 3.1 * GB, bytesFound: 3.4 * GB }, 'nl')).toEqual({
      done: '3,1',
      total: '3,4 GB',
    });
  });

  it('gives a part too small for the total’s unit its own, rather than 0.0', () => {
    expect(bytesOfAbout({ itemsSynced: 40, bytesTransferred: 5 * MB, bytesFound: 3.4 * GB }, 'en')).toEqual({
      done: '5.0 MB',
      total: '3.4 GB',
    });
  });

  it('says 0 before anything arrived', () => {
    expect(bytesOfAbout({ itemsSynced: 0, bytesTransferred: 0, bytesFound: 38 * GB }, 'en')).toEqual({
      done: '0',
      total: '38.0 GB',
    });
  });

  it('grows with what arrived, as the items do', () => {
    expect(bytesOfAbout({ itemsSynced: 9, bytesTransferred: 3.6 * GB, bytesFound: 3.4 * GB }, 'en')).toEqual({
      done: '3.6',
      total: '3.6 GB',
    });
  });

  /** Nothing about bytes rather than a number nobody measured (hard rule 9). */
  it('is left out when either side was not measured', () => {
    // No size from discovery: the source has no cheap sizes.
    expect(bytesOfAbout({ itemsSynced: 612, bytesTransferred: 190_000 }, 'en')).toBeNull();
    // Copies with no size recorded for any of them.
    expect(bytesOfAbout({ itemsSynced: 612, bytesTransferred: 0, bytesFound: 4 * MB }, 'en')).toBeNull();
    // A row from before the bytes were read here.
    expect(bytesOfAbout({ itemsSynced: 612, bytesFound: 4 * MB }, 'en')).toBeNull();
    // Nothing found and nothing arrived: *"0 of about 0 B"* says nothing.
    expect(bytesOfAbout({ itemsSynced: 0, bytesTransferred: 0, bytesFound: 0 }, 'en')).toBeNull();
  });
});
