// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * TWO DELETES OF ONE ADDRESS CHANGE AT ONCE, OVER HTTP, ON POSTGRES (ADR-0055;
 * workplan 0168 T2; the review of 0168's table, finding 8).
 *
 * The route read the row before the organisation's lock, to say whose it was,
 * and answered 200 "deleted" from that read whatever the delete found. So of
 * two deletes at once, both read the row, both waited for the lock, one
 * removed it, and the other removed nothing and still answered 200. The route
 * now takes the lock first and answers from the DELETE's own RETURNING.
 *
 * Deterministic, not a timing guess: a third connection holds the
 * organisation's lock while both requests start, so both are inside the route
 * and waiting before either can delete; then it lets go. PGlite has one
 * connection and cannot show this.
 *
 * The real router on both chains, as the serving role under row security,
 * with only `authenticate` stubbed. UUID family 0168a2b0-…, unused elsewhere.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Pool } from 'pg';
import { pgDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { setAuditKeyDriver } from '../audit-key.ts';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
if (!ADMIN_URL) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

const TENANT = '0168a2b0-e29b-41d4-a716-446655440001';

let driver: LedgerDriver;

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: TENANT, userId: 'admin-of-races', userRole: 'admin' });
      next();
    },
    getDbPool: () => driver,
  };
});

const { default: routes } = await import('./address-changes.ts');
const app = express();
app.use(express.json());
app.use('/api/address-changes', routes);

let dbName: string;
let pool: Pool;

beforeAll(async () => {
  dbName = `address_route_races_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = new Pool({ connectionString: ADMIN_URL });
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  const url = new URL(ADMIN_URL!);
  url.pathname = `/${dbName}`;
  pool = new Pool({ connectionString: url.toString(), max: 6 });
  driver = pgDriver(pool, { role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  // The audit key on the database owner's connection, as the API's start-up sets it.
  setAuditKeyDriver(pgDriver(pool));
  await pool.query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'races', 'active')`, [TENANT]);
  await pool.query(
    `INSERT INTO tenant_member (tenant_id, user_id, email, role, status)
     VALUES ($1, 'admin-of-races', 'admin@example.org', 'admin', 'active')`,
    [TENANT],
  );
}, 120_000);

afterAll(async () => {
  await pool?.end();
  const admin = new Pool({ connectionString: ADMIN_URL });
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe('two deletes of one row at once', () => {
  it('one answers 200 with the row it removed, the other 404, and one deletion is recorded', async () => {
    expect(
      (await request(app).post('/api/address-changes').send({ oldAddress: 'gone@example.com', newAddress: 'here@example.org' })).status,
    ).toBe(201);

    // Hold the organisation's lock, so both deletes are inside and waiting.
    const holder = await pool.connect();
    await holder.query('BEGIN');
    await holder.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`address_change:${TENANT}`]);
    const both = Promise.all([
      request(app).delete('/api/address-changes/gone%40example.com'),
      request(app).delete('/api/address-changes/gone%40example.com'),
    ]);
    for (let i = 0; i < 100; i++) {
      const { rows } = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`,
      );
      if (rows[0]!.n >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await holder.query('COMMIT');
    holder.release();

    const answers = await both;
    expect(answers.map((r) => r.status).sort()).toEqual([200, 404]);
    const deleted = answers.find((r) => r.status === 200)!;
    expect(deleted.body).toMatchObject({ oldKey: 'gone@example.com', newAddress: 'here@example.org' });
    const refused = answers.find((r) => r.status === 404)!;
    expect(refused.body.error).toBe('address_change_not_found');
    const { rows } = await pool.query(
      `SELECT action FROM audit_log WHERE tenant_id = $1 AND action = 'address_change.deleted'`,
      [TENANT],
    );
    expect(rows).toHaveLength(1);
  }, 60_000);
});
