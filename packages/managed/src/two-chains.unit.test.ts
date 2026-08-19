// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * Two migration chains over one database (ADR-0036).
 *
 * The appliance applies the shared chain. A managed deployment applies both.
 * That is the entire mechanism by which an appliance ends up without an
 * `invoice` table, so it is worth asking a database rather than reading the
 * code and believing it.
 *
 * ## Why the chains need separate bookkeeping, corrected by this test
 *
 * I wrote first that a shared `schema_migrations` would make the APPLIANCE
 * refuse to boot: it would read the managed chain's versions, find them higher
 * than anything it ships, and trip `runMigrations`' downgrade guard. Writing
 * the test found that is not what happens — the managed chain's one file is
 * `0001_the_managed_service.sql`, which sorts BELOW `0027_...`, so it is the
 * MANAGED chain that refuses, immediately, the first time it runs.
 *
 * The correct statement is the more uncomfortable one. **The two chains'
 * versions were never ordered against each other**, so a shared ledger has the
 * guard comparing numbers that mean nothing in common — and which side breaks
 * is an accident of how somebody named a file. Today it is the managed chain,
 * loudly, at the moment of the mistake. Name that file `0100_` instead and it
 * is the appliance, at boot, on a machine that never downgraded anything.
 *
 * A guard that fires on the wrong deployment for the wrong reason is worse than
 * one that fires here, which is why the last case pins the behaviour rather
 * than describing it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createPgliteDb,
  runMigrations,
  type LedgerDriver,
  type LedgerConnection,
} from '@openmig/ledger';
import {
  runManagedMigrations,
  managedMigrationsDir,
  MANAGED_BOOKKEEPING_TABLE,
} from './migrate-managed';

/** Everything the managed chain creates, and nothing else does. */
const MANAGED_TABLES = [
  'invoice',
  'payment_method',
  'usage_metric',
  'tenant_member',
  'erasure_record',
  'tenant_pricing',
  'tenant_closure',
];

async function tablesIn(conn: LedgerConnection): Promise<Set<string>> {
  const { rows } = await conn.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  return new Set(rows.map((r) => r.table_name));
}

describe('the appliance applies one chain and gets one schema', () => {
  let driver: LedgerDriver;
  let conn: LedgerConnection;

  beforeAll(async () => {
    const made = await createPgliteDb({});
    driver = made.driver;
    await runMigrations({ driver, logger: () => {} });
    conn = await driver.acquire();
  }, 120_000);

  afterAll(async () => {
    await driver?.end();
  });

  it('builds a real schema, so the absences below are not an empty database', async () => {
    // Every "table X is not here" assertion is true of a database where nothing
    // ran at all.
    const tables = await tablesIn(conn);
    for (const table of ['tenant', 'connection', 'item', 'run']) {
      expect(tables.has(table), `${table} is missing — the shared chain did not apply`).toBe(true);
    }
    expect(tables.size).toBeGreaterThan(20);
  }, 30_000);

  it('has NONE of the managed tables', async () => {
    const tables = await tablesIn(conn);
    const present = MANAGED_TABLES.filter((t) => tables.has(t));
    expect(
      present,
      'the shared chain creates a managed-only table, so every appliance would ' +
        'have it — move the DDL to packages/managed/migrations (ADR-0036):\n' +
        present.map((t) => `  - ${t}`).join('\n'),
    ).toEqual([]);
  }, 30_000);

  it('has no managed column left on tenant', async () => {
    const { rows } = await conn.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tenant'`,
    );
    const columns = rows.map((r) => r.column_name);
    expect(columns.length).toBeGreaterThan(3);
    for (const gone of ['pricing', 'closed_at', 'purge_after', 'closed_by']) {
      expect(columns, `tenant.${gone} is back on the shared chain`).not.toContain(gone);
    }
  }, 30_000);

  it('still allows the closed status, which deliberately did not move', async () => {
    // A CHECK constraint is a statement about what is ALLOWED, and an
    // allowed-but-unused value costs an appliance nothing. Moving it would mean
    // the managed chain rewriting a constraint the shared chain owns.
    await conn.query(
      `INSERT INTO tenant (id, name, status) VALUES (gen_random_uuid(), 'x', 'closed')`,
    );
  }, 30_000);
});

describe('a managed deployment applies both chains', () => {
  let driver: LedgerDriver;
  let conn: LedgerConnection;

  beforeAll(async () => {
    const made = await createPgliteDb({});
    driver = made.driver;
    await runMigrations({ driver, logger: () => {} });
    await runManagedMigrations({ driver, logger: () => {} });
    conn = await driver.acquire();
  }, 120_000);

  afterAll(async () => {
    await driver?.end();
  });

  it('gets every managed table', async () => {
    const tables = await tablesIn(conn);
    expect(MANAGED_TABLES.filter((t) => !tables.has(t))).toEqual([]);
  }, 30_000);

  it('keeps the two chains in separate ledgers, with nothing recorded twice', async () => {
    const shared = await conn.query<{ version: string }>('SELECT version FROM schema_migrations');
    const managed = await conn.query<{ version: string }>(
      `SELECT version FROM ${MANAGED_BOOKKEEPING_TABLE}`,
    );
    expect(shared.rows.length).toBeGreaterThan(5);
    expect(managed.rows.length).toBeGreaterThan(0);

    // A version in both would mean one chain applied the other's file.
    const sharedVersions = new Set(shared.rows.map((r) => r.version));
    expect(managed.rows.map((r) => r.version).filter((v) => sharedVersions.has(v))).toEqual([]);
  }, 30_000);

});

describe('re-running either chain is a no-op', () => {
  // Its own driver, and no connection held open across the calls: PGlite is a
  // single backend, so a test that holds `driver.acquire()` while
  // `runMigrations` tries to take one deadlocks on the pool rather than on
  // anything this file is about. Found by writing it the other way first.
  it('applies nothing the second time, including from an appliance-shaped call', async () => {
    const made = await createPgliteDb({});
    try {
      await runMigrations({ driver: made.driver, logger: () => {} });
      await runManagedMigrations({ driver: made.driver, logger: () => {} });

      expect((await runMigrations({ driver: made.driver, logger: () => {} })).applied).toEqual([]);
      expect(
        (await runManagedMigrations({ driver: made.driver, logger: () => {} })).applied,
      ).toEqual([]);
      // The appliance shape: a build shipping only the shared chain re-reads a
      // database a managed deployment has migrated, and must not trip the
      // downgrade guard on versions belonging to a chain it does not have.
      expect((await runMigrations({ driver: made.driver, logger: () => {} })).applied).toEqual([]);
    } finally {
      await made.driver.end();
    }
  }, 120_000);
});

describe('one ledger for two chains breaks the downgrade guard', () => {
  it('refuses — and the side that breaks is an accident of the filename', async () => {
    // The mutation, run as a test rather than left as a comment: apply the
    // managed chain into the SHARED chain's bookkeeping table.
    //
    // It throws on the MANAGED call, because `0001_the_managed_service.sql`
    // sorts below the shared chain's `0027_...` already recorded there. Rename
    // that file `0100_` and this passes while the APPLIANCE starts refusing
    // instead — same defect, different victim. Neither is acceptable, and the
    // fix for both is that the versions of two chains are never compared.
    const made = await createPgliteDb({});
    try {
      await runMigrations({ driver: made.driver, logger: () => {} });

      await expect(
        runMigrations({
          driver: made.driver,
          migrationsDir: managedMigrationsDir(),
          logger: () => {},
        }),
      ).rejects.toThrow(/newer than this build understands/);
    } finally {
      await made.driver.end();
    }
  }, 120_000);
});
