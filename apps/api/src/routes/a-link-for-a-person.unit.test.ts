// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONE LINK PER PERSON, ISSUED, OPENED AND GRANTED (ADR-0035, amended
 * 2026-09-29; workplan 0153 T5 (b), slice 2).
 *
 * Anna has four migrations: their Google account's calendar to one destination
 * and its contacts to another, their work Gmail through that connection's own
 * Google client, and an old IMAP mailbox. One link:
 *
 *  - is issued for them, and refused for a person with nothing a link can
 *    serve, with each migration's own reason;
 *  - opens a page per Google account, naming where each migration goes, with
 *    no migration id and nothing of the IMAP mailbox;
 *  - asks each account once, for every scope its migrations need, through the
 *    client they share, and the account Google offers first is that account;
 *  - lands one token on every migration the page listed for the account, and
 *    nothing on the others, with an audit row each;
 *  - stays live until every account is granted, and is spent then;
 *  - stores nothing for the wrong account, a revoked link, or a migration that
 *    left them since the page was opened.
 *
 * PGlite as `app_user`, both chains. Google's token endpoint is the one thing
 * stubbed, as in `grant.unit.test.ts`. The names are invented.
 */

process.env.SECRET_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { LEGAL_VERSIONS, recordAcceptance, runManagedMigrations } from '@openmig/managed';
import { withTenant } from '@openmig/ledger';
import { SecretStore } from '@openmig/core/secret-store';
import { join } from 'node:path';
import { specChecker } from '../__tests__/doors-that-start-work.ts';

// UUID family 0153c5d0-…, unused elsewhere in the repo.
const U = (n: string) => `0153c5d0-e29b-41d4-a716-4466554430${n}`;
const TENANT = U('01');
const OTHER_TENANT = U('02');
const ACCOUNT_CONN = U('11');
const WORK_CONN = U('12');
const IMAP_CONN = U('13');
const TARGET_CONN = U('14');
const ACCOUNT_BOX = U('21');
const WORK_BOX = U('22');
const IMAP_BOX = U('23');
const T1_BOX = U('24');
const T2_BOX = U('25');
/** Anna's four. */
const CAL = U('31');
const CONTACTS = U('32');
const WORK_MAIL = U('33');
const OLD_MAIL = U('34');
/** Bram's one, which no link can serve. */
const BRAM_MAIL = U('35');
const ANNA = U('41');
const BRAM = U('42');
const CARL = U('43');
const THEIR_PERSON = U('44');

const DEPLOYMENT_CLIENT_ID = 'deployment.apps.googleusercontent.com';
const WORK_CLIENT_ID = 'work.apps.googleusercontent.com';
const REFRESH = '1//a-granted-refresh-token';

const CHECKER = specChecker(join(import.meta.dirname, '..', '..', 'docs', 'openapi.yaml'));
/** Whether a body is what the spec documents for this door and status. */
function documented(spec: string, method: 'get' | 'post', status: string, body: unknown): boolean {
  const { schema } = CHECKER.responseSchema({ name: spec, path: spec, spec, method, accepted: 200 } as never, status);
  return CHECKER.satisfies(schema, body);
}

let driver: LedgerDriver;
let caller: { tenantId?: string; userId?: string; userRole?: string } = {};

// Every text final, so a deployment that runs the Alpha asks (0139 T3), as
// `link-routes.unit.test.ts` sets it: which texts really are drafts is
// `scripts/a-version-the-tester-accepted`'s.
vi.mock('@openmig/managed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/managed')>();
  return { ...actual, LEGAL_DRAFTS: { alpha: false, privacy: false, terms: false } };
});

