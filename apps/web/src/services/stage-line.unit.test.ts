// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * ONE LINE PER DATA TYPE (workplan 0154 T1 (b) and (d)): its own stage, and the
 * sentence under it. Each case is a row of `stage-line.ts`'s table.
 */
import { describe, it, expect } from 'vitest';
import type { CheckFacts, DomainProgress, MappingAttention } from '@openmig/shared';
import { fitLine, lineParts, lineStage, linesProgressOf, type LineFacts } from './stage-line.ts';

const GB = 1024 ** 3;
const NOT_RUN: CheckFacts = { state: 'not_run' };
const PASSED: CheckFacts = { state: 'passed', at: '2026-10-02T09:05:00.000Z' };

const row = (over: Partial<DomainProgress> = {}): DomainProgress => ({
  domain: 'email',
  state: 'completed',
  phase: 'active',
  itemsSynced: 18_234,
  itemsFound: 19_000,
  bytesTransferred: 3.1 * GB,
  bytesFound: 3.4 * GB,
  lastSyncedAt: '2026-10-03T10:00:00.000Z',
  ...over,
});

const facts = (over: Partial<LineFacts> = {}): LineFacts => ({
  row: row(),
  migrationStatus: 'active',
  check: NOT_RUN,
  failuresWaiting: 0,
  ...over,
});

describe('each data type’s own stage', () => {
  it('is kept in step once a first pass completed', () => {
    expect(lineStage(facts())).toBe('kept_in_step');
  });

  it('is copying until then', () => {
    expect(lineStage(facts({ row: row({ state: 'in_progress', lastSyncedAt: undefined }) }))).toBe('copying');
  });

  it('is paused when its owner stopped it, whatever the migration does', () => {
    expect(lineStage(facts({ row: row({ stopped: true }) }))).toBe('paused');
  });

  it('is its own phase, not the migration’s', () => {
    expect(lineStage(facts({ row: row({ phase: 'cutover' }) }))).toBe('switching');
    expect(lineStage(facts({ row: row({ phase: 'done' }) }))).toBe('done');
  });

  it('is not started with no pass on it, in a migration not started', () => {
    expect(lineStage(facts({ row: undefined, migrationStatus: 'paused' }))).toBe('not_started');
  });

  it('is ready to switch when the check passed and nothing blocks Finish', () => {
    expect(lineStage(facts({ check: PASSED }))).toBe('ready_to_switch');
  });

  /** Hard rule 9: a count that could not be read never opens the way. */
  it('is not ready to switch while the failures that block Finish could not be counted, or wait', () => {
    expect(lineStage(facts({ check: PASSED, failuresWaiting: undefined }))).toBe('kept_in_step');
    expect(lineStage(facts({ check: PASSED, failuresWaiting: 2 }))).toBe('kept_in_step');
  });

  it('is not ready to switch on a check that did not pass, or never finished', () => {
    for (const check of [
      { state: 'not_passed', at: '2026-10-02T09:05:00.000Z' },
      { state: 'running', since: '2026-10-03T09:00:00.000Z' },
      { state: 'could_not_run', at: '2026-10-03T09:00:00.000Z' },
    ] as const) {
      expect(lineStage(facts({ check })), check.state).toBe('kept_in_step');
    }
  });
});

