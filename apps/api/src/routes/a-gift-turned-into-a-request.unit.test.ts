// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CODE THAT LETS ITS PERSON IN (workplan 0177 §5; the owner, 2026-11-26,
 * D6: *"one needs to be allow in straight away"*). Turned round from 0172's
 * *a gift turned into a request*, whose G1 said a redeemed gift lets nobody in
 * by itself; for a free one that no longer holds.
 *
 * The whole road, over HTTP, against PGlite with both chains: Anna makes a
 * card; Cato types its code at the door; Cato is let in at once, in one
 * transaction: a request granted by nobody, an organisation of Cato's own and
 * its owner's invitation, and the code spent. Or none of the three. Never a
 * seat in Anna's organisation: Anna's has the same members after as before.
 *
 * An address with a request waiting has that one granted, and no second one
 * is written (D15 (a)). A request made with a code before 0177 is still the
 * owner's to answer, and declined it gives the giver their gift back (0172).
 *
 * UUID family 01720000-…-4466554419xx.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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

/** The three things a let-in writes, and the codes spent, counted as the owner. */
const written = async () =>
  (
    await rows(`SELECT (SELECT count(*)::int FROM access_request) AS requests,
                       (SELECT count(*)::int FROM tenant) AS tenants,
                       (SELECT count(*)::int FROM tenant_member) AS members,
                       (SELECT count(*)::int FROM gift WHERE redeemed_at IS NOT NULL) AS spent`)
  )[0];

async function card(who = { userId: ANNA, tenantId: ANNAS }): Promise<{ id: string; code: string }> {
  caller = who;
  const made = await request(app).post('/api/gifts').send({ locale: 'nl' });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  return made.body as { id: string; code: string };
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
  await rows(`INSERT INTO tenant (id, name) VALUES ($1, 'De Vries'), ($2, 'Jansen')`, [ANNAS, BRAMS]);
  await rows(
    `INSERT INTO tenant_member (tenant_id, user_id, email, role, status)
     VALUES ($1, $2, 'anna@example.com', 'owner', 'active'), ($3, $4, 'bram@example.com', 'owner', 'active')`,
    [ANNAS, ANNA, BRAMS, BRAM],
  );
  await rows(`INSERT INTO platform_operator (user_id, email) VALUES ($1, 'operator@example.com')`, [OPERATOR]);
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  await rows('DELETE FROM gift');
  await rows('DELETE FROM access_request');
  await rows('DELETE FROM tenant_member WHERE tenant_id NOT IN ($1, $2)', [ANNAS, BRAMS]);
  await rows('DELETE FROM tenant WHERE id NOT IN ($1, $2)', [ANNAS, BRAMS]);
});