vi.mock('./../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
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

const { default: peopleRoutes } = await import('./people.ts');
const { default: grantRoutes } = await import('./grant.ts');
const { default: googleOauthRoutes } = await import('./migrations/google-oauth-routes.ts');
const { googleAccountConsent, isRefusal } = await import('./migrations/google-account-consent.ts');
const { SIGNED_IN_ACCOUNT_SCOPES } = await import('./migrations/signed-in-account.ts');

const app = express();
app.use(express.json());
app.use('/api/people', peopleRoutes);
app.use('/api/grant', grantRoutes);
app.use('/api/migrations', googleOauthRoutes);

/** An ID token as Google's token endpoint answers it. */
function idTokenFor(email: string, aud: string): string {
  const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const claims = { iss: 'https://accounts.google.com', aud, sub: '1', email, email_verified: true };
  return `${part({ alg: 'RS256' })}.${part(claims)}.sig`;
}

/** Who Google says signed in, per test; the scope granted is whatever was asked. */
let signsInAs = 'anna@gmail.com';
let askedScope = '';
let askedClient = DEPLOYMENT_CLIENT_ID;

async function q(sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(sql, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

const tokenOf = async (mappingId: string): Promise<string | null> => {
  const [row] = await q('SELECT source_secret_ref FROM mailbox_mapping WHERE id = $1', [mappingId]);
  const ref = row?.source_secret_ref as string | null;
  return ref ? String(SecretStore.decryptCredentials(ref).refreshToken) : null;
};

const issue = (personId: string, body: Record<string, unknown> = {}) =>
  request(app).post(`/api/people/${personId}/links`).send(body);

/** The token's path segment from an issued URL. */
const tokenIn = (url: string) => url.slice(url.lastIndexOf('/grant/') + '/grant/'.length);

/** Press the account's button, and come back from Google as `signsInAs`. */
async function grant(token: string, account: string) {
  const started = await request(app).post(`/api/grant/${token}/google/authorize`).send({ account });
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  const url = new URL(started.body.url);
  askedScope = url.searchParams.get('scope')!;
  askedClient = url.searchParams.get('client_id')!;
  const state = url.searchParams.get('state')!;
  return { url, callback: () => request(app).get('/api/migrations/google/callback').query({ state, code: 'c' }) };
}

beforeAll(async () => {
  process.env.API_URL = 'https://api.example';
  process.env.WEB_URL = 'https://app.example';
  process.env.GOOGLE_OAUTH_CLIENT_ID = DEPLOYMENT_CLIENT_ID;
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'not-a-real-deployment-secret';
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });

  vi.stubGlobal('fetch', async () =>
    new Response(
      JSON.stringify({ refresh_token: REFRESH, scope: askedScope, id_token: idTokenFor(signsInAs, askedClient) }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  );

  const workCreds = JSON.stringify(
    SecretStore.encryptCredentials({
      username: 'anna@work.example',
      clientId: WORK_CLIENT_ID,
      clientSecret: 'not-a-real-work-secret',
    }).encrypted,
  );
  await q('INSERT INTO tenant (id, name) VALUES ($1, $2), ($3, $4)', [TENANT, 'Acme Legal', OTHER_TENANT, 'Other BV']);
  await q(`INSERT INTO tenant_member (tenant_id, user_id, email) VALUES ($1, 'pat', 'owner@example.org')`, [TENANT]);
  await q(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status) VALUES
       ($1,$4,'source','google','anna','{"user":"anna@gmail.com"}'::jsonb,'connected'),
       ($2,$4,'source','imap','old','{"user":"anna@old.example","host":"imap.old.example"}'::jsonb,'connected'),
       ($3,$4,'target','nextcloud','nc','{"host":"cloud.example.org","port":443}'::jsonb,'connected')`,
    [ACCOUNT_CONN, IMAP_CONN, TARGET_CONN, TENANT],
  );
  await q(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
     VALUES ($1,$2,'source','gmail','work','{}'::jsonb,'connected',$3)`,
    [WORK_CONN, TENANT, workCreds],
  );
  for (const [box, conn] of [
    [ACCOUNT_BOX, ACCOUNT_CONN],
    [WORK_BOX, WORK_CONN],
    [IMAP_BOX, IMAP_CONN],
    [T1_BOX, TARGET_CONN],
    [T2_BOX, TARGET_CONN],
  ]) {
    await q(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES ($1,$2,$3,'user','m@example.invalid')`,
      [box, TENANT, conn],
    );
  }
  for (const [m, box, target] of [
    [CAL, ACCOUNT_BOX, T1_BOX],
    [CONTACTS, ACCOUNT_BOX, T2_BOX],
    [WORK_MAIL, WORK_BOX, T1_BOX],
    [OLD_MAIL, IMAP_BOX, T1_BOX],
    [BRAM_MAIL, IMAP_BOX, T2_BOX],
  ]) {
    await q(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, target_config_override, status)
       VALUES ($1,$2,$3,$4,'{"user":"anna@cloud.example.org"}'::jsonb,'paused')`,
      [m, TENANT, box, target],
    );
  }
  await q(
    `INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1,$2,'calendar',true), ($1,$3,'contact',true)`,
    [TENANT, CAL, CONTACTS],
  );
  await q(
    `INSERT INTO person (id, tenant_id, display_name) VALUES ($1,$4,'Anna'), ($2,$4,'Bram'), ($3,$4,'Carl'), ($5,$6,'Dora')`,
    [ANNA, BRAM, CARL, TENANT, THEIR_PERSON, OTHER_TENANT],
  );
  for (const [m, p] of [
    [CAL, ANNA],
    [CONTACTS, ANNA],
    [WORK_MAIL, ANNA],
    [OLD_MAIL, ANNA],
    [BRAM_MAIL, BRAM],
  ]) {
    await q('INSERT INTO person_migration (mapping_id, person_id, tenant_id) VALUES ($1,$2,$3)', [m, p, TENANT]);
  }
}, 60_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  await driver.end?.();
});

beforeEach(async () => {
  caller = { tenantId: TENANT, userId: 'pat', userRole: 'owner' };
  signsInAs = 'anna@gmail.com';
  await q('DELETE FROM person_link');
  await q('UPDATE mailbox_mapping SET source_secret_ref = NULL, grant_withdrawn_at = NULL');
  await q('DELETE FROM audit_log');
  await q(
    `INSERT INTO person_migration (mapping_id, person_id, tenant_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [CONTACTS, ANNA, TENANT],
  );
});

describe('issuing a person’s grant link', () => {
  it('issues one for Anna, and says its URL once', async () => {
    const res = await issue(ANNA);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.purpose).toBe('grant');
    expect(res.body.url).toMatch(/^https:\/\/app\.example\/grant\/p\.[0-9a-f-]{36}\./);
    const rows = await q('SELECT person_id, purpose, created_by FROM person_link');
    expect(rows).toEqual([{ person_id: ANNA, purpose: 'grant', created_by: 'pat' }]);

    expect(documented('/api/people/{personId}/links', 'post', '201', res.body), JSON.stringify(res.body)).toBe(true);

    const listed = await request(app).get(`/api/people/${ANNA}/links`);
    expect(documented('/api/people/{personId}/links', 'get', '200', listed.body)).toBe(true);
    expect(listed.body.links).toHaveLength(1);
    expect(listed.body.links[0].state).toBe('live');
    expect(JSON.stringify(listed.body)).not.toContain(tokenIn(res.body.url).split('.')[2]);
  });

  it('refuses a person with nothing a link can serve, with each migration’s own reason', async () => {
    const bram = await issue(BRAM);
    expect(bram.status).toBe(409);
    expect(bram.body.error).toBe('nothing_to_grant');
    expect(bram.body.reason).toMatch(/^None of Bram's migrations can be granted through a link\. /);
    expect(bram.body.reason).toMatch(/Google/);
    expect(documented('/api/people/{personId}/links', 'post', '409', bram.body)).toBe(true);

    const carl = await issue(CARL);
    expect(carl.status).toBe(409);
    expect(carl.body.reason).toBe('Carl has no migrations yet. Add one before making a link.');
    expect(await q('SELECT id FROM person_link')).toEqual([]);
  });

  it('offers no progress link yet, and no expiry it does not offer', async () => {
    expect((await issue(ANNA, { purpose: 'view' })).status).toBe(400);
    expect((await issue(ANNA, { expiryDays: 90 })).status).toBe(400);
    expect((await issue(ANNA, { expiryDays: 30 })).status).toBe(201);
  });

  it('is an owner’s or an admin’s to issue and revoke, and never for another organisation’s person', async () => {
    caller = { tenantId: TENANT, userId: 'vic', userRole: 'viewer' };
    expect((await issue(ANNA)).status).toBe(403);
    caller = { tenantId: TENANT, userId: 'pat', userRole: 'owner' };
    expect((await issue(THEIR_PERSON)).status).toBe(404);

    const issued = await issue(ANNA);
    const revoke = (id: string) => request(app).delete(`/api/people/${ANNA}/links/${id}`);
    expect((await revoke(issued.body.id)).body).toEqual({ revoked: true });
    expect((await revoke(issued.body.id)).body).toEqual({ revoked: false });
    expect((await revoke(U('99'))).status).toBe(404);
    expect((await request(app).get(`/api/grant/${tokenIn(issued.body.url)}`)).status).toBe(401);
  });
});

describe('the page a person’s link opens', () => {
  it('names each Google account and where its migrations go, with no migration id and nothing of the IMAP mailbox', async () => {
    const token = tokenIn((await issue(ANNA)).body.url);
    const res = await request(app).get(`/api/grant/${token}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ kind: 'person', organisation: 'Acme Legal', askedBy: 'owner@example.org' });
    expect(documented('/api/grant/{link}', 'get', '200', res.body), JSON.stringify(res.body)).toBe(true);

    const accounts = res.body.accounts as Array<Record<string, unknown>>;
    expect(accounts.map((a) => a.account)).toEqual(['anna@gmail.com', 'anna@work.example']);
    expect(accounts[0]).toMatchObject({ granted: false, domains: ['calendar', 'contact'], notReady: null });
    expect(accounts[0]!.migrations).toEqual([
      { domains: ['calendar'], to: { provider: 'nextcloud', host: 'cloud.example.org', account: 'anna@cloud.example.org' }, granted: false },
      { domains: ['contact'], to: { provider: 'nextcloud', host: 'cloud.example.org', account: 'anna@cloud.example.org' }, granted: false },
    ]);
    expect(accounts[1]).toMatchObject({ granted: false, domains: ['email'] });

    const said = JSON.stringify(res.body);
    for (const id of [CAL, CONTACTS, WORK_MAIL, OLD_MAIL, ANNA, TENANT]) expect(said).not.toContain(id);
    expect(said).not.toContain('imap.old.example');
  });

  it('asks each account once, for every scope its migrations need, and offers that account first', async () => {
    const token = tokenIn((await issue(ANNA)).body.url);
    const { url } = await grant(token, 'anna@gmail.com');
    expect(url.searchParams.get('client_id')).toBe(DEPLOYMENT_CLIENT_ID);
    expect(url.searchParams.get('login_hint')).toBe('anna@gmail.com');
    // Exactly what one migration copying both types would ask for: the
    // account kind's own table, read through the product's own function.
    const both = googleAccountConsent(['calendar', 'contact'], {});
    if (isRefusal(both)) throw new Error(both.reason);
    expect(url.searchParams.get('scope')!.split(' ').sort()).toEqual(
      [...both.scope.split(' '), ...SIGNED_IN_ACCOUNT_SCOPES].sort(),
    );

    const work = await grant(token, 'anna@work.example');
    expect(work.url.searchParams.get('client_id')).toBe(WORK_CLIENT_ID);
    expect(work.url.toString()).not.toContain('not-a-real-work-secret');
  });

  it('refuses an account the link does not ask for', async () => {
    const token = tokenIn((await issue(ANNA)).body.url);
    const res = await request(app).post(`/api/grant/${token}/google/authorize`).send({ account: 'anna@old.example' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_this_account');
  });
});

