// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE LAST 90 DAYS FIRST, THROUGH `runAllDomains` (workplan 0170 §3.1, §3.2):
 * the appliance's dispatcher, with the calendar and contact syncs replaced by
 * recorders that keep what each was handed, over a real ledger on PGlite.
 *
 *  1. a calendar's first copy is two passes in one firing, its window and
 *     then the rest; the record in the cursor store says `in`; the data type
 *     is completed once, after both;
 *  2. a phase A that stops short is not followed by phase B, and the data
 *     type is not completed;
 *  3. contacts are never given a window;
 *  4. a 90-day migration's calendar is given its window, from its anchor, and
 *     nothing after it;
 *  5. a data type copied once before is given none.
 */

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  PgCursorStore,
  createPgliteDb,
  runMigrations,
  type LedgerDriver,
  type PgDatabase,
} from '@openmig/ledger';
import {
  asMappingId,
  asTenantId,
  parseMappingConfig,
  parseWindowRecord,
  phasesOfTheMigration,
  windowRecordKey,
  type MigrationStatus,
  type MigrationStatusStore,
  type PassWindow,
  type SwitchedOffState,
} from '@openmig/shared';

const recorder = vi.hoisted(() => ({
  handed: [] as Array<{ domain: string; window?: { since: string; only: boolean } }>,
  /** Whether a window pass reaches the end of every collection. */
  windowIn: true,
}));

vi.mock('@openmig/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/core')>();
  const recorded = (domain: string) => async (deps: { window?: PassWindow }) => {
    recorder.handed.push({
      domain,
      ...(deps.window ? { window: { since: deps.window.since.toISOString(), only: deps.window.only } } : {}),
    });
    return {
      collectionsListed: 1,
      scanned: 2,
      created: deps.window ? 1 : 2,
      skipped: 0,
      adopted: 0,
      updated: 0,
      failed: 0,
      moved: 0,
      deletions: [],
      ...(deps.window ? { windowComplete: recorder.windowIn } : {}),
    };
  };
  return { ...actual, runCalendarSync: recorded('calendar'), runContactSync: recorded('contact') };
});

const { runAllDomains } = await import('./orchestration.ts');

const ACTIVE_NOW = async () => ({ anyRuns: true, grantWithdrawnAt: null, phaseOf: phasesOfTheMigration('active') });

const TENANT = '00000000-0000-4000-8000-000000000170';
const MAPPING = '11111111-1111-4111-8111-111111110170';
const CONNECTION = '22222222-2222-4222-8222-222222220170';
const MAILBOX = '33333333-3333-4333-8333-333333330170';
const PASSWORD_ENV = 'A_PASSWORD_FOR_THE_LAST_90_DAYS_FIRST_TEST';

const dav = (type: 'caldav' | 'carddav') => ({
  type,
  url: 'https://cloud.example.invalid/remote.php/dav',
  user: 'someone',
  auth: { kind: 'login', passwordFromEnv: PASSWORD_ENV },
});

const mapping = (recentOnly?: { days: number; anchor: string }) =>
  parseMappingConfig({
    tenantId: TENANT,
    mappingId: MAPPING,
    source: dav('caldav'),
    target: dav('caldav'),
    domains: {
      calendar: { enabled: true, source: dav('caldav'), target: dav('caldav') },
      contacts: { enabled: true, source: dav('carddav'), target: dav('carddav') },
    },
    ...(recentOnly ? { recentOnly } : {}),
  });

function recordingStore(copiedOnce: boolean) {
  const completed: string[] = [];
  const store: MigrationStatusStore = {
    initDomainStatus: async () => {},
    markInProgress: async () => {},
    markCompleted: async (_t, _m, d) => {
      completed.push(d);
    },
    markPaused: async () => {},
    markFailed: async () => {},
    markSwitchedOff: async (): Promise<SwitchedOffState> => ({ state: 'skipped' }),
    markSwitchedOn: async () => {},
    getStatus: async () =>
      copiedOnce
        ? (['calendar', 'contact'] as const).map(
            (domain) => ({ domain, completedAt: '2026-09-01T00:00:00.000Z' }) as MigrationStatus,
          )
        : [],
  };
  return { store, completed };
}

