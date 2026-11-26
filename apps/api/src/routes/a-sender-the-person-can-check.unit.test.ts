// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SENDER THE PERSON CAN CHECK (workplan 0176 §7, T3; D7, D11; the owner,
 * 2026-11-26: *"Yes"* to naming the member who asks, and *"Yes, good idea. And
 * we can store/show the phone number."*).
 *
 * Until step B a person's link page named the member who made the link by
 * their sign-in address, and showed the organisation's number. Now:
 *
 *  - a member says their own name, as the people they send a link to know
 *    them, and their own number, on Team (`PUT …/members/me`), and nobody
 *    else's; each is held to a shape, and refused with a code the screen
 *    words;
 *  - the member's list says both, so Team can show them;
 *  - a person's link says how the person knows the member, from a fixed list
 *    (D7), or none, and refuses anything else;
 *  - the link page's answer carries the sender: the name, the relation and
 *    the member's own number, beside the address it carried before
 *    (`askedBy`) and the organisation's number, so the page can show the
 *    member's own number where given, else the organisation's (D11);
 *  - a member who gave no name is named by their address, as before.
 *
 * PGlite as `app_user`, both chains. The names are invented.
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

// UUID family 01760b03-…, unused elsewhere in the repo.
const U = (n: string) => `01760b03-e29b-41d4-a716-4466554430${n}`;
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
const { default: membersRoutes } = await import('./tenants/members.ts');

const app = express();
app.use(express.json());
app.use('/api/people', peopleRoutes);
app.use('/api/grant', grantRoutes);
app.use('/api/tenants/:tenantId/members', membersRoutes);

async function q(sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(sql, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

const me = (body: Record<string, unknown>) => request(app).put(`/api/tenants/${TENANT}/members/me`).send(body);
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
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  await driver.end?.();
});

beforeEach(async () => {
  Object.assign(caller, { tenantId: TENANT, userId: 'pat', userRole: 'owner' });
  await q('DELETE FROM person_link');
  await q(`UPDATE tenant_member SET display_name = NULL, phone = NULL`);
});

describe("a member's own name and number, on Team", () => {
  it('are said by the member, for themselves, and the list says them', async () => {
    const res = await me({ displayName: '  Pat   de Vries ', phone: '+31 6  1234 5678' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ displayName: 'Pat de Vries', phone: '+31 6 1234 5678' });
    expect(documented('/api/tenants/{tenantId}/members/me', 'put', '200', res.body)).toBe(true);

    const list = await request(app).get(`/api/tenants/${TENANT}/members`);
    expect(list.status).toBe(200);
    const byUser = Object.fromEntries(
      (list.body.members as Array<Record<string, unknown>>).map((m) => [m.userId, { displayName: m.displayName, phone: m.phone }]),
    );
    // Their own row, and nobody else's.
    expect(byUser).toEqual({
      pat: { displayName: 'Pat de Vries', phone: '+31 6 1234 5678' },
      sam: { displayName: null, phone: null },
    });
  });

  it('refuse a name that is no name and a number that is no number, each with its code, and store nothing', async () => {
    await me({ displayName: 'Pat', phone: '+31 6 1234 5678' });
    const name = await me({ displayName: 'www.bank.example' });
    expect(name.status).toBe(400);
    expect(name.body.error).toBe('sender_name_refused');
    expect(typeof name.body.message).toBe('string');
    const phone = await me({ phone: 'Call IT, they know' });
    expect(phone.status).toBe(400);
    expect(phone.body.error).toBe('sender_phone_refused');
    const [row] = await q(`SELECT display_name, phone FROM tenant_member WHERE user_id = 'pat'`);
    expect(row).toEqual({ display_name: 'Pat', phone: '+31 6 1234 5678' });
  });

  it('leave what the body does not name, and an empty one clears it', async () => {
    await me({ displayName: 'Pat', phone: '+31 6 1234 5678' });
    expect((await me({ phone: '' })).body).toEqual({ displayName: 'Pat', phone: null });
    expect((await me({ displayName: '' })).body).toEqual({ displayName: null, phone: null });
  });

  it('refuse a body that names something else', async () => {
    expect((await me({ displayName: 'Pat', userId: 'sam' })).status).toBe(400);
    expect((await me({ displayName: 42 })).status).toBe(400);
  });
});

describe("a person's link says how the person knows the sender (D7)", () => {
  it('from the list, and the page answers it', async () => {
    await me({ displayName: 'Pat', phone: '+31 6 1234 5678' });
    const page = await linkPage({ relation: 'daughter' });
    expect(page.sender).toEqual({ name: 'Pat', relation: 'daughter', phone: '+31 6 1234 5678' });
    expect(documented('/api/grant/{link}', 'get', '200', page), JSON.stringify(page)).toBe(true);
  });

  it('or none, which is what every link made before says', async () => {
    await me({ displayName: 'Pat' });
    const page = await linkPage();
    expect(page.sender).toEqual({ name: 'Pat', relation: null, phone: null });
  });

  it('and refuses anything else, making no link', async () => {
    for (const relation of ['bank', 'Daughter', 'your daughter', 7]) {
      const res = await issue({ relation });
      expect(res.status, String(relation)).toBe(400);
    }
    expect(await q('SELECT id FROM person_link')).toEqual([]);
  });
});

describe('the link page names the sender (§7)', () => {
  it("beside the address it named before and the organisation's number (D11: the page chooses)", async () => {
    await me({ displayName: 'Pat de Vries', phone: '+31 6 1234 5678' });
    const page = await linkPage({ relation: 'son' });
    expect(page.askedBy).toBe('owner@example.org');
    expect(page.organisationPhone).toBe('+31 20 123 4567');
    expect(page.sender).toEqual({ name: 'Pat de Vries', relation: 'son', phone: '+31 6 1234 5678' });
  });

  it('a member who gave no name and no number is named by their address, with the organisation’s number', async () => {
    const page = await linkPage({ relation: 'colleague' });
    expect(page.askedBy).toBe('owner@example.org');
    expect(page.sender).toEqual({ name: null, relation: 'colleague', phone: null });
    expect(page.organisationPhone).toBe('+31 20 123 4567');
  });

  it("names the member who made the link, not the one who looks at it later", async () => {
    await me({ displayName: 'Pat' });
    const issued = await issue({ relation: 'grandson' });
    Object.assign(caller, { userId: 'sam' });
    await me({ displayName: 'Sam' });
    const page = await request(app).get(`/api/grant/${tokenIn(issued.body.url)}`);
    expect(page.body.sender).toEqual({ name: 'Pat', relation: 'grandson', phone: null });
    expect(page.body.askedBy).toBe('owner@example.org');
  });

  it('shows as none a name stored past the rule, never as it is', async () => {
    // A row written some other way than the route, within the migration's CHECK.
    await q(`UPDATE tenant_member SET display_name = 'www.bank.example' WHERE user_id = 'pat'`);
    const page = await linkPage();
    expect(page.sender).toEqual({ name: null, relation: null, phone: null });
  });
});
