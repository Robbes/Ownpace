// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A YES THAT ASKS FOR INVOICE DETAILS FIRST (workplan 0111, decision 14, the
 * owner, 2026-10-05: "ok"; and decision 11's invoice address).
 *
 *  - without invoice details, each door a paid tier is agreed through refuses
 *    with 409 `invoice_details_first` and records nothing: the yes at the data
 *    ceiling, the yes at *Start*, and a pick of a paid tier;
 *  - a pick of Free is no charge, and is not asked for them;
 *  - the details given, with the address the invoice is e-mailed to, the same
 *    pick is taken, and the address is served back;
 *  - an invoice address that is not one is refused, by the route and by the
 *    column's check, and empty clears it.
 *
 * Over a real database with every migration applied. UUID family
 * 0111f000-…, unused elsewhere in the repo; the names are invented.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';

const TENANT = '0111f000-e29b-41d4-a716-446655440001';

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

const recorded = async () => ({
  yeses: (await owner(`SELECT tier_id FROM data_allowance WHERE tenant_id = $1`, [TENANT])).rows,
  picks: (await owner(`SELECT tier_id FROM tier_pick WHERE tenant_id = $1`, [TENANT])).rows,
});

const DETAILS = {
  kind: 'consumer',
  name: 'Sam de Vries',
  addressLine1: 'Dorpsstraat 1',
  postalCode: '1234 AB',
  city: 'Ons Dorp',
  countryCode: 'NL',
};

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await owner(`INSERT INTO tenant (id, name) VALUES ($1, 'Asks First BV')`, [TENANT]);
  delete process.env.OWNPACE_STAGE;
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe('without invoice details, no door a paid tier is agreed through takes the yes', () => {
  it.each([
    ['the yes at the data ceiling', '/api/billing/ceiling/yes', { choice: 'move_up', tierId: 'small', priceEur: 5 }],
    ['the yes at Start', '/api/billing/paths/yes', { tierId: 'small', priceEur: 5 }],
    ['a pick of a paid tier', '/api/billing/pick', { tierId: 'small', priceEur: 5 }],
  ])('%s: 409 invoice_details_first, and nothing recorded', async (_door, path, body) => {
    const res = await request(app).post(path).send(body);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: 'invoice_details_first',
      reason: expect.stringContaining('Your invoice details come first'),
    });
    expect(await recorded()).toEqual({ yeses: [], picks: [] });
  });

  it('asks nothing of a pick of Free, which charges nothing', async () => {
    const res = await request(app).post('/api/billing/pick').send({ tierId: 'free', priceEur: 0 });
    expect(res.body.error).not.toBe('invoice_details_first');
  });
});

describe('the details given, with the address the invoice is e-mailed to', () => {
  it('refuses an invoice address that is not one', async () => {
    const res = await request(app)
      .put('/api/billing/party')
      .send({ ...DETAILS, invoiceEmail: 'not an address' });
    expect(res.status).toBe(400);
  });

  it('stores the details and the address, and serves them back', async () => {
    const put = await request(app)
      .put('/api/billing/party')
      .send({ ...DETAILS, invoiceEmail: ' invoices@example.invalid ' });
    expect(put.status).toBe(200);
    expect(put.body.party).toMatchObject({ name: 'Sam de Vries', invoiceEmail: 'invoices@example.invalid' });
    const got = await request(app).get('/api/billing/party');
    expect(got.body.party).toMatchObject({ invoiceEmail: 'invoices@example.invalid' });
  });

  it('is refused by the database as well, whatever writes it, when it is not an address', async () => {
    await expect(
      owner(`UPDATE billing_party SET invoice_email = 'not an address' WHERE tenant_id = $1`, [TENANT]),
    ).rejects.toThrow(/billing_party_invoice_email_check/);
    const got = await request(app).get('/api/billing/party');
    expect(got.body.party).toMatchObject({ invoiceEmail: 'invoices@example.invalid' });
  });

  it('takes the same pick now', async () => {
    const res = await request(app).post('/api/billing/pick').send({ tierId: 'small', priceEur: 5 });
    expect(res.status).toBe(200);
    expect(await recorded()).toEqual({ yeses: [{ tier_id: 'small' }], picks: [{ tier_id: 'small' }] });
  });

  it('clears the address when it is sent empty', async () => {
    const put = await request(app)
      .put('/api/billing/party')
      .send({ ...DETAILS, invoiceEmail: '' });
    expect(put.status).toBe(200);
    expect(put.body.party.invoiceEmail).toBeNull();
  });
});
