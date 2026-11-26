// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * GIFTS, OVER HTTP (workplans 0172 and 0177): `routes/gifts.ts` end to end,
 * against PGlite as `app_user` with both chains, as `access-request-grant-alpha`
 * drives the grant route. Only who is calling, and the mail's transport, are
 * stood in for.
 *
 *  - the giver makes one gift, sees its code once, and is refused a second;
 *  - the giver revokes their own unused gift, not somebody else's;
 *  - the check (0177 §5): it writes nothing and spends nothing, answers every
 *    bad code with the redeem's one body, and shares one limit of forty an
 *    hour with the redeem, refused in both languages;
 *  - the door lets the person in at once (D6), answers an address that
 *    already has access apart, keeps a yes about Google as one line (D14 (a)),
 *    and mails the person and the operator after the commit, never before;
 *    a filled trap is answered as let in, and nothing is written or sent;
 *  - the operator sees every gift with its giver and the Alpha's counts,
 *    revokes, and changes the limit for everyone and for one person; a member
 *    who is not an operator sees nothing and changes nothing.
 *
 * UUID family 01720000-…-4466554418xx.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { GIFT_REFUSAL, GOOGLE_SAID_AT_THE_DOOR, runManagedMigrations } from '@openmig/managed';

const P = '01720000-e29b-41d4-a716-4466554418';
const OURS = `${P}01`;
const OTHER = `${P}02`;
const ANNA = 'subject-anna-0172-http';
const BRAM = 'subject-bram-0172-http';
const OPERATOR = 'subject-operator-0172-http';

let driver: LedgerDriver;
/** Who is calling, as the real middleware would have resolved them. */
let caller: { userId: string; tenantId?: string } | undefined;

/**
 * Every message the transport was handed, with what a second connection saw
 * of the person's request at that moment. PGlite has one connection: inside
 * the door's transaction that read waits, so a mail sent before the commit is
 * seen as `blocked` and one sent after it sees the row.
 */
const SENT: Array<{ to: readonly string[]; subject: string; body: string; seen: unknown }> = [];
vi.mock('@openmig/connectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/connectors')>();
  return {
    ...actual,
    smtpTransport: () => async (message: { to: readonly string[]; subject: string; body: string }) => {
      const seen = await Promise.race([
        rows(`SELECT state FROM access_request WHERE lower(email) = lower($1)`, [message.to[0] ?? '']).then((r) =>
          r.map((row) => row.state),
        ),
        new Promise((resolve) => setTimeout(() => resolve('blocked'), 1_500)),
      ]);
      SENT.push({ ...message, seen });
    },
  };
});

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
const { __setChannelForTests } = await import('../access-notify.ts');

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

async function makeOne(who = anna): Promise<{ id: string; code: string; expiresAt: string }> {
  as(who);
  const res = await request(app).post('/api/gifts').send({ locale: 'nl' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; code: string; expiresAt: string };
}

const redeem = (code: string, email = 'cato@example.com', extra: Record<string, unknown> = {}) => {
  as(undefined);
  return request(app).post('/api/gifts/redeem').send({ code, email, locale: 'nl', google: false, ...extra });
};

const check = (code: string) => {
  as(undefined);
  return request(app).post('/api/gifts/check').send({ code });
};

/** What a let-in writes, counted as the owner. */
const written = async () =>
  (
    await rows(`SELECT (SELECT count(*)::int FROM access_request) AS requests,
                       (SELECT count(*)::int FROM tenant) AS tenants,
                       (SELECT count(*)::int FROM tenant_member) AS members,
                       (SELECT count(*)::int FROM gift WHERE redeemed_at IS NOT NULL) AS spent`)
  )[0];

/** A channel that is on, so the routes really send; the transport above keeps what they send. */
const CHANNEL_ON = {
  notifier: { notify: async () => {} },
  locale: 'en',
  announcement: '',
  config: {
    enabled: true,
    smtp: { host: 'localhost', port: 587, secure: false, user: 'u', pass: 'p' },
    settings: { from: 'Ownpace <ownpace@example.test>', to: ['ops@example.test'] },
  },
} as unknown as Parameters<typeof __setChannelForTests>[0];

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
  SENT.length = 0;
  await rows('DELETE FROM gift');
  await rows('DELETE FROM gift_allowance');
  await rows('UPDATE gift_rule SET gifts_per_person = 1, owner_ceiling = 50, recommendation_ceiling = 50');
  await rows('DELETE FROM access_request');
  await rows('DELETE FROM tenant_member WHERE tenant_id NOT IN ($1, $2)', [OURS, OTHER]);
  await rows('DELETE FROM tenant WHERE id NOT IN ($1, $2)', [OURS, OTHER]);
  __setChannelForTests(CHANNEL_ON);
  vi.stubEnv('WEB_URL', 'https://app.example.test');
});

