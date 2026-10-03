// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PERSON'S PROGRESS PAGE (ADR-0035, amended 2026-09-29; workplan 0153 T5 (b),
 * slice 3).
 *
 * Anna has four migrations: their Google account's calendar to one destination
 * and its contacts to another, their work Gmail, and an old IMAP mailbox. One
 * progress link:
 *
 *  - is handed over at the end of each grant through their grant link, and
 *    the owner can issue one too;
 *  - opens every migration of theirs with the counts and states a migration's
 *    own page shows, grouped by the Google account each reads under an opaque
 *    ref, with no migration id, no address and no host;
 *  - takes a grant back per account: each token that account's migrations
 *    hold is revoked at Google once, and cleared from each of them, and only
 *    them, with an audit row each, whatever Google answered;
 *  - takes nothing when the page it was pressed on is stale, and says so;
 *  - is not a grant link, and a grant link is not it.
 *
 * PGlite as `app_user`, both chains. Google's token and revoke endpoints are
 * the one thing stubbed. The names are invented.
 */

process.env.SECRET_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { join } from 'node:path';
import { expiryFromDays, issueMappingLink, pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { SecretStore } from '@openmig/core/secret-store';
import { specChecker } from '../__tests__/doors-that-start-work.ts';

// UUID family 0153c5d2-…, unused elsewhere in the repo.
const U = (n: string) => `0153c5d2-e29b-41d4-a716-4466554430${n}`;
const TENANT = U('01');
const ACCOUNT_CONN = U('11');
const WORK_CONN = U('12');
const IMAP_CONN = U('13');
const TARGET_CONN = U('14');
const ACCOUNT_BOX = U('21');
const WORK_BOX = U('22');
const IMAP_BOX = U('23');
const T1_BOX = U('24');
const T2_BOX = U('25');
const CAL = U('31');
const CONTACTS = U('32');
const WORK_MAIL = U('33');
const OLD_MAIL = U('34');
const ANNA = U('41');

const DEPLOYMENT_CLIENT_ID = 'deployment.apps.googleusercontent.com';
const WORK_CLIENT_ID = 'work.apps.googleusercontent.com';
const REFRESH = '1//a-granted-refresh-token';
const REVOKE = 'https://oauth2.googleapis.com/revoke';

const CHECKER = specChecker(join(import.meta.dirname, '..', '..', 'docs', 'openapi.yaml'));
function documented(spec: string, method: 'get' | 'post', status: string, body: unknown): boolean {
  const { schema } = CHECKER.responseSchema({ name: spec, path: spec, spec, method, accepted: 200 } as never, status);
  return CHECKER.satisfies(schema, body);
}

let driver: LedgerDriver;
const caller = { tenantId: TENANT, userId: 'pat', userRole: 'owner' };

vi.mock('@openmig/managed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/managed')>();
  return { ...actual, LEGAL_DRAFTS: { alpha: false, privacy: false, terms: false } };
});

// The first pass a grant starts (start when granted): counted, never sent.
const enqueued: string[] = [];
vi.mock('@openmig/scheduler', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getTriggerClient: () => ({
      tasks: {
        trigger: (_taskId: string, payload: { mappingId: string }) => {
          enqueued.push(payload.mappingId);
          return Promise.resolve({ id: `run-${enqueued.length}` });
        },
      },
    }),
  };
});

vi.mock('./../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, caller);
      next();
    },
    getDbPool: () => driver,
  };
});

const { default: peopleRoutes } = await import('./people.ts');
const { default: grantRoutes } = await import('./grant.ts');
const { default: viewRoutes } = await import('./view.ts');
const { default: googleOauthRoutes } = await import('./migrations/google-oauth-routes.ts');

const app = express();
app.use(express.json());
app.use('/api/people', peopleRoutes);
app.use('/api/grant', grantRoutes);
app.use('/api/view', viewRoutes);
app.use('/api/migrations', googleOauthRoutes);

function idTokenFor(email: string, aud: string): string {
  const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const claims = { iss: 'https://accounts.google.com', aud, sub: '1', email, email_verified: true };
  return `${part({ alg: 'RS256' })}.${part(claims)}.sig`;
}

