// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GRANT LINK FOR A MICROSOFT ACCOUNT (workplan 0171 §3.2–3.4, T3).
 *
 * The whole flow, through the real routes and a real ledger (PGlite, both
 * migration chains), with Microsoft's two endpoints stood in for: the token
 * endpoint, which answers the code with a refresh token, an ID token and an
 * access token, and Graph's `/me`, which says which addresses are the
 * account's. After every ending the tables are read: for any account but the
 * named one nothing is stored and the link is left live, so the right account
 * can still use it.
 *
 * What this cannot prove: a real work tenant's sign-in, its admin-consent
 * policy, or what Graph answers for a real personal account. Those are the
 * managed E2E run's and a person's (workplan 0171 §10).
 */

process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  pgliteDriver,
  runMigrations,
  withTenant,
  issueMappingLink,
  listMappingLinks,
  expiryFromDays,
} from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { issuePersonLink, runManagedMigrations } from '@openmig/managed';
import { SecretStore } from '@openmig/core/secret-store';
import { log } from '@openmig/shared';

// UUID family 71710000-…, unused elsewhere in the repo.
const TENANT = '71710000-e29b-41d4-a716-446655440001';
const CONN = '71710000-e29b-41d4-a716-446655440011';
const BOX = '71710000-e29b-41d4-a716-446655440021';
const MAPPING = '71710000-e29b-41d4-a716-446655440031';
const TARGET_CONN = '71710000-e29b-41d4-a716-446655440012';
const TARGET_BOX = '71710000-e29b-41d4-a716-446655440022';
const PERSONAL_CONN = '71710000-e29b-41d4-a716-446655440013';
const PERSONAL_BOX = '71710000-e29b-41d4-a716-446655440023';
const PERSONAL = '71710000-e29b-41d4-a716-446655440033';
const GMAIL_CONN = '71710000-e29b-41d4-a716-446655440014';
const GMAIL_BOX = '71710000-e29b-41d4-a716-446655440024';
const GMAIL = '71710000-e29b-41d4-a716-446655440034';
const PERSON = '71710000-e29b-41d4-a716-446655440041';

/** The work account the migration reads, as its owner typed it: an alias, not the sign-in name. */
const NAMED = 'Someone@Example.Invalid';
/** The personal account another migration reads. */
const PERSONAL_NAMED = 'someone@outlook.com';

/** The deployment's own Entra application, as every test here runs on it. */
const CLIENT_ID = '00000000-0000-0000-0000-0000000000aa';
const CLIENT_SECRET = 'the-deployments-microsoft-secret';
const REFRESH = '0.a-granted-microsoft-refresh-token';
/** A work tenant's id, invented for the test. */
const WORK_TENANT = '11111111-2222-3333-4444-555555555555';
const PERSONAL_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

let driver: LedgerDriver;

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return { ...actual, getDbPool: () => driver };
});

const { default: grantRoutes } = await import('./grant.ts');
const { default: microsoftOauthRoutes } = await import('./migrations/microsoft-oauth-routes.ts');

const app = express();
app.use(express.json());
app.use('/api/grant', grantRoutes);
app.use('/api/migrations', microsoftOauthRoutes);

/** An ID token as Microsoft's token endpoint would carry it; unsigned, as it is read in-band. */
function idToken(claims: Record<string, unknown>): string {
  const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part(claims)}.sig`;
}
const workClaims = (over: Record<string, unknown> = {}) => ({
  iss: `https://login.microsoftonline.com/${WORK_TENANT}/v2.0`,
  aud: CLIENT_ID,
  tid: WORK_TENANT,
  preferred_username: 'someone.upn@example.invalid',
  // Set freely by a tenant's administrator, so never read: here it is even
  // the named address, and must not be enough on its own.
  email: NAMED,
  ...over,
});

/** What Microsoft answers, swapped per test. */
let tokenBody: Record<string, unknown>;
let meAnswer: { status: number; body: Record<string, unknown> };
let tokenRequests: string[] = [];

/** Graph's `/me` for a work account whose sign-in name is not the named address. */
const me = (over: Record<string, unknown> = {}) => ({
  status: 200,
  body: { userPrincipalName: 'someone.upn@example.invalid', mail: null, proxyAddresses: [], ...over },
});

async function mappingSecret(id: string): Promise<Record<string, string> | null> {
  const conn = await driver.acquire();
  try {
    const r = await conn.query('SELECT source_secret_ref FROM mailbox_mapping WHERE id = $1', [id]);
    const ref = (r.rows[0] as { source_secret_ref: string | null } | undefined)?.source_secret_ref ?? null;
    return ref ? SecretStore.decryptCredentials(ref) : null;
  } finally {
    await conn.release();
  }
}

