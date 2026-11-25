// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GIFT TURNED INTO A REQUEST (workplan 0172 §2, items 2 and 3; the owner,
 * 2026-11-24, G1: "a redeemed gift does not let anyone in by itself").
 *
 * The whole road, over HTTP, against PGlite with both chains: Anna gives a
 * gift; Cato types its code at the door; the operator's access queue shows a
 * request from Cato marked as a gift from Anna; the operator grants it like
 * any other; and Cato gets an organisation of their own. Not a seat in
 * Anna's: Anna's organisation has the same members after as before.
 *
 * Nothing about the grant route changed for gifts, and that is what this
 * holds: a gift request is an access request, so it is granted by the same
 * route and can only ever make a new organisation.
 *
 * UUID family 01720000-…-4466554419xx.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';

const ANNAS = '01720000-e29b-41d4-a716-446655441901';
const ANNA = 'subject-anna-0172-road';
const OPERATOR = 'subject-operator-0172-road';
const BRAMS = '01720000-e29b-41d4-a716-446655441902';
const BRAM = 'subject-bram-0172-road';

let driver: LedgerDriver;
let caller: { userId: string; tenantId?: string } | undefined;

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  const stand = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!caller) return void res.status(401).json({ error: 'Unauthorized' });
    Object.assign(req, caller);
    next();
  };
  return { ...actual, authenticate: stand, authenticateSubject: stand, getDbPool: () => driver };
});

const { default: giftRoutes } = await import('./gifts.ts');
const { default: accessRoutes } = await import('./access-requests.ts');

const app = express();
app.use(express.json());
app.use('/api/gifts', giftRoutes);
app.use('/api/access-requests', accessRoutes);

