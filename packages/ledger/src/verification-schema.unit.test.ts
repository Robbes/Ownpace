// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The verification schema fits the verification contract (workplan 0017 T6).
 *
 * Two things `0003_verification_fits_the_contract.sql` must deliver, each
 * asserted the way it would actually fail:
 *
 * - `verification.status` accepts all FIVE contract statuses. SKIPPED and
 *   NOT_VERIFIABLE are the two the Verify screen refuses to soften — "nobody
 *   checked" is neither a pass nor a failure — and until this migration the
 *   CHECK constraint made them unstorable, which is how NOT_VERIFIABLE ends
 *   up persisted as 'fail' by whoever hits the wall first.
 *
 * - `verification_run` exists, keeps the run-level truth the contract's
 *   `VerificationRunReport` needs (running since when, failed why), and
 *   REFUSES rows that lie about themselves: a running row with a finish time,
 *   a finished row without one, a state outside the machine.
 *
 * RLS on the new table is deliberately NOT re-proved here — the catalog audit
 * in `force-rls.unit.test.ts` covers every RLS table by name, this one now
 * included, and a second copy of that assertion would just be a second thing
 * to keep in sync.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pgliteDriver } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import type { LedgerDriver, LedgerConnection } from './driver.ts';

const TENANT = '5e3b0000-e29b-41d4-a716-446655441701';
const CONN = '5e3b0000-e29b-41d4-a716-446655441711';
const SRC = '5e3b0000-e29b-41d4-a716-446655441712';
const DST = '5e3b0000-e29b-41d4-a716-446655441713';
const MAPPING = '5e3b0000-e29b-41d4-a716-446655441714';

let driver: LedgerDriver;
let conn: LedgerConnection;

beforeAll(async () => {
  driver = pgliteDriver();
  await runMigrations({ driver, logger: () => {} });
  conn = await driver.acquire();

  // The FK chain a verification row needs, seeded as the owner.
  await conn.query(`INSERT INTO tenant (id, name) VALUES ($1, 'verify-schema')`, [TENANT]);
  await conn.query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
     VALUES ($1,$2,'source','imap','t','{}'::jsonb,'connected')`,
    [CONN, TENANT],
  );
  for (const [id, addr] of [
    [SRC, 'src@schema.local'],
    [DST, 'dst@schema.local'],
  ]) {
    await conn.query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, primary_address, display_name, status)
       VALUES ($1,$2,$3,$4,'user',$4,$4,'active')`,
      [id, TENANT, CONN, addr],
    );
  }
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

describe('verification.status fits DataTypeVerificationStatus', () => {
  it('accepts all five contract statuses, the two new ones included', async () => {
    for (const status of ['pass', 'warn', 'fail', 'skipped', 'not_verifiable']) {
      await conn.query(
        `INSERT INTO verification (tenant_id, mapping_id, domain, status)
         VALUES ($1, $2, 'email', $3)`,
        [TENANT, MAPPING, status],
      );
    }
    const { rows } = await conn.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM verification WHERE mapping_id = $1`,
      [MAPPING],
    );
    expect(rows[0]!.n).toBe(5);
  });

  it('still refuses a status outside the contract', async () => {
    await expect(
      conn.query(
        `INSERT INTO verification (tenant_id, mapping_id, domain, status)
         VALUES ($1, $2, 'email', 'shrug')`,
        [TENANT, MAPPING],
      ),
    ).rejects.toThrow(/verification_status_check/);
  });
});

describe('verification_run refuses rows that lie about themselves', () => {
  it('stores a running row, and a terminal row with its report', async () => {
    await conn.query(
      `INSERT INTO verification_run (tenant_id, mapping_id, state) VALUES ($1, $2, 'running')`,
      [TENANT, MAPPING],
    );
    await conn.query(
      `INSERT INTO verification_run (tenant_id, mapping_id, state, finished_at, report)
       VALUES ($1, $2, 'done', now(), '{"m":{"overallStatus":"PASS"}}'::jsonb)`,
      [TENANT, MAPPING],
    );
    const { rows } = await conn.query<{ state: string }>(
      `SELECT state FROM verification_run WHERE mapping_id = $1 ORDER BY started_at, state`,
      [MAPPING],
    );
    expect(rows.map((r) => r.state).sort()).toEqual(['done', 'running']);
  });

  it('refuses a running row that claims a finish time', async () => {
    await expect(
      conn.query(
        `INSERT INTO verification_run (tenant_id, mapping_id, state, finished_at)
         VALUES ($1, $2, 'running', now())`,
        [TENANT, MAPPING],
      ),
    ).rejects.toThrow(/verification_run_finished_check/);
  });

  it('refuses a terminal row without one — "it ended, no idea when" is not a record', async () => {
    await expect(
      conn.query(
        `INSERT INTO verification_run (tenant_id, mapping_id, state) VALUES ($1, $2, 'failed')`,
        [TENANT, MAPPING],
      ),
    ).rejects.toThrow(/verification_run_finished_check/);
  });

  it('refuses a state outside the machine', async () => {
    await expect(
      conn.query(
        `INSERT INTO verification_run (tenant_id, mapping_id, state, finished_at)
         VALUES ($1, $2, 'paused', now())`,
        [TENANT, MAPPING],
      ),
    ).rejects.toThrow(/verification_run_state_check/);
  });
});