async function clearSecret(id: string): Promise<void> {
  const conn = await driver.acquire();
  try {
    await conn.query('UPDATE mailbox_mapping SET source_secret_ref = NULL WHERE id = $1', [id]);
  } finally {
    await conn.release();
  }
}

const mintLink = (mappingId: string) =>
  withTenant(driver, TENANT, (db) =>
    issueMappingLink(db, {
      tenantId: TENANT,
      mappingId,
      purpose: 'grant',
      createdBy: 'pat',
      expiresAt: expiryFromDays(7),
    }),
  );

const linkState = async (mappingId: string, id: string) =>
  (await withTenant(driver, TENANT, (db) => listMappingLinks(db, { tenantId: TENANT, mappingId }))).find(
    (l) => l.id === id,
  )?.state;

beforeAll(async () => {
  process.env.API_URL = 'https://api.example';
  process.env.WEB_URL = 'https://app.example';
  process.env.MICROSOFT_OAUTH_CLIENT_ID = CLIENT_ID;
  process.env.MICROSOFT_OAUTH_CLIENT_SECRET = CLIENT_SECRET;
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });

  // Microsoft's token endpoint and Graph's `/me`, replaced; nothing else here
  // goes near a network.
  vi.stubGlobal('fetch', async (url: string, init?: { body?: string }) => {
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (String(url).startsWith('https://login.microsoftonline.com/')) {
      tokenRequests.push(String(url));
      void init;
      return json(200, tokenBody);
    }
    if (String(url).startsWith('https://graph.microsoft.com/v1.0/me')) return json(meAnswer.status, meAnswer.body);
    throw new Error(`unexpected fetch: ${String(url)}`);
  });

  const conn = await driver.acquire();
  try {
    const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
    await q('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'Acme Legal']);
    await q(`INSERT INTO tenant_member (tenant_id, user_id, email) VALUES ($1,$2,$3)`, [
      TENANT,
      'pat',
      'owner@example.org',
    ]);
    // Two Microsoft accounts saved for somebody else: a name and nothing to
    // sign in with (the grant brings it), and a Gmail beside them.
    // The Gmail carries its owner's own Google client, so its link is ready.
    const googleClient = JSON.stringify(
      SecretStore.encryptCredentials({ clientId: 'own.apps.googleusercontent.com', clientSecret: 'own' }).encrypted,
    );
    for (const [id, kind, user, secret] of [
      [CONN, 'microsoft', NAMED, null],
      [PERSONAL_CONN, 'microsoft', PERSONAL_NAMED, null],
      [GMAIL_CONN, 'gmail', 'someone@gmail.com', googleClient],
    ] as const) {
      await q(
        `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
         VALUES ($1,$2,'source',$3,'s',$4::jsonb,'connected',$5)`,
        [id, TENANT, kind, JSON.stringify({ user }), secret],
      );
    }
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1,$2,'target','nextcloud','nc','{"host":"cloud.example.org","port":443}'::jsonb,'connected')`,
      [TARGET_CONN, TENANT],
    );
    for (const [box, c] of [
      [BOX, CONN],
      [PERSONAL_BOX, PERSONAL_CONN],
      [GMAIL_BOX, GMAIL_CONN],
      [TARGET_BOX, TARGET_CONN],
    ]) {
      await q(
        `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
         VALUES ($1,$2,$3,'user','m@example.invalid')`,
        [box, TENANT, c],
      );
    }
    for (const [m, box] of [
      [MAPPING, BOX],
      [PERSONAL, PERSONAL_BOX],
      [GMAIL, GMAIL_BOX],
    ]) {
      await q(
        `INSERT INTO mailbox_mapping
           (id, tenant_id, source_mailbox_id, target_mailbox_id, target_config_override, status)
         VALUES ($1,$2,$3,$4,'{"user":"dest@example.org"}'::jsonb,'paused')`,
        [m, TENANT, box, TARGET_BOX],
      );
    }
    // A person whose migrations are the personal Microsoft one and the Gmail.
    await q(`INSERT INTO person (id, tenant_id, display_name) VALUES ($1,$2,'Anna')`, [PERSON, TENANT]);
    for (const m of [PERSONAL, GMAIL]) {
      await q('INSERT INTO person_migration (mapping_id, person_id, tenant_id) VALUES ($1,$2,$3)', [m, PERSON, TENANT]);
    }
    // What the work migration copies: mail and calendars, contacts switched off.
    for (const [m, domain, included] of [
      [MAPPING, 'email', true],
      [MAPPING, 'calendar', true],
      [MAPPING, 'contact', false],
      [PERSONAL, 'calendar', true],
    ] as const) {
      await q(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1,$2,$3,$4)`, [
        TENANT,
        m,
        domain,
        included,
      ]);
    }
  } finally {
    await conn.release();
  }
}, 30_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  delete process.env.MICROSOFT_OAUTH_CLIENT_ID;
  delete process.env.MICROSOFT_OAUTH_CLIENT_SECRET;
  await driver.end?.();
});

