// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN INVITATION THAT IS MAILED (workplan 0156 T3).
 *
 * The owner invited a tester on 2026-09-25 and nobody heard: the route wrote
 * the `tenant_member` row and sent nothing, by a design the form said out
 * loud ("No email yet; tell them yourself"). On 2026-10-03 the owner chose
 * that the invited person is mailed. What this holds, through the real route
 * on PGlite as `app_user` and the real mail channel with only the SMTP
 * transport replaced:
 *
 * - an invitation is mailed to the invited address, in the organisation's
 *   language, naming the organisation, the inviter, where to sign in, the
 *   address to sign in with and the privacy policy, and carrying no token;
 * - the answer says what became of the mail (`notified`), and a deployment
 *   that sends no mail, or names nowhere to sign in, answers `off` with the
 *   invitation saved all the same;
 * - during the alpha it links the Alpha conditions and the tester guide in
 *   the organisation's language, English and Dutch both (0131 T1 (b)), and
 *   a `LEGAL_SITE_URL` it cannot make them from answers `failed`, with the
 *   invitation saved, nothing sent and no allowance spent;
 * - a duplicate invitation is refused and mails nobody;
 * - Send again mails an open invitation, at most once in ten minutes, and
 *   refuses one that was answered or that a granted access request made.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';

const SENT: Array<{ to: readonly string[]; subject: string; body: string }> = [];
vi.mock('@openmig/connectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/connectors')>();
  return {
    ...actual,
    smtpTransport: () => async (message: { to: readonly string[]; subject: string; body: string }) => {
      SENT.push(message);
    },
  };
});

const TENANT = '0156c000-e29b-41d4-a716-446655440001';
const OWNER = {
  tenantId: TENANT,
  userId: 'sub-owner-0156',
  userRole: 'owner',
  userEmail: 'rob@example.test',
};

let driver: LedgerDriver;
let caller: Record<string, string> = {};

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (!caller.tenantId) return void res.status(401).json({ error: 'Unauthorized' });
      Object.assign(req, caller);
      next();
    },
    getDbPool: () => driver,
  };
});

const { __setChannelForTests } = await import('../../access-notify.ts');
const { __forgetInvitationMailsForTests } = await import('./invitation-mail.ts');
const { default: memberRoutes } = await import('./members.ts');

const app = express();
app.use(express.json());
app.use('/api/tenants/:tenantId/members', memberRoutes);

async function rows(sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(sql, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

/** A channel shaped like `notifierFromEnv`'s, switched on. */
const channelOn = () =>
  ({
    notifier: { notify: async () => {} },
    locale: 'en',
    announcement: '',
    config: {
      enabled: true,
      smtp: { host: 'smtp.example.test', port: 587, secure: false, user: 'u', pass: 'p' },
      settings: { from: 'support@example.test', to: ['ops@example.test'] },
    },
  }) as unknown as Parameters<typeof __setChannelForTests>[0];

const ENV = ['WEB_URL', 'LEGAL_SITE_URL', 'OWNPACE_STAGE'] as const;
let saved: Record<string, string | undefined>;

const invite = (email: string) =>
  request(app).post(`/api/tenants/${TENANT}/members`).send({ email, role: 'admin' });

/** The organisation's summary language, which its invitations are written in. */
const organisationSpeaks = (locale: 'en' | 'nl') =>
  rows('UPDATE tenant SET settings = $2 WHERE id = $1', [
    TENANT,
    JSON.stringify({ notifications: { digest: 'daily', locale } }),
  ]);

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  // The organisation's summaries are in Dutch, so its invitations are too.
  await rows('INSERT INTO tenant (id, name, settings) VALUES ($1, $2, $3)', [
    TENANT,
    'Familie Berentsen',
    JSON.stringify({ notifications: { digest: 'daily', locale: 'nl' } }),
  ]);
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  caller = OWNER;
  SENT.length = 0;
  __forgetInvitationMailsForTests();
  __setChannelForTests(channelOn());
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  process.env.WEB_URL = 'https://app.example.test/';
  process.env.LEGAL_SITE_URL = 'https://site.example.test';
  delete process.env.OWNPACE_STAGE;
  await rows('DELETE FROM tenant_member WHERE tenant_id = $1', [TENANT]);
  await rows(
    `INSERT INTO tenant_member (tenant_id, user_id, email, role, status, joined_at)
     VALUES ($1, $2, $3, 'owner', 'active', now())`,
    [TENANT, OWNER.userId, OWNER.userEmail],
  );
});

