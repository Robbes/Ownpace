// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE APPLIANCE'S PASS ASKS EACH DATA TYPE ITS OWN PHASE (workplan 0128 T5,
 * slice 1; the owner's D8, 2026-09-24).
 *
 * `runAllDomains` hands each data type's sync the answer to one question:
 * does its source still decide what exists? A data type past its own cutover
 * gets no deletion detectors (0117 D4), and one still before it keeps them,
 * in the same pass. Until a data type can have a phase of its own, every one
 * gets the migration's, as before.
 *
 * And, when the appliance asks, whether each data type still runs: the pass
 * moves on past one that no longer does while the others do, as the managed
 * pass does. The standalone worker does not ask, and runs what it is handed.
 *
 * The calendar and contact syncs are replaced by recorders, so what is
 * asserted is the answer each was handed, not what a server did with it.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createPgliteDb, runMigrations, type LedgerDriver, type PgDatabase } from '@openmig/ledger';
import {
  log,
  parseMappingConfig,
  pathRunsNow,
  phasesOfTheMigration,
  type MigrationStatusStore,
  type PathPhaseOf,
  type SwitchedOffState,
} from '@openmig/shared';

const handed = vi.hoisted(() => [] as Array<{ domain: string; sourceIsAuthorityOnExistence: unknown }>);

vi.mock('@openmig/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/core')>();
  const recorded = (domain: string) => async (deps: { sourceIsAuthorityOnExistence?: unknown }) => {
    handed.push({ domain, sourceIsAuthorityOnExistence: deps.sourceIsAuthorityOnExistence });
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

const TENANT = '00000000-0000-4000-8000-000000000128';
const MAPPING = '11111111-1111-4111-8111-111111110128';
const PASSWORD_ENV = 'A_PASSWORD_FOR_THE_0128_PHASE_TEST';

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

let driver: LedgerDriver;
let ledgerDb: PgDatabase;

/** What each data type's sync was handed, by data type; a data type not run is absent. */
async function passWith(
  phaseOf: PathPhaseOf,
  runsNow?: (domain: string) => boolean,
): Promise<Record<string, unknown>> {
  handed.length = 0;
  await runAllDomains(mapping(), store, phaseOf, { ledgerDb }, runsNow);
  return Object.fromEntries(handed.map((h) => [h.domain, h.sourceIsAuthorityOnExistence]));
}

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

describe("the appliance's pass", () => {
  it("hands each data type its own phase's answer, in one pass", async () => {
    // Calendars past their cutover, contacts still before it.
    const phaseOf: PathPhaseOf = (d) =>
      d === 'calendar' ? { phase: 'cutover', stillCopies: true } : { phase: 'active', stillCopies: false };
    expect(await passWith(phaseOf)).toEqual({ calendar: false, contact: true });
  });

  it("hands every data type the migration's answer while none has a phase of its own", async () => {
    expect(await passWith(phasesOfTheMigration('active'))).toEqual({ calendar: true, contact: true });
    expect(await passWith(phasesOfTheMigration('continuous'))).toEqual({ calendar: false, contact: false });
  });

  it('moves on past a data type that no longer runs while the others do', async () => {
    // Calendars past their own cutover's grace period, contacts still before theirs.
    const phaseOf: PathPhaseOf = (d) =>
      d === 'calendar' ? { phase: 'cutover', stillCopies: false } : { phase: 'active', stillCopies: false };
    expect(await passWith(phaseOf, (d) => pathRunsNow(phaseOf(d)))).toEqual({ contact: true });
  });

  it('moves on past a data type its owner stopped, and says it was stopped, not ended (0128 T4)', async () => {
    const phaseOf: PathPhaseOf = (d) =>
      d === 'calendar' ? { phase: 'active', stillCopies: false, stopped: true } : { phase: 'active', stillCopies: false };
    const said = vi.spyOn(log, 'info').mockImplementation(() => {});
    try {
      expect(await passWith(phaseOf, (d) => pathRunsNow(phaseOf(d)))).toEqual({ contact: true });
      const lines = said.mock.calls.map((c) => String(c[0]));
      expect(lines).toContainEqual(expect.stringContaining('skipped calendar: you stopped this data type'));
      expect(lines.some((l) => l.includes('skipped calendar: this data type no longer runs'))).toBe(false);
    } finally {
      said.mockRestore();
    }
  });

  it('runs every data type it is handed when nobody asks, as the standalone worker always has', async () => {
    expect(await passWith(phasesOfTheMigration('done'))).toEqual({ calendar: false, contact: false });
  });
});
