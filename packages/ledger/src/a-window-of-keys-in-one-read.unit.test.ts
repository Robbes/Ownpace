// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A WINDOW OF KEYS IN ONE READ (2026-09-29).
 *
 * The pass asks the ledger about the items a listing is about to reach a
 * window at a time (`ledgerReadAhead` in `@openmig/core`), through
 * `PgLedger.findMany`, where it used to ask with one `find` per item: one
 * transaction each on a managed stack, about 11 ms per file already copied
 * on the owner's Dropbox.
 *
 * What this holds, on PGlite as the appliance runs it:
 *
 *  - every key with a row comes back, as the row `find` returns for it;
 *  - a key with no row, a row of another data type or another migration, and
 *    a row of another organisation are not in the answer;
 *  - no keys is an empty answer, and a key asked twice is answered once.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pgliteDriver, runMigrations, withTenant, PgLedger } from './index.ts';
import type { LedgerDriver } from './index.ts';
import type { DiscoveryDomain, LedgerRecord, MappingId, TenantId } from '@openmig/shared';

const TENANT = '0f1a0000-e29b-41d4-a716-446655440001' as TenantId;
const OTHER_TENANT = '0f1a0000-e29b-41d4-a716-446655440002' as TenantId;
const MAPPING = '0f1a0000-e29b-41d4-a716-446655440031' as MappingId;
const OTHER_MAPPING = '0f1a0000-e29b-41d4-a716-446655440032' as MappingId;
const OTHER_TENANTS_MAPPING = '0f1a0000-e29b-41d4-a716-446655440033' as MappingId;

let driver: LedgerDriver;

function copied(
  naturalKeyHash: string,
  over: Partial<LedgerRecord> & { itemType?: DiscoveryDomain } = {},
): LedgerRecord {
  return {
    tenantId: TENANT,
    mappingId: MAPPING,
    itemType: 'file',
    naturalKeyHash,
    naturalKey: `Work/${naturalKeyHash}.txt`,
    contentHash: `h:${naturalKeyHash}`,
    targetId: `target/${naturalKeyHash}`,
    createdAt: new Date().toISOString(),
    collection: 'Work',
    sourceVersion: 'v1',
    sizeBytes: 12,
    status: 'copied',
    ...over,
  };
}

const ledgerOf = <T>(tenant: TenantId, fn: (ledger: PgLedger) => Promise<T>): Promise<T> =>
  withTenant(driver, tenant, async (db) => fn(new PgLedger(db)));

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  const conn = await driver.acquire();
  try {
    const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
    for (const [tenant, mappings, n] of [
      [TENANT, [MAPPING, OTHER_MAPPING], 1],
      [OTHER_TENANT, [OTHER_TENANTS_MAPPING], 2],
    ] as const) {
      const conn_ = `0f1a0000-e29b-41d4-a716-44665544001${n}`;
      const box = `0f1a0000-e29b-41d4-a716-44665544002${n}`;
      await q('INSERT INTO tenant (id, name) VALUES ($1,$2)', [tenant, `organisation ${n}`]);
      await q(
        `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
         VALUES ($1,$2,'source','dropbox','d','{}'::jsonb,'connected')`,
        [conn_, tenant],
      );
      await q(
        `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
         VALUES ($1,$2,$3,'user','d@example.invalid')`,
        [box, tenant, conn_],
      );
      for (const mapping of mappings) {
        await q(
          `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status)
           VALUES ($1,$2,$3,'active')`,
          [mapping, tenant, box],
        );
      }
    }
  } finally {
    await conn.release();
  }

  await ledgerOf(TENANT, async (ledger) => {
    for (const key of ['a', 'b', 'c']) await ledger.recordIfAbsent(copied(key));
    await ledger.recordIfAbsent(copied('a-contact', { itemType: 'contact' }));
    await ledger.recordIfAbsent(copied('elsewhere', { mappingId: OTHER_MAPPING }));
    await ledger.recordFailure(copied('d', { status: 'failed' }), 'PUT failed with status 507');
  });
  await ledgerOf(OTHER_TENANT, (ledger) =>
    ledger.recordIfAbsent(copied('theirs', { tenantId: OTHER_TENANT, mappingId: OTHER_TENANTS_MAPPING })),
  );
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

describe('a window of keys, read in one statement', () => {
  it('answers every key with a row, as find answers it', async () => {
    const { many, one } = await ledgerOf(TENANT, async (ledger) => ({
      many: await ledger.findMany(TENANT, MAPPING, 'file', ['a', 'b', 'c', 'd']),
      one: await Promise.all(['a', 'b', 'c', 'd'].map((k) => ledger.find(TENANT, MAPPING, 'file', k))),
    }));

    expect([...many.keys()].sort()).toEqual(['a', 'b', 'c', 'd']);
    for (const row of one) expect(many.get(row!.naturalKeyHash)).toEqual(row);
    expect(many.get('d')?.status).toBe('failed');
  });

  it('leaves out a key with no row, another data type, another migration and another organisation', async () => {
    const many = await ledgerOf(TENANT, (ledger) =>
      ledger.findMany(TENANT, MAPPING, 'file', ['a', 'nothing', 'a-contact', 'elsewhere', 'theirs']),
    );

    expect([...many.keys()]).toEqual(['a']);
  });

  it('answers no keys with nothing, and a key asked twice once', async () => {
    const { none, twice } = await ledgerOf(TENANT, async (ledger) => ({
      none: await ledger.findMany(TENANT, MAPPING, 'file', []),
      twice: await ledger.findMany(TENANT, MAPPING, 'file', ['b', 'b']),
    }));

    expect(none.size).toBe(0);
    expect([...twice.keys()]).toEqual(['b']);
  });
});
