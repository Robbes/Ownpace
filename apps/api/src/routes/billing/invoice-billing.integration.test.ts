// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Integration tests for workplan 0011 T5 — invoice generation + Mollie webhook,
 * amended by 0109 T0 (2026-08-27) when generation was retired, and by 0111
 * slice 4a when the retired generator and its route were removed.
 *
 * Proves: `POST /invoices/generate` is no route and writes NOTHING, even for a
 * tenant whose usage the metered model would have billed and even over an
 * invoice already on the books; the Mollie webhook still drives an invoice to
 * `paid` and double delivery is a no-op.
 *
 * Tenant isolation is no longer proved HERE — the cross-tenant case was a
 * generate call, and there is nothing left to isolate once the route writes
 * nothing. `billing.integration.test.ts` still proves it where it now lives:
 * on the invoice READS, which RLS actually governs.
 *
 * WHAT WENT, AND WHY IT IS NOT MOURNED. Until 0109 T0 this file proved that
 * usage reconciled to the cent under the metered model. That proof left with
 * the route, deliberately: the retired model priced every byte twice, billed
 * items that moved nothing, and put a per-driver breakdown on the invoice that
 * the ADR-0014 amendment forbids, so a test asserting the old total
 * "reconciles" would have been pinning a wrong number. A month's invoice is
 * now made by the month task, invoiced in advance (0111 decision 6), and
 * nothing at this door makes one.
 *
 * UUID Family: 5f2b0000-e29b-41d4-a716-44665544xxxx
 *
 * Runs against a Testcontainers Postgres (pnpm test:integration). The Mollie
 * client is mocked so no network / real API key is needed.
 */

process.env.JWT_SECRET = 'test-secret-for-integration-tests';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

const getAppUserConnectionString = (originalUrl: string): string => {
  const url = new URL(originalUrl);
  url.username = 'app_user';
  url.password = 'app_password';
  return url.toString();
};
process.env.APP_DATABASE_URL = getAppUserConnectionString(PG_CONNECTION_STRING);

// Mock the Mollie client so the webhook can be exercised without the network.
// The mock is programmable per-test via `mollieWebhookResult`.
let mollieWebhookResult: {
  id: string;
  status: string;
  paidAt?: string;
  metadata: Record<string, unknown> | null;
};
vi.mock('../../services/mollie/index', () => ({
  getMollieService: () => ({
    processWebhook: async () => mollieWebhookResult,
  }),
}));

import app from '../../index.ts';
import { seedMembership } from '../../__tests__/seed-membership.ts';

const TENANT_A = '5f2b0000-e29b-41d4-a716-446655443101';
const TENANT_B = '5f2b0000-e29b-41d4-a716-446655443102';

function token(tenantId: string, role = 'owner'): string {
  return jwt.sign(
    { sub: `user-${tenantId}`, tenantId, role, email: `user@${tenantId}.test` },
    process.env.JWT_SECRET!,
  );
}

const PERIOD = '2026-05';
const PERIOD_START = '2026-05-01';
const PERIOD_END = '2026-05-31';

