// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ORDER THAT ASKS TO BEGIN (workplan 0111, T7, slice 7e; terms §6, §7,
 * 1.5): the three order buttons, the data ceiling's, *Start*'s and a pick's,
 * over a real database with every migration applied.
 *
 *  - `GET /api/billing/withdrawal` says whether a yes given now begins within
 *    a withdrawal window: for a consumer on Free, yes; for a business, no;
 *  - a consumer's yes from a page that said the sentence (`beginNow`) records
 *    the request, and the withdrawal after it bills the days used; a yes
 *    without it records none;
 *  - a business's yes never records it, whatever the page sent;
 *  - each order is confirmed by email to the signed-in address, in the
 *    organisation's language: what, at which price, when, how to withdraw
 *    while the fourteen days run, and the request when it was made; a pick
 *    that orders nothing confirms nothing; a mail that did not go leaves the
 *    order standing.
 *
 * UUID family 01117e00-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { MANAGED_TIERS, monthlyEur, runManagedMigrations } from '@openmig/managed';
import { log, type NotificationEvent, type NotificationLocale } from '@openmig/shared';

const CONSUMER = '01117e00-e29b-41d4-a716-446655440001';
const NOT_ASKED = '01117e00-e29b-41d4-a716-446655440002';
const BUSINESS = '01117e00-e29b-41d4-a716-446655440003';
const PICKS = '01117e00-e29b-41d4-a716-446655440004';
const STARTS = '01117e00-e29b-41d4-a716-446655440005';

let driver: LedgerDriver;
let current = CONSUMER;

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: current, userId: 'the-owner', userRole: 'owner', userEmail: 'sam@example.invalid' });
      next();
    },
    getDbPool: () => driver,
  };
});

const told: Array<{ to: string; locale: NotificationLocale; event: NotificationEvent }> = [];
let mailAnswer: 'sent' | 'off' | 'failed' = 'sent';
vi.mock('../../access-notify.ts', () => ({
  tell: async (to: string, locale: NotificationLocale, event: NotificationEvent) => {
    told.push({ to, locale, event });
    return mailAnswer;
  },
}));

const { default: billingRoutes } = await import('./index.ts');

const app = express();
app.use(express.json());
app.use('/api/billing', billingRoutes);

const SMALL = monthlyEur(MANAGED_TIERS.find((t) => t.id === 'small')!);
// Small runs no more at the same time than Free: at Start the step up is Medium.
const MEDIUM = monthlyEur(MANAGED_TIERS.find((t) => t.id === 'medium')!);

async function owner(sql: string, params: unknown[] = []) {
  const conn = await driver.acquire();
  try {
    return await conn.query(sql, params);
  } finally {
    await conn.release();
  }
}

const yeses = async (tenant: string) =>
  (await owner(`SELECT axis, began_on_request FROM data_allowance WHERE tenant_id = $1 ORDER BY consented_at`, [tenant]))
    .rows;