let driver: LedgerDriver;
let ledgerDb: PgDatabase;

beforeAll(async () => {
  process.env[PASSWORD_ENV] = 'not-a-real-password';
  const made = await createPgliteDb({});
  driver = made.driver;
  ledgerDb = made.db;
  await runMigrations({ driver, logger: () => {} });
  // The rows the cursor table keys to, as the appliance makes them at boot.
  await ledgerDb.execute(sql`INSERT INTO tenant (id, name, status) VALUES (${TENANT}, 'windows', 'active')`);
  await ledgerDb.execute(
    sql`INSERT INTO connection (id, tenant_id, role, kind, display_name, status, config)
        VALUES (${CONNECTION}, ${TENANT}, 'source', 'caldav', 'fixture', 'connected', '{}'::jsonb)`,
  );
  await ledgerDb.execute(
    sql`INSERT INTO mailbox (id, tenant_id, connection_id, external_id, primary_address)
        VALUES (${MAILBOX}, ${TENANT}, ${CONNECTION}, 'src', 'a@example.test')`,
  );
  await ledgerDb.execute(
    sql`INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status) VALUES (${MAPPING}, ${TENANT}, ${MAILBOX}, 'active')`,
  );
}, 120_000);
afterAll(async () => {
  delete process.env[PASSWORD_ENV];
  await driver?.end();
});
afterEach(async () => {
  recorder.handed.length = 0;
  recorder.windowIn = true;
  await new PgCursorStore(ledgerDb).clear(asTenantId(TENANT), asMappingId(MAPPING));
});

const record = async () =>
  parseWindowRecord(
    (await new PgCursorStore(ledgerDb).get(asTenantId(TENANT), asMappingId(MAPPING), windowRecordKey('calendar')))
      ?.value,
  );

const run = (config: ReturnType<typeof mapping>, store: MigrationStatusStore) =>
  runAllDomains(config, store, phasesOfTheMigration('active'), ACTIVE_NOW, { ledgerDb });

describe('1-3. a migration of everything', () => {
  it('copies a calendar its window first, then the rest, and completes it once', async () => {
    const { store, completed } = recordingStore(false);

    const results = await run(mapping(), store);

    const calendar = recorder.handed.filter((h) => h.domain === 'calendar');
    expect(calendar).toHaveLength(2);
    expect(calendar[0]!.window?.only).toBe(false);
    expect(calendar[1]!.window).toBeUndefined();
    expect((await record())?.state).toBe('in');
    expect(completed).toContain('calendar');
    // The two passes, reported as one: what each copied, added.
    expect(results.find((r) => r.domain === 'calendar')?.created).toBe(3);
  });

  it('does not follow a phase A that stopped short with phase B, nor complete the data type', async () => {
    recorder.windowIn = false;
    const { store, completed } = recordingStore(false);

    await run(mapping(), store);

    expect(recorder.handed.filter((h) => h.domain === 'calendar')).toHaveLength(1);
    expect((await record())?.state).toBe('copying');
    expect(completed).not.toContain('calendar');
  });

  it('gives contacts no window', async () => {
    const { store } = recordingStore(false);
    await run(mapping(), store);
    expect(recorder.handed.filter((h) => h.domain === 'contact')).toEqual([{ domain: 'contact' }]);
  });
});

describe('4. a 90-day migration', () => {
  it('copies its window, from its anchor, and nothing after it, even once copied before', async () => {
    const { store, completed } = recordingStore(true);

    await run(mapping({ days: 90, anchor: '2026-11-24T10:00:00.000Z' }), store);

    expect(recorder.handed.filter((h) => h.domain === 'calendar')).toEqual([
      { domain: 'calendar', window: { since: '2026-08-26T00:00:00.000Z', only: true } },
    ]);
    expect(completed).toContain('calendar');
  });
});

describe('5. a data type copied once before', () => {
  it('is given no window', async () => {
    const { store } = recordingStore(true);
    await run(mapping(), store);
    expect(recorder.handed.filter((h) => h.domain === 'calendar')).toEqual([{ domain: 'calendar' }]);
  });
});
