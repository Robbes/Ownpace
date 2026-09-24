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
import { pathRunsNow, pathSourceAuthority, phasesOfTheMigration } from './path-phase.ts';

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
