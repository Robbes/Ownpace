// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A PROGRESS LINK SAYS WHERE EACH DATA TYPE IS, AND HOW LONG (workplan 0154 T8).
 *
 * The person's own page reads the stage the owner's line reads, worked out on
 * the server from the same facts (`viewStageOf`), and the time the owner's
 * migration page says, by the same rules (`viewTimeOf`): before any pass has
 * completed, from the count; once one has, while it copies, from the passes.
 * Nothing where nothing is being waited for.
 */
import { describe, it, expect } from 'vitest';
import { viewStageOf, viewTimeOf } from './migration-view.ts';
import type { DomainStatusReport } from './operating-contract.ts';
import type { DiscoveryRecord } from './discovery.ts';
import type { PassFacts } from './time-while-copying.ts';

const GB = 1_000_000_000;

const row = (over: Partial<DomainStatusReport> = {}): DomainStatusReport => ({
  domain: 'email',
  state: 'completed',
  itemsSynced: 0,
  itemsFailed: 0,
  bytesTransferred: 0,
  itemsRetrying: 0,
  itemsNeedingDecision: 0,
  ...over,
});

const found = (domain: DiscoveryRecord['domain'], items: number, bytes?: number): DiscoveryRecord => ({
  domain,
  collections: 1,
  items,
  ...(bytes !== undefined ? { bytes } : {}),
  discoveredAt: '2026-10-01T08:00:00.000Z',
});

const passed = { state: 'passed', at: '2026-10-02T09:00:00.000Z' } as const;
const notRun = { state: 'not_run' } as const;
const done = '2026-10-02T08:00:00.000Z';

describe('the stage on a progress link, from the facts the owner’s line reads', () => {
  it('says copying until a pass over it completes, then kept in step', () => {
    expect(viewStageOf(row({ state: 'in_progress' }), { phase: 'active' }, notRun, 0)).toBe('copying');
    expect(viewStageOf(row({ lastSyncedAt: done }), { phase: 'active' }, notRun, 0)).toBe('kept_in_step');
  });

  it('says ready to switch only when the check passed and nothing blocks Finish', () => {
    expect(viewStageOf(row({ lastSyncedAt: done }), { phase: 'active' }, passed, 0)).toBe('ready_to_switch');
    // A failure waiting on a decision blocks Finish, as on the owner's page.
    expect(viewStageOf(row({ lastSyncedAt: done }), { phase: 'active' }, passed, 2)).toBe('kept_in_step');
  });

  it('reads each data type’s own phase: switching, done, not started', () => {
    expect(viewStageOf(row({ lastSyncedAt: done }), { phase: 'cutover' }, passed, 0)).toBe('switching');
    expect(viewStageOf(row({ lastSyncedAt: done }), { phase: 'done' }, passed, 0)).toBe('done');
    expect(viewStageOf(row({ state: 'pending' }), { phase: 'ready' }, notRun, 0)).toBe('not_started');
  });

  it('says paused for a data type held back, by its path’s stop or the owner’s', () => {
    expect(viewStageOf(row({ lastSyncedAt: done }), { phase: 'active', stopped: true }, notRun, 0)).toBe('paused');
    expect(viewStageOf(row({ lastSyncedAt: done, stoppedByOwner: true }), { phase: 'active' }, notRun, 0)).toBe(
      'paused',
    );
  });

  it('says no stage for a data type the migration does not carry, or a phase it cannot place', () => {
    expect(viewStageOf(row({ state: 'skipped' }), { phase: 'active' }, notRun, 0)).toBeUndefined();
    expect(viewStageOf(row(), { phase: 'somewhere new' }, notRun, 0)).toBeUndefined();
  });
});

/** Three passes an hour apart, each copying 1,000. */
const PASSES: PassFacts[] = [0, 1, 2].map((i) => ({
  status: 'success',
  startedAt: new Date(Date.UTC(2026, 9, 2, 12 - i)).toISOString(),
  finishedAt: new Date(Date.UTC(2026, 9, 2, 12 - i, 50)).toISOString(),
  itemsProcessed: 1_000,
}));

