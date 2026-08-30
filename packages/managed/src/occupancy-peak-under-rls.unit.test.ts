// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The month remembers its peak, and nothing can make it forget (managed
 * migration 0015; workplan 0109 T2).
 *
 * The recorder's SQL only raises, but a peak that can fall is not a peak
 * whatever the writer intends — so the arms here hold the SCHEMA to it, the
 * way 0014 holds the invoice:
 *
 * - the store records what the transaction sees, `paused` counted (it holds
 *   a slot — the one rule `holdsASlot` owns);
 * - a tie leaves the row alone, so `peak_at` stays the date the mark was SET;
 * - the trigger refuses a lowering FOR THE OWNER TOO — "the grants don't
 *   apply to me" is exactly the hole a trigger closes;
 * - the row's identity (tenant, month) is frozen;
 * - `app_user` cannot DELETE (no grant), tenants cannot see or write each
 *   other's rows (RLS both directions);
 * - a month cell that is not a month refuses (CHECK), zero slots record
 *   nothing, and the reader answers the month or null.
 *
 * UUID family 01920000-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import type { TenantId } from '@openmig/shared';
import { runManagedMigrations } from './migrate-managed.ts';
import { PgOccupancyPeakStore } from './occupancy-peak.ts';

const TENANT_A = '01920000-e29b-41d4-a716-446655442001';
const TENANT_B = '01920000-e29b-41d4-a716-446655442002';
const CONN_A = '01920000-e29b-41d4-a716-446655442051';
const BOX_A = '01920000-e29b-41d4-a716-446655442071';
const MAPPING_A = '01920000-e29b-41d4-a716-446655442101';

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
    await conn.query('DELETE FROM occupancy_peak');
    await conn.query('DELETE FROM path_lifecycle');
    await conn.query('DELETE FROM tenant');
    await conn.query(`INSERT INTO tenant (id, name, status) VALUES ($1,'A','active'), ($2,'B','active')`, [
      TENANT_A,
      TENANT_B,
    ]);
    // path_lifecycle references its mapping, so the fixture carries the real
    // chain: connection → mailbox → mapping (the offboarding fixture's shape).
    await conn.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name)
       VALUES ($1,$2,'source','imap','i')`,
      [CONN_A, TENANT_A],
    );
    await conn.query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, external_id)
       VALUES ($1,$2,$3,'box-a')`,
      [BOX_A, TENANT_A, CONN_A],
    );
    await conn.query(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status)
       VALUES ($1,$2,$3,'active')`,
      [MAPPING_A, TENANT_A, BOX_A],
    );
    // Slot-holders for A: two active, one paused. `paused` holds a slot
    // (ADR-0014's counter-intuitive rule), so the store must count 3.
    await conn.query(
      `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at)
       VALUES ($1,$2,'email','active',now()),
              ($1,$2,'calendar','active',now()),
              ($1,$2,'contact','paused',now())`,
      [TENANT_A, MAPPING_A],
    );
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

async function record(tenant: string, at?: Date): Promise<void> {
  await withTenant(driver, tenant, async (db) =>
    new PgOccupancyPeakStore(db).recordCurrentOccupancy(tenant as TenantId, at),
  );
}

interface PeakRow {
  tenant_id: string;
  month: string;
  peak_paths: number;
  peak_at: string;
}
async function rowsOf(tenant: string): Promise<PeakRow[]> {
  const conn = await driver.acquire();
  try {
    const { rows } = await conn.query<PeakRow>(
      'SELECT tenant_id, month, peak_paths, peak_at FROM occupancy_peak WHERE tenant_id = $1',
      [tenant],
    );
    return rows;
  } finally {
    conn.release();
  }
}

describe('the store records what the transaction sees', () => {
  it('counts paused as held — three slots, one row, this month', async () => {
    await record(TENANT_A);
    const rows = await rowsOf(TENANT_A);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.peak_paths).toBe(3);
    // The driver hands `date` back as a JS Date; first-of-month in UTC.
    expect(new Date(rows[0]?.month ?? 0).getUTCDate()).toBe(1);
  });

  it('a tie leaves the row alone — peak_at stays the date the mark was set', async () => {
    await record(TENANT_A, new Date('2026-08-12T10:00:00Z'));
    const [set] = await rowsOf(TENANT_A);
    await record(TENANT_A, new Date('2026-08-20T10:00:00Z'));
    expect(await rowsOf(TENANT_A)).toEqual([set]);
  });

  it('a genuine rise moves both the number and the date', async () => {
    await record(TENANT_A, new Date('2026-08-12T10:00:00Z'));
    const conn = await driver.acquire();
    try {
      await conn.query(
        `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at)
         VALUES ($1,$2,'file','active',now())`,
        [TENANT_A, MAPPING_A],
      );
    } finally {
      conn.release();
    }
    await record(TENANT_A, new Date('2026-08-20T10:00:00Z'));
    const [row] = await rowsOf(TENANT_A);
    expect(row?.peak_paths).toBe(4);
    expect(new Date(row?.peak_at ?? 0).toISOString()).toBe('2026-08-20T10:00:00.000Z');
  });

  it('zero slots record nothing — an empty month is told by absence', async () => {
    const conn = await driver.acquire();
    try {
      await conn.query('DELETE FROM path_lifecycle');
    } finally {
      conn.release();
    }
    await record(TENANT_A);
    expect(await rowsOf(TENANT_A)).toEqual([]);
  });
});

describe('the trigger refuses, for every role', () => {
  it('a peak never falls — even for the owner', async () => {
    await record(TENANT_A);
    const conn = await driver.acquire();
    try {
      await expect(
        conn.query('UPDATE occupancy_peak SET peak_paths = 1 WHERE tenant_id = $1', [TENANT_A]),
      ).rejects.toThrow(/a peak never falls/);
    } finally {
      conn.release();
    }
  });

  it('the identity of a row is frozen — the month cannot be moved', async () => {
    await record(TENANT_A);
    const conn = await driver.acquire();
    try {
      await expect(
        conn.query(
          `UPDATE occupancy_peak SET month = (month - interval '1 month')::date WHERE tenant_id = $1`,
          [TENANT_A],
        ),
      ).rejects.toThrow(/identity of a peak row is frozen/);
    } finally {
      conn.release();
    }
  });
});

describe('grants and isolation', () => {
  it('app_user cannot DELETE a peak', async () => {
    await record(TENANT_A);
    const refusal = await refusalOf(
      withTenant(driver, TENANT_A, async (db) =>
        db.execute(sql`DELETE FROM occupancy_peak WHERE tenant_id = ${TENANT_A}`),
      ),
    );
    expect(refusal).toMatch(/permission denied/);
  });

  it("tenant B sees nothing of A's, and cannot write into A", async () => {
    await record(TENANT_A);
    const seen = await withTenant(driver, TENANT_B, async (db) =>
      db.execute(sql`SELECT * FROM occupancy_peak`),
    );
    expect((seen as { rows: unknown[] }).rows).toEqual([]);
    const refusal = await refusalOf(
      withTenant(driver, TENANT_B, async (db) =>
        db.execute(
          sql`INSERT INTO occupancy_peak (tenant_id, month, peak_paths, peak_at)
              VALUES (${TENANT_A}, '2026-08-01', 9, now())`,
        ),
      ),
    );
    expect(refusal).toMatch(/row-level security|violates row-level/i);
  });
});

describe('the shape the schema itself pins', () => {
  it('a month cell that is not a month refuses', async () => {
    const conn = await driver.acquire();
    try {
      await expect(
        conn.query(
          `INSERT INTO occupancy_peak (tenant_id, month, peak_paths, peak_at)
           VALUES ($1, '2026-08-12', 2, now())`,
          [TENANT_A],
        ),
      ).rejects.toThrow(/occupancy_peak_month_check/);
    } finally {
      conn.release();
    }
  });

  it('the reader answers the month, and null where nothing raised the mark', async () => {
    await record(TENANT_A, new Date('2026-08-12T10:00:00Z'));
    const found = await withTenant(driver, TENANT_A, async (db) =>
      new PgOccupancyPeakStore(db).forMonth(TENANT_A as TenantId, new Date('2026-08-25T00:00:00Z')),
    );
    expect(found?.peakPaths).toBe(3);
    expect(found?.peakAt).toBe('2026-08-12T10:00:00.000Z');
    const before = await withTenant(driver, TENANT_A, async (db) =>
      new PgOccupancyPeakStore(db).forMonth(TENANT_A as TenantId, new Date('2026-07-25T00:00:00Z')),
    );
    expect(before).toBeNull();
  });
});
