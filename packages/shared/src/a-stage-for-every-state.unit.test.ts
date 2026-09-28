// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A STAGE FOR EVERY STATE (workplan 0154 T1 (a)).
 *
 * `stage.ts` turns the states the server reports into the words a person
 * reads. It is a seventh list that must agree with the lifecycle
 * (`a-sixth-state-added-to-only-one-list` counts the other six). A lifecycle
 * word or a pass state added elsewhere and missing here would put a row on a
 * person's page with no word on it, and nothing would say so.
 *
 * WHAT IS ASSERTED:
 *
 * - every lifecycle word (`MAPPING_LIFECYCLES`) is a phase the table places,
 *   and has a stage;
 * - every data type's pass state (`DOMAIN_STATES`) is decided: a stage, or
 *   `skipped`'s deliberate "no row";
 * - each row of 0154 T1 (a)'s table, as the table says it;
 * - *Ready to switch* asks Finish's own decision, so a failure that blocks
 *   Finish keeps a data type at *Kept in step*;
 * - a person's stage is the least advanced, and a data type that has not
 *   started does not pull back the ones that have.
 */

import { describe, it, expect } from 'vitest';
import { MAPPING_LIFECYCLES } from './operating-contract.ts';
import { DOMAIN_STATES } from './ports.ts';
import { leastAdvancedStage, STAGE_PHASES, STAGES, stageOf, type StageFacts } from './stage.ts';

const facts = (over: Partial<StageFacts>): StageFacts => ({ phase: 'active', completedOnce: false, ...over });

describe('a stage for every state', () => {
  it('places every lifecycle word, and gives each a stage', () => {
    for (const lifecycle of MAPPING_LIFECYCLES) {
      expect(STAGE_PHASES).toContain(lifecycle);
      expect(stageOf(facts({ phase: lifecycle })), lifecycle).toBeDefined();
      expect(stageOf(facts({ phase: lifecycle, completedOnce: true })), lifecycle).toBeDefined();
    }
  });

  it('gives every phase it places a stage', () => {
    for (const phase of STAGE_PHASES) {
      expect(stageOf(facts({ phase })), phase).toBeDefined();
    }
  });

  it('decides every pass state: a stage, or no row for a data type the migration does not copy', () => {
    for (const domainState of DOMAIN_STATES) {
      const stage = stageOf(facts({ domainState }));
      if (domainState === 'skipped') expect(stage).toBeUndefined();
      else expect(stage, domainState).toBeDefined();
    }
  });

  it('shows a phase it does not know as nothing, never as a guessed stage', () => {
    expect(stageOf(facts({ phase: 'archived' }))).toBeUndefined();
  });
});

describe("0154 T1 (a)'s table", () => {
  it.each([
    ['a path that has not started', facts({ phase: 'ready' }), 'not_started'],
    ['paused, never run', facts({ phase: 'paused' }), 'not_started'],
    ['paused, waiting its turn', facts({ phase: 'paused', domainState: 'pending' }), 'not_started'],
    ['paused after a pass began', facts({ phase: 'paused', domainState: 'in_progress' }), 'paused'],
    ['paused after a pass completed', facts({ phase: 'paused', completedOnce: true }), 'paused'],
    ['running, first pass not finished', facts({ phase: 'active', domainState: 'in_progress' }), 'copying'],
    ['running, first pass failed part-way', facts({ phase: 'active', domainState: 'failed' }), 'copying'],
    ['running, a pass completed', facts({ phase: 'active', completedOnce: true }), 'kept_in_step'],
    ['running, stopped by its owner', facts({ phase: 'active', stopped: true, completedOnce: true }), 'paused'],
    ['running, switched off with copies kept', facts({ phase: 'active', domainState: 'stopped' }), 'paused'],
    ['in cutover', facts({ phase: 'cutover', completedOnce: true }), 'switching'],
    ['finished', facts({ phase: 'done', completedOnce: true }), 'done'],
    ['kept after the switch', facts({ phase: 'continuous', completedOnce: true }), 'kept_in_step'],
    ['kept after the switch, then stopped', facts({ phase: 'continuous', stopped: true }), 'paused'],
  ] as [string, StageFacts, string][])('%s', (_what, given, stage) => {
    expect(stageOf(given)).toBe(stage);
  });

  it('is ready to switch only when the check passed and nothing blocks Finish', () => {
    const kept = facts({ phase: 'active', completedOnce: true });
    expect(stageOf({ ...kept, checkPassed: true, unresolvedFailures: 0 })).toBe('ready_to_switch');
    expect(stageOf({ ...kept, checkPassed: true })).toBe('ready_to_switch');
    expect(stageOf({ ...kept, checkPassed: true, unresolvedFailures: 3 })).toBe('kept_in_step');
    expect(stageOf({ ...kept, checkPassed: false })).toBe('kept_in_step');
    expect(stageOf(kept)).toBe('kept_in_step');
  });

  it('is never ready to switch before its first pass has completed', () => {
    expect(stageOf(facts({ phase: 'active', checkPassed: true }))).toBe('copying');
  });
});

describe("a person's stage", () => {
  it('orders the stages from least to most advanced', () => {
    expect([...STAGES]).toEqual([
      'not_started',
      'paused',
      'copying',
      'kept_in_step',
      'ready_to_switch',
      'switching',
      'done',
    ]);
  });

  it('is the least advanced of the ones that started (the drawing: Anna is copying)', () => {
    expect(leastAdvancedStage(['kept_in_step', 'copying', 'kept_in_step', 'copying', 'not_started'])).toBe('copying');
  });

  it('says what holds a person back: a paused data type outranks one kept in step', () => {
    expect(leastAdvancedStage(['kept_in_step', 'paused'])).toBe('paused');
    expect(leastAdvancedStage(['done', 'switching'])).toBe('switching');
    expect(leastAdvancedStage(['done', 'kept_in_step'])).toBe('kept_in_step');
  });

  it('is not started only while nothing has started', () => {
    expect(leastAdvancedStage(['not_started', 'not_started'])).toBe('not_started');
  });

  it('has no stage when no data type has one', () => {
    expect(leastAdvancedStage([])).toBeUndefined();
    expect(leastAdvancedStage([undefined])).toBeUndefined();
  });
});
