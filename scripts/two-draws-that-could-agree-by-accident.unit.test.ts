// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * TWO DRAWS OF A ONE-BYTE WOBBLE CAN AGREE, AND THE SCRIPT WOULD HAVE CALLED
 * THAT STABLE.
 *
 * `drive-export-stability.ts` exported an unchanged document exactly twice and
 * compared the two. That is the right shape for a big difference and the wrong
 * shape for a small one, which is what Drive actually produces.
 *
 * Measured on the owner's tenant, 2026-09-16, `export-odf`, one Google Doc, two
 * separate runs of the script:
 *
 *   run 1   3127560, 3127558
 *   run 2   3127561, 3127560
 *
 * Three distinct sizes inside a FOUR-BYTE window, and 3127560 came back in both
 * runs. Nothing about that rendering is stable — but two draws of something
 * moving by a byte or two can land on the same value, and a two-draw test that
 * did would have printed STABLE over a policy that re-copies every document in
 * the migration, nightly, forever, with every write succeeding and nothing
 * looking wrong.
 *
 * The measurement exists to prevent exactly that outcome. It could have caused
 * it. `export-odf` is already settled — this matters for `export-office` and
 * `export-pdf`, which nobody has measured yet, and which will be measured with
 * this instrument.
 */

import { describe, it, expect } from 'vitest';
import { stabilityVerdict, type ExportSample } from './drive-export-verdict.ts';

const sample = (bytes: number, hash: string): ExportSample => ({ bytes, hash });

describe('the verdict over several draws', () => {
  it('calls it stable only when every draw hashed the same', () => {
    const v = stabilityVerdict([sample(10, 'a'), sample(10, 'a'), sample(10, 'a')]);
    expect(v.stable).toBe(true);
    expect(v.renderings).toBe(1);
  });

  it('ONE disagreeing draw among many is not stable — the headline', () => {
    // The whole reason for more draws. Four agree, the fifth does not, and a
    // two-draw test that happened to take the first two would have missed it.
    const v = stabilityVerdict([
      sample(10, 'a'),
      sample(10, 'a'),
      sample(10, 'a'),
      sample(10, 'a'),
      sample(11, 'b'),
    ]);
    expect(v.stable).toBe(false);
    expect(v.renderings).toBe(2);
  });

  it("reports the owner's real export-odf numbers as unstable, with every size", () => {
    // The measurement that produced this file, as the fixture. Both runs'
    // samples together: three sizes, and one of them seen twice.
    const v = stabilityVerdict([
      sample(3127560, 'h1'),
      sample(3127558, 'h2'),
      sample(3127561, 'h3'),
      sample(3127560, 'h4'),
    ]);
    expect(v.stable).toBe(false);
    expect(v.renderings).toBe(4);
    // Ascending, de-duplicated — an operator reading the refusal sees the window.
    expect(v.sizes).toEqual([3127558, 3127560, 3127561]);
    expect(v.note).toContain('3127558, 3127560, 3127561');
  });

  it('a repeated SIZE is not a repeated rendering', () => {
    // 3127560 twice, different bytes both times. Counting distinct sizes rather
    // than distinct hashes would have called this two renderings, not three —
    // and a size-based verdict would call a same-length wobble stable outright.
    const v = stabilityVerdict([sample(10, 'a'), sample(10, 'b'), sample(10, 'c')]);
    expect(v.stable).toBe(false);
    expect(v.renderings).toBe(3);
    expect(v.sizes).toEqual([10]);
    // And it says WHICH kind of instability, because they need different fixes:
    // same-length means a field overwritten in place.
    expect(v.note).toContain('Same LENGTH');
  });

  it('different lengths are named as such — the cheap workaround is ruled out', () => {
    // A field that changed SIZE cannot be normalised by skipping a fixed offset,
    // which is the distinction the owner's measurement turned on.
    const v = stabilityVerdict([sample(10, 'a'), sample(12, 'b')]);
    expect(v.note).toContain('Lengths differ');
    expect(v.note).not.toContain('Same LENGTH');
  });

  it('REFUSES a single draw rather than reporting it stable', () => {
    // One export cannot disagree with anything. Returning `stable: true` here
    // would make SAMPLES=1 a switch that turns every policy green.
    expect(() => stabilityVerdict([sample(10, 'a')])).toThrow(/at least 2/);
    expect(() => stabilityVerdict([])).toThrow(/at least 2/);
  });
});
