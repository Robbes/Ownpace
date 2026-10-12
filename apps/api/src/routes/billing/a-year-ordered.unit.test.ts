// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A YEAR ORDERED (workplan 0111 T11, slice Y2; ADR-0014, Amendment
 * 2026-10-04; terms §8; the owner's four answers of 2026-10-12): `GET` and
 * `POST /api/billing/year`, over a real database with every migration applied.
 *
 *  - on Free, every paid tier is offered, at six months of its monthly price,
 *    starting this month (nothing billed for it yet), with no credit;
 *  - a year of Medium from Free is one draft invoice of the year's price, and a
 *    pick of Medium with its yes, so the month bills at least Medium;
 *  - a second press of the same offer, a price not shown, and a tier below the
 *    one the month bills are refused with the year as it is now, and write
 *    nothing;
 *  - a year of the tier the month bills is no pick; bought in a month already
 *    billed, it pays from the next, and its credit is held before then;
 *  - invoice details first; nothing during the alpha; only an owner or admin;
 *  - another organisation's years are not this one's.
 *
 * UUID family 0111d000-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations, addMonths, monthOf } from '@openmig/managed';

const ON_FREE = '0111d000-e29b-41d4-a716-446655440001';
const ON_MEDIUM = '0111d000-e29b-41d4-a716-446655440002';
const NO_DETAILS = '0111d000-e29b-41d4-a716-446655440003';

let driver: LedgerDriver;
let tenant = ON_FREE;
let role = 'owner';

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: tenant, userId: 'the-owner', userRole: role });
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

const invoicesOf = async (tenantId: string) =>
  (
    await owner(
      `SELECT reference, status, total::text AS total, period_start::text AS period_start, evidence
         FROM invoice WHERE tenant_id = $1 ORDER BY created_at`,
      [tenantId],
    )
  ).rows as Record<string, unknown>[];
const picksOf = async (tenantId: string) =>
  (await owner(`SELECT tier_id FROM tier_pick WHERE tenant_id = $1 ORDER BY picked_at`, [tenantId])).rows;
const yesesOf = async (tenantId: string) =>
  (await owner(`SELECT tier_id, axis FROM data_allowance WHERE tenant_id = $1 ORDER BY consented_at`, [tenantId])).rows;

const order = (tierId: string, yearCents: number, yearsBefore: number) =>
  request(app).post('/api/billing/year').send({ tierId, yearCents, yearsBefore });

const thisMonth = () => monthOf(new Date());

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await owner(`INSERT INTO tenant (id, name) VALUES ($1, 'Year BV'), ($2, 'Medium BV'), ($3, 'No Details BV')`, [
    ON_FREE,
    ON_MEDIUM,
    NO_DETAILS,
  ]);
  // Invoice details come first (0111 decision 14), for all but one.
  for (const id of [ON_FREE, ON_MEDIUM]) {
    await owner(
      `INSERT INTO billing_party (tenant_id, kind, name, address_line1, postal_code, city, country_code) VALUES ($1, 'consumer', 'Sam de Vries', 'Dorpsstraat 1', '1234 AB', 'Ons Dorp', 'NL')`,
      [id],
    );
  }
  // Medium BV picked Medium, with its yes, before the month began.
  await owner(`INSERT INTO tier_pick (tenant_id, tier_id, price_eur, picked_by, picked_at) VALUES ($1, 'medium', 12, 'x', '2026-01-01')`, [
    ON_MEDIUM,
  ]);
  await owner(
    `INSERT INTO data_allowance (tenant_id, kind, tier_id, band_gb, price_eur, consented_by, axis, consented_at)
     VALUES ($1, 'tier', 'medium', 1500, 12, 'x', 'pick', '2026-01-01')`,
    [ON_MEDIUM],
  );
  delete process.env.OWNPACE_STAGE;
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

afterEach(() => {
  delete process.env.OWNPACE_STAGE;
  tenant = ON_FREE;
  role = 'owner';
});

