// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A ROW THAT SAYS WHAT WAS DECIDED (workplan 0159 §6 item 6), over a real
 * database.
 *
 * The SQL half of the contract `packages/core/src/a-row-that-says-what-was-decided.unit.test.ts`
 * pins over `MemoryLedger`, and the half that matters: what tells an applied
 * RELOCATION from an applied DELETION is a comparison of two timestamps that
 * `applyRelocation` writes from one `now()`, and a fake does not run `now()`.
 * A row whose move was closed by that write says `relocated` on Deletions,
 * never `applied`: its item is on the new system under its new name, and
 * *deleted on the new system too* would say the opposite.
 *
 * Its PGlite twin beside it (`a-row-that-says-what-was-decided.unit.test.ts`)
 * runs the same scenarios in the unit gate, on the appliance's in-process
 * backend.
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

// Namespace 0159d6e0 for this file: fixtures that share ids delete each
// other's rows in `beforeEach`.
const TENANT = asTenantId('0159d6e0-e29b-41d4-a716-446655440001' as never);
const MAPPING = asMappingId('0159d6e0-e29b-41d4-a716-446655440002' as never);

function copied(naturalKeyHash: string, contentHash: string): LedgerRecord {
  return {
    tenantId: TENANT,
    mappingId: MAPPING,
    itemType: 'file',
    naturalKeyHash,
    contentHash,
    targetId: `t-${naturalKeyHash}`,
    createdAt: new Date().toISOString(),
    sizeBytes: 10,
    status: 'copied',
    collection: 'Docs',
  };
}

describe('a decided row says what was decided (PgLedger, integration)', () => {
  let db: PgDatabase;
  let ledger: PgLedger;

  beforeAll(async () => {
    db = createPgDb(PG_CONNECTION_STRING);
    ledger = new PgLedger(db);

    await db.execute(sql`
      INSERT INTO tenant (id, name, status)
      VALUES (${TENANT}, 'Decided Row Tenant', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
    const sourceConnId = '0159d6e0-e29b-41d4-a716-446655440011';
    const targetConnId = '0159d6e0-e29b-41d4-a716-446655440012';
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
    const sourceMailboxId = '0159d6e0-e29b-41d4-a716-446655440021';
    const targetMailboxId = '0159d6e0-e29b-41d4-a716-446655440022';
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
    await db.execute(sql`
      INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
      VALUES (${MAPPING}, ${TENANT}, ${sourceMailboxId}, ${targetMailboxId}, 'mirror', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
  });

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM item WHERE tenant_id = ${TENANT}`);
  });

  /** A file renamed on the old system: the old row, and its arrival. */
  async function renamed(old: string): Promise<void> {
    await ledger.recordIfAbsent(copied(old, `bytes-${old}`));
    await ledger.recordIfAbsent(copied(`${old}-new`, `bytes-${old}`));
    await ledger.recordMove(TENANT, MAPPING, 'file', old, 'Docs', `${old}-new`);
  }

  /** A file the old system reported deleted. */
  async function reported(key: string): Promise<void> {
    await ledger.recordIfAbsent(copied(key, `bytes-${key}`));
    await ledger.recordReportedDeletion(TENANT, MAPPING, 'file', key);
  }

  const deletionOf = async (key: string) =>
    (await ledger.listDeletions(TENANT, MAPPING)).find((d) => d.naturalKeyHash === key);
  const moveOf = async (key: string) =>
    (await ledger.listMoves(TENANT, MAPPING)).find((m) => m.naturalKeyHash === key);

  it('a kept deletion says kept', async () => {
    await reported('kept');
    expect(await ledger.resolveDeletion(TENANT, MAPPING, 'kept', 'keep')).toBe(true);

    expect(await deletionOf('kept')).toMatchObject({ decided: 'kept' });
  });

  it('a deletion carried out on the new system says applied', async () => {
    await reported('deleted');
    expect(await ledger.applyDeletion(TENANT, MAPPING, 'file', 'deleted')).toBe(true);

    expect(await deletionOf('deleted')).toMatchObject({ decided: 'applied' });
  });

  it('the old copy of a renamed file, removed, says relocated on Deletions and applied on Moves', async () => {
    await renamed('moved');
    await ledger.recordReportedDeletion(TENANT, MAPPING, 'file', 'moved');
    expect(await ledger.applyRelocation(TENANT, MAPPING, 'file', 'moved')).toBe(true);

    expect(await deletionOf('moved')).toMatchObject({ decided: 'relocated' });
    expect(await moveOf('moved')).toMatchObject({ decided: 'applied' });
  });

  it('a deletion kept, and the old copy then removed through Moves, says relocated', async () => {
    // The other order: Deletions answered first. The relocation re-closes the
    // deletion entry with its own time, and the removal is still a renamed
    // item's old copy, so the row is never called kept or deleted after it.
    await renamed('kr');
    await ledger.recordReportedDeletion(TENANT, MAPPING, 'file', 'kr');
    expect(await ledger.resolveDeletion(TENANT, MAPPING, 'kr', 'keep')).toBe(true);
    expect(await deletionOf('kr')).toMatchObject({ decided: 'kept' });

    expect(await ledger.applyRelocation(TENANT, MAPPING, 'file', 'kr')).toBe(true);

    expect(await deletionOf('kr')).toMatchObject({ decided: 'relocated' });
    expect(await moveOf('kr')).toMatchObject({ decided: 'applied' });
  });

  it('a renamed file removed through Deletions says applied there, and its move stays open', async () => {
    await renamed('both');
    await ledger.recordReportedDeletion(TENANT, MAPPING, 'file', 'both');
    expect(await ledger.applyDeletion(TENANT, MAPPING, 'file', 'both')).toBe(true);

    expect(await deletionOf('both')).toMatchObject({ decided: 'applied' });
    const move = await moveOf('both');
    expect(move?.acknowledgedAt).toBeUndefined();
    expect(move?.decided).toBeUndefined();
  });

  it('a removed copy whose move was answered afterwards still says applied, not relocated', async () => {
    // The same row, its move then left where it is: the move closes LATER
    // than the removal, in a write of its own, so the times differ and the
    // removal stays the deletion's. (Moves says applied too: the old copy is
    // gone from the new system, whichever answer closed the move.)
    await renamed('later');
    await ledger.recordReportedDeletion(TENANT, MAPPING, 'file', 'later');
    expect(await ledger.applyDeletion(TENANT, MAPPING, 'file', 'later')).toBe(true);
    expect(await ledger.resolveMove(TENANT, MAPPING, 'later', 'keep')).toBe(true);

    expect(await deletionOf('later')).toMatchObject({ decided: 'applied' });
    expect(await moveOf('later')).toMatchObject({ decided: 'applied' });
  });

  it('a move left where it is says kept', async () => {
    await renamed('left');
    expect(await ledger.resolveMove(TENANT, MAPPING, 'left', 'keep')).toBe(true);

    expect(await moveOf('left')).toMatchObject({ decided: 'kept' });
  });

  it('an open row says nothing: nothing has been decided', async () => {
    await reported('open-deletion');
    await renamed('open-move');

    const deletion = await deletionOf('open-deletion');
    expect(deletion?.acknowledgedAt).toBeUndefined();
    expect(deletion).not.toHaveProperty('decided');
    const move = await moveOf('open-move');
    expect(move?.acknowledgedAt).toBeUndefined();
    expect(move).not.toHaveProperty('decided');
  });
});
