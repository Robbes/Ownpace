// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FIRST COPY ON THE BILLING SCREEN (2026-09-29).
 *
 * The Billing screen's Storage and Data transfer tiles come from
 * `deriveStorageAndEgressForPeriod`, which read the `item` rows whose
 * `last_synced_at` fell in the period. Only the re-copy path writes that
 * column (`PgLedger.recordUpdate`); a first copy (`recordIfAbsent`) stamps
 * `first_seen_at` and leaves it NULL. So the tiles counted re-copies and never
 * a first copy: an organisation that had copied hundreds of GB saw about 0 GB
 * there. The metering integration test inserts rows with `lastSyncedAt` set by
 * hand, so it never met a row as the ledger writes one.
 *
 * What this holds, through the real ledger on PGlite as the appliance runs it:
 *
 *  - a first copy counts in the month it was made;
 *  - a re-copied file counts once, at its latest size, in the month of the
 *    re-copy and not in the month of its first copy;
 *  - a failed item, and one adopted from what was already on the target,
 *    moved nothing and count nothing;
 *  - a month before any copy holds none of them, and another organisation's
 *    copies are not counted.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pgliteDriver, runMigrations, withTenant, PgLedger } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import type { LedgerRecord, MappingId, TenantId } from '@openmig/shared';
import { deriveStorageAndEgressForPeriod, getUsageMetricsForPeriod, monthPeriod } from './usage-metering.ts';

// UUID family 1f5c0000-…, unused elsewhere in the repo.
const TENANT = '1f5c0000-e29b-41d4-a716-446655442001' as TenantId;
const OTHER = '1f5c0000-e29b-41d4-a716-446655442002' as TenantId;
const MAPPING = '1f5c0000-e29b-41d4-a716-446655442031' as MappingId;
const OTHERS_MAPPING = '1f5c0000-e29b-41d4-a716-446655442032' as MappingId;

const MB = 1_000_000;

let driver: LedgerDriver;

function file(key: string, sizeBytes: number, over: Partial<LedgerRecord> = {}): LedgerRecord {
  return {
    tenantId: TENANT,
    mappingId: MAPPING,
    itemType: 'file',
    naturalKeyHash: key,
    naturalKey: `Photos/${key}.jpg`,
    contentHash: `h:${key}`,
    targetId: `target/${key}`,
    createdAt: new Date().toISOString(),
    collection: 'Photos',
    sourceVersion: 'v1',
    sizeBytes,
    status: 'copied',
    ...over,
  };
}

const ledgerOf = <T>(tenant: TenantId, fn: (ledger: PgLedger) => Promise<T>): Promise<T> =>
  withTenant(driver, tenant, async (db) => fn(new PgLedger(db)));

const thisMonth = () => monthPeriod(new Date().toISOString().slice(0, 7));

function lastMonth() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return monthPeriod(d.toISOString().slice(0, 7));
}

const meter = (tenant: TenantId, period: { periodStart: string; periodEnd: string }) =>
  withTenant(driver, tenant, (db) =>
    deriveStorageAndEgressForPeriod(db, tenant, period.periodStart, period.periodEnd),
  );

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  const conn = await driver.acquire();
  try {
    const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
    for (const [tenant, mapping, n] of [
      [TENANT, MAPPING, 1],
      [OTHER, OTHERS_MAPPING, 2],
    ] as const) {
      const connection = `1f5c0000-e29b-41d4-a716-44665544201${n}`;
      const box = `1f5c0000-e29b-41d4-a716-44665544202${n}`;
      await q('INSERT INTO tenant (id, name) VALUES ($1,$2)', [tenant, `Organisation ${n}`]);
      await q(
        `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
         VALUES ($1,$2,'source','dropbox','d','{}'::jsonb,'connected')`,
        [connection, tenant],
      );
      await q(
        `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
         VALUES ($1,$2,$3,'user','d@example.invalid')`,
        [box, tenant, connection],
      );
      await q(
        `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status)
         VALUES ($1,$2,$3,'active')`,
        [mapping, tenant, box],
      );
    }
  } finally {
    await conn.release();
  }

  await ledgerOf(TENANT, async (ledger) => {
    // Two first copies, as every pass writes one.
    await ledger.recordIfAbsent(file('first-a', 3 * MB));
    await ledger.recordIfAbsent(file('first-b', 4 * MB));
    // A first copy, then a re-copy of an edited file, at its new size.
    await ledger.recordIfAbsent(file('edited', 1 * MB));
    await ledger.recordUpdate(file('edited', 2 * MB, { sourceVersion: 'v2', status: 'updated' }));
    // A first copy that stays one.
    await ledger.recordIfAbsent(file('older', 5 * MB));
    // Nothing moved for these two.
    await ledger.recordIfAbsent(file('adopted', 50 * MB, { status: 'adopted' }));
    await ledger.recordFailure(file('failed', 70 * MB, { status: 'failed' }), 'PUT failed with status 507');
  });
  await ledgerOf(OTHER, (ledger) =>
    ledger.recordIfAbsent(file('theirs', 90 * MB, { tenantId: OTHER, mappingId: OTHERS_MAPPING })),
  );
  // The edited file and the older one were first copied a month ago; the
  // edited file's re-copy is this month's.
  const owner = await driver.acquire();
  try {
    await owner.query(
      `UPDATE item SET first_seen_at = first_seen_at - interval '1 month'
        WHERE mapping_id = $1 AND natural_key_hash IN ('edited', 'older')`,
      [MAPPING],
    );
  } finally {
    await owner.release();
  }
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

describe('the month a copy was made counts it', () => {
  it('first copies and a re-copy, and nothing that moved nothing', async () => {
    const usage = await meter(TENANT, thisMonth());

    // 3 + 4 first copied, and the edited file re-copied at its latest 2.
    expect(usage.storageBytes).toBe(9 * MB);
    expect(usage.egressBytes).toBe(9 * MB);
  });

  it("last month's first copy in last month, and a re-copied file only where it was last written", async () => {
    const usage = await meter(TENANT, lastMonth());

    expect(usage.storageBytes).toBe(5 * MB);
  });

  it('as the Billing screen reads it', async () => {
    const { periodStart, periodEnd } = thisMonth();
    const metrics = await withTenant(driver, TENANT, (db) =>
      getUsageMetricsForPeriod(db, TENANT, periodStart, periodEnd),
    );

    expect(metrics.storageBytes).toBe(9 * MB);
  });
});

describe('what it does not count', () => {
  it('a month before any copy holds none of them', async () => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - 2);
    const usage = await meter(TENANT, monthPeriod(d.toISOString().slice(0, 7)));

    expect(usage.storageBytes).toBe(0);
  });

  it("another organisation's copies", async () => {
    const theirs = await meter(OTHER, thisMonth());

    expect(theirs.storageBytes).toBe(90 * MB);
    expect((await meter(TENANT, thisMonth())).storageBytes).toBe(9 * MB);
  });
});
