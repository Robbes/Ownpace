// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// Answering the door, served (workplan 0093 T6). Runs against Testcontainers
// Postgres (pnpm test:integration).
//
// The RLS unit tests either side of this prove the policies:
// `operator-under-rls.unit.test.ts` that only an operator can see or decide a
// request, `claim-invitation-under-rls.unit.test.ts` that an invitation binds
// only to the verified address it was sent to. What only a SERVED request can
// show is that the three writes granting performs — a tenant, an owner
// invitation, and the request marked granted — actually happen together on a
// pooled `app_user` connection, and that the person then gets in.
//
// The last case is the one worth the file. It signs in as somebody who has
// never been seen before and, on that first request, ends up owning the
// organisation that was provisioned for them. Every step of that is a policy
// doing what it was written to do, and none of it is covered by any of the
// pieces on their own.
//
// UUID Family: 5f6f0000-e29b-41d4-a716-44665544xxxx (subjects are text, not uuids)

process.env.JWT_SECRET = 'test-secret-for-integration-tests';
process.env.ACCESS_REQUEST_MAX_PER_HOUR = '1000';

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

const PG = process.env.TEST_DATABASE_URL;
if (!PG) throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');

const appUserUrl = (u: string): string => {
  const url = new URL(u);
  url.username = 'app_user';
  url.password = 'app_password';
  return url.toString();
};
process.env.APP_DATABASE_URL = appUserUrl(PG);

import app from '../index.ts';

const OPERATOR = 'op-subject-t6';
const OUTSIDER = 'outsider-subject-t6';

/**
 * Every row this file creates carries this prefix, and every cleanup is scoped
 * to it.
 *
 * `access_request` is shared with `access-requests.integration.test.ts` and
 * `access-requests-rate-limit.integration.test.ts`, and integration files run
 * in PARALLEL — only the `ui` project sets `fileParallelism: false`. A blanket
 * `DELETE FROM access_request` in a `beforeEach` therefore deletes whatever a
 * sibling is midway through asserting on. The rate-limit file established the
 * convention (`WHERE email LIKE 'flood-%'`); this follows it.
 */
const MARK = 't6';
const ASKER_EMAIL = `${MARK}-asked@example.test`;

/** A token shaped the way ADR-0042 says an issuer's is. */
function token(sub: string, extra: Record<string, unknown> = {}): string {
  return jwt.sign({ sub, email: `${sub}@integration.test`, ...extra }, process.env.JWT_SECRET!);
}