afterEach(() => {
  __setChannelForTests(null);
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('inviting mails the invited person', () => {
  it('sends one mail, to them, saying who asked, where to sign in and with which address', async () => {
    const res = await invite('test@ownpace.test');

    expect(res.status).toBe(201);
    expect(res.body.notified).toBe('sent');
    expect(res.body.status).toBe('invited');
    expect(SENT).toHaveLength(1);
    const mail = SENT[0]!;
    expect(mail.to).toEqual(['test@ownpace.test']);
    // In the organisation's language, which is Dutch here.
    expect(mail.subject).toBe('Ownpace — u bent uitgenodigd voor een organisatie');
    expect(mail.body).toContain('Organisatie: Familie Berentsen');
    expect(mail.body).toContain('De uitnodiging komt van: rob@example.test');
    expect(mail.body).toContain('Meld u hier aan: https://app.example.test');
    expect(mail.body).toContain('hieraan is uw uitnodiging gekoppeld: test@ownpace.test');
    // Privacy §4.6, at the first communication.
    expect(mail.body).toContain('https://site.example.test/');
    expect(mail.body).toMatch(/privacyverklaring/);
    // An address, never a token: nothing in it signs anybody in.
    expect(mail.body).not.toMatch(/token|code=|\?invite/i);
    // Outside the alpha, no conditions and no guide.
    expect(mail.body).not.toMatch(/alpha\.html|alpha-guide|alpha-handleiding/);
  });

  // 0131 T1 (b), 2026-10-04. The addresses follow the organisation's
  // language, on the site LEGAL_SITE_URL names; the other language's never
  // appear. Both languages, so neither can be written into the route.
  it.each([
    {
      locale: 'nl' as const,
      lead: /^Alpha: een kleine, uitgenodigde groep/m,
      conditions: 'Lees hier de voorwaarden voor de Alpha: https://site.example.test/nl/alpha.html',
      guide: 'Lees de handleiding voor de Alpha voordat u begint: https://site.example.test/nl/alpha-handleiding.html',
      never: ['https://site.example.test/alpha.html', 'https://site.example.test/alpha-guide.html'],
    },
    {
      locale: 'en' as const,
      lead: /^Alpha: a small invited group/m,
      conditions: 'Read the Alpha conditions here: https://site.example.test/alpha.html',
      guide: 'Read the guide to the Alpha before you start: https://site.example.test/alpha-guide.html',
      never: ['https://site.example.test/nl/alpha.html', 'https://site.example.test/nl/alpha-handleiding.html'],
    },
  ])(
    'during the alpha, links the Alpha conditions and the tester guide, in the organisation’s language ($locale)',
    async ({ locale, lead, conditions, guide, never }) => {
      process.env.OWNPACE_STAGE = 'alpha';
      await organisationSpeaks(locale);
      try {
        const res = await invite(`alpha-${locale}@ownpace.test`);

        expect(res.status).toBe(201);
        expect(res.body.notified).toBe('sent');
        const body = SENT[0]!.body;
        expect(body).toMatch(lead);
        expect(body).toContain(conditions);
        expect(body).toContain(guide);
        for (const other of never) expect(body).not.toContain(other);
      } finally {
        await organisationSpeaks('nl');
      }
    },
  );

  it('answers FAILED, with the invitation saved and nothing spent, when LEGAL_SITE_URL cannot make its addresses', async () => {
    // A value the mail refuses (no scheme). The addresses are made after the
    // invitation committed, so a throw there would be a 500 for an invitation
    // that exists. The guard turns it into `failed`, and sends nothing.
    process.env.OWNPACE_STAGE = 'alpha';
    process.env.LEGAL_SITE_URL = 'www.ownpace.eu';

    const res = await invite('kapot@ownpace.test');

    expect(res.status).toBe(201);
    expect(res.body.notified).toBe('failed');
    expect(SENT).toHaveLength(0);
    expect(await rows('SELECT status FROM tenant_member WHERE email = $1', ['kapot@ownpace.test'])).toEqual([
      { status: 'invited' },
    ]);

    // Nothing was taken from either allowance: the organisation's day and this
    // invitation's ten minutes are taken together, after the guard. So Send
    // again, at once, is not refused as too soon, and it mails.
    process.env.LEGAL_SITE_URL = 'https://site.example.test';
    const again = await request(app).post(`/api/tenants/${TENANT}/members/${res.body.id as string}/resend`);
    expect(again.status).toBe(200);
    expect(again.body.notified).toBe('sent');
    expect(SENT).toHaveLength(1);
    // And the day's twenty are all there: Send again took one, nineteen more go.
    for (let i = 0; i < 19; i++) {
      expect((await invite(`daarna${i}@ownpace.test`)).body.notified, `invitation ${i + 2}`).toBe('sent');
    }
  });

  it('answers OFF, with the invitation saved, when this deployment sends no mail', async () => {
    __setChannelForTests({
      ...channelOn(),
      config: { enabled: false },
    } as unknown as Parameters<typeof __setChannelForTests>[0]);

    const res = await invite('niemand@ownpace.test');

    expect(res.status).toBe(201);
    expect(res.body.notified).toBe('off');
    expect(SENT).toHaveLength(0);
    expect(await rows('SELECT status FROM tenant_member WHERE email = $1', ['niemand@ownpace.test'])).toEqual([
      { status: 'invited' },
    ]);
  });

  it('answers OFF when no WEB_URL names where to sign in', async () => {
    delete process.env.WEB_URL;
    const res = await invite('nergens@ownpace.test');
    expect(res.body.notified).toBe('off');
    expect(SENT).toHaveLength(0);
  });

  it('mails nobody for a duplicate invitation, which is refused', async () => {
    await invite('dubbel@ownpace.test');
    SENT.length = 0;

    const res = await invite('dubbel@ownpace.test');

    expect(res.status).toBe(409);
    expect(SENT).toHaveLength(0);
  });
});

describe('sending an open invitation again', () => {
  it('is refused within ten minutes of the last mail, with Retry-After', async () => {
    const invited = await invite('opnieuw@ownpace.test');

    const res = await request(app).post(`/api/tenants/${TENANT}/members/${invited.body.id}/resend`);

    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(SENT).toHaveLength(1);
  });

  it('mails it again once the ten minutes are over', async () => {
    const invited = await invite('later@ownpace.test');
    // Forget the counts, as ten minutes would: the per-invitation limit is the one asked.
    __forgetInvitationMailsForTests();

    const res = await request(app).post(`/api/tenants/${TENANT}/members/${invited.body.id}/resend`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: invited.body.id, notified: 'sent' });
    expect(SENT.map((m) => m.to[0])).toEqual(['later@ownpace.test', 'later@ownpace.test']);
  });

  it('refuses an invitation that was answered, and one a granted request made', async () => {
    const [declined] = await rows(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status, origin)
       VALUES ($1, 'pending:a', 'nee@ownpace.test', 'admin', 'declined', 'invited') RETURNING id`,
      [TENANT],
    );
    const [requested] = await rows(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status, origin)
       VALUES ($1, 'pending:b', 'vroeg@ownpace.test', 'owner', 'invited', 'requested') RETURNING id`,
      [TENANT],
    );

    for (const id of [declined!.id, requested!.id]) {
      const res = await request(app).post(`/api/tenants/${TENANT}/members/${id as string}/resend`);
      expect(res.status, String(id)).toBe(409);
    }
    expect(SENT).toHaveLength(0);
  });
});

describe('the day’s allowance', () => {
  it('saves every invitation and stops mailing after twenty in a day', async () => {
    const outcomes: string[] = [];
    for (let i = 0; i < 21; i++) {
      outcomes.push((await invite(`n${i}@ownpace.test`)).body.notified as string);
    }
    expect(outcomes.filter((o) => o === 'sent')).toHaveLength(20);
    expect(outcomes[20]).toBe('limited');
    expect(SENT).toHaveLength(20);
  });
});
