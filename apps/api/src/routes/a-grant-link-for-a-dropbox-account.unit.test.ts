// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GRANT LINK FOR A DROPBOX ACCOUNT (workplan 0174 §6, T2; superseding 0171 T4).
 *
 * The whole flow, through the real routes and a real ledger (PGlite, both
 * migration chains), with Dropbox's two endpoints stood in for: the token
 * endpoint, which answers the code with a refresh token, an access token and
 * the scopes it granted, and `users/get_current_account`, which says which
 * address the account has and whether Dropbox verified it. After every ending
 * the tables are read: for any account but the named one, and for an address
 * Dropbox has not verified, nothing is stored and the link is left live.
 *
 * What this cannot prove: a real Dropbox account's sign-in, or what Dropbox
 * answers for one. No test account exists; that is a person's check on a
 * deployment with a Dropbox app (workplan 0174 §11).
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

// UUID family 71740000-…, unused elsewhere in the repo.
const TENANT = '71740000-e29b-41d4-a716-446655440001';
const CONN = '71740000-e29b-41d4-a716-446655440011';
const BOX = '71740000-e29b-41d4-a716-446655440021';
const MAPPING = '71740000-e29b-41d4-a716-446655440031';
const TARGET_CONN = '71740000-e29b-41d4-a716-446655440012';
const TARGET_BOX = '71740000-e29b-41d4-a716-446655440022';
const PERSON_CONN = '71740000-e29b-41d4-a716-446655440013';
const PERSON_BOX = '71740000-e29b-41d4-a716-446655440023';
const PERSON_MAPPING = '71740000-e29b-41d4-a716-446655440033';
const MS_CONN = '71740000-e29b-41d4-a716-446655440014';
const MS_BOX = '71740000-e29b-41d4-a716-446655440024';
const MS_MAPPING = '71740000-e29b-41d4-a716-446655440034';
const PERSON = '71740000-e29b-41d4-a716-446655440041';

/** The account the migration reads, as its owner typed it. */
const NAMED = 'Someone@Example.Invalid';
/** The account a person's migration reads. */
const PERSON_NAMED = 'person@example.invalid';

/** The deployment's own Dropbox app, as every test here runs on it. */
const APP_KEY = 'the-deployments-dropbox-app-key';
const APP_SECRET = 'the-deployments-dropbox-app-secret';
const REFRESH = 'a-granted-dropbox-refresh-token';
const ACCESS = 'a-short-lived-dropbox-access-token';

let driver: LedgerDriver;

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return { ...actual, getDbPool: () => driver };
});

const { default: grantRoutes } = await import('./grant.ts');
const { default: dropboxOauthRoutes } = await import('./migrations/dropbox-oauth-routes.ts');

const app = express();
app.use(express.json());
app.use('/api/grant', grantRoutes);
app.use('/api/migrations', dropboxOauthRoutes);

/** What Dropbox answers, swapped per test. */
let tokenAnswer: { status: number; body: Record<string, unknown> | string };
let accountAnswer: { status: number; body: Record<string, unknown> };
let tokenRequests: string[] = [];
let accountRequests: Array<{ authorization: string | null; method: string | undefined }> = [];

