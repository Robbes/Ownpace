// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TIER A PERSON PICKS (workplan 0157 T6; ADR-0014, *Amendment 2026-10-04,
 * evening*): `GET` and `POST /api/billing/pick`, over a real database with
 * every migration applied.
 *
 *  - on Free with nothing used, every paid tier is offered, at its monthly;
 *  - a pick of Small counts at once: this month bills Small, the pick is one
 *    append-only row, and the yes it carries raises the agreed tier, with
 *    `axis` `pick`;
 *  - a second press of the same offer, and a price that is not the monthly
 *    shown, are refused with what is offered now, and write nothing;
 *  - a lower pick counts from the next month: this month still bills Small,
 *    and Small is offered again, to keep it, with no second yes;
 *  - nothing is taken during the alpha, and only an owner or admin picks;
 *  - another organisation's picks are not this one's.
 *
 * UUID family 01576100-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations, MANAGED_TIERS, nextMonthStartOf } from '@openmig/managed';

const TENANT = '01576100-e29b-41d4-a716-446655440001';
const OTHER = '01576100-e29b-41d4-a716-446655440002';

const tier = (id: string) => MANAGED_TIERS.find((t) => t.id === id)!;
/** A tier as the pick names it. */
const named = (id: string) => {
  const t = tier(id);
  return {
    id: t.id,
    name: t.name,
    paths: t.paths,
    dataGb: t.dataGb,
    monthlyEur: t.monthlyCents / 100,
    annualEur: t.annualCents / 100,
  };
};

let driver: LedgerDriver;
let tenant = TENANT;
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

const picks = async (tenantId = TENANT) =>
  (
    await owner(`SELECT tier_id, price_eur, picked_by FROM tier_pick WHERE tenant_id = $1 ORDER BY picked_at`, [
      tenantId,
    ])
  ).rows;
const yeses = async () =>
  (
    await owner(
      `SELECT kind, tier_id, band_gb, price_eur, axis FROM data_allowance WHERE tenant_id = $1 ORDER BY consented_at`,
      [TENANT],
    )
  ).rows;
const pickOf = (tierId: string, priceEur: number) => request(app).post('/api/billing/pick').send({ tierId, priceEur });

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await owner(`INSERT INTO tenant (id, name) VALUES ($1, 'Picks BV'), ($2, 'Other BV')`, [TENANT, OTHER]);
  delete process.env.OWNPACE_STAGE;
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

afterEach(() => {
  delete process.env.OWNPACE_STAGE;
  tenant = TENANT;
  role = 'owner';
});

describe('picking a tier, outside the alpha', () => {
  it('offers every paid tier on Free, at its monthly, with nothing to lower', async () => {
    const res = await request(app).get('/api/billing/pick');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      holds: true,
      billed: named('free'),
      picked: { now: null, next: null, nextFrom: nextMonthStartOf(new Date()).toISOString() },
      raise: ['small', 'medium', 'large', 'xl'].map(named),
      lower: [],
    });
  });

  it('counts a pick of Small at once, with the yes it carries', async () => {
    const res = await pickOf('small', 5);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      from: 'now',
      billed: named('small'),
      picked: { now: named('small'), next: named('small') },
      raise: ['medium', 'large', 'xl'].map(named),
      lower: [named('free')],
    });
    expect(await picks()).toEqual([{ tier_id: 'small', price_eur: 5, picked_by: 'the-owner' }]);
    expect(await yeses()).toEqual([
      { kind: 'tier', tier_id: 'small', band_gb: tier('small').dataGb, price_eur: 5, axis: 'pick' },
    ]);
  });

  it('bills Small this month, as the pick, on the usage the Billing page reads', async () => {
    const res = await request(app).get('/api/billing/usage');
    expect(res.status).toBe(200);
    expect(res.body.tier.id).toBe('free');
    expect(res.body.billed).toMatchObject({ tier: { id: 'small' }, beyond: [], picked: true });
  });

  it('refuses a second press of the same offer, with what is offered now, and writes nothing', async () => {
    const res = await pickOf('small', 5);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('offer_changed');
    expect(res.body.pick.raise).toEqual(['medium', 'large', 'xl'].map(named));
    expect(await picks()).toHaveLength(1);
  });

  it('refuses a price that is not the monthly shown, and writes nothing', async () => {
    const res = await pickOf('medium', 5);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('offer_changed');
    expect(await picks()).toHaveLength(1);
    expect(await yeses()).toHaveLength(1);
  });

  it('counts a lower pick from the next month, and offers the tier picked now again, to keep it', async () => {
    const res = await pickOf('free', 0);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      from: 'next_month',
      billed: named('small'),
      picked: { now: named('small'), next: null },
      raise: ['small', 'medium', 'large', 'xl'].map(named),
      lower: [],
    });
    expect((await request(app).get('/api/billing/usage')).body.billed).toMatchObject({ tier: { id: 'small' } });
  });

  it('keeps Small on a pick of it again, with no second yes', async () => {
    const res = await pickOf('small', 5);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ from: 'now', picked: { now: named('small'), next: named('small') } });
    expect((await picks()).map((p) => p.tier_id)).toEqual(['small', 'free', 'small']);
    expect(await yeses()).toHaveLength(1);
  });

  it("reads only the organisation's own picks", async () => {
    tenant = OTHER;
    const res = await request(app).get('/api/billing/pick');
    expect(res.body.picked).toMatchObject({ now: null, next: null });
    expect(res.body.billed).toEqual(named('free'));
  });
});

describe('who may pick, and when', () => {
  it('takes no pick during the alpha, where every tier is free, and says so on the read', async () => {
    process.env.OWNPACE_STAGE = 'alpha';
    tenant = OTHER;
    const res = await pickOf('small', 5);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('nothing_charged_during_the_alpha');
    expect(await picks(OTHER)).toEqual([]);
    expect((await request(app).get('/api/billing/pick')).body.holds).toBe(false);
  });

  it('takes a pick from an owner or admin only', async () => {
    role = 'member';
    tenant = OTHER;
    expect((await pickOf('small', 5)).status).toBe(403);
    expect(await picks(OTHER)).toEqual([]);
  });

  it('answers 400 to a body that does not say the tier and the price', async () => {
    const res = await request(app).post('/api/billing/pick').send({ tierId: 'small' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_pick');
  });
});
