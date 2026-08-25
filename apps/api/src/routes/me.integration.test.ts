// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// `GET /api/me` — the route a client hits first, before it knows anything
// (ADR-0042, workplan 0093 T5). Runs against Testcontainers Postgres
// (pnpm test:integration).
//
// The unit tests either side cover the pieces: `tenant-resolution.unit.test.ts`
// the order `resolveTenant` tries, `own-membership-under-rls.unit.test.ts` the
// one SELECT policy that lets a subject read its own rows. What only a SERVED
// request can show is that those two hold together against a real database with
// RLS on and the connection made as `app_user` — that a token carrying no
// tenant at all is enough to get an answer, which is the whole premise of
// narrowing the claims.
//
// The multi-organisation case is the one worth reading twice, and it CHANGED at
// workplan 0093 T7. It used to be a 400 from `authenticate`, raised before this
// route ran; the refusal carried the list, because otherwise a client had no way
// to learn its options. That was a refusal doing a report's job.
//
// This route now runs on `authenticateSubject` and answers instead: here are
// your organisations, here is the one you are currently acting as, or none if
// that cannot be decided. Every other route keeps `authenticate` and keeps
// refusing — the 400 and its list still exist where a tenant is genuinely
// required. What changed is that the one question asked from OUTSIDE the
// boundary is no longer answered with a refusal.
//
// The reason it had to change: a platform operator belongs to no organisation
// at all, by design (T6). Under the old behaviour the web app could not hold a
// session for the one person who is supposed to grant everybody else's.
//
// UUID Family: 5e5e0000-e29b-41d4-a716-44665544xxxx

process.env.JWT_SECRET = 'test-secret-for-integration-tests';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

const PG = process.env.TEST_DATABASE_URL;
if (!PG) throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');

// app_user, not the owner: RLS is only proven when the connection is subject to it.
const appUserUrl = (u: string): string => {
  const url = new URL(u);
  url.username = 'app_user';
  url.password = 'app_password';
  return url.toString();
};
process.env.APP_DATABASE_URL = appUserUrl(PG);

import app from '../index.ts';
import { seedMembership } from '../__tests__/seed-membership.ts';

const TENANT_ONE = '5e5e0000-e29b-41d4-a716-446655441001';
const TENANT_TWO = '5e5e0000-e29b-41d4-a716-446655441002';

const SOLO = 'me-solo-subject';
const BOTH = 'me-both-subject';
const STRANGER = 'me-stranger-subject';

/**
 * A token shaped the way ADR-0042 says an issuer's is: `sub` and `email`, and
 * nothing this product invented. `tenantId` and `role` are passed only by the
 * cases that exist to prove they are not believed.
 */
function token(sub: string, extra: Record<string, unknown> = {}): string {
  return jwt.sign({ sub, email: `${sub}@integration.test`, ...extra }, process.env.JWT_SECRET!);
}

