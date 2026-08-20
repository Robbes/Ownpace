// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * GET /api/shared-addresses against real Postgres with RLS (workplan 0027 T4).
 *
 * Two properties. That the route reports what discovery wrote — including the
 * two states an owner must be able to tell apart, an unclassified address and
 * an unread member list — and that it never reports another tenant's.
 *
 * UUID Family: 5a41xxxx
 */

process.env.JWT_SECRET = 'test-secret-for-integration-tests';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests require Testcontainers to be running. ' +
      'Run: pnpm test:integration',
  );
}

const getAppUserConnectionString = (originalUrl: string): string => {
  const url = new URL(originalUrl);
  url.username = 'app_user';
  url.password = 'app_password';
  return url.toString();
};
process.env.APP_DATABASE_URL = getAppUserConnectionString(PG_CONNECTION_STRING);

import app from '../index.ts';
import { seedMembership } from '../__tests__/seed-membership.ts';

const TENANT_A = '5a410000-e29b-41d4-a716-446655440001';
const TENANT_B = '5a410000-e29b-41d4-a716-446655440002';

function token(tenantId: string, role = 'member'): string {
  return jwt.sign(
    {
      sub: `user-${role}-${tenantId}`,
      tenantId,
      role,
      email: `user@${tenantId}.test`,
    },
    process.env.JWT_SECRET!,
    { expiresIn: '1h' },
  );
}

describe('GET /api/shared-addresses', () => {
  let pool: Pool;
  let request: ReturnType<typeof supertest>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_CONNECTION_STRING });

    await pool.query(
      `INSERT INTO tenant (id, name, status, settings)
       VALUES ($1, 'Shared A', 'active', '{}'), ($2, 'Shared B', 'active', '{}')
       ON CONFLICT (id) DO NOTHING`,
      [TENANT_A, TENANT_B],
    );
    for (const tenant of [TENANT_A, TENANT_B]) {
      await seedMembership(pool, tenant, `user-member-${tenant}`, 'member');
      const conn = await pool.query(
        `INSERT INTO connection (tenant_id, role, kind, display_name, config, status)
         VALUES ($1, 'source', 'o365', 'Source', '{}', 'connected') RETURNING id`,
        [tenant],
      );
      await pool.query(
        `INSERT INTO group_def
           (tenant_id, source_connection_id, address, display_name, pattern, members, members_known)
         VALUES
           ($1, $2, $3, 'Sales', 'distribution_d', $4::jsonb, true),
           ($1, $2, $5, 'Mystery', NULL, '[]'::jsonb, false)`,
        [
          tenant,
          conn.rows[0].id,
          `sales@${tenant}.nl`,
          JSON.stringify(['rob@acme.nl']),
          `mystery@${tenant}.nl`,
        ],
      );
    }

    request = supertest(app);
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM connection WHERE tenant_id = ANY($1::uuid[])`, [
      [TENANT_A, TENANT_B],
    ]);
    await pool.end();
  });

  it('reports what discovery found, with its classification', async () => {
    const res = await request
      .get('/api/shared-addresses')
      .set('Authorization', `Bearer ${token(TENANT_A)}`);

    expect(res.status).toBe(200);
    const sales = res.body.addresses.find(
      (a: { address: string }) => a.address === `sales@${TENANT_A}.nl`,
    );
    expect(sales).toMatchObject({
      displayName: 'Sales',
      pattern: 'distribution_d',
      membersKnown: true,
      status: 'pending',
    });
    expect(sales.members).toEqual(['rob@acme.nl']);
  });

  it('keeps "not classified" and "members not read" distinguishable', async () => {
    const res = await request
      .get('/api/shared-addresses')
      .set('Authorization', `Bearer ${token(TENANT_A)}`);

    const mystery = res.body.addresses.find(
      (a: { address: string }) => a.address === `mystery@${TENANT_A}.nl`,
    );
    // No pattern at all rather than a defaulted one — the S-or-D question is
    // open, and the screen renders it as a question.
    expect(mystery.pattern).toBeUndefined();
    // Empty members AND membersKnown false: the same `[]` as a genuinely
    // empty group, told apart by the flag (rule 9).
    expect(mystery.members).toEqual([]);
    expect(mystery.membersKnown).toBe(false);
  });

  it('never returns another tenant’s addresses (RLS)', async () => {
    const res = await request
      .get('/api/shared-addresses')
      .set('Authorization', `Bearer ${token(TENANT_A)}`);

    const addresses = res.body.addresses.map((a: { address: string }) => a.address);
    expect(addresses).toContain(`sales@${TENANT_A}.nl`);
    expect(addresses).not.toContain(`sales@${TENANT_B}.nl`);
  });

  it('refuses an unauthenticated read', async () => {
    expect((await request.get('/api/shared-addresses')).status).toBe(401);
  });

  describe('the Pattern D runbook (workplan 0027 T2)', () => {
    it('serves Markdown a person can follow, from the tenant’s own rows', async () => {
      const res = await request
        .get('/api/shared-addresses/runbook')
        .set('Authorization', `Bearer ${token(TENANT_A)}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/markdown');
      expect(res.text).toContain(`sales@${TENANT_A}.nl`);
      // The line the whole document turns on: nothing is automated.
      expect(res.text).toContain('Nothing in it has been done for you');
    });

    it('carries the unread membership as a refusal, not as an empty list', async () => {
      const res = await request
        .get('/api/shared-addresses/runbook')
        .set('Authorization', `Bearer ${token(TENANT_A)}`);

      // `mystery@` is unclassified with members_known false — it must not
      // arrive as a group somebody recreates empty.
      expect(res.text).toContain('still to classify');
      expect(res.text).toContain(`mystery@${TENANT_A}.nl`);
    });

    it('never leaks another tenant’s addresses into the document (RLS)', async () => {
      const res = await request
        .get('/api/shared-addresses/runbook')
        .set('Authorization', `Bearer ${token(TENANT_A)}`);
      expect(res.text).not.toContain(`sales@${TENANT_B}.nl`);
    });

    it('refuses an unauthenticated read', async () => {
      expect((await request.get('/api/shared-addresses/runbook')).status).toBe(401);
    });
  });
});