describe('a year, outside the alpha', () => {
  it('offers every paid tier on Free at six months of its monthly price, starting this month', async () => {
    const res = await request(app).get('/api/billing/year');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      holds: true,
      billed: { id: 'free' },
      placement: { creditFrom: thisMonth(), halfFrom: thisMonth(), halfTo: addMonths(thisMonth(), 11) },
      credit: { leftCents: 0, yearMonth: false },
      heldCents: 0,
      years: [],
      yearsBefore: 0,
    });
    expect(res.body.tiers.map((t: { id: string; yearCents: number }) => [t.id, t.yearCents])).toEqual([
      ['small', 3000],
      ['medium', 7200],
      ['large', 24000],
      ['xl', 48000],
    ]);
  });

  it('orders a year of Medium from Free: one draft of the year, and a pick of Medium with its yes', async () => {
    const res = await order('medium', 7200, 0);
    expect(res.status).toBe(200);
    expect(res.body.ordered).toEqual({
      tierId: 'medium',
      cents: 7200,
      creditFrom: thisMonth(),
      halfFrom: thisMonth(),
      halfTo: addMonths(thisMonth(), 11),
    });
    expect(res.body).toMatchObject({ yearsBefore: 1, credit: { leftCents: 7200, yearMonth: true }, heldCents: 7200 });
    const [year] = await invoicesOf(ON_FREE);
    expect(year).toMatchObject({
      reference: `ownpace-${ON_FREE}-y-1`,
      status: 'draft',
      total: '7200',
      period_start: `${thisMonth()}-01`,
    });
    expect(await picksOf(ON_FREE)).toEqual([{ tier_id: 'medium' }]);
    expect(await yesesOf(ON_FREE)).toEqual([{ tier_id: 'medium', axis: 'pick' }]);
  });

  it('refuses a second press, a price not shown and a tier below the month, with the year as it is now', async () => {
    for (const [tierId, cents, before] of [
      ['medium', 7200, 0],
      ['large', 24001, 1],
      ['small', 3000, 1],
    ] as const) {
      const res = await order(tierId, cents, before);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: 'offer_changed', year: { yearsBefore: 1 } });
    }
    expect(await invoicesOf(ON_FREE)).toHaveLength(1);
    expect(await picksOf(ON_FREE)).toHaveLength(1);
  });

  it('orders a year of the tier the month bills with no pick, from next month when this one is billed, its credit held', async () => {
    tenant = ON_MEDIUM;
    // This month is invoiced already, so the year's credit pays from the next.
    await owner(
      `INSERT INTO invoice (tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total, currency, reference, metadata)
       VALUES ($1, $2::date, ($2::date + interval '1 month' - interval '1 day')::date, 'draft', '992', '0.21', '208', '1200', 'EUR', $3, '{}')`,
      [ON_MEDIUM, `${thisMonth()}-01`, `ownpace-${ON_MEDIUM}-m-${thisMonth()}-medium`],
    );
    const res = await order('medium', 7200, 0);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ordered: { creditFrom: addMonths(thisMonth(), 1) },
      credit: { leftCents: 0, yearMonth: false },
      heldCents: 7200,
    });
    expect(await picksOf(ON_MEDIUM)).toEqual([{ tier_id: 'medium' }]);
    expect(await invoicesOf(ON_MEDIUM)).toHaveLength(2);
  });

  it('asks for invoice details first', async () => {
    tenant = NO_DETAILS;
    const res = await order('small', 3000, 0);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('invoice_details_first');
    expect(await invoicesOf(NO_DETAILS)).toEqual([]);
  });

  it("shows another organisation's years to nobody else", async () => {
    tenant = NO_DETAILS;
    const res = await request(app).get('/api/billing/year');
    expect(res.body).toMatchObject({ years: [], yearsBefore: 0, credit: { leftCents: 0 } });
  });
});

describe('a year, refused', () => {
  it('takes nothing during the alpha, and says so on the offer', async () => {
    process.env.OWNPACE_STAGE = 'alpha';
    expect((await request(app).get('/api/billing/year')).body.holds).toBe(false);
    const res = await order('small', 3000, 1);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('nothing_charged_during_the_alpha');
  });

  it('is an owner or admin action', async () => {
    role = 'member';
    expect((await order('small', 3000, 1)).status).toBe(403);
    expect((await request(app).get('/api/billing/year')).status).toBe(403);
  });
});
