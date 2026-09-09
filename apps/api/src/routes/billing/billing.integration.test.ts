// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * API Integration Tests for Billing Routes
 *
 * Tests that prove tenant isolation for billing endpoints using RLS.
 * These tests use supertest against a Testcontainers Postgres instance.
 * Tests connect as the non-owner app_user role to ensure RLS is enforced.
 *
 * UUID Family: 950e8400-e29b-41d4-a716-44665544xxxx
 *
 * NOTE: POST /api/billing/usage has been removed. Usage is now recorded
 * by T4 metering functions (recordComputeForRun, recordApiCallForRun, etc.)
 * during migration job execution. Billing GET /usage reads from the real
 * source of truth (migration_status + item ledger).
 */

// Set JWT_SECRET before importing app
process.env.JWT_SECRET = 'test-secret-for-integration-tests';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests require Testcontainers to be running. ' +
    'Run: pnpm test:integration'
  );
}

// Set APP_DATABASE_URL with app_user role to ensure RLS is enforced
const getAppUserConnectionString = (originalUrl: string): string => {
  const url = new URL(originalUrl);
  url.username = 'app_user';
  url.password = 'app_password';
  return url.toString();
};
process.env.APP_DATABASE_URL = getAppUserConnectionString(PG_CONNECTION_STRING);

import app from '../../index.ts';
import { seedMembership } from '../../__tests__/seed-membership.ts';


// UUIDs for API isolation tests (950e8400-e29b-41d4-a716-44665544xxxx)
const API_TENANT_A = '5f0b0000-e29b-41d4-a716-446655443101';
const API_TENANT_B = '5f0b0000-e29b-41d4-a716-446655443102';

function createTestToken(tenantId: string, role: string = 'member', sub?: string): string {
  return jwt.sign(
    {
      sub: sub ?? `user-${tenantId}`,
      tenantId,
      role,
      email: `user@${tenantId}.test`,
    },
    process.env.JWT_SECRET!
  );
}

// The workhorse tokens are ADMIN (owner decision 2026-08-10: billing READS
// are owner/admin too, so a lesser role would 403 out of every functional
// test below — the isolation tests still prove tenant B's admin sees none
// of tenant A's money).
const TOKEN_TENANT_A = createTestToken(API_TENANT_A, 'admin');
const TOKEN_TENANT_B = createTestToken(API_TENANT_B, 'admin');
// Role-guard tokens (0039 T1). The role the API enforces is the MEMBERSHIP
// row's, not the claim — see seed-membership.ts — so each token's sub gets
// its own seeded row below.
const TOKEN_VIEWER_A = createTestToken(API_TENANT_A, 'viewer', 'user-viewer-billing');
const TOKEN_MEMBER_A = createTestToken(API_TENANT_A, 'member', 'user-member-billing');
const TOKEN_ADMIN_A = createTestToken(API_TENANT_A, 'admin', 'user-admin-billing');