describe('how long, on a progress link, by the owner’s pages’ rules', () => {
  it('before the first pass, says Gmail’s mail in days from its daily ceiling', () => {
    const time = viewTimeOf({
      lifecycle: 'active',
      reports: [row({ state: 'in_progress' })],
      passes: [],
      source: 'gmail',
      selected: ['email'],
      discovery: [found('email', 40_000, 6 * GB)],
    });
    expect(time).toEqual({ kind: 'beforeStart', estimate: { kind: 'gmailDays', low: 2, high: 3, filesToo: false } });
  });

  it('reads an IMAP account at Gmail’s host as Gmail, and any other as not known yet', () => {
    const at = (host: string) =>
      viewTimeOf({
        lifecycle: 'paused',
        reports: [],
        passes: [],
        source: 'imap',
        sourceHost: host,
        selected: ['email'],
        discovery: [found('email', 900, GB)],
      });
    expect(at('imap.gmail.com')?.estimate).toMatchObject({ kind: 'gmailWithinADay' });
    expect(at('mail.example.org')?.estimate).toEqual({ kind: 'notKnownYet' });
  });

  it('says nothing before the first pass where the count found nothing to go on', () => {
    expect(
      viewTimeOf({ lifecycle: 'active', reports: [], passes: [], source: 'gmail', selected: ['email'], discovery: [] }),
    ).toBeUndefined();
    // A count left by a data type the migration no longer carries is no count of this one.
    expect(
      viewTimeOf({
        lifecycle: 'active',
        reports: [],
        passes: [],
        source: 'gmail',
        selected: ['email'],
        discovery: [found('file', 10)],
      }),
    ).toBeUndefined();
  });

  it('once a pass has completed and it copies, says a range from the last passes', () => {
    const time = viewTimeOf({
      lifecycle: 'active',
      reports: [row({ itemsSynced: 3_000, itemsFound: 13_000, lastSyncedAt: done })],
      passes: PASSES,
      source: 'gmail',
      selected: ['email'],
      discovery: [],
    });
    expect(time).toEqual({
      kind: 'whileCopying',
      estimate: { kind: 'range', unit: 'hours', low: 10, high: 11, passes: 3, slowed: false },
    });
  });

  it('says the provider slowed it where a copying data type’s last failure says so', () => {
    const time = viewTimeOf({
      lifecycle: 'active',
      reports: [row({ itemsSynced: 3_000, itemsFound: 13_000, lastSyncedAt: done, lastErrorCategory: 'rate_limited' })],
      passes: PASSES,
      source: 'o365',
      selected: ['email'],
      discovery: [],
    });
    expect(time?.estimate).toMatchObject({ kind: 'range', slowed: true });
  });

  it('before three passes, says it will know after three', () => {
    const time = viewTimeOf({
      lifecycle: 'active',
      reports: [row({ itemsSynced: 1_000, itemsFound: 13_000, lastSyncedAt: done })],
      passes: PASSES.slice(0, 1),
      source: 'gmail',
      selected: ['email'],
      discovery: [],
    });
    expect(time).toEqual({ kind: 'whileCopying', estimate: { kind: 'afterThreePasses', passesSoFar: 1 } });
  });

  it('says nothing past copying, held after it started, or with nothing left', () => {
    const copied = row({ itemsSynced: 3_000, itemsFound: 13_000, lastSyncedAt: done });
    const base = { reports: [copied], passes: PASSES, source: 'gmail', selected: ['email' as const], discovery: [] };
    expect(viewTimeOf({ ...base, lifecycle: 'paused' })).toBeUndefined();
    expect(viewTimeOf({ ...base, lifecycle: 'cutover' })).toBeUndefined();
    expect(viewTimeOf({ ...base, lifecycle: 'done' })).toBeUndefined();
    expect(
      viewTimeOf({ ...base, lifecycle: 'active', reports: [row({ itemsSynced: 13_000, itemsFound: 13_000, lastSyncedAt: done })] }),
    ).toBeUndefined();
    // A total nobody counted leaves the rest unknown: no range of part of it.
    expect(viewTimeOf({ ...base, lifecycle: 'active', reports: [row({ itemsSynced: 3_000, lastSyncedAt: done })] })).toBeUndefined();
  });
});
