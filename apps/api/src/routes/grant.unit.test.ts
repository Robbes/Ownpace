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
 * It answers with an ID token as Google does, naming who signed in: since
 * 0108 T8 (b) the ending stores nothing for any account but the one named.
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
import { runManagedMigrations } from '@openmig/managed';
import { SecretStore } from '@openmig/core/secret-store';

// UUID family 5f500000-…, unused elsewhere in the repo.
const TENANT = '5f500000-e29b-41d4-a716-446655441701';
const CONN = '5f500000-e29b-41d4-a716-446655441711';
const BARE_CONN = '5f500000-e29b-41d4-a716-446655441712';
const BOX = '5f500000-e29b-41d4-a716-446655441721';
const BARE_BOX = '5f500000-e29b-41d4-a716-446655441722';
const MAPPING = '5f500000-e29b-41d4-a716-446655441731';
const UNCONFIGURED = '5f500000-e29b-41d4-a716-446655441732';
/** Where every mapping here copies to, so the page has a destination to name. */
const TARGET_CONN = '5f500000-e29b-41d4-a716-446655441713';
const TARGET_BOX = '5f500000-e29b-41d4-a716-446655441723';
/** The ready mapping's source, with its destination gone. */
const NO_TARGET = '5f500000-e29b-41d4-a716-446655441733';
/** A calendar source that stores no client of its own (0108 T6). */
const CALENDAR_CONN = '5f500000-e29b-41d4-a716-446655441714';
const CALENDAR_BOX = '5f500000-e29b-41d4-a716-446655441724';
const CALENDAR = '5f500000-e29b-41d4-a716-446655441734';
/** A Google ACCOUNT source, no client of its own, copying two types (0108 T7). */
const ACCOUNT_CONN = '5f500000-e29b-41d4-a716-446655441715';
const ACCOUNT_BOX = '5f500000-e29b-41d4-a716-446655441725';
const ACCOUNT = '5f500000-e29b-41d4-a716-446655441735';
/** Gmail with a whole client of its own and NO account named (0108 T8 (b)). */
const NAMELESS_CONN = '5f500000-e29b-41d4-a716-446655441716';
const NAMELESS_BOX = '5f500000-e29b-41d4-a716-446655441726';
const NAMELESS = '5f500000-e29b-41d4-a716-446655441736';

/** The account the ready mapping reads: its connection's stored username. */
const NAMED = 'someone@example.invalid';

/** The deployment's own Google client, set only by the tests that need one. */
const DEPLOYMENT_CLIENT_ID = 'deployment.apps.googleusercontent.com';
const DEPLOYMENT_CLIENT_SECRET = 'the-deployments-secret-value';

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
const { googleAccountConsent, isRefusal } = await import('./migrations/google-account-consent.ts');
const { SIGNED_IN_ACCOUNT_SCOPES } = await import('./migrations/signed-in-account.ts');

/** What every link asks beside the data: who signed in (0108 T8 (b)). */
const WHO = SIGNED_IN_ACCOUNT_SCOPES.join(' ');

/**
 * An ID token as Google's token endpoint answers it, for `email` signed in to
 * the application `aud`. Unsigned: it arrives from the token endpoint itself,
 * and nothing in the product checks a signature it has no need to.
 */
function idTokenFor(email: string, aud: string = CLIENT_ID): string {
  const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const claims = { iss: 'https://accounts.google.com', aud, sub: '1', email, email_verified: true };
  return `${part({ alg: 'RS256' })}.${part(claims)}.sig`;
}

