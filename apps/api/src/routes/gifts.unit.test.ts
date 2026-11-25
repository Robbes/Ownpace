// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * GIFTS, OVER HTTP (workplan 0172): `routes/gifts.ts` end to end, against
 * PGlite as `app_user` with both chains, as `access-request-grant-alpha` drives
 * the grant route. Only who is calling is stood in for.
 *
 *  - the giver makes one gift, sees its code once, and is refused a second;
 *  - the giver revokes their own unused gift, not somebody else's;
 *  - every bad code at the door answers the SAME 410 body: unknown,
 *    malformed, used, revoked, expired;
 *  - the door's rate limit, its trap, and an address with an open request;
 *  - the operator sees every gift with its giver and the alpha's count,
 *    revokes, and changes the limit for everyone and for one person; a
 *    member who is not an operator sees nothing and changes nothing.
 *
 * UUID family 01720000-…-4466554418xx.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { GIFT_REFUSAL, runManagedMigrations } from '@openmig/managed';

const P = '01720000-e29b-41d4-a716-4466554418';
const OURS = `${P}01`;
const OTHER = `${P}02`;
const ANNA = 'subject-anna-0172-http';
const BRAM = 'subject-bram-0172-http';
const OPERATOR = 'subject-operator-0172-http';

let driver: LedgerDriver;
/** Who is calling, as the real middleware would have resolved them. */
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

const { default: giftRoutes, __resetGiftLimiterForTests, GIFT_REDEEM_LIMIT } = await import('./gifts.ts');

const app = express();
app.use(express.json());
app.use('/api/gifts', giftRoutes);

async function rows(text: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(text, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

const as = (who: typeof caller) => {
  caller = who;
};
const anna = { userId: ANNA, tenantId: OURS };
const bram = { userId: BRAM, tenantId: OTHER };
const operator = { userId: OPERATOR };

async function makeOne(who = anna): Promise<{ id: string; code: string }> {
  as(who);
  const res = await request(app).post('/api/gifts').send({ locale: 'nl' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; code: string };
}

const redeem = (code: string, email = 'cato@example.com', extra: Record<string, unknown> = {}) => {
  as(undefined);
  return request(app).post('/api/gifts/redeem').send({ code, email, locale: 'nl', ...extra });
};

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await rows(`INSERT INTO tenant (id, name) VALUES ($1, 'De Vries'), ($2, 'Jansen')`, [OURS, OTHER]);
  await rows(
    `INSERT INTO tenant_member (tenant_id, user_id, email, role, status)
     VALUES ($1, $2, 'anna@example.com', 'owner', 'active'), ($3, $4, 'bram@example.com', 'owner', 'active')`,
    [OURS, ANNA, OTHER, BRAM],
  );
  await rows(`INSERT INTO platform_operator (user_id, email) VALUES ($1, 'operator@example.com')`, [OPERATOR]);
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  __resetGiftLimiterForTests();
  await rows('DELETE FROM gift');
  await rows('DELETE FROM gift_allowance');
  await rows('UPDATE gift_rule SET gifts_per_person = 1');
  await rows('DELETE FROM access_request');
});

describe('the giver', () => {
  it('makes one gift and sees its code once; the list never shows it', async () => {
    const made = await makeOne();
    expect(made.code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
    as(anna);
    const mine = await request(app).get('/api/gifts/mine');
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ limit: 1, held: 1 });
    expect(mine.body.gifts).toHaveLength(1);
    expect(mine.body.gifts[0]).toMatchObject({ id: made.id, state: 'unused', locale: 'nl' });
    expect(JSON.stringify(mine.body)).not.toContain(made.code.replace(/-/g, '').slice(0, 8));
  });

  it('is refused a second while the first holds the place', async () => {
    await makeOne();
    as(anna);
    const second = await request(app).post('/api/gifts').send({ locale: 'en' });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: 'gift_limit', limit: 1 });
  });

  it('revokes their own unused gift, and may then make another; not somebody else’s', async () => {
    const made = await makeOne();
    as(bram);
    expect((await request(app).post(`/api/gifts/${made.id}/revoke`)).status).toBe(404);
    as(anna);
    expect((await request(app).post(`/api/gifts/${made.id}/revoke`)).status).toBe(200);
    expect((await request(app).post(`/api/gifts/${made.id}/revoke`)).status).toBe(409);
    expect((await request(app).post('/api/gifts').send({})).status).toBe(201);
  });

  it('cannot make one without signing in', async () => {
    as(undefined);
    expect((await request(app).post('/api/gifts').send({})).status).toBe(401);
  });
});

