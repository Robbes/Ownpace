// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE ADDRESS TABLE, READ FROM A REAL LEDGER (workplan 0168 T4, T5, D5;
 * ADR-0055), on PGlite with both chains' shared migrations applied:
 *
 *  - `item.address_digest` round-trips through `PgLedger`, and a NULL said on
 *    a rewrite is written;
 *  - the confirmed list names the table's digest and counts the copies
 *    changed under it and under an older one, and an older one is never a
 *    match;
 *  - the verification reader says the same, with the older keys;
 *  - a press of *Apply the new addresses here too* records the table's press
 *    digest, which the phases every pass reads hand back;
 *  - the completion report's counts come from the same rows.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  PgLedger,
  applyNewAddressesHere,
  createLedgerVerificationReader,
  createPgliteDb,
  readAddressChangesForReport,
  readPathPhases,
  runMigrations,
  withTenant,
  type LedgerConnection,
  type LedgerDriver,
} from '@openmig/ledger';
import {
  addressKey,
  addressTableDigest,
  addressTablePressDigest,
  type MappingId,
  type TenantId,
} from '@openmig/shared';
import { readConfirmedList } from './confirmed-list-read.ts';

// UUID family 0168…, unused elsewhere in the repo.
const TENANT = '01680000-e29b-41d4-a716-446655440001' as TenantId;
const MAPPING = '01680000-e29b-41d4-a716-446655440002' as MappingId;
const CONN = '01680000-e29b-41d4-a716-446655440003';
const SRC = '01680000-e29b-41d4-a716-446655440004';
const DST = '01680000-e29b-41d4-a716-446655440005';

let driver: LedgerDriver;

async function q(sql: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
  const conn: LedgerConnection = await driver.acquire();
  try {
    return await conn.query(sql, params);
  } finally {
    conn.release();
  }
}

const ROWS = [
  { oldKey: addressKey('ana@old.example.org'), oldAddress: 'ana@old.example.org', newAddress: 'ana@example.org' },
  { oldKey: addressKey('ben@old.example.org'), oldAddress: 'ben@old.example.org', newAddress: 'ben@example.org' },
];
const NOW = addressTableDigest(ROWS)!;
const OLDER = addressTableDigest(ROWS.slice(0, 1))!;

beforeAll(async () => {
  driver = (await createPgliteDb({})).driver;
  await runMigrations({ driver, logger: () => {} });
  await q(`INSERT INTO tenant (id, name, status) VALUES ($1, 'Address table read', 'active')`, [TENANT]);
  await q(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
     VALUES ($1,$2,'source','carddav','t','{}'::jsonb,'connected')`,
    [CONN, TENANT],
  );
  for (const [id, addr] of [
    [SRC, 'src@example.org'],
    [DST, 'dst@example.org'],
  ]) {
    await q(
      `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, primary_address, display_name, status)
       VALUES ($1,$2,$3,$4,'user',$4,$4,'active')`,
      [id, TENANT, CONN, addr],
    );
  }
  await q(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
     VALUES ($1,$2,$3,$4,'mirror','active')`,
    [MAPPING, TENANT, SRC, DST],
  );
  for (const r of ROWS) {
    await q(
      `INSERT INTO address_change (tenant_id, old_key, old_address, new_address, state, set_by, confirmed_by, confirmed_at)
       VALUES ($1,$2,$3,$4,'confirmed','operator','operator',now())`,
      [TENANT, r.oldKey, r.oldAddress, r.newAddress],
    );
  }
  // A proposed row: never read by anything that writes or judges a copy.
  await q(
    `INSERT INTO address_change (tenant_id, old_key, old_address, new_address, state, set_by)
     VALUES ($1,'carla@old.example.org','carla@old.example.org','carla@example.org','proposed','operator')`,
    [TENANT],
  );
  // Three contacts the target answered as matching: one changed under the
  // table now, one under an older table, one the table never touched.
  for (const [key, digest] of [
    ['k-now', NOW],
    ['k-older', OLDER],
    ['k-none', null],
  ] as const) {
    await q(
      `INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash,
                         content_hash, status, confirmed_answer, confirmed_at, address_digest)
       VALUES ($1,$2,'contact','/book/',$3,$3,'card1:x','copied','match',now(),$4)`,
      [TENANT, MAPPING, key, digest],
    );
  }
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe('the address table in a real ledger', () => {
  it('reads only the confirmed rows, sorted by old key', async () => {
    const rows = await withTenant(driver, TENANT, (db) => new PgLedger(db).listConfirmedAddressChanges(TENANT));
    expect(rows).toEqual(ROWS);
  });

  it('round-trips item.address_digest, and writes a NULL a rewrite says', async () => {
    await withTenant(driver, TENANT, async (db) => {
      const ledger = new PgLedger(db);
      const row = (await ledger.find(TENANT, MAPPING, 'contact', 'k-older'))!;
      expect(row.addressDigest).toBe(OLDER);
      // A record that says nothing keeps the column.
      await ledger.recordUpdate({ ...row, addressDigest: undefined });
      expect((await ledger.find(TENANT, MAPPING, 'contact', 'k-older'))!.addressDigest).toBe(OLDER);
      // A rewrite after the row left the table says null, and null is written.
      await ledger.recordUpdate({ ...row, addressDigest: null });
      expect((await ledger.find(TENANT, MAPPING, 'contact', 'k-older'))!.addressDigest).toBeUndefined();
      await ledger.recordUpdate({ ...row, addressDigest: OLDER });
    });
  });

  it('names the digest on the confirmed list, counts both kinds, and never calls an older one a match', async () => {
    const list = await readConfirmedList({ source: driver, tenantId: TENANT, mappingId: MAPPING }, 'active' as never);
    expect(list.addressChanges).toEqual({ digest: NOW, changed: 1, older: 1 });
    expect(list.verified).toBe(2);
    expect(list.rows.map((r) => [r.naturalKey, r.state, r.address])).toEqual([['k-older', 'differs', 'older']]);
  });

  it('gives verification the same account, with the older keys', async () => {
    const answer = await withTenant(driver, TENANT, (db) =>
      createLedgerVerificationReader({ db }).addressChangesOf(TENANT, MAPPING, 'contact'),
    );
    expect(answer).toEqual({ digest: NOW, changed: 1, olderKeys: ['k-older'] });
  });

  it('records a press of Apply the new addresses here too, and the phases a pass reads hand it back', async () => {
    const before = await withTenant(driver, TENANT, (db) => readPathPhases(db, TENANT, MAPPING));
    expect(before?.addressChangesApplied).toBeUndefined();
    const pressed = await withTenant(driver, TENANT, (db) => applyNewAddressesHere(db, TENANT, MAPPING, 'operator'));
    expect(pressed).toEqual({ digest: addressTablePressDigest(ROWS), rows: 2 });
    const after = await withTenant(driver, TENANT, (db) => readPathPhases(db, TENANT, MAPPING));
    expect(after?.addressChangesApplied).toBe(NOW);
    // Another organisation's migration is not found.
    const elsewhere = await withTenant(driver, TENANT, (db) =>
      applyNewAddressesHere(db, TENANT, '01680000-e29b-41d4-a716-4466554400ff', 'operator'),
    );
    expect(elsewhere).toBeNull();
  });

  it('counts the completion report’s Addresses changed from the same rows', async () => {
    const counted = await withTenant(driver, TENANT, (db) => readAddressChangesForReport(db, TENANT, MAPPING));
    expect(counted).toEqual({ rows: 2, digest: NOW, byDomain: [{ domain: 'contact', changed: 1, older: 1 }] });
  });
});
