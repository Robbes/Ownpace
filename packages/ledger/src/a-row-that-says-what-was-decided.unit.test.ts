// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A ROW THAT SAYS WHAT WAS DECIDED (workplan 0159 §6 item 6), on PGlite.
 *
 * The appliance's in-process database runs the same SQL as the managed
 * service's Postgres, and what tells an applied RELOCATION from an applied
 * DELETION is SQL: two timestamps `applyRelocation` writes from one `now()`,
 * compared to the microsecond, and read back as a boolean. The integration
 * twin (`a-row-that-says-what-was-decided.integration.test.ts`) pins it on
 * Postgres in CI's integration job; this pins it in the unit gate, on the
 * backend an appliance with `SELFHOST_PERSISTENCE=pglite` runs, as `app_user`
 * through the real migrations.
 *
 * The same scenarios as the integration twin, in the same order.
 *
 * UUID family 0159d6e2-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { pgliteDriver, runMigrations, withTenant, PgLedger } from './index.ts';
import type { LedgerDriver } from './index.ts';
import type { LedgerRecord, MappingId, TenantId } from '@openmig/shared';

const TENANT = '0159d6e2-e29b-41d4-a716-446655440001' as TenantId;
const CONN = '0159d6e2-e29b-41d4-a716-446655440011';
const BOX = '0159d6e2-e29b-41d4-a716-446655440021';
const MAPPING = '0159d6e2-e29b-41d4-a716-446655440031' as MappingId;

let driver: LedgerDriver;

const ledger = <T>(run: (l: PgLedger) => Promise<T>) =>
  withTenant(driver, TENANT, async (db) => run(new PgLedger(db)));

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

/** A file renamed on the old system: the old row, and its arrival. */
async function renamed(old: string): Promise<void> {
  await ledger((l) => l.recordIfAbsent(copied(old, `bytes-${old}`)));
  await ledger((l) => l.recordIfAbsent(copied(`${old}-new`, `bytes-${old}`)));
  await ledger((l) => l.recordMove(TENANT, MAPPING, 'file', old, 'Docs', `${old}-new`));
}

/** A file the old system reported deleted. */
async function reported(key: string): Promise<void> {
  await ledger((l) => l.recordIfAbsent(copied(key, `bytes-${key}`)));
  await ledger((l) => l.recordReportedDeletion(TENANT, MAPPING, 'file', key));
}

const reportedToo = (key: string) =>
  ledger((l) => l.recordReportedDeletion(TENANT, MAPPING, 'file', key));
const keepDeletion = (key: string) =>
  ledger((l) => l.resolveDeletion(TENANT, MAPPING, key, 'keep'));
const applyDeletion = (key: string) =>
  ledger((l) => l.applyDeletion(TENANT, MAPPING, 'file', key));
const applyRelocation = (key: string) =>
  ledger((l) => l.applyRelocation(TENANT, MAPPING, 'file', key));
const keepMove = (key: string) => ledger((l) => l.resolveMove(TENANT, MAPPING, key, 'keep'));

const deletionOf = async (key: string) =>
  (await ledger((l) => l.listDeletions(TENANT, MAPPING))).find((d) => d.naturalKeyHash === key);
const moveOf = async (key: string) =>
  (await ledger((l) => l.listMoves(TENANT, MAPPING))).find((m) => m.naturalKeyHash === key);

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  const conn = await driver.acquire();
  try {
    const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
    await q('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'decided']);
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1,$2,'source','google','g','{}'::jsonb,'connected')`,
      [CONN, TENANT],
    );
    await q(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
       VALUES ($1,$2,$3,'user','m@example.invalid')`,
      [BOX, TENANT, CONN],
    );
    await q(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status)
       VALUES ($1,$2,$3,'active')`,
      [MAPPING, TENANT, BOX],
    );
  } finally {
    await conn.release();
  }
  // 120s: this fixture initialises a PGlite cluster and runs the full
  // migration chain, which a loaded runner has taken past 10s.
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  const conn = await driver.acquire();
  try {
    await conn.query('DELETE FROM item WHERE mapping_id = $1', [MAPPING]);
  } finally {
    await conn.release();
  }
});

describe('a decided row says what was decided (PgLedger on PGlite)', () => {
  it('a kept deletion says kept', async () => {
    await reported('kept');
    expect(await keepDeletion('kept')).toBe(true);

    expect(await deletionOf('kept')).toMatchObject({ decided: 'kept' });
  });

  it('a deletion carried out on the new system says applied', async () => {
    await reported('deleted');
    expect(await applyDeletion('deleted')).toBe(true);

    expect(await deletionOf('deleted')).toMatchObject({ decided: 'applied' });
  });

  it('the old copy of a renamed file, removed, says relocated on Deletions and applied on Moves', async () => {
    await renamed('moved');
    await reportedToo('moved');
    expect(await applyRelocation('moved')).toBe(true);

    expect(await deletionOf('moved')).toMatchObject({ decided: 'relocated' });
    expect(await moveOf('moved')).toMatchObject({ decided: 'applied' });
  });

  it('a deletion kept, and the old copy then removed through Moves, says relocated', async () => {
    await renamed('kr');
    await reportedToo('kr');
    expect(await keepDeletion('kr')).toBe(true);
    expect(await deletionOf('kr')).toMatchObject({ decided: 'kept' });

    expect(await applyRelocation('kr')).toBe(true);

    expect(await deletionOf('kr')).toMatchObject({ decided: 'relocated' });
    expect(await moveOf('kr')).toMatchObject({ decided: 'applied' });
  });

  it('a renamed file removed through Deletions says applied there, and its move stays open', async () => {
    await renamed('both');
    await reportedToo('both');
    expect(await applyDeletion('both')).toBe(true);

    expect(await deletionOf('both')).toMatchObject({ decided: 'applied' });
    const move = await moveOf('both');
    expect(move?.acknowledgedAt).toBeUndefined();
    expect(move?.decided).toBeUndefined();
  });

  it('a removed copy whose move was answered afterwards still says applied, not relocated', async () => {
    await renamed('later');
    await reportedToo('later');
    expect(await applyDeletion('later')).toBe(true);
    expect(await keepMove('later')).toBe(true);

    expect(await deletionOf('later')).toMatchObject({ decided: 'applied' });
    expect(await moveOf('later')).toMatchObject({ decided: 'applied' });
  });

  it('a move left where it is says kept', async () => {
    await renamed('left');
    expect(await keepMove('left')).toBe(true);

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
