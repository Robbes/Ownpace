// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DATA TYPE WITH A FOLDER ITS PASS COULD NOT LIST IS NOT A FINISHED ONE
 * (2026-09-29; workplan 0055 T3 (e), the owner's "2a").
 *
 * The shared loop skips a folder the source will not list and carries on. The
 * runner decides what the status row says, and in both processes that run a
 * pass it must say the same: not `completed`, because the folder is asked for
 * again on the next pass, and the folder named, after any pause's write so
 * that write cannot clear it. A pass that listed everything clears an earlier
 * note.
 *
 * The appliance's loop is driven for real, with the calendar sync replaced by
 * one whose result is set per test; the managed worker's task is pinned by
 * reading its source, the way `a-failure-with-its-reference.unit.test.ts` pins
 * it.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPgliteDb, runMigrations, type LedgerDriver, type PgDatabase } from '@openmig/ledger';
import {
  log,
  parseMappingConfig,
  phasesOfTheMigration,
  type BudgetPause,
  type MigrationStatusStore,
  type SwitchedOffState,
  type UnreadCollection,
} from '@openmig/shared';

const next = vi.hoisted(() => ({
  unread: undefined as ReadonlyArray<unknown> | undefined,
  budgetPause: undefined as unknown,
}));

vi.mock('@openmig/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/core')>();
  return {
    ...actual,
    runCalendarSync: async () => ({
      collectionsListed: 2,
      scanned: 1,
      created: 1,
      skipped: 0,
      adopted: 0,
      updated: 0,
      failed: 0,
      moved: 0,
      deletions: [],
      ...(next.unread ? { unreadCollections: next.unread } : {}),
      ...(next.budgetPause ? { budgetPause: next.budgetPause } : {}),
    }),
  };
});

const { runAllDomains } = await import('./orchestration.ts');

const TENANT = '00000000-0000-4000-8000-0000000002a0';
const MAPPING = '11111111-1111-4111-8111-1111111102a0';
const PASSWORD_ENV = 'A_PASSWORD_FOR_THE_2A_UNREAD_FOLDER_TEST';

const dav = {
  type: 'caldav',
  url: 'https://cloud.example.invalid/remote.php/dav',
  user: 'someone',
  auth: { kind: 'login', passwordFromEnv: PASSWORD_ENV },
};

const mapping = () =>
  parseMappingConfig({
    tenantId: TENANT,
    mappingId: MAPPING,
    source: dav,
    target: dav,
    domains: { calendar: { enabled: true, source: dav, target: dav } },
  });

const TEAM: UnreadCollection = {
  collection: '/calendars/someone/team/',
  name: 'Team',
  error: '503 Service Unavailable',
  category: 'unknown',
  reference: '2a2a2a2a',
};

const CEILING: BudgetPause = {
  provider: 'caldav.example.invalid',
  spentBytes: 10,
  ceilingBytes: 10,
  windowResetsAt: null,
};

/** Every write the pass made to the status row, in order, with what it wrote. */
const writes: Array<[string, unknown?]> = [];

const recording = (withNote: boolean): MigrationStatusStore => ({
  initDomainStatus: async () => {},
  markInProgress: async () => void writes.push(['markInProgress']),
  markCompleted: async () => void writes.push(['markCompleted']),
  markPaused: async () => void writes.push(['markPaused']),
  markFailed: async (_t, _m, _d, error) => void writes.push(['markFailed', error]),
  markSwitchedOff: async (): Promise<SwitchedOffState> => ({ state: 'skipped' }),
  markSwitchedOn: async () => {},
  getStatus: async () => [],
  ...(withNote
    ? {
        noteUnreadCollections: async (_t, _m, _d, unread) =>
          void writes.push(['noteUnreadCollections', unread.map((u) => u.name)]),
      }
    : {}),
});

let driver: LedgerDriver;
let ledgerDb: PgDatabase;

beforeAll(async () => {
  process.env[PASSWORD_ENV] = 'not-a-real-password';
  const made = await createPgliteDb({});
  driver = made.driver;
  ledgerDb = made.db;
  await runMigrations({ driver, logger: () => {} });
}, 120_000);
afterAll(async () => {
  delete process.env[PASSWORD_ENV];
  await driver?.end();
});
beforeEach(() => {
  writes.length = 0;
  next.unread = undefined;
  next.budgetPause = undefined;
});
afterEach(() => vi.restoreAllMocks());

const pass = (withNote = true) =>
  runAllDomains(mapping(), recording(withNote), phasesOfTheMigration('active'), { ledgerDb });

describe("the appliance's pass, for a data type with a folder it could not list", () => {
  it('does not mark it completed, and names the folder', async () => {
    next.unread = [TEAM];
    vi.spyOn(log, 'warn').mockImplementation(() => {});

    await pass();

    expect(writes).toEqual([['markInProgress'], ['noteUnreadCollections', ['Team']]]);
  });

  it('names the folder after the pause is written, so the pause cannot clear it', async () => {
    next.unread = [TEAM];
    next.budgetPause = CEILING;
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    vi.spyOn(log, 'info').mockImplementation(() => {});

    await pass();

    expect(writes).toEqual([['markInProgress'], ['markPaused'], ['noteUnreadCollections', ['Team']]]);
  });

  it('says so in its log with the references and without the names, which are the owner’s', async () => {
    next.unread = [TEAM];
    const said = vi.spyOn(log, 'warn').mockImplementation(() => {});

    await pass();

    const lines = said.mock.calls.map((c) => c.join(' ')).filter((l) => l.includes('could not be listed'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('2a2a2a2a');
    expect(lines[0]).not.toContain('Team');
  });

  it('still does not mark it completed with a store that cannot hold the note', async () => {
    next.unread = [TEAM];
    vi.spyOn(log, 'warn').mockImplementation(() => {});

    await pass(false);

    expect(writes).toEqual([['markInProgress']]);
  });
});

describe("the appliance's pass, for a data type that listed every folder", () => {
  it('marks it completed, and clears any note an earlier pass wrote', async () => {
    await pass();

    expect(writes).toEqual([['markInProgress'], ['markCompleted'], ['noteUnreadCollections', []]]);
  });
});

const HERE = dirname(fileURLToPath(import.meta.url));

describe("the managed worker's task", () => {
  const worker = readFileSync(join(HERE, '../../..', 'apps/worker/src/jobs/run-delta-sync.ts'), 'utf8');

  it('marks a data type completed only when the pass neither paused nor left a folder unread', () => {
    expect(worker).toMatch(/const unread = result\.unreadCollections \?\? \[\];/);
    expect(worker).toMatch(/if \(!pause && unread\.length === 0\) \{\s*await withTenant[\s\S]{0,160}?markCompleted\(/);
    expect(worker.match(/markCompleted\(/g)).toHaveLength(1);
  });

  it('names the folders after the pause is written, on every pass that returned', () => {
    const paused = worker.indexOf('.markPaused(');
    const noted = worker.indexOf('.noteUnreadCollections(tenantId, mappingId, domain, unread)');
    expect(paused).toBeGreaterThan(0);
    expect(noted).toBeGreaterThan(paused);
    // Outside the pause's branch: the note is written or cleared either way.
    expect(worker.slice(paused, noted)).toMatch(/\n {10}\}\n/);
  });
});
