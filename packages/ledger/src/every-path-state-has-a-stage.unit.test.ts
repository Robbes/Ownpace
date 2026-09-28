// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * EVERY PATH STATE HAS A STAGE (workplan 0154 T1 (a)).
 *
 * A data type's phase is its `path_lifecycle.state` (0128 T5), and the words a
 * person reads for it come from `stageOf` in `@openmig/shared`. The path states
 * live here, in `PATH_STATES`, and shared cannot import the ledger, so this is
 * where the two lists meet. A seventh path state added here and not there would
 * be a data type with no word on a person's page.
 */

import { describe, it, expect } from 'vitest';
import { STAGE_PHASES, stageOf } from '@openmig/shared';
import { PATH_STATES } from './path-lifecycle-store.ts';

describe('every path state has a stage', () => {
  it.each([...PATH_STATES])('places %s, and gives it a stage', (state) => {
    expect(STAGE_PHASES).toContain(state);
    expect(stageOf({ phase: state, completedOnce: false })).toBeDefined();
    expect(stageOf({ phase: state, completedOnce: true })).toBeDefined();
  });
});