describe('the operator half of /api/access-requests', () => {
  let pool: Pool;
  const request = supertest(app);

  /** Tenants this file provisioned, so they can be cleaned up by identity. */
  const provisioned: string[] = [];

  /**
   * ORDER MATTERS, and the reason is a real contradiction in the schema.
   *
   * `access_request.tenant_id` is `ON DELETE SET NULL`, and the row also has
   * `CHECK ((state = 'granted') = (tenant_id IS NOT NULL))`. Deleting a tenant a
   * granted request points at therefore tries to null the column and violates
   * the check — the delete fails with
   * `access_request_granted_tenant_check`, which is what this file hit in CI.
   *
   * Requests first, then the tenants they named. Migration 0007 makes the
   * schema say what is actually true (`ON DELETE RESTRICT`), so from now on the
   * refusal names the tenant rather than a constraint on another table — but
   * this order is what a caller has to do either way.
   */
  const cleanUp = async () => {
    await pool.query(`DELETE FROM access_request WHERE email LIKE $1`, [`${MARK}-%`]);
    if (provisioned.length > 0) {
      await pool.query(`DELETE FROM tenant WHERE id = ANY($1::uuid[])`, [provisioned]);
      provisioned.length = 0;
    }
    await pool.query(`DELETE FROM platform_operator WHERE user_id = ANY($1::text[])`, [
      [OPERATOR, OUTSIDER],
    ]);
  };

  beforeAll(() => {
    pool = new Pool({ connectionString: PG });
  });

  afterAll(async () => {
    await cleanUp();
    await pool.end();
  });

  beforeEach(async () => {
    await cleanUp();
    await pool.query(
      `INSERT INTO platform_operator (user_id, email) VALUES ($1, 'op@integration.test')`,
      [OPERATOR],
    );
  });

  /**
   * Knock, the way the public form does — unauthenticated.
   *
   * The id comes back from the OWNER connection rather than from the operator
   * list: a fixture that reads through the route under test cannot tell a
   * broken fixture from a broken route.
   */
  const knock = async (email = ASKER_EMAIL, note = 'two mailboxes off Google') => {
    const res = await request.post('/api/access-requests').send({ email, note, locale: 'nl' });
    expect(res.status).toBe(201);
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM access_request WHERE email = $1`,
      [email],
    );
    return rows[0]!;
  };

  /** Only the rows this file wrote — siblings are writing to the same table. */
  const mine = (requests: Array<{ email: string }>) =>
    requests.filter((r) => r.email.startsWith(`${MARK}-`));

  it('shows an operator the queue', async () => {
    await knock();
    const res = await request
      .get('/api/access-requests')
      .set('Authorization', `Bearer ${token(OPERATOR)}`);

    expect(res.status).toBe(200);
    expect(mine(res.body.requests)).toHaveLength(1);
    expect(mine(res.body.requests)[0]).toMatchObject({
      email: ASKER_EMAIL,
      state: 'open',
      locale: 'nl',
    });
  });

  it('shows a NON-operator an empty queue, not an error', async () => {
    await knock();
    const res = await request
      .get('/api/access-requests')
      .set('Authorization', `Bearer ${token(OUTSIDER)}`);

    // 200 with nothing, because to the database there is nothing: the row is
    // invisible rather than forbidden, and saying "forbidden" would confirm
    // that a queue exists to somebody who may not know.
    //
    // The one assertion here that is deliberately ABSOLUTE rather than scoped
    // to this file: a non-operator sees no request at all, including every row
    // a sibling test file wrote.
    expect(res.status).toBe(200);
    expect(res.body.requests).toEqual([]);
  });

  it('is authenticated, and needs no tenant', async () => {
    // An operator has no membership anywhere — that is the normal case — so a
    // route behind `authenticate` would refuse them. This one must not.
    expect((await request.get('/api/access-requests')).status).toBe(401);
    const res = await request
      .get('/api/access-requests')
      .set('Authorization', `Bearer ${token(OPERATOR)}`);
    expect(res.status).toBe(200);
  });

  it('grants: one organisation, one owner invitation, one settled request', async () => {
    const asked = await knock();

    const res = await request
      .post(`/api/access-requests/${asked.id}/grant`)
      .set('Authorization', `Bearer ${token(OPERATOR)}`)
      .send({ organisationName: 'De Vries' });

    expect(res.status).toBe(201);
    provisioned.push(res.body.tenantId);
    expect(res.body).toMatchObject({ name: 'De Vries', email: ASKER_EMAIL });

    const { rows: tenants } = await pool.query<{ name: string }>(
      `SELECT name FROM tenant WHERE id = $1`,
      [res.body.tenantId],
    );
    expect(tenants[0]?.name).toBe('De Vries');

    const { rows: members } = await pool.query<{ status: string; role: string; user_id: string }>(
      `SELECT status, role, user_id FROM tenant_member WHERE tenant_id = $1`,
      [res.body.tenantId],
    );
    expect(members).toHaveLength(1);
    // An INVITATION, not a member: the person has no subject until they sign in.
    expect(members[0]).toMatchObject({ status: 'invited', role: 'owner' });
    expect(members[0]?.user_id).toMatch(/^pending:/);

    const { rows: settled } = await pool.query<{ state: string; tenant_id: string; decided_by: string }>(
      `SELECT state, tenant_id, decided_by FROM access_request WHERE id = $1`,
      [asked.id],
    );
    expect(settled[0]).toMatchObject({
      state: 'granted',
      tenant_id: res.body.tenantId,
      decided_by: OPERATOR,
    });
  });

  it('REFUSES a non-operator the grant, and provisions nothing', async () => {
    const asked = await knock();

    const res = await request
      .post(`/api/access-requests/${asked.id}/grant`)
      .set('Authorization', `Bearer ${token(OUTSIDER)}`)
      .send({});

    // 404, not 403: invisible and absent are the same answer, so an outsider
    // cannot use this route to discover that an id exists.
    expect(res.status).toBe(404);

    // "Provisions nothing" asked of THIS request rather than of the tenant
    // table's size — a count either side of the call is only a delta if no
    // sibling file created a tenant in between, and integration files run in
    // parallel. Still open and pointing at nothing is the property.
    const { rows } = await pool.query<{ state: string; tenant_id: string | null }>(
      `SELECT state, tenant_id FROM access_request WHERE id = $1`,
      [asked.id],
    );
    expect(rows[0]).toMatchObject({ state: 'open', tenant_id: null });
  });

  it('refuses to decide the same request twice', async () => {
    const asked = await knock();
    const first = await request
      .post(`/api/access-requests/${asked.id}/grant`)
      .set('Authorization', `Bearer ${token(OPERATOR)}`)
      .send({});
    expect(first.status).toBe(201);
    provisioned.push(first.body.tenantId);

    const again = await request
      .post(`/api/access-requests/${asked.id}/grant`)
      .set('Authorization', `Bearer ${token(OPERATOR)}`)
      .send({});

    // Deciding twice would either create a second organisation or lose the
    // first — the CHECK constraint would allow it, so the route must not.
    expect(again.status).toBe(409);

    // Asked of THIS request, not of the tenant table: `SELECT count(*) FROM
    // tenant` counts every tenant every other integration file created, which
    // is how this first read `expected 8 to be 1` in CI. What matters is that
    // the request still points at the organisation the first grant made.
    const { rows } = await pool.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM access_request WHERE id = $1`,
      [asked.id],
    );
    expect(rows[0]?.tenant_id).toBe(first.body.tenantId);
  });

  it('declines without provisioning, and keeps the record', async () => {
    const asked = await knock(`${MARK}-declined@example.test`);
    const res = await request
      .post(`/api/access-requests/${asked.id}/decline`)
      .set('Authorization', `Bearer ${token(OPERATOR)}`)
      .send({ note: 'out of scope for now' });

    expect(res.status).toBe(200);
    const { rows } = await pool.query<{ state: string; tenant_id: string | null; decision_note: string }>(
      `SELECT state, tenant_id, decision_note FROM access_request WHERE id = $1`,
      [asked.id],
    );
    // The row is still there. `access_request` has no DELETE grant for anybody,
    // so a refusal cannot be made to disappear afterwards.
    expect(rows[0]).toMatchObject({
      state: 'declined',
      tenant_id: null,
      decision_note: 'out of scope for now',
    });
  });

  it('lets the granted person IN on their first sign-in, and only with a verified email', async () => {
    // The case the whole feature exists for, end to end.
    const asked = await knock(`${MARK}-newcomer@example.test`);
    const granted = await request
      .post(`/api/access-requests/${asked.id}/grant`)
      .set('Authorization', `Bearer ${token(OPERATOR)}`)
      .send({});
    expect(granted.status).toBe(201);
    provisioned.push(granted.body.tenantId);

    // First: the issuer does NOT say the address is verified. Nothing binds —
    // otherwise whoever registers an address inherits what was sent to it.
    const unverified = await request
      .get('/api/me')
      .set(
        'Authorization',
        `Bearer ${jwt.sign({ sub: 'newcomer-sub', email: `${MARK}-newcomer@example.test` }, process.env.JWT_SECRET!)}`,
      );
    // 200 with nothing, not a refusal: `/api/me` reports (T7). What matters is
    // that the invitation did NOT bind — the organisation is still nobody's.
    expect(unverified.status).toBe(200);
    expect(unverified.body.tenants).toEqual([]);

    // Then: the same person, with the claim the issuer is supposed to make.
    const verified = await request.get('/api/me').set(
      'Authorization',
      `Bearer ${jwt.sign(
        { sub: 'newcomer-sub', email: `${MARK}-newcomer@example.test`, email_verified: true },
        process.env.JWT_SECRET!,
      )}`,
    );

    expect(verified.status).toBe(200);
    expect(verified.body.tenantId).toBe(granted.body.tenantId);
    expect(verified.body.role).toBe('owner');

    const { rows } = await pool.query<{ user_id: string; status: string }>(
      `SELECT user_id, status FROM tenant_member WHERE tenant_id = $1`,
      [granted.body.tenantId],
    );
    expect(rows[0]).toMatchObject({ user_id: 'newcomer-sub', status: 'active' });
  });
});