async function rows(text: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(text, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  // The access queue's anonymous door uses drizzle over the pool directly;
  // the shim `access-request-grant-alpha.unit.test.ts` uses, for the same reason.
  (driver as unknown as { query: unknown }).query = async (
    textOrConfig: string | { text: string; values?: unknown[] },
    maybeValues?: unknown[],
  ): Promise<unknown> => {
    const text = typeof textOrConfig === 'string' ? textOrConfig : textOrConfig.text;
    const values = maybeValues ?? (typeof textOrConfig === 'string' ? [] : (textOrConfig.values ?? []));
    const conn = await driver.acquire();
    try {
      return await conn.query(text, values);
    } finally {
      await conn.release();
    }
  };
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await rows(`INSERT INTO tenant (id, name) VALUES ($1, 'De Vries')`, [ANNAS]);
  await rows(
    `INSERT INTO tenant_member (tenant_id, user_id, email, role, status)
     VALUES ($1, $2, 'anna@example.com', 'owner', 'active')`,
    [ANNAS, ANNA],
  );
  await rows(`INSERT INTO platform_operator (user_id, email) VALUES ($1, 'operator@example.com')`, [OPERATOR]);
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe('a gift, from the card to an organisation of their own', () => {
  it('shows in the queue marked as a gift from the giver, and granting it makes a new organisation', async () => {
    caller = { userId: ANNA, tenantId: ANNAS };
    const made = await request(app).post('/api/gifts').send({ locale: 'nl' });
    expect(made.status).toBe(201);

    caller = undefined;
    const redeemed = await request(app)
      .post('/api/gifts/redeem')
      .send({ code: made.body.code, email: 'cato@example.com', name: 'Cato', locale: 'nl' });
    expect(redeemed.status).toBe(201);

    caller = { userId: OPERATOR };
    const queue = await request(app).get('/api/access-requests?state=open');
    expect(queue.status).toBe(200);
    expect(queue.body.requests).toHaveLength(1);
    const asked = queue.body.requests[0];
    expect(asked).toMatchObject({ email: 'cato@example.com', name: 'Cato', locale: 'nl', gift: { from: 'anna@example.com' } });

    // A request that came without a gift carries no mark.
    caller = undefined;
    expect((await request(app).post('/api/access-requests').send({ email: 'dirk@example.com' })).status).toBe(201);
    caller = { userId: OPERATOR };
    const both = await request(app).get('/api/access-requests?state=open');
    const dirk = both.body.requests.find((r: { email: string }) => r.email === 'dirk@example.com');
    expect(dirk.gift).toBeNull();

    const membersBefore = await rows('SELECT user_id, email FROM tenant_member WHERE tenant_id = $1', [ANNAS]);
    const granted = await request(app).post(`/api/access-requests/${asked.id as string}/grant`).send({});
    expect(granted.status, JSON.stringify(granted.body)).toBe(201);
    expect(granted.body.tenantId).not.toBe(ANNAS);

    const theirs = await rows('SELECT email, role, status, origin FROM tenant_member WHERE tenant_id = $1', [
      granted.body.tenantId,
    ]);
    expect(theirs).toEqual([{ email: 'cato@example.com', role: 'owner', status: 'invited', origin: 'requested' }]);
    expect(await rows('SELECT user_id, email FROM tenant_member WHERE tenant_id = $1', [ANNAS])).toEqual(membersBefore);

    // The gift stays redeemed, pointing at the granted request.
    caller = { userId: OPERATOR };
    const gifts = await request(app).get('/api/gifts/operator');
    expect(gifts.body.gifts[0]).toMatchObject({ state: 'redeemed', request: { state: 'granted' } });
    expect(gifts.body.alpha).toMatchObject({ granted: 1, openFromGifts: 0 });

    // Granted, the gift keeps its place: Anna has given hers.
    caller = { userId: ANNA, tenantId: ANNAS };
    expect((await request(app).get('/api/gifts/mine')).body).toMatchObject({ limit: 1, held: 1 });
    expect((await request(app).post('/api/gifts').send({ locale: 'nl' })).status).toBe(409);
  });

  it('declined, the request gives the giver their gift back (the owner, 2026-11-25)', async () => {
    await rows(`INSERT INTO tenant (id, name) VALUES ($1, 'Jansen')`, [BRAMS]);
    await rows(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status)
       VALUES ($1, $2, 'bram@example.com', 'owner', 'active')`,
      [BRAMS, BRAM],
    );
    caller = { userId: BRAM, tenantId: BRAMS };
    const made = await request(app).post('/api/gifts').send({ locale: 'en' });
    expect(made.status).toBe(201);

    caller = undefined;
    const redeemed = await request(app)
      .post('/api/gifts/redeem')
      .send({ code: made.body.code, email: 'eva@example.com', locale: 'en' });
    expect(redeemed.status).toBe(201);

    caller = { userId: BRAM, tenantId: BRAMS };
    expect((await request(app).get('/api/gifts/mine')).body).toMatchObject({ limit: 1, held: 1 });
    expect((await request(app).post('/api/gifts').send({ locale: 'en' })).status).toBe(409);

    caller = { userId: OPERATOR };
    const queue = await request(app).get('/api/access-requests?state=open');
    const eva = queue.body.requests.find((r: { email: string }) => r.email === 'eva@example.com');
    expect(eva.gift).toEqual({ from: 'bram@example.com' });
    const declined = await request(app).post(`/api/access-requests/${eva.id as string}/decline`).send({ notify: false });
    expect(declined.status, JSON.stringify(declined.body)).toBe(200);

    // The decline itself is as before: the request is declined and kept.
    expect(await rows('SELECT state FROM access_request WHERE id = $1', [eva.id])).toEqual([{ state: 'declined' }]);

    // The gift reads as used, and no longer counts: Bram may make another.
    caller = { userId: BRAM, tenantId: BRAMS };
    const mine = await request(app).get('/api/gifts/mine');
    expect(mine.body).toMatchObject({ limit: 1, held: 0 });
    expect(mine.body.gifts).toHaveLength(1);
    expect(mine.body.gifts[0].state).toBe('redeemed');
    expect((await request(app).post('/api/gifts').send({ locale: 'en' })).status).toBe(201);
    expect((await request(app).post('/api/gifts').send({ locale: 'en' })).status).toBe(409);
  });
});
