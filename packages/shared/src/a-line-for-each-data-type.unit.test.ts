// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * ONE SHAPE FOR A PERSON'S LINES, ON BOTH EDITIONS (workplan 0154 T1 (b)).
 *
 * Managed serves a migration's progress from `GET /api/migrations/progress`;
 * the appliance has no list, and its `/status` carries the same facts.
 * `progressFromStatus` reads them there, and `checkFactsOf` reads either
 * edition's verification run into the five things a person can be told about
 * a check. These hold that the two readings agree, and that a check nobody ran
 * never reads as one that passed or failed (hard rule 9).
 */
import { describe, it, expect } from 'vitest';
import { checkFactsOf, domainProgressOf, progressFromStatus } from './progress.ts';
import type { DomainStatusReport, StatusReport, VerificationRunReport, VerifyResponse } from './operating-contract.ts';

const row = (over: Partial<DomainStatusReport> = {}): DomainStatusReport => ({
  domain: 'email',
  state: 'completed',
  itemsSynced: 18_234,
  itemsFailed: 0,
  bytesTransferred: 3_330_000_000,
  itemsRetrying: 2,
  itemsNeedingDecision: 1,
  itemsFound: 19_000,
  bytesFound: 3_650_000_000,
  lastSyncedAt: '2026-10-03T10:00:00.000Z',
  ...over,
});

const done = (mappingId: string, canProceedToCutover: boolean): VerificationRunReport => ({
  state: 'done',
  startedAt: '2026-10-02T09:00:00.000Z',
  finishedAt: '2026-10-02T09:05:00.000Z',
  report: { [mappingId]: { canProceedToCutover } } as unknown as VerifyResponse,
});

describe('a data type’s line facts', () => {
  it('keeps what the line reads, and none of the queue counts it does not', () => {
    const line = domainProgressOf(row({ itemsAdopted: 4 }), { phase: 'active' });
    expect(line).toEqual({
      domain: 'email',
      state: 'completed',
      phase: 'active',
      itemsSynced: 18_234,
      itemsFound: 19_000,
      itemsAdopted: 4,
      bytesTransferred: 3_330_000_000,
      bytesFound: 3_650_000_000,
      lastSyncedAt: '2026-10-03T10:00:00.000Z',
    });
  });

  it('says a stop from either reading, and nothing when it runs', () => {
    expect(domainProgressOf(row(), { phase: 'active', stopped: true }).stopped).toBe(true);
    expect(domainProgressOf(row({ stoppedByOwner: true }), { phase: 'active' }).stopped).toBe(true);
    expect('stopped' in domainProgressOf(row(), { phase: 'active', stopped: false })).toBe(false);
  });

  it('leaves out what nobody counted, rather than saying 0', () => {
    const line = domainProgressOf(row({ itemsFound: undefined, bytesFound: undefined }), { phase: 'active' });
    expect('itemsFound' in line).toBe(false);
    expect('bytesFound' in line).toBe(false);
    expect('itemsAdopted' in line).toBe(false);
  });
});

describe('the check, as a person is told it', () => {
  it('passed, when the report says the migration can go to its cutover', () => {
    expect(checkFactsOf(done('m', true), 'm')).toEqual({ state: 'passed', at: '2026-10-02T09:05:00.000Z' });
  });

  it('not passed, when it ran and does not', () => {
    expect(checkFactsOf(done('m', false), 'm')).toEqual({ state: 'not_passed', at: '2026-10-02T09:05:00.000Z' });
  });

  /** Hard rule 9: none of these is a pass or a failure. */
  it('not run, running, and could not run, each said as itself', () => {
    expect(checkFactsOf({ state: 'never-run' }, 'm')).toEqual({ state: 'not_run' });
    expect(checkFactsOf({ state: 'running', startedAt: '2026-10-03T09:00:00.000Z' }, 'm')).toEqual({
      state: 'running',
      since: '2026-10-03T09:00:00.000Z',
    });
    expect(
      checkFactsOf({ state: 'failed', startedAt: '2026-10-03T09:00:00.000Z', error: 'ECONNRESET' }, 'm'),
    ).toEqual({ state: 'could_not_run', at: '2026-10-03T09:00:00.000Z' });
  });

  it('not run, for a migration a finished report does not cover', () => {
    expect(checkFactsOf(done('other', true), 'm')).toEqual({ state: 'not_run' });
  });
});

describe('the appliance’s lines, from its /status', () => {
  const status: StatusReport = {
    status: 'ok',
    mappings: [
      {
        mappingId: 'mail',
        migrationStatus: 'active',
        domains: [row(), row({ domain: 'calendar', stoppedByOwner: true })],
        stops: [
          { domain: 'email', stopped: false, offer: 'stop' },
          { domain: 'calendar', stopped: true, offer: 'resume' },
        ],
        endings: [
          { domain: 'email', phase: 'cutover', stopped: false, offers: ['end'] },
          { domain: 'calendar', phase: 'active', stopped: true, offers: [] },
        ],
      },
      { mappingId: 'draft', migrationStatus: 'paused', domains: [] },
    ],
  } as unknown as StatusReport;

  it('gives each data type its own phase and stop, and the migration’s where it has neither', () => {
    const [mail, draft] = progressFromStatus(status, done('mail', true));
    expect(mail?.domains.map((d) => [d.domain, d.phase, d.stopped ?? false])).toEqual([
      ['email', 'cutover', false],
      ['calendar', 'active', true],
    ]);
    expect(mail?.check).toEqual({ state: 'passed', at: '2026-10-02T09:05:00.000Z' });
    expect(draft).toEqual({ mappingId: 'draft', domains: [], check: { state: 'not_run' } });
  });

  it('reads a data type with no choices by the migration’s lifecycle', () => {
    const bare = { ...status, mappings: [{ ...status.mappings[0]!, stops: undefined, endings: undefined }] } as StatusReport;
    expect(progressFromStatus(bare)[0]?.domains.map((d) => d.phase)).toEqual(['active', 'active']);
  });

  it('says the check was not run when the appliance holds no report, as after a restart', () => {
    expect(progressFromStatus(status)[0]?.check).toEqual({ state: 'not_run' });
  });
});
