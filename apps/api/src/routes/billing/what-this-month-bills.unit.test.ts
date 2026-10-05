// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT THIS MONTH BILLS (workplan 0109 T6; the owner, 2026-10-04: data counts
 * in total, for ever, and the alpha's data does not; the Billing page names
 * the tier the month bills, with what was used under it).
 *
 * `GET /api/billing/usage` and `GET /api/billing/ceiling` over a real database
 * with every migration applied:
 *  - the meter counts what moved after the alpha, and says what the alpha
 *    moved beside it;
 *  - the month bills what it used, never above the agreed tier, and a top-up
 *    keeps the tier: bands buy room, never lanes;
 *  - more at the same time than the agreed tier runs bills the agreed tier,
 *    and says so;
 *  - `holds` says whether the alpha is over.
 *
 * UUID family 0109fb00-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations, MANAGED_TIERS } from '@openmig/managed';

const TENANT = '0109fb00-e29b-41d4-a716-446655440001';
const GB = 1_000_000_000;
const small = MANAGED_TIERS.find((t) => t.id === 'small')!;

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

/** As the owner: PGlite's raw connection bypasses row security, for seeding. */
async function owner(sql: string, params: unknown[] = []) {
  const conn = await driver.acquire();
  try {
    return await conn.query(sql, params);
  } finally {
    await conn.release();
  }
}

/** The meter: in total, and the alpha's share of it, in decimal GB. */
const moved = (totalGb: number, alphaGb = 0) =>
  owner('INSERT INTO bytes_moved (tenant_id, bytes, alpha_bytes) VALUES ($1, $2, $3)', [
    TENANT,
    totalGb * GB,
    alphaGb * GB,
  ]);
const yes = (kind: 'tier' | 'top_up', tierId: string) =>
  owner(
    `INSERT INTO data_allowance (tenant_id, kind, tier_id, band_gb, price_eur, consented_by)
     VALUES ($1, $2, $3, $4, 5, 'earlier')`,
    [TENANT, kind, tierId, MANAGED_TIERS.find((t) => t.id === tierId)!.dataGb],
  );

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await owner(`INSERT INTO tenant (id, name) VALUES ($1, 'Jansen thuis')`, [TENANT]);
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  delete process.env.OWNPACE_STAGE;
  await owner('DELETE FROM data_allowance');
  await owner('DELETE FROM bytes_moved');
  await owner('DELETE FROM occupancy_peak');
});

afterEach(() => {
  delete process.env.OWNPACE_STAGE;
});

describe('the alpha\'s data', () => {
  it('does not count on the usage screen, and is said beside what does', async () => {
    await moved(700, 600);
    const res = await request(app).get('/api/billing/usage');
    expect(res.status).toBe(200);
    expect(res.body.evidence.gbMoved).toBe(100);
    expect(res.body.gbMovedInTheAlpha).toBe(600);
    // 100 GB fits Free; the 700 GB in total would have needed Medium.
    expect(res.body.tier.id).toBe('free');
    expect(res.body.billed).toEqual({ tier: expect.objectContaining({ id: 'free' }), beyond: [], picked: false });
  });

  it('does not count against the data ceiling, and is said beside it', async () => {
    await moved(700, 600);
    const res = await request(app).get('/api/billing/ceiling');
    expect(res.body.gbMoved).toBe(100);
    expect(res.body.gbMovedInTheAlpha).toBe(600);
    expect(res.body.state).toBe('under');
  });
});

describe('what this month bills', () => {
  it('keeps Small when a band bought covers the data: what was used reads Medium', async () => {
    await yes('tier', 'small');
    await yes('top_up', 'small');
    await moved(1000);
    const res = await request(app).get('/api/billing/usage');
    expect(res.body.tier.id).toBe('medium');
    expect(res.body.billed).toEqual({
      tier: expect.objectContaining({ id: 'small', monthlyCents: small.monthlyCents }),
      beyond: ['bands'],
      picked: false,
    });
    expect(res.body.ceilingGb).toBe(2 * small.dataGb);
    expect(res.body.topUps).toBe(1);
  });

  it('bills the agreed tier when more ran at the same time than it runs, and says so', async () => {
    const month = new Date().toISOString().slice(0, 7) + '-01';
    // One more at the same time than Free runs.
    const peak = MANAGED_TIERS[0]!.paths + 1;
    await owner(`INSERT INTO occupancy_peak (tenant_id, month, peak_paths, peak_at) VALUES ($1, $2, $3, now())`, [
      TENANT,
      month,
      peak,
    ]);
    const res = await request(app).get('/api/billing/usage');
    expect(res.body.evidence.peakPaths).toBe(peak);
    expect(res.body.tier.id).not.toBe('free');
    expect(res.body.billed).toEqual({ tier: expect.objectContaining({ id: 'free' }), beyond: ['paths'], picked: false });
  });

  it('says whether the alpha is over: nothing is billed during it', async () => {
    expect((await request(app).get('/api/billing/usage')).body.holds).toBe(true);
    process.env.OWNPACE_STAGE = 'alpha';
    expect((await request(app).get('/api/billing/usage')).body.holds).toBe(false);
  });
});