let signsInAs = 'anna@gmail.com';
let askedScope = '';
let askedClient = DEPLOYMENT_CLIENT_ID;
/** What Google's revoke endpoint answers, per test, and every call it received. */
let revokeStatus = 200;
let revoked: string[] = [];

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

const issue = (body: Record<string, unknown> = {}) => request(app).post(`/api/people/${ANNA}/links`).send(body);
const tokenAfter = (url: string, page: 'grant' | 'view') => url.slice(url.lastIndexOf(`/${page}/`) + page.length + 2);

/** Grant one account through a fresh or given grant link, and answer the ending page. */
async function grantAs(account: string, token?: string) {
  const link = token ?? tokenAfter((await issue()).body.url, 'grant');
  signsInAs = account;
  const started = await request(app).post(`/api/grant/${link}/google/authorize`).send({ account });
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  const url = new URL(started.body.url);
  askedScope = url.searchParams.get('scope')!;
  askedClient = url.searchParams.get('client_id')!;
  const ended = await request(app)
    .get('/api/migrations/google/callback')
    .query({ state: url.searchParams.get('state')!, code: 'c' });
  expect(ended.status, ended.text).toBe(200);
  return { link, ended };
}

/** A progress link the owner issues, and the page it opens. */
async function progressPage() {
  const issued = await issue({ purpose: 'view' });
  expect(issued.status, JSON.stringify(issued.body)).toBe(201);
  const token = tokenAfter(issued.body.url, 'view');
  const page = await request(app).get(`/api/view/${token}`);
  expect(page.status, JSON.stringify(page.body)).toBe(200);
  return { token, page: page.body as import('@openmig/shared').PersonView };
}

beforeAll(async () => {
  process.env.API_URL = 'https://api.example';
  process.env.WEB_URL = 'https://app.example';
  process.env.GOOGLE_OAUTH_CLIENT_ID = DEPLOYMENT_CLIENT_ID;
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'not-a-real-deployment-secret';
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });

  vi.stubGlobal('fetch', async (url: string | URL, init?: { body?: unknown }) => {
    if (String(url) === REVOKE) {
      revoked.push(String(init?.body ?? ''));
      return new Response(revokeStatus === 200 ? '' : 'unavailable', { status: revokeStatus });
    }
    return new Response(
      JSON.stringify({ refresh_token: REFRESH, scope: askedScope, id_token: idTokenFor(signsInAs, askedClient) }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });

  const workCreds = JSON.stringify(
    SecretStore.encryptCredentials({
      username: 'anna@work.example',
      clientId: WORK_CLIENT_ID,
      clientSecret: 'not-a-real-work-secret',
    }).encrypted,
  );
  await q('INSERT INTO tenant (id, name) VALUES ($1, $2)', [TENANT, 'Acme Legal']);
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
  await q(`INSERT INTO person (id, tenant_id, display_name) VALUES ($1,$2,'Anna')`, [ANNA, TENANT]);
  for (const m of [CAL, CONTACTS, WORK_MAIL, OLD_MAIL]) {
    await q('INSERT INTO person_migration (mapping_id, person_id, tenant_id) VALUES ($1,$2,$3)', [m, ANNA, TENANT]);
  }
}, 60_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  await driver.end?.();
});

beforeEach(async () => {
  signsInAs = 'anna@gmail.com';
  revokeStatus = 200;
  revoked = [];
  await q('DELETE FROM person_link');
  await q('DELETE FROM mapping_link');
  await q(`UPDATE mailbox_mapping SET source_secret_ref = NULL, grant_withdrawn_at = NULL, status = 'paused'`);
  await q('DELETE FROM path_lifecycle');
  await q('DELETE FROM audit_log');
  enqueued.length = 0;
});