afterEach(() => {
  __setChannelForTests(null);
  vi.unstubAllEnvs();
});

describe('the giver', () => {
  it('makes one gift and sees its code once; the list never shows it', async () => {
    const made = await makeOne();
    expect(made.code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
    as(anna);
    const mine = await request(app).get('/api/gifts/mine');
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ limit: 1, held: 1, room: true });
    expect(mine.body.gifts).toHaveLength(1);
    expect(mine.body.gifts[0]).toMatchObject({ id: made.id, state: 'unused', locale: 'nl' });
    expect(JSON.stringify(mine.body)).not.toContain(made.code.replace(/-/g, '').slice(0, 8));
  });

  it('prints the door at /code, in the answer of both calls (0177 D9)', async () => {
    as(anna);
    const made = await request(app).post('/api/gifts').send({ locale: 'en' });
    expect(made.body.redeemAt).toBe('https://app.example.test/code');
    expect((await request(app).get('/api/gifts/mine')).body.redeemAt).toBe('https://app.example.test/code');
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

describe('the check (0177 §5, step 1 of 3)', () => {
  it('answers a good code with its last day and the address the mail comes from, and writes nothing', async () => {
    const { code, id, expiresAt } = await makeOne();
    const before = await written();
    const res = await check(code.toLowerCase());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // The bare address: the setting's display name is not the address a mail comes from.
    expect(res.body).toEqual({ ok: true, until: expiresAt, answersFrom: 'ownpace@example.test' });
    expect(await written()).toEqual(before);
    expect((await rows('SELECT redeemed_at FROM gift WHERE id = $1', [id]))[0]!.redeemed_at).toBeNull();
    // Checked twice, it is still good: nothing was spent.
    expect((await check(code)).status).toBe(200);
    expect(SENT).toEqual([]);
  });

  it('leaves out the address the mail comes from when no mail is set up', async () => {
    const { code } = await makeOne();
    __setChannelForTests({
      ...CHANNEL_ON,
      config: { enabled: false, reason: 'off' },
    } as unknown as Parameters<typeof __setChannelForTests>[0]);
    const res = await check(code);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('answersFrom');
  });

  it('answers every bad code with the redeem’s one body: unknown, malformed, used, revoked, expired', async () => {
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
      const res = await check(code);
      expect(res.status, code).toBe(410);
      bodies.add(JSON.stringify(res.body));
      const redeemed = await redeem(code, 'dirk@example.com');
      expect(redeemed.status, code).toBe(410);
      bodies.add(JSON.stringify(redeemed.body));
    }
    expect([...bodies]).toEqual([
      JSON.stringify({ error: 'gift_refused', reason: GIFT_REFUSAL.en, reasonNl: GIFT_REFUSAL.nl }),
    ]);
    expect(await rows("SELECT 1 FROM access_request WHERE email = 'dirk@example.com'")).toHaveLength(0);
  });

  it('shares one limit with the redeem, forty an hour, refused in both languages with Retry-After', async () => {
    expect(GIFT_REDEEM_LIMIT.max).toBe(40);
    for (let i = 0; i < GIFT_REDEEM_LIMIT.max / 2; i++) {
      expect((await check('ZZZZ-ZZZZ-ZZZZ-ZZZZ')).status).toBe(410);
      expect((await redeem('ZZZZ-ZZZZ-ZZZZ-ZZZZ')).status).toBe(410);
    }
    for (const over of [await check('ZZZZ-ZZZZ-ZZZZ-ZZZZ'), await redeem('ZZZZ-ZZZZ-ZZZZ-ZZZZ')]) {
      expect(over.status).toBe(429);
      expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
      expect(over.body).toMatchObject({
        reason: 'That is more tries than we expected from one place. Try again later. Nothing is lost.',
        reasonNl: 'Dat waren meer pogingen dan wij van één plek verwachten. Probeer het later opnieuw. Er gaat niets verloren.',
      });
      expect(over.body.message).toBe(over.body.reason);
    }
  });
});

describe('the door (0177 §5, step 3 of 3: let in at once)', () => {
  it('lets the person in with a code, once, and says whether the yes mail went', async () => {
    const { code } = await makeOne();
    const first = await redeem(code.toLowerCase(), 'cato@example.com', { name: 'Cato' });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body).toEqual({ letIn: true, mailed: true });
    expect(await rows('SELECT email, state, decided_by FROM access_request')).toEqual([
      { email: 'cato@example.com', state: 'granted', decided_by: null },
    ]);
    const again = await redeem(code, 'dirk@example.com');
    expect(again.status).toBe(410);
  });

  it('takes the code, the address, a name, the answer about Google and the language, and no organisation, note or package', async () => {
    const { code } = await makeOne();
    const res = await redeem(code, 'cato@example.com', {
      organisation: 'Should not be kept',
      note: 'nor this',
      tier: 'Large',
    });
    expect(res.status).toBe(201);
    expect(await rows('SELECT organisation, note, tier FROM access_request')).toEqual([
      { organisation: null, note: null, tier: null },
    ]);
  });

  it('sends the yes mail to the person and the notice to the operator after the commit, never before', async () => {
    const { code } = await makeOne();
    expect((await redeem(code, 'cato@example.com', { locale: 'en' })).status).toBe(201);
    const toCato = SENT.filter((m) => m.to.includes('cato@example.com'));
    const toOps = SENT.filter((m) => m.to.includes('ops@example.test'));
    expect(toCato).toHaveLength(1);
    expect(toOps).toHaveLength(1);
    // Each saw the request already granted, from another connection: the commit came first.
    expect(toCato[0]!.seen).toEqual(['granted']);
    expect(toCato[0]!.body.split('\n')[0]).toBe('You used a code from someone you know. You are in.');
    expect(toOps[0]!.body).toContain('Someone was let in with a recommendation.');
    expect(toOps[0]!.body).toContain('cato@example.com');
  });

  it('writes the yes mail in the door’s language', async () => {
    const { code } = await makeOne();
    expect((await redeem(code, 'cato@example.com', { locale: 'nl' })).status).toBe(201);
    const [mail] = SENT.filter((m) => m.to.includes('cato@example.com'));
    expect(mail!.body.split('\n')[0]).toBe('U gebruikte een code van iemand die u kent. U bent toegelaten.');
  });

  it('keeps a yes about Google as the one fixed line in the note, and the notice says to add the address; a no writes nothing', async () => {
    await rows('UPDATE gift_rule SET gifts_per_person = 2');
    const yes = await makeOne();
    const no = await makeOne();
    expect((await redeem(yes.code, 'gmail@example.com', { google: true, locale: 'en' })).status).toBe(201);
    expect((await redeem(no.code, 'other@example.com', { google: false, locale: 'en' })).status).toBe(201);
    expect(await rows('SELECT email, note FROM access_request ORDER BY email')).toEqual([
      { email: 'gmail@example.com', note: GOOGLE_SAID_AT_THE_DOOR },
      { email: 'other@example.com', note: null },
    ]);
    const notices = SENT.filter((m) => m.to.includes('ops@example.test'));
    expect(notices.find((m) => m.body.includes('gmail@example.com'))!.body).toContain(
      "Add it to Google's list of test users, then write to them.",
    );
    expect(notices.find((m) => m.body.includes('other@example.com'))!.body).not.toContain('Google');
    const toGmail = SENT.find((m) => m.to.includes('gmail@example.com'))!;
    expect(toGmail.body).toContain('We add gmail@example.com to a list at Google by hand');
  });

  it('answers an address that already has access apart: nothing written, the code kept, nothing sent', async () => {
    const { code, id } = await makeOne();
    const before = await written();
    const res = await redeem(code, 'ANNA@example.com ');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: 'already_in',
      reason: 'This email address already has access to Ownpace. Your code is not used. Sign in with that email address.',
      reasonNl: 'Dit e-mailadres heeft al toegang tot Ownpace. Uw code is niet gebruikt. Meld u aan met dat e-mailadres.',
    });
    expect(await written()).toEqual(before);
    expect((await rows('SELECT redeemed_at FROM gift WHERE id = $1', [id]))[0]!.redeemed_at).toBeNull();
    expect(SENT).toEqual([]);
  });

  it('answers a filled trap as let in, and writes and sends nothing', async () => {
    const { code, id } = await makeOne();
    const before = await written();
    const res = await redeem(code, 'cato@example.com', { website: 'https://spam.example' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ letIn: true, mailed: true });
    expect(await written()).toEqual(before);
    expect((await rows('SELECT redeemed_at FROM gift WHERE id = $1', [id]))[0]!.redeemed_at).toBeNull();
    expect(SENT).toEqual([]);
  });

  it('says no mail went when none can: no mail set up, or no address to sign in at', async () => {
    await rows('UPDATE gift_rule SET gifts_per_person = 2');
    const first = await makeOne();
    vi.stubEnv('WEB_URL', '');
    expect((await redeem(first.code, 'cato@example.com')).body).toEqual({ letIn: true, mailed: false });
    const second = await makeOne();
    vi.stubEnv('WEB_URL', 'https://app.example.test');
    __setChannelForTests({
      ...CHANNEL_ON,
      config: { enabled: false, reason: 'off' },
    } as unknown as Parameters<typeof __setChannelForTests>[0]);
    expect((await redeem(second.code, 'dirk@example.com')).body).toEqual({ letIn: true, mailed: false });
  });

  it('logs a gift and a request by their ids, never by the code or the address', async () => {
    const { log } = await import('@openmig/shared');
    const said: string[] = [];
    const spies = (['info', 'warn', 'error'] as const).map((level) =>
      vi.spyOn(log, level).mockImplementation((...args: unknown[]) => void said.push(args.map(String).join(' '))),
    );
    try {
      const { code } = await makeOne();
      await check(code);
      await redeem(code, 'cato@example.com', { google: true });
      await redeem(code, 'cato@example.com');
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    const text = said.join('\n');
    expect(text).toMatch(/\[gift\] gift [0-9a-f-]{36} let in request [0-9a-f-]{36}/);
    expect(text).not.toMatch(/cato@example\.com|[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/);
  });
});

describe('the operator', () => {
  it('sees every gift with its giver, the request it became, and the Alpha’s counts', async () => {
    const { code } = await makeOne();
    await makeOne(bram);
    await redeem(code);
    await rows(`INSERT INTO access_request (email, locale, state, decided_at, decided_by, tenant_id)
                VALUES ('earlier@example.com', 'en', 'granted', now(), 'op', $1)`, [OTHER]);
    await rows(`INSERT INTO access_request (email, locale) VALUES ('waiting@example.com', 'en')`);
    as(operator);
    const res = await request(app).get('/api/gifts/operator');
    expect(res.status).toBe(200);
    expect(res.body.gifts).toHaveLength(2);
    const annas = res.body.gifts.find((g: { giverEmail: string }) => g.giverEmail === 'anna@example.com');
    expect(annas).toMatchObject({
      state: 'redeemed',
      organisation: 'De Vries',
      request: { state: 'granted', email: 'cato@example.com' },
    });
    expect(res.body.alpha).toEqual({
      granted: 2,
      open: 1,
      openFromGifts: 0,
      unusedGifts: 1,
      byOwner: 1,
      byRecommendation: 1,
      ownerCeiling: 50,
      recommendationCeiling: 50,
    });
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
    expect((await request(app).put('/api/gifts/operator/rule').send({ recommendationCeiling: 9 })).status).toBe(404);
    expect((await request(app).put('/api/gifts/operator/allowance').send({ email: 'anna@example.com', gifts: 9 })).status).toBe(404);
    expect(await rows('SELECT gifts_per_person, recommendation_ceiling FROM gift_rule')).toEqual([
      { gifts_per_person: 1, recommendation_ceiling: 50 },
    ]);
  });
});
