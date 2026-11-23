// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A NEW ADDRESS, COUNTED PAST THE PASS (workplan 0168 S5 (a); the screens'
 * review S2).
 *
 * `runDomainSync` counted what a changed address table did (copies changed,
 * copies waiting for the press past a cutover) and nothing carried it any
 * further: `runAllDomains`' outcome had no such field, nothing logged it, and
 * a data type's `lastPass` never had it, so the migration page could not say
 * the count or offer the press. The appliance's outcome did not carry the
 * pass's metrics at all, so its data types had no `lastPass` whatever.
 *
 * Here the contact pass is a recorder that answers with those counts, and the
 * status store records what `markCompleted` is handed: the counts reach the
 * outcome and, through the metrics, the data type's last pass.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createPgliteDb, runMigrations, type LedgerDriver, type PgDatabase } from '@openmig/ledger';
import {
  parseMappingConfig,
  phasesOfTheMigration,
  type MigrationStatusStore,
  type PassMetrics,
  type PassPhases,
  type SwitchedOffState,
} from '@openmig/shared';

const METRICS: PassMetrics = {
  items: 4,
  wallMs: 10,
  sourceFetchMs: 1,
  targetWriteMs: 1,
  ledgerMs: 1,
  hashMs: 0,
  overlap: 0.3,
  addressChanged: 2,
  addressChangesWaiting: 3,
  addressChangesUnguarded: 1,
  addressChangesCarried: 5,
};

vi.mock('@openmig/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/core')>();
  return {
    ...actual,
    runContactSync: async () => ({
      collectionsListed: 1,
      scanned: 4,
      created: 0,
      skipped: 0,
      adopted: 0,
      updated: 2,
      failed: 0,
      moved: 0,
      deletions: [],
      addressChanged: 2,
      addressChangesWaiting: 3,
      addressChangesUnguarded: 1,
      goneFromTarget: 1,
      metrics: METRICS,
    }),
  };
});

const { runAllDomains } = await import('./orchestration.ts');

const TENANT = '00000000-0000-4000-8000-000000001168';
const MAPPING = '11111111-1111-4111-8111-111111111168';
const PASSWORD_ENV = 'A_PASSWORD_FOR_THE_ADDRESS_COUNTS_TEST';

const carddav = {
  type: 'carddav',
  url: 'https://cloud.example.invalid/remote.php/dav',
  user: 'someone',
  auth: { kind: 'login', passwordFromEnv: PASSWORD_ENV },
} as const;

const completed: Array<{ domain: string; metrics?: PassMetrics }> = [];
const store: MigrationStatusStore = {
  initDomainStatus: async () => {},
  markInProgress: async () => {},
  markCompleted: async (_t, _m, domain, metrics) => {
    completed.push({ domain, ...(metrics ? { metrics } : {}) });
  },
  markPaused: async () => {},
  markFailed: async () => {},
  markSwitchedOff: async (): Promise<SwitchedOffState> => ({ state: 'skipped' }),
  markSwitchedOn: async () => {},
  getStatus: async () => [],
};

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

describe('the address table’s counts, past the pass that counted them', () => {
  it('reach the outcome, and the data type’s last pass through its metrics', async () => {
    const phasesNow = async (): Promise<PassPhases> => ({
      anyRuns: true,
      grantWithdrawnAt: null,
      phaseOf: phasesOfTheMigration('cutover', true),
    });
    const config = parseMappingConfig({
      tenantId: TENANT,
      mappingId: MAPPING,
      source: carddav,
      target: carddav,
      domains: { contacts: { enabled: true, source: carddav, target: carddav } },
    });
    const results = await runAllDomains(config, store, phasesOfTheMigration('cutover'), phasesNow, { ledgerDb });
    const contact = results.find((r) => r.domain === 'contact');
    expect(contact).toMatchObject({
      addressChanged: 2,
      addressChangesWaiting: 3,
      addressChangesUnguarded: 1,
      goneFromTarget: 1,
    });
    expect(completed.find((c) => c.domain === 'contact')?.metrics).toEqual(METRICS);
  });
});