describe('a person’s progress page', () => {
  it('shows every migration of theirs, grouped by the Google account each reads, and nothing that names anything', async () => {
    const { page } = await progressPage();
    expect(page.kind).toBe('person');
    expect(page.organisation).toBe('Acme Legal');
    expect(page.migrations.map((m) => [m.from, m.to, m.state, m.started])).toEqual([
      ['google', 'nextcloud', 'paused', false],
      ['google', 'nextcloud', 'paused', false],
      ['gmail', 'nextcloud', 'paused', false],
      ['imap', 'nextcloud', 'paused', false],
    ]);
    const [cal, contacts, work, old] = page.migrations;
    expect(cal!.account).toMatch(/^[0-9a-f]{32}$/);
    expect(contacts!.account).toBe(cal!.account);
    expect(work!.account).not.toBe(cal!.account);
    // An IMAP mailbox's address is not a Google account, whatever it looks like.
    expect(old!.account).toBeNull();
    expect(page.accounts.map((a) => a.grant.state)).toEqual(['none', 'none']);

    const said = JSON.stringify(page);
    for (const secret of [CAL, CONTACTS, WORK_MAIL, OLD_MAIL, TENANT, ANNA, 'anna@', 'cloud.example.org', 'imap.old']) {
      expect(said).not.toContain(secret);
    }
    expect(documented('/api/view/{link}', 'get', '200', page)).toBe(true);
  });

  it('is handed over at the end of a grant through their grant link, and shows that account granted', async () => {
    const { ended } = await grantAs('anna@gmail.com');
    const url = /https:\/\/app\.example\/view\/(p\.[^"'<\s]+)/.exec(ended.text);
    expect(url, ended.text).not.toBeNull();
    const [row] = await q(`SELECT created_by FROM person_link WHERE purpose = 'view'`);
    expect(row?.created_by).toBe('granted-by-link');

    const page = await request(app).get(`/api/view/${url![1]}`);
    expect(page.status).toBe(200);
    expect(page.body.accounts.map((a: { grant: { state: string } }) => a.grant.state)).toEqual(['granted', 'none']);
  });

  it('is what a migration’s link sent before hands over, once the migration is theirs (the owner, 2026-10-03)', async () => {
    // A migration's link sent before the person's replaced it is honoured
    // until it expires; the progress page it ends on is the person's, since
    // that is the page there is now.
    const old = await withTenant(driver, TENANT, (db) =>
      issueMappingLink(db, { tenantId: TENANT, mappingId: CAL, purpose: 'grant', createdBy: 'pat', expiresAt: expiryFromDays(7) }),
    );
    signsInAs = 'anna@gmail.com';
    const started = await request(app).post(`/api/grant/${old.token}/google/authorize`).send({});
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const url = new URL(started.body.url);
    askedScope = url.searchParams.get('scope')!;
    askedClient = url.searchParams.get('client_id')!;
    const ended = await request(app)
      .get('/api/migrations/google/callback')
      .query({ state: url.searchParams.get('state')!, code: 'c' });

    expect(ended.status, ended.text).toBe(200);
    expect(ended.text).toMatch(/https:\/\/app\.example\/view\/p\./);
    expect(await q(`SELECT id FROM mapping_link WHERE purpose = 'view'`)).toEqual([]);
    expect((await q(`SELECT created_by FROM person_link WHERE purpose = 'view'`)).map((r) => r.created_by)).toEqual([
      'granted-by-link',
    ]);
  });

  it('starts the migration a link sent before granted, when the person’s move was started (start when granted)', async () => {
    await q(`UPDATE mailbox_mapping SET status = 'active' WHERE id = $1`, [OLD_MAIL]);
    const old = await withTenant(driver, TENANT, (db) =>
      issueMappingLink(db, { tenantId: TENANT, mappingId: CAL, purpose: 'grant', createdBy: 'pat', expiresAt: expiryFromDays(7) }),
    );
    const started = await request(app).post(`/api/grant/${old.token}/google/authorize`).send({});
    const url = new URL(started.body.url);
    askedScope = url.searchParams.get('scope')!;
    askedClient = url.searchParams.get('client_id')!;
    const ended = await request(app)
      .get('/api/migrations/google/callback')
      .query({ state: url.searchParams.get('state')!, code: 'c' });

    expect(ended.status, ended.text).toBe(200);
    expect((await q('SELECT status FROM mailbox_mapping WHERE id = $1', [CAL]))[0]?.status).toBe('active');
    expect(enqueued).toEqual([CAL]);
  });

  it('is not a grant link, and a grant link is not it', async () => {
    const grantToken = tokenAfter((await issue()).body.url, 'grant');
    const { token } = await progressPage();
    expect((await request(app).get(`/api/view/${grantToken}`)).status).toBe(401);
    expect((await request(app).get(`/api/grant/${token}`)).status).toBe(401);
  });

  it('opens nothing once the owner revokes it', async () => {
    const issued = await issue({ purpose: 'view' });
    await request(app).delete(`/api/people/${ANNA}/links/${issued.body.id}`);
    expect((await request(app).get(`/api/view/${tokenAfter(issued.body.url, 'view')}`)).status).toBe(401);
  });
});

describe('taking a grant back, per account', () => {
  it('revokes the account’s token once, clears it from both its migrations and nothing else, and says so', async () => {
    const { link } = await grantAs('anna@gmail.com');
    await grantAs('anna@work.example', link);
    const { token, page } = await progressPage();
    const account = page.migrations[0]!.account!;

    const res = await request(app).post(`/api/view/${token}/withdraw`).send({ account });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.atGoogle).toBe('revoked');
    expect(documented('/api/view/{link}/withdraw', 'post', '200', res.body)).toBe(true);
    expect(revoked).toEqual([`token=${encodeURIComponent(REFRESH)}`]);

    expect(await tokenOf(CAL)).toBeNull();
    expect(await tokenOf(CONTACTS)).toBeNull();
    expect(await tokenOf(WORK_MAIL)).toBe(REFRESH);
    const withdrawn = await q('SELECT id FROM mailbox_mapping WHERE grant_withdrawn_at IS NOT NULL ORDER BY id');
    expect(withdrawn.map((r) => r.id)).toEqual([CAL, CONTACTS].sort());
    const audit = await q(`SELECT actor, detail FROM audit_log WHERE action = 'mapping.grant_withdrawn'`);
    expect(audit.map((r) => (r.detail as { mappingId: string }).mappingId).sort()).toEqual([CAL, CONTACTS].sort());
    expect(audit.every((r) => r.actor === 'progress-link')).toBe(true);
    expect(audit.every((r) => (r.detail as { personLinkId?: string }).personLinkId)).toBe(true);

    const after = await request(app).get(`/api/view/${token}`);
    expect(after.body.accounts.map((a: { grant: { state: string } }) => a.grant.state)).toEqual([
      'withdrawn',
      'granted',
    ]);
  });

  it('clears it here when Google does not confirm, and says that too', async () => {
    await grantAs('anna@gmail.com');
    const { token, page } = await progressPage();
    revokeStatus = 503;
    const res = await request(app)
      .post(`/api/view/${token}/withdraw`)
      .send({ account: page.migrations[0]!.account });
    expect(res.status).toBe(200);
    expect(res.body.atGoogle).toBe('not_confirmed');
    expect(await tokenOf(CAL)).toBeNull();
    expect(await tokenOf(CONTACTS)).toBeNull();
  });

  it('takes nothing when the page is stale: a grant given again since is not deleted', async () => {
    await grantAs('anna@gmail.com');
    const { token, page } = await progressPage();
    const fresh = JSON.stringify(SecretStore.encryptCredentials({ refreshToken: '1//given-again' }).encrypted);
    await q('UPDATE mailbox_mapping SET source_secret_ref = $1 WHERE id IN ($2, $3)', [fresh, CAL, CONTACTS]);

    const res = await request(app)
      .post(`/api/view/${token}/withdraw`)
      .send({ account: page.migrations[0]!.account });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('changed');
    expect(res.body.reasonNl).toBeTruthy();
    expect(revoked).toEqual([]);
    expect(await tokenOf(CAL)).toBe('1//given-again');
  });

  it('answers nothing_granted for an account that holds no grant, and 400 for a body naming none', async () => {
    const { token, page } = await progressPage();
    const none = await request(app)
      .post(`/api/view/${token}/withdraw`)
      .send({ account: page.migrations[2]!.account });
    expect(none.status).toBe(409);
    expect(none.body.error).toBe('nothing_granted');
    expect((await request(app).post(`/api/view/${token}/withdraw`).send({})).status).toBe(400);
    expect(
      (await request(app).post(`/api/view/${token}/withdraw`).send({ account: 'anna@gmail.com' })).status,
    ).toBe(400);
    expect(revoked).toEqual([]);
  });
});
