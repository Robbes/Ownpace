// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A COPY LEFT AFTER THE SWITCH (the owner's decision of 2026-11-23, option
 * (b): "2) b."; ADR-0055 decision 6; ledger migration 0075).
 *
 * Past a data type's cutover, a copy whose source changed after the switch,
 * and for which an address change is due, is never rewritten: not by a pass
 * and not by the press ("Stop overwriting", ADR-0048). The pass records it as
 * left (`item.address_left_at`) with the change it waits for, and every SQL
 * reader counts it apart, never as waiting: the pass's own count
 * (`countAddressChanges`), verification's (`leftKeys`), the confirmed list's
 * row (`left`) and the completion report's (`left`). Against a real database,
 * because each claim is about what a statement reads or writes.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import * as schemaPg from './schema-pg.ts';
import { createPgDb, type PgDatabase } from './db.ts';
import { ConfirmationStore } from './confirmation-store.ts';
import { createLedgerVerificationReader } from './verification-queries.ts';
import { PgLedger } from './ledger.ts';
import { readAddressChangesForReport } from './path-phases.ts';
import { addressKey, asTenantId, asMappingId } from '@openmig/shared';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests require Testcontainers to be running. ' +
      'Run: pnpm test:integration',
  );
}

// Namespace 0168f0c2 for this file.
const TENANT = asTenantId('0168f0c2-e29b-41d4-a716-446655440001' as never);
const MAPPING = asMappingId('0168f0c2-e29b-41d4-a716-446655440002' as never);
const RECORDED = 'a'.repeat(64);
const DUE = 'b'.repeat(64);

describe('a copy left after the switch, read from the ledger (integration)', () => {
  let db: PgDatabase;

  beforeAll(async () => {
    db = createPgDb(PG_CONNECTION_STRING);
    await db.execute(sql`
      INSERT INTO tenant (id, name, status) VALUES (${TENANT}, 'Left Tenant', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
    const sourceConnId = '0168f0c2-e29b-41d4-a716-446655440011';
    const targetConnId = '0168f0c2-e29b-41d4-a716-446655440012';
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
    const sourceMailboxId = '0168f0c2-e29b-41d4-a716-446655440021';
    const targetMailboxId = '0168f0c2-e29b-41d4-a716-446655440022';
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
    // Three copies that wait for a change, all with a strong version: one
    // that truly waits, one with no version, and one a pass will leave.
    for (const [key, version] of [
      ['waits', '"v1"'],
      ['unguarded', null],
      ['left', '"v1"'],
    ] as const) {
      await db.execute(sql`
        INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash,
                          content_hash, status, target_ref, target_version, address_digest, address_digest_due)
        VALUES (${TENANT}, ${MAPPING}, 'contact', '/book/', ${key}, ${key}, ${`c-${key}`}, 'copied',
                ${JSON.stringify({ id: key })}::jsonb, ${version}, ${RECORDED}, ${DUE})
      `);
    }
    // As the pass past the switch marks it: the change due, and left.
    await new PgLedger(db).markAddressChangeDue(TENANT, MAPPING, 'contact', 'left', DUE, true);
  });

  const leftAt = async (key: string): Promise<Date | null> => {
    const [row] = await db
      .select({ at: schemaPg.item.addressLeftAt })
      .from(schemaPg.item)
      .where(and(eq(schemaPg.item.tenantId, TENANT), eq(schemaPg.item.naturalKeyHash, key)));
    return row?.at ?? null;
  };

  it('records when a pass left it, keeps the first time, and reads it back as left', async () => {
    const first = await leftAt('left');
    expect(first).not.toBeNull();
    const ledger = new PgLedger(db);
    await ledger.markAddressChangeDue(TENANT, MAPPING, 'contact', 'left', DUE, true);
    expect(await leftAt('left')).toEqual(first);
    expect((await ledger.find(TENANT, MAPPING, 'contact', 'left'))?.addressLeft).toBe(true);
    expect((await ledger.find(TENANT, MAPPING, 'contact', 'waits'))?.addressLeft).toBeUndefined();
  });

  it('clears it when the copy is no longer left, or nothing is due', async () => {
    const ledger = new PgLedger(db);
    await ledger.markAddressChangeDue(TENANT, MAPPING, 'contact', 'left', DUE);
    expect(await leftAt('left')).toBeNull();
    await ledger.markAddressChangeDue(TENANT, MAPPING, 'contact', 'left', DUE, true);
    await ledger.markAddressChangeDue(TENANT, MAPPING, 'contact', 'left', null, true);
    expect(await leftAt('left')).toBeNull();
  });

  it('is counted apart by the pass: neither waiting nor unguarded', async () => {
    const counted = await new PgLedger(db).countAddressChanges(TENANT, MAPPING, 'contact');
    expect(counted).toEqual({ changed: 0, waiting: 1, unguarded: 1, left: 1 });
  });

  it('is named apart to verification, as leftKeys', async () => {
    const answer = await createLedgerVerificationReader({ db }).addressChangesOf!(TENANT, MAPPING, 'contact');
    expect([...answer.olderKeys].sort()).toEqual(['left', 'unguarded', 'waits']);
    expect(answer.unguardedKeys).toEqual(['unguarded']);
    expect(answer.leftKeys).toEqual(['left']);
    expect(answer.waitsFor).toBe('pass');
  });

  it('says nothing waits when the only copy waiting is left', async () => {
    await db.execute(sql`DELETE FROM item WHERE tenant_id = ${TENANT} AND natural_key_hash IN ('waits', 'unguarded')`);
    const answer = await createLedgerVerificationReader({ db }).addressChangesOf!(TENANT, MAPPING, 'contact');
    expect(answer.leftKeys).toEqual(['left']);
    expect(answer.waitsFor).toBeUndefined();
  });

  it('is marked left on the confirmed list, the others by what they wait for', async () => {
    const rows = await new ConfirmationStore(db).rowsFor({
      tenantId: TENANT,
      mappingId: MAPPING,
      addressWaitsFor: () => 'press',
    });
    const said = Object.fromEntries(rows.map((r) => [r.naturalKey, r.waitsFor]));
    expect(said).toEqual({ waits: 'press', unguarded: 'unguarded', left: 'left' });
  });

  it('is counted apart in the completion report', async () => {
    const report = await readAddressChangesForReport(db, TENANT, MAPPING);
    expect(report.byDomain).toEqual([
      { domain: 'contact', changed: 0, older: 3, unguarded: 1, left: 1, waitsFor: 'pass' },
    ]);
  });
});
