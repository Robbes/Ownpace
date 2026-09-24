// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONE DATA TYPE'S PHASE (workplan 0128 T5, slice 1; the owner's D8, 2026-09-24).
 *
 * The rules a gate applies to one data type, and the promise slice 1 rests on:
 * while no data type has a phase of its own, asking per data type gives exactly
 * the answers the migration gave, for every status and both sides of a grace
 * period. That is what makes it safe to put these readers in first.
 */

import { describe, it, expect } from 'vitest';
import { DISCOVERY_DOMAINS } from './discovery.ts';
import { runsPassesNow, sourceAuthorityFor } from './lifecycle.ts';
import {
  pathRunsNow,
  pathSourceAuthority,
  phasesOfTheMigration,
  phasesOfThePaths,
  rollUpPhases,
} from './path-phase.ts';

const STATUSES = ['active', 'paused', 'cutover', 'done', 'continuous'] as const;

describe("one data type's phase", () => {
  it('runs in `active` and `continuous`, and in `cutover` only while its grace period is open', () => {
    expect(pathRunsNow({ phase: 'active', stillCopies: false })).toBe(true);
    expect(pathRunsNow({ phase: 'continuous', stillCopies: false })).toBe(true);
    expect(pathRunsNow({ phase: 'cutover', stillCopies: true })).toBe(true);
    expect(pathRunsNow({ phase: 'cutover', stillCopies: false })).toBe(false);
    expect(pathRunsNow({ phase: 'paused', stillCopies: true })).toBe(false);
    expect(pathRunsNow({ phase: 'done', stillCopies: true })).toBe(false);
  });

  it('keeps its source the authority on what exists before its cutover, and never after', () => {
    expect(pathSourceAuthority({ phase: 'active', stillCopies: false }).sourceIsAuthorityOnExistence).toBe(true);
    expect(pathSourceAuthority({ phase: 'paused', stillCopies: false }).sourceIsAuthorityOnExistence).toBe(true);
    for (const phase of ['cutover', 'done', 'continuous']) {
      expect(pathSourceAuthority({ phase, stillCopies: true }).sourceIsAuthorityOnExistence).toBe(false);
    }
  });
});

describe("while no data type has a phase of its own, it is the migration's", () => {
  it('for every data type alike', () => {
    const phaseOf = phasesOfTheMigration('continuous');
    for (const domain of DISCOVERY_DOMAINS) {
      expect(phaseOf(domain)).toEqual({ phase: 'continuous', stillCopies: false });
    }
  });

  it('with a grace period kept for a cutover only', () => {
    expect(phasesOfTheMigration('cutover', true)('email')).toEqual({ phase: 'cutover', stillCopies: true });
    expect(phasesOfTheMigration('active', true)('email')).toEqual({ phase: 'active', stillCopies: false });
    expect(phasesOfTheMigration('cutover')('email')).toEqual({ phase: 'cutover', stillCopies: false });
  });

  it('so every gate asking per data type gives the answer the migration gave', () => {
    for (const status of STATUSES) {
      for (const stillCopies of [true, false]) {
        const phaseOf = phasesOfTheMigration(status, stillCopies);
        for (const domain of DISCOVERY_DOMAINS) {
          expect(pathRunsNow(phaseOf(domain)), `${status}, ${stillCopies}, ${domain}`).toBe(
            runsPassesNow(status, stillCopies),
          );
          expect(pathSourceAuthority(phaseOf(domain))).toEqual(sourceAuthorityFor(status));
        }
      }
    }
  });
});

describe("the migration's status its paths add up to (slice 2b)", () => {
  it('is each status itself when every path is in it, and nothing for no paths', () => {
    for (const status of STATUSES) expect(rollUpPhases([status, status])).toBe(status);
    expect(rollUpPhases([])).toBeUndefined();
    // A `ready` row is a path that never moved: before its cutover, and held.
    expect(rollUpPhases(['ready'])).toBe('paused');
  });

  it('is before the cutover while any path is: active when one runs, paused when all are held', () => {
    expect(rollUpPhases(['active', 'cutover'])).toBe('active');
    expect(rollUpPhases(['paused', 'cutover', 'continuous'])).toBe('paused');
    expect(rollUpPhases(['paused', 'active'])).toBe('active');
    expect(rollUpPhases(['ready', 'active'])).toBe('active');
    expect(rollUpPhases(['ready', 'done'])).toBe('paused');
  });

  it('is cutover while one path is in it and none is before it, then continuous, then done', () => {
    expect(rollUpPhases(['cutover', 'done'])).toBe('cutover');
    expect(rollUpPhases(['cutover', 'continuous'])).toBe('cutover');
    expect(rollUpPhases(['continuous', 'done'])).toBe('continuous');
    expect(rollUpPhases(['done', 'done'])).toBe('done');
  });
});

describe('each data type from its own row, where the rows agree with the migration', () => {
  it('reads each row, and the migration for a data type with none', () => {
    const phaseOf = phasesOfThePaths('active', true, { email: 'cutover', file: 'active' });
    expect(phaseOf('email')).toEqual({ phase: 'cutover', stillCopies: true });
    expect(phaseOf('file')).toEqual({ phase: 'active', stillCopies: false });
    expect(phaseOf('calendar')).toEqual({ phase: 'active', stillCopies: false });
  });

  it('believes the status over rows it does not add up to, as after a status set by hand', () => {
    // Finished, then set back to `active` by hand to resume: the rows still say `done`.
    const phaseOf = phasesOfThePaths('active', false, { email: 'done', file: 'done' });
    for (const domain of DISCOVERY_DOMAINS) expect(phaseOf(domain)).toEqual({ phase: 'active', stillCopies: false });
    // Set to `cutover` by hand over running rows: every data type is past its cutover.
    const cutOver = phasesOfThePaths('cutover', true, { email: 'active' });
    expect(pathSourceAuthority(cutOver('email')).sourceIsAuthorityOnExistence).toBe(false);
  });

  it("is the migration's own answer with no rows at all", () => {
    for (const status of STATUSES) {
      for (const domain of DISCOVERY_DOMAINS) {
        expect(phasesOfThePaths(status, true, {})(domain)).toEqual(phasesOfTheMigration(status, true)(domain));
      }
    }
  });
});
