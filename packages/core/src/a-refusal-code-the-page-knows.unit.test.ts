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
 *
 * Held twice: by the compiler (`Same`, and `EVERY_REFUSAL`, a record that
 * must have a key for each code core refuses with and no other), and at run
 * time, by comparing the list with that record, so a drifted list fails
 * under vitest too and not only under `tsc`.
 */

import { describe, it, expect } from 'vitest';
import { APPLY_REFUSAL_CODES, type ApplyRefusalCode } from '@openmig/shared';
import type { ApplyRefusal } from './apply-deletion.ts';

/** True only when the two unions are the same set of strings. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Every code core refuses with, once: the compiler fails this record for a
 * missing key and for one that is not an `ApplyRefusal`.
 */
const EVERY_REFUSAL: Record<ApplyRefusal, true> = {
  target_cannot_remove: true,
  not_found: true,
  not_confirmed: true,
  weak_evidence: true,
  not_ours: true,
  already_applied: true,
  after_cutover: true,
  edited_on_target: true,
  version_unknown: true,
  kept_for_guests: true,
  mass_deletion_suspected: true,
  mass_relocation_suspected: true,
  already_kept: true,
  not_relocated: true,
  relocation_unconfirmed: true,
  target_cannot_confirm: true,
  removed_not_recorded: true,
};

describe('the refusal codes the page knows', () => {
  it('are exactly the codes core refuses with', () => {
    // Fails to compile when either side has a code the other lacks.
    const same: Same<ApplyRefusal, ApplyRefusalCode> = true;
    expect(same).toBe(true);
  });

  it('are the record of every code core refuses with, at run time too', () => {
    expect([...APPLY_REFUSAL_CODES].sort()).toEqual(Object.keys(EVERY_REFUSAL).sort());
  });

  it('are each listed once', () => {
    expect(new Set(APPLY_REFUSAL_CODES).size).toBe(APPLY_REFUSAL_CODES.length);
  });
});
