// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Does the Drizzle schema describe the database the migrations actually build?
 * (workplan 0085, after a bug that reached CI.)
 *
 * ## The bug this exists to have caught
 *
 * Migration 0025 added `billed_to_name` to `invoice`. The matching edit to
 * `schema-pg.ts` was applied with an anchored replace, and the anchor —
 * `tenantId … references(…)` followed by `periodStart` — matches **two**
 * tables. It landed on `usage_metric`, which is defined first.
 *
 * So the SQL had the column on `invoice` and the ORM believed it was on
 * `usage_metric`. Every unit test passed: PGlite runs the real migrations, so
 * the database was right, and nothing in the unit tier inserts into
 * `usage_metric` through Drizzle. It failed in the integration tier, on a table
 * nobody had touched, with `column "billed_to_name" of relation "usage_metric"
 * does not exist`.
 *
 * That is the worst shape of failure available here: **the two halves of one
 * change drift, and the tests that would notice are the ones nobody thought to
 * run.** The fix is not to be more careful — it is to make the two halves
 * compare themselves.
 *
 * ## What it checks, and what it does not
 *
 * Column NAMES, per table, both directions. Not types, not nullability, not
 * defaults: Drizzle's type names and Postgres's do not correspond one-to-one,
 * and a check that needs a translation table is a check that will be wrong in
 * a way nobody notices. Names are unambiguous, and names are what drift.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { createPgliteDb } from './pglite-driver';
import { runMigrations } from './migrate';
import * as schemaPg from './schema-pg';
import type { LedgerDriver, LedgerConnection } from './driver';

let driver: LedgerDriver;
let conn: LedgerConnection;

/**
 * Columns the migrations create and the ORM deliberately does not model.
 *
 * Named with reasons rather than silently tolerated, the same way 0081's
 * 500-guard allow-lists its two deliberate exceptions: an unexplained
 * exception becomes a place future drift can hide.
 *
 * Both of these are pre-existing and were found BY this test. Neither is
 * "fine" — each is a follow-up with a real decision attached — but declaring
 * them belongs in a change that can weigh the consequences, not in the fix
 * that added the guard.
 */
const UNDECLARED_ON_PURPOSE: Readonly<Record<string, string>> = {
  'item.item_type':
    'Documented in ledger.ts: because the ORM cannot see it, the unique constraint ' +
    '(tenant_id, mapping_id, item_type, natural_key_hash) has no nameable conflict target, ' +
    'which is why recordFailure does UPDATE-then-INSERT instead of ON CONFLICT DO UPDATE. ' +
    'Declaring it would let that be simplified — a real improvement, and a behaviour change ' +
    'to make deliberately rather than as a side effect.',
  'connection.encrypted_credentials':
    'Declaring it would make it appear in every `select()` on connection — and several call ' +
    'sites select the whole row. The failure mode of getting that wrong is credential ' +
    'disclosure in an API response, so it needs a pass over every consumer, not a one-line ' +
    'schema addition.',
};

/** Every table the ORM declares, by its real Postgres name. */
function declaredTables(): Array<{ name: string; columns: string[] }> {
  const out: Array<{ name: string; columns: string[] }> = [];
  for (const value of Object.values(schemaPg)) {
    if (!is(value, PgTable)) continue;
    const columns = Object.values(getTableColumns(value)).map((c) => c.name);
    out.push({ name: getTableName(value), columns: columns.sort() });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

beforeAll(async () => {
  const made = await createPgliteDb({});
  driver = made.driver;
  await runMigrations({ driver, logger: () => {} });
  conn = await driver.acquire();
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe('the Drizzle schema and the migrations describe the same database', () => {
  it('finds tables to compare, so the checks below are not vacuous', () => {
    // A introspection helper that returns nothing would make every assertion
    // below pass perfectly.
    expect(declaredTables().length).toBeGreaterThan(20);
  });

  it('declares no column the migrated database does not have', async () => {
    const { rows } = await conn.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
    );
    const actual = new Map<string, Set<string>>();
    for (const r of rows) {
      const set = actual.get(r.table_name) ?? new Set<string>();
      set.add(r.column_name);
      actual.set(r.table_name, set);
    }

    // Named, not counted: "3 columns differ" tells the next person nothing
    // about which table they are looking for.
    const phantom: string[] = [];
    for (const table of declaredTables()) {
      const real = actual.get(table.name);
      if (!real) {
        phantom.push(`${table.name}: the ORM declares this table and no migration creates it`);
        continue;
      }
      for (const column of table.columns) {
        if (!real.has(column)) phantom.push(`${table.name}.${column}`);
      }
    }
    expect(phantom).toEqual([]);
  });

  it('has a declaration for every column the migrations create', async () => {
    // The other direction. A column added by a migration and never declared is
    // invisible to every typed query — which is how `rate_budget` shipped in
    // 0024 with no schema entry at all, unnoticed until something tried to read
    // the balance it had just spent (0083 T7).
    const { rows } = await conn.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
    );
    const declared = new Map(declaredTables().map((t) => [t.name, new Set(t.columns)]));

    const undeclared: string[] = [];
    for (const r of rows) {
      // Only tables the ORM claims to model. `schema_migrations` is the
      // migrator's own bookkeeping and has no business in the schema file.
      const columns = declared.get(r.table_name);
      if (!columns) continue;
      const key = `${r.table_name}.${r.column_name}`;
      if (!columns.has(r.column_name) && !(key in UNDECLARED_ON_PURPOSE)) undeclared.push(key);
    }
    expect(undeclared).toEqual([]);
  });

  it('still has every deliberately-undeclared column, so the list stays honest', async () => {
    // If one of these is later declared, the allow-list entry has to go too —
    // otherwise it silently starts covering nothing, and the next person reads
    // an exception that no longer exists as a rule that still applies.
    const { rows } = await conn.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
    );
    const real = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
    const declared = new Map(declaredTables().map((t) => [t.name, new Set(t.columns)]));

    for (const key of Object.keys(UNDECLARED_ON_PURPOSE)) {
      expect(real.has(key), `${key}: allow-listed but no longer in the database`).toBe(true);
      const [table, column] = key.split('.');
      expect(
        declared.get(table!)?.has(column!),
        `${key}: now declared — remove it from UNDECLARED_ON_PURPOSE`,
      ).toBe(false);
    }
  });

  it('puts billed_to_name on invoice and NOT on usage_metric', async () => {
    // The specific bug, pinned by name. The checks above would catch it, but a
    // regression should fail with the sentence that explains it rather than as
    // one line in a list.
    const invoice = declaredTables().find((t) => t.name === 'invoice');
    const usage = declaredTables().find((t) => t.name === 'usage_metric');
    expect(invoice?.columns).toContain('billed_to_name');
    expect(usage?.columns).not.toContain('billed_to_name');
  });
});
