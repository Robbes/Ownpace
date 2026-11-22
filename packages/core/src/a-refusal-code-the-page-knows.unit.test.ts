// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REFUSAL CODE THE PAGE KNOWS (workplan 0164 T3).
 *
 * *Delete all of these here too* counts an answer as a refusal only when its
 * code is one the destructive path refuses with: a 403 or 404 with a code in
 * `APPLY_REFUSAL_CODES` (`@openmig/shared`), or a 500 `removed_not_recorded`.
 * Anything else is a fault, and a fault stops the run, because whether the
 * copy is gone is not known. So the list has to be the whole of
 * `ApplyRefusal`, no more and no less: a code core adds and the list lacks
 * would turn a gate's answer into a fault, and a code the list keeps after
 * core drops it would let a fault pass as a refusal.
 */

import { describe, it, expect } from 'vitest';
import { APPLY_REFUSAL_CODES, type ApplyRefusalCode } from '@openmig/shared';
import type { ApplyRefusal } from './apply-deletion.ts';

/** True only when the two unions are the same set of strings. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

describe('the refusal codes the page knows', () => {
  it('are exactly the codes core refuses with', () => {
    // Fails to compile when either side has a code the other lacks.
    const same: Same<ApplyRefusal, ApplyRefusalCode> = true;
    expect(same).toBe(true);
  });

  it('are each listed once', () => {
    expect(new Set(APPLY_REFUSAL_CODES).size).toBe(APPLY_REFUSAL_CODES.length);
  });
});