describe('a code, from the card to an organisation of their own (0177 D6)', () => {
  it('makes a request granted by nobody, a new organisation and its owner’s invitation; never a seat in the giver’s', async () => {
    const made = await card();
    const membersBefore = await rows('SELECT user_id, email FROM tenant_member WHERE tenant_id = $1', [ANNAS]);

    caller = undefined;
    const used = await request(app)
      .post('/api/gifts/redeem')
      .send({ code: made.code, email: 'cato@example.com', name: 'Cato', locale: 'nl', google: false });
    expect(used.status, JSON.stringify(used.body)).toBe(201);
    expect(used.body.letIn).toBe(true);

    // The queue shows it granted, marked as let in by Anna's recommendation, and decided by nobody.
    caller = { userId: OPERATOR };
    const queue = await request(app).get('/api/access-requests?state=granted');
    expect(queue.status).toBe(200);
    expect(queue.body.requests).toHaveLength(1);
    const asked = queue.body.requests[0];
    expect(asked).toMatchObject({
      email: 'cato@example.com',
      name: 'Cato',
      locale: 'nl',
      state: 'granted',
      decidedBy: null,
      gift: { from: 'anna@example.com' },
      letInByRecommendation: true,
    });
    expect(asked.tenantId).not.toBe(ANNAS);
    expect(await rows('SELECT name FROM tenant WHERE id = $1', [asked.tenantId])).toEqual([{ name: 'Cato' }]);
    expect(await rows('SELECT email, role, status, origin FROM tenant_member WHERE tenant_id = $1', [asked.tenantId])).toEqual([
      { email: 'cato@example.com', role: 'owner', status: 'invited', origin: 'requested' },
    ]);
    expect(await rows('SELECT user_id, email FROM tenant_member WHERE tenant_id = $1', [ANNAS])).toEqual(membersBefore);

    // Nothing waits for the owner: the queue's open requests are empty, and granting it again is refused.
    expect((await request(app).get('/api/access-requests?state=open')).body.requests).toEqual([]);
    expect((await request(app).post(`/api/access-requests/${asked.id as string}/grant`).send({})).status).toBe(409);

    // The gift stays redeemed, pointing at the granted request; Anna has given hers.
    const gifts = await request(app).get('/api/gifts/operator');
    expect(gifts.body.gifts[0]).toMatchObject({ state: 'redeemed', request: { state: 'granted' } });
    caller = { userId: ANNA, tenantId: ANNAS };
    expect((await request(app).get('/api/gifts/mine')).body).toMatchObject({ limit: 1, held: 1 });
    expect((await request(app).post('/api/gifts').send({ locale: 'nl' })).status).toBe(409);
  });

  it('or none of the three: a refused code, a full Alpha and an address already in write nothing', async () => {
    const made = await card();
    const before = await written();
    caller = undefined;
    const door = (body: Record<string, unknown>) =>
      request(app).post('/api/gifts/redeem').send({ locale: 'en', google: false, ...body });

    expect((await door({ code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ', email: 'dirk@example.com' })).status).toBe(410);
    expect((await door({ code: made.code, email: 'bram@example.com' })).status).toBe(409);
    await rows('UPDATE gift_rule SET recommendation_ceiling = 0');
    expect((await door({ code: made.code, email: 'dirk@example.com' })).status).toBe(409);
    await rows('UPDATE gift_rule SET recommendation_ceiling = 50');
    expect(await written()).toEqual(before);
  });

  it('an address with a request waiting gets that one granted, and no second one (D15 (a))', async () => {
    caller = undefined;
    expect(
      (
        await request(app)
          .post('/api/access-requests')
          .send({ email: 'dirk@example.com', organisation: 'Bakkerij Dirk', note: 'Two mailboxes', locale: 'nl' })
      ).status,
    ).toBe(201);
    const [waiting] = await rows(`SELECT id FROM access_request WHERE email = 'dirk@example.com'`);
    const made = await card();

    caller = undefined;
    const used = await request(app)
      .post('/api/gifts/redeem')
      .send({ code: made.code, email: ' Dirk@Example.com', locale: 'en', google: false });
    expect(used.status, JSON.stringify(used.body)).toBe(201);

    expect(await rows(`SELECT id, state, organisation, note, decided_by FROM access_request`)).toEqual([
      { id: waiting!.id, state: 'granted', organisation: 'Bakkerij Dirk', note: 'Two mailboxes', decided_by: null },
    ]);
    const [{ tenant_id: tenantId }] = (await rows('SELECT tenant_id FROM access_request')) as [{ tenant_id: string }];
    expect(await rows('SELECT name FROM tenant WHERE id = $1', [tenantId])).toEqual([{ name: 'Bakkerij Dirk' }]);
    expect((await rows('SELECT redeemed_request_id FROM gift WHERE id = $1', [made.id]))[0]!.redeemed_request_id).toBe(
      waiting!.id,
    );
  });

  it('declined, a request made with a code before 0177 gives the giver their gift back (the owner, 2026-11-25)', async () => {
    const made = await card({ userId: BRAM, tenantId: BRAMS });
    // As 0172's door wrote it: an open request, and the gift spent pointing to it.
    const [eva] = await rows(`INSERT INTO access_request (email, locale) VALUES ('eva@example.com', 'en') RETURNING id`);
    await rows('UPDATE gift SET redeemed_at = now(), redeemed_request_id = $1 WHERE id = $2', [eva!.id, made.id]);

    caller = { userId: BRAM, tenantId: BRAMS };
    expect((await request(app).get('/api/gifts/mine')).body).toMatchObject({ limit: 1, held: 1 });
    expect((await request(app).post('/api/gifts').send({ locale: 'en' })).status).toBe(409);

    caller = { userId: OPERATOR };
    const queue = await request(app).get('/api/access-requests?state=open');
    const asked = queue.body.requests.find((r: { email: string }) => r.email === 'eva@example.com');
    expect(asked).toMatchObject({ gift: { from: 'bram@example.com' }, letInByRecommendation: false });
    const declined = await request(app).post(`/api/access-requests/${String(eva!.id)}/decline`).send({ notify: false });
    expect(declined.status, JSON.stringify(declined.body)).toBe(200);
    expect(await rows('SELECT state FROM access_request WHERE id = $1', [eva!.id])).toEqual([{ state: 'declined' }]);

    caller = { userId: BRAM, tenantId: BRAMS };
    const mine = await request(app).get('/api/gifts/mine');
    expect(mine.body).toMatchObject({ limit: 1, held: 0 });
    expect(mine.body.gifts[0].state).toBe('redeemed');
    expect((await request(app).post('/api/gifts').send({ locale: 'en' })).status).toBe(201);
  });
});
