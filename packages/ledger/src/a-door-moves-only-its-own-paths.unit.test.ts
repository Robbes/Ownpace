// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHICH PATHS A PRESS ON THE WHOLE MIGRATION MOVES (workplan 0128 T5, slice
 * 5a).
 *
 * Once a data type can be cut over on its own (slice 5b), a migration's paths
 * are not all in one phase. A press on the whole migration then moves only the
 * paths in the phase it leaves, so pausing, resuming or starting the rest never
 * moves a cut-over data type back before its cutover, where its deletion
 * detectors would come back (0117 D4). Rows that do not add up to the status
 * are not believed, and every path moves, as before. The rule on its own here;
 * the doors that use it are pinned at the routes
 * (`path-lifecycle-wiring.unit.test.ts`).
 */

import { describe, it, expect } from 'vitest';
import { pathFollows } from './paths-follow-the-mapping.ts';

describe('a path moves with its migration', () => {
  it('where the rows are believed, when it is in the phase the migration leaves', () => {
    const pause = { from: 'active', to: 'paused' } as const;
    expect(pathFollows(pause, 'active', true)).toBe(true);
    expect(pathFollows(pause, 'cutover', true)).toBe(false);
    expect(pathFollows(pause, undefined, true)).toBe(false);

    const rollback = { from: 'cutover', to: 'active' } as const;
    expect(pathFollows(rollback, 'cutover', true)).toBe(true);
    expect(pathFollows(rollback, 'continuous', true)).toBe(false);
    expect(pathFollows(rollback, 'done', true)).toBe(false);

    const lane = { from: 'cutover', to: 'continuous' } as const;
    expect(pathFollows(lane, 'cutover', true)).toBe(true);
    expect(pathFollows(lane, 'done', true)).toBe(false);
  });

  it('a start also starts a path that never ran, and never one past its cutover', () => {
    const resume = { from: 'paused', to: 'active' } as const;
    expect(pathFollows(resume, 'paused', true)).toBe(true);
    expect(pathFollows(resume, undefined, true)).toBe(true);
    expect(pathFollows(resume, 'ready', true)).toBe(true);
    expect(pathFollows(resume, 'cutover', true)).toBe(false);
    expect(pathFollows(resume, 'continuous', true)).toBe(false);
    expect(pathFollows(resume, 'done', true)).toBe(false);
  });

  it('finishing ends every path that has not ended, and conjures none', () => {
    const finish = { from: 'active', to: 'done' } as const;
    for (const phase of ['active', 'paused', 'cutover', 'continuous']) expect(pathFollows(finish, phase, true)).toBe(true);
    expect(pathFollows(finish, 'done', true)).toBe(false);
    expect(pathFollows(finish, undefined, true)).toBe(false);
  });

  it('where the rows are not believed, every path that has a row moves, and a start starts every one', () => {
    for (const phase of ['active', 'paused', 'cutover', 'continuous', 'done']) {
      expect(pathFollows({ from: 'paused', to: 'cutover' }, phase, false)).toBe(true);
      expect(pathFollows({ from: 'paused', to: 'active' }, phase, false)).toBe(true);
    }
    expect(pathFollows({ from: 'paused', to: 'cutover' }, undefined, false)).toBe(false);
    // A migration created running has no status to leave, and no rows.
    expect(pathFollows({ from: null, to: 'active' }, undefined, false)).toBe(true);
  });
});
