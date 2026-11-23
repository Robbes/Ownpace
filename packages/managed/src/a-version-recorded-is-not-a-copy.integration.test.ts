// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A VERSION RECORDED IS NOT A COPY (workplan 0168, found on the way).
 *
 * A row written before the version column holds no source version. The next
 * pass that lists the item unchanged records one (`record-version`): no fetch
 * and nothing written to the target. It did so with `recordUpdate`, which sets
 * `last_synced_at = now()`, and the usage meter reads that column as the
 * copy's last write (`coalesce(last_synced_at, first_seen_at)`), so the item
 * counted again, in that month, at its whole size.
 *
 * `recordSourceVersion` writes that column and `updated_at`, nothing else.
 * Against a real database, because the claim is about one SET list.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createPgDb, type PgDatabase } from '@openmig/ledger/db';
import { PgLedger } from '@openmig/ledger';
import { asTenantId, asMappingId, type LedgerRecord } from '@openmig/shared';
import { deriveStorageAndEgressForPeriod } from './usage-metering.ts';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests require Testcontainers to be running. ' +
      'Run: pnpm test:integration',
  );
}

// Namespace 0168f0c0 for this file.
const TENANT = asTenantId('0168f0c0-e29b-41d4-a716-446655440001' as never);
const MAPPING = asMappingId('0168f0c0-e29b-41d4-a716-446655440002' as never);

describe('PgLedger records a source version without a copy (integration)', () => {
  let db: PgDatabase;
  let ledger: PgLedger;

  beforeAll(async () => {
    db = createPgDb(PG_CONNECTION_STRING);
    ledger = new PgLedger(db);
    await db.execute(sql`
      INSERT INTO tenant (id, name, status) VALUES (${TENANT}, 'Version Tenant', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
    const sourceConnId = '0168f0c0-e29b-41d4-a716-446655440011';
    const targetConnId = '0168f0c0-e29b-41d4-a716-446655440012';
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
    const sourceMailboxId = '0168f0c0-e29b-41d4-a716-446655440021';
    const targetMailboxId = '0168f0c0-e29b-41d4-a716-446655440022';
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
  });

  /** A contact copied in an earlier month, its row from before the version column. */
  async function oldCopy(): Promise<void> {
    const row: LedgerRecord = {
      tenantId: TENANT,
      mappingId: MAPPING,
      itemType: 'contact',
      naturalKeyHash: 'card-1',
      contentHash: 'c1',
      targetId: 'card-1.vcf',
      createdAt: new Date().toISOString(),
      sizeBytes: 4096,
      status: 'copied',
    } as LedgerRecord;
    await ledger.recordIfAbsent(row);
    await db.execute(sql`
      UPDATE item SET first_seen_at = '2020-01-15T10:00:00Z', last_synced_at = NULL
      WHERE tenant_id = ${TENANT} AND natural_key_hash = 'card-1'
    `);
  }

  const thisMonth = () => {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)] as const;
  };

  it('writes the version and leaves the copy’s last write where it was', async () => {
    await oldCopy();
    await ledger.recordSourceVersion(TENANT, MAPPING, 'contact', 'card-1', '"etag-1"');
    const rows = await db.execute<{ source_version: string | null; last_synced_at: Date | null; status: string }>(sql`
      SELECT source_version, last_synced_at, status FROM item
      WHERE tenant_id = ${TENANT} AND natural_key_hash = 'card-1'
    `);
    const row = rows.rows[0]!;
    expect(row.source_version).toBe('"etag-1"');
    expect(row.last_synced_at).toBeNull();
    expect(row.status).toBe('copied');
  });

  it('is not metered as another copy this month, as recordUpdate was', async () => {
    await oldCopy();
    const [from, until] = thisMonth();
    await ledger.recordSourceVersion(TENANT, MAPPING, 'contact', 'card-1', '"etag-1"');
    const after = await deriveStorageAndEgressForPeriod(db, TENANT, from, until);
    expect(after.storageBytes).toBe(0);

    // What `record-version` did before: the same item, metered again.
    const [known] = await Promise.all([ledger.find(TENANT, MAPPING, 'contact', 'card-1')]);
    await ledger.recordUpdate({ ...known!, sourceVersion: '"etag-1"' });
    const before = await deriveStorageAndEgressForPeriod(db, TENANT, from, until);
    expect(before.storageBytes).toBe(4096);
  });
});
