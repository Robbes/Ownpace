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
 *    is recorded; and the metadata is added to, never replaced;
 *  - a credit note, issued, is refused with 409 and Mollie is asked nothing
 *    (0111 slice 7a): it is credited to the organisation, never paid by it;
 *  - an invoice its credit notes take off in full is refused with 409, and
 *    Mollie is asked nothing; one credited in part is paid for the rest
 *    (slice 7d), whether its credit note is issued or still a draft.
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
const CREDIT = '01110300-e29b-41d4-a716-446655440103';
const CREDITED = '01110300-e29b-41d4-a716-446655440104';
const PART = '01110300-e29b-41d4-a716-446655440105';
const PART_CREDIT = '01110300-e29b-41d4-a716-446655440106';

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
  await owner(
    `INSERT INTO invoice (id, tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total, currency, reference, metadata)
     VALUES ($1, $3, '2026-08-01', '2026-08-31', 'draft', '992', '0.21', '208', '1200', 'EUR', 'ownpace-pays-m-2026-08-medium', '{}'),
            ($2, $3, '2026-07-01', '2026-07-31', 'draft', '992', '0.21', '208', '1200', 'EUR', 'ownpace-pays-m-2026-07-medium', '{}')`,
    [CREDITED, PART, TENANT],
  );
  // Issued the only way there is: Moneybird's number, id and date, with the step out of draft.
  for (const [id, number, mb] of [
    [ISSUED, '2026-0001', '555'],
    [CREDITED, '2026-0003', '557'],
    [PART, '2026-0004', '558'],
  ]) {
    await owner(
      `UPDATE invoice SET status = 'sent', invoice_number = $2, invoice_date = '2026-09-01',
              moneybird_id = $3, moneybird_administration_id = '123456789012345678', sent_at = now()
        WHERE id = $1`,
      [id, number, mb],
    );
  }
  // CREDITED is credited in full, by an issued credit note; PART by 400 of its
  // 1200, by one still a draft: a credit decided is a credit owed.
  await owner(
    `INSERT INTO invoice (id, tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total, currency,
                          reference, kind, credited_invoice_id, metadata)
     VALUES ($1, $2, '2026-08-01', '2026-08-31', 'draft', '-992', '0.21', '-208', '-1200', 'EUR',
             'ownpace-pays-c-2026-08-medium', 'credit_note', $3, '{}'),
            ($4, $2, '2026-07-01', '2026-07-31', 'draft', '-331', '0.21', '-69', '-400', 'EUR',
             'ownpace-pays-c-2026-07-medium', 'credit_note', $5, '{}')`,
    [CREDIT, TENANT, CREDITED, PART_CREDIT, PART],
  );
  await owner(
    `UPDATE invoice SET status = 'sent', invoice_number = '2026-0002', invoice_date = '2026-09-10',
            moneybird_id = '556', moneybird_administration_id = '123456789012345678', sent_at = now()
      WHERE id = $1`,
    [CREDIT],
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

  it('refuses a credit note with 409, and asks Mollie nothing', async () => {
    const res = await request(app).post(`/api/billing/invoices/${CREDIT}/pay`);

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('credit note');
    expect(payments).toEqual([]);
    expect(await row(CREDIT)).toMatchObject({ status: 'sent', payment_id: null });
  });

  it('refuses an invoice its credit notes take off in full, with 409, and asks Mollie nothing', async () => {
    const res = await request(app).post(`/api/billing/invoices/${CREDITED}/pay`);

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('credited in full');
    expect(payments).toEqual([]);
    expect(await row(CREDITED)).toMatchObject({ status: 'sent', payment_id: null });
  });

  it('asks Mollie for the rest of an invoice credited in part, its credit note still a draft', async () => {
    const res = await request(app).post(`/api/billing/invoices/${PART}/pay`);

    expect(res.status).toBe(200);
    expect(payments).toHaveLength(1);
    expect(payments[0]!.amount).toBe(800);
  });
});
