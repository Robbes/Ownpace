// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE STEPS BEFORE A SWITCH (workplan 0153 T5, 0154 T4): the hub's seven, for
 * one migration or summed across a person's, each with a state in words.
 * Every rule `cutover-steps.ts`'s header states is held here.
 */
import { describe, it, expect } from 'vitest';
import type { CheckFacts, MappingAttention } from '@openmig/shared';
import { checksOf, cutoverSteps, type Step, type StepsMigration } from './cutover-steps.ts';

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
const checks = (...rows: [string, CheckFacts][]) => new Map(rows);
const NOT_RUN: CheckFacts = { state: 'not_run' };
const AT = '2026-10-01T09:05:00.000Z';

/** The queues' rules, with every migration's check read and not run. */
const stepsWith = (migrations: StepsMigration[], attention: ReadonlyMap<string, MappingAttention> | undefined) =>
  cutoverSteps(migrations, attention, checks(...migrations.map((m): [string, CheckFacts] => [m.id, NOT_RUN])));
const read = (...rows: MappingAttention[]) => new Map(rows.map((r) => [r.mappingId, r]));

describe("a person's steps before they switch (0154 T4)", () => {
  it('lists the seven in cutover order', () => {
    expect(stepsWith([{ id: 'm1', status: 'active' }], read(quiet('m1'))).map((s) => s.key)).toEqual([
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
      stepsWith(
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
    const before = byKey(stepsWith([{ id: 'm1', status: 'active' }], read(quiet('m1', { sharingOpen: 5 }))));
    expect(before['sharing']).toMatchObject({ count: 5, state: 'notYet' });
    const after = byKey(stepsWith([{ id: 'm1', status: 'done' }], read(quiet('m1', { sharingOpen: 5 }))));
    expect(after['sharing']).toMatchObject({ count: 5, state: 'needsYou' });
    const through = byKey(stepsWith([{ id: 'm1', status: 'done' }], read(quiet('m1'))));
    expect(through['sharing']).toMatchObject({ count: 0, state: 'done' });
  });

  it('passes the check when every migration’s check passed, or it is already in or past its cutover', () => {
    const two: StepsMigration[] = [
      { id: 'm1', status: 'active' },
      { id: 'm2', status: 'active' },
    ];
    const partly = byKey(
      cutoverSteps(two, read(quiet('m1'), quiet('m2')), checks(['m1', { state: 'passed', at: AT }], ['m2', NOT_RUN])),
    );
    expect(partly['check']).toMatchObject({ count: 1, state: 'notYet', check: { kind: 'partly', passed: 1, total: 2 } });
    expect(partly['confirmed']!.state).toBe('notYet');

    const all = byKey(
      cutoverSteps(
        [
          { id: 'm1', status: 'active' },
          { id: 'm2', status: 'cutover' },
        ],
        read(quiet('m1'), quiet('m2')),
        checks(['m1', { state: 'passed', at: AT }], ['m2', NOT_RUN]),
      ),
    );
    expect(all['check']).toMatchObject({ count: 2, state: 'done', check: { kind: 'passed' } });
    // Confirmed follows the check: a list, ready to read.
    expect(all['confirmed']!.state).toBe('done');
  });

  it('needs the person to finish while a migration is in its cutover, and is done when all are', () => {
    const cutting = byKey(
      stepsWith(
        [
          { id: 'm1', status: 'cutover' },
          { id: 'm2', status: 'done' },
        ],
        read(quiet('m1')),
      ),
    );
    expect(cutting['finish']!.state).toBe('needsYou');
    const finished = byKey(
      stepsWith(
        [
          { id: 'm1', status: 'done' },
          { id: 'm2', status: 'done' },
        ],
        read(),
      ),
    );
    expect(finished['finish']!.state).toBe('done');
    const early = byKey(stepsWith([{ id: 'm1', status: 'active' }], read(quiet('m1'))));
    expect(early['finish']!.state).toBe('notYet');
  });

  it('says a count could not be read, and claims no state, when the read failed (hard rule 9)', () => {
    const steps = byKey(stepsWith([{ id: 'm1', status: 'active' }], undefined));
    for (const key of ['deletions', 'moves', 'failures', 'sharing']) {
      expect(steps[key]!.state, `${key} claims a state it could not read`).toBeUndefined();
    }
    expect(steps['deletions']!.count).toBeUndefined();
    // The check has a read of its own, and says what it read.
    expect(steps['check']).toMatchObject({ state: 'notYet', check: { kind: 'notRun' } });
    const neither = byKey(cutoverSteps([{ id: 'm1', status: 'active' }], undefined, undefined));
    for (const key of ['deletions', 'moves', 'failures', 'sharing', 'check', 'confirmed']) {
      expect(neither[key]!.state, `${key} claims a state it could not read`).toBeUndefined();
    }
  });

  it('says so too for a migration whose queue could not be read (a blind spot)', () => {
    const steps = byKey(
      stepsWith(
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
    const steps = byKey(stepsWith([{ id: 'm1', status: 'active' }], read()));
    expect(steps['failures']).toMatchObject({ count: 0, state: 'done' });
  });
});

describe('the check, as the row says it (0154 T4)', () => {
  const one = (facts: CheckFacts | undefined, status = 'active') =>
    byKey(cutoverSteps([{ id: 'm1', status }], read(quiet('m1')), facts ? checks(['m1', facts]) : new Map()))['check']!;

  it('says each of the five things a check can be, and when, for one migration', () => {
    expect(one({ state: 'passed', at: AT })).toMatchObject({ state: 'done', check: { kind: 'passed', at: AT } });
    expect(one({ state: 'not_passed', at: AT })).toMatchObject({ state: 'notYet', check: { kind: 'notPassed', at: AT } });
    expect(one({ state: 'could_not_run', at: AT })).toMatchObject({
      state: 'notYet',
      check: { kind: 'couldNotRun', at: AT },
    });
    expect(one({ state: 'running', since: AT })).toMatchObject({ state: 'notYet', check: { kind: 'running' } });
    expect(one(NOT_RUN)).toMatchObject({ state: 'notYet', check: { kind: 'notRun' } });
  });

  /** Only a passed check lets a migration into its cutover. */
  it('is passed for a migration in or past its cutover, with the day where the read has it', () => {
    expect(one({ state: 'passed', at: AT }, 'cutover').check).toEqual({ kind: 'passed', at: AT });
    // The appliance holds no report after a restart: still passed, with no day.
    expect(one(NOT_RUN, 'done')).toMatchObject({ state: 'done', check: { kind: 'passed' } });
    expect(one(NOT_RUN, 'done').check).not.toHaveProperty('at');
  });

  /** Hard rule 9: *nobody ran it* and *we could not ask* are different claims. */
  it('is unread, never not run, for a migration the progress read does not list, or where it failed', () => {
    const unlisted = one(undefined);
    expect(unlisted).toMatchObject({ count: undefined, state: undefined });
    expect(unlisted.check).toBeUndefined();
    const failed = byKey(cutoverSteps([{ id: 'm1', status: 'active' }], read(quiet('m1')), undefined));
    expect(failed['check']).toMatchObject({ count: undefined, state: undefined });
    expect(failed['confirmed']!.state).toBeUndefined();
  });

  it('needs no read for migrations all past their check', () => {
    const past = byKey(cutoverSteps([{ id: 'm1', status: 'done' }], read(), undefined));
    expect(past['check']).toMatchObject({ count: 1, state: 'done', check: { kind: 'passed' } });
  });

  it('says not run for several only when none of them ran, and not passed otherwise', () => {
    const two: StepsMigration[] = [
      { id: 'm1', status: 'active' },
      { id: 'm2', status: 'active' },
    ];
    const attention = read(quiet('m1'), quiet('m2'));
    const said = (rows: [string, CheckFacts][]) => byKey(cutoverSteps(two, attention, checks(...rows)))['check']!.check;
    expect(said([['m1', NOT_RUN], ['m2', NOT_RUN]])).toEqual({ kind: 'notRun' });
    expect(said([['m1', NOT_RUN], ['m2', { state: 'not_passed', at: AT }]])).toEqual({ kind: 'notPassed' });
  });
});

describe('a lifecycle that could not be read (0154 T4)', () => {
  it('leaves Finish and Sharing’s state unknown, rather than guessed', () => {
    const steps = byKey(
      cutoverSteps([{ id: 'm1', status: undefined }], read(quiet('m1', { sharingOpen: 2 })), checks(['m1', NOT_RUN])),
    );
    expect(steps['finish']).toMatchObject({ count: undefined, state: undefined });
    expect(steps['sharing']).toMatchObject({ count: 2, state: undefined });
    // The queues do not rest on it.
    expect(steps['failures']).toMatchObject({ count: 0, state: 'done' });
  });
});

describe('each migration’s check, from the progress read', () => {
  it('is keyed by migration, and nothing where the read is not in', () => {
    expect(checksOf(undefined)).toBeUndefined();
    const fromRead = checksOf({ mappings: [{ mappingId: 'm1', check: NOT_RUN }] });
    expect(fromRead?.get('m1')).toEqual(NOT_RUN);
    expect(fromRead?.get('m2')).toBeUndefined();
  });
});
