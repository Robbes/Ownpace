// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A RENAME THE BYTES COULD NOT PAIR, against a real database (workplan 0042
 * T10, migration 0058, ADR-0030 amended).
 *
 * `packages/core/src/a-rename-the-bytes-could-not-pair.unit.test.ts` proves the
 * pass pairs a renamed Google document by its Drive id and that Apply asks for
 * that id. This proves the store keeps its half: that how a pair was made is
 * written, read back and forgotten with the move, that the detector is handed
 * the id it pairs by, and that the last word on a removal, the relocation's
 * own `UPDATE`, accepts the same document in place of the same bytes only for
 * a pair made that way.
 *
 * PGlite as `app_user`, through the real migrations, so the column, its default
 * and the SQL are the product's rather than a fixture's.
 *
 * UUID family 0e1e0000-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { pgliteDriver, runMigrations, withTenant, PgLedger } from './index.ts';
import type { LedgerDriver } from './index.ts';
import type { LedgerRecord, MappingId, TenantId } from '@openmig/shared';

const TENANT = '0e1e0000-e29b-41d4-a716-446655443001' as TenantId;
const CONN = '0e1e0000-e29b-41d4-a716-446655443011';
const BOX = '0e1e0000-e29b-41d4-a716-446655443021';
const MAPPING = '0e1e0000-e29b-41d4-a716-446655443031' as MappingId;

const OLD = 'plan-docx';
const NEW = 'roadmap-docx';

let driver: LedgerDriver;

const ledger = <T>(run: (l: PgLedger) => Promise<T>) =>
  withTenant(driver, TENANT, async (db) => run(new PgLedger(db)));

/** A Google document's copy, as the pass records one: ours, with its Drive id. */
const copy = (naturalKeyHash: string, over: Partial<LedgerRecord> = {}): LedgerRecord => ({
  tenantId: TENANT,
  mappingId: MAPPING,
  itemType: 'file',
  naturalKeyHash,
  collection: 'Docs',
  contentHash: `sha256:${naturalKeyHash}`,
  targetId: `t/${naturalKeyHash}`,
  createdAt: '2026-09-23T00:00:00Z',
  status: 'copied',
  sourceRef: 'doc-1',
  ...over,
});

/** The old name and the new, the move between them recorded as the pass would. */
async function renamed(
  pairedBy: 'content' | 'identity' | undefined,
  arrival: Partial<LedgerRecord> = {},
  old: Partial<LedgerRecord> = {},
) {
  await ledger((l) => l.recordIfAbsent(copy(OLD, old)));
  await ledger((l) => l.recordIfAbsent(copy(NEW, arrival)));
  await ledger((l) =>
    pairedBy === undefined
      ? l.recordMove(TENANT, MAPPING, 'file', OLD, 'Docs', NEW)
      : l.recordMove(TENANT, MAPPING, 'file', OLD, 'Docs', NEW, pairedBy),
  );
}

/** The column itself, read around the store. */
async function column(naturalKeyHash: string): Promise<boolean | undefined> {
  const conn = await driver.acquire();
  try {
    const r = await conn.query(
      'SELECT moved_by_identity FROM item WHERE mapping_id = $1 AND natural_key_hash = $2',
      [MAPPING, naturalKeyHash],
    );
    return (r.rows as Array<{ moved_by_identity: boolean }>)[0]?.moved_by_identity;
  } finally {
    await conn.release();
  }
}

const find = (naturalKeyHash: string) =>
  ledger((l) => l.find(TENANT, MAPPING, 'file', naturalKeyHash));

const apply = () => ledger((l) => l.applyRelocation(TENANT, MAPPING, 'file', OLD));

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  const conn = await driver.acquire();
  try {
    const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
    await q('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'renamed']);
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

describe('how a pair was made', () => {
  it('is written for a pair made by id, and read back', async () => {
    await renamed('identity');
    expect(await column(OLD)).toBe(true);
    expect(await find(OLD)).toMatchObject({ movedToNaturalKeyHash: NEW, movedByIdentity: true });
  });

  it('reads as it always did for every pair made by bytes', async () => {
    // Every move recorded before this, and every one that passes nothing.
    await renamed(undefined);
    expect(await column(OLD)).toBe(false);
    expect((await find(OLD))?.movedByIdentity).toBeUndefined();
    // And the new copy, which moved nowhere, carries the default.
    expect(await column(NEW)).toBe(false);
  });

  it('follows the latest pairing: a pair made by bytes later is a bytes pair', async () => {
    await renamed('identity');
    await ledger((l) => l.recordMove(TENANT, MAPPING, 'file', OLD, 'Docs', NEW, 'content'));
    expect(await column(OLD)).toBe(false);
  });

  it('is forgotten with the move, so a later move starts from nothing', async () => {
    await renamed('identity');
    await ledger((l) => l.clearMove(TENANT, MAPPING, 'file', OLD));
    expect(await column(OLD)).toBe(false);
    expect((await find(OLD))?.movedByIdentity).toBeUndefined();
  });
});

describe('what the detector is handed', () => {
  it('carries each row’s source handle, and nothing where none was recorded', async () => {
    await ledger((l) => l.recordIfAbsent(copy(OLD)));
    await ledger((l) => {
      const { sourceRef: _none, ...plain } = copy('report-pdf');
      return l.recordIfAbsent(plain);
    });
    const placed = await ledger((l) => l.placedItems(TENANT, MAPPING, 'file'));
    const byKey = Object.fromEntries(placed.map((p) => [p.naturalKeyHash, p]));
    expect(byKey[OLD]?.sourceRef).toBe('doc-1');
    expect(byKey['report-pdf']).toBeDefined();
    expect(byKey['report-pdf']).not.toHaveProperty('sourceRef');
  });
});

describe('the last word on a removal (gate 7)', () => {
  it('removes for a pair made by id: the same document, ours, whatever its bytes', async () => {
    await renamed('identity');
    expect(await apply()).toBe(true);
    expect(await find(OLD)).toMatchObject({ status: 'tombstoned' });
  });

  it('refuses a pair made by id when the new copy carries another id', async () => {
    await renamed('identity', { sourceRef: 'doc-2' });
    expect(await apply()).toBe(false);
    expect(await find(OLD)).toMatchObject({ status: 'copied' });
  });

  it('refuses a pair made by id when the new copy carries no id at all', async () => {
    // Two blanks are not the same document.
    await renamed('identity', { sourceRef: '' }, { sourceRef: '' });
    expect(await apply()).toBe(false);
  });

  it('refuses a pair made by id when the new copy is not ours', async () => {
    await renamed('identity', { status: 'adopted' });
    expect(await apply()).toBe(false);
  });

  it('asks a pair made by bytes for the same bytes, whatever ids the two carry', async () => {
    // Same Drive id, other bytes, paired by bytes: an edit after the move, as
    // before. The id is accepted only as the proof the pair was made by.
    await renamed('content');
    expect(await apply()).toBe(false);
    expect(await find(OLD)).toMatchObject({ status: 'copied' });
  });

  it('still removes for a pair made by bytes whose bytes agree', async () => {
    await renamed('content', { contentHash: 'sha256:same' }, { contentHash: 'sha256:same' });
    expect(await apply()).toBe(true);
  });
});
