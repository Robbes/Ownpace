// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DOOR THAT ASKED NOBODY (ADR-0049, workplan 0101 T7).
 *
 * `PUT /api/migrations/:id` wrote whatever status its schema admitted. Every
 * other door — Start, Finish, the appliance, the rollback, the cutover —
 * decides through a function in this file first. This test pins the table
 * that door now asks, all twenty-five cells of it, and pins that the table
 * AGREES with the decisions beside it: nothing an update allows is something
 * another door refuses, and every transition that has its own door is sent
 * there rather than performed here.
 */

import { describe, it, expect } from 'vitest';
import { MAPPING_LIFECYCLES } from './operating-contract.ts';
import {
  cutoverTransition,
  finishTransition,
  isAfterCutover,
  rollbackTransition,
  startTransition,
  updateTransition,
} from './lifecycle.ts';

/** The whole table, FROM → TO → what happens. */
const EXPECTED: Record<string, Record<string, 'apply' | 'same' | 'own_door' | 'after_cutover' | 'finished' | 'before_cutover'>> = {
  active:     { active: 'same',     paused: 'apply',         cutover: 'apply',    done: 'own_door', continuous: 'before_cutover' },
  paused:     { active: 'own_door', paused: 'same',          cutover: 'apply',    done: 'own_door', continuous: 'before_cutover' },
  cutover:    { active: 'after_cutover', paused: 'after_cutover', cutover: 'same', done: 'own_door', continuous: 'apply' },
  done:       { active: 'finished', paused: 'finished',      cutover: 'finished', done: 'same',     continuous: 'apply' },
  continuous: { active: 'after_cutover', paused: 'after_cutover', cutover: 'apply', done: 'own_door', continuous: 'same' },
};

function outcome(from: string, to: string): string {
  const t = updateTransition(from, to);
  if ('refuse' in t) return t.code;
  return t.apply ? 'apply' : 'same';
}

describe('updateTransition — the table, every cell', () => {
  it('covers every lifecycle the database can hold, in both directions', () => {
    // The table above is the spec; the list is the vocabulary. They must be
    // the same set, or a sixth state would have cells nobody decided.
    expect(Object.keys(EXPECTED).sort()).toEqual([...MAPPING_LIFECYCLES].sort());
    for (const from of MAPPING_LIFECYCLES) {
      expect(Object.keys(EXPECTED[from]!).sort()).toEqual([...MAPPING_LIFECYCLES].sort());
    }
  });

  for (const from of MAPPING_LIFECYCLES) {
    for (const to of MAPPING_LIFECYCLES) {
      it(`${from} -> ${to}: ${EXPECTED[from]![to]}`, () => {
        expect(outcome(from, to)).toBe(EXPECTED[from]![to]);
      });
    }
  }

  it('refuses a status it does not know, from either side, before anything else', () => {
    expect(updateTransition('ready', 'active')).toMatchObject({ code: 'unknown', refuse: expect.stringContaining("'ready'") });
    expect(updateTransition('active', 'ready')).toMatchObject({ code: 'unknown', refuse: expect.stringContaining("'ready'") });
  });

  it('every refusal says nothing was changed, and every own-door refusal names the door', () => {
    for (const from of MAPPING_LIFECYCLES) {
      for (const to of MAPPING_LIFECYCLES) {
        const t = updateTransition(from, to);
        if (!('refuse' in t)) continue;
        expect(t.hint, `${from} -> ${to}`).toContain('Nothing was changed');
        if (t.code === 'own_door') {
          expect(t.hint, `${from} -> ${to}`).toMatch(to === 'active' ? /\/start/ : /\/finish/);
        }
      }
    }
  });
});

describe('the table agrees with the doors beside it', () => {
  it('never lets an update leave the after-cutover phase — that is the rollback, and only the rollback', () => {
    for (const from of MAPPING_LIFECYCLES) {
      for (const to of MAPPING_LIFECYCLES) {
        if (isAfterCutover(from) && !isAfterCutover(to)) {
          expect('refuse' in updateTransition(from, to), `${from} -> ${to}`).toBe(true);
        }
      }
    }
    // And the rollback is the door that does it, for the states it does it from.
    for (const from of ['cutover', 'continuous']) {
      expect(rollbackTransition(from)).toMatchObject({ reactivate: true, to: 'active' });
      expect(outcome(from, 'active')).toBe('after_cutover');
    }
  });

  it("never reaches 'active' — Start's refusals and Start's first pass would both be skipped", () => {
    for (const from of MAPPING_LIFECYCLES) {
      if (from === 'active') continue;
      expect('refuse' in updateTransition(from, 'active'), from).toBe(true);
      // Where Start would activate, the update sends the caller to Start;
      // where Start refuses, the update refuses for the same reason.
      const start = startTransition(from);
      if ('activate' in start) expect(outcome(from, 'active')).toBe('own_door');
      else expect(['after_cutover', 'finished']).toContain(outcome(from, 'active'));
    }
  });

  it("never reaches 'done' — the unresolved-failures rule lives on the Finish door", () => {
    for (const from of MAPPING_LIFECYCLES) {
      if (from === 'done') continue;
      expect(outcome(from, 'done')).toMatch(/own_door|after_cutover|finished/);
    }
    // `done` is terminal on that door too: it says "already", it does not re-finish.
    expect(finishTransition('done', 0)).toEqual({ finish: false, alreadyDone: true });
  });

  it("stops a mapping for the cutover exactly where the cutover itself would", () => {
    // Declaring 'cutover' by an update and executing a cutover on the CLI are
    // the same act from the mapping's side (ADR-0048): the states one stops,
    // the other admits.
    for (const from of MAPPING_LIFECYCLES) {
      const c = cutoverTransition(from);
      if ('stop' in c && c.stop) expect(outcome(from, 'cutover'), from).toBe('apply');
    }
  });

  it("enters the lane only from after cutover, and 'done' has no other exit", () => {
    for (const from of MAPPING_LIFECYCLES) {
      if (from === 'continuous') continue; // already in it: a no-op, not an entry
      const enters = outcome(from, 'continuous') === 'apply';
      expect(enters, from).toBe(isAfterCutover(from));
    }
    for (const to of MAPPING_LIFECYCLES) {
      if (to === 'done' || to === 'continuous') continue;
      expect(outcome('done', to), `done -> ${to}`).toBe('finished');
    }
  });
});
