// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * What `0004_managed_apply.sql` must deliver (workplan 0017 T4).
 *
 * - `mailbox_mapping.allow_apply_deletions` exists and DEFAULTS TO FALSE:
 *   every mapping that predates the column, and every mapping created without
 *   an explicit opt-in, stays unable to remove anything from the target. The
 *   default IS the safety property, so it gets the first test.
 *
 * - `apply_receipt` refuses rows that lie about themselves — a queued row with
 *   an outcome time, a terminal row without one, a state outside the machine —
 *   the same self-consistency CHECK shape `verification_run` carries.
 *
 * RLS on the new table is covered by the force-rls catalog audit, by name,
 * like every other RLS table; no second copy of that assertion here.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pgliteDriver } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import type { LedgerDriver, LedgerConnection } from './driver.ts';

const TENANT = '5a4b0000-e29b-41d4-a716-446655441801';
const CONN = '5a4b0000-e29b-41d4-a716-446655441811';
const SRC = '5a4b0000-e29b-41d4-a716-446655441812';
const DST = '5a4b0000-e29b-41d4-a716-446655441813';
const MAPPING = '5a4b0000-e29b-41d4-a716-446655441814';

let driver: LedgerDriver;
let conn: LedgerConnection;

beforeAll(async () => {
  driver = pgliteDriver();
  await runMigrations({ driver, logger: () => {} });
  conn = await driver.acquire();

  await conn.query(`INSERT INTO tenant (id, name) VALUES ($1, 'apply-schema')`, [TENANT]);
  await conn.query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
     VALUES ($1,$2,'source','imap','t','{}'::jsonb,'connected')`,
    [CONN, TENANT],
  );
  for (const [id, addr] of [
    [SRC, 'src@apply.local'],
    [DST, 'dst@apply.local'],
  ]) {
    await conn.query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, primary_address, display_name, status)
       VALUES ($1,$2,$3,$4,'user',$4,$4,'active')`,
      [id, TENANT, CONN, addr],
    );
  }
  // Deliberately WITHOUT naming the new column, because the default is the claim.
  await conn.query(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
     VALUES ($1,$2,$3,$4,'mirror','active')`,
    [MAPPING, TENANT, SRC, DST],
  );
}, 120_000);

afterAll(async () => {
  conn?.release();
  await driver?.end();
});

describe('the enable flag', () => {
  it('defaults to FALSE — a mapping can remove nothing until somebody says so', async () => {
    const { rows } = await conn.query<{ allow: boolean }>(
      `SELECT allow_apply_deletions AS allow FROM mailbox_mapping WHERE id = $1`,
      [MAPPING],
    );
    expect(rows[0]!.allow).toBe(false);
  });
});

describe('apply_receipt refuses rows that lie about themselves', () => {
  it('stores a queued row and each terminal shape', async () => {
    await conn.query(
      `INSERT INTO apply_receipt (tenant_id, mapping_id, natural_key_hash, state)
       VALUES ($1, $2, 'nk-queued', 'queued')`,
      [TENANT, MAPPING],
    );
    await conn.query(
      `INSERT INTO apply_receipt (tenant_id, mapping_id, natural_key_hash, state, finished_at, kind)
       VALUES ($1, $2, 'nk-applied', 'applied', now(), 'binned')`,
      [TENANT, MAPPING],
    );
    await conn.query(
      `INSERT INTO apply_receipt (tenant_id, mapping_id, natural_key_hash, state, finished_at, code, reason)
       VALUES ($1, $2, 'nk-refused', 'refused', now(), 'edited_on_target', 'their changes now')`,
      [TENANT, MAPPING],
    );
    const { rows } = await conn.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM apply_receipt WHERE mapping_id = $1`,
      [MAPPING],
    );
    expect(rows[0]!.n).toBe(3);
  });

  it('refuses a queued row that claims an outcome time', async () => {
    await expect(
      conn.query(
        `INSERT INTO apply_receipt (tenant_id, mapping_id, natural_key_hash, state, finished_at)
         VALUES ($1, $2, 'nk-x', 'queued', now())`,
        [TENANT, MAPPING],
      ),
    ).rejects.toThrow(/apply_receipt_finished_check/);
  });

  it('refuses a terminal row without one', async () => {
    await expect(
      conn.query(
        `INSERT INTO apply_receipt (tenant_id, mapping_id, natural_key_hash, state)
         VALUES ($1, $2, 'nk-y', 'failed')`,
        [TENANT, MAPPING],
      ),
    ).rejects.toThrow(/apply_receipt_finished_check/);
  });

  it('refuses a state outside the machine', async () => {
    await expect(
      conn.query(
        `INSERT INTO apply_receipt (tenant_id, mapping_id, natural_key_hash, state, finished_at)
         VALUES ($1, $2, 'nk-z', 'maybe', now())`,
        [TENANT, MAPPING],
      ),
    ).rejects.toThrow(/apply_receipt_state_check/);
  });
});
