// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PAGE IN THE VOICE CHOSEN FOR THEM (workplan 0176 §11, T7; D8 (a); the
 * owner, 2026-11-26: *"Yes"* to *je* or *u* as the member chooses, per
 * person).
 *
 *  - the member chooses, where the link is made, how the person's pages
 *    speak to them: Dutch with *u*, Dutch with *je*, or English. It is kept
 *    with the person (managed migration 0068); left out, it stays as it was;
 *    anything else is refused and no link is made;
 *  - both of the person's pages answer the language and the register, from
 *    that one choice; unset is today's page: no language, so the browser's,
 *    with *u*;
 *  - the server's own Dutch on a person's link is in that register: a
 *    refusal's `reasonNl`, and the ending after a sign-in.
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
import { specChecker } from '../__tests__/doors-that-start-work.ts';

// UUID family 01760b07-…, unused elsewhere in the repo.
const U = (n: string) => `01760b07-e29b-41d4-a716-4466554430${n}`;
const TENANT = U('01');
const ACCOUNT_CONN = U('11');
const TARGET_CONN = U('12');
const ACCOUNT_BOX = U('21');
const TARGET_BOX = U('22');
const CALENDAR = U('31');
const ANNA = U('41');

const DEPLOYMENT_CLIENT_ID = 'deployment.apps.googleusercontent.com';

const CHECKER = specChecker(join(import.meta.dirname, '..', '..', 'docs', 'openapi.yaml'));
function documented(spec: string, method: 'get' | 'post' | 'put', status: string, body: unknown): boolean {
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
const tokenIn = (url: string) => url.slice(url.lastIndexOf('/grant/') + '/grant/'.length);

/** A grant link made now, with the body given, and the page it opens. */
async function linkPage(body: Record<string, unknown> = {}) {
  const issued = await issue(body);
  expect(issued.status, JSON.stringify(issued.body)).toBe(201);
  const page = await request(app).get(`/api/grant/${tokenIn(issued.body.url)}`);
  expect(page.status, JSON.stringify(page.body)).toBe(200);
  return page.body as Record<string, unknown>;
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
    new Response(JSON.stringify({ refresh_token: '1//a-token', scope: askedScope, id_token: idTokenFor('anna@gmail.com', askedClient) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

  await q(`INSERT INTO tenant (id, name, settings) VALUES ($1, 'Acme Families', '{"contactPhone":"+31 20 123 4567"}'::jsonb)`, [
    TENANT,
  ]);
  await q(
    `INSERT INTO tenant_member (tenant_id, user_id, email) VALUES ($1, 'pat', 'owner@example.org'), ($1, 'sam', 'sam@example.org')`,
    [TENANT],
  );
  await q(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref) VALUES
       ($1,$3,'source','google','anna','{"user":"anna@gmail.com"}'::jsonb,'connected',NULL),
       ($2,$3,'target','nextcloud','nc','{"host":"cloud.example.org","port":443}'::jsonb,'connected',$4)`,
    [ACCOUNT_CONN, TARGET_CONN, TENANT, JSON.stringify(SecretStore.encryptCredentials({ password: 'the-owners' }).encrypted)],
  );
  for (const [box, conn] of [
    [ACCOUNT_BOX, ACCOUNT_CONN],
    [TARGET_BOX, TARGET_CONN],
  ]) {
    await q(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES ($1,$2,$3,'user','m@example.invalid')`,
      [box, TENANT, conn],
    );
  }
  await q(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, target_config_override, status)
     VALUES ($1,$2,$3,$4,'{"user":"anna@cloud.example.org"}'::jsonb,'paused')`,
    [CALENDAR, TENANT, ACCOUNT_BOX, TARGET_BOX],
  );
  await q(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1,$2,'calendar',true)`, [TENANT, CALENDAR]);
  await q(`INSERT INTO person (id, tenant_id, display_name) VALUES ($1,$2,'Anna')`, [ANNA, TENANT]);
  await q('INSERT INTO person_migration (mapping_id, person_id, tenant_id) VALUES ($1,$2,$3)', [CALENDAR, ANNA, TENANT]);
}, 60_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  await driver.end?.();
});

