// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PASS THAT MOVES PAST A DATA TYPE (workplan 0128 T5, slice 1; the owner's
 * D8, 2026-09-24: *"keeps files running, while email cutover/stops"*).
 *
 * Before each data type the managed pass asks what to do: stop, when the
 * migration itself no longer runs or its grant was taken back; move on past
 * this data type, when the migration runs and this data type does not; run it
 * otherwise. The decision is pure (`stepFrom`), so it is asked here of phases
 * that differ per data type, which no writer can produce yet. And the pass
 * itself is read for the one thing the decision is worth: that it moves on
 * rather than stopping.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MigrationPhases } from '@openmig/ledger';
import { runsPassesNow, type PathPhase } from '@openmig/shared';
import { haltFrom, stepFrom } from './stopping-a-pass.ts';

/**
 * A migration in `status`, whose data types are in the phases given, and in its
 * own otherwise. Whether any of them runs is the migration's own answer, as
 * the reader gives it for rows that do not say otherwise; `anyRuns` overrides.
 */
function migration(
  status: string,
  paths: Partial<Record<string, PathPhase>> = {},
  grantWithdrawnAt: Date | null = null,
  { stillCopies = false, anyRuns }: { stillCopies?: boolean; anyRuns?: boolean } = {},
): MigrationPhases {
  const own: PathPhase = { phase: status, stillCopies: status === 'cutover' && stillCopies };
  return {
    status,
    stillCopies,
    grantWithdrawnAt,
    phaseOf: (d) => paths[d] ?? own,
    anyRuns: anyRuns ?? runsPassesNow(status, stillCopies),
  };
}

describe('what a pass does before a data type', () => {
  it('stops when the migration is gone, no longer runs, or its grant was taken back', () => {
    expect(stepFrom(null, 'file')).toEqual({ halt: 'no_longer_runs' });
    expect(stepFrom(migration('paused'), 'file')).toEqual({ halt: 'no_longer_runs' });
    expect(stepFrom(migration('done'), 'file')).toEqual({ halt: 'no_longer_runs' });
    expect(stepFrom(migration('active', {}, new Date()), 'file')).toEqual({ halt: 'grant_withdrawn' });
  });

  it('moves on past a data type that no longer runs, while the migration does', () => {
    // Mail cut over and past its grace period; files still running.
    const mailCutOver = migration('active', { email: { phase: 'cutover', stillCopies: false } });
    expect(stepFrom(mailCutOver, 'email')).toEqual({ skip: 'data_type_no_longer_runs' });
    expect(stepFrom(mailCutOver, 'file')).toEqual({ run: true });
    // And in its grace period, mail still runs.
    const inGrace = migration('active', { email: { phase: 'cutover', stillCopies: true } });
    expect(stepFrom(inGrace, 'email')).toEqual({ run: true });
  });

  it("stops rather than moving on when the migration's own answer is no, whatever one data type says", () => {
    const paused = migration('paused', { file: { phase: 'active', stillCopies: false } });
    expect(stepFrom(paused, 'file')).toEqual({ halt: 'no_longer_runs' });
  });

  it("asks the migration's answer the way the pass always did", () => {
    expect(haltFrom(migration('active'))).toBeNull();
    expect(haltFrom(migration('continuous'))).toBeNull();
    expect(haltFrom(migration('cutover', {}, null, { stillCopies: true }))).toBeNull();
    expect(haltFrom(migration('cutover'))).toBe('no_longer_runs');
  });

  it('goes on while any data type runs, though the migration past its grace period does not (slice 2b)', () => {
    // Mail past its cutover's grace period, files kept in the lane: the rows say files run.
    const filesKept = migration(
      'cutover',
      { email: { phase: 'cutover', stillCopies: false }, file: { phase: 'continuous', stillCopies: false } },
      null,
      { anyRuns: true },
    );
    expect(haltFrom(filesKept)).toBeNull();
    expect(stepFrom(filesKept, 'email')).toEqual({ skip: 'data_type_no_longer_runs' });
    expect(stepFrom(filesKept, 'file')).toEqual({ run: true });
  });
});

describe('the pass', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'run-delta-sync.ts'), 'utf8');
  const loop = src.slice(src.indexOf('for (const domain of domains) {'));

  it('asks before every data type, and moves on past one that no longer runs', () => {
    expect(loop).toContain('await passStepBefore(pool, tenantId, mappingId, domain)');
    const skip = loop.slice(loop.indexOf("if ('skip' in step) {"), loop.indexOf("if ('halt' in step) {"));
    expect(skip, 'the pass no longer moves on past a data type that does not run').toMatch(/\bcontinue;/);
    expect(skip).not.toMatch(/\bbreak;/);
  });

  it('stops for good when the migration itself says so', () => {
    const halt = loop.slice(loop.indexOf("if ('halt' in step) {"));
    expect(halt.slice(0, halt.indexOf("log.info(`Running delta sync"))).toMatch(/\bbreak;/);
  });
});
