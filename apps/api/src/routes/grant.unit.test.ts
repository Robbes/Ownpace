// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The migrator's flow, beginning to ending (workplan 0108 T4).
 *
 * PGlite as `app_user`, and the table is read directly at every step, because
 * the claims being made are about what IS and IS NOT stored:
 *
 *  - the owner's client secret never leaves the server (it is not in the
 *    consent URL, not in any response);
 *  - the refresh token reaches the database and NOTHING else — not the page,
 *    not the response, not a postMessage;
 *  - the link is claimed BEFORE the credential is written, so a link revoked
 *    mid-flight stores nothing;
 *  - the credential lands on the MAPPING, never on the shared connection.
 *
 * Google is the one thing stubbed — `exchangeCode` takes an injectable fetch,
 * so the token endpoint is a function here and everything else is the product.
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
  revokeMappingLink,
  listMappingLinks,
  expiryFromDays,
} from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { SecretStore } from '@openmig/core/secret-store';

// UUID family 5f500000-…, unused elsewhere in the repo.
const TENANT = '5f500000-e29b-41d4-a716-446655441701';
const CONN = '5f500000-e29b-41d4-a716-446655441711';
const BARE_CONN = '5f500000-e29b-41d4-a716-446655441712';
const BOX = '5f500000-e29b-41d4-a716-446655441721';
const BARE_BOX = '5f500000-e29b-41d4-a716-446655441722';
const MAPPING = '5f500000-e29b-41d4-a716-446655441731';
const UNCONFIGURED = '5f500000-e29b-41d4-a716-446655441732';

const CLIENT_ID = 'client.apps.googleusercontent.com';
const CLIENT_SECRET = 'the-owners-secret-value';
const REFRESH = '1//a-granted-refresh-token';

let driver: LedgerDriver;

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return { ...actual, getDbPool: () => driver };
});

const { default: grantRoutes } = await import('./grant.ts');
const { default: googleOauthRoutes } = await import('./migrations/google-oauth-routes.ts');
const { GOOGLE_SOURCE_SCOPES } = await import('./migrations/google-consent.ts');

const app = express();
app.use(express.json());
app.use('/api/grant', grantRoutes);
app.use('/api/migrations', googleOauthRoutes);

/** What Google's token endpoint answers, swapped per test. */
let tokenResponse: () => { status: number; body: unknown };
/** What was POSTed to it — the only place the owner's secret may appear. */
let tokenRequests: URLSearchParams[] = [];

async function mappingRow(id: string): Promise<Record<string, unknown> | undefined> {
  const conn = await driver.acquire();
  try {
    const r = await conn.query('SELECT * FROM mailbox_mapping WHERE id = $1', [id]);
    return r.rows[0] as Record<string, unknown> | undefined;
  } finally {
    await conn.release();
  }
}

async function connectionRow(id: string): Promise<Record<string, unknown> | undefined> {
  const conn = await driver.acquire();
  try {
    const r = await conn.query('SELECT * FROM connection WHERE id = $1', [id]);
    return r.rows[0] as Record<string, unknown> | undefined;
  } finally {
    await conn.release();
  }
}

const mintLink = (mappingId: string, days = 7) =>
  withTenant(driver, TENANT, (db) =>
    issueMappingLink(db, {
      tenantId: TENANT,
      mappingId,
      purpose: 'grant',
      createdBy: 'rob',
      expiresAt: expiryFromDays(days),
    }),
  );