beforeEach(() => {
  tokenRequests = [];
  tokenBody = {
    refresh_token: REFRESH,
    access_token: 'an-access-token',
    id_token: idToken(workClaims()),
    scope: 'openid email profile User.Read Mail.Read Calendars.Read offline_access',
  };
  meAnswer = me({ mail: NAMED.toLowerCase() });
});

async function begin(token: string, provider = 'microsoft') {
  return request(app).post(`/api/grant/${token}/${provider}/authorize`).send({ locale: 'en' });
}
const stateOf = (res: { body: { url: string } }) => new URL(res.body.url).searchParams.get('state')!;
const end = (state: string, query: Record<string, string> = { code: 'auth-code' }) =>
  request(app).get('/api/migrations/microsoft/callback').query({ state, ...query });

describe('the page and the button of a Microsoft account’s link', () => {
  it('says whose sign-in it opens, and asks for what the migration copies and who signed in', async () => {
    const { token } = await mintLink(MAPPING);
    const res = await request(app).get(`/api/grant/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('microsoft');
    expect(res.body.from).toBe(NAMED);
    expect(res.body.domains).toEqual(['email', 'calendar']);
    // D7 (a): who signed in, on every new Microsoft consent.
    expect(res.body.scope.split(' ')).toEqual([
      'offline_access',
      'openid',
      'email',
      'profile',
      'User.Read',
      'Mail.Read',
      'Calendars.Read',
    ]);
    expect(res.body.readOnlyAtProvider).toBe(true);
    // Never the client's secret, nor its id.
    expect(JSON.stringify(res.body)).not.toContain(CLIENT_SECRET);
    expect(JSON.stringify(res.body)).not.toContain(CLIENT_ID);
  });

  it('sends the browser to Microsoft, offering the named account first, as a work account', async () => {
    const { token } = await mintLink(MAPPING);
    const res = await begin(token);
    expect(res.status).toBe(200);
    const url = new URL(res.body.url);
    expect(url.host).toBe('login.microsoftonline.com');
    expect(url.pathname).toBe('/common/oauth2/v2.0/authorize');
    expect(url.searchParams.get('login_hint')).toBe(NAMED);
    expect(url.searchParams.get('domain_hint')).toBe('organizations');
    expect(url.searchParams.get('prompt')).toBe('select_account');
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.example/api/migrations/microsoft/callback');
    expect(url.searchParams.get('scope')).toContain('User.Read');
    expect(url.toString()).not.toContain(CLIENT_SECRET);
  });

  it('sends a personal address to the consumer sign-in', async () => {
    const { token } = await mintLink(PERSONAL);
    const url = new URL((await begin(token)).body.url);
    expect(url.searchParams.get('login_hint')).toBe(PERSONAL_NAMED);
    expect(url.searchParams.get('domain_hint')).toBe('consumers');
  });

  it('refuses to open Google for a Microsoft account’s link, and Microsoft for a Google one', async () => {
    const ms = await mintLink(MAPPING);
    const wrong = await begin(ms.token, 'google');
    expect(wrong.status).toBe(409);
    expect(wrong.body.error).toBe('not_this_provider');
    const g = await mintLink(GMAIL);
    expect((await begin(g.token, 'microsoft')).body.error).toBe('not_this_provider');
  });

  it('answers no door for a provider with no entry yet (Dropbox and Apple join later)', async () => {
    const { token } = await mintLink(MAPPING);
    expect((await begin(token, 'dropbox')).status).toBe(404);
    expect((await begin(token, 'apple')).status).toBe(404);
    expect((await begin(token, 'nonsense')).status).toBe(404);
  });
});

describe('the account that signs in must be the one the link names (0171 §3.3)', () => {
  async function grantWith(mappingId: string) {
    await clearSecret(mappingId);
    const { token, id } = await mintLink(mappingId);
    const res = await end(stateOf(await begin(token)));
    return { res, id, token };
  }

  it('binds over the primary mail address, and stores the token with its directory', async () => {
    meAnswer = me({ mail: 'SOMEONE@example.invalid' });
    const { res, id } = await grantWith(MAPPING);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(REFRESH);
    expect(await mappingSecret(MAPPING)).toEqual({ refreshToken: REFRESH, tenantId: 'common' });
    expect(await linkState(MAPPING, id)).toBe('used');
  });

  it('binds over the sign-in name (UPN)', async () => {
    meAnswer = me({ userPrincipalName: NAMED.toLowerCase(), mail: null });
    const { res } = await grantWith(MAPPING);
    expect(res.status).toBe(200);
    expect((await mappingSecret(MAPPING))?.refreshToken).toBe(REFRESH);
  });

  it('binds over a proxy address, either case of its prefix', async () => {
    meAnswer = me({ mail: 'primary@example.invalid', proxyAddresses: ['SMTP:primary@example.invalid', 'smtp:someone@example.invalid', 'X500:/o=whatever'] });
    const { res } = await grantWith(MAPPING);
    expect(res.status).toBe(200);
    expect((await mappingSecret(MAPPING))?.refreshToken).toBe(REFRESH);
  });

  it('binds a personal account over the ID token’s sign-in name, without a directory to read', async () => {
    tokenBody = {
      ...tokenBody,
      id_token: idToken({
        iss: `https://login.microsoftonline.com/${PERSONAL_TENANT}/v2.0`,
        aud: CLIENT_ID,
        tid: PERSONAL_TENANT,
        preferred_username: 'Someone@Outlook.com',
      }),
    };
    // A `/me` that would refuse proves it is not asked.
    meAnswer = { status: 500, body: {} };
    const { res } = await grantWith(PERSONAL);
    expect(res.status).toBe(200);
    expect((await mappingSecret(PERSONAL))?.refreshToken).toBe(REFRESH);
  });

  it('stores nothing for ANOTHER account, says which, and leaves the link working', async () => {
    meAnswer = me({ userPrincipalName: 'other@example.invalid', mail: 'other@example.invalid', proxyAddresses: ['SMTP:other@example.invalid'] });
    const { res, id, token } = await grantWith(MAPPING);
    expect(res.status).toBe(403);
    expect(res.text).toContain('You signed in as other@example.invalid; this link is for Someone@Example.Invalid.');
    expect(res.text).toContain('Sign out of Microsoft in this browser');
    expect(res.text).toMatch(/your link still works/);
    expect(res.text).not.toContain(REFRESH);
    expect(await mappingSecret(MAPPING)).toBeNull();
    expect(await linkState(MAPPING, id)).toBe('live');

    // And it does: the same link, with the account it names.
    meAnswer = me({ mail: NAMED });
    const again = await end(stateOf(await begin(token)));
    expect(again.status).toBe(200);
    expect((await mappingSecret(MAPPING))?.refreshToken).toBe(REFRESH);
    expect(await linkState(MAPPING, id)).toBe('used');
  });

  it('does not take the email claim alone as the account: an administrator sets it freely', async () => {
    // `workClaims` carries `email: NAMED`; the directory says nothing of it.
    meAnswer = me({ mail: null, proxyAddresses: [] });
    const { res, id } = await grantWith(MAPPING);
    expect(res.status).toBe(403);
    expect(await mappingSecret(MAPPING)).toBeNull();
    expect(await linkState(MAPPING, id)).toBe('live');
  });

  for (const [what, claims] of [
    ['another tenant issued it', workClaims({ iss: 'https://login.microsoftonline.com/99999999-2222-3333-4444-555555555555/v2.0' })],
    ['it is not Microsoft’s v2.0 issuer', workClaims({ iss: `https://sts.windows.net/${WORK_TENANT}/` })],
    ['it was issued to another application', workClaims({ aud: 'another-client' })],
  ] as const) {
    it(`stores nothing when the ID token says ${what}`, async () => {
      tokenBody = { ...tokenBody, id_token: idToken(claims) };
      meAnswer = me({ mail: NAMED });
      const { res, id } = await grantWith(MAPPING);
      expect(res.status).toBe(403);
      expect(res.text).toMatch(/Microsoft did not confirm which account you signed in with/);
      expect(await mappingSecret(MAPPING)).toBeNull();
      expect(await linkState(MAPPING, id)).toBe('live');
    });
  }

  it('stores nothing when the grant cannot read the profile (no User.Read)', async () => {
    meAnswer = { status: 403, body: { error: { code: 'Authorization_RequestDenied' } } };
    const { res, id } = await grantWith(MAPPING);
    expect(res.status).toBe(403);
    expect(await mappingSecret(MAPPING)).toBeNull();
    expect(await linkState(MAPPING, id)).toBe('live');
  });

  it('a fault at Microsoft is a fault, never an empty answer: nothing stored, link unused', async () => {
    meAnswer = { status: 503, body: {} };
    const quiet = vi.spyOn(log, 'error').mockImplementation(() => {});
    try {
      const { res, id } = await grantWith(MAPPING);
      expect(res.status).toBe(502);
      expect(res.text).toContain('ours to fix, not yours');
      expect(await mappingSecret(MAPPING)).toBeNull();
      expect(await linkState(MAPPING, id)).toBe('live');
    } finally {
      quiet.mockRestore();
    }
  });

  it('says an organisation’s admin-consent policy in Entra’s own words, and leaves the link unused', async () => {
    await clearSecret(MAPPING);
    const { token, id } = await mintLink(MAPPING);
    const res = await end(stateOf(await begin(token)), {
      error: 'access_denied',
      error_description: 'AADSTS90094: admin consent required',
    });
    expect(res.text).toContain('AADSTS90094');
    expect(tokenRequests).toEqual([]);
    expect(await mappingSecret(MAPPING)).toBeNull();
    expect(await linkState(MAPPING, id)).toBe('live');
  });
});

