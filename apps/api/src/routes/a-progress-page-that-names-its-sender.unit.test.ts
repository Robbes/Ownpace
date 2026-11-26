// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PROGRESS PAGE THAT NAMES ITS SENDER, AND SAYS WHO CAN OPEN THE COPY
 * (workplan 0176 §10, T6 step B; §7, T3; the owner, 2026-11-26).
 *
 * Until step B a person's progress page said *the organisation* wherever it
 * named whoever sent the link (*Want to continue later? Ask {who}*), because
 * its answer carried no sender, and it said nothing of who else can open the
 * copy, which the link page says. Two additions to the server's answer:
 *
 *  - **the sender**: the name the member gave, how the person knows them and
 *    their own number, as the link page has them, and never their address
 *    (the page carries none, `person-progress.ts`); with the organisation's
 *    number beside it, for the page to show where the member gave none
 *    (D11). A progress link a member made names that member. The one the
 *    ending hands over after a sign-in names the member who sent the grant
 *    link signed in through, with the relation chosen there, however many
 *    links are made after it (`made_from`, managed migration 0067). No
 *    member behind it any more: no sender, and the page names the
 *    organisation, as before;
 *  - **who can open the copy**, one yes or no per migration, by the rule the
 *    link page's answer uses (`isTheOrganisationsDestination`): a state, not
 *    content.
 *
 * PGlite as `app_user`, both chains. Google's token endpoint is the one thing
 * stubbed. The names are invented.
 */

process.env.SECRET_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { join } from 'node:path';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { SecretStore } from '@openmig/core/secret-store';
import type { PersonView } from '@openmig/shared';
import { specChecker } from '../__tests__/doors-that-start-work.ts';

// UUID family 01760b06-…, unused elsewhere in the repo.
const U = (n: string) => `01760b06-e29b-41d4-a716-4466554430${n}`;
const TENANT = U('01');
const ACCOUNT_CONN = U('11');
const OURS_CONN = U('12');
const THEIRS_CONN = U('13');
const ACCOUNT_BOX = U('21');
const OURS_BOX = U('22');
const THEIRS_BOX = U('23');
const TO_OURS = U('31');
const TO_THEIRS = U('32');
const ANNA = U('41');

const DEPLOYMENT_CLIENT_ID = 'deployment.apps.googleusercontent.com';
const REFRESH = '1//a-granted-refresh-token';

const CHECKER = specChecker(join(import.meta.dirname, '..', '..', 'docs', 'openapi.yaml'));
function documented(spec: string, method: 'get', status: string, body: unknown): boolean {
  const { schema } = CHECKER.responseSchema({ name: spec, path: spec, spec, method, accepted: 200 } as never, status);
  return CHECKER.satisfies(schema, body);
}

let driver: LedgerDriver;
const caller = { tenantId: TENANT, userId: 'pat', userRole: 'owner' };

vi.mock('@openmig/managed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/managed')>();
  return { ...actual, LEGAL_DRAFTS: { alpha: false, privacy: false, terms: false } };
});

vi.hoisted(() => {
  // The API refuses to make its producer without a jobs URL (__testing__/a-queue-stand-in.ts).
  process.env.JOBS_DATABASE_URL ??= 'postgres://ownpace_jobs@jobs.stand-in.invalid:6432/none';
});
vi.mock('@openmig/scheduler/pg-boss', async (importOriginal) =>
  (await import('../__testing__/a-queue-stand-in.ts')).aQueueStandIn(await importOriginal(), () => 'run-1'),
);

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

const issue = (body: Record<string, unknown> = {}) => request(app).post(`/api/people/${ANNA}/links`).send(body);
const tokenAfter = (url: string, page: 'grant' | 'view') => url.slice(url.lastIndexOf(`/${page}/`) + page.length + 2);
const as = (userId: string) => Object.assign(caller, { userId });
const setSender = (userId: string, name: string | null, phone: string | null) =>
  q(`UPDATE tenant_member SET display_name = $2, phone = $3 WHERE tenant_id = $1 AND user_id = $4`, [TENANT, name, phone, userId]);