beforeAll(async () => {
  process.env.API_URL = 'https://api.example';
  process.env.WEB_URL = 'https://app.example';
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });

  // Google's token endpoint, replaced. `exchangeCode` uses the global fetch by
  // default, and the callback route calls it without injecting one — so this is
  // the seam. Nothing else in this file goes near a network.
  vi.stubGlobal('fetch', async (_url: string, init?: { body?: string }) => {
    tokenRequests.push(new URLSearchParams(init?.body ?? ''));
    const { status, body } = tokenResponse();
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  const creds = JSON.stringify(
    SecretStore.encryptCredentials({
      username: 'someone@example.invalid',
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    }).encrypted,
  );

  const conn = await driver.acquire();
  try {
    const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
    await q('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'Acme Legal']);
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
       VALUES ($1,$2,'source','gmail','g','{}'::jsonb,'connected',$3)`,
      [CONN, TENANT, creds],
    );
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1,$2,'source','gmail','bare','{}'::jsonb,'connected')`,
      [BARE_CONN, TENANT],
    );
    for (const [box, c] of [
      [BOX, CONN],
      [BARE_BOX, BARE_CONN],
    ]) {
      await q(
        `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
         VALUES ($1,$2,$3,'user','m@example.invalid')`,
        [box, TENANT, c],
      );
    }
    for (const [m, box] of [
      [MAPPING, BOX],
      [UNCONFIGURED, BARE_BOX],
    ]) {
      await q(
        `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status)
         VALUES ($1,$2,$3,'paused')`,
        [m, TENANT, box],
      );
    }
  } finally {
    await conn.release();
  }
},
  // 30s, not vitest's default 10s for hooks. This builds BOTH migration chains
  // in an in-memory Postgres before a single test runs. It passes alone and
  // failed only in a full `--project unit` run, where the machine is doing
  // dozens of other files at once — the third file in this repo to meet the
  // same wall (`support-routes` and `support-views` carry the same note and
  // the same remedy), and the worst way to find out, since a hook timeout
  // reports as 13 SKIPPED tests rather than as a failure with a cause.
  30_000,
);

afterAll(async () => {
  vi.unstubAllGlobals();
  await driver.end?.();
});

beforeEach(async () => {
  tokenRequests = [];
  tokenResponse = () => ({
    status: 200,
    body: { refresh_token: REFRESH, scope: GOOGLE_SOURCE_SCOPES.gmail },
  });
  // Each test starts from an unconnected mapping and no links.
  const conn = await driver.acquire();
  try {
    await conn.query('DELETE FROM mapping_link');
    await conn.query('UPDATE mailbox_mapping SET source_secret_ref = NULL');
  } finally {
    await conn.release();
  }
});