/** Run `fn` on a deployment that carries its own Google client, then take it away. */
async function onTheDeploymentsClient<T>(fn: () => Promise<T>): Promise<T> {
  process.env.GOOGLE_OAUTH_CLIENT_ID = DEPLOYMENT_CLIENT_ID;
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = DEPLOYMENT_CLIENT_SECRET;
  try {
    return await fn();
  } finally {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  }
}

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
  // The managed chain too: who asked is a `tenant_member` row (0108 T8a).
  await runManagedMigrations({ driver, logger: () => {} });

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
      username: NAMED,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    }).encrypted,
  );
  // The same client, and no account anywhere: not in the secret, not in the
  // connection's config.
  const namelessCreds = JSON.stringify(
    SecretStore.encryptCredentials({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }).encrypted,
  );

  const conn = await driver.acquire();
  try {
    const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
    // With the organisation's phone number, which the page shows (0108 T8a).
    await q('INSERT INTO tenant (id, name, settings) VALUES ($1,$2,$3::jsonb)', [
      TENANT,
      'Acme Legal',
      JSON.stringify({ contactPhone: '+31 20 123 4567' }),
    ]);
    // A business whose VAT number VIES checked and found valid (0108 T8a): the
    // page shows the name the register gave.
    await q(
      `INSERT INTO billing_party (tenant_id, kind, name, address_line1, postal_code, city, country_code, vat_number)
       VALUES ($1,'business','Acme Legal','Keizersgracht 1','1015 AA','Amsterdam','NL','NL123456789B01')`,
      [TENANT],
    );
    await q(
      `INSERT INTO vat_consultation (tenant_id, country_code, vat_number, valid, trader_name)
       VALUES ($1,'NL','123456789B01',true,'ACME LEGAL B.V.')`,
      [TENANT],
    );
    // The member who issues every link below (`mintLink`'s createdBy): the page
    // names them by the address they sign in with (0108 T8a).
    await q(`INSERT INTO tenant_member (tenant_id, user_id, email) VALUES ($1,$2,$3)`, [
      TENANT,
      'rob',
      'owner@example.org',
    ]);
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
       VALUES ($1,$2,'source','gmail','g','{}'::jsonb,'connected',$3)`,
      [CONN, TENANT, creds],
    );
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1,$2,'source','gmail','bare','{"user":"bare@example.invalid"}'::jsonb,'connected')`,
      [BARE_CONN, TENANT],
    );
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1,$2,'source','google_calendar','cal','{"user":"calendar@example.invalid"}'::jsonb,'connected')`,
      [CALENDAR_CONN, TENANT],
    );
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
       VALUES ($1,$2,'source','gmail','nameless','{}'::jsonb,'connected',$3)`,
      [NAMELESS_CONN, TENANT, namelessCreds],
    );
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1,$2,'source','google','account','{"user":"account@example.invalid"}'::jsonb,'connected')`,
      [ACCOUNT_CONN, TENANT],
    );
    // The destination: a Nextcloud named by its host, with no credential in
    // this fixture — the account it writes is the mapping's own.
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1,$2,'target','nextcloud','nc','{"host":"cloud.example.org","port":443}'::jsonb,'connected')`,
      [TARGET_CONN, TENANT],
    );
    for (const [box, c] of [
      [BOX, CONN],
      [BARE_BOX, BARE_CONN],
      [CALENDAR_BOX, CALENDAR_CONN],
      [ACCOUNT_BOX, ACCOUNT_CONN],
      [NAMELESS_BOX, NAMELESS_CONN],
      [TARGET_BOX, TARGET_CONN],
    ]) {
      await q(
        `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
         VALUES ($1,$2,$3,'user','m@example.invalid')`,
        [box, TENANT, c],
      );
    }
    for (const [m, box, target] of [
      [MAPPING, BOX, TARGET_BOX],
      [UNCONFIGURED, BARE_BOX, TARGET_BOX],
      [NO_TARGET, BOX, null],
      [CALENDAR, CALENDAR_BOX, TARGET_BOX],
      [ACCOUNT, ACCOUNT_BOX, TARGET_BOX],
      [NAMELESS, NAMELESS_BOX, TARGET_BOX],
    ]) {
      await q(
        `INSERT INTO mailbox_mapping
           (id, tenant_id, source_mailbox_id, target_mailbox_id, target_config_override, status)
         VALUES ($1,$2,$3,$4,'{"user":"dest@example.org"}'::jsonb,'paused')`,
        [m, TENANT, box, target],
      );
    }
    // What the account migration copies: two types, and a third switched off,
    // which the link must not ask for.
    for (const [domain, included] of [
      ['calendar', true],
      ['task', true],
      ['contact', false],
    ] as const) {
      await q(
        `INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1,$2,$3,$4)`,
        [TENANT, ACCOUNT, domain, included],
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
    body: { refresh_token: REFRESH, scope: GOOGLE_SOURCE_SCOPES.gmail, id_token: idTokenFor(NAMED) },
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
    // The scope AS a scope (ADR-0041), not a paraphrase of one: the data's,
    // and the two that say who signed in, exactly as Google will record them.
    expect(res.body.scope).toBe(`${GOOGLE_SOURCE_SCOPES.gmail} ${WHO}`);
    expect(Date.parse(res.body.expiresAt)).toBeGreaterThan(Date.now());
  });

  it('tells the link holder NOTHING else about the organisation', async () => {
    const { token } = await mintLink(MAPPING);
    const res = await request(app).get(`/api/grant/${token}`);
    const body = JSON.stringify(res.body);
    for (const leak of [TENANT, MAPPING, CONN, BOX, CLIENT_ID, CLIENT_SECRET, 'rob']) {
      expect(body, `${leak} must not reach a link holder`).not.toContain(leak);
    }
    expect(Object.keys(res.body).sort()).toEqual([
      'askedBy',
      'checkedCompany',
      'expiresAt',
      'from',
      'organisation',
      'organisationPhone',
      'reads',
      'scope',
      'to',
    ]);
  });

  it('gives the company name the EU VAT register gave, when it said valid', async () => {
    const { token } = await mintLink(MAPPING);
    const res = await request(app).get(`/api/grant/${token}`);
    expect(res.body.checkedCompany).toBe('ACME LEGAL B.V.');
  });

  it('gives no company name once the number has changed since it was checked', async () => {
    // What was checked was the old number; nothing has checked this one.
    const setVat = async (vat: string) => {
      const conn = await driver.acquire();
      try {
        await conn.query(`UPDATE billing_party SET vat_number = $2 WHERE tenant_id = $1`, [TENANT, vat]);
      } finally {
        await conn.release();
      }
    };
    await setVat('NL999999999B01');
    try {
      const { token } = await mintLink(MAPPING);
      const res = await request(app).get(`/api/grant/${token}`);
      expect(res.body.checkedCompany).toBeNull();
    } finally {
      await setVat('NL123456789B01');
    }
  });

  it('gives no company name when the latest check said invalid, whatever an older one said', async () => {
    const run = async (sql: string) => {
      const conn = await driver.acquire();
      try {
        await conn.query(sql, [TENANT]);
      } finally {
        await conn.release();
      }
    };
    await run(
      `INSERT INTO vat_consultation (tenant_id, country_code, vat_number, valid, trader_name, checked_at)
       VALUES ($1,'NL','123456789B01',false,'ACME LEGAL B.V.', now() + interval '1 minute')`,
    );
    try {
      const { token } = await mintLink(MAPPING);
      const res = await request(app).get(`/api/grant/${token}`);
      expect(res.body.checkedCompany).toBeNull();
    } finally {
      await run(`DELETE FROM vat_consultation WHERE tenant_id = $1 AND valid = false`);
    }
  });

  it("gives the organisation's phone number, when it gave one", async () => {
    const { token } = await mintLink(MAPPING);
    const res = await request(app).get(`/api/grant/${token}`);
    expect(res.body.organisationPhone).toBe('+31 20 123 4567');
  });

  it('gives no number when what is stored is not one, whoever stored it', async () => {
    // `tenant.settings` has other writers; the consent page must not become a
    // place any of them can put a sentence. Each write takes the connection
    // and gives it back before the route runs: PGlite has one, and a test
    // that held it across a request would wait on itself for ever.
    const storePhone = async (contactPhone: string) => {
      const conn = await driver.acquire();
      try {
        await conn.query(`UPDATE tenant SET settings = $2::jsonb WHERE id = $1`, [
          TENANT,
          JSON.stringify({ contactPhone }),
        ]);
      } finally {
        await conn.release();
      }
    };
    await storePhone('Call IT, they know about this');
    try {
      const { token } = await mintLink(MAPPING);
      const res = await request(app).get(`/api/grant/${token}`);
      expect(res.status).toBe(200);
      expect(res.body.organisationPhone).toBeNull();
    } finally {
      await storePhone('+31 20 123 4567');
    }
  });

  it('says who asked: the issuing member, by the address they sign in with', async () => {
    // The owner, 2026-09-23: "It has to be clear who is facilitating a
    // migration of someone else." An organisation's name is anyone's to choose.
    const { token } = await mintLink(MAPPING);
    const res = await request(app).get(`/api/grant/${token}`);
    expect(res.body.askedBy).toBe('owner@example.org');
    // The member's address, never their account id.
    expect(JSON.stringify(res.body)).not.toContain('"rob"');
  });

  it('says nothing about who asked when the issuer is no longer a member, rather than guessing', async () => {
    const { token } = await withTenant(driver, TENANT, (db) =>
      issueMappingLink(db, {
        tenantId: TENANT,
        mappingId: MAPPING,
        purpose: 'grant',
        createdBy: 'somebody-who-left',
        expiresAt: expiryFromDays(7),
      }),
    );
    const res = await request(app).get(`/api/grant/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.askedBy).toBeNull();
  });

  it('says from which account and to which destination (0108 T8a)', async () => {
    const { token } = await mintLink(MAPPING);
    const res = await request(app).get(`/api/grant/${token}`);
    // The account the migration reads, and the server and account it writes:
    // the two facts a person needs to tell their own migration from a stranger's.
    expect(res.body.from).toBe('someone@example.invalid');
    expect(res.body.to).toEqual({
      provider: 'nextcloud',
      host: 'cloud.example.org',
      account: 'dest@example.org',
    });
  });

  it('gives no page for a migration that names no account, in forwardable words (0108 T8 (b))', async () => {
    const { token } = await mintLink(NAMELESS);
    const get = await request(app).get(`/api/grant/${token}`);
    expect(get.status).toBe(409);
    expect(get.body.reason).toMatch(/it does not name the Google account it reads/);
    expect(get.body.reason).toMatch(/tell the person who sent you the link/);
    // Nor a consent: no sign-in could ever be accepted for it.
    const post = await request(app).post(`/api/grant/${token}/google/authorize`).send({});
    expect(post.status).toBe(409);
  });

  it('refuses a migration whose destination is gone, in forwardable words', async () => {
    const { token } = await mintLink(NO_TARGET);
    const get = await request(app).get(`/api/grant/${token}`);
    expect(get.status).toBe(409);
    expect(get.body.reason).toMatch(/it has no destination to copy to/);
    expect(get.body.reason).toMatch(/tell the person who sent you the link/);
    // And the button cannot start a consent the page would not describe.
    const post = await request(app).post(`/api/grant/${token}/google/authorize`).send({});
    expect(post.status).toBe(409);
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
    expect(url.searchParams.get('scope')).toBe(`${GOOGLE_SOURCE_SCOPES.gmail} ${WHO}`);
    // The two that must never be forgotten, or the grant yields no refresh token.
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    // The whole point of reading the client server-side.
    expect(res.text).not.toContain(CLIENT_SECRET);
  });

  it('offers Google the named account first (0108 T8 (b))', async () => {
    const { token } = await mintLink(MAPPING);
    const res = await request(app).post(`/api/grant/${token}/google/authorize`).send({});
    expect(new URL(res.body.url).searchParams.get('login_hint')).toBe(NAMED);
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

describe("the deployment's client, where the source stores none (0108 T6)", () => {
  it('asks for a calendar through it, and exchanges the code with its secret', async () => {
    await onTheDeploymentsClient(async () => {
      const { token } = await mintLink(CALENDAR);
      const page = await request(app).get(`/api/grant/${token}`);
      expect(page.status).toBe(200);
      expect(page.body.reads).toBe('your calendars and their events');
      expect(page.body.scope).toBe(`${GOOGLE_SOURCE_SCOPES['google-calendar']} ${WHO}`);

      const started = await request(app).post(`/api/grant/${token}/google/authorize`).send({});
      expect(started.status).toBe(200);
      const url = new URL(started.body.url);
      expect(url.searchParams.get('client_id')).toBe(DEPLOYMENT_CLIENT_ID);
      expect(started.text).not.toContain(DEPLOYMENT_CLIENT_SECRET);

      tokenResponse = () => ({
        status: 200,
        body: {
          refresh_token: REFRESH,
          scope: GOOGLE_SOURCE_SCOPES['google-calendar'],
          // Issued to the application that asked: the deployment's.
          id_token: idTokenFor('calendar@example.invalid', DEPLOYMENT_CLIENT_ID),
        },
      });
      const state = url.searchParams.get('state')!;
      const ended = await request(app)
        .get('/api/migrations/google/callback')
        .query({ state, code: 'auth-code' });
      expect(ended.status).toBe(200);
      expect(tokenRequests[0]!.get('client_id')).toBe(DEPLOYMENT_CLIENT_ID);
      expect(tokenRequests[0]!.get('client_secret')).toBe(DEPLOYMENT_CLIENT_SECRET);
      expect(ended.text).not.toContain(DEPLOYMENT_CLIENT_SECRET);
    });
  });

  it('will not ask for Gmail through it on a deployment that has not declared the class', async () => {
    await onTheDeploymentsClient(async () => {
      const { token } = await mintLink(UNCONFIGURED);
      const res = await request(app).get(`/api/grant/${token}`);
      expect(res.status).toBe(409);
      expect(res.body.reason).toMatch(/may not ask for mail or files/);
    });
  });

  it("keeps the source's own client where it stores one", async () => {
    await onTheDeploymentsClient(async () => {
      const { token } = await mintLink(MAPPING);
      const started = await request(app).post(`/api/grant/${token}/google/authorize`).send({});
      expect(new URL(started.body.url).searchParams.get('client_id')).toBe(CLIENT_ID);
    });
  });
});

describe('a link for a Google ACCOUNT (0108 T7)', () => {
  it('asks for the types the migration copies, and nothing it switched off', async () => {
    await onTheDeploymentsClient(async () => {
      const { token } = await mintLink(ACCOUNT);
      const page = await request(app).get(`/api/grant/${token}`);
      expect(page.status).toBe(200);
      const owners = googleAccountConsent(['calendar', 'task'], {});
      if (isRefusal(owners)) throw new Error(owners.reason);
      expect(page.body.scope).toBe(`${owners.scope} ${WHO}`);
      expect(page.body.reads).toBe('your calendars and their events and your tasks');
      // Its own account, from the connection's config: an OAuth row stores no
      // username in its secret.
      expect(page.body.from).toBe('account@example.invalid');

      const started = await request(app).post(`/api/grant/${token}/google/authorize`).send({});
      expect(new URL(started.body.url).searchParams.get('scope')).toBe(`${owners.scope} ${WHO}`);
    });
  });

  it('is not ready on a deployment with no client of its own, when the account has none', async () => {
    const { token } = await mintLink(ACCOUNT);
    const res = await request(app).get(`/api/grant/${token}`);
    expect(res.status).toBe(409);
    expect(res.body.reason).toMatch(/its Google application is not set up yet/);
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

/**
 * THE ACCOUNT IS A CONDITION, NOT A LABEL (workplan 0108 T8 (b)).
 *
 * The owner, 2026-09-23: *"bind to the account the page already named"*. The
 * whole flow again, with Google's ID token naming who signed in, and the
 * tables read after every ending: for any account but the named one nothing is
 * stored, and the link is left as it was, so the right account can still use
 * it.
 */
describe('the account that signs in must be the one the page named (0108 T8 (b))', () => {
  async function begin(token: string): Promise<string> {
    const started = await request(app).post(`/api/grant/${token}/google/authorize`).send({});
    return new URL(started.body.url).searchParams.get('state')!;
  }
  const end = (state: string) =>
    request(app).get('/api/migrations/google/callback').query({ state, code: 'auth-code' });
  const linkState = async (id: string) =>
    (
      await withTenant(driver, TENANT, (db) =>
        listMappingLinks(db, { tenantId: TENANT, mappingId: MAPPING }),
      )
    ).find((l) => l.id === id)?.state;
  /** Google's answer, for this account signing in (null: no ID token at all). */
  const signedInAs = (email: string | null, aud: string = CLIENT_ID) => {
    tokenResponse = () => ({
      status: 200,
      body: {
        refresh_token: REFRESH,
        scope: GOOGLE_SOURCE_SCOPES.gmail,
        ...(email ? { id_token: idTokenFor(email, aud) } : {}),
      },
    });
  };
  /** Re-point the migration at another account, or back (null), as its owner could. */
  const setSourceAccount = async (mappingId: string, user: string | null) => {
    const conn = await driver.acquire();
    try {
      await conn.query('UPDATE mailbox_mapping SET source_config_override = $2::jsonb WHERE id = $1', [
        mappingId,
        user === null ? null : JSON.stringify({ user }),
      ]);
    } finally {
      await conn.release();
    }
  };

  it('stores nothing for ANOTHER account, says which, and leaves the link working', async () => {
    const { token, id } = await mintLink(MAPPING);
    signedInAs('personal@gmail.com');
    const res = await end(await begin(token));

    expect(res.status).toBe(403);
    expect(res.text).toContain('You signed in to Google as personal@gmail.com');
    expect(res.text).toContain(`this migration reads ${NAMED}`);
    expect(res.text).toMatch(/your link still works/);
    expect(res.text).not.toMatch(/fresh one/);
    expect(res.text).not.toContain(REFRESH);
    expect((await mappingRow(MAPPING))?.source_secret_ref).toBeNull();
    expect(await linkState(id)).toBe('live');

    // And it does: the same link, with the account it names.
    signedInAs(NAMED);
    const again = await end(await begin(token));
    expect(again.status).toBe(200);
    expect((await mappingRow(MAPPING))?.source_secret_ref).toBeTruthy();
    expect(await linkState(id)).toBe('used');
  });

  it('accepts the named account however Google cases its address', async () => {
    const { token } = await mintLink(MAPPING);
    signedInAs(NAMED.toUpperCase());
    const res = await end(await begin(token));
    expect(res.status).toBe(200);
    expect((await mappingRow(MAPPING))?.source_secret_ref).toBeTruthy();
  });

  it('stores nothing when Google does not say who signed in', async () => {
    const { token, id } = await mintLink(MAPPING);
    signedInAs(null);
    const res = await end(await begin(token));
    expect(res.status).toBe(403);
    expect(res.text).toMatch(/Google did not confirm which account you signed in with/);
    expect((await mappingRow(MAPPING))?.source_secret_ref).toBeNull();
    expect(await linkState(id)).toBe('live');
  });

  it('stores nothing when the ID token was issued to another application', async () => {
    const { token, id } = await mintLink(MAPPING);
    signedInAs(NAMED, 'another.apps.googleusercontent.com');
    const res = await end(await begin(token));
    expect(res.status).toBe(403);
    expect((await mappingRow(MAPPING))?.source_secret_ref).toBeNull();
    expect(await linkState(id)).toBe('live');
  });

  it('holds the grant to the account named when it is WRITTEN, not when the consent began', async () => {
    // The owner re-points the migration while the consent is at Google. The
    // account compared is read in the transaction that would store the token.
    const { token, id } = await mintLink(MAPPING);
    const state = await begin(token);
    await setSourceAccount(MAPPING, 'someone-else@example.invalid');
    try {
      signedInAs(NAMED);
      const res = await end(state);
      expect(res.status).toBe(403);
      expect(res.text).toContain('this migration reads someone-else@example.invalid');
      expect((await mappingRow(MAPPING))?.source_secret_ref).toBeNull();
      expect(await linkState(id)).toBe('live');
    } finally {
      await setSourceAccount(MAPPING, null);
    }
  });

  it('says a dead link is dead first, whoever signed in', async () => {
    // Revoked mid-flight AND the wrong account: "your link still works" would
    // be false, so the link's own answer comes first.
    const { token, id } = await mintLink(MAPPING);
    const state = await begin(token);
    await withTenant(driver, TENANT, (db) => revokeMappingLink(db, { tenantId: TENANT, linkId: id }));
    signedInAs('personal@gmail.com');
    const res = await end(state);
    expect(res.status).toBe(409);
    expect(res.text).toMatch(/can no longer be used/);
    expect(res.text).not.toMatch(/your link still works/);
    expect((await mappingRow(MAPPING))?.source_secret_ref).toBeNull();
  });
});

/**
 * ADR-0035's SECOND lifetime, handed over at the end of the first
 * (workplan 0122 T7).
 *
 * The whole flow again, so the claims are about what the real ending really
 * does: a `view` row that really exists in `mapping_link`, on a link the
 * person really receives, minted with a lifetime the owner never chose.
 *
 * The load-bearing negative is the last one. Minting runs AFTER the credential
 * transaction commits, so a mint that fails must leave the grant standing —
 * the consent cost somebody ten minutes and a decision, the page is a
 * convenience the owner can hand over later.
 */
describe('the progress link handed over at the ending', () => {
  async function grantThrough(token: string) {
    const started = await request(app).post(`/api/grant/${token}/google/authorize`).send({});
    const state = new URL(started.body.url).searchParams.get('state')!;
    return request(app).get('/api/migrations/google/callback').query({ state, code: 'auth-code' });
  }

  /** Every `view` link on a mapping, straight from the table. */
  async function viewLinks(mappingId: string) {
    const all = await withTenant(driver, TENANT, (db) =>
      listMappingLinks(db, { tenantId: TENANT, mappingId }),
    );
    return all.filter((l) => l.purpose === 'view');
  }

  it('mints one, shows it once, and says to keep THIS one', async () => {
    const before = (await viewLinks(MAPPING)).length;
    const { token } = await mintLink(MAPPING);
    const res = await grantThrough(token);

    expect(res.status).toBe(200);
    // The address, in the page, as a real link somebody can click.
    const found = /https:\/\/app\.example\/view\/[0-9a-f-]{36}\.[\w-]+/.exec(res.text);
    expect(found).not.toBeNull();
    expect(res.text).toContain(`href="${found![0]}"`);
    // Both halves of the contrast: the credential link is spent, this one is
    // theirs. Without the second sentence "here is a link" reads as the same
    // link still working.
    expect(res.text).toMatch(/keep this one/i);
    expect(res.text).toMatch(/will not work again/i);

    const after = await viewLinks(MAPPING);
    expect(after).toHaveLength(before + 1);
    expect(after[0]!.state).toBe('live');
    // Not a user id — nobody was signed in — and the owner's panel shows this
    // beside links they issued themselves, so it has to say so.
    expect(after[0]!.createdBy).toBe('granted-by-link');
  });

  it('gives it ninety days: the dialog’s own default, not a second number', async () => {
    const { token } = await mintLink(MAPPING);
    await grantThrough(token);
    const live = (await viewLinks(MAPPING)).find((l) => l.state === 'live')!;
    const days = (live.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThan(91);
  });

  it('still shows nothing that could be the refresh token', async () => {
    // The property 0108 T4 built the signature for, re-asserted now that the
    // signature HAS a string parameter. `ProgressPageUrl` is branded so the
    // token cannot compile into it; this is the runtime half of the same claim.
    const { token } = await mintLink(MAPPING);
    const res = await grantThrough(token);
    expect(res.text).not.toContain(REFRESH);
    expect(res.text).not.toContain('postMessage');
  });

  it('mints nothing, and says nothing, when the deployment has no WEB_URL', async () => {
    const had = process.env.WEB_URL;
    delete process.env.WEB_URL;
    try {
      const before = (await viewLinks(MAPPING)).length;
      const { token } = await mintLink(MAPPING);
      const res = await grantThrough(token);

      // The grant still landed — this is a page, not a credential.
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/that is done/i);
      // And the page reads exactly as it did before 0122: no half-built link,
      // no promise of one. 0095 T3's lesson is that a link built without a
      // base address goes out looking exactly like a working one.
      expect(res.text).not.toMatch(/keep this one/i);
      expect(res.text).not.toMatch(/\/view\//);
      expect(await viewLinks(MAPPING)).toHaveLength(before);
    } finally {
      process.env.WEB_URL = had;
    }
  });

  it('a mint that FAILS leaves the grant standing', async () => {
    // The reason this is not inside `storeGrantedToken`'s transaction. A
    // mapping id that is not this tenant's violates the foreign key, so the
    // insert really throws — and `mintProgressLink` answers null rather than
    // letting it reach the caller.
    const { mintProgressLink } = await import('../routes/migrations/grant-ending.ts');
    const url = await mintProgressLink(driver, {
      linkId: MAPPING,
      mappingId: '5f500000-e29b-41d4-a716-4466554417ff',
      tenantId: TENANT,
    });
    expect(url).toBeNull();

    // And the ordinary path still works afterwards — the failure left no
    // half-open transaction behind.
    const { token } = await mintLink(MAPPING);
    const res = await grantThrough(token);
    expect(res.status).toBe(200);
    expect((await mappingRow(MAPPING))?.source_secret_ref).toBeTruthy();
  });
});
