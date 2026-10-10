// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN INVOICE'S DOCUMENT, FROM THE BOOKS (workplan 0111, T6; slice 6):
 * `GET /api/billing/invoices/:id/pdf` over a real database with every
 * migration applied, and Moneybird's download stubbed.
 *
 *  - an issued invoice's PDF is Moneybird's, asked for by its Moneybird id,
 *    handed on as a file named after its legal number, and kept from caches;
 *  - a draft has no document, refused by name, and Moneybird is asked nothing;
 *  - another organisation's invoice is not found, and Moneybird is asked
 *    nothing;
 *  - with Moneybird off, or set to other books than the ones that numbered the
 *    invoice, and when Moneybird does not hand the document over, the answer
 *    is a sentence a person can act on, never a broken file.
 *
 * UUID family 01110600-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations, downloadInvoicePdf } from '@openmig/managed';

const TENANT = '01110600-e29b-41d4-a716-446655440001';
const OTHER = '01110600-e29b-41d4-a716-446655440002';
const DRAFT = '01110600-e29b-41d4-a716-446655440101';
const ISSUED = '01110600-e29b-41d4-a716-446655440102';
const THEIRS = '01110600-e29b-41d4-a716-446655440103';
const ADMINISTRATION = '123456789012345678';

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

vi.mock('@openmig/managed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@openmig/managed')>()),
  downloadInvoicePdf: vi.fn(),
}));
const download = vi.mocked(downloadInvoicePdf);

const { default: billingRoutes } = await import('./index.ts');

const app = express();
app.use(express.json());
app.use('/api/billing', billingRoutes);

/** As the owner: PGlite's raw connection bypasses row security, for seeding. */
async function owner(sql: string, params: unknown[] = []) {
  const conn = await driver.acquire();
  try {
    return await conn.query(sql, params);
  } finally {
    await conn.release();
  }
}

const BOOKS = {
  MONEYBIRD_API_TOKEN: 'not-a-real-token',
  MONEYBIRD_ADMINISTRATION_ID: ADMINISTRATION,
  MONEYBIRD_WORKFLOW_ID: '702',
  MONEYBIRD_TAX_RATE_ID_DOMESTIC: '611',
  MONEYBIRD_TAX_RATE_ID_REVERSE_CHARGE: '622',
};
const PDF = new TextEncoder().encode('%PDF-1.7\n% an invoice\n');

/** A binary body, collected whole, for supertest. */
const binary = (res: request.Response, done: (err: Error | null, body: unknown) => void) => {
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  stream.on('end', () => done(null, Buffer.concat(chunks)));
};

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await owner(`INSERT INTO tenant (id, name) VALUES ($1, 'Reads BV'), ($2, 'Elsewhere BV')`, [TENANT, OTHER]);
  await owner(
    `INSERT INTO invoice (id, tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total, currency, reference)
     VALUES ($1, $4, '2026-10-01', '2026-10-31', 'draft', '992', '0.21', '208', '1200', 'EUR', 'ownpace-reads-m-2026-10-medium'),
            ($2, $4, '2026-09-01', '2026-09-30', 'draft', '992', '0.21', '208', '1200', 'EUR', 'ownpace-reads-m-2026-09-medium'),
            ($3, $5, '2026-09-01', '2026-09-30', 'draft', '992', '0.21', '208', '1200', 'EUR', 'ownpace-else-m-2026-09-medium')`,
    [DRAFT, ISSUED, THEIRS, TENANT, OTHER],
  );
  // Issued the only way there is: Moneybird's number, id and date, with the step out of draft.
  for (const [id, number, mb] of [
    [ISSUED, '2026/0007', '555'],
    [THEIRS, '2026-0008', '556'],
  ] as const) {
    await owner(
      `UPDATE invoice SET status = 'sent', invoice_number = $2, invoice_date = '2026-09-01',
              moneybird_id = $3, moneybird_administration_id = $4, sent_at = now()
        WHERE id = $1`,
      [id, number, mb, ADMINISTRATION],
    );
  }
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(() => {
  download.mockReset();
  for (const key of Object.keys(BOOKS)) delete process.env[key];
  Object.assign(process.env, BOOKS);
});

describe('GET /api/billing/invoices/:id/pdf', () => {
  it("hands on Moneybird's PDF of an issued invoice, named after its number, kept from caches", async () => {
    download.mockResolvedValue({ kind: 'pdf', bytes: PDF });
    const res = await request(app).get(`/api/billing/invoices/${ISSUED}/pdf`).buffer(true).parse(binary);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe('attachment; filename="Ownpace-invoice-2026_0007.pdf"');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.compare(res.body as Buffer, Buffer.from(PDF))).toBe(0);
    expect(download).toHaveBeenCalledTimes(1);
    expect(download.mock.calls[0]![0]).toMatchObject({ administrationId: ADMINISTRATION });
    expect(download.mock.calls[0]![1]).toBe('555');
  });

  it('refuses a draft by name, and asks Moneybird nothing', async () => {
    const res = await request(app).get(`/api/billing/invoices/${DRAFT}/pdf`);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'no_document_yet', reason: expect.stringContaining('being prepared') });
    expect(download).not.toHaveBeenCalled();
  });

  it("does not find another organisation's invoice, and asks Moneybird nothing", async () => {
    const res = await request(app).get(`/api/billing/invoices/${THEIRS}/pdf`);

    expect(res.status).toBe(404);
    expect(download).not.toHaveBeenCalled();
  });

  it.each([
    ['Moneybird is off', { MONEYBIRD_API_TOKEN: '' }],
    ['the books configured are not the ones that numbered it', { MONEYBIRD_ADMINISTRATION_ID: '999999999999999999' }],
  ])('says so in a sentence when %s, and asks Moneybird nothing', async (_case, change) => {
    Object.assign(process.env, change);
    const res = await request(app).get(`/api/billing/invoices/${ISSUED}/pdf`);

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'document_unavailable', reason: expect.stringContaining('name the invoice number') });
    expect(download).not.toHaveBeenCalled();
  });

  it('says so in a sentence when Moneybird does not hand the document over, never a broken file', async () => {
    download.mockResolvedValue({ kind: 'unavailable', reason: 'What came back is not a PDF.' });
    const res = await request(app).get(`/api/billing/invoices/${ISSUED}/pdf`);

    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toMatchObject({ error: 'document_unavailable', reason: expect.stringContaining('Try again') });
  });
});
