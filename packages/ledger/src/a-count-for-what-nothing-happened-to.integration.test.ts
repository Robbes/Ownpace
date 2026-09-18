// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * COUNTING WHAT WE DELIBERATELY DID NOT WRITE (workplan 0124 T2).
 *
 * The migration page could report copies, failures, retries and decisions, and
 * had no word for the items hard rule 2 protects by doing nothing to them. This
 * is the query behind that word, and these guards are about it counting the
 * right rows and — the half that is easy to get wrong — being ABSENT rather
 * than zero for a domain with none.
 *
 * Integration rather than unit, because the behaviour under test is the SQL:
 * the `GROUP BY` is what produces the absence, and a fake would produce
 * whatever its author believed.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createPgDb, type PgDatabase } from './db.ts';
import { PgLedger } from './ledger.ts';
import { asTenantId, asMappingId, type LedgerRecord } from '@openmig/shared';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests require Testcontainers to be running. ' +
      'Run: pnpm test:integration',
  );
}

// Namespace 7b41 for this file, per the convention the other ledger
// integration tests follow: fixtures that share ids delete each other's rows in
// `beforeEach` and fail in whichever order vitest happens to pick.
const TENANT = asTenantId('7b410000-e29b-41d4-a716-446655440001' as never);
const MAPPING = asMappingId('7b410000-e29b-41d4-a716-446655440002' as never);
const OTHER_MAPPING = asMappingId('7b410000-e29b-41d4-a716-446655440003' as never);

describe('PgLedger counts what was left as it was (integration)', () => {
  let db: PgDatabase;
  let ledger: PgLedger;

  beforeAll(async () => {
    db = createPgDb(PG_CONNECTION_STRING);
    ledger = new PgLedger(db);

    await db.execute(sql`
      INSERT INTO tenant (id, name, status)
      VALUES (${TENANT}, 'Adopted Count Tenant', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
    const sourceConnId = '7b410000-e29b-41d4-a716-446655440011';
    const targetConnId = '7b410000-e29b-41d4-a716-446655440012';
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
    const sourceMailboxId = '7b410000-e29b-41d4-a716-446655440021';
    const targetMailboxId = '7b410000-e29b-41d4-a716-446655440022';
    await db.execute(sql`
      INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, display_name, status)
      VALUES (${sourceMailboxId}, ${TENANT}, ${sourceConnId}, 'src@dev.local', 'user', 'Src', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, display_name, status)
      VALUES (${targetMailboxId}, ${TENANT}, ${targetConnId}, 'dst@dev.local', 'user', 'Dst', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
    // The second mapping needs its OWN target prefix: `mailbox_mapping` is
    // unique on (source_mailbox_id, target_mailbox_id, COALESCE(prefix, '')),
    // so two mappings over the same pair of mailboxes are refused by the
    // database. Found by running this against a real Postgres rather than in
    // CI, which is the whole reason this file is an integration test.
    await db.execute(sql`
      INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
      VALUES (${MAPPING}, ${TENANT}, ${sourceMailboxId}, ${targetMailboxId}, 'mirror', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO mailbox_mapping
        (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status, target_folder_prefix)
      VALUES (${OTHER_MAPPING}, ${TENANT}, ${sourceMailboxId}, ${targetMailboxId}, 'mirror', 'active', 'Other')
      ON CONFLICT (id) DO NOTHING
    `);
  });

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM item WHERE tenant_id = ${TENANT}`);
  });

  const write = (
    naturalKeyHash: string,
    status: LedgerRecord['status'],
    itemType: LedgerRecord['itemType'] = 'contact',
    mappingId = MAPPING,
  ): Promise<LedgerRecord> =>
    ledger.recordIfAbsent({
      tenantId: TENANT,
      mappingId,
      itemType,
      naturalKeyHash,
      contentHash: `c-${naturalKeyHash}`,
      targetId: `t-${naturalKeyHash}`,
      createdAt: new Date().toISOString(),
      sizeBytes: 0,
      status,
    } as LedgerRecord);

  it('counts the adopted rows, per domain', async () => {
    await write('a1', 'adopted');
    await write('a2', 'adopted');
    await write('f1', 'adopted', 'file');
    expect(await ledger.countAdoptedByDomain(TENANT, MAPPING)).toEqual({ contact: 2, file: 1 });
  });

  /**
   * ONE COUNT FOR BOTH KINDS, because the ledger has one status for them and
   * cannot tell them apart afterwards: an item the target already held, and one
   * we wrote that has since been edited there — the second is recorded by
   * REWRITING the first's status, which is precisely why no split is possible.
   * A test that expected two numbers would be asking for a distinction the
   * column cannot carry.
   */
  it('does not distinguish adopted-at-first-sight from adopted-by-conflict', async () => {
    await write('already-there', 'adopted');
    const ours = await write('ours', 'copied');
    await ledger.recordUpdate({ ...ours, status: 'adopted' } as LedgerRecord);
    expect(await ledger.countAdoptedByDomain(TENANT, MAPPING)).toEqual({ contact: 2 });
  });

  /**
   * THE ABSENCE IS THE POINT. A domain with nothing adopted produces no key,
   * so a caller can tell it from a domain nobody counted — and a screen can
   * stay silent instead of claiming none were left behind (hard rule 9).
   */
  it('omits a domain with nothing adopted, rather than reporting zero', async () => {
    await write('copied1', 'copied');
    await write('failed1', 'failed', 'file');
    const counts = await ledger.countAdoptedByDomain(TENANT, MAPPING);
    expect(counts).toEqual({});
    expect('contact' in counts).toBe(false);
  });

  it('counts no status but adopted', async () => {
    await write('a1', 'adopted');
    await write('c1', 'copied');
    await write('u1', 'updated');
    await write('f1', 'failed');
    await write('l1', 'left_behind');
    expect(await ledger.countAdoptedByDomain(TENANT, MAPPING)).toEqual({ contact: 1 });
  });

  /** And never another migration's, which shares this tenant and these mailboxes. */
  it('counts only this mapping', async () => {
    await write('mine', 'adopted');
    await write('theirs', 'adopted', 'contact', OTHER_MAPPING);
    expect(await ledger.countAdoptedByDomain(TENANT, MAPPING)).toEqual({ contact: 1 });
    expect(await ledger.countAdoptedByDomain(TENANT, OTHER_MAPPING)).toEqual({ contact: 1 });
  });
});
