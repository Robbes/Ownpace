// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// WHEN THE LAST COMPLETED PASS STARTED, from a data type's status row (the
// owner, 2026-11-24). The Check counts only what Gmail holds from before it,
// so mail that arrived since never fails a Check. A later pass that has begun
// overwrites `started_at` with its own start, so the completed one's is read
// from what that start leaves alone.

import { describe, it, expect } from 'vitest';
import { lastCompletedPassStart } from './verification-queries.ts';

const STARTED = new Date('2026-11-10T08:00:00.000Z');
const COMPLETED = new Date('2026-11-10T09:30:00.000Z');

describe('lastCompletedPassStart', () => {
  it('a completed row: its own start', () => {
    expect(
      lastCompletedPassStart({ state: 'completed', startedAt: STARTED, completedAt: COMPLETED, lastPassMetrics: null }),
    ).toEqual(STARTED);
  });

  it('a later pass under way: the completed one ended at completed_at, after its wall time', () => {
    const later = new Date('2026-11-11T08:00:00.000Z');
    expect(
      lastCompletedPassStart({
        state: 'in_progress',
        startedAt: later,
        completedAt: COMPLETED,
        lastPassMetrics: { wallMs: 90 * 60 * 1000, items: 10 },
      }),
    ).toEqual(STARTED);
  });

  it('never completed: none, so nothing is held to the source figure', () => {
    expect(
      lastCompletedPassStart({ state: 'in_progress', startedAt: STARTED, completedAt: null, lastPassMetrics: null }),
    ).toBeUndefined();
    expect(
      lastCompletedPassStart({ state: 'pending', startedAt: STARTED, completedAt: null, lastPassMetrics: null }),
    ).toBeUndefined();
  });

  it('a later pass under way with no measured wall time: none, rather than a guess', () => {
    expect(
      lastCompletedPassStart({ state: 'failed', startedAt: STARTED, completedAt: COMPLETED, lastPassMetrics: null }),
    ).toBeUndefined();
  });

  it('reads the text a driver may hand back as well as a Date', () => {
    expect(
      lastCompletedPassStart({
        state: 'completed',
        startedAt: STARTED.toISOString(),
        completedAt: COMPLETED.toISOString(),
        lastPassMetrics: null,
      }),
    ).toEqual(STARTED);
  });
});