describe('the door', () => {
  it('turns a code into a request, once', async () => {
    const { code } = await makeOne();
    const first = await redeem(code.toLowerCase());
    expect(first.status).toBe(201);
    expect(first.body).toEqual({ received: true, message: 'Thank you — we have your request. You will hear back by email.' });
    expect(await rows('SELECT email, state FROM access_request')).toEqual([{ email: 'cato@example.com', state: 'open' }]);
  });

  it('answers every bad code with the same body: unknown, malformed, used, revoked, expired', async () => {
    const used = await makeOne();
    expect((await redeem(used.code)).status).toBe(201);

    const revoked = await makeOne(bram);
    as(bram);
    await request(app).post(`/api/gifts/${revoked.id}/revoke`);

    await rows('UPDATE gift_rule SET gifts_per_person = 5');
    const expired = await makeOne(bram);
    await rows("UPDATE gift SET expires_at = now() - interval '1 day' WHERE id = $1", [expired.id]);

    const bodies = new Set<string>();
    for (const code of ['ZZZZ-ZZZZ-ZZZZ-ZZZZ', 'not a code at all', used.code, revoked.code, expired.code]) {
      const res = await redeem(code, 'dirk@example.com');
      expect(res.status, code).toBe(410);
      bodies.add(JSON.stringify(res.body));
    }
    expect([...bodies]).toEqual([
      JSON.stringify({ error: 'gift_refused', reason: GIFT_REFUSAL.en, reasonNl: GIFT_REFUSAL.nl }),
    ]);
    expect(await rows("SELECT 1 FROM access_request WHERE email = 'dirk@example.com'")).toHaveLength(0);
  });

  it('says so to an address with an open request, writes nothing, and leaves the gift unspent', async () => {
    await rows(`INSERT INTO access_request (email, locale) VALUES ('cato@example.com', 'en')`);
    const { code, id } = await makeOne();
    const res = await redeem(code);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('already_asked');
    expect((await rows('SELECT redeemed_at FROM gift WHERE id = $1', [id]))[0]!.redeemed_at).toBeNull();
  });

  it('answers a filled trap as received and keeps nothing', async () => {
    const { code, id } = await makeOne();
    const res = await redeem(code, 'cato@example.com', { website: 'https://spam.example' });
    expect(res.status).toBe(201);
    expect(await rows('SELECT 1 FROM access_request')).toHaveLength(0);
    expect((await rows('SELECT redeemed_at FROM gift WHERE id = $1', [id]))[0]!.redeemed_at).toBeNull();
  });

  it('refuses past its rate limit with Retry-After', async () => {
    for (let i = 0; i < GIFT_REDEEM_LIMIT.max; i++) expect((await redeem('ZZZZ-ZZZZ-ZZZZ-ZZZZ')).status).toBe(410);
    const over = await redeem('ZZZZ-ZZZZ-ZZZZ-ZZZZ');
    expect(over.status).toBe(429);
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('the operator', () => {
  it('sees every gift with its giver, the request it became, and the alpha’s count', async () => {
    const { code } = await makeOne();
    await makeOne(bram);
    await redeem(code);
    await rows(`INSERT INTO access_request (email, locale, state, decided_at, decided_by, tenant_id)
                VALUES ('earlier@example.com', 'en', 'granted', now(), 'op', $1)`, [OTHER]);
    as(operator);
    const res = await request(app).get('/api/gifts/operator');
    expect(res.status).toBe(200);
    expect(res.body.gifts).toHaveLength(2);
    const annas = res.body.gifts.find((g: { giverEmail: string }) => g.giverEmail === 'anna@example.com');
    expect(annas).toMatchObject({ state: 'redeemed', organisation: 'De Vries', request: { state: 'open', email: 'cato@example.com' } });
    expect(res.body.alpha).toEqual({ granted: 1, open: 1, openFromGifts: 1, unusedGifts: 1 });
    expect(res.body.giftsPerPerson).toBe(1);
  });

  it('revokes a gift, and changes the limit for everyone and for one person', async () => {
    const { id } = await makeOne();
    as(operator);
    expect((await request(app).post(`/api/gifts/operator/${id}/revoke`)).status).toBe(200);
    expect((await request(app).put('/api/gifts/operator/rule').send({ giftsPerPerson: 0 })).status).toBe(200);
    as(bram);
    expect((await request(app).post('/api/gifts').send({})).status).toBe(409);
    as(operator);
    const set = await request(app).put('/api/gifts/operator/allowance').send({ email: 'BRAM@example.com ', gifts: 2 });
    expect(set.status).toBe(200);
    expect(set.body).toEqual({ gifts: 2, people: 1 });
    as(bram);
    expect((await request(app).post('/api/gifts').send({})).status).toBe(201);
    as(operator);
    const listed = await request(app).get('/api/gifts/operator');
    expect(listed.body.allowances).toMatchObject([{ email: 'bram@example.com', gifts: 2 }]);
    expect((await request(app).put('/api/gifts/operator/allowance').send({ email: 'nobody@example.com', gifts: 2 })).status).toBe(404);
    expect((await request(app).put('/api/gifts/operator/allowance').send({ email: 'bram@example.com', gifts: null })).status).toBe(200);
    expect(await rows('SELECT 1 FROM gift_allowance')).toHaveLength(0);
  });

  it('a member who is not an operator sees nothing and changes nothing', async () => {
    const { id } = await makeOne(bram);
    as(anna);
    const res = await request(app).get('/api/gifts/operator');
    expect(res.body.gifts).toEqual([]);
    expect((await request(app).post(`/api/gifts/operator/${id}/revoke`)).status).toBe(404);
    expect((await request(app).put('/api/gifts/operator/rule').send({ giftsPerPerson: 9 })).status).toBe(404);
    expect((await request(app).put('/api/gifts/operator/allowance').send({ email: 'anna@example.com', gifts: 9 })).status).toBe(404);
    expect((await rows('SELECT gifts_per_person FROM gift_rule'))[0]!.gifts_per_person).toBe(1);
  });
});
