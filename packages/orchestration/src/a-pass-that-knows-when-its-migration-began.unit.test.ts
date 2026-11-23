// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PASS THAT KNOWS WHEN ITS MIGRATION BEGAN (the owner, 2026-11-23; ADR-0055;
 * workplan 0168).
 *
 * The address table leaves an event that was over at the migration's start as
 * the source has it (`calendarObjectIsOver`). That start is the migration's
 * creation, which the phases reader gives every pass (`readPathPhases`,
 * `createdAt`): the appliance's pass and the standalone worker's hand it to
 * `runAllDomains` through `phasesNow`, and the managed builder reads it with
 * the phases it already reads (`buildDomainDepsFromMapping`). Here the
 * calendar and task passes are recorders: what reaches them is the table,
 * with the start the phases gave, on every data type it applies to.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPgliteDb, runMigrations, type LedgerDriver, type PgDatabase } from '@openmig/ledger';
import { parseMappingConfig, phasesOfTheMigration, type MigrationStatusStore, type PassPhases, type SwitchedOffState } from '@openmig/shared';
import type { AddressChangesForPass } from '@openmig/core';

const handed: Array<{ domain: string; addressChanges?: AddressChangesForPass }> = [];

const AN_EMPTY_PASS = {
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

vi.mock('@openmig/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/core')>();
  return {
    ...actual,
    runCalendarSync: async (deps: { addressChanges?: AddressChangesForPass }) => {
      handed.push({ domain: 'calendar', ...(deps.addressChanges ? { addressChanges: deps.addressChanges } : {}) });
      return AN_EMPTY_PASS;
    },
    runTaskSync: async (deps: { addressChanges?: AddressChangesForPass }) => {
      handed.push({ domain: 'task', ...(deps.addressChanges ? { addressChanges: deps.addressChanges } : {}) });
      return AN_EMPTY_PASS;
    },
  };
});

const { runAllDomains } = await import('./orchestration.ts');

const TENANT = '00000000-0000-4000-8000-000000011680';
const MAPPING = '11111111-1111-4111-8111-111111111680';
const PASSWORD_ENV = 'A_PASSWORD_FOR_THE_MIGRATION_START_TEST';

const caldav = {
  type: 'caldav',
  url: 'https://cloud.example.invalid/remote.php/dav',
  user: 'someone',
  auth: { kind: 'login', passwordFromEnv: PASSWORD_ENV },
} as const;

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

describe('the migration’s start, from its phases to the passes the address table reaches', () => {
  it('reaches the calendar and the task pass as the phases gave it', async () => {
    const createdAt = new Date('2026-11-02T08:15:00Z');
    const phasesNow = async (): Promise<PassPhases> => ({
      anyRuns: true,
      grantWithdrawnAt: null,
      phaseOf: phasesOfTheMigration('active'),
      createdAt,
    });
    const config = parseMappingConfig({
      tenantId: TENANT,
      mappingId: MAPPING,
      source: caldav,
      target: caldav,
      domains: {
        calendar: { enabled: true, source: caldav, target: caldav },
        tasks: { enabled: true, source: caldav, target: caldav },
      },
    });
    handed.length = 0;
    await runAllDomains(config, store, phasesOfTheMigration('active'), phasesNow, { ledgerDb });
    expect(handed.map((h) => h.domain).sort()).toEqual(['calendar', 'task']);
    for (const h of handed) expect(h.addressChanges?.migrationStart, h.domain).toEqual(createdAt);
  });

  it('is handed on by the managed builder too, from the phases it already reads', () => {
    // `addressChangesForPass` takes the start as a required argument, so a
    // builder cannot leave it out; this pins that the managed one hands the
    // phases' own, and not a bare `undefined`, which would compile.
    const builder = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'build-deps-from-mapping.ts'), 'utf8');
    expect(builder).toMatch(/createdAt: phases\.createdAt/);
    expect(builder).toMatch(/\n\s+createdAt,\n\s+\} = await loadDomainConnections\(/);
    const call = builder.slice(builder.indexOf('await addressChangesForPass('));
    expect(call.slice(0, call.indexOf(': undefined;'))).toMatch(/readAddressChangesApplied\(txDb, tenantId, mappingId\)\),\s+createdAt,\s+\)/);
  });

  it('reaches them without a start where the phases know none, and then nothing is over', async () => {
    const phasesNow = async (): Promise<PassPhases> => ({
      anyRuns: true,
      grantWithdrawnAt: null,
      phaseOf: phasesOfTheMigration('active'),
    });
    const config = parseMappingConfig({
      tenantId: TENANT,
      mappingId: MAPPING,
      source: caldav,
      target: caldav,
      domains: { calendar: { enabled: true, source: caldav, target: caldav } },
    });
    handed.length = 0;
    await runAllDomains(config, store, phasesOfTheMigration('active'), phasesNow, { ledgerDb });
    expect(handed).toHaveLength(1);
    expect(handed[0]!.addressChanges).toBeDefined();
    expect(handed[0]!.addressChanges!.migrationStart).toBeUndefined();
  });
});