/** The progress page a link opens. */
async function pageOf(token: string): Promise<PersonView & Record<string, unknown>> {
  const page = await request(app).get(`/api/view/${token}`);
  expect(page.status, JSON.stringify(page.body)).toBe(200);
  return page.body as PersonView & Record<string, unknown>;
}

/** Sign in through a grant link as Anna, and the progress link the ending hands over. */
async function signInThrough(grantToken: string): Promise<string> {
  const started = await request(app).post(`/api/grant/${grantToken}/google/authorize`).send({ account: 'anna@gmail.com' });
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  const url = new URL(started.body.url);
  askedScope = url.searchParams.get('scope')!;
  askedClient = url.searchParams.get('client_id')!;
  const ended = await request(app)
    .get('/api/migrations/google/callback')
    .query({ state: url.searchParams.get('state')!, code: 'c' });
  expect(ended.status, ended.text).toBe(200);
  const handed = /https:\/\/app\.example\/view\/(p\.[^"'<\s]+)/.exec(ended.text);
  expect(handed, ended.text).not.toBeNull();
  return handed![1]!;
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
    new Response(JSON.stringify({ refresh_token: REFRESH, scope: askedScope, id_token: idTokenFor('anna@gmail.com', askedClient) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

  const password = JSON.stringify(SecretStore.encryptCredentials({ password: 'a-password' }).encrypted);
  await q(`INSERT INTO tenant (id, name, settings) VALUES ($1, 'Acme Families', '{"contactPhone":"+31 20 123 4567"}'::jsonb)`, [
    TENANT,
  ]);
  await q(
    `INSERT INTO data_allowance (tenant_id, kind, tier_id, band_gb, price_eur, consented_by)
     VALUES ($1, 'tier', 'xl', 15000, 0, 'room for the test')`,
    [TENANT],
  );
  await q(
    `INSERT INTO tenant_member (tenant_id, user_id, email) VALUES ($1, 'pat', 'pat@example.org'), ($1, 'sam', 'sam@example.org')`,
    [TENANT],
  );
  // The organisation's Nextcloud, with its own password; and Anna's own
  // Soverin, whose password Anna gave through a link (0174, D1 (a)).
  await q(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref) VALUES
       ($1,$4,'source','google','anna','{"user":"anna@gmail.com"}'::jsonb,'connected',NULL),
       ($2,$4,'target','nextcloud','nc','{"host":"cloud.example.org","port":443}'::jsonb,'connected',$5),
       ($3,$4,'target','soverin','sov','{"user":"anna@soverin.example"}'::jsonb,'connected',$5)`,
    [ACCOUNT_CONN, OURS_CONN, THEIRS_CONN, TENANT, password],
  );
  for (const [box, conn] of [
    [ACCOUNT_BOX, ACCOUNT_CONN],
    [OURS_BOX, OURS_CONN],
    [THEIRS_BOX, THEIRS_CONN],
  ]) {
    await q(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES ($1,$2,$3,'user','m@example.invalid')`,
      [box, TENANT, conn],
    );
  }
  for (const [m, target] of [
    [TO_OURS, OURS_BOX],
    [TO_THEIRS, THEIRS_BOX],
  ]) {
    await q(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, target_config_override, status)
       VALUES ($1,$2,$3,$4,'{"user":"anna@example.org"}'::jsonb,'paused')`,
      [m, TENANT, ACCOUNT_BOX, target],
    );
  }
  await q(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1,$2,'calendar',true), ($1,$3,'contact',true)`, [
    TENANT,
    TO_OURS,
    TO_THEIRS,
  ]);
  await q(`INSERT INTO person (id, tenant_id, display_name) VALUES ($1,$2,'Anna')`, [ANNA, TENANT]);
  for (const m of [TO_OURS, TO_THEIRS]) {
    await q('INSERT INTO person_migration (mapping_id, person_id, tenant_id) VALUES ($1,$2,$3)', [m, ANNA, TENANT]);
  }
  await q(`INSERT INTO person_granted_connection (connection_id, tenant_id, person_id) VALUES ($1,$2,$3)`, [
    THEIRS_CONN,
    TENANT,
    ANNA,
  ]);
}, 60_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  await driver.end?.();
});

beforeEach(async () => {
  as('pat');
  await q('DELETE FROM person_link');
  await q(`UPDATE mailbox_mapping SET source_secret_ref = NULL, grant_withdrawn_at = NULL, status = 'paused'`);
  await q(`INSERT INTO tenant_member (tenant_id, user_id, email) VALUES ($1, 'pat', 'pat@example.org') ON CONFLICT DO NOTHING`, [TENANT]);
  await setSender('pat', 'Pat de Vries', '+31 6 1234 5678');
  await setSender('sam', 'Sam', null);
});

describe('the sender, on a person’s progress page (T6)', () => {
  it('a progress link a member makes names that member, with the relation they chose for this person, and no address', async () => {
    await issue({ relation: 'daughter' });
    const made = await issue({ purpose: 'view' });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const page = await pageOf(tokenAfter(made.body.url, 'view'));
    expect(page.sender).toEqual({ name: 'Pat de Vries', relation: 'daughter', phone: '+31 6 1234 5678' });
    expect(page.organisationPhone).toBe('+31 20 123 4567');
    // The page carries no address: not the member's, not anybody's.
    expect(JSON.stringify(page)).not.toMatch(/@/);
    expect(documented('/api/view/{link}', 'get', '200', page), JSON.stringify(page)).toBe(true);
  });

  it('a relation given with the progress link is its own', async () => {
    await issue({ relation: 'daughter' });
    const made = await issue({ purpose: 'view', relation: 'partner' });
    expect((await pageOf(tokenAfter(made.body.url, 'view'))).sender).toMatchObject({ relation: 'partner' });
  });

  it('the page the ending hands over names the member who sent the grant link, with the relation chosen there', async () => {
    const grant = await issue({ relation: 'son' });
    const handed = await signInThrough(tokenAfter(grant.body.url, 'grant'));
    const [row] = await q(`SELECT created_by, made_from FROM person_link WHERE purpose = 'view'`);
    expect(row).toEqual({ created_by: 'granted-by-link', made_from: grant.body.id });
    expect((await pageOf(handed)).sender).toEqual({ name: 'Pat de Vries', relation: 'son', phone: '+31 6 1234 5678' });

    // Another member makes a link afterwards: the page still names the one it came from.
    as('sam');
    expect((await issue({ relation: 'colleague' })).status).toBe(201);
    expect((await pageOf(handed)).sender).toEqual({ name: 'Pat de Vries', relation: 'son', phone: '+31 6 1234 5678' });
  });

  it('a member who is no member any more: no sender, and the page names the organisation, as before', async () => {
    const made = await issue({ purpose: 'view' });
    await q(`DELETE FROM tenant_member WHERE tenant_id = $1 AND user_id = 'pat'`, [TENANT]);
    const page = await pageOf(tokenAfter(made.body.url, 'view'));
    expect(page.sender).toBeNull();
    expect(page.organisation).toBe('Acme Families');
  });
});

describe('who can open the copy, per migration (T6, §10)', () => {
  it('is said where the destination is the organisation’s, and not where the person connected it themselves', async () => {
    const made = await issue({ purpose: 'view' });
    const page = await pageOf(tokenAfter(made.body.url, 'view'));
    expect(page.migrations.map((m) => [m.to, m.theOrganisationOpensIt])).toEqual([
      ['nextcloud', true],
      ['soverin', false],
    ]);
  });

  it('is the same answer the link page gives for the same migrations', async () => {
    const grant = await issue();
    const linkPage = await request(app).get(`/api/grant/${tokenAfter(grant.body.url, 'grant')}`);
    const onTheLink = (linkPage.body.accounts as Array<{ role: string; migrations: Array<{ to: { provider: string }; theOrganisationOpensIt: boolean }> }>)
      .filter((a) => a.role === 'source')
      .flatMap((a) => a.migrations.map((m) => [m.to.provider, m.theOrganisationOpensIt]));
    const made = await issue({ purpose: 'view' });
    const onThePage = (await pageOf(tokenAfter(made.body.url, 'view'))).migrations.map((m) => [m.to, m.theOrganisationOpensIt]);
    expect(onThePage).toEqual(onTheLink);
  });
});