/**
 * A PERSON'S LINK (ADR-0035, amended 2026-09-29) with a Microsoft account on
 * it beside a Google one: each account its own card, its own provider, its
 * own button, and the Microsoft ending storing on that account's migrations.
 */
describe('a person’s link with a Microsoft account on it (0171 §3.2)', () => {
  const mintPersonLink = () =>
    withTenant(driver, TENANT, (db) =>
      issuePersonLink(db, { tenantId: TENANT, personId: PERSON, purpose: 'grant', createdBy: 'pat', expiresAt: expiryFromDays(7) }),
    );
  const personal = () =>
    idToken({
      iss: `https://login.microsoftonline.com/${PERSONAL_TENANT}/v2.0`,
      aud: CLIENT_ID,
      tid: PERSONAL_TENANT,
      preferred_username: PERSONAL_NAMED,
    });

  it('lists each account with its provider', async () => {
    const { token } = await mintPersonLink();
    const res = await request(app).get(`/api/grant/${token}`);
    expect(res.status).toBe(200);
    const byAccount = Object.fromEntries(
      (res.body.accounts as Array<{ account: string; provider: string }>).map((a) => [a.account, a.provider]),
    );
    expect(byAccount).toEqual({ [PERSONAL_NAMED]: 'microsoft', 'someone@gmail.com': 'google' });
  });

  it('opens Microsoft for the Microsoft account, and refuses that account at Google’s door', async () => {
    await clearSecret(PERSONAL);
    const { token } = await mintPersonLink();
    const atGoogle = await request(app).post(`/api/grant/${token}/google/authorize`).send({ account: PERSONAL_NAMED });
    expect(atGoogle.body.error).toBe('not_this_account');
    const res = await request(app).post(`/api/grant/${token}/microsoft/authorize`).send({ account: PERSONAL_NAMED });
    expect(res.status).toBe(200);
    expect(new URL(res.body.url).host).toBe('login.microsoftonline.com');
  });

  it('stores the Microsoft grant on that account’s migration only, and nothing for another account', async () => {
    await clearSecret(PERSONAL);
    const { token } = await mintPersonLink();
    const started = await request(app).post(`/api/grant/${token}/microsoft/authorize`).send({ account: PERSONAL_NAMED });

    tokenBody = { ...tokenBody, id_token: idToken({ ...JSON.parse(Buffer.from(personal().split('.')[1]!, 'base64url').toString()), preferred_username: 'someone.else@outlook.com' }) };
    const wrong = await end(stateOf(started));
    expect(wrong.status).toBe(403);
    expect(await mappingSecret(PERSONAL)).toBeNull();

    tokenBody = { ...tokenBody, id_token: personal() };
    const again = await request(app).post(`/api/grant/${token}/microsoft/authorize`).send({ account: PERSONAL_NAMED });
    const ok = await end(stateOf(again));
    expect(ok.status).toBe(200);
    expect(await mappingSecret(PERSONAL)).toEqual({ refreshToken: REFRESH, tenantId: 'common' });
    // The Gmail on the same link is Google's to grant, and untouched.
    expect(await mappingSecret(GMAIL)).toBeNull();
  });
});
