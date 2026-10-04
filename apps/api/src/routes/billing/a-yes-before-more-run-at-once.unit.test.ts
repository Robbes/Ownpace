// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A YES BEFORE MORE RUN AT ONCE (workplan 0109 T6, the path axis; the owner's
 * answers of 2026-10-04: one agreed tier for both axes, the question at
 * *Start* with both ways side by side, enforced by the server).
 *
 * The question *Start* asks before the press, and the yes that answers it,
 * over a real database with every migration applied:
 *  - the question is the server's own rule: the slots held, each migration's
 *    new ones, the smallest tier that runs it all and its monthly, and what
 *    fits now beside it;
 *  - a paused migration's paths kept their slots, so its resume takes none;
 *  - the yes is the same append-only row as a move up at the data ceiling,
 *    with `axis` `paths`, so the data ceiling moves with it;
 *  - nobody agrees to a price they were not shown, nothing is taken during
 *    the alpha, and two presses move up once;
 *  - another organisation's slots and migrations are not this one's.
 *
 * The refusal at the door, which this question asks ahead of, is held in
 * `../migrations/a-start-past-the-tier.unit.test.ts`.
 *
 * UUID family 0109f700-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations, MANAGED_TIERS } from '@openmig/managed';

const TENANT = '0109f700-e29b-41d4-a716-446655440001';
const OTHER = '0109f700-e29b-41d4-a716-446655440002';
const CONN = '0109f700-e29b-41d4-a716-446655440011';
const BOX = '0109f700-e29b-41d4-a716-446655440021';
const OTHER_CONN = '0109f700-e29b-41d4-a716-446655440012';
const OTHER_BOX = '0109f700-e29b-41d4-a716-446655440022';
/** Running already, with mail, calendar and contacts: three slots held. */
const RUNNING = '0109f700-e29b-41d4-a716-446655440031';
/** Never started (no path rows): mail and calendar. */
const TWO = '0109f700-e29b-41d4-a716-446655440032';
/** Never started: mail, calendar and contacts. */
const THREE = '0109f700-e29b-41d4-a716-446655440033';
/** Never started: mail. */
const ONE = '0109f700-e29b-41d4-a716-446655440036';
/** Paused after it ran, with mail and files: its two slots kept. */
const PAUSED = '0109f700-e29b-41d4-a716-446655440034';
const OTHER_MAPPING = '0109f700-e29b-41d4-a716-446655440035';

const free = MANAGED_TIERS[0]!;
const small = MANAGED_TIERS.find((t) => t.id === 'small')!;
const medium = MANAGED_TIERS.find((t) => t.id === 'medium')!;
/** A tier's monthly in whole euros: what a move up is agreed at. */
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

const yesTo = (tierId: string) =>
  owner(
    `INSERT INTO data_allowance (tenant_id, kind, tier_id, band_gb, price_eur, consented_by)
     VALUES ($1, 'tier', $2, 1, 0, 'earlier')`,
    [TENANT, tierId],
  );
const asked = (...ids: string[]) => request(app).get(`/api/billing/paths?starting=${ids.join(',')}`);

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  for (const [id, conn, box] of [
    [TENANT, CONN, BOX],
    [OTHER, OTHER_CONN, OTHER_BOX],
  ] as const) {
    await owner('INSERT INTO tenant (id, name) VALUES ($1, $2)', [id, `org ${id.slice(-2)}`]);
    await owner(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1, $2, 'source', 'imap', 'i', '{}'::jsonb, 'connected')`,
      [conn, id],
    );
    await owner(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
       VALUES ($1, $2, $3, 'user', 'm@example.invalid')`,
      [box, id, conn],
    );
  }
  const mappings: Array<[string, string, string, string, string[]]> = [
    [RUNNING, TENANT, BOX, 'active', ['email', 'calendar', 'contact']],
    // A migration set up and not yet started is paused, with no path rows.
    [TWO, TENANT, BOX, 'paused', ['email', 'calendar']],
    [THREE, TENANT, BOX, 'paused', ['email', 'calendar', 'contact']],
    [ONE, TENANT, BOX, 'paused', ['email']],
    [PAUSED, TENANT, BOX, 'paused', ['email', 'file']],
    [OTHER_MAPPING, OTHER, OTHER_BOX, 'active', ['email', 'calendar', 'contact']],
  ];
  for (const [id, org, box, status, domains] of mappings) {
    await owner(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status) VALUES ($1, $2, $3, $4)`,
      [id, org, box, status],
    );
    for (const domain of domains) {
      await owner(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1, $2, $3, true)`, [
        org,
        id,
        domain,
      ]);
    }
  }
  // The slots held: the running migration's three, the paused one's two, and
  // the other organisation's three, which are not this one's.
  for (const [org, id, domain, state] of [
    [TENANT, RUNNING, 'email', 'active'],
    [TENANT, RUNNING, 'calendar', 'active'],
    [TENANT, RUNNING, 'contact', 'active'],
    [TENANT, PAUSED, 'email', 'paused'],
    [TENANT, PAUSED, 'file', 'paused'],
    [OTHER, OTHER_MAPPING, 'email', 'active'],
    [OTHER, OTHER_MAPPING, 'calendar', 'active'],
    [OTHER, OTHER_MAPPING, 'contact', 'active'],
  ] as const) {
    await owner(`INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state) VALUES ($1, $2, $3, $4)`, [
      org,
      id,
      domain,
      state,
    ]);
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
});

afterEach(() => {
  delete process.env.OWNPACE_STAGE;
});

