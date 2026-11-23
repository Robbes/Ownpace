// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A COPY NO PASS CHANGES (workplan 0168 S1, and its finding on the way).
 *
 * A copy an address change waits for, with no version on the target that can
 * guard the write (none, empty, or weak), is left as it is by every pass and
 * every press. The confirmed list and verification said it waited for the
 * next pass all the same. Both readers now read `target_version` and say it
 * apart: the list's row as `unguarded`, verification's as `unguardedKeys`.
 * Against a real database, because both claims are about what a SELECT reads.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createPgDb, type PgDatabase } from './db.ts';
import { ConfirmationStore } from './confirmation-store.ts';
import { createLedgerVerificationReader } from './verification-queries.ts';
import { addressKey, asTenantId, asMappingId } from '@openmig/shared';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests require Testcontainers to be running. ' +
      'Run: pnpm test:integration',
  );
}

// Namespace 0168f0c1 for this file.
const TENANT = asTenantId('0168f0c1-e29b-41d4-a716-446655440001' as never);
const MAPPING = asMappingId('0168f0c1-e29b-41d4-a716-446655440002' as never);
const RECORDED = 'a'.repeat(64);
const DUE = 'b'.repeat(64);

describe('a copy no pass changes, read from the ledger (integration)', () => {
  let db: PgDatabase;

  beforeAll(async () => {
    db = createPgDb(PG_CONNECTION_STRING);
    await db.execute(sql`
      INSERT INTO tenant (id, name, status) VALUES (${TENANT}, 'Unguarded Tenant', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
    const sourceConnId = '0168f0c1-e29b-41d4-a716-446655440011';
    const targetConnId = '0168f0c1-e29b-41d4-a716-446655440012';
    await db.execute(sql`
      INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
      VALUES (${sourceConnId}, ${TENANT}, 'source', 'o365', 'Source', '{}', 'connected')
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
      VALUES (${targetConnId}, ${TENANT}, 'target', 'imap', 'Target', '{}', 'connected')
      ON CONFLICT (id) DO NOTHING
    `);
    const sourceMailboxId = '0168f0c1-e29b-41d4-a716-446655440021';
    const targetMailboxId = '0168f0c1-e29b-41d4-a716-446655440022';
    await db.execute(sql`
      INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, display_name, status)
      VALUES (${sourceMailboxId}, ${TENANT}, ${sourceConnId}, 'src@example.com', 'user', 'Src', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, display_name, status)
      VALUES (${targetMailboxId}, ${TENANT}, ${targetConnId}, 'dst@example.com', 'user', 'Dst', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
      VALUES (${MAPPING}, ${TENANT}, ${sourceMailboxId}, ${targetMailboxId}, 'mirror', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
  });

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM item WHERE tenant_id = ${TENANT}`);
    await db.execute(sql`DELETE FROM address_change WHERE tenant_id = ${TENANT}`);
    const oldAddress = 'ben@old.example.org';
    await db.execute(sql`
      INSERT INTO address_change (tenant_id, old_key, old_address, new_address, state, set_by, confirmed_at, confirmed_by)
      VALUES (${TENANT}, ${addressKey(oldAddress)}, ${oldAddress}, 'ben@example.org', 'confirmed', 'admin', now(), 'admin')
    `);
    // Four copies that wait for a change: a strong version, none, an empty
    // one and a weak one. Only the first can be rewritten.
    for (const [key, version] of [
      ['strong', '"v1"'],
      ['none', null],
      ['empty', ''],
      ['weak', 'W/v1'],
    ] as const) {
      await db.execute(sql`
        INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash,
                          content_hash, status, target_ref, target_version, address_digest, address_digest_due)
        VALUES (${TENANT}, ${MAPPING}, 'contact', '/book/', ${key}, ${key}, ${`c-${key}`}, 'copied',
                ${JSON.stringify({ id: key })}::jsonb, ${version}, ${RECORDED}, ${DUE})
      `);
    }
  });

  it('marks each copy with no strong version unguarded in the confirmed list, the strong one by what it waits for', async () => {
    const store = new ConfirmationStore(db);
    const rows = await store.rowsFor({ tenantId: TENANT, mappingId: MAPPING, addressWaitsFor: () => 'pass' });
    const said = Object.fromEntries(rows.map((r) => [r.naturalKey, r.waitsFor]));
    expect(said).toEqual({ strong: 'pass', none: 'unguarded', empty: 'unguarded', weak: 'unguarded' });
    expect(rows.every((r) => r.address === 'older')).toBe(true);
  });

  it('names the same copies as unguardedKeys to verification', async () => {
    const reader = createLedgerVerificationReader({ db });
    const answer = await reader.addressChangesOf!(TENANT, MAPPING, 'contact');
    expect([...answer.olderKeys].sort()).toEqual(['empty', 'none', 'strong', 'weak']);
    expect([...(answer.unguardedKeys ?? [])].sort()).toEqual(['empty', 'none', 'weak']);
    expect(answer.waitsFor).toBe('pass');
  });

  it('says what nothing waits for when every copy is unguarded', async () => {
    await db.execute(sql`DELETE FROM item WHERE tenant_id = ${TENANT} AND natural_key_hash = 'strong'`);
    const reader = createLedgerVerificationReader({ db });
    const answer = await reader.addressChangesOf!(TENANT, MAPPING, 'contact');
    expect(answer.unguardedKeys?.length).toBe(3);
    expect(answer.waitsFor).toBeUndefined();
  });
});
