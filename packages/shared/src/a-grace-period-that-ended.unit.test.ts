// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GRACE PERIOD THAT ENDED (workplan 0128 D7, T5 slice 7c).
 *
 * When a grace period ends and nobody chose, copying stops, and the owner is
 * told on the Finish page and in the digest. What they are told is when it
 * ended, by one rule: its hours from its start in `GRACE_PERIOD`, or when it
 * was closed in `COMPLETED`. Every other state has no grace period behind it.
 */

import { describe, it, expect } from 'vitest';
import { cutoverGraceEndedAt, type CutoverWindow } from './lifecycle.ts';

const HOUR = 3_600_000;
const start = new Date('2026-09-20T10:00:00Z');
const window = (over: Partial<CutoverWindow & { completedAt: Date | null }> = {}) => ({
  state: 'GRACE_PERIOD',
  copiesThroughGrace: true,
  enteredAt: new Date(start.getTime() - HOUR),
  graceStartedAt: start,
  graceHours: 72,
  ...over,
});

describe('when a grace period ended', () => {
  it('has not, a minute before its hours are up; has, from the moment they are', () => {
    const end = new Date(start.getTime() + 72 * HOUR);
    expect(cutoverGraceEndedAt(window(), new Date(end.getTime() - 60_000))).toBeNull();
    expect(cutoverGraceEndedAt(window(), end)).toEqual(end);
    expect(cutoverGraceEndedAt(window({ graceHours: 1 }), end)).toEqual(new Date(start.getTime() + HOUR));
  });

  it('ended when it was closed, or when the row last changed state where no close was recorded', () => {
    const closed = new Date(start.getTime() + 10 * HOUR);
    expect(cutoverGraceEndedAt(window({ state: 'COMPLETED', completedAt: closed }), start)).toEqual(closed);
    // Closed early, with no close recorded: never a date its hours would reach later.
    expect(cutoverGraceEndedAt(window({ state: 'COMPLETED', completedAt: null, enteredAt: closed }), start)).toEqual(
      closed,
    );
  });

  it('ends for a migration that was not copying too: its owner still has a choice to make', () => {
    const later = new Date(start.getTime() + 100 * HOUR);
    expect(cutoverGraceEndedAt(window({ copiesThroughGrace: false }), later)).toEqual(
      new Date(start.getTime() + 72 * HOUR),
    );
  });

  it('has none behind it in any other state', () => {
    const later = new Date(start.getTime() + 100 * HOUR);
    for (const state of ['CUTOVER_IN_PROGRESS', 'APPROVED', 'READY_FOR_CUTOVER', 'ROLLED_BACK', 'FAILED']) {
      expect(cutoverGraceEndedAt(window({ state }), later)).toBeNull();
    }
    expect(cutoverGraceEndedAt(window({ graceStartedAt: null }), later)).toBeNull();
  });
});
