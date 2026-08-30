// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The data axis never falls, and nothing can make it (managed migration 0016;
 * workplan 0109 T3).
 *
 * The meter prices what a tenant has EVER moved, so the arms here are the
 * 0014/0015 defence-in-depth set: the store accumulates in one statement and
 * refuses to write noise (zero, negative, NaN); the trigger refuses a
 * lowering FOR THE OWNER TOO and freezes the row's identity; `app_user`
 * cannot DELETE; tenants cannot see or write each other's meters; and the
 * reader answers 0 for a tenant that never moved anything — absence is the
 * honest empty state, never a zero row.
 *
 * UUID family 01930000-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import type { TenantId } from '@openmig/shared';
import { runManagedMigrations } from './migrate-managed.ts';
import { PgBytesMovedStore } from './bytes-moved.ts';

const TENANT_A = '01930000-e29b-41d4-a716-446655442001';
const TENANT_B = '01930000-e29b-41d4-a716-446655442002';

let driver: LedgerDriver;

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  const conn = await driver.acquire();
  try {
    await conn.query('DELETE FROM bytes_moved');
    await conn.query('DELETE FROM tenant');
    await conn.query(`INSERT INTO tenant (id, name, status) VALUES ($1,'A','active'), ($2,'B','active')`, [
      TENANT_A,
      TENANT_B,
    ]);
  } finally {
    conn.release();
  }
});

/** Drizzle wraps PG errors; walk the cause chain to the database's sentence. */
async function refusalOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const messages: string[] = [];
    let current: unknown = error;
    while (current) {
      messages.push(current instanceof Error ? current.message : String(current));
      current = current instanceof Error ? current.cause : undefined;
    }
    return messages.join(' :: ');
  }
  throw new Error('expected the statement to be refused, and it was not');
}

async function add(tenant: string, bytes: number): Promise<void> {
  await withTenant(driver, tenant, async (db) =>
    new PgBytesMovedStore(db).add(tenant as TenantId, bytes),
  );
}

async function total(tenant: string): Promise<bigint> {
  return withTenant(driver, tenant, async (db) =>
    new PgBytesMovedStore(db).total(tenant as TenantId),
  );
}

describe('the store accumulates, and refuses to write noise', () => {
  it('adds are one statement each and sum across passes', async () => {
    await add(TENANT_A, 100);
    await add(TENANT_A, 250);
    expect(await total(TENANT_A)).toBe(350n);
  });

  it('zero, negative and non-finite add nothing and create no row', async () => {
    await add(TENANT_A, 0);
    await add(TENANT_A, -5);
    await add(TENANT_A, Number.NaN);
    const conn = await driver.acquire();
    try {
      const { rows } = await conn.query('SELECT count(*)::int AS n FROM bytes_moved');
      expect((rows[0] as { n: number }).n).toBe(0);
    } finally {
      conn.release();
    }
    expect(await total(TENANT_A)).toBe(0n);
  });

  it('a fractional count is truncated, never rounded up', async () => {
    await add(TENANT_A, 10.9);
    expect(await total(TENANT_A)).toBe(10n);
  });

  it('a tenant that never moved anything reads 0, from no row', async () => {
    expect(await total(TENANT_A)).toBe(0n);
  });
});

describe('the trigger refuses, for every role', () => {
  it('the meter never falls — even for the owner', async () => {
    await add(TENANT_A, 500);
    const conn = await driver.acquire();
    try {
      await expect(
        conn.query('UPDATE bytes_moved SET bytes = 1 WHERE tenant_id = $1', [TENANT_A]),
      ).rejects.toThrow(/the data axis never falls/);
    } finally {
      conn.release();
    }
  });

  it("the row's identity is frozen", async () => {
    await add(TENANT_A, 500);
    const conn = await driver.acquire();
    try {
      await expect(
        conn.query('UPDATE bytes_moved SET tenant_id = $2 WHERE tenant_id = $1', [
          TENANT_A,
          TENANT_B,
        ]),
      ).rejects.toThrow(/identity of a meter row is frozen/);
    } finally {
      conn.release();
    }
  });
});

describe('grants and isolation', () => {
  it('app_user cannot DELETE the meter', async () => {
    await add(TENANT_A, 500);
    const refusal = await refusalOf(
      withTenant(driver, TENANT_A, async (db) =>
        db.execute(sql`DELETE FROM bytes_moved WHERE tenant_id = ${TENANT_A}`),
      ),
    );
    expect(refusal).toMatch(/permission denied/);
  });

  it("tenant B sees nothing of A's, and cannot write into A", async () => {
    await add(TENANT_A, 500);
    expect(await total(TENANT_B)).toBe(0n);
    const seen = await withTenant(driver, TENANT_B, async (db) =>
      db.execute(sql`SELECT * FROM bytes_moved`),
    );
    expect((seen as { rows: unknown[] }).rows).toEqual([]);
    const refusal = await refusalOf(
      withTenant(driver, TENANT_B, async (db) =>
        db.execute(
          sql`INSERT INTO bytes_moved (tenant_id, bytes) VALUES (${TENANT_A}, 9)`,
        ),
      ),
    );
    expect(refusal).toMatch(/row-level security|violates row-level/i);
  });
});