describe('the sentence under it', () => {
  it('kept in step: how far, and the last pass', () => {
    expect(lineParts('kept_in_step', facts(), 'en')).toEqual([
      { kind: 'ofAbout', done: 18_234, total: 19_000 },
      { kind: 'lastPass', at: '2026-10-03T10:00:00.000Z' },
    ]);
  });

  it('copying: how far', () => {
    const copying = facts({ row: row({ state: 'in_progress', itemsSynced: 1_204, itemsFound: 2_000, lastSyncedAt: undefined }) });
    expect(lineParts('copying', copying, 'en')).toEqual([{ kind: 'ofAbout', done: 1_204, total: 2_000 }]);
  });

  it('ready to switch: when the check passed', () => {
    expect(lineParts('ready_to_switch', facts({ check: PASSED }), 'en')).toEqual([
      { kind: 'checkPassed', at: '2026-10-02T09:05:00.000Z' },
    ]);
  });

  it('files: their bytes, in the reader’s digits, when both sides were measured', () => {
    const files = facts({ row: row({ domain: 'file', bytesTransferred: 12.4 * GB, bytesFound: 38 * GB }) });
    expect(lineParts('copying', files, 'nl')).toEqual([{ kind: 'bytesOfAbout', done: '12,4', total: '38,0 GB' }]);
    // And their count where the bytes were not measured.
    const unmeasured = facts({ row: row({ domain: 'file', bytesFound: undefined }) });
    expect(lineParts('copying', unmeasured, 'en')).toEqual([{ kind: 'ofAbout', done: 18_234, total: 19_000 }]);
  });

  it('says the total is not known where discovery found none, and none found for a counted zero', () => {
    expect(lineParts('copying', facts({ row: row({ itemsFound: undefined }) }), 'en')).toEqual([
      { kind: 'totalNotKnown', done: 18_234 },
    ]);
    expect(lineParts('done', facts({ row: row({ itemsSynced: 0, itemsFound: 0 }) }), 'en')).toEqual([
      { kind: 'noneFound' },
    ]);
  });

  it('not started: nothing, the stage says it', () => {
    expect(lineParts('not_started', facts({ row: undefined }), 'en')).toEqual([]);
  });

  it('says what was left as it was, before the last pass, which the budget drops first', () => {
    const contacts = facts({ row: row({ domain: 'contact', itemsSynced: 210, itemsAdopted: 402, itemsFound: 612 }) });
    expect(lineParts('kept_in_step', contacts, 'en')).toEqual([
      { kind: 'ofAbout', done: 210, total: 612 },
      { kind: 'leftAsIs', count: 402 },
      { kind: 'lastPass', at: '2026-10-03T10:00:00.000Z' },
    ]);
    expect(fitLine(['210 of ~612', '402 left as they are', 'last pass 10 minutes ago'])).toEqual([
      '210 of ~612',
      '402 left as they are',
    ]);
    // A counted zero is not worth a part.
    expect(lineParts('copying', facts({ row: row({ itemsAdopted: 0 }) }), 'en').map((p) => p.kind)).toEqual(['ofAbout']);
  });

  it('paused: how far, and the last pass', () => {
    expect(lineParts('paused', facts({ row: row({ stopped: true }) }), 'en').map((p) => p.kind)).toEqual([
      'ofAbout',
      'lastPass',
    ]);
  });
});

describe('within 0118’s budget of twelve words', () => {
  it('drops parts from the least important end', () => {
    expect(fitLine(['18,234 of ~19,000', 'about 3 to 5 hours left', 'last pass 2 minutes ago'])).toEqual([
      '18,234 of ~19,000',
      'about 3 to 5 hours left',
    ]);
  });

  it('keeps a line that fits, and never drops the first part', () => {
    expect(fitLine(['18,234 of ~19,000', 'last pass 2 minutes ago'])).toEqual([
      '18,234 of ~19,000',
      'last pass 2 minutes ago',
    ]);
    const long = 'one two three four five six seven eight nine ten eleven twelve thirteen';
    expect(fitLine([long, 'last pass now'])).toEqual([long]);
  });
});

describe('a migration’s lines’ facts, from the two reads', () => {
  const report = { mappings: [{ mappingId: 'm', domains: [row()], check: PASSED }] };
  const attention = (over: Partial<MappingAttention> = {}) =>
    ({ mappingId: 'm', failuresWaiting: 1, ...over }) as MappingAttention;

  it('joins the progress with the failures that block Finish', () => {
    expect(linesProgressOf(report, 'm', attention(), true)).toEqual({ report: report.mappings[0], failuresWaiting: 1 });
    // A migration the attention read has no row for has none waiting.
    expect(linesProgressOf(report, 'm', undefined, true)?.failuresWaiting).toBe(0);
  });

  it('counts none it could not read: a failed read, or one with a blind spot', () => {
    expect(linesProgressOf(report, 'm', attention(), false)?.failuresWaiting).toBeUndefined();
    expect(linesProgressOf(report, 'm', attention({ blindSpots: ['failures'] }), true)?.failuresWaiting).toBeUndefined();
  });

  it('is nothing while the progress read has no row for the migration', () => {
    expect(linesProgressOf(undefined, 'm', attention(), true)).toBeUndefined();
    expect(linesProgressOf(report, 'other', attention(), true)).toBeUndefined();
  });
});
