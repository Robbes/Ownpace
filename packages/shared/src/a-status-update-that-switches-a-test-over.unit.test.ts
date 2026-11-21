// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A STATUS UPDATE THAT SWITCHES A TEST OVER (workplan 0162 §2 (e); the fourth
 * thing T1 settles before any marker can be set).
 *
 * `updateTransition` is the table `PUT /api/migrations/:id` asks. Handed a
 * migration's test marker, it refuses the four moves that switch a migration
 * over, with T3's sentence in English and Dutch and a code of its own:
 * declaring the cutover (`active` or `paused` to `cutover`) and entering the
 * lane (`cutover` or `done` to `continuous`). And the lane asked for before a
 * cutover (`active` or `paused` to `continuous`) gets the same sentence, not
 * the table's own refusal, whose hint names two doors a test is refused too
 * (the review of #2011). Every other cell answers as it does without a
 * marker: pausing stays open, Start stays Start's, and the refusals the table
 * already makes keep their own codes. Without a marker the whole table is
 * what it was.
 */

import { describe, it, expect } from 'vitest';
import { MAPPING_LIFECYCLES } from './operating-contract.ts';
import { A_TEST_IS_NOT_SWITCHED_OVER, updateTransition } from './lifecycle.ts';

const MARKER = '[Ownpace-test]';

/** The four moves a test migration is refused, by the table's own names. */
const SWITCHES_OVER: ReadonlyArray<readonly [string, string, string]> = [
  ['active', 'cutover', 'declare'],
  ['paused', 'cutover', 'declare'],
  ['cutover', 'continuous', 'enter'],
  ['done', 'continuous', 'enter'],
];

/** The lane asked for before a cutover: the table refuses it anyway, and a test hears T3's sentence. */
const LANE_BEFORE_CUTOVER: ReadonlyArray<readonly [string, string]> = [
  ['active', 'continuous'],
  ['paused', 'continuous'],
];

/** Every cell a test is answered T3's sentence in. */
const REFUSED_A_TEST = [...SWITCHES_OVER.map(([f, t]) => [f, t] as const), ...LANE_BEFORE_CUTOVER];

const refusedATest = (from: string, to: string): boolean =>
  REFUSED_A_TEST.some(([f, t]) => f === from && t === to);

describe('a status update, for a test migration', () => {
  it.each(SWITCHES_OVER)('%s -> %s (%s) is refused, in both languages, and writes nothing', (from, to) => {
    expect(updateTransition(from, to, MARKER)).toEqual({
      refuse: 'A test migration is not switched over: delete it when the test is over.',
      refuseNl: 'Een testmigratie stapt niet over: verwijder hem als de test voorbij is.',
      hint: 'Nothing was changed.',
      code: 'test_migration',
    });
  });

  it('says T3’s own sentence, not a copy of it', () => {
    const refused = updateTransition('active', 'cutover', MARKER);
    expect(refused).toMatchObject({ refuse: A_TEST_IS_NOT_SWITCHED_OVER.en, refuseNl: A_TEST_IS_NOT_SWITCHED_OVER.nl });
  });

  it('pauses, and leaves the lane, as any migration does', () => {
    expect(updateTransition('active', 'paused', MARKER)).toEqual({ apply: true, from: 'active', to: 'paused' });
    expect(updateTransition('continuous', 'cutover', MARKER)).toEqual({ apply: true, from: 'continuous', to: 'cutover' });
  });

  it('sends a resume to Start, which a test may press, as it sends every other', () => {
    expect(updateTransition('paused', 'active', MARKER)).toMatchObject({ code: 'own_door', refuse: expect.stringContaining('Starting') });
  });

  it.each(LANE_BEFORE_CUTOVER)(
    '%s -> %s, the lane before a cutover, says the same sentence, not a hint to declare one',
    (from, to) => {
      expect(updateTransition(from, to, MARKER)).toEqual({
        refuse: A_TEST_IS_NOT_SWITCHED_OVER.en,
        refuseNl: A_TEST_IS_NOT_SWITCHED_OVER.nl,
        hint: 'Nothing was changed.',
        code: 'test_migration',
      });
    },
  );

  it('answers every other cell exactly as it does without a marker', () => {
    for (const from of MAPPING_LIFECYCLES) {
      for (const to of MAPPING_LIFECYCLES) {
        if (refusedATest(from, to)) continue;
        expect(updateTransition(from, to, MARKER), `${from} -> ${to}`).toEqual(updateTransition(from, to));
      }
    }
  });
});

describe('the same status updates, for a migration without a marker', () => {
  it.each(SWITCHES_OVER)('%s -> %s (%s) goes through', (from, to) => {
    expect(updateTransition(from, to)).toEqual({ apply: true, from, to });
    expect(updateTransition(from, to, undefined)).toEqual({ apply: true, from, to });
  });

  it.each(LANE_BEFORE_CUTOVER)('%s -> %s is still sent to declare its cutover first', (from, to) => {
    expect(updateTransition(from, to)).toMatchObject({ code: 'before_cutover', hint: expect.stringContaining('Declare the cutover first') });
  });

  it('carries no Dutch on any refusal: only a test’s sentence is ours in both languages', () => {
    for (const from of MAPPING_LIFECYCLES) {
      for (const to of MAPPING_LIFECYCLES) {
        expect(updateTransition(from, to), `${from} -> ${to}`).not.toHaveProperty('refuseNl');
      }
    }
  });
});