/** `get_current_account` for an account with this address. */
const account = (email: string, verified = true) => ({
  status: 200,
  body: { account_id: 'dbid:invented', email, email_verified: verified, name: { display_name: 'Someone' } },
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

const mintPersonLink = () =>
  withTenant(driver, TENANT, (db) =>
    issuePersonLink(db, { tenantId: TENANT, personId: PERSON, purpose: 'grant', createdBy: 'pat', expiresAt: expiryFromDays(7) }),
  );

const linkState = async (mappingId: string, id: string) =>
  (await withTenant(driver, TENANT, (db) => listMappingLinks(db, { tenantId: TENANT, mappingId }))).find(
    (l) => l.id === id,
  )?.state;

beforeAll(async () => {
  process.env.API_URL = 'https://api.example';
  process.env.WEB_URL = 'https://app.example';
  process.env.DROPBOX_OAUTH_CLIENT_ID = APP_KEY;
  process.env.DROPBOX_OAUTH_CLIENT_SECRET = APP_SECRET;
  process.env.MICROSOFT_OAUTH_CLIENT_ID = '00000000-0000-0000-0000-0000000000aa';
  process.env.MICROSOFT_OAUTH_CLIENT_SECRET = 'the-deployments-microsoft-secret';
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });

  // Dropbox's token endpoint and `get_current_account`, replaced; nothing
  // else here goes near a network.
  vi.stubGlobal('fetch', async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
    const json = (status: number, body: unknown) =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    if (String(url) === 'https://api.dropboxapi.com/oauth2/token') {
      tokenRequests.push(String(url));
      return json(tokenAnswer.status, tokenAnswer.body);
    }
    if (String(url) === 'https://api.dropboxapi.com/2/users/get_current_account') {
      accountRequests.push({ authorization: init?.headers?.Authorization ?? null, method: init?.method });
      return json(accountAnswer.status, accountAnswer.body);
    }
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
    // Two Dropbox accounts saved for somebody else, a name and nothing to sign
    // in with (the grant brings it), and a Microsoft account beside them.
    for (const [id, kind, user] of [
      [CONN, 'dropbox', NAMED],
      [PERSON_CONN, 'dropbox', PERSON_NAMED],
      [MS_CONN, 'microsoft', 'someone@outlook.com'],
    ] as const) {
      await q(
        `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
         VALUES ($1,$2,'source',$3,'s',$4::jsonb,'connected')`,
        [id, TENANT, kind, JSON.stringify({ user })],
      );
    }
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1,$2,'target','nextcloud','nc','{"host":"cloud.example.org","port":443}'::jsonb,'connected')`,
      [TARGET_CONN, TENANT],
    );
    for (const [box, c] of [
      [BOX, CONN],
      [PERSON_BOX, PERSON_CONN],
      [MS_BOX, MS_CONN],
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
      [PERSON_MAPPING, PERSON_BOX],
      [MS_MAPPING, MS_BOX],
    ]) {
      await q(
        `INSERT INTO mailbox_mapping
           (id, tenant_id, source_mailbox_id, target_mailbox_id, target_config_override, status)
         VALUES ($1,$2,$3,$4,'{"user":"dest@example.org"}'::jsonb,'paused')`,
        [m, TENANT, box, TARGET_BOX],
      );
    }
    await q(`INSERT INTO person (id, tenant_id, display_name) VALUES ($1,$2,'The person')`, [PERSON, TENANT]);
    await q('INSERT INTO person_migration (mapping_id, person_id, tenant_id) VALUES ($1,$2,$3)', [
      PERSON_MAPPING,
      PERSON,
      TENANT,
    ]);
    for (const [m, domain] of [
      [MAPPING, 'file'],
      [PERSON_MAPPING, 'file'],
      [MS_MAPPING, 'calendar'],
    ] as const) {
      await q(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1,$2,$3,true)`, [
        TENANT,
        m,
        domain,
      ]);
    }
  } finally {
    await conn.release();
  }
}, 30_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  delete process.env.DROPBOX_OAUTH_CLIENT_ID;
  delete process.env.DROPBOX_OAUTH_CLIENT_SECRET;
  delete process.env.MICROSOFT_OAUTH_CLIENT_ID;
  delete process.env.MICROSOFT_OAUTH_CLIENT_SECRET;
  await driver.end?.();
});

beforeEach(() => {
  tokenRequests = [];
  accountRequests = [];
  tokenAnswer = {
    status: 200,
    body: {
      refresh_token: REFRESH,
      access_token: ACCESS,
      token_type: 'bearer',
      scope: 'account_info.read files.metadata.read files.content.read',
    },
  };
  // The named account, in another case: compared without case.
  accountAnswer = account(NAMED.toLowerCase());
});

async function begin(token: string, provider = 'dropbox', body: Record<string, unknown> = {}) {
  return request(app).post(`/api/grant/${token}/${provider}/authorize`).send({ locale: 'en', ...body });
}
const stateOf = (res: { body: { url: string } }) => new URL(res.body.url).searchParams.get('state')!;
const end = (state: string, query: Record<string, string> = { code: 'auth-code' }) =>
  request(app).get('/api/migrations/dropbox/callback').query({ state, ...query });

