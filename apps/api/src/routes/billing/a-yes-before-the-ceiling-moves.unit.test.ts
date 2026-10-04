// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A YES BEFORE THE CEILING MOVES (workplan 0109 T6, ADR-0014's amendment of
 * 2026-10-03, managed migration 0037).
 *
 * Every step up is consented and paid for. These routes read the data ceiling
 * and take the customer's yes to one of the two ways on, over a real database
 * with every migration applied, so the table's own refusals are exercised:
 * the yes is append-only, Free is never a row, and the meter is never
 * rewound by a top-up.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations, MANAGED_TIERS } from '@openmig/managed';

const TENANT = '5f5e0000-e29b-41d4-a716-446655441901';
const OTHER = '5f5e0000-e29b-41d4-a716-446655441902';
const small = MANAGED_TIERS.find((t) => t.id === 'small')!;
const medium = MANAGED_TIERS.find((t) => t.id === 'medium')!;
/** A tier's monthly in whole euros: what a move up is agreed at, and a top-up costs once. */
const eur = (t: (typeof MANAGED_TIERS)[number]) => t.monthlyCents / 100;

let driver: LedgerDriver;
let tenant: string;
let role: string;

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

/** Set the meter, in decimal GB. */
async function moved(gb: number, id = TENANT) {
  await owner(
    `INSERT INTO bytes_moved (tenant_id, bytes) VALUES ($1, $2)
     ON CONFLICT (tenant_id) DO UPDATE SET bytes = EXCLUDED.bytes`,
    [id, Math.round(gb * 1e9)],
  );
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  for (const [id, name] of [
    [TENANT, 'Jansen thuis'],
    [OTHER, 'Beta BV'],
  ]) {
    await owner('INSERT INTO tenant (id, name) VALUES ($1,$2)', [id, name]);
  }
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  tenant = TENANT;
  role = 'owner';
  delete process.env.OWNPACE_STAGE;
  await owner('DELETE FROM data_allowance');
  await owner('DELETE FROM bytes_moved');
});

afterEach(() => {
  delete process.env.OWNPACE_STAGE;
});

describe('GET /api/billing/ceiling', () => {
  it('starts on Free, with no top-up and a move up to Small', async () => {
    await moved(100);
    const res = await request(app).get('/api/billing/ceiling');
    expect(res.status).toBe(200);
    expect(res.body.tier.id).toBe('free');
    expect(res.body.ceilingGb).toBe(250);
    expect(res.body.state).toBe('under');
    expect(res.body.topUp).toBeNull();
    expect(res.body.moveUp).toMatchObject({ tierId: 'small', monthlyEur: 5 });
    // No setup fee since the list of 2026-09-29: a move up has nothing to pay once.
    expect(res.body.moveUp).not.toHaveProperty('setupEur');
    expect(res.body.holds).toBe(true);
  });

  it('says near from 80% and reached at the ceiling', async () => {
    await moved(200);
    expect((await request(app).get('/api/billing/ceiling')).body.state).toBe('near');
    await moved(250);
    expect((await request(app).get('/api/billing/ceiling')).body.state).toBe('reached');
  });

  it('says the break-even when both ways on are offered, and none on Free', async () => {
    await moved(200);
    expect((await request(app).get('/api/billing/ceiling')).body.breakEven).toBeNull();
    await owner(
      `INSERT INTO data_allowance (tenant_id, kind, tier_id, band_gb, price_eur, consented_by)
       VALUES ($1, 'tier', 'small', $2, $3, 'earlier')`,
      [TENANT, small.dataGb, eur(small)],
    );
    await moved(700);
    const res = await request(app).get('/api/billing/ceiling');
    expect(res.body.tier).toMatchObject({ id: 'small', paths: small.paths, monthly: 5 });
    expect(res.body.breakEven).toMatchObject({
      extraOnceEur: eur(small),
      savedMonthlyEur: eur(medium) - eur(small),
    });
  });

  it('says the ceiling does not hold during the alpha (the owner, 2026-10-03: "A")', async () => {
    process.env.OWNPACE_STAGE = 'alpha';
    expect((await request(app).get('/api/billing/ceiling')).body.holds).toBe(false);
  });

  it('is for owners and admins, like the rest of billing', async () => {
    role = 'member';
    expect((await request(app).get('/api/billing/ceiling')).status).toBe(403);
  });
});

