// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A PERSON'S STEPS BEFORE THEY SWITCH (workplan 0153 T5, 0154 T4): the hub's
 * seven, summed across a person's migrations, each with a state in words.
 * Every rule `cutover-steps.ts`'s header states is held here.
 */
import { describe, it, expect } from 'vitest';
import type { MappingAttention } from '@openmig/shared';
import { personSteps, type Step } from './cutover-steps.ts';

const quiet = (mappingId: string, over: Partial<MappingAttention> = {}): MappingAttention => ({
  mappingId,
  pendingDecisions: 0,
  deletionsWaiting: 0,
  movesWaiting: 0,
  failuresWaiting: 0,
  readyForCutover: false,
  autoApplied: 0,
  sharingOpen: 0,
  ...over,
});

const byKey = (steps: Step[]) => Object.fromEntries(steps.map((s) => [s.key, s]));
const read = (...rows: MappingAttention[]) => new Map(rows.map((r) => [r.mappingId, r]));

describe("a person's steps before they switch (0154 T4)", () => {
  it('lists the seven in cutover order', () => {
    expect(personSteps([{ id: 'm1', status: 'active' }], read(quiet('m1'))).map((s) => s.key)).toEqual([
      'deletions',
      'moves',
      'failures',
      'sharing',
      'check',
      'confirmed',
      'finish',
    ]);
  });

  it('sums each queue across the migrations, and it needs the person while anything waits', () => {
    const steps = byKey(
      personSteps(
        [
          { id: 'm1', status: 'active' },
          { id: 'm2', status: 'active' },
        ],
        read(quiet('m1', { deletionsWaiting: 2, failuresWaiting: 1 }), quiet('m2', { failuresWaiting: 3 })),
      ),
    );
    expect(steps['deletions']).toMatchObject({ count: 2, state: 'needsYou' });
    expect(steps['deletions']!.perMigration).toEqual([
      { id: 'm1', count: 2 },
      { id: 'm2', count: 0 },
    ]);
    expect(steps['failures']).toMatchObject({ count: 4, state: 'needsYou' });
    expect(steps['moves']).toMatchObject({ count: 0, state: 'done' });
  });

  it('keeps sharing for after finishing: not yet, until every migration is done', () => {
    const before = byKey(personSteps([{ id: 'm1', status: 'active' }], read(quiet('m1', { sharingOpen: 5 }))));
    expect(before['sharing']).toMatchObject({ count: 5, state: 'notYet' });
    const after = byKey(personSteps([{ id: 'm1', status: 'done' }], read(quiet('m1', { sharingOpen: 5 }))));
    expect(after['sharing']).toMatchObject({ count: 5, state: 'needsYou' });
    const through = byKey(personSteps([{ id: 'm1', status: 'done' }], read(quiet('m1'))));
    expect(through['sharing']).toMatchObject({ count: 0, state: 'done' });
  });

  it('passes the check when every migration is ready to finish, or already in or past its cutover', () => {
    const partly = byKey(
      personSteps(
        [
          { id: 'm1', status: 'active' },
          { id: 'm2', status: 'active' },
        ],
        read(quiet('m1', { readyForCutover: true }), quiet('m2')),
      ),
    );
    expect(partly['check']).toMatchObject({ count: 1, state: 'notYet' });
    expect(partly['confirmed']!.state).toBe('notYet');

    const all = byKey(
      personSteps(
        [
          { id: 'm1', status: 'active' },
          { id: 'm2', status: 'cutover' },
        ],
        read(quiet('m1', { readyForCutover: true }), quiet('m2')),
      ),
    );
    expect(all['check']).toMatchObject({ count: 2, state: 'done' });
    // Confirmed follows the check: a list, ready to read.
    expect(all['confirmed']!.state).toBe('done');
  });

  it('needs the person to finish while a migration is in its cutover, and is done when all are', () => {
    const cutting = byKey(
      personSteps(
        [
          { id: 'm1', status: 'cutover' },
          { id: 'm2', status: 'done' },
        ],
        read(quiet('m1')),
      ),
    );
    expect(cutting['finish']!.state).toBe('needsYou');
    const finished = byKey(
      personSteps(
        [
          { id: 'm1', status: 'done' },
          { id: 'm2', status: 'done' },
        ],
        read(),
      ),
    );
    expect(finished['finish']!.state).toBe('done');
    const early = byKey(personSteps([{ id: 'm1', status: 'active' }], read(quiet('m1'))));
    expect(early['finish']!.state).toBe('notYet');
  });

  it('says a count could not be read, and claims no state, when the read failed (hard rule 9)', () => {
    const steps = byKey(personSteps([{ id: 'm1', status: 'active' }], undefined));
    for (const key of ['deletions', 'moves', 'failures', 'sharing', 'check', 'confirmed']) {
      expect(steps[key]!.state, `${key} claims a state it could not read`).toBeUndefined();
    }
    expect(steps['deletions']!.count).toBeUndefined();
  });

  it('says so too for a migration whose queue could not be read (a blind spot)', () => {
    const steps = byKey(
      personSteps(
        [
          { id: 'm1', status: 'active' },
          { id: 'm2', status: 'active' },
        ],
        read(quiet('m1', { deletionsWaiting: 2 }), quiet('m2', { blindSpots: ['the deletions queue: timeout'] })),
      ),
    );
    expect(steps['deletions']).toMatchObject({ count: undefined, state: undefined });
    expect(steps['deletions']!.perMigration).toEqual([
      { id: 'm1', count: 2 },
      { id: 'm2', count: undefined },
    ]);
  });

  it('counts nothing for a migration the read did not list, which has nothing waiting', () => {
    const steps = byKey(personSteps([{ id: 'm1', status: 'active' }], read()));
    expect(steps['failures']).toMatchObject({ count: 0, state: 'done' });
  });
});
