// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PAUSE HEARD INSIDE A PASS (2026-09-29): the appliance's half.
 *
 * On the managed stack a Pause pressed during a file pass waited up to fifty
 * minutes, for the pass's own deadline. The appliance was worse off: its pass
 * has no deadline, and it read the migration once, before the firing, so a
 * Finish, a data type stopped by its owner, or a pause set by hand waited for
 * the whole firing, which on a first copy can be days.
 *
 * `runAllDomains` now takes the question the appliance asks of the migration
 * (`whyItStops`, per data type) and asks it twice over: before each data type,
 * before anything is built for it, which is the appliance's first
 * between-types re-read; and from inside each data type's pass, where the loop
 * asks it at its own gates. A data type stopped either way is neither marked
 * completed nor paused, and the log says why in the words the loop uses.
 *
 * The calendar and contact syncs are replaced by recorders, as in
 * `a-phase-per-data-type.unit.test.ts`, so what is asserted is what each was
 * handed and what the dispatcher did with its answer.
 */

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { createPgliteDb, runMigrations, type LedgerDriver, type PgDatabase } from '@openmig/ledger';
import {
  HALT_IN_WORDS,
  log,
  parseMappingConfig,
  phasesOfTheMigration,
  type MigrationStatusStore,
  type PassStopReason,
  type SwitchedOffState,
} from '@openmig/shared';

interface Handed {
  domain: string;
  asked: boolean;
  answer?: PassStopReason | null;
}

const recorder = vi.hoisted(() => ({
  handed: [] as Handed[],
  /** A data type whose pass comes back stopped, and why. */
  haltIn: undefined as { domain: string; reason: string } | undefined,
}));

vi.mock('@openmig/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/core')>();
  const recorded =
    (domain: string) => async (deps: { whyItStops?: () => Promise<PassStopReason | null> }) => {
      const entry: Handed = { domain, asked: typeof deps.whyItStops === 'function' };
      // Asked once from inside, as the loop's first gate would.
      if (deps.whyItStops) entry.answer = await deps.whyItStops();
      recorder.handed.push(entry);
      const halted = recorder.haltIn?.domain === domain ? recorder.haltIn.reason : undefined;
      return {
        collectionsListed: 1,
        scanned: 2,
        created: 2,
        skipped: 0,
        adopted: 0,
        updated: 0,
        failed: 0,
        moved: 0,
        deletions: [],
        ...(halted
          ? { haltPause: { reason: halted, noticedAt: '2026-09-29T08:00:00.000Z', ranForMs: 1234 } }
          : {}),
      };
    };
  return { ...actual, runCalendarSync: recorded('calendar'), runContactSync: recorded('contact') };
});

const { runAllDomains } = await import('./orchestration.ts');

const TENANT = '00000000-0000-4000-8000-000000000929';
const MAPPING = '11111111-1111-4111-8111-111111110929';
const PASSWORD_ENV = 'A_PASSWORD_FOR_THE_PAUSE_INSIDE_A_PASS_TEST';

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

