// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DELETION THE OWNER KEPT IS NEVER APPLIED (2026-11-22; ADR-0024), over a
 * real database.
 *
 * The Postgres twin of `a-deletion-the-owner-kept.unit.test.ts` (PGlite), the
 * same cases in the same order. Core's `applyDeletion` over this ledger
 * refuses a kept row before anything is sent to the target; a keep that lands
 * while a removal is already under way cannot stop it, and
 * `PgLedger.applyDeletion` records the removal as what it was, tombstoned and
 * applied, with the keep's own time kept (`COALESCE`). Every statement here
 * commits on its own, so a keep can land between core's read and the write,
 * as it can for a real press. It connects as the superuser CI's integration
 * job uses, so row security is not what it tests; the PGlite twin runs as
 * `app_user`.
 *
 * UUID family ad24ce02-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { applyDeletion, evaluateApplyDeletion } from '@openmig/core';
import { asTenantId, asMappingId, type LedgerRecord, type RemovalResult } from '@openmig/shared';
import { createPgDb, type PgDatabase } from './db.ts';
import { PgLedger } from './ledger.ts';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests require Testcontainers to be running. ' +
      'Run: pnpm test:integration',
  );
}

const TENANT = asTenantId('ad24ce02-e29b-41d4-a716-446655440001' as never);
const MAPPING = asMappingId('ad24ce02-e29b-41d4-a716-446655440002' as never);

function copied(naturalKeyHash: string): LedgerRecord {
  return {
    tenantId: TENANT,
    mappingId: MAPPING,
    itemType: 'calendar',
    naturalKeyHash,
    contentHash: `bytes-${naturalKeyHash}`,
    targetId: `t-${naturalKeyHash}`,
    targetVersion: `"v-${naturalKeyHash}"`,
    createdAt: new Date().toISOString(),
    sizeBytes: 10,
    status: 'copied',
    collection: 'Personal',
  };
}

/** A target that removes; `during` runs inside the removal, as a concurrent change would. */
function remover(during?: () => Promise<void>) {
  return {
    removeItem: vi.fn(async (): Promise<RemovalResult> => {
      await during?.();
      return { kind: 'deleted' };
    }),
  };
}

