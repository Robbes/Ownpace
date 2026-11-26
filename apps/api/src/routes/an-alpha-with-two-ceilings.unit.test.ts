// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ALPHA WITH TWO CEILINGS (workplan 0177 §20, T16; the owner, on D16:
 * *"alpha limited to 50 people I let in, en 50 max someone invites (each let
 * in user 1 invite)."*).
 *
 * Over HTTP, against PGlite with both chains, through the gifts route and the
 * access queue:
 *
 *  - each count is §20.1's: a request a card points to is never one of the
 *    owner's, a waiting one with a card counts as let in by a recommendation,
 *    and a declined one counts for nobody;
 *  - no card is made while the people let in by a recommendation and the
 *    cards not used yet fill the second number (`room`, `no_room`);
 *  - at that number the check and the redeem answer that the Alpha is full,
 *    and nothing is written or spent; two codes at the last place let one
 *    person in; a number set under the count takes nobody out;
 *  - the operator's answer carries both counts and both ceilings, and the
 *    rule's route sets either ceiling: a whole number, nought or more;
 *  - the queue marks a request let in by a recommendation, decided by nobody;
 *  - D17 (the owner, 2026-11-26: *"no, ik will count"*): nothing refuses the
 *    owner's own yes, at the number or past it;
 *  - D18 (*"no, not in the alpha. Yes after the alpha."*): during the Alpha a
 *    member whose own organisation a card's request made has none
 *    (`onlyAfterAlpha`, 409 `only_after_alpha`); after it, every member has
 *    the number each person may give. The stage is read both ways.
 *
 * UUID family 01770000-…-4466554420xx.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';

const P = '01770000-e29b-41d4-a716-4466554420';
const ANNAS = `${P}01`;
const BRAMS = `${P}02`;
const ANNA = 'subject-anna-0177-ceilings';
const BRAM = 'subject-bram-0177-ceilings';
const CATO = 'subject-cato-0177-ceilings';
const DIRK = 'subject-dirk-0177-ceilings';
const EVERT = 'subject-evert-0177-ceilings';
const OPERATOR = 'subject-operator-0177-ceilings';

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

const { default: giftRoutes, __resetGiftLimiterForTests } = await import('./gifts.ts');
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

const anna = { userId: ANNA, tenantId: ANNAS };
const bram = { userId: BRAM, tenantId: BRAMS };
const operator = { userId: OPERATOR };