async function organisation(id: string, name: string, kind: 'consumer' | 'business', locale: NotificationLocale) {
  await owner(`INSERT INTO tenant (id, name, settings) VALUES ($1, $2, $3)`, [
    id,
    name,
    JSON.stringify({ notifications: { locale } }),
  ]);
  await owner(
    `INSERT INTO billing_party (tenant_id, kind, name, address_line1, postal_code, city, country_code)
     VALUES ($1, $2, $3, 'Dorpsstraat 1', '1234 AB', 'Ons Dorp', 'NL')`,
    [id, kind, name],
  );
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await organisation(CONSUMER, 'De Vries thuis', 'consumer', 'nl');
  await organisation(NOT_ASKED, 'Jansen thuis', 'consumer', 'en');
  await organisation(BUSINESS, 'Jansen Advies BV', 'business', 'en');
  await organisation(PICKS, 'Bakker thuis', 'consumer', 'en');
  await organisation(STARTS, 'Visser thuis', 'consumer', 'en');
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

afterEach(() => {
  delete process.env.OWNPACE_STAGE;
  told.length = 0;
  mailAnswer = 'sent';
  vi.restoreAllMocks();
});

describe('the order buttons ask to begin, without a tick box', () => {
  it('says a yes now asks to begin for a consumer on Free, and not for a business', async () => {
    current = CONSUMER;
    expect((await request(app).get('/api/billing/withdrawal')).body).toMatchObject({ open: false, yesAsksToBegin: true });
    current = BUSINESS;
    expect((await request(app).get('/api/billing/withdrawal')).body).toMatchObject({ open: false, yesAsksToBegin: false });
  });

  it('records the request with a consumer’s yes, confirms the order in Dutch, and bills the days used on withdrawal', async () => {
    current = CONSUMER;
    const res = await request(app)
      .post('/api/billing/ceiling/yes')
      .send({ choice: 'move_up', tierId: 'small', priceEur: SMALL, beginNow: true });

    expect(res.status).toBe(200);
    expect(await yeses(CONSUMER)).toEqual([{ axis: 'data', began_on_request: true }]);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({
      to: 'sam@example.invalid',
      locale: 'nl',
      event: {
        kind: 'order_confirmed',
        organisation: 'De Vries thuis',
        order: { kind: 'tier', tier: 'Small', monthly: expect.stringContaining(String(SMALL)) },
        beganOnRequest: true,
        terms: 'https://www.ownpace.eu/nl/voorwaarden.html',
      },
    });
    const event = told[0]!.event as Extract<NotificationEvent, { kind: 'order_confirmed' }>;
    expect(event.withdrawUntil).toMatch(/\d{4}$/);
    expect(event.orderedAt).toContain('UTC');

    // Within the window the next yes asks too, and once withdrawn the days used are billed.
    expect((await request(app).get('/api/billing/withdrawal')).body).toMatchObject({ open: true, yesAsksToBegin: true });
    const withdrawn = await request(app)
      .post('/api/billing/withdrawal')
      .send({ name: 'Sam de Vries', confirmTo: 'sam@example.invalid' });
    expect(withdrawn.body).toMatchObject({ beganOnRequest: true });
  });

  it('records none when the page did not say the sentence, and the mail says the days used cost nothing', async () => {
    current = NOT_ASKED;
    const res = await request(app).post('/api/billing/ceiling/yes').send({ choice: 'move_up', tierId: 'small', priceEur: SMALL });

    expect(res.status).toBe(200);
    expect(await yeses(NOT_ASKED)).toEqual([{ axis: 'data', began_on_request: false }]);
    expect(told[0]).toMatchObject({
      locale: 'en',
      event: { kind: 'order_confirmed', beganOnRequest: false, terms: 'https://www.ownpace.eu/terms.html' },
    });
    expect((told[0]!.event as { withdrawUntil: string | null }).withdrawUntil).not.toBeNull();
  });

  it('never records it for a business, and its confirmation says nothing of withdrawing', async () => {
    current = BUSINESS;
    const res = await request(app)
      .post('/api/billing/ceiling/yes')
      .send({ choice: 'move_up', tierId: 'small', priceEur: SMALL, beginNow: true });

    expect(res.status).toBe(200);
    expect(await yeses(BUSINESS)).toEqual([{ axis: 'data', began_on_request: false }]);
    expect(told[0]).toMatchObject({ event: { kind: 'order_confirmed', withdrawUntil: null, beganOnRequest: false } });
  });

  it('asks at a pick above the agreed tier, and a pick that orders nothing confirms nothing', async () => {
    current = PICKS;
    const raised = await request(app).post('/api/billing/pick').send({ tierId: 'small', priceEur: SMALL, beginNow: true });

    expect(raised.status).toBe(200);
    expect(await yeses(PICKS)).toEqual([{ axis: 'pick', began_on_request: true }]);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ event: { kind: 'order_confirmed', order: { kind: 'tier', tier: 'Small' }, beganOnRequest: true } });

    // Dropping the pick orders nothing: no yes, and no mail.
    const dropped = await request(app).post('/api/billing/pick').send({ tierId: 'free', priceEur: 0 });
    expect(dropped.status).toBe(200);
    expect(await yeses(PICKS)).toHaveLength(1);
    expect(told).toHaveLength(1);
  });

  it('asks at Start, and an order whose mail did not go stands, and is said for the operator', async () => {
    current = STARTS;
    mailAnswer = 'failed';
    const said = vi.spyOn(log, 'error').mockImplementation(() => {});
    const res = await request(app).post('/api/billing/paths/yes').send({ tierId: 'medium', priceEur: MEDIUM, beginNow: true });

    expect(res.status).toBe(200);
    expect(await yeses(STARTS)).toEqual([{ axis: 'paths', began_on_request: true }]);
    expect(told).toHaveLength(1);
    expect(said.mock.calls.flat().join(' ')).toContain('its confirmation was not sent (failed)');
  });

  it('takes nothing but true for beginNow', async () => {
    current = NOT_ASKED;
    const res = await request(app)
      .post('/api/billing/ceiling/yes')
      .send({ choice: 'top_up', tierId: 'small', priceEur: SMALL, beginNow: 'yes' });
    expect(res.status).toBe(400);
  });
});