describe('the page and the button of a Dropbox link', () => {
  it('says whose sign-in it opens, and asks for files and the account read, read-only', async () => {
    const { token } = await mintLink(MAPPING);
    const res = await request(app).get(`/api/grant/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('dropbox');
    expect(res.body.from).toBe(NAMED);
    expect(res.body.domains).toEqual(['file']);
    expect(res.body.scope.split(' ')).toEqual(['account_info.read', 'files.metadata.read', 'files.content.read']);
    expect(res.body.readOnlyAtProvider).toBe(true);
    // Never the app's secret, nor its key.
    expect(JSON.stringify(res.body)).not.toContain(APP_SECRET);
    expect(JSON.stringify(res.body)).not.toContain(APP_KEY);
  });

  it('sends the browser to Dropbox with lasting, read-only access, and no hint (Dropbox takes none)', async () => {
    const { token } = await mintLink(MAPPING);
    const res = await begin(token);
    expect(res.status).toBe(200);
    const url = new URL(res.body.url);
    expect(url.host).toBe('www.dropbox.com');
    expect(url.searchParams.get('token_access_type')).toBe('offline');
    expect(url.searchParams.get('client_id')).toBe(APP_KEY);
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.example/api/migrations/dropbox/callback');
    expect(url.searchParams.get('scope')).toBe('account_info.read files.metadata.read files.content.read');
    expect(url.searchParams.has('login_hint')).toBe(false);
    expect(url.toString()).not.toContain(APP_SECRET);
  });

  it('refuses to open Google or Microsoft for a Dropbox link, and Dropbox for a Microsoft one', async () => {
    const d = await mintLink(MAPPING);
    expect((await begin(d.token, 'google')).body.error).toBe('not_this_provider');
    expect((await begin(d.token, 'microsoft')).body.error).toBe('not_this_provider');
    const ms = await mintLink(MS_MAPPING);
    expect((await begin(ms.token, 'dropbox')).body.error).toBe('not_this_provider');
  });
});

describe('the account that signs in must be the one the link names (0174 §6)', () => {
  async function grantWith(mappingId: string) {
    await clearSecret(mappingId);
    const { token, id } = await mintLink(mappingId);
    const res = await end(stateOf(await begin(token)));
    return { res, id, token };
  }

  it('binds over the verified email, without case, and stores the refresh token alone', async () => {
    const { res, id } = await grantWith(MAPPING);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(REFRESH);
    expect(res.text).not.toContain(ACCESS);
    // Asked with the new access token, as an RPC with no arguments.
    expect(accountRequests).toEqual([{ authorization: `Bearer ${ACCESS}`, method: 'POST' }]);
    expect(await mappingSecret(MAPPING)).toEqual({ refreshToken: REFRESH });
    expect(await linkState(MAPPING, id)).toBe('used');
  });

  it('refuses an email Dropbox has not verified: nothing stored, the link live', async () => {
    accountAnswer = account(NAMED, false);
    const { res, id } = await grantWith(MAPPING);
    expect(res.status).toBe(403);
    expect(res.text).toMatch(/Dropbox did not confirm which account you signed in with/);
    expect(res.text).not.toContain(REFRESH);
    expect(await mappingSecret(MAPPING)).toBeNull();
    expect(await linkState(MAPPING, id)).toBe('live');
  });

  it('stores nothing for ANOTHER account, says which, and leaves the link working', async () => {
    accountAnswer = account('other@example.invalid');
    const { res, id, token } = await grantWith(MAPPING);
    expect(res.status).toBe(403);
    expect(res.text).toContain('You signed in as other@example.invalid; this link is for Someone@Example.Invalid.');
    expect(res.text).toContain('Sign out of Dropbox in this browser');
    expect(res.text).toMatch(/your link still works/);
    expect(res.text).not.toContain(REFRESH);
    expect(await mappingSecret(MAPPING)).toBeNull();
    expect(await linkState(MAPPING, id)).toBe('live');

    // And it does: the same link, with the account it names.
    accountAnswer = account(NAMED);
    const again = await end(stateOf(await begin(token)));
    expect(again.status).toBe(200);
    expect((await mappingSecret(MAPPING))?.refreshToken).toBe(REFRESH);
    expect(await linkState(MAPPING, id)).toBe('used');
  });

  it('stores nothing when Dropbox will not say who signed in (the token refused for the account read)', async () => {
    accountAnswer = { status: 401, body: { error_summary: 'missing_scope/' } };
    const { res, id } = await grantWith(MAPPING);
    expect(res.status).toBe(403);
    expect(await mappingSecret(MAPPING)).toBeNull();
    expect(await linkState(MAPPING, id)).toBe('live');
  });

  it('a refused exchange stores nothing, asks nobody who signed in, and leaves the link unused', async () => {
    tokenAnswer = { status: 400, body: { error: 'invalid_grant', error_description: 'code doesn’t exist or has expired' } };
    const quiet = vi.spyOn(log, 'warn').mockImplementation(() => {});
    try {
      const { res, id } = await grantWith(MAPPING);
      expect(res.status).toBe(400);
      expect(res.text).toContain('Dropbox did not accept the sign-in when it came back');
      // Worded for somebody who holds no app: never the owner's App Console.
      expect(res.text).not.toMatch(/App Console|oauth-app/);
      expect(accountRequests).toEqual([]);
      expect(await mappingSecret(MAPPING)).toBeNull();
      expect(await linkState(MAPPING, id)).toBe('live');
    } finally {
      quiet.mockRestore();
    }
  });

  it('a grant that could write is refused at the exchange: nothing stored, the link unused', async () => {
    tokenAnswer = {
      status: 200,
      body: { refresh_token: REFRESH, access_token: ACCESS, scope: 'account_info.read files.metadata.read files.content.read files.content.write' },
    };
    const quiet = vi.spyOn(log, 'warn').mockImplementation(() => {});
    try {
      const { res, id } = await grantWith(MAPPING);
      expect(res.status).toBe(400);
      expect(accountRequests).toEqual([]);
      expect(await mappingSecret(MAPPING)).toBeNull();
      expect(await linkState(MAPPING, id)).toBe('live');
    } finally {
      quiet.mockRestore();
    }
  });

  it('a fault at Dropbox is a fault, never an empty answer: nothing stored, link unused', async () => {
    accountAnswer = { status: 503, body: {} };
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

  it('says a refusal at Dropbox in Dropbox’s name, and exchanges nothing', async () => {
    await clearSecret(MAPPING);
    const { token, id } = await mintLink(MAPPING);
    const res = await end(stateOf(await begin(token)), { error: 'access_denied', error_description: 'The user chose not to give your app access' });
    expect(res.text).toContain('Permission was not given at Dropbox.');
    expect(tokenRequests).toEqual([]);
    expect(await mappingSecret(MAPPING)).toBeNull();
    expect(await linkState(MAPPING, id)).toBe('live');
  });
});

describe('a person’s link with a Dropbox account on it (0174 §6)', () => {
  it('lists the account with its provider', async () => {
    const { token } = await mintPersonLink();
    const res = await request(app).get(`/api/grant/${token}`);
    expect(res.status).toBe(200);
    const accounts = res.body.accounts as Array<{ account: string; provider: string; domains: string[] }>;
    expect(accounts.map((a) => [a.account, a.provider, a.domains])).toEqual([[PERSON_NAMED, 'dropbox', ['file']]]);
  });

  it('stores the grant on that account’s migration, and nothing for another account', async () => {
    await clearSecret(PERSON_MAPPING);
    const { token } = await mintPersonLink();
    const started = await begin(token, 'dropbox', { account: PERSON_NAMED });
    expect(started.status).toBe(200);
    expect(new URL(started.body.url).host).toBe('www.dropbox.com');

    accountAnswer = account('someone.else@example.invalid');
    const wrong = await end(stateOf(started));
    expect(wrong.status).toBe(403);
    expect(await mappingSecret(PERSON_MAPPING)).toBeNull();

    accountAnswer = account(PERSON_NAMED.toUpperCase());
    const again = await begin(token, 'dropbox', { account: PERSON_NAMED });
    const ok = await end(stateOf(again));
    expect(ok.status).toBe(200);
    expect(await mappingSecret(PERSON_MAPPING)).toEqual({ refreshToken: REFRESH });
  });
});