/** A status store that remembers which data types it was told finished, paused or in progress. */
function recordingStore() {
  const calls = { inProgress: [] as string[], completed: [] as string[], paused: [] as string[], failed: [] as string[] };
  const store: MigrationStatusStore = {
    initDomainStatus: async () => {},
    markInProgress: async (_t, _m, d) => {
      calls.inProgress.push(d);
    },
    markCompleted: async (_t, _m, d) => {
      calls.completed.push(d);
    },
    markPaused: async (_t, _m, d) => {
      calls.paused.push(d);
    },
    markFailed: async (_t, _m, d) => {
      calls.failed.push(d);
    },
    markSwitchedOff: async (): Promise<SwitchedOffState> => ({ state: 'skipped' }),
    markSwitchedOn: async () => {},
    getStatus: async () => [],
  };
  return { store, calls };
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
afterEach(() => {
  recorder.handed.length = 0;
  recorder.haltIn = undefined;
  vi.restoreAllMocks();
});

describe("the appliance's pass, handed the question", () => {
  it("hands it to every data type's pass, asking about that data type", async () => {
    const asked: string[] = [];
    const { store } = recordingStore();
    await runAllDomains(mapping(), store, phasesOfTheMigration('active'), { ledgerDb }, () => true, async (d) => {
      asked.push(d);
      return null;
    });

    expect(recorder.handed.map((h) => [h.domain, h.asked, h.answer])).toEqual([
      ['calendar', true, null],
      ['contact', true, null],
    ]);
    // Before each data type, and once from inside each.
    expect(asked).toEqual(['calendar', 'calendar', 'contact', 'contact']);
  });

  it('does not start a data type the migration says is stopped, and builds nothing for it', async () => {
    // Paused by hand between calendars and contacts: the appliance's first
    // between-types re-read. Nothing for contacts is built or run.
    const said = vi.spyOn(log, 'info').mockImplementation(() => {});
    const { store, calls } = recordingStore();
    await runAllDomains(mapping(), store, phasesOfTheMigration('active'), { ledgerDb }, () => true, async (d) =>
      d === 'contact' ? 'no_longer_runs' : null,
    );

    expect(recorder.handed.map((h) => h.domain)).toEqual(['calendar']);
    expect(calls.inProgress).toEqual(['calendar']);
    expect(calls.completed).toEqual(['calendar']);
    const lines = said.mock.calls.map((c) => String(c[0]));
    expect(lines).toContainEqual(expect.stringContaining(`contact: not started — ${HALT_IN_WORDS.no_longer_runs}`));
  });

  it('neither completes nor pauses a data type its pass was told to stop, and says why', async () => {
    const said = vi.spyOn(log, 'info').mockImplementation(() => {});
    const { store, calls } = recordingStore();
    recorder.haltIn = { domain: 'calendar', reason: 'stopped_by_its_owner' };
    const results = await runAllDomains(
      mapping(),
      store,
      phasesOfTheMigration('active'),
      { ledgerDb },
      () => true,
      async () => null,
    );

    expect(calls.completed).toEqual(['contact']);
    expect(calls.paused).toEqual([]);
    expect(calls.failed).toEqual([]);
    const calendar = results.find((r) => r.domain === 'calendar');
    expect(calendar?.haltedBecause).toBe('stopped_by_its_owner');
    expect(calendar?.error).toBeUndefined();
    // What it copied before the stop is real, and counted.
    expect(calendar?.created).toBe(2);
    const lines = said.mock.calls.map((c) => String(c[0]));
    const line = lines.find((l) => l.includes('calendar: stopped while copying'));
    expect(line).toBeDefined();
    expect(line).toContain(HALT_IN_WORDS.stopped_by_its_owner);
    expect(line).toContain('Nothing failed');
  });

  it('records a question that could not be answered as that data type failing, never as "go on"', async () => {
    // Hard rule 9: a migration that could not be read is not one that may be
    // copied, and a lane that died on it must not take the data types after
    // it down in silence either.
    const { store, calls } = recordingStore();
    vi.spyOn(log, 'error').mockImplementation(() => {});
    const results = await runAllDomains(mapping(), store, phasesOfTheMigration('active'), { ledgerDb }, () => true, async (d) => {
      if (d === 'calendar') throw new Error('the migration could not be read');
      return null;
    });

    expect(recorder.handed.map((h) => h.domain)).toEqual(['contact']);
    expect(calls.failed).toEqual(['calendar']);
    expect(results.find((r) => r.domain === 'calendar')?.error).toBe('the migration could not be read');
    expect(calls.completed).toEqual(['contact']);
  });

  it('runs every data type as before when nobody hands it a question, as the standalone worker does not', async () => {
    const { store, calls } = recordingStore();
    await runAllDomains(mapping(), store, phasesOfTheMigration('active'), { ledgerDb });

    expect(recorder.handed.map((h) => [h.domain, h.asked])).toEqual([
      ['calendar', false],
      ['contact', false],
    ]);
    expect(calls.completed).toEqual(['calendar', 'contact']);
  });
});
