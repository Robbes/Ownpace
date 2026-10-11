// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DRAFT IS NOT PAID (workplan 0111 T5, slice 3; managed 0045): `POST
 * /api/billing/invoices/:id/pay` over a real database with every migration
 * applied.
 *
 * The route used to set a draft `sent` while asking Mollie for money, which
 * issued an invoice Moneybird never numbered, and it replaced the invoice's
 * metadata whole. Now:
 *
 *  - a draft is refused with 409, and Mollie is asked nothing: the refusal
 *    comes before the payment, since the database would refuse draft → sent
 *    without a number only after real money had started to move;
 *  - an issued invoice gets its payment: Mollie is asked once, for its total;
 *    the invoice stays `sent` (the webhook moves it to paid); the payment id
 *    is recorded; and the metadata is added to, never replaced.
 *
 * UUID family 01110300-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';

const TENANT = '01110300-e29b-41d4-a716-446655440001';
const DRAFT = '01110300-e29b-41d4-a716-446655440101';
const ISSUED = '01110300-e29b-41d4-a716-446655440102';

let driver: LedgerDriver;

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: TENANT, userId: 'the-owner', userRole: 'owner' });
      next();
    },
    getDbPool: () => driver,
  };
});

const payments: Array<{ amount: number; metadata?: Record<string, string> }> = [];
vi.mock('../../services/mollie/index.ts', () => ({
  getMollieService: () => ({
    createPayment: async (params: { amount: number; metadata?: Record<string, string> }) => {
      payments.push(params);
      return { id: 'tr_test', status: 'open', redirectUrl: 'https://pay.example/tr_test' };
    },
  }),
}));

const { default: billingRoutes } = await import('./index.ts');

const app = express();
app.use(express.json());
app.use('/api/billing', billingRoutes);

/** As the owner: PGlite's raw connection bypasses row security, for seeding and probing. */
async function owner(sql: string, params: unknown[] = []) {
  const conn = await driver.acquire();
  try {
    return await conn.query(sql, params);
  } finally {
    await conn.release();
  }
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await owner(`INSERT INTO tenant (id, name) VALUES ($1, 'Pays BV')`, [TENANT]);
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  payments.length = 0;
  await owner('DELETE FROM invoice');
  await owner(
    `INSERT INTO invoice (id, tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total, currency, reference, metadata)
     VALUES ($1, $3, '2026-10-01', '2026-10-31', 'draft', '992', '0.21', '208', '1200', 'EUR', 'ownpace-pays-m-2026-10-medium', '{}'),
            ($2, $3, '2026-09-01', '2026-09-30', 'draft', '992', '0.21', '208', '1200', 'EUR', 'ownpace-pays-m-2026-09-medium', '{"kept":"yes"}')`,
    [DRAFT, ISSUED, TENANT],
  );
  // Issued the only way there is: Moneybird's number, id and date, with the step out of draft.
  await owner(
    `UPDATE invoice SET status = 'sent', invoice_number = '2026-0001', invoice_date = '2026-09-01',
            moneybird_id = '555', moneybird_administration_id = '123456789012345678', sent_at = now()
      WHERE id = $1`,
    [ISSUED],
  );
});

const row = async (id: string) =>
  (await owner(`SELECT status, payment_id, metadata FROM invoice WHERE id = $1`, [id])).rows[0] as {
    status: string;
    payment_id: string | null;
    metadata: Record<string, unknown>;
  };

describe('POST /api/billing/invoices/:id/pay', () => {
  it('refuses a draft with 409, and asks Mollie nothing', async () => {
    const res = await request(app).post(`/api/billing/invoices/${DRAFT}/pay`);

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('not been issued');
    expect(payments).toEqual([]);
    expect(await row(DRAFT)).toMatchObject({ status: 'draft', payment_id: null });
  });

  it('pays an issued invoice: Mollie asked once, for its total; still sent; metadata added to', async () => {
    const res = await request(app).post(`/api/billing/invoices/${ISSUED}/pay`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ paymentId: 'tr_test', paymentUrl: 'https://pay.example/tr_test' });
    expect(payments).toHaveLength(1);
    expect(payments[0]!.amount).toBe(1200);
    expect(await row(ISSUED)).toEqual({
      status: 'sent',
      payment_id: 'tr_test',
      metadata: { kept: 'yes', mollieInvoiceId: 'tr_test' },
    });
  });
});
