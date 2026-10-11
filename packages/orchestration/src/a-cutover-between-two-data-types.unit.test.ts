// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CUTOVER EXECUTED BETWEEN TWO DATA TYPES OF ONE FIRING (2026-10-05): the
 * appliance's half of "a pass already running concludes nothing after it".
 *
 * The appliance read the migration's phases once per firing, and a firing on
 * a first copy can run for hours or days. So a data type that STARTED after
 * the owner pressed execute was handed the answer from before it, and ran with
 * its deletion detectors present: it read the old system's bin and counted
 * what had gone missing there, after cutover. 0117 D4 (2026-09-09): *"after
 * cutover the source is no longer the authority on what exists, so we will
 * not delete in target based on changes in the source."*
 *
 * Now `runAllDomains` is handed the reader itself (`phasesNow`), asks it when
 * each data type starts, and hands each data type's pass the same question to
 * ask again before its conclusions (`stillTheAuthority`).
 *
 * The calendar and contact syncs are replaced by recorders, as in
 * `a-phase-per-data-type.unit.test.ts`, so what is asserted is what each was
 * handed.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createPgliteDb, runMigrations, type LedgerDriver, type PgDatabase } from '@openmig/ledger';
import {
  parseMappingConfig,
  phasesOfTheMigration,
  type MigrationStatusStore,
  type PassPhases,
  type SwitchedOffState,
} from '@openmig/shared';

interface Handed {
  domain: string;
  atStart: unknown;
  /** What its own question answered, asked once its pass had run. */
  askedAgain: unknown;
}

const recorder = vi.hoisted(() => ({
  handed: [] as Handed[],
  /** Called once a data type's pass has run: where the test presses execute. */
  afterPass: (() => {}) as (domain: string) => void,
}));

vi.mock('@openmig/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/core')>();
  const recorded =
    (domain: string) =>
    async (deps: { sourceIsAuthorityOnExistence?: unknown; stillTheAuthority?: () => Promise<boolean> }) => {
      recorder.afterPass(domain);
      recorder.handed.push({
        domain,
        atStart: deps.sourceIsAuthorityOnExistence,
        askedAgain: deps.stillTheAuthority ? await deps.stillTheAuthority() : 'not handed',
      });
      return {
        collectionsListed: 0,
        scanned: 0,
        created: 0,
        skipped: 0,
        adopted: 0,
        updated: 0,
        failed: 0,
        moved: 0,
        deletions: [],
      };
    };
  return { ...actual, runCalendarSync: recorded('calendar'), runContactSync: recorded('contact') };
});

const { runAllDomains } = await import('./orchestration.ts');

const TENANT = '00000000-0000-4000-8000-000000001005';
const MAPPING = '11111111-1111-4111-8111-111111111005';
const PASSWORD_ENV = 'A_PASSWORD_FOR_THE_CUTOVER_BETWEEN_TWO_DATA_TYPES_TEST';

const dav = (type: 'caldav' | 'carddav') => ({
  type,
  url: 'https://cloud.example.invalid/remote.php/dav',
  user: 'someone',
  auth: { kind: 'login', passwordFromEnv: PASSWORD_ENV },
});

const mapping = () =>
  parseMappingConfig({
    tenantId: TENANT,
    mappingId: MAPPING,
    source: dav('caldav'),
    target: dav('caldav'),
    domains: {
      calendar: { enabled: true, source: dav('caldav'), target: dav('caldav') },
      contacts: { enabled: true, source: dav('carddav'), target: dav('carddav') },
    },
  });

const store: MigrationStatusStore = {
  initDomainStatus: async () => {},
  markInProgress: async () => {},
  markCompleted: async () => {},
  markPaused: async () => {},
  markFailed: async () => {},
  markSwitchedOff: async (): Promise<SwitchedOffState> => ({ state: 'skipped' }),
  markSwitchedOn: async () => {},
  getStatus: async () => [],
};

/** The database's answer, which the test moves while the firing runs. */
function migration(status: string, stillCopies = false) {
  let now = status;
  return {
    execute: () => {
      now = 'cutover';
    },
    phasesNow: async (): Promise<PassPhases> => ({
      anyRuns: true,
      grantWithdrawnAt: null,
      phaseOf: phasesOfTheMigration(now, stillCopies),
    }),
  };
}

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

describe('a cutover executed while one firing runs', () => {
  it('the data type that starts after it is handed the after-cutover answer, not the firing\'s', async () => {
    recorder.handed.length = 0;
    const m = migration('active', true);
    // Execute is pressed while the first data type copies.
    recorder.afterPass = (domain) => {
      if (recorder.handed.length === 0 && domain) m.execute();
    };
    // The firing's own reading, from before execute: what it schedules by.
    await runAllDomains(mapping(), store, phasesOfTheMigration('active'), m.phasesNow, { ledgerDb });

    expect(recorder.handed).toHaveLength(2);
    const [first, second] = recorder.handed;
    // The first started before execute, and asks again before its conclusions:
    // by then the old system no longer decides what exists.
    expect(first!.atStart).toBe(true);
    expect(first!.askedAgain, 'the first data type was not handed a question it could ask again').toBe(false);
    // The second started after it, and is handed the answer from after it.
    expect(second!.atStart, `${second!.domain} started after cutover with its detectors present`).toBe(false);
    expect(second!.askedAgain).toBe(false);
  });

  it('a firing with no cutover hands every data type the before-cutover answer, asked twice', async () => {
    recorder.handed.length = 0;
    recorder.afterPass = () => {};
    const m = migration('active');
    await runAllDomains(mapping(), store, phasesOfTheMigration('active'), m.phasesNow, { ledgerDb });
    expect(recorder.handed.map((h) => [h.domain, h.atStart, h.askedAgain]).sort()).toEqual([
      ['calendar', true, true],
      ['contact', true, true],
    ]);
  });

  it('a migration gone from the database concludes nothing for any data type', async () => {
    recorder.handed.length = 0;
    recorder.afterPass = () => {};
    await runAllDomains(mapping(), store, phasesOfTheMigration('active'), async () => null, { ledgerDb });
    expect(recorder.handed.map((h) => [h.domain, h.atStart, h.askedAgain]).sort()).toEqual([
      ['calendar', false, false],
      ['contact', false, false],
    ]);
  });
});
