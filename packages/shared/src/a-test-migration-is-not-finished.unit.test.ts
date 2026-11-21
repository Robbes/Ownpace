// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TEST MIGRATION IS NOT FINISHED (workplan 0162 §2 (e), T3).
 *
 * `finishTransition` is the one decision both editions finish by. Handed a
 * migration's test marker, it refuses, whatever else is true of the migration:
 * paused or running, with failures waiting or none, forced or not. Without
 * one it decides as it always did. The refusal's code is its own, so a page
 * offers no force over it.
 *
 * And the two sentences the doors say, here and at the cutover, exist in
 * English and in Dutch, side by side.
 */

import { describe, it, expect } from 'vitest';
import { A_TEST_IS_NOT_FINISHED, A_TEST_IS_NOT_SWITCHED_OVER, finishTransition } from './lifecycle.ts';

const MARKER = '[Ownpace-test]';

describe('Finish, for a test migration', () => {
  it('is refused, with the reason and a code of its own', () => {
    expect(finishTransition('active', 0, false, MARKER)).toEqual({
      refuse: 'A test migration is not finished: delete it when the test is over.',
      hint: 'Nothing was changed.',
      code: 'test_migration',
    });
  });

  it('is refused from every state a migration finishes from, before the pause and the failures', () => {
    for (const status of ['active', 'cutover', 'continuous', 'paused']) {
      expect(finishTransition(status, 0, false, MARKER)).toMatchObject({ code: 'test_migration' });
      expect(finishTransition(status, 3, false, MARKER)).toMatchObject({ code: 'test_migration' });
    }
  });

  it('is not gone over by force', () => {
    expect(finishTransition('active', 0, true, MARKER)).toMatchObject({ code: 'test_migration' });
    expect(finishTransition('active', 3, true, MARKER)).toMatchObject({ code: 'test_migration' });
  });

  it('says a migration already finished is finished, as it says it of any', () => {
    expect(finishTransition('done', 0, false, MARKER)).toEqual({ finish: false, alreadyDone: true });
  });
});

describe('Finish, for the same migration without a marker', () => {
  it('finishes, refuses and is forced as it always was', () => {
    expect(finishTransition('active', 0)).toEqual({ finish: true });
    expect(finishTransition('active', 0, false, undefined)).toEqual({ finish: true });
    expect(finishTransition('cutover', 0)).toEqual({ finish: true });
    expect(finishTransition('paused', 0)).toMatchObject({ code: 'paused' });
    expect(finishTransition('active', 3)).toMatchObject({ code: 'unresolved_failures' });
    expect(finishTransition('active', 3, true)).toEqual({ finish: true });
  });
});

describe('the two sentences', () => {
  it.each([
    ['not finished', A_TEST_IS_NOT_FINISHED],
    ['not switched over', A_TEST_IS_NOT_SWITCHED_OVER],
  ])('%s: in English and in Dutch, each its own, each ending in what to do', (_what, pair) => {
    expect(pair.en).toMatch(/^A test migration is not .+: delete it when the test is over\.$/);
    expect(pair.nl).toMatch(/^Een testmigratie .+: verwijder hem als de test voorbij is\.$/);
    expect(pair.nl).not.toBe(pair.en);
  });

  it('are two sentences, not one said twice', () => {
    expect(A_TEST_IS_NOT_FINISHED.en).not.toBe(A_TEST_IS_NOT_SWITCHED_OVER.en);
    expect(A_TEST_IS_NOT_FINISHED.nl).not.toBe(A_TEST_IS_NOT_SWITCHED_OVER.nl);
  });
});
