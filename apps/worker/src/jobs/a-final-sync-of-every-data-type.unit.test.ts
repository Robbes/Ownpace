// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FINAL SYNC OF EVERY DATA TYPE (workplan 0128 T1; the owner, 2026-09-23:
 * "Cutover final sync: yes, I acknowledge your advice").
 *
 * The cutover's final sync was the mail reconcile alone, and its gate built the
 * mail source and target before measuring anything. So a migration of
 * calendars, contacts and files went into its cutover with those unsynced since
 * the last scheduled pass, and a migration without mail could not be prepared
 * at all. What these hold:
 *
 *  - the final sync is `run-delta-sync`, triggered and waited for on the
 *    migration's own queue, and it reports a count per data type;
 *  - a data type it did not finish (its deadline, the day's download budget,
 *    or never reached) is named, and the cutover is not ready: the gate is not
 *    even asked, and the verdict is recorded once, never retried;
 *  - the gate verifies the data types the migration has, and no others, in
 *    both doors, without building mail it never used.
 *
 * The task bodies are read as text where no runtime can reach them (a
 * Trigger.dev run waiting on another), as `a-domain-the-dispatchers-forgot`
 * reads the dispatchers. The gate itself, against a real ledger, is in
 * `a-cutover-without-mail.integration.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VerificationResult } from '@openmig/core';
import { finalSyncReport } from './final-sync.ts';
import { verificationConfigFor } from './cutover-gate.ts';
import {
  CutoverGateFailed,
  FinalSyncNotFinished,
  prepareCutover,
  preparationFailurePolicy,
} from './run-cutover.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const TENANT = '0e128000-e29b-41d4-a716-446655440001';
const MAPPING = '0e128000-e29b-41d4-a716-446655440002';

const counts = (created: number, updated: number, skipped: number) => ({ created, updated, adopted: 0, skipped });

/** A cutover ledger in memory: the four calls the preparation makes. */
function memoryLedger() {
  let state: string | undefined;
  const events: { toState: string }[] = [];
  const store = {
    initializeCutover: async () => {
      state = 'PREPARING';
      events.push({ toState: state });
      return { state, currentState: state };
    },
    loadCutoverState: async () => (state ? { state, currentState: state } : null),
    transitionState: async (_t: unknown, _m: unknown, to: string) => {
      state = to;
      events.push({ toState: to });
      return { state: to, currentState: to };
    },
    getEventHistory: async () => events,
  };
  return { store, state: () => state };
}

const PASSING = {
  overallStatus: 'PASS',
  canProceedToCutover: true,
  score: 1,
  totalItemsSource: 3,
  totalItemsTarget: 3,
  totalDiscrepancies: 0,
  recommendations: [],
} as unknown as VerificationResult;

function prepare(runFinalSync: Parameters<typeof prepareCutover>[0]['runFinalSync'], runGate = vi.fn(async () => PASSING)) {
  const ledger = memoryLedger();
  const logs: string[] = [];
  const done = prepareCutover({
    tenantId: TENANT,
    mappingId: MAPPING,
    cutoverStore: ledger.store as unknown as Parameters<typeof prepareCutover>[0]['cutoverStore'],
    log: (line) => logs.push(line),
    runFinalSync,
    runGate,
  });
  return { done, logs, runGate, state: ledger.state };
}

/** Comments are prose about code, not code (see `a-domain-the-dispatchers-forgot`). */
function code(file: string): string {
  return readFileSync(join(HERE, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

describe("the pass's own report, read for the cutover", () => {
  const complete = finalSyncReport({
    asked: ['calendar', 'contact', 'file'],
    domains: { calendar: counts(2, 1, 40), contact: counts(0, 3, 900), file: counts(5, 0, 120) },
  });

  it('counts each data type, and adds them up', () => {
    expect(complete.byDomain).toEqual({
      calendar: counts(2, 1, 40),
      contact: counts(0, 3, 900),
      file: counts(5, 0, 120),
    });
    expect(complete.total).toEqual({ created: 7, updated: 4, adopted: 0, skipped: 1060 });
    expect(complete.notFinished).toEqual([]);
  });

  it('names a data type that stopped at its deadline or at the download budget', () => {
    const report = finalSyncReport({
      asked: ['email', 'file'],
      domains: { email: { ...counts(9, 0, 0), stopped: 'budget' }, file: { ...counts(1, 0, 3), stopped: 'deadline' } },
    });

    expect(report.notFinished).toEqual([
      "email stopped at the day's download budget",
      "file stopped at the pass's own deadline",
    ]);
    // What it did copy still counts.
    expect(report.total.created).toBe(10);
  });

  it('names every data type the pass never reached, because the migration stopped running', () => {
    const report = finalSyncReport({
      asked: ['calendar', 'contact', 'file'],
      domains: { calendar: counts(0, 0, 40) },
      stoppedBefore: 'contact',
    });

    expect(report.notFinished).toEqual([
      'contact was not reached, because the migration was paused or finished while the pass ran',
      'file was not reached, because the migration was paused or finished while the pass ran',
    ]);
  });

  it('names a data type it was asked for and said nothing about', () => {
    const report = finalSyncReport({ asked: ['task'], domains: {} });

    expect(report.notFinished).toEqual(['task reported nothing']);
  });
});

describe('the preparation, with the final sync reporting per data type', () => {
  it('logs a count per data type and goes on to the gate', async () => {
    const { done, logs, runGate, state } = prepare(async () =>
      finalSyncReport({
        asked: ['calendar', 'contact', 'file'],
        domains: { calendar: counts(2, 1, 40), contact: counts(0, 3, 900), file: counts(5, 0, 120) },
      }),
    );

    const result = await done;

    expect(result.ready).toBe(true);
    expect(state()).toBe('READY_FOR_CUTOVER');
    expect(runGate).toHaveBeenCalledOnce();
    expect(result.finalSync).toEqual({ created: 7, updated: 4, adopted: 0, skipped: 1060 });
    expect(Object.keys(result.finalSyncByDomain ?? {})).toEqual(['calendar', 'contact', 'file']);
    expect(logs).toContain(
      'Final sync: calendar: 2 created, 1 updated, 40 skipped; contact: 0 created, 3 updated, 900 skipped; ' +
        'file: 5 created, 0 updated, 120 skipped',
    );
  });

  it('is not ready when the final sync left a data type unfinished, and does not ask the gate', async () => {
    const { done, runGate, state } = prepare(async () =>
      finalSyncReport({
        asked: ['calendar', 'file'],
        domains: { calendar: counts(0, 0, 40), file: { ...counts(1, 0, 3), stopped: 'deadline' } },
      }),
    );

    const failure = await done.catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(FinalSyncNotFinished);
    expect(String((failure as Error).message)).toContain("file stopped at the pass's own deadline");
    expect(runGate).not.toHaveBeenCalled();
    expect(state()).toBe('PREPARING');
  });

  it('records that verdict once and does not retry it, as it does a failed gate', () => {
    expect(new FinalSyncNotFinished('behind')).toBeInstanceOf(CutoverGateFailed);
    expect(preparationFailurePolicy(new FinalSyncNotFinished('behind'))).toEqual({ recordFailed: true, retry: false });
  });

  it('says so when the migration has no data type selected, rather than printing nothing', async () => {
    const { done, logs } = prepare(async () => finalSyncReport({ asked: [], domains: {} }));

    await done;

    expect(logs).toContain('Final sync: no data type is selected for this migration');
  });
});

describe('the gate verifies the data types the migration has', () => {
  it('a migration of calendars, contacts and files is not asked about mail or tasks', () => {
    const config = verificationConfigFor(new Set(['calendar', 'contact', 'file']));

    expect(config).toMatchObject({
      verifyMail: false,
      verifyCalendar: true,
      verifyContacts: true,
      verifyFiles: true,
      verifyTasks: false,
    });
  });

  it('a mail-only migration is asked about mail alone', () => {
    expect(verificationConfigFor(new Set(['email']))).toMatchObject({
      verifyMail: true,
      verifyCalendar: false,
      verifyContacts: false,
      verifyFiles: false,
      verifyTasks: false,
    });
  });

  it('asks as much of the data as it did before: the same sample and the same thresholds', () => {
    expect(verificationConfigFor(new Set(['task']))).toMatchObject({
      verifyTasks: true,
      checksumSamplePercentage: 5,
      minSampleSize: 10,
      maxSampleSize: 1000,
      requiredMatchPercentage: 0.99,
      maxDiscrepancyPercentage: 0.01,
    });
  });
});

describe('the doors, read as text', () => {
  it('the preparation runs no mail reconcile of its own and builds no mail it does not use', () => {
    const cutover = code('run-cutover.ts');

    expect(cutover).not.toContain('runShadowPass');
    expect(cutover).not.toContain('buildDepsFromMapping');
    expect(cutover).toContain('runCutoverGate(pool, dbUrl, tenantId, mappingId)');
  });

  it("the final sync is run-delta-sync, waited for on the migration's own queue", () => {
    const cutover = code('run-cutover.ts');

    expect(cutover).toMatch(/runDeltaSync\.triggerAndWait\(\s*\{ tenantId, mappingId \}/);
    expect(cutover).toMatch(/concurrencyKey: mappingId/);
    expect(cutover).toContain('return finalSyncReport(pass.output);');
  });

  it('a pass that failed after its own retries is a verdict, not retried three times more', () => {
    const cutover = code('run-cutover.ts');
    const failed = cutover.slice(cutover.indexOf('if (!pass.ok) {'), cutover.indexOf('return finalSyncReport(pass.output);'));

    expect(failed).toContain('throw new FinalSyncNotFinished(');
    expect(failed).not.toContain('throw new Error(');
  });

  it("the operator's verify runs the same gate", () => {
    expect(code('../cli/index.ts')).toContain(
      'runDataVerification: () => runCutoverGate(pool, dbUrl, tenantId, mappingId)',
    );
  });

  it('the pass reports each data type, how it stopped, and where it stopped early', () => {
    const pass = code('run-delta-sync.ts');

    expect(pass).toMatch(/outcomes\[domain\] = \{/);
    // Each stop under its own name: the deadline is not the budget.
    expect(pass).toMatch(/result\.deadlinePause \? \{ stopped: 'deadline' as const \}/);
    expect(pass).toMatch(/result\.budgetPause \? \{ stopped: 'budget' as const \}/);
    expect(pass).toMatch(/stoppedBefore = domain;\s*break;/);
    expect(pass).toMatch(/asked: domains,\s*domains: outcomes,/);
    expect(pass).toMatch(/runId,\s*\.\.\.report,/);
  });
});
