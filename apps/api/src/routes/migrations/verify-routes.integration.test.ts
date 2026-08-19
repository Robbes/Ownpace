// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
//
// The managed §20 start + poll pair (workplan 0017 T3), against real Postgres.
//
// What is covered here is everything that does NOT need a Trigger.dev server:
// the report mapper over every row shape `verification_run` allows, the
// joined-run short-circuit (which answers before any enqueue), and the scope
// guards. The live enqueue itself follows the same precedent as the discovery
// routes' suite: it needs a Trigger.dev backend this environment does not run,
// and a test that mocks the client would be asserting the mock. The enqueue
// failure path's row-landing is unit-testable the day the client grows an
// injection seam; until then it is three lines whose behaviour the route
// comments state.
//
// UUID Family: 5f5b0000-e29b-41d4-a716-44665544xxxx

process.env.JWT_SECRET = 'test-secret-for-integration-tests';
process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

const PG = process.env.TEST_DATABASE_URL;
if (!PG) throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');

const appUserUrl = (u: string): string => {
  const url = new URL(u);
  url.username = 'app_user';
  url.password = 'app_password';
  return url.toString();
};
process.env.APP_DATABASE_URL = appUserUrl(PG);

import app from '../../index.ts';
import { seedMembership } from '../../__tests__/seed-membership.ts';

const TENANT = '5f5b0000-e29b-41d4-a716-446655440001';
const OTHER_TENANT = '5f5b0000-e29b-41d4-a716-446655440002';
const CONN = '5f5b0000-e29b-41d4-a716-446655440010';
const SRC_MB = '5f5b0000-e29b-41d4-a716-446655440020';
const TGT_MB = '5f5b0000-e29b-41d4-a716-446655440021';
const MAPPING = '5f5b0000-e29b-41d4-a716-446655440030';
const NO_SUCH = '5f5b0000-e29b-41d4-a716-4466554400ff';

const RUN_RUNNING = '5f5b0000-e29b-41d4-a716-446655440101';
const RUN_DONE = '5f5b0000-e29b-41d4-a716-446655440102';
const RUN_FAILED = '5f5b0000-e29b-41d4-a716-446655440103';

const REPORT = { [MAPPING]: { overallStatus: 'PASS', score: 1 } };

function token(tenantId: string): string {
  return jwt.sign(
    { sub: `user-${tenantId}`, tenantId, role: 'owner', email: `user@${tenantId}.test` },
    process.env.JWT_SECRET!,
  );
}

describe('verify start + poll routes (0017 T3)', () => {
  let pool: Pool;
  const request = supertest(app);
  const auth = { Authorization: `Bearer ${token(TENANT)}` };

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG });
    await pool.query(
      `INSERT INTO tenant (id, name, status, settings) VALUES ($1,'Verify T','active','{}'),($2,'Verify Other','active','{}') ON CONFLICT DO NOTHING`,
      [TENANT, OTHER_TENANT],
    );
    // Membership gate (0020 T1): the minted tokens must belong to their tenants.
    await seedMembership(pool, TENANT, `user-${TENANT}`);
    await seedMembership(pool, OTHER_TENANT, `user-${OTHER_TENANT}`);
    await pool.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status) VALUES ($1,$2,'source','imap','src','{}','connected') ON CONFLICT DO NOTHING`,
      [CONN, TENANT],
    );
    await pool.query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, status) VALUES ($1,$3,$2,'user','active'),($4,$3,$2,'user','active') ON CONFLICT DO NOTHING`,
      [SRC_MB, CONN, TENANT, TGT_MB],
    );
    await pool.query(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status) VALUES ($1,$2,$3,$4,'mirror','active') ON CONFLICT DO NOTHING`,
      [MAPPING, TENANT, SRC_MB, TGT_MB],
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM verification_run WHERE tenant_id IN ($1,$2)`, [
      TENANT,
      OTHER_TENANT,
    ]);
    await pool.query(`DELETE FROM tenant WHERE id IN ($1,$2)`, [TENANT, OTHER_TENANT]);
    await pool.end();
  });

  it('reports never-run for a mapping nobody has scanned', async () => {
    const res = await request.get(`/api/migrations/${MAPPING}/verify/report`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ state: 'never-run' });
  });

  it('maps every row shape the table allows, and picks the LATEST', async () => {
    // Three rows with hand-set start times, oldest first, so "latest wins" is
    // an assertion rather than an accident of insertion order.
    await pool.query(
      `INSERT INTO verification_run (id, tenant_id, mapping_id, state, started_at, finished_at, error, report) VALUES
       ($1, $4, $5, 'failed',  now() - interval '2 hours', now() - interval '110 minutes', 'the scan fell over', NULL),
       ($2, $4, $5, 'done',    now() - interval '1 hour',  now() - interval '55 minutes',  NULL, $6::jsonb),
       ($3, $4, $5, 'running', now() - interval '1 minute', NULL, NULL, NULL)`,
      [RUN_FAILED, RUN_DONE, RUN_RUNNING, TENANT, MAPPING, JSON.stringify(REPORT)],
    );

    const res = await request.get(`/api/migrations/${MAPPING}/verify/report`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('running');
    expect(res.body.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('a start while one is running JOINS it — 200, started: false, same run', async () => {
    // The short-circuit answers before any enqueue, which is what makes this
    // testable without a Trigger.dev backend — and what makes double-clicking
    // the button harmless in production.
    const res = await request.post(`/api/migrations/${MAPPING}/verify/start`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.started).toBe(false);
    expect(res.body.report.state).toBe('running');
  });

  it('serves done with the stored report VERBATIM once the running row lands', async () => {
    // The worker landing the run is simulated the way the worker does it: an
    // UPDATE on the row. What the poller then gets must be the stored jsonb,
    // not a reassembly.
    await pool.query(
      `UPDATE verification_run SET state='done', finished_at=now(), report=$2::jsonb WHERE id = $1`,
      [RUN_RUNNING, JSON.stringify(REPORT)],
    );
    const res = await request.get(`/api/migrations/${MAPPING}/verify/report`).set(auth);
    expect(res.body.state).toBe('done');
    expect(res.body.report).toEqual(REPORT);
    expect(res.body.finishedAt >= res.body.startedAt).toBe(true);
  });

  it('serves failed with the recorded reason', async () => {
    await pool.query(
      `UPDATE verification_run SET state='failed', error='the worker died mid-scan', report=NULL WHERE id = $1`,
      [RUN_RUNNING],
    );
    const res = await request.get(`/api/migrations/${MAPPING}/verify/report`).set(auth);
    expect(res.body.state).toBe('failed');
    expect(res.body.error).toBe('the worker died mid-scan');
  });

  it('is scoped: another tenant sees never-run, not this tenant’s runs', async () => {
    // RLS plus the WHERE clause; either alone would hide this passing test.
    const res = await request
      .get(`/api/migrations/${MAPPING}/verify/report`)
      .set('Authorization', `Bearer ${token(OTHER_TENANT)}`);
    // The mapping itself belongs to TENANT, so the scope guard 404s first —
    // which is the correct answer: not "no runs", but "not your mapping".
    expect(res.status).toBe(404);
  });

  it('404s an unknown mapping and 401s a missing token', async () => {
    expect((await request.get(`/api/migrations/${NO_SUCH}/verify/report`).set(auth)).status).toBe(404);
    expect((await request.post(`/api/migrations/${NO_SUCH}/verify/start`).set(auth)).status).toBe(404);
    expect((await request.get(`/api/migrations/${MAPPING}/verify/report`)).status).toBe(401);
  });
});