describe('Billing Route Isolation', () => {
  let superuserPool: Pool;
  let request: ReturnType<typeof supertest>;

  beforeAll(async () => {
    superuserPool = new Pool({
      connectionString: PG_CONNECTION_STRING,
    });

    // Create test tenants
    await superuserPool.query(`
      INSERT INTO tenant (id, name, status, settings)
      VALUES ($1, $2, $3, '{}'), ($4, $5, $6, '{}')
      ON CONFLICT (id) DO NOTHING
    `, [
      API_TENANT_A, 'Billing Tenant A', 'active',
      API_TENANT_B, 'Billing Tenant B', 'active',
    ]);
    // Membership gate (0020 T1): the minted tokens must belong to their
    // tenants — as ADMIN, since billing reads are owner/admin (2026-08-10).
    await seedMembership(superuserPool, API_TENANT_A, `user-${API_TENANT_A}`, 'admin');
    await seedMembership(superuserPool, API_TENANT_B, `user-${API_TENANT_B}`, 'admin');
    // Role-guard rows (0039 T1) — cascade-delete with the tenant.
    await seedMembership(superuserPool, API_TENANT_A, 'user-viewer-billing', 'viewer');
    await seedMembership(superuserPool, API_TENANT_A, 'user-member-billing', 'member');
    await seedMembership(superuserPool, API_TENANT_A, 'user-admin-billing', 'admin');

    request = supertest(app);
  });

  afterAll(async () => {
    // Cleanup test data
    await superuserPool.query(`DELETE FROM usage_metric WHERE tenant_id IN ($1, $2)`, [
      API_TENANT_A,
      API_TENANT_B,
    ]);
    await superuserPool.query(`DELETE FROM invoice WHERE tenant_id IN ($1, $2)`, [
      API_TENANT_A,
      API_TENANT_B,
    ]);
    await superuserPool.query(`DELETE FROM payment_method WHERE tenant_id IN ($1, $2)`, [
      API_TENANT_A,
      API_TENANT_B,
    ]);
    await superuserPool.query(`DELETE FROM tenant WHERE id IN ($1, $2)`, [
      API_TENANT_A,
      API_TENANT_B,
    ]);
    await superuserPool.end();
  });

  describe('GET /api/billing/usage', () => {
    it('should return usage for authenticated tenant', async () => {
      const now = new Date();

      // Compute and sync operations are DERIVED from the run ledger (0121 T3):
      // there is no `usage_metric` row to seed, because nothing writes one.
      // Ten hours in one closed pass — the route reads what actually ran.
      const startedAt = new Date(now.getTime() - 10 * 60 * 60 * 1000);
      await superuserPool.query(`
        INSERT INTO run (id, tenant_id, mapping_id, kind, trigger, status, stats, started_at, finished_at, created_at)
        VALUES ($1, $2, NULL, 'incremental', 'schedule', 'succeeded', '{}'::jsonb, $3, $4, $3)
      `, [randomUUID(), API_TENANT_A, startedAt, now]);

      const response = await request
        .get('/api/billing/usage')
        .set('Authorization', `Bearer ${TOKEN_TENANT_A}`);

      expect(response.status).toBe(200);
      expect(response.body.usage.tenantId).toBe(API_TENANT_A);
      expect(response.body.usage.computeHours).toBe(10);
      expect(response.body.usage.syncCount).toBe(1);
    });

    it('should prevent tenant B from accessing tenant A usage', async () => {
      const response = await request
        .get('/api/billing/usage')
        .set('Authorization', `Bearer ${TOKEN_TENANT_B}`);

      expect(response.status).toBe(200);
      // RLS should filter out tenant A's data
      expect(response.body.usage.computeHours).toBe(0);
      expect(response.body.usage.syncCount).toBe(0);
    });

    it('derives the tier from the HIGHER axis and serves the evidence (0121 T4)', async () => {
      // 900 decimal GB. Small's ceiling is 750 and Medium's is 2 TB, so DATA
      // decides — while a recorded peak of 3 paths would only reach Small.
      // The two axes must DISAGREE, or this passes against a route that reads
      // whichever one it likes.
      await superuserPool.query(
        `INSERT INTO bytes_moved (tenant_id, bytes) VALUES ($1, $2)
         ON CONFLICT (tenant_id) DO UPDATE SET bytes = EXCLUDED.bytes`,
        [API_TENANT_A, '900000000000'],
      );
      const now = new Date();
      const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      await superuserPool.query(
        `INSERT INTO occupancy_peak (tenant_id, month, peak_paths, peak_at) VALUES ($1, $2, 3, $3)
         ON CONFLICT (tenant_id, month) DO UPDATE SET peak_paths = EXCLUDED.peak_paths`,
        [API_TENANT_A, firstOfMonth.toISOString().slice(0, 10), firstOfMonth],
      );

      const response = await request
        .get('/api/billing/usage')
        .set('Authorization', `Bearer ${TOKEN_TENANT_A}`);

      expect(response.status).toBe(200);
      expect(response.body.tier.id).toBe('medium');
      expect(response.body.decidedBy).toBe('data');
      expect(response.body.evidence.gbMoved).toBe(900);
      expect(response.body.evidence.peakPaths).toBe(3);
      // ADR-0014's table is whole EUROS. The screen scales to cents itself;
      // the wire must carry the published figure, not a pre-scaled one.
      expect(response.body.tier.setup).toBe(15);
      expect(response.body.tier.monthly).toBe(8);
      // And the retired metered model is off the wire, not merely off screen.
      expect(response.body.currentCost).toBeUndefined();
    });

    it('reading the screen writes NOTHING to the billing marks', async () => {
      const snapshot = async () =>
        (await superuserPool.query(
          'SELECT tenant_id, month, peak_paths, peak_at, updated_at FROM occupancy_peak ORDER BY tenant_id, month',
        )).rows;

      const before = await snapshot();
      await request.get('/api/billing/usage').set('Authorization', `Bearer ${TOKEN_TENANT_A}`);
      expect(await snapshot()).toEqual(before);

      // HONEST LIMIT: this does not, here, discriminate `observedTier` from
      // `currentTier`. No tenant in this fixture holds a live slot, and the
      // true-up records nothing when occupancy is zero — so both would leave
      // the table untouched. The discriminating proof is the unit guard
      // (`a-screen-that-quoted-a-retired-price.unit.test.ts`), which fails if
      // the handler names `currentTier` at all. What this case catches is the
      // next thing: any write introduced into this read path later.
    });

    it("tenant B's own screen carries none of tenant A's evidence", async () => {
      const response = await request
        .get('/api/billing/usage')
        .set('Authorization', `Bearer ${TOKEN_TENANT_B}`);

      expect(response.status).toBe(200);
      // RLS on occupancy_peak and bytes_moved, read under B's tenant setting.
      expect(response.body.evidence.gbMoved).toBe(0);
      expect(response.body.evidence.peakPaths).toBe(0);
      // Nothing measured still has an answer — the smallest band, not null.
      expect(response.body.tier.id).toBe('tiny');
    });

    it('should return 401 without token', async () => {
      const response = await request.get('/api/billing/usage');
      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/billing/usage/history', () => {
    it('should return usage history for authenticated tenant', async () => {
      const response = await request
        .get('/api/billing/usage/history')
        .set('Authorization', `Bearer ${TOKEN_TENANT_A}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.usage)).toBe(true);
    });

    it('should prevent tenant B from accessing tenant A history', async () => {
      const responseA = await request
        .get('/api/billing/usage/history')
        .set('Authorization', `Bearer ${TOKEN_TENANT_A}`);

      const responseB = await request
        .get('/api/billing/usage/history')
        .set('Authorization', `Bearer ${TOKEN_TENANT_B}`);

      // Both should succeed but return different data
      expect(responseA.status).toBe(200);
      expect(responseB.status).toBe(200);
      // Tenant B should not see tenant A's data
      expect(responseB.body.usage).not.toEqual(responseA.body.usage);
    });
  });

  describe('POST /api/billing/estimate', () => {
    it('should calculate cost estimate without DB access', async () => {
      const response = await request
        .post('/api/billing/estimate')
        .set('Authorization', `Bearer ${TOKEN_TENANT_A}`)
        .send({
          storageUsedGB: 100,
          egressGB: 50,
          computeHours: 20,
        });

      expect(response.status).toBe(200);
      expect(response.body.estimate).toBeGreaterThan(0);
      expect(response.body.breakdown).toBeDefined();
    });

    it('should require authentication', async () => {
      const response = await request
        .post('/api/billing/estimate')
        .send({ storageUsedGB: 10 });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/billing/invoices', () => {
    it('should return empty invoices for tenant with no invoices', async () => {
      const response = await request
        .get('/api/billing/invoices')
        .set('Authorization', `Bearer ${TOKEN_TENANT_A}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.invoices)).toBe(true);
    });

    it('should prevent tenant B from accessing tenant A invoices', async () => {
      // Create an invoice for tenant A
      const invoiceId = randomUUID();
      await superuserPool.query(`
        INSERT INTO invoice (id, tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total, currency)
        VALUES ($1, $2, '2024-06-01', '2024-06-30', 'draft', '1000', '210', '210', '1210', 'EUR')
      `, [
        invoiceId,
        API_TENANT_A,
      ]);

      const response = await request
        .get('/api/billing/invoices')
        .set('Authorization', `Bearer ${TOKEN_TENANT_B}`);

      expect(response.status).toBe(200);
      expect(response.body.invoices).toEqual([]);
    });
  });

  describe('GET /api/billing/invoices/:invoiceId', () => {
    it('should return invoice for authenticated tenant', async () => {
      const invoiceId = randomUUID();
      const result = await superuserPool.query(`
        INSERT INTO invoice (id, tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total, currency)
        VALUES ($1, $2, '2024-07-01', '2024-07-31', 'draft', '1000', '210', '210', '1210', 'EUR')
        RETURNING id
      `, [
        invoiceId,
        API_TENANT_A,
      ]);

      const invoiceIdFromDb = result.rows[0].id;

      const response = await request
        .get(`/api/billing/invoices/${invoiceIdFromDb}`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_A}`);

      expect(response.status).toBe(200);
      expect(response.body.invoice.id).toBe(invoiceIdFromDb);
    });

    it('should return 404 for tenant B trying to access tenant A invoice', async () => {
      // Create an invoice for tenant A with a different period
      const invoiceId = randomUUID();
      await superuserPool.query(`
        INSERT INTO invoice (id, tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total, currency)
        VALUES ($1, $2, '2024-08-01', '2024-08-31', 'draft', '1000', '210', '210', '1210', 'EUR')
      `, [
        invoiceId,
        API_TENANT_A,
      ]);

      const response = await request
        .get(`/api/billing/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_B}`);

      // Should return 404 because RLS filters out tenant A's invoice
      expect(response.status).toBe(404);
    });
  });

  describe('Payment Methods', () => {
    it('should list payment methods for authenticated tenant', async () => {
      const response = await request
        .get('/api/billing/payment-methods')
        .set('Authorization', `Bearer ${TOKEN_TENANT_A}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.paymentMethods)).toBe(true);
    });

    it('should create payment method as an admin (writes are owner/admin since 0039 T1)', async () => {
      const response = await request
        .post('/api/billing/payment-methods')
        .set('Authorization', `Bearer ${TOKEN_ADMIN_A}`)
        .send({
          type: 'card',
          brand: 'visa',
          last4: '4242',
        });

      expect(response.status).toBe(201);
      expect(response.body.paymentMethod.tenantId).toBe(API_TENANT_A);
    });

    it('should prevent tenant B from accessing tenant A payment methods', async () => {
      const response = await request
        .get('/api/billing/payment-methods')
        .set('Authorization', `Bearer ${TOKEN_TENANT_B}`);

      expect(response.status).toBe(200);
      // Should not see tenant A's payment methods
      expect(response.body.paymentMethods).toEqual([]);
    });
  });

  describe('billing role guards (0039 T1; reads tightened 2026-08-10)', () => {
    // Until 2026-08-09 every billing route ran on `authenticate` alone -- a
    // VIEWER could trigger a real Mollie payment. Writes are owner/admin,
    // mirroring the Tenants routes; on 2026-08-10 the owner overturned the
    // recorded member-visible line for READS too -- billing is owner/admin
    // in both directions now.

    it('refuses a viewer everywhere money moves', async () => {
      const attempts = [
        ['post', '/api/billing/invoices/generate', {}],
        [
          'post',
          `/api/billing/invoices/${randomUUID()}/pay`,
          { redirectUrl: 'https://example.test/billing' },
        ],
        ['post', '/api/billing/payment-methods', { type: 'card' }],
        ['patch', `/api/billing/payment-methods/${randomUUID()}/default`, {}],
      ] as const;
      for (const [method, path, body] of attempts) {
        const response = await (request as any)[method](path)
          .set('Authorization', `Bearer ${TOKEN_VIEWER_A}`)
          .send(body);
        expect(response.status, `${method} ${path}`).toBe(403);
      }
    });

    it('refuses a plain member too -- money writes are owner/admin only', async () => {
      const response = await request
        .post('/api/billing/invoices/generate')
        .set('Authorization', `Bearer ${TOKEN_MEMBER_A}`)
        .send({});
      expect(response.status).toBe(403);
    });

    it('an admin passes the guard, and meets the refusal behind it (0109 T0)', async () => {
      // The GUARD is what this test is about: an admin gets past it, where a
      // viewer and a member above do not. What waits on the other side changed
      // on 2026-08-27 — the route no longer mints a draft for a model that is
      // not sold, it refuses — so passage now reads as 409 rather than 201.
      //
      // The ordering is the part worth pinning: the refusal names this
      // deployment's billing model, and it is only ever shown to somebody
      // already entitled to ask. A refusal evaluated BEFORE the role guard
      // would answer that question for a viewer.
      const response = await request
        .post('/api/billing/invoices/generate')
        .set('Authorization', `Bearer ${TOKEN_ADMIN_A}`)
        .send({ period: '2026-06' });
      expect(response.status).toBe(409);
      expect(response.body.error).toBe('billing_model_retired');
    });

    it('reads are owner/admin too: viewers and members get 403 on every billing read (owner decision 2026-08-10)', async () => {
      const reads = [
        '/api/billing/usage',
        '/api/billing/usage/history',
        '/api/billing/invoices',
        '/api/billing/payment-methods',
      ] as const;
      for (const lesserToken of [TOKEN_VIEWER_A, TOKEN_MEMBER_A]) {
        for (const path of reads) {
          const response = await request
            .get(path)
            .set('Authorization', `Bearer ${lesserToken}`);
          expect(response.status, path).toBe(403);
        }
        // The estimate calculator writes nothing, but it prices financial
        // data -- same fence.
        const estimate = await request
          .post('/api/billing/estimate')
          .set('Authorization', `Bearer ${lesserToken}`)
          .send({ storageUsedGB: 1 });
        expect(estimate.status).toBe(403);
      }

      // An admin still reads everything the guard fences.
      const usage = await request
        .get('/api/billing/usage')
        .set('Authorization', `Bearer ${TOKEN_ADMIN_A}`);
      expect(usage.status).toBe(200);
    });
  });

});
