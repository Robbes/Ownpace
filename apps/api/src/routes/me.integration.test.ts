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
