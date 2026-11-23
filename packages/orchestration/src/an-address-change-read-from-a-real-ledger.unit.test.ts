// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE ADDRESS TABLE, READ FROM A REAL LEDGER (workplan 0168 T4, T5, D5;
 * ADR-0055), on PGlite with both chains' shared migrations applied:
 *
 *  - `item.address_digest` round-trips through `PgLedger`, and a NULL said on
 *    a rewrite is written; so does `item.address_digest_due` (ledger 0074),
 *    and the pass's narrow mark moves that column alone;
 *  - the confirmed list names the table's digest and counts the copies that
 *    carry a change and those a change waits for (S3), and one a change waits
 *    for is never a match, a copy written with no change included;
 *  - the verification reader says the same, with the older keys;
 *  - the ledger counts them for the pass, split by whether a version guards
 *    the write (S1, S5);
 *  - a press of *Apply the new addresses here too* records the table's press
 *    digest, which the phases every pass reads hand back, and past a cutover
 *    a waiting copy waits for the press until one covers the table;
 *  - the completion report's counts come from the same rows.
 *
 * A copy's digest is its own since S4, so "older" is the pass's mark, not a
 * digest that differs from the table's (as this file's first version had it).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  PgLedger,
  applyNewAddressesHere,
  createLedgerVerificationReader,
  createPgliteDb,
  readAddressChangeWaitsFor,
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
// What each copy records since S4: the digest of the rows that decided it.
const ANA_ONLY = addressTableDigest(ROWS.slice(0, 1))!;
const BEN_ONLY = addressTableDigest(ROWS.slice(1))!;

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
  // Contacts the target answered as matching: one that carries Ana's change
  // as the table says; one a pass found should carry Ben's row too (waiting,
  // with a strong version); one written with no change before Ben's row came
  // for an address it names (waiting, S3's case, with no version: S1); and one
  // the table never touched.
  for (const [key, digest, due, version] of [
    ['k-now', ANA_ONLY, null, '"etag-1"'],
    ['k-older', ANA_ONLY, NOW, '"etag-2"'],
    ['k-never', null, BEN_ONLY, null],
    ['k-none', null, null, '"etag-4"'],
  ] as const) {
    await q(
      `INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash,
                         content_hash, status, confirmed_answer, confirmed_at, address_digest,
                         address_digest_due, target_version)
       VALUES ($1,$2,'contact','/book/',$3,$3,'card1:x','copied','match',now(),$4,$5,$6)`,
      [TENANT, MAPPING, key, digest, due, version],
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

  it('round-trips item.address_digest and its due mark, and writes a NULL a rewrite says', async () => {
    await withTenant(driver, TENANT, async (db) => {
      const ledger = new PgLedger(db);
      const row = (await ledger.find(TENANT, MAPPING, 'contact', 'k-older'))!;
      expect(row.addressDigest).toBe(ANA_ONLY);
      expect(row.addressDigestDue).toBe(NOW);
      // A record that says nothing keeps both columns.
      await ledger.recordUpdate({ ...row, addressDigest: undefined, addressDigestDue: undefined });
      const kept = (await ledger.find(TENANT, MAPPING, 'contact', 'k-older'))!;
      expect([kept.addressDigest, kept.addressDigestDue]).toEqual([ANA_ONLY, NOW]);
      // A rewrite after the row left the table says null, and null is written.
      await ledger.recordUpdate({ ...row, addressDigest: null, addressDigestDue: null });
      const rewritten = (await ledger.find(TENANT, MAPPING, 'contact', 'k-older'))!;
      expect([rewritten.addressDigest, rewritten.addressDigestDue]).toEqual([undefined, undefined]);
      await ledger.recordUpdate({ ...row, addressDigest: ANA_ONLY, addressDigestDue: NOW });
    });
  });

  it('marks what a copy waits for in that column alone, never its last write to the target (S3)', async () => {
    const synced = async () =>
      (await q(`SELECT last_synced_at, address_digest, address_digest_due FROM item WHERE natural_key_hash = 'k-none'`))
        .rows[0];
    const before = await synced();
    await withTenant(driver, TENANT, (db) => new PgLedger(db).markAddressChangeDue(TENANT, MAPPING, 'contact', 'k-none', BEN_ONLY));
    const marked = await synced();
    expect(marked?.address_digest_due).toBe(BEN_ONLY);
    expect(marked?.address_digest).toBeNull();
    expect(marked?.last_synced_at).toEqual(before?.last_synced_at);
    await withTenant(driver, TENANT, (db) => new PgLedger(db).markAddressChangeDue(TENANT, MAPPING, 'contact', 'k-none', null));
    expect((await synced())?.address_digest_due).toBeNull();
  });

  it('names the digest on the confirmed list, counts both kinds, and never calls one a change waits for a match', async () => {
    const list = await readConfirmedList({ source: driver, tenantId: TENANT, mappingId: MAPPING }, 'active' as never);
    // `k-never` has no version to guard the write: counted apart (0168, found
    // on the way), and checked as a plain copy, so it is verified as copied
    // (the owner, 2026-11-23; ADR-0055 decision 5).
    expect(list.addressChanges).toEqual({ digest: NOW, changed: 1, older: 2, unguarded: 1 });
    expect(list.verified).toBe(3);
    // The list's own order is by item id, which the ledger draws at random:
    // read by key.
    const marked = list.rows.map((r) => [r.naturalKey, r.state, r.address, r.waitsFor] as const);
    expect([...marked].sort((a, b) => String(a[0]).localeCompare(String(b[0])))).toEqual([
      ['k-older', 'differs', 'older', 'pass'],
    ]);
  });

  it('gives verification the same account, with the older keys', async () => {
    const answer = await withTenant(driver, TENANT, (db) =>
      createLedgerVerificationReader({ db }).addressChangesOf(TENANT, MAPPING, 'contact'),
    );
    expect({ ...answer, olderKeys: [...answer.olderKeys].sort() }).toEqual({
      digest: NOW,
      changed: 1,
      olderKeys: ['k-never', 'k-older'],
      unguardedKeys: ['k-never'],
      waitsFor: 'pass',
    });
  });

  it('counts them for the pass, apart by whether a version guards the write (S1, S5)', async () => {
    const counted = await withTenant(driver, TENANT, (db) => new PgLedger(db).countAddressChanges(TENANT, MAPPING, 'contact'));
    expect(counted).toEqual({ changed: 1, waiting: 1, unguarded: 1, left: 0 });
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
    expect(counted).toEqual({
      rows: 2,
      digest: NOW,
      byDomain: [{ domain: 'contact', changed: 1, older: 2, unguarded: 1, left: 0, waitsFor: 'pass' }],
    });
  });

  it('past the cutover, says a waiting copy waits for the press until a press covers the table as it is (D5)', async () => {
    const waitsFor = () => withTenant(driver, TENANT, (db) => readAddressChangeWaitsFor(db, TENANT, MAPPING));
    await q(`UPDATE mailbox_mapping SET status = 'cutover' WHERE id = $1`, [MAPPING]);
    try {
      // The press above was for the table as it is: the next pass writes them.
      expect((await waitsFor())('contact')).toBe('pass');
      // The table moves: they wait for a press of their own.
      await q(
        `INSERT INTO address_change (tenant_id, old_key, old_address, new_address, state, set_by, confirmed_by, confirmed_at)
         VALUES ($1,'dora@old.example.org','dora@old.example.org','dora@example.org','confirmed','operator','operator',now())`,
        [TENANT],
      );
      expect((await waitsFor())('contact')).toBe('press');
      const list = await readConfirmedList({ source: driver, tenantId: TENANT, mappingId: MAPPING }, 'cutover' as never);
      // `k-never`, with no version to guard the write, waits for neither
      // (0168), and is verified as copied, so not among the rows sent.
      expect(list.rows.map((r) => r.waitsFor).sort()).toEqual(['press']);
      expect(list.addressChanges?.unguarded).toBe(1);
      await q(`DELETE FROM address_change WHERE tenant_id = $1 AND old_key = 'dora@old.example.org'`, [TENANT]);
      expect((await waitsFor())('contact')).toBe('pass');
    } finally {
      await q(`UPDATE mailbox_mapping SET status = 'active' WHERE id = $1`, [MAPPING]);
    }
  });
});