describe('GET /api/billing/paths: the question at Start', () => {
  it('is not asked when the start fits the agreed tier, and everything fits', async () => {
    await yesTo('medium');
    const res = await asked(TWO, THREE);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ holds: true, held: 5, after: 10, past: false, needs: null, reason: null });
    expect(res.body.tier).toEqual({ id: 'medium', name: medium.name, paths: medium.paths, monthlyEur: eur(medium) });
    expect(res.body.fits).toEqual([TWO, THREE]);
  });

  it('past the tier: the smallest tier that runs it all, its monthly, the sentence, and what fits now', async () => {
    await yesTo('small');
    // Five held, Small runs six: the two kinds of TWO do not fit, nor the three of THREE.
    const res = await asked(TWO, THREE);
    expect(res.body).toMatchObject({ held: 5, after: 10, past: true, fits: [] });
    expect(res.body.needs).toEqual({ id: 'medium', name: medium.name, paths: medium.paths, monthlyEur: eur(medium) });
    expect(res.body.reason).toContain('10 migrations at the same time');
  });

  it('says which fit beside the others, in the order asked', async () => {
    await yesTo('small');
    // Five held, Small runs six: TWO's two do not fit, ONE's one does after it.
    const res = await asked(TWO, ONE);
    expect(res.body).toMatchObject({ held: 5, after: 8, past: true, needs: { id: 'medium' }, fits: [ONE] });
  });

  it('lets a paused migration resume, though nothing else fits: it kept its slots', async () => {
    // On Free, which runs six, with five held.
    const res = await asked(TWO, PAUSED);
    expect(res.body).toMatchObject({ tier: { id: free.id, paths: free.paths }, held: 5, after: 7, past: true });
    // Seven at once is past the six Free and Small run.
    expect(res.body.needs.id).toBe('medium');
    expect(res.body.fits).toEqual([PAUSED]);
  });

  it('counts only this organisation: its slots and its migrations', async () => {
    await yesTo('small');
    const res = await asked(OTHER_MAPPING);
    expect(res.body).toMatchObject({ held: 5, after: 5, past: false, fits: [OTHER_MAPPING] });
  });

  it('still says the numbers during the alpha, where nothing waits for a yes', async () => {
    process.env.OWNPACE_STAGE = 'alpha';
    const res = await asked(TWO);
    expect(res.body).toMatchObject({ holds: false, past: true });
  });

  it('wants the migrations asked about, as ids', async () => {
    expect((await request(app).get('/api/billing/paths')).status).toBe(400);
    expect((await asked('not-an-id')).status).toBe(400);
  });

  it('is for owners and admins, like the rest of billing', async () => {
    role = 'member';
    expect((await asked(TWO)).status).toBe(403);
  });
});

describe('POST /api/billing/paths/yes', () => {
  it('moves up at the monthly shown, recorded as the path axis, and the data ceiling moves with it', async () => {
    const res = await request(app).post('/api/billing/paths/yes').send({ tierId: 'medium', priceEur: eur(medium) });
    expect(res.status).toBe(200);
    expect(res.body.tier).toEqual({ id: 'medium', name: medium.name, paths: medium.paths, monthlyEur: eur(medium) });
    const rows = await owner('SELECT kind, tier_id, band_gb, price_eur, consented_by, axis FROM data_allowance');
    expect(rows.rows).toEqual([
      {
        kind: 'tier',
        tier_id: 'medium',
        band_gb: medium.dataGb,
        price_eur: eur(medium),
        consented_by: 'the-owner',
        axis: 'paths',
      },
    ]);
    // One agreed tier for both axes (the owner's "A").
    const ceiling = await request(app).get('/api/billing/ceiling');
    expect(ceiling.body.tier.id).toBe('medium');
    expect(ceiling.body.ceilingGb).toBe(medium.dataGb);
    // And the question is answered: the start fits now.
    expect((await asked(TWO, THREE)).body).toMatchObject({ past: false, fits: [TWO, THREE] });
  });

  it('refuses a price that is not the one shown, and keeps nothing', async () => {
    const res = await request(app).post('/api/billing/paths/yes').send({ tierId: 'medium', priceEur: eur(medium) + 1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('offer_changed');
    expect((await owner('SELECT count(*)::int AS n FROM data_allowance')).rows[0]).toEqual({ n: 0 });
  });

  it('refuses a tier that is not a step up', async () => {
    await yesTo('medium');
    const res = await request(app).post('/api/billing/paths/yes').send({ tierId: 'small', priceEur: eur(small) });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_a_step_up');
  });

  it('takes no yes during the alpha, where nothing is charged', async () => {
    process.env.OWNPACE_STAGE = 'alpha';
    const res = await request(app).post('/api/billing/paths/yes').send({ tierId: 'small', priceEur: eur(small) });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('nothing_charged_during_the_alpha');
    expect((await owner('SELECT count(*)::int AS n FROM data_allowance')).rows[0]).toEqual({ n: 0 });
  });

  it('takes one yes for two presses of the same offer', async () => {
    const yes = { tierId: 'medium', priceEur: eur(medium) };
    const [a, b] = await Promise.all([
      request(app).post('/api/billing/paths/yes').send(yes),
      request(app).post('/api/billing/paths/yes').send(yes),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await owner('SELECT count(*)::int AS n FROM data_allowance')).rows[0]).toEqual({ n: 1 });
  });

  it('wants the tier and the price', async () => {
    expect((await request(app).post('/api/billing/paths/yes').send({ tierId: 'small' })).status).toBe(400);
  });

  it('is for owners and admins', async () => {
    role = 'member';
    const res = await request(app).post('/api/billing/paths/yes').send({ tierId: 'small', priceEur: eur(small) });
    expect(res.status).toBe(403);
  });
});