describe('a deletion the owner kept is never applied (PgLedger, integration)', () => {
  let db: PgDatabase;
  let ledger: PgLedger;

  beforeAll(async () => {
    db = createPgDb(PG_CONNECTION_STRING);
    ledger = new PgLedger(db);

    await db.execute(sql`
      INSERT INTO tenant (id, name, status)
      VALUES (${TENANT}, 'Kept Deletion Tenant', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
    const sourceConnId = 'ad24ce02-e29b-41d4-a716-446655440011';
    const targetConnId = 'ad24ce02-e29b-41d4-a716-446655440012';
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
    const sourceMailboxId = 'ad24ce02-e29b-41d4-a716-446655440021';
    const targetMailboxId = 'ad24ce02-e29b-41d4-a716-446655440022';
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

  /** An event the old system reported deleted. */
  async function reported(key: string): Promise<void> {
    await ledger.recordIfAbsent(copied(key));
    await ledger.recordReportedDeletion(TENANT, MAPPING, 'calendar', key);
  }

  const keep = (key: string) => ledger.resolveDeletion(TENANT, MAPPING, key, 'keep');
  const record = (key: string) => ledger.applyDeletion(TENANT, MAPPING, 'calendar', key);
  const deletionOf = async (key: string) =>
    (await ledger.listDeletions(TENANT, MAPPING)).find((d) => d.naturalKeyHash === key);
  const rowOf = (key: string) => ledger.find(TENANT, MAPPING, 'calendar', key);
  const deps = (target: unknown) => ({
    tenantId: TENANT,
    mappingId: MAPPING,
    domain: 'calendar' as const,
    ledger,
    target,
    stillTheAuthority: async () => true,
  });

  /** A keep, its time as written, and a pause, so a later write is measurably later. */
  async function keepNow(key: string): Promise<string | undefined> {
    expect(await keep(key)).toBe(true);
    const keptAt = (await rowOf(key))?.deletionAcknowledgedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return keptAt;
  }

  it('a removal recorded after a keep says removed, and keeps the keep’s time', async () => {
    await reported('kept');
    const keptAt = await keepNow('kept');

    // What a removal already under way writes once its copy is gone.
    expect(await record('kept')).toBe(true);

    expect(await deletionOf('kept')).toMatchObject({ decided: 'applied' });
    const row = await rowOf('kept');
    expect(row?.status).toBe('tombstoned');
    expect(row?.deletionAppliedAt).toBeDefined();
    expect(keptAt).toBeDefined();
    expect(row?.deletionAcknowledgedAt).toBe(keptAt);
  });

  it('an open entry is still recorded once, and a second write on it records nothing', async () => {
    await reported('open');
    expect(await record('open')).toBe(true);
    expect(await record('open')).toBe(false);
    expect(await deletionOf('open')).toMatchObject({ decided: 'applied' });
  });

  it("core's press over this ledger refuses a kept row, and asks nothing of the target", async () => {
    await reported('pressed');
    expect(await keep('pressed')).toBe(true);
    const target = remover();

    expect(await evaluateApplyDeletion(deps(undefined), 'pressed')).toMatchObject({
      ok: false,
      code: 'already_kept',
    });
    expect(await applyDeletion(deps(target), 'pressed')).toMatchObject({ ok: false, code: 'already_kept' });

    expect(target.removeItem).not.toHaveBeenCalled();
    expect(await deletionOf('pressed')).toMatchObject({ decided: 'kept' });
  });

  it('a keep that lands while the removal is under way cannot stop it: the press answers deleted, and the row says removed', async () => {
    await reported('raced');
    let keptAt: string | undefined;
    const target = remover(async () => {
      keptAt = await keepNow('raced');
    });

    expect(await applyDeletion(deps(target), 'raced')).toEqual({ ok: true, kind: 'deleted' });

    // The copy was removed first, and the row says what happened.
    expect(target.removeItem).toHaveBeenCalledTimes(1);
    expect(await deletionOf('raced')).toMatchObject({ decided: 'applied' });
    const row = await rowOf('raced');
    expect(row?.status).toBe('tombstoned');
    expect(keptAt).toBeDefined();
    expect(row?.deletionAcknowledgedAt).toBe(keptAt);
  });

  describe('a keep given to an earlier export ends when the copy is current again (workplan 0164)', () => {
    const file = (key: string): LedgerRecord => ({ ...copied(key), itemType: 'file', collection: 'Docs' });
    const fileDeps = (target: unknown) => ({ ...deps(target), domain: 'file' as const });

    it('a later deletion of it is offered, and a press removes it', async () => {
      await ledger.recordIfAbsent(file('report-docx'));
      await ledger.markEarlierExports(TENANT, MAPPING, 'file', [
        { formerNaturalKeyHash: 'report-docx', naturalKeyHash: 'report-odt' },
      ]);
      expect(await keep('report-docx'), 'kept as an earlier export').toBe(true);

      // The format is switched back: its name is a current name again.
      await ledger.clearEarlierExport(TENANT, MAPPING, 'file', 'report-docx');
      expect((await ledger.find(TENANT, MAPPING, 'file', 'report-docx'))?.deletionAcknowledgedAt).toBeUndefined();

      // Then deleted at the old system.
      await ledger.recordReportedDeletion(TENANT, MAPPING, 'file', 'report-docx');
      const row = await deletionOf('report-docx');
      expect(row).toMatchObject({ evidence: 'reported' });
      expect(row?.acknowledgedAt).toBeUndefined();
      const target = remover();
      expect(await applyDeletion(fileDeps(target), 'report-docx')).toEqual({ ok: true, kind: 'deleted' });
      expect(target.removeItem).toHaveBeenCalledTimes(1);
    });

    it('a keep on a row that is not an earlier export stays', async () => {
      await ledger.recordIfAbsent(file('kept-docx'));
      await ledger.recordReportedDeletion(TENANT, MAPPING, 'file', 'kept-docx');
      expect(await keep('kept-docx')).toBe(true);

      await ledger.clearEarlierExport(TENANT, MAPPING, 'file', 'kept-docx');

      expect(await deletionOf('kept-docx')).toMatchObject({ decided: 'kept' });
    });
  });
});
