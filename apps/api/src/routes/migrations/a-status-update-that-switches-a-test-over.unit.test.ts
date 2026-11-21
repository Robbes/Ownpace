// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A STATUS UPDATE THAT SWITCHES A TEST OVER (workplan 0162 §2 (e); the fourth
 * thing T1 settles before any marker can be set), pressed at the managed API's
 * own door against a real database.
 *
 * `PUT /api/migrations/:id` with a `status` asks `updateTransition`. Until
 * this, it moved a test migration from `active` or `paused` to `cutover`,
 * after which the source was no longer the authority and an update could
 * enter the continuous lane from there. T3 made every later door of the
 * cutover refuse a test; this one now refuses too, with T3's sentence in both
 * languages, so a page shows its reader's half:
 *
 *  - declaring the cutover, from `active` and from `paused`;
 *  - entering the lane, from `cutover` and from `done`, states no door gives a
 *    test, set here directly as a row older than these refusals could hold.
 *
 * Each case presses the same door on a migration without a marker, which goes
 * through, and reads the rows directly, outside any route, to see that a
 * refusal wrote nothing: not the status, not a path, not the audit row.
 * Pausing and resuming stay open to a test: the update pauses it, and Start
 * resumes it.
 *
 * Nothing writes the marker yet (T1), so the fixture inserts it, as a
 * migration's creation will.
 *
 * UUID family 01620006-…, unused elsewhere in the repository.
 */

process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { A_TEST_IS_NOT_SWITCHED_OVER } from '@openmig/shared';
import { SecretStore } from '@openmig/core/secret-store';

const TENANT = '01620006-e29b-41d4-a716-446655440001';
const TEST_CONN = '01620006-e29b-41d4-a716-446655440011';
const TEST_BOX = '01620006-e29b-41d4-a716-446655440021';
const TEST = '01620006-e29b-41d4-a716-446655440031';
const PLAIN_CONN = '01620006-e29b-41d4-a716-446655440012';
const PLAIN_BOX = '01620006-e29b-41d4-a716-446655440022';
const PLAIN = '01620006-e29b-41d4-a716-446655440032';
const MARKER = '[Ownpace-test]';

let driver: LedgerDriver;

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: TENANT, userId: 'an-owner', userRole: 'owner' });
      next();
    },
    getDbPool: () => driver,
  };
});
// Start enqueues the first pass; this file is not about it.
vi.mock('@openmig/scheduler', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getTriggerClient: () => ({ tasks: { trigger: () => Promise.resolve({ id: 'run-1' }) } }),
  };
});

const { default: migrationRoutes } = await import('./index.ts');

const app = express();
app.use(express.json());
app.use('/api/migrations', migrationRoutes);

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(sql, params)).rows as T[];
  } finally {
    await conn.release();
  }
}

/** A source account and its mailbox, in the one organisation. */
async function anAccount(connection: string, mailbox: string): Promise<void> {
  await query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
     VALUES ($1, $2, 'source', 'imap', 'an account', '{}'::jsonb, 'connected', $3)`,
    [
      connection,
      TENANT,
      JSON.stringify(SecretStore.encryptCredentials({ username: 'a@example.com', password: 'p' }).encrypted),
    ],
  );
  await query(
    `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
     VALUES ($1, $2, $3, 'user', 'm@example.com')`,
    [mailbox, TENANT, connection],
  );
}

/** A migration of mail from that mailbox, with the marker given (none when null). */
async function aMigration(id: string, mailbox: string, marker: string | null): Promise<void> {
  await query(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status, test_marker)
     VALUES ($1, $2, $3, 'paused', $4)`,
    [id, TENANT, mailbox, marker],
  );
  await query(
    `INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1, $2, 'email', true)`,
    [TENANT, id],
  );
}

/** What the migration's own rows say, outside any route. */
async function rowsOf(id: string): Promise<{ status: string | undefined; paths: string[]; changes: string[] }> {
  const [mapping] = await query<{ status: string }>(`SELECT status FROM mailbox_mapping WHERE id = $1`, [id]);
  const paths = await query<{ state: string }>(
    `SELECT state FROM path_lifecycle WHERE mapping_id = $1 ORDER BY domain`,
    [id],
  );
  // Every status change an update records, in order: what `recordMappingStatusChange` writes.
  const changes = await query<{ move: string }>(
    `SELECT (detail->>'from') || '->' || (detail->>'to') AS move FROM audit_log
      WHERE action = 'mapping.status' AND detail->>'mappingId' = $1 AND detail->>'via' = 'update'
      ORDER BY at, id`,
    [id],
  );
  return { status: mapping?.status, paths: paths.map((p) => p.state), changes: changes.map((c) => c.move) };
}

/** Started through the real door, so its data type has its path row. */
async function started(id: string): Promise<void> {
  const res = await request(app).post(`/api/migrations/${id}/start`).send({});
  expect(res.status).toBe(200);
  expect((await rowsOf(id)).status).toBe('active');
}