describe('POST /api/billing/ceiling/yes', () => {
  it('moves up to the tier offered, and the ceiling follows', async () => {
    await moved(240);
    const res = await request(app)
      .post('/api/billing/ceiling/yes')
      .send({ choice: 'move_up', tierId: 'small', priceEur: eur(small) });
    expect(res.status).toBe(200);
    expect(res.body.tier.id).toBe('small');
    expect(res.body.ceilingGb).toBe(small.dataGb);
    expect(res.body.state).toBe('under');
    const rows = await owner('SELECT kind, tier_id, band_gb, price_eur, consented_by FROM data_allowance');
    expect(rows.rows).toEqual([
      { kind: 'tier', tier_id: 'small', band_gb: small.dataGb, price_eur: eur(small), consented_by: 'the-owner' },
    ]);
  });

  it('buys a band on top, and never rewinds the meter', async () => {
    await owner(
      `INSERT INTO data_allowance (tenant_id, kind, tier_id, band_gb, price_eur, consented_by)
       VALUES ($1, 'tier', 'small', $2, $3, 'earlier')`,
      [TENANT, small.dataGb, eur(small)],
    );
    await moved(750);
    const res = await request(app)
      .post('/api/billing/ceiling/yes')
      .send({ choice: 'top_up', tierId: 'small', priceEur: eur(small) });
    expect(res.status).toBe(200);
    expect(res.body.tier.id).toBe('small');
    expect(res.body.ceilingGb).toBe(2 * small.dataGb);
    expect(res.body.topUps).toBe(1);
    expect(res.body.gbMoved).toBe(750);
  });

  it('refuses a price that is not the one offered, and says what is offered now', async () => {
    await moved(240);
    const res = await request(app)
      .post('/api/billing/ceiling/yes')
      .send({ choice: 'move_up', tierId: 'small', priceEur: eur(small) + 1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('offer_changed');
    expect(res.body.ceiling.moveUp.monthlyEur).toBe(eur(small));
    expect((await owner('SELECT count(*)::int AS n FROM data_allowance')).rows[0]).toEqual({ n: 0 });
  });

  it('refuses a top-up on Free', async () => {
    const res = await request(app).post('/api/billing/ceiling/yes').send({ choice: 'top_up', tierId: 'free', priceEur: 0 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('no_top_up_on_free');
  });

  it('takes no yes during the alpha, where nothing is charged', async () => {
    process.env.OWNPACE_STAGE = 'alpha';
    const res = await request(app)
      .post('/api/billing/ceiling/yes')
      .send({ choice: 'move_up', tierId: 'small', priceEur: eur(small) });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('nothing_charged_during_the_alpha');
    expect((await owner('SELECT count(*)::int AS n FROM data_allowance')).rows[0]).toEqual({ n: 0 });
  });

  it('takes one yes for two presses of the same offer', async () => {
    await moved(240);
    const yes = { choice: 'move_up', tierId: 'small', priceEur: eur(small) };
    const [a, b] = await Promise.all([
      request(app).post('/api/billing/ceiling/yes').send(yes),
      request(app).post('/api/billing/ceiling/yes').send(yes),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await owner('SELECT count(*)::int AS n FROM data_allowance')).rows[0]).toEqual({ n: 1 });
  });

  it('is for owners and admins', async () => {
    role = 'member';
    const res = await request(app)
      .post('/api/billing/ceiling/yes')
      .send({ choice: 'move_up', tierId: 'small', priceEur: eur(small) });
    expect(res.status).toBe(403);
  });

  it('reads and writes only its own organisation', async () => {
    tenant = OTHER;
    await moved(240, OTHER);
    await request(app).post('/api/billing/ceiling/yes').send({ choice: 'move_up', tierId: 'small', priceEur: eur(small) });
    tenant = TENANT;
    expect((await request(app).get('/api/billing/ceiling')).body.tier.id).toBe('free');
  });
});

describe('the table, on its own terms (managed 0037)', () => {
  it('refuses to be edited or emptied by the app', async () => {
    tenant = TENANT;
    await request(app).post('/api/billing/ceiling/yes').send({ choice: 'move_up', tierId: 'small', priceEur: eur(small) });
    const conn = await driver.acquire();
    try {
      await conn.query('BEGIN');
      await conn.query('SET LOCAL ROLE app_user');
      await conn.query(`SELECT set_config('app.current_tenant', $1, true)`, [TENANT]);
      await expect(conn.query(`UPDATE data_allowance SET price_eur = 0`)).rejects.toThrow(/permission denied/);
    } finally {
      await conn.query('ROLLBACK').catch(() => {});
      await conn.release();
    }
    const conn2 = await driver.acquire();
    try {
      await conn2.query('BEGIN');
      await conn2.query('SET LOCAL ROLE app_user');
      await conn2.query(`SELECT set_config('app.current_tenant', $1, true)`, [TENANT]);
      await expect(conn2.query(`DELETE FROM data_allowance`)).rejects.toThrow(/permission denied/);
    } finally {
      await conn2.query('ROLLBACK').catch(() => {});
      await conn2.release();
    }
  });

  it('refuses Free as a row, by either name: nobody moves up to it, and it has no top-up', async () => {
    for (const id of ['free', 'tiny']) {
      await expect(
        owner(
          `INSERT INTO data_allowance (tenant_id, kind, tier_id, band_gb, price_eur, consented_by)
           VALUES ($1, 'top_up', $2, 250, 0, 'x')`,
          [TENANT, id],
        ),
      ).rejects.toThrow(/data_allowance_tier_check/);
    }
  });

  it('a move up to Medium from Small is agreed at Medium\'s monthly, with nothing once', async () => {
    await owner(
      `INSERT INTO data_allowance (tenant_id, kind, tier_id, band_gb, price_eur, consented_by)
       VALUES ($1, 'tier', 'small', $2, $3, 'earlier')`,
      [TENANT, small.dataGb, eur(small)],
    );
    await moved(700);
    const res = await request(app)
      .post('/api/billing/ceiling/yes')
      .send({ choice: 'move_up', tierId: 'medium', priceEur: eur(medium) });
    expect(res.status).toBe(200);
    expect(res.body.tier.id).toBe('medium');
    const rows = await owner(`SELECT price_eur FROM data_allowance WHERE tier_id = 'medium'`);
    expect(rows.rows).toEqual([{ price_eur: 12 }]);
  });
});
