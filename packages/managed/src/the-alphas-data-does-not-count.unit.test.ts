// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE ALPHA'S DATA DOES NOT COUNT (managed migration 0040; the owner,
 * 2026-10-04: *"In total for ever, and the alpha's data doesn't count"*).
 *
 * The meter stays the record of everything moved, in total, for ever. What a
 * ceiling, a hold and a tier count is that total less what the alpha moved:
 *  - while the stage is `alpha`, the alpha's share rises with the total, so
 *    nothing moved then counts; after it, only the total rises;
 *  - the rows on the meter before 0040 were all moved during the alpha, and
 *    become the alpha's once;
 *  - the alpha's share never falls and never passes the total, for every
 *    role, or the count would rise by a write nobody made;
 *  - the ceiling and the tier read what counts.
 *
 * UUID family 0109fa00-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import type { TenantId } from '@openmig/shared';
import {
  MANAGED_ADVISORY_LOCK_KEY,
  MANAGED_BOOKKEEPING_TABLE,
  managedMigrationsDir,
  runManagedMigrations,
} from './migrate-managed.ts';
import { PgBytesMovedStore } from './bytes-moved.ts';
import { readCeiling } from './data-ceiling.ts';
import { currentTier } from './tier-calculator.ts';

const TENANT = '0109fa00-e29b-41d4-a716-446655440001';
const GB = 1_000_000_000;

let driver: LedgerDriver;

/** As the owner: PGlite's raw connection bypasses row security, for seeding and probing. */
async function owner(sql: string, params: unknown[] = []) {
  const conn = await driver.acquire();
  try {
    return await conn.query(sql, params);
  } finally {
    conn.release();
  }
}

const add = (bytes: number, inTheAlpha: boolean) =>
  withTenant(driver, TENANT, (db) => new PgBytesMovedStore(db).add(TENANT as TenantId, bytes, { inTheAlpha }));
const meter = () => withTenant(driver, TENANT, (db) => new PgBytesMovedStore(db).read(TENANT as TenantId));

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  // Every managed migration before 0040, so a meter row can exist before it.
  const before = mkdtempSync(join(tmpdir(), 'managed-before-0040-'));
  try {
    for (const file of readdirSync(managedMigrationsDir())) {
      if (file.endsWith('.sql') && file < '0040') cpSync(join(managedMigrationsDir(), file), join(before, file));
    }
    await runMigrations({
      driver,
      logger: () => {},
      migrationsDir: before,
      bookkeepingTable: MANAGED_BOOKKEEPING_TABLE,
      advisoryLockKey: MANAGED_ADVISORY_LOCK_KEY,
    });
  } finally {
    rmSync(before, { recursive: true, force: true });
  }
  await owner(`INSERT INTO tenant (id, name, status) VALUES ($1, 'Jansen thuis', 'active')`, [TENANT]);
  // Moved during the alpha, before 0040 existed: 600 GB.
  await owner('INSERT INTO bytes_moved (tenant_id, bytes) VALUES ($1, $2)', [TENANT, 600 * GB]);
  await runManagedMigrations({ driver, logger: () => {} });
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe('the meter before 0040', () => {
  it('was all moved during the alpha, so none of it counts', async () => {
    expect(await meter()).toEqual({ total: BigInt(600 * GB), inTheAlpha: BigInt(600 * GB), counted: 0n });
  });
});

describe('the meter after 0040', () => {
  beforeEach(async () => {
    await owner('DELETE FROM bytes_moved');
  });

  it('during the alpha, rises in total and counts nothing', async () => {
    await add(100 * GB, true);
    await add(50 * GB, true);
    expect(await meter()).toEqual({ total: BigInt(150 * GB), inTheAlpha: BigInt(150 * GB), counted: 0n });
  });

  it('after the alpha, counts what moves from then on, and the total keeps the alpha', async () => {
    await add(300 * GB, true);
    await add(40 * GB, false);
    expect(await meter()).toEqual({ total: BigInt(340 * GB), inTheAlpha: BigInt(300 * GB), counted: BigInt(40 * GB) });
  });

  it('counts everything for an organisation that first moves after the alpha', async () => {
    await add(10 * GB, false);
    expect(await meter()).toEqual({ total: BigInt(10 * GB), inTheAlpha: 0n, counted: BigInt(10 * GB) });
  });

  it('never lowers the alpha share, for the owner too: the count would rise by a write nobody made', async () => {
    await add(300 * GB, true);
    await expect(owner('UPDATE bytes_moved SET alpha_bytes = 0 WHERE tenant_id = $1', [TENANT])).rejects.toThrow(
      /what the alpha moved never falls/,
    );
  });

  it('never lets the alpha share pass the total', async () => {
    await add(10 * GB, false);
    await expect(
      owner('UPDATE bytes_moved SET alpha_bytes = bytes + 1 WHERE tenant_id = $1', [TENANT]),
    ).rejects.toThrow(/bytes_moved_alpha_bytes_check/);
  });
});

describe('what reads the meter, reads what counts', () => {
  beforeEach(async () => {
    await owner('DELETE FROM bytes_moved');
    // 600 GB in the alpha, 100 GB after.
    await add(600 * GB, true);
    await add(100 * GB, false);
  });

  it('the data ceiling: 100 GB of Free\'s 250 GB, not past it', async () => {
    const c = await withTenant(driver, TENANT, (db) => readCeiling(db, TENANT as TenantId));
    expect(c.gbMoved).toBe(100);
    expect(c.state).toBe('under');
  });

  it('the tier: Free, which 100 GB fits, not Small, which 700 GB would need', async () => {
    const t = await withTenant(driver, TENANT, (db) => currentTier(db, TENANT as TenantId));
    expect(t.evidence.gbMoved).toBe(100);
    expect(t.tier?.id).toBe('free');
  });
});