describe('what the page may know before the button', () => {
  it('says who is asking, what is read, the exact scope, and until when', async () => {
    const { token } = await mintLink(MAPPING);
    const res = await request(app).get(`/api/grant/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.organisation).toBe('Acme Legal');
    expect(res.body.reads).toMatch(/your email/);
    // The scope AS a scope (ADR-0041), not a paraphrase of one.
    expect(res.body.scope).toBe(GOOGLE_SOURCE_SCOPES.gmail);
    expect(Date.parse(res.body.expiresAt)).toBeGreaterThan(Date.now());
  });

  it('tells the link holder NOTHING else about the organisation', async () => {
    const { token } = await mintLink(MAPPING);
    const res = await request(app).get(`/api/grant/${token}`);
    const body = JSON.stringify(res.body);
    for (const leak of [TENANT, MAPPING, CONN, BOX, CLIENT_ID, CLIENT_SECRET, 'rob']) {
      expect(body, `${leak} must not reach a link holder`).not.toContain(leak);
    }
    expect(Object.keys(res.body).sort()).toEqual(['expiresAt', 'organisation', 'reads', 'scope']);
  });

  it('does not spend the link — a chat preview must not burn it', async () => {
    const { token, id } = await mintLink(MAPPING);
    await request(app).get(`/api/grant/${token}`);
    await request(app).get(`/api/grant/${token}`);
    const links = await withTenant(driver, TENANT, (db) =>
      listMappingLinks(db, { tenantId: TENANT, mappingId: MAPPING }),
    );
    expect(links.find((l) => l.id === id)?.state).toBe('live');
  });

  it('refuses a mapping whose Google application is not set up, in forwardable words', async () => {
    const { token } = await mintLink(UNCONFIGURED);
    const res = await request(app).get(`/api/grant/${token}`);
    expect(res.status).toBe(409);
    expect(res.body.reason).toMatch(/tell the person who sent you the link/);
  });

  it('refuses every kind of bad link with the SAME sentence', async () => {
    // The sentence names all three possibilities on purpose and says which one
    // applies to none of them — so the test that matters is that different
    // failures are indistinguishable, not that the words avoid a vocabulary.
    const malformed = await request(app).get('/api/grant/not-a-link');
    const unknown = await request(app).get(`/api/grant/${MAPPING}.aaaaaaaaaaaaaaaaaaaa`);

    const revokedLink = await mintLink(MAPPING);
    await withTenant(driver, TENANT, (db) =>
      revokeMappingLink(db, { tenantId: TENANT, linkId: revokedLink.id }),
    );
    const revoked = await request(app).get(`/api/grant/${revokedLink.token}`);

    const expiredLink = await mintLink(MAPPING, -1);
    const expired = await request(app).get(`/api/grant/${expiredLink.token}`);

    for (const res of [malformed, unknown, revoked, expired]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual(malformed.body);
    }
  });
});

describe('starting the consent', () => {
  it("puts the client id in the URL and the owner's SECRET nowhere", async () => {
    const { token } = await mintLink(MAPPING);
    const res = await request(app).post(`/api/grant/${token}/google/authorize`).send({});
    expect(res.status).toBe(200);

    const url = new URL(res.body.url);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('scope')).toBe(GOOGLE_SOURCE_SCOPES.gmail);
    // The two that must never be forgotten, or the grant yields no refresh token.
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    // The whole point of reading the client server-side.
    expect(res.text).not.toContain(CLIENT_SECRET);
  });

  it('ignores a client the caller tries to supply in the body', async () => {
    // The owner's route takes these from the body because the owner types them.
    // This one must not, or a link holder could aim the consent at their own
    // client and collect the code themselves — and the exchange would run
    // under a secret they chose.
    const { token } = await mintLink(MAPPING);
    const started = await request(app)
      .post(`/api/grant/${token}/google/authorize`)
      .send({ clientId: 'attacker.apps.googleusercontent.com', clientSecret: 'theirs' });
    expect(new URL(started.body.url).searchParams.get('client_id')).toBe(CLIENT_ID);

    // And the same at the OTHER end: the exchange is where the secret is
    // actually used, so asserting only the URL would leave that half open.
    const state = new URL(started.body.url).searchParams.get('state')!;
    await request(app).get('/api/migrations/google/callback').query({ state, code: 'c' });
    expect(tokenRequests).toHaveLength(1);
    expect(tokenRequests[0]!.get('client_id')).toBe(CLIENT_ID);
    expect(tokenRequests[0]!.get('client_secret')).toBe(CLIENT_SECRET);
  });

  it("sends the owner's secret to Google's token endpoint and NOWHERE else", async () => {
    const { token } = await mintLink(MAPPING);
    const started = await request(app).post(`/api/grant/${token}/google/authorize`).send({});
    const state = new URL(started.body.url).searchParams.get('state')!;
    const ended = await request(app)
      .get('/api/migrations/google/callback')
      .query({ state, code: 'auth-code' });

    // In the POST body — the one place it belongs (ADR-0037, and 0089 T1's own
    // rule: never a URL, never a log, never a page).
    expect(tokenRequests[0]!.get('client_secret')).toBe(CLIENT_SECRET);
    expect(started.text).not.toContain(CLIENT_SECRET);
    expect(started.body.url).not.toContain(CLIENT_SECRET);
    expect(ended.text).not.toContain(CLIENT_SECRET);
  });
});

describe('the ending', () => {
  /** Walk the whole flow and hand back the callback response. */
  async function grantThrough(token: string) {
    const started = await request(app).post(`/api/grant/${token}/google/authorize`).send({});
    const state = new URL(started.body.url).searchParams.get('state')!;
    return request(app).get('/api/migrations/google/callback').query({ state, code: 'auth-code' });
  }

  it('stores the token on the MAPPING, shows it to nobody, and spends the link', async () => {
    const { token, id } = await mintLink(MAPPING);
    const res = await grantThrough(token);

    expect(res.status).toBe(200);
    // Not in the page, in any form. This is the sentence the whole task exists
    // for: the owner's ending hands the token to a window; this one does not.
    expect(res.text).not.toContain(REFRESH);
    expect(res.text).not.toContain('postMessage');
    expect(res.text).toMatch(/that is done/i);
    expect(res.text).toMatch(/read-only/i);

    const mapping = await mappingRow(MAPPING);
    expect(mapping?.source_secret_ref).toBeTruthy();
    const stored = SecretStore.decryptCredentials(String(mapping!.source_secret_ref));
    expect(stored.refreshToken).toBe(REFRESH);
    // Only the migrator's half — the owner's client stays on the connection.
    expect(Object.keys(stored)).toEqual(['refreshToken']);
    // At rest it is encrypted, so the raw column holds nothing readable.
    expect(String(mapping!.source_secret_ref)).not.toContain(REFRESH);

    // The shared connection is untouched: another mapping on it gains nothing.
    const connection = await connectionRow(CONN);
    expect(JSON.stringify(connection)).not.toContain(REFRESH);

    const links = await withTenant(driver, TENANT, (db) =>
      listMappingLinks(db, { tenantId: TENANT, mappingId: MAPPING }),
    );
    expect(links.find((l) => l.id === id)?.state).toBe('used');
  });

  it('stores NOTHING when the owner revoked the link mid-flight', async () => {
    const { token, id } = await mintLink(MAPPING);
    // Begun, then revoked, then completed — the race a kill switch exists for.
    const started = await request(app).post(`/api/grant/${token}/google/authorize`).send({});
    const state = new URL(started.body.url).searchParams.get('state')!;
    await withTenant(driver, TENANT, (db) =>
      revokeMappingLink(db, { tenantId: TENANT, linkId: id }),
    );

    const res = await request(app)
      .get('/api/migrations/google/callback')
      .query({ state, code: 'auth-code' });

    expect(res.status).toBe(409);
    expect(res.text).toMatch(/Nothing was stored/);
    expect((await mappingRow(MAPPING))?.source_secret_ref).toBeNull();
  });

  it('stores nothing and shows nothing when Google grants less than asked', async () => {
    tokenResponse = () => ({
      status: 200,
      body: { refresh_token: REFRESH, scope: 'https://www.googleapis.com/auth/userinfo.email' },
    });
    const { token, id } = await mintLink(MAPPING);
    const res = await grantThrough(token);

    expect(res.status).toBe(400);
    expect(res.text).not.toContain(REFRESH);
    expect((await mappingRow(MAPPING))?.source_secret_ref).toBeNull();
    // And the link is NOT spent: nothing landed, so they may try again.
    const links = await withTenant(driver, TENANT, (db) =>
      listMappingLinks(db, { tenantId: TENANT, mappingId: MAPPING }),
    );
    expect(links.find((l) => l.id === id)?.state).toBe('live');
  });

  it('refuses in the migrator’s voice, not the wizard’s', async () => {
    tokenResponse = () => ({ status: 400, body: { error: 'invalid_grant' } });
    const { token } = await mintLink(MAPPING);
    const res = await grantThrough(token);
    // The owner's failure page says "try again from the wizard", which means
    // nothing to somebody who has never seen one.
    expect(res.text).not.toMatch(/wizard/i);
    expect(res.text).toMatch(/ask the person who sent it/i);
  });

  it('cannot be replayed: the state is single-use', async () => {
    const { token } = await mintLink(MAPPING);
    const started = await request(app).post(`/api/grant/${token}/google/authorize`).send({});
    const state = new URL(started.body.url).searchParams.get('state')!;
    const first = await request(app)
      .get('/api/migrations/google/callback')
      .query({ state, code: 'auth-code' });
    expect(first.status).toBe(200);

    const replay = await request(app)
      .get('/api/migrations/google/callback')
      .query({ state, code: 'auth-code' });
    expect(replay.status).toBe(400);
    expect(replay.text).not.toContain(REFRESH);
  });
});