describe('GET /api/me', () => {
  let pool: Pool;
  const request = supertest(app);

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG });
    await pool.query(
      `INSERT INTO tenant (id, name, status, settings)
       VALUES ($1, 'Me Tenant One', 'active', '{}'), ($2, 'Me Tenant Two', 'active', '{}')
       ON CONFLICT (id) DO NOTHING`,
      [TENANT_ONE, TENANT_TWO],
    );
    await seedMembership(pool, TENANT_ONE, SOLO, 'member');
    await seedMembership(pool, TENANT_ONE, BOTH, 'owner');
    await seedMembership(pool, TENANT_TWO, BOTH, 'viewer');
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenant WHERE id = ANY($1::uuid[])`, [[TENANT_ONE, TENANT_TWO]]);
    await pool.end();
  });

  it('answers a token that names no tenant at all', async () => {
    // The premise of narrowing the claims: an issuer that knows nothing about
    // Ownpace's tenancy mints a token this route can still answer, because the
    // answer was always in `tenant_member`.
    const res = await request.get('/api/me').set('Authorization', `Bearer ${token(SOLO)}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      userId: SOLO,
      email: `${SOLO}@integration.test`,
      tenantId: TENANT_ONE,
      role: 'member',
    });
    expect(res.body.tenants).toEqual([{ tenantId: TENANT_ONE, role: 'member' }]);
  });

  it('takes the role from the DATABASE, not from the token that claims one', async () => {
    // A signature proves who signed a token, never what its subject may do.
    const res = await request
      .get('/api/me')
      .set('Authorization', `Bearer ${token(SOLO, { role: 'owner' })}`);

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('member');
  });

  it('does not GUESS between two organisations, and does not refuse either', async () => {
    const res = await request.get('/api/me').set('Authorization', `Bearer ${token(BOTH)}`);

    expect(res.status).toBe(200);
    // Both listed, and no current one — "these two, currently neither" is an
    // answer. Guessing would silently serve somebody the wrong organisation's
    // mail, which is the failure this has always been about; refusing merely
    // moved that decision somewhere a client could not act on it.
    expect(res.body.tenants).toEqual(
      expect.arrayContaining([
        { tenantId: TENANT_ONE, role: 'owner' },
        { tenantId: TENANT_TWO, role: 'viewer' },
      ]),
    );
    expect(res.body.tenantId).toBeUndefined();
    expect(res.body.role).toBeUndefined();
  });

  it('serves the one the caller named, and still lists the rest', async () => {
    const res = await request
      .get('/api/me')
      .set('Authorization', `Bearer ${token(BOTH)}`)
      .set('x-ownpace-tenant', TENANT_TWO);

    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe(TENANT_TWO);
    expect(res.body.role).toBe('viewer');
    expect(res.body.tenants).toHaveLength(2);
  });

  it('treats the header as a REQUEST for a tenant, not a grant of one', async () => {
    // Naming a tenant you are not in gets you nothing. This route reports
    // rather than refuses, so "nothing" is an empty list and no current
    // tenant — never the named one echoed back.
    const res = await request
      .get('/api/me')
      .set('Authorization', `Bearer ${token(STRANGER)}`)
      .set('x-ownpace-tenant', TENANT_ONE);

    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBeUndefined();
    expect(res.body.tenants).toEqual([]);
  });

  it('answers a subject with no membership anywhere, rather than refusing', async () => {
    // This is a platform operator's normal state, and it used to be a 403 —
    // which meant the web app could not hold a session for the one person who
    // grants everybody else's (workplan 0093 T7).
    const res = await request.get('/api/me').set('Authorization', `Bearer ${token(STRANGER)}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ userId: STRANGER, tenants: [], operator: false });
    expect(res.body.tenantId).toBeUndefined();
  });

  it('says whether this subject may answer the door', async () => {
    await pool.query(
      `INSERT INTO platform_operator (user_id, email) VALUES ($1, 'op@integration.test')
       ON CONFLICT (user_id) DO NOTHING`,
      [SOLO],
    );
    try {
      const res = await request.get('/api/me').set('Authorization', `Bearer ${token(SOLO)}`);
      expect(res.body.operator).toBe(true);
      // And the ordinary member is not one, so the flag is not simply always on.
      const other = await request.get('/api/me').set('Authorization', `Bearer ${token(BOTH)}`);
      expect(other.body.operator).toBe(false);
    } finally {
      await pool.query(`DELETE FROM platform_operator WHERE user_id = $1`, [SOLO]);
    }
  });

  it('is authenticated like everything else', async () => {
    expect((await request.get('/api/me')).status).toBe(401);
    expect((await request.get('/api/me').set('Authorization', 'Bearer garbage')).status).toBe(401);
  });
});

/**
 * THE MEMBERSHIP LABEL FOLLOWS THE VERIFIED CLAIM (workplan 0102 T3).
 *
 * `tenant_member.email` was written once and never updated, so somebody who
 * changed their address at the provider kept every membership — `sub` is the
 * identity — while the members table went on showing colleagues an address they
 * had moved off.
 *
 * WHY THIS NEEDS A REAL DATABASE. The write runs under the tenant-scoped UPDATE
 * policy, which permits rewriting ANY row in that organisation; only the
 * statement's own `user_id` predicate keeps it to one. A unit test can read that
 * predicate, and does. Nothing but a real table with RLS in force and the
 * connection made as `app_user` can show that a NEIGHBOUR in the same
 * organisation is left alone — which is the whole reason this feature was
 * written down for a decision instead of shipped past one.
 */
describe('GET /api/me — the label follows a verified address change', () => {
  const TENANT = '5e5e0000-e29b-41d4-a716-446655441003';
  const MOVER = 'me-mover-subject';
  const NEIGHBOUR = 'me-neighbour-subject';
  const MOVED_TO = 'moved@integration.test';

  let pool: Pool;
  const request = supertest(app);

  const labelOf = async (userId: string): Promise<string> => {
    const { rows } = await pool.query<{ email: string }>(
      `SELECT email FROM tenant_member WHERE tenant_id = $1 AND user_id = $2`,
      [TENANT, userId],
    );
    return rows[0]?.email ?? '<no row>';
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG });
    await pool.query(
      `INSERT INTO tenant (id, name, status, settings)
       VALUES ($1, 'Me Tenant Three', 'active', '{}') ON CONFLICT (id) DO NOTHING`,
      [TENANT],
    );
    await seedMembership(pool, TENANT, MOVER, 'owner');
    await seedMembership(pool, TENANT, NEIGHBOUR, 'member');
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenant WHERE id = $1`, [TENANT]);
    await pool.end();
  });

  it('leaves every label alone when the claim is not verified', async () => {
    // An unverified address is a typo or somebody else's inbox. Asserted FIRST,
    // so a later pass cannot be mistaken for this one having worked.
    const res = await request
      .get('/api/me')
      .set('Authorization', `Bearer ${token(MOVER, { email: MOVED_TO })}`);

    expect(res.status).toBe(200);
    expect(await labelOf(MOVER)).toBe(`${MOVER}@integration.test`);
  });

  it('moves the label when the issuer says it verified the new address', async () => {
    const res = await request
      .get('/api/me')
      .set('Authorization', `Bearer ${token(MOVER, { email: MOVED_TO, email_verified: true })}`);

    expect(res.status).toBe(200);
    // The response has always reported the claim; this is the row catching up.
    expect(res.body.email).toBe(MOVED_TO);
    expect(await labelOf(MOVER)).toBe(MOVED_TO);
  });

  it('leaves the OTHER member of that organisation exactly as it found them', async () => {
    // THE CASE THIS FILE EXISTS FOR. The policy the write runs under would
    // permit rewriting this row too; only the statement's `user_id` predicate
    // does not. Deleting that predicate passes every unit test that does not
    // read the source, and fails here.
    expect(await labelOf(NEIGHBOUR)).toBe(`${NEIGHBOUR}@integration.test`);
  });

  it('does not claim an invitation addressed to somebody else', async () => {
    /**
     * An `invited` row carries an email and no subject yet — workplan 0099 made
     * answering one a choice. A reconcile that touched invited rows would bind
     * memberships by side effect, which is exactly what that workplan removed.
     */
    await pool.query(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status, invited_at)
       VALUES ($1, $2, $3, 'member', 'invited', now())
       ON CONFLICT (tenant_id, user_id) DO NOTHING`,
      [TENANT, 'pending:me-invitee', 'someone-else@integration.test'],
    );
    try {
      const res = await request
        .get('/api/me')
        .set('Authorization', `Bearer ${token(MOVER, { email: MOVED_TO, email_verified: true })}`);
      expect(res.status).toBe(200);

      const { rows } = await pool.query<{ email: string; status: string }>(
        `SELECT email, status FROM tenant_member WHERE tenant_id = $1 AND user_id = $2`,
        [TENANT, 'pending:me-invitee'],
      );
      expect(rows[0]).toMatchObject({
        email: 'someone-else@integration.test',
        status: 'invited',
      });
    } finally {
      await pool.query(`DELETE FROM tenant_member WHERE tenant_id = $1 AND user_id = $2`, [
        TENANT,
        'pending:me-invitee',
      ]);
    }
  });

  it('is idempotent: signing in again with the same address writes nothing new', async () => {
    // The ordinary case for the rest of this deployment's life. `updated_at`
    // moving on every sign-in would mean an UPDATE on every sign-in.
    const before = await pool.query<{ updated_at: Date }>(
      `SELECT updated_at FROM tenant_member WHERE tenant_id = $1 AND user_id = $2`,
      [TENANT, MOVER],
    );
    await request
      .get('/api/me')
      .set('Authorization', `Bearer ${token(MOVER, { email: MOVED_TO, email_verified: true })}`);
    const after = await pool.query<{ updated_at: Date }>(
      `SELECT updated_at FROM tenant_member WHERE tenant_id = $1 AND user_id = $2`,
      [TENANT, MOVER],
    );

    // Asserted rather than indexed blindly: a missing row here would otherwise
    // read as "the timestamps match".
    expect(before.rows[0], 'the mover has no membership row').toBeDefined();
    expect(after.rows[0], 'the mover lost their membership row').toBeDefined();
    expect(after.rows[0]!.updated_at.getTime()).toBe(before.rows[0]!.updated_at.getTime());
  });
});