describe('the grant lands on what the page listed', () => {
  it('stores one token on both of the account’s migrations and nothing on the others, and the link stays live', async () => {
    const token = tokenIn((await issue(ANNA)).body.url);
    const { callback } = await grant(token, 'anna@gmail.com');
    const ended = await callback();
    expect(ended.status, ended.text).toBe(200);
    expect(ended.text).not.toContain(REFRESH);

    expect(await tokenOf(CAL)).toBe(REFRESH);
    expect(await tokenOf(CONTACTS)).toBe(REFRESH);
    expect(await tokenOf(WORK_MAIL)).toBeNull();
    expect(await tokenOf(OLD_MAIL)).toBeNull();

    const audit = await q(`SELECT detail FROM audit_log WHERE action = 'mapping.granted' ORDER BY at`);
    expect(audit.map((r) => (r.detail as { mappingId: string }).mappingId).sort()).toEqual([CAL, CONTACTS].sort());
    expect(audit.every((r) => (r.detail as { personLinkId?: string }).personLinkId)).toBe(true);

    const page = await request(app).get(`/api/grant/${token}`);
    expect(page.status).toBe(200);
    expect(page.body.accounts.map((a: { granted: boolean }) => a.granted)).toEqual([true, false]);
    const again = await request(app).post(`/api/grant/${token}/google/authorize`).send({ account: 'anna@gmail.com' });
    expect(again.body.error).toBe('already_granted');
  });

  it('is spent once every account on it is granted', async () => {
    const token = tokenIn((await issue(ANNA)).body.url);
    await (await grant(token, 'anna@gmail.com')).callback();
    signsInAs = 'anna@work.example';
    const ended = await (await grant(token, 'anna@work.example')).callback();
    expect(ended.status, ended.text).toBe(200);
    expect(await tokenOf(WORK_MAIL)).toBe(REFRESH);

    const [row] = await q('SELECT used_at FROM person_link');
    expect(row?.used_at).toBeTruthy();
    expect((await request(app).get(`/api/grant/${token}`)).status).toBe(401);
  });

  it('stores nothing for another account, records the refusal, and the link still works', async () => {
    const token = tokenIn((await issue(ANNA)).body.url);
    const { callback } = await grant(token, 'anna@gmail.com');
    signsInAs = 'someone.else@gmail.com';
    const ended = await callback();
    expect(ended.status).toBe(403);
    expect(await tokenOf(CAL)).toBeNull();
    expect(await tokenOf(CONTACTS)).toBeNull();
    const refused = await q(`SELECT detail FROM audit_log WHERE action = 'mapping.grant_refused'`);
    expect(refused).toHaveLength(2);
    expect(JSON.stringify(refused)).not.toContain('someone.else');
    expect((await request(app).get(`/api/grant/${token}`)).status).toBe(200);
  });

  it('stores nothing when the owner revoked the link while the consent was at Google', async () => {
    const issued = await issue(ANNA);
    const { callback } = await grant(tokenIn(issued.body.url), 'anna@gmail.com');
    await request(app).delete(`/api/people/${ANNA}/links/${issued.body.id}`);
    const ended = await callback();
    expect(ended.status).toBe(409);
    expect(await tokenOf(CAL)).toBeNull();
    expect(await tokenOf(CONTACTS)).toBeNull();
  });

  it('does not grant a migration that left the person after the page was opened', async () => {
    const token = tokenIn((await issue(ANNA)).body.url);
    const { callback } = await grant(token, 'anna@gmail.com');
    await q('DELETE FROM person_migration WHERE mapping_id = $1', [CONTACTS]);
    const ended = await callback();
    expect(ended.status, ended.text).toBe(200);
    expect(await tokenOf(CAL)).toBe(REFRESH);
    expect(await tokenOf(CONTACTS)).toBeNull();
  });
});

describe('a person’s grant link waits until the texts are accepted (0139 T3)', () => {
  const had = process.env.OWNPACE_STAGE;
  beforeAll(() => {
    process.env.OWNPACE_STAGE = 'alpha';
  });
  afterAll(() => {
    if (had === undefined) delete process.env.OWNPACE_STAGE;
    else process.env.OWNPACE_STAGE = had;
  });

  it('is refused to a member who has not accepted them, writing nothing, and issued once they have', async () => {
    const refused = await issue(ANNA);
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(refused.body.error).toBe('conditions_not_accepted');
    expect(documented('/api/people/{personId}/links', 'post', '409', refused.body)).toBe(true);
    expect(await q('SELECT id FROM person_link')).toEqual([]);

    const got = await withTenant(driver, TENANT, (db) => recordAcceptance(db, TENANT, 'pat', LEGAL_VERSIONS, 'en'));
    expect(got.kind).toBe('recorded');
    expect((await issue(ANNA)).status).toBe(201);
  });
});