describe('T5 — invoice generation + Mollie webhook', () => {
  let superuserPool: Pool;
  let request: ReturnType<typeof supertest>;

  // Seed a metered usage row. `quantity` is what the T4 read model prices:
  // compute is priced at computePricePerHour (5 cents/hour by default).
  const seedUsage = async (tenantId: string, metricType: string, resource: string, quantity: number) => {
    await superuserPool.query(
      `INSERT INTO usage_metric (id, tenant_id, period_start, period_end, metric_type, resource, quantity, unit, unit_price, total_cost, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'hours', '5', '0', '{}', NOW())`,
      [randomUUID(), tenantId, PERIOD_START, PERIOD_END, metricType, resource, String(quantity)],
    );
  };

  beforeAll(async () => {
    superuserPool = new Pool({ connectionString: PG_CONNECTION_STRING });
    await superuserPool.query(
      `INSERT INTO tenant (id, name, status, settings) VALUES ($1,$2,'active','{}'),($3,$4,'active','{}')
       ON CONFLICT (id) DO NOTHING`,
      [TENANT_A, 'T5 Tenant A', TENANT_B, 'T5 Tenant B'],
    );
    // Membership gate (0020 T1): the minted tokens must belong to their tenants.
    await seedMembership(superuserPool, TENANT_A, `user-${TENANT_A}`);
    await seedMembership(superuserPool, TENANT_B, `user-${TENANT_B}`);
    request = supertest(app);
  });

  afterAll(async () => {
    for (const t of ['usage_metric', 'invoice']) {
      await superuserPool.query(`DELETE FROM ${t} WHERE tenant_id IN ($1,$2)`, [TENANT_A, TENANT_B]);
    }
    await superuserPool.query(`DELETE FROM tenant WHERE id IN ($1,$2)`, [TENANT_A, TENANT_B]);
    await superuserPool.end();
  });

  beforeEach(async () => {
    await superuserPool.query(`DELETE FROM invoice WHERE tenant_id IN ($1,$2)`, [TENANT_A, TENANT_B]);
    await superuserPool.query(`DELETE FROM usage_metric WHERE tenant_id IN ($1,$2)`, [TENANT_A, TENANT_B]);
  });

  describe('POST /api/billing/invoices/generate — gone (0111 slice 4a)', () => {
    // Refused with a 409 from 0109 T0 (2026-08-27) and removed with the
    // generator itself. The door does not exist, and still writes nothing.
    // These read the table, not only the response: a route that answered and
    // still wrote a draft is the bug this repository has been bitten by.
    const invoiceCount = async (tenantId: string): Promise<number> => {
      const { rows } = await superuserPool.query(
        `SELECT COUNT(*)::int AS n FROM invoice WHERE tenant_id = $1`,
        [tenantId],
      );
      return rows[0].n;
    };

    it('is no route, and leaves nothing behind however many times it is called', async () => {
      // 2 compute hours: under the retired model this minted a 1221-cent draft.
      await seedUsage(TENANT_A, 'compute', 'sync', 2);

      for (let i = 0; i < 3; i++) {
        const res = await request
          .post('/api/billing/invoices/generate')
          .set('Authorization', `Bearer ${token(TENANT_A)}`)
          .send({ period: PERIOD });
        expect(res.status, `call ${i + 1}`).toBe(404);
      }

      expect(await invoiceCount(TENANT_A)).toBe(0);
    });

    it('never touches an invoice already on the books (finding #1, kept)', async () => {
      // The original test proved a PAID invoice survived a regenerate, because
      // an earlier build had overwritten one. Kept through both changes rather
      // than deleted with the behaviour it was written against.
      const invoiceId = randomUUID();
      await superuserPool.query(
        `INSERT INTO invoice (id, tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total, currency, metadata)
         VALUES ($1,$2,$3,$4,'paid','9999','0.21','2100','12099','EUR','{}')`,
        [invoiceId, TENANT_A, PERIOD_START, PERIOD_END],
      );
      // Usage that would have changed the amounts if anything were rewritten.
      await seedUsage(TENANT_A, 'compute', 'sync', 250);

      const res = await request
        .post('/api/billing/invoices/generate')
        .set('Authorization', `Bearer ${token(TENANT_A)}`)
        .send({ period: PERIOD });

      expect(res.status).toBe(404);

      const { rows } = await superuserPool.query(
        `SELECT status, subtotal, tax_amount, total FROM invoice WHERE tenant_id = $1`,
        [TENANT_A],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        status: 'paid',
        subtotal: '9999',
        tax_amount: '2100',
        total: '12099',
      });
    });
  });

  describe('POST /api/billing/webhooks/mollie', () => {
    // Seed an invoice already sent for payment with a known Mollie payment id.
    const seedSentInvoice = async (tenantId: string, paymentId: string): Promise<string> => {
      const invoiceId = randomUUID();
      await superuserPool.query(
        `INSERT INTO invoice (id, tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total, currency, payment_id, metadata)
         VALUES ($1,$2,$3,$4,'sent','1000','0.21','210','1210','EUR',$5,'{}')`,
        [invoiceId, tenantId, PERIOD_START, PERIOD_END, paymentId],
      );
      return invoiceId;
    };

    const statusOf = async (invoiceId: string): Promise<string> => {
      const { rows } = await superuserPool.query(`SELECT status FROM invoice WHERE id = $1`, [invoiceId]);
      return rows[0]?.status;
    };

    it('drives the invoice to paid, and double delivery is a no-op', async () => {
      const paymentId = 'tr_paidtest';
      const invoiceId = await seedSentInvoice(TENANT_A, paymentId);
      mollieWebhookResult = {
        id: paymentId,
        status: 'paid',
        paidAt: '2026-05-15T10:00:00Z',
        metadata: { tenantId: TENANT_A, invoiceId },
      };

      const first = await request.post('/api/billing/webhooks/mollie').send({ id: paymentId });
      expect(first.status).toBe(200);
      expect(await statusOf(invoiceId)).toBe('paid');

      // Re-deliver the same event — must remain paid, still 200.
      const second = await request.post('/api/billing/webhooks/mollie').send({ id: paymentId });
      expect(second.status).toBe(200);
      expect(await statusOf(invoiceId)).toBe('paid');
    });

    it('a failed payment leaves the invoice SENT — the document is not the payment', async () => {
      // This asserted `void` until managed migration 0014: a failed payment
      // used to void the invoice, which both misstated what happened (the
      // obligation is still owed; the customer can pay again) and, under
      // 0014's status machine where void is FINAL, would have stranded every
      // expired payment's invoice unpayable forever. Deliberate semantic
      // change, not a loosened guard: the invoice stays `sent` and payable.
      const paymentId = 'tr_failtest';
      const invoiceId = await seedSentInvoice(TENANT_A, paymentId);
      mollieWebhookResult = {
        id: paymentId,
        status: 'failed',
        metadata: { tenantId: TENANT_A, invoiceId },
      };

      const res = await request.post('/api/billing/webhooks/mollie').send({ id: paymentId });
      expect(res.status).toBe(200);
      expect(await statusOf(invoiceId)).toBe('sent');
    });

    it('acknowledges but does nothing when correlation metadata is missing', async () => {
      mollieWebhookResult = { id: 'tr_nometa', status: 'paid', metadata: null };
      const res = await request.post('/api/billing/webhooks/mollie').send({ id: 'tr_nometa' });
      expect(res.status).toBe(200);
    });

    it('returns 400 when no payment id is supplied', async () => {
      const res = await request.post('/api/billing/webhooks/mollie').send({});
      expect(res.status).toBe(400);
    });
  });
});