async function card(who: { userId: string; tenantId: string } = anna): Promise<{ id: string; code: string; expiresAt: string }> {
  caller = who;
  const res = await request(app).post('/api/gifts').send({ locale: 'en' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; code: string; expiresAt: string };
}

const redeem = (code: string, email: string) => {
  caller = undefined;
  return request(app).post('/api/gifts/redeem').send({ code, email, locale: 'en', google: false });
};

const check = (code: string) => {
  caller = undefined;
  return request(app).post('/api/gifts/check').send({ code });
};

const alpha = async () => {
  caller = operator;
  const res = await request(app).get('/api/gifts/operator');
  expect(res.status).toBe(200);
  return res.body.alpha as Record<string, number>;
};

const setRule = (body: Record<string, unknown>) => {
  caller = operator;
  return request(app).put('/api/gifts/operator/rule').send(body);
};

const written = async () =>
  (
    await rows(`SELECT (SELECT count(*)::int FROM access_request) AS requests,
                       (SELECT count(*)::int FROM tenant) AS tenants,
                       (SELECT count(*)::int FROM tenant_member) AS members,
                       (SELECT count(*)::int FROM gift WHERE redeemed_at IS NOT NULL) AS spent`)
  )[0];

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  // The knock uses drizzle over the pool directly; the shim the grant tests use.
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
  await rows(`INSERT INTO platform_operator (user_id, email) VALUES ($1, 'operator@example.com')`, [OPERATOR]);
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  __resetGiftLimiterForTests();
  await rows('DELETE FROM gift');
  await rows('DELETE FROM access_request');
  await rows('DELETE FROM tenant_member');
  await rows('DELETE FROM tenant');
  await rows('UPDATE gift_rule SET gifts_per_person = 1, owner_ceiling = 50, recommendation_ceiling = 50');
  await rows(`INSERT INTO tenant (id, name) VALUES ($1, 'De Vries'), ($2, 'Jansen')`, [ANNAS, BRAMS]);
  await rows(
    `INSERT INTO tenant_member (tenant_id, user_id, email, role, status)
     VALUES ($1, $2, 'anna@example.com', 'owner', 'active'), ($3, $4, 'bram@example.com', 'owner', 'active')`,
    [ANNAS, ANNA, BRAMS, BRAM],
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('what is counted (§20.1)', () => {
  it('a request a card points to is never one of the owner’s; a waiting one with a card counts; a declined one counts for nobody', async () => {
    await rows('UPDATE gift_rule SET gifts_per_person = 4');
    // Two the owner let in: granted, and no card points to them.
    for (const email of ['one@example.com', 'two@example.com']) {
      await rows(
        `INSERT INTO access_request (email, locale, state, tenant_id, decided_by, decided_at)
         VALUES ($1, 'en', 'granted', $2, $3, now())`,
        [email, ANNAS, OPERATOR],
      );
    }
    // One let in by a card, at the door.
    const used = await card();
    expect((await redeem(used.code, 'cato@example.com')).status).toBe(201);
    // One that a card made before 0177, still waiting for the owner.
    const before = await card();
    const [waiting] = await rows(`INSERT INTO access_request (email, locale) VALUES ('dirk@example.com', 'en') RETURNING id`);
    await rows('UPDATE gift SET redeemed_at = now(), redeemed_request_id = $1 WHERE id = $2', [waiting!.id, before.id]);
    // One that a card made before 0177 and the owner declined.
    const declined = await card();
    const [no] = await rows(
      `INSERT INTO access_request (email, locale, state, decided_by, decided_at) VALUES ('eva@example.com', 'en', 'declined', $1, now()) RETURNING id`,
      [OPERATOR],
    );
    await rows('UPDATE gift SET redeemed_at = now(), redeemed_request_id = $1, request_declined_at = now() WHERE id = $2', [
      no!.id,
      declined.id,
    ]);
    // One card not used yet, and one expired, which promises nothing.
    await card();
    const expired = await card(bram);
    await rows("UPDATE gift SET expires_at = now() - interval '1 day' WHERE id = $1", [expired.id]);
    // A plain request waiting is nobody's yet.
    await rows(`INSERT INTO access_request (email, locale) VALUES ('fenna@example.com', 'en')`);

    expect(await alpha()).toMatchObject({
      byOwner: 2,
      byRecommendation: 2,
      unusedGifts: 1,
      ownerCeiling: 50,
      recommendationCeiling: 50,
    });
  });

  it('a person whose data is erased leaves the count', async () => {
    const used = await card();
    expect((await redeem(used.code, 'cato@example.com')).status).toBe(201);
    expect((await alpha()).byRecommendation).toBe(1);
    // As the purge erases it: the request goes, and the card then points to nothing.
    await rows(`DELETE FROM access_request WHERE email = 'cato@example.com'`);
    expect((await alpha()).byRecommendation).toBe(0);
  });
});

describe('the second ceiling (§20.3)', () => {
  it('no card is made while the people let in by a recommendation and the cards not used yet fill the number', async () => {
    expect((await setRule({ recommendationCeiling: 2 })).status).toBe(200);
    const used = await card(anna);
    expect((await redeem(used.code, 'cato@example.com')).status).toBe(201);
    await rows('UPDATE gift_rule SET gifts_per_person = 2');
    const unused = await card(anna);

    caller = bram;
    expect((await request(app).get('/api/gifts/mine')).body).toMatchObject({ room: false, limit: 2, held: 0 });
    const refused = await request(app).post('/api/gifts').send({ locale: 'en' });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('no_room');
    expect(await rows('SELECT 1 FROM gift WHERE giver_user_id = $1', [BRAM])).toHaveLength(0);

    // A card withdrawn gives its place back.
    caller = anna;
    expect((await request(app).post(`/api/gifts/${unused.id}/revoke`)).status).toBe(200);
    caller = bram;
    expect((await request(app).get('/api/gifts/mine')).body.room).toBe(true);
    expect((await request(app).post('/api/gifts').send({ locale: 'en' })).status).toBe(201);
  });

  it('at the number the check and the redeem answer that the Alpha is full, and nothing is written or spent', async () => {
    const first = await card(anna);
    const second = await card(bram);
    expect((await redeem(first.code, 'cato@example.com')).status).toBe(201);
    // The owner lowers the number while a card is out (§18).
    expect((await setRule({ recommendationCeiling: 1 })).status).toBe(200);

    const before = await written();
    const full = {
      error: 'full',
      reason: 'Nobody can be let in with a code right now. Your code is not used.',
      reasonNl: 'Met een code kan nu niemand worden toegelaten. Uw code is niet gebruikt.',
      until: second.expiresAt,
    };
    const checked = await check(second.code);
    expect(checked.status).toBe(409);
    expect(checked.body).toEqual(full);
    const redeemed = await redeem(second.code, 'dirk@example.com');
    expect(redeemed.status).toBe(409);
    expect(redeemed.body).toEqual(full);
    expect(await written()).toEqual(before);
    expect((await rows('SELECT redeemed_at FROM gift WHERE id = $1', [second.id]))[0]!.redeemed_at).toBeNull();

    // A bad code is still the one refusal: only a good code learns the Alpha is full.
    expect((await check('ZZZZ-ZZZZ-ZZZZ-ZZZZ')).status).toBe(410);
  });

  it('two codes at the last place let one person in', async () => {
    const first = await card(anna);
    const second = await card(bram);
    expect((await setRule({ recommendationCeiling: 1 })).status).toBe(200);
    const answers = await Promise.all([redeem(first.code, 'cato@example.com'), redeem(second.code, 'dirk@example.com')]);
    expect(answers.map((a) => a.status).sort()).toEqual([201, 409]);
    expect(answers.find((a) => a.status === 409)!.body.error).toBe('full');
    expect(await rows(`SELECT count(*)::int AS n FROM access_request WHERE state = 'granted'`)).toEqual([{ n: 1 }]);
    expect((await alpha()).byRecommendation).toBe(1);
  });

  it('a number set under the count takes nobody out', async () => {
    const used = await card(anna);
    expect((await redeem(used.code, 'cato@example.com')).status).toBe(201);
    expect((await setRule({ recommendationCeiling: 0 })).status).toBe(200);
    expect(await rows(`SELECT state FROM access_request WHERE email = 'cato@example.com'`)).toEqual([{ state: 'granted' }]);
    expect(await rows(`SELECT status FROM tenant_member WHERE email = 'cato@example.com'`)).toEqual([{ status: 'invited' }]);
    expect(await alpha()).toMatchObject({ byRecommendation: 1, recommendationCeiling: 0 });
  });
});

describe('the operator’s two numbers (§20.2, §20.6)', () => {
  it('the rule’s route sets either ceiling beside the number each person may give, and answers the whole rule', async () => {
    const set = await setRule({ ownerCeiling: 40 });
    expect(set.status).toBe(200);
    expect(set.body).toEqual({ giftsPerPerson: 1, ownerCeiling: 40, recommendationCeiling: 50 });
    expect((await setRule({ recommendationCeiling: 30, giftsPerPerson: 2 })).body).toEqual({
      giftsPerPerson: 2,
      ownerCeiling: 40,
      recommendationCeiling: 30,
    });
    expect(await alpha()).toMatchObject({ ownerCeiling: 40, recommendationCeiling: 30 });
  });

  it('takes a whole number, nought or more, and refuses anything else', async () => {
    for (const body of [{}, { ownerCeiling: -1 }, { recommendationCeiling: 1.5 }, { ownerCeiling: '9' }, { other: 1 }]) {
      expect((await setRule(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await setRule({ ownerCeiling: 0, recommendationCeiling: 0 })).status).toBe(200);
    expect(await rows('SELECT owner_ceiling, recommendation_ceiling FROM gift_rule')).toEqual([
      { owner_ceiling: 0, recommendation_ceiling: 0 },
    ]);
  });
});

describe('the first ceiling, as the owner answered D17 (§20.4)', () => {
  it('nothing refuses the owner’s own yes, at the number or past it: the owner keeps count', async () => {
    expect((await setRule({ ownerCeiling: 1 })).status).toBe(200);
    for (const email of ['gerrit@example.com', 'hanna@example.com', 'ivo@example.com']) {
      caller = undefined;
      expect((await request(app).post('/api/access-requests').send({ email })).status).toBe(201);
      const [asked] = await rows(`SELECT id FROM access_request WHERE email = $1`, [email]);
      caller = operator;
      const granted = await request(app).post(`/api/access-requests/${String(asked!.id)}/grant`).send({});
      expect(granted.status, JSON.stringify(granted.body)).toBe(201);
    }
    // Three of one: shown, never refused.
    expect(await alpha()).toMatchObject({ byOwner: 3, ownerCeiling: 1 });
  });
});

describe('the queue (§20.4, §21.3 item 13)', () => {
  it('marks a request let in by a recommendation, decided by nobody, and no other', async () => {
    const used = await card(anna);
    expect((await redeem(used.code, 'cato@example.com')).status).toBe(201);
    await rows(
      `INSERT INTO access_request (email, locale, state, tenant_id, decided_by, decided_at)
       VALUES ('by-the-owner@example.com', 'en', 'granted', $1, $2, now())`,
      [BRAMS, OPERATOR],
    );
    caller = operator;
    const queue = await request(app).get('/api/access-requests');
    expect(queue.status).toBe(200);
    const cato = queue.body.requests.find((r: { email: string }) => r.email === 'cato@example.com');
    const owners = queue.body.requests.find((r: { email: string }) => r.email === 'by-the-owner@example.com');
    expect(cato).toMatchObject({
      state: 'granted',
      decidedBy: null,
      gift: { from: 'anna@example.com' },
      letInByRecommendation: true,
    });
    expect(owners).toMatchObject({ state: 'granted', gift: null, letInByRecommendation: false });
  });
});

describe('who may recommend, as the owner answered D18 (§20.7)', () => {
  /**
   * Cato, let in by Anna's card: her own organisation was made by a request a
   * card points to. Bound as `claimRequestedMembership` binds it at her first
   * sign-in. Dirk, let in by the owner: a granted request no card points to.
   */
  async function catoAndDirk() {
    const used = await card(anna);
    expect((await redeem(used.code, 'cato@example.com')).status).toBe(201);
    const [catos] = await rows(
      `UPDATE tenant_member SET user_id = $1, status = 'active', joined_at = now()
        WHERE email = 'cato@example.com' RETURNING tenant_id`,
      [CATO],
    );
    caller = undefined;
    expect((await request(app).post('/api/access-requests').send({ email: 'dirk@example.com' })).status).toBe(201);
    const [asked] = await rows(`SELECT id FROM access_request WHERE email = 'dirk@example.com'`);
    caller = operator;
    const granted = await request(app).post(`/api/access-requests/${String(asked!.id)}/grant`).send({});
    expect(granted.status, JSON.stringify(granted.body)).toBe(201);
    await rows(
      `UPDATE tenant_member SET user_id = $1, status = 'active', joined_at = now()
        WHERE email = 'dirk@example.com' RETURNING tenant_id`,
      [DIRK],
    );
    return {
      cato: { userId: CATO, tenantId: String(catos!.tenant_id) },
      dirk: { userId: DIRK, tenantId: String(granted.body.tenantId) },
    };
  }

  const SAID = {
    reason: 'During the Alpha, only the people Ownpace let in itself can recommend someone.',
    reasonNl: 'Tijdens de Alpha kunnen alleen de mensen die Ownpace zelf toeliet iemand aanbevelen.',
  };

  it('during the Alpha, a member let in by a recommendation has none: nought, onlyAfterAlpha, and 409 only_after_alpha', async () => {
    vi.stubEnv('OWNPACE_STAGE', 'alpha');
    const { cato } = await catoAndDirk();
    caller = cato;
    expect((await request(app).get('/api/gifts/mine')).body).toMatchObject({ limit: 0, held: 0, onlyAfterAlpha: true });
    const refused = await request(app).post('/api/gifts').send({ locale: 'nl' });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: 'only_after_alpha', ...SAID });
    expect(await rows('SELECT 1 FROM gift WHERE giver_user_id = $1', [CATO])).toHaveLength(0);
  });

  it('during the Alpha, so is a member invited into such an organisation, and the owner’s people are not', async () => {
    vi.stubEnv('OWNPACE_STAGE', 'alpha');
    const { cato, dirk } = await catoAndDirk();
    await rows(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status, joined_at)
       VALUES ($1, $2, 'evert@example.com', 'member', 'active', now())`,
      [cato.tenantId, EVERT],
    );
    caller = { userId: EVERT, tenantId: cato.tenantId };
    expect((await request(app).get('/api/gifts/mine')).body).toMatchObject({ limit: 0, onlyAfterAlpha: true });
    // Let in by the owner, and a member the owner's seed made: each has their one.
    for (const who of [dirk, bram]) {
      caller = who;
      expect((await request(app).get('/api/gifts/mine')).body, who.userId).toMatchObject({ limit: 1, onlyAfterAlpha: false });
      expect((await request(app).post('/api/gifts').send({ locale: 'nl' })).status, who.userId).toBe(201);
    }
  });

  it('after the Alpha, every member has the number each person may give', async () => {
    vi.stubEnv('OWNPACE_STAGE', '');
    const { cato } = await catoAndDirk();
    caller = cato;
    expect((await request(app).get('/api/gifts/mine')).body).toMatchObject({ limit: 1, held: 0, onlyAfterAlpha: false, room: true });
    expect((await request(app).post('/api/gifts').send({ locale: 'nl' })).status).toBe(201);
  });

  it('a card such a member made before stays as it is, and still lets its person in', async () => {
    vi.stubEnv('OWNPACE_STAGE', 'alpha');
    const { cato } = await catoAndDirk();
    vi.stubEnv('OWNPACE_STAGE', '');
    caller = cato;
    const before = await request(app).post('/api/gifts').send({ locale: 'nl' });
    expect(before.status).toBe(201);
    vi.stubEnv('OWNPACE_STAGE', 'alpha');
    caller = cato;
    expect((await request(app).get('/api/gifts/mine')).body.gifts).toHaveLength(1);
    expect((await redeem(before.body.code as string, 'fenna@example.com')).status).toBe(201);
  });
});