beforeEach(async () => {
  Object.assign(caller, { tenantId: TENANT, userId: 'pat', userRole: 'owner' });
  await q('DELETE FROM person_link');
  await q(`UPDATE person SET voice = NULL`);
  await q(`UPDATE mailbox_mapping SET source_secret_ref = NULL`);
  await q(`INSERT INTO person_migration (mapping_id, person_id, tenant_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [
    CALENDAR,
    ANNA,
    TENANT,
  ]);
});

const voiceOf = async () => (await q(`SELECT voice FROM person WHERE id = $1`, [ANNA]))[0]?.voice;
const viewPage = async (body: Record<string, unknown> = {}) => {
  const made = await issue({ purpose: 'view', ...body });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  const page = await request(app).get(`/api/view/${made.body.url.slice(made.body.url.lastIndexOf('/view/') + 6)}`);
  expect(page.status, JSON.stringify(page.body)).toBe(200);
  return page.body as Record<string, unknown>;
};

describe('the voice is chosen where the link is made, and kept with the person (T7)', () => {
  it('each of the three, said back with the link', async () => {
    for (const voice of ['nl-je', 'nl-u', 'en'] as const) {
      const made = await issue({ voice });
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      expect(made.body.voice).toBe(voice);
      expect(await voiceOf()).toBe(voice);
    }
    expect(documented('/api/people/{personId}/links', 'post' as never, '201', (await issue({ voice: 'nl-je' })).body)).toBe(true);
  });

  it('left out, it stays as it was; null clears it', async () => {
    await issue({ voice: 'nl-je' });
    expect((await issue({})).body.voice).toBe('nl-je');
    expect(await voiceOf()).toBe('nl-je');
    expect((await issue({ voice: null })).body.voice).toBeNull();
    expect(await voiceOf()).toBeNull();
  });

  it('anything else is refused, and no link is made', async () => {
    for (const voice of ['nl', 'je', 'de', 1]) expect((await issue({ voice })).status, String(voice)).toBe(400);
    expect(await q('SELECT id FROM person_link')).toEqual([]);
    expect(await voiceOf()).toBeNull();
  });

  it('the person’s card says it, for the form to offer it again', async () => {
    await issue({ voice: 'nl-je' });
    const people = await request(app).get('/api/people');
    expect(people.status).toBe(200);
    const anna = (people.body.people as Array<{ id: string; voice?: unknown }>).find((p) => p.id === ANNA);
    expect(anna?.voice).toBe('nl-je');
  });
});

describe('both pages answer the language and the register (T7, §11)', () => {
  const cases = [
    ['nl-je', 'nl', 'informal'],
    ['nl-u', 'nl', 'formal'],
    ['en', 'en', 'formal'],
  ] as const;

  for (const [voice, language, register] of cases) {
    it(`${voice}: ${language}, ${register}, on the link page and the progress page`, async () => {
      const page = await linkPage({ voice });
      expect([page.language, page.register]).toEqual([language, register]);
      const progress = await viewPage();
      expect([progress.language, progress.register]).toEqual([language, register]);
    });
  }

  it('unset is today’s page: no language, so the browser’s, with u', async () => {
    const page = await linkPage();
    expect([page.language, page.register]).toEqual([null, 'formal']);
    expect(documented('/api/grant/{link}', 'get', '200', page), JSON.stringify(page)).toBe(true);
    const progress = await viewPage();
    expect([progress.language, progress.register]).toEqual([null, 'formal']);
  });
});

describe("the server's own Dutch on a person's link is in that register (T7, §11)", () => {
  it('a refusal says je to a person whose pages say je, and u to the others', async () => {
    const token = tokenIn((await issue({ voice: 'nl-je' })).body.url);
    // Nothing left to grant: the link page's own refusal.
    await q('DELETE FROM person_migration WHERE person_id = $1', [ANNA]);
    const je = await request(app).get(`/api/grant/${token}`);
    expect(je.status).toBe(409);
    expect(je.body.reasonNl).toMatch(/\bje\b/);
    expect(je.body.reasonNl).not.toMatch(/\b(u|uw)\b/i);
    // The voice is the person's, not the link's: chosen again, every link of theirs says it.
    await q(`UPDATE person SET voice = 'nl-u' WHERE id = $1`, [ANNA]);
    const u = await request(app).get(`/api/grant/${token}`);
    expect(u.body.reasonNl).toMatch(/\bu\b/);
    expect(u.body.reasonNl).not.toMatch(/\bje\b/i);
  });

  it('and the progress page’s refusal of a stop, the same', async () => {
    await q(`UPDATE person SET voice = 'nl-je' WHERE id = $1`, [ANNA]);
    const made = await issue({ purpose: 'view' });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const view = made.body.url.slice(made.body.url.lastIndexOf('/view/') + 6);
    // An account the page never named: what it showed is not what is held.
    const stop = await request(app).post(`/api/view/${view}/withdraw`).send({ account: '0'.repeat(32) });
    expect(stop.status, JSON.stringify(stop.body)).toBe(409);
    expect(stop.body.reasonNl).toMatch(/\bje\b/i);
    expect(stop.body.reasonNl).not.toMatch(/\b(u|uw)\b/i);
  });

  it('the ending after a sign-in, in Dutch, says je to a person whose pages say je', async () => {
    const token = tokenIn((await issue({ voice: 'nl-je' })).body.url);
    const started = await request(app).post(`/api/grant/${token}/google/authorize`).send({ account: 'anna@gmail.com', locale: 'nl' });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const url = new URL(started.body.url);
    askedScope = url.searchParams.get('scope')!;
    askedClient = url.searchParams.get('client_id')!;
    const ended = await request(app).get('/api/migrations/google/callback').query({ state: url.searchParams.get('state')!, code: 'c' });
    expect(ended.status, ended.text).toBe(200);
    // What the page says, without its links: a link's token is random, and
    // one that holds `-Uw` reads as a word to `\b`.
    const said = ended.text.replace(/https:\/\/app\.example\/[\w./-]*/g, '');
    expect(said).toContain('Je account is nu verbonden');
    expect(said).not.toMatch(/\b(Uw|uw)\b/);
  });
});