/** Put in a state no door gives a test migration, as a row older than these refusals could be. */
async function heldAt(id: string, state: 'cutover' | 'done'): Promise<void> {
  await query(`UPDATE mailbox_mapping SET status = $2 WHERE id = $1`, [id, state]);
  await query(`UPDATE path_lifecycle SET state = $2 WHERE mapping_id = $1`, [id, state]);
}

const put = (id: string, status: string) => request(app).put(`/api/migrations/${id}`).send({ status });

/** The refusal, in both languages, for a move from `from` to `to`. */
const refusedFrom = (from: string, to: string) => ({
  error: 'lifecycle_refused',
  message: A_TEST_IS_NOT_SWITCHED_OVER.en,
  messageNl: A_TEST_IS_NOT_SWITCHED_OVER.nl,
  hint: 'Nothing was changed.',
  code: 'test_migration',
  from,
  to,
});

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  // The managed chain too: the doors here write the month's peak and read
  // the operator's hold, both managed-only tables.
  await runManagedMigrations({ driver, logger: () => {} });

  await query('INSERT INTO tenant (id, name) VALUES ($1, $2)', [TENANT, 'a test organisation']);
  // Room for both migrations' paths (workplan 0109 T6): this file is not
  // about the tier.
  await query(
    `INSERT INTO data_allowance (tenant_id, kind, tier_id, band_gb, price_eur, consented_by)
     VALUES ($1, 'tier', 'xl', 15000, 0, 'room for the test')`,
    [TENANT],
  );
  await anAccount(TEST_CONN, TEST_BOX);
  await anAccount(PLAIN_CONN, PLAIN_BOX);
  await aMigration(TEST, TEST_BOX, MARKER);
  await aMigration(PLAIN, PLAIN_BOX, null);
  // PGlite's WASM warm-up on a cold runner exceeds vitest's 10s default.
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  await query(`UPDATE mailbox_mapping SET status = 'paused' WHERE id IN ($1, $2)`, [TEST, PLAIN]);
  await query(`DELETE FROM path_lifecycle WHERE mapping_id IN ($1, $2)`, [TEST, PLAIN]);
  await query(`DELETE FROM audit_log WHERE detail->>'mappingId' IN ($1, $2)`, [TEST, PLAIN]);
});

describe('declaring the cutover by a status update', () => {
  it('refuses a test migration that is running, in both languages, and writes nothing', async () => {
    await started(TEST);

    const res = await put(TEST, 'cutover');

    expect(res.status).toBe(409);
    expect(res.body).toEqual(refusedFrom('active', 'cutover'));
    expect(await rowsOf(TEST)).toEqual({ status: 'active', paths: ['active'], changes: [] });
  });

  it('refuses a test migration that is paused, and writes nothing', async () => {
    await started(TEST);
    expect((await put(TEST, 'paused')).status).toBe(200);

    const res = await put(TEST, 'cutover');

    expect(res.status).toBe(409);
    expect(res.body).toEqual(refusedFrom('paused', 'cutover'));
    expect(await rowsOf(TEST)).toEqual({ status: 'paused', paths: ['paused'], changes: ['active->paused'] });
  });

  it('declares it for the same migration without a marker, and records it', async () => {
    await started(PLAIN);

    const res = await put(PLAIN, 'cutover');

    expect(res.status).toBe(200);
    expect(await rowsOf(PLAIN)).toEqual({ status: 'cutover', paths: ['cutover'], changes: ['active->cutover'] });
  });
});

describe('entering the continuous lane by a status update', () => {
  it.each(['cutover', 'done'] as const)(
    'refuses a test migration held at %s, in both languages, and writes nothing',
    async (state) => {
      await started(TEST);
      await heldAt(TEST, state);

      const res = await put(TEST, 'continuous');

      expect(res.status).toBe(409);
      expect(res.body).toEqual(refusedFrom(state, 'continuous'));
      expect(await rowsOf(TEST)).toEqual({ status: state, paths: [state], changes: [] });
    },
  );

  it('enters it for the same migration without a marker, after its cutover', async () => {
    await started(PLAIN);
    expect((await put(PLAIN, 'cutover')).status).toBe(200);

    const res = await put(PLAIN, 'continuous');

    expect(res.status).toBe(200);
    expect(await rowsOf(PLAIN)).toEqual({
      status: 'continuous',
      paths: ['continuous'],
      changes: ['active->cutover', 'cutover->continuous'],
    });
  });
});

describe('pausing and resuming a test migration stay open', () => {
  it('pauses it by a status update, and Start resumes it', async () => {
    await started(TEST);

    const paused = await put(TEST, 'paused');
    expect(paused.status).toBe(200);
    expect(await rowsOf(TEST)).toEqual({ status: 'paused', paths: ['paused'], changes: ['active->paused'] });

    // A resume by an update is Start's, as for any migration, and Start takes a test.
    const byUpdate = await put(TEST, 'active');
    expect(byUpdate.status).toBe(409);
    expect(byUpdate.body).toMatchObject({ code: 'own_door' });
    expect(byUpdate.body).not.toHaveProperty('messageNl');
    await started(TEST);
  });
});
