// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// AN INVITATION IN ANY CASE (managed 0059; workplan 0156 §3's "Not done").
// Runs against Testcontainers Postgres (pnpm test:integration), as `app_user`.
//
// The Alpha's front door: a tester types `Jan@Example.nl` on the request form,
// the operator grants it, and the identity provider verifies `jan@example.nl`
// (Microsoft sign-in often hands over an address with capitals; the form gets
// whatever the tester typed). Until 0059 the organisation never bound, the
// tester saw no invitation, and nothing told either of them why: the policies
// and the four statements in `auth.ts` compared the address exactly, while
// the rest of the system already decides two addresses are one person by
// `lower(btrim(...))`.
//
// The RLS unit tests beside the policies (`claim-invitation-under-rls`,
// `decline-invitation-under-rls`) prove the database half. What only a SERVED
// request shows is that the statements `auth.ts` sends ask the same question
// the policies answer: `GET /api/me` binds a granted organisation and offers an
// invitation in another case, and the invitation can be accepted and declined
// in another case. An unverified address and another address still get nothing.
// Rows from before 0059 that now match one person twice are offered once, and
// never accepted into an organisation the person is already in.
//
// UUID Family: 0156ac00-e29b-41d4-a716-44665544xxxx (subjects are text, not uuids)

process.env.JWT_SECRET = 'test-secret-for-integration-tests';
process.env.ACCESS_REQUEST_MAX_PER_HOUR = '1000';
process.env.WEB_URL = 'https://app.integration.test';

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

const OPERATOR = 'anyc-operator-subject';
const INVITED_TENANT = '0156ac00-e29b-41d4-a716-446655440001';
const DECLINED_TENANT = '0156ac00-e29b-41d4-a716-446655440002';
const MEMBER_TENANT = '0156ac00-e29b-41d4-a716-446655440003';
const TWICE_TENANT = '0156ac00-e29b-41d4-a716-446655440004';

/**
 * Every address this file writes starts with this, in lower case, so its
 * cleanup never reaches a sibling file's rows (integration files run in
 * parallel and share `access_request`).
 */
const MARK = 'anyc-';

/** A token as an issuer signs one, verified or not. */
function signedIn(sub: string, email: string, verified: boolean): string {
  return `Bearer ${jwt.sign(
    verified ? { sub, email, email_verified: true } : { sub, email },
    process.env.JWT_SECRET!,
  )}`;
}

describe('an invitation binds to the signed-in address whatever its case or spaces', () => {
  let pool: Pool;
  const request = supertest(app);
  const provisioned: string[] = [];

  const cleanUp = async () => {
    // Requests first: a granted one keeps its organisation from being deleted.
    await pool.query(`DELETE FROM access_request WHERE lower(btrim(email)) LIKE $1`, [`${MARK}%`]);
    await pool.query(`DELETE FROM tenant WHERE id = ANY($1::uuid[])`, [
      [INVITED_TENANT, DECLINED_TENANT, MEMBER_TENANT, TWICE_TENANT, ...provisioned],
    ]);
    provisioned.length = 0;
    await pool.query(`DELETE FROM platform_operator WHERE user_id = $1`, [OPERATOR]);
  };

  /** An invitation somebody made on the Team page, stored as `email` reads. */
  const invitedAs = async (tenantId: string, name: string, email: string) => {
    await pool.query(`INSERT INTO tenant (id, name, status, settings) VALUES ($1, $2, 'active', '{}')`, [
      tenantId,
      name,
    ]);
    await pool.query(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status, origin, invited_at)
       VALUES ($1, $2, $3, 'admin', 'invited', 'invited', now())`,
      [tenantId, `pending:${tenantId}`, email],
    );
  };

  const rowOf = async (tenantId: string) =>
    (
      await pool.query<{ user_id: string; status: string; email: string; role: string }>(
        `SELECT user_id, status, email, role FROM tenant_member WHERE tenant_id = $1 ORDER BY invited_at, id`,
        [tenantId],
      )
    ).rows;

  /** One more row in an organisation that already exists. */
  const alsoIn = async (
    tenantId: string,
    row: { userId: string; email: string; role: string; status: 'active' | 'invited'; invitedAt: string },
  ) => {
    await pool.query(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status, origin, invited_at, joined_at)
       VALUES ($1, $2, $3, $4, $5, 'invited', $6::timestamptz,
               CASE WHEN $5 = 'active' THEN $6::timestamptz END)`,
      [tenantId, row.userId, row.email, row.role, row.status, row.invitedAt],
    );
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
    await pool.query(`INSERT INTO platform_operator (user_id, email) VALUES ($1, 'op@integration.test')`, [
      OPERATOR,
    ]);
  });

  it('gives a granted organisation to the verified address in another case, and to nobody unverified', async () => {
    // Typed with capitals on the request form, as a tester might.
    const typed = `${MARK}Jan.Jansen@Example.test`;
    const knocked = await request.post('/api/access-requests').send({ email: typed, note: 'one mailbox', locale: 'nl' });
    expect(knocked.status).toBe(201);
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM access_request WHERE email = $1`, [typed]);
    // Integration files share `access_request`, and a sibling file that
    // empties it whole between the POST and this read would leave nothing to
    // grant. Say so here, rather than as a TypeError or a 404 further down.
    expect(rows, 'the request is gone: a sibling file emptied access_request').toHaveLength(1);
    const granted = await request
      .post(`/api/access-requests/${rows[0]!.id}/grant`)
      .set('Authorization', signedIn(OPERATOR, 'op@integration.test', true))
      .send({});
    expect(granted.status).toBe(201);
    provisioned.push(granted.body.tenantId as string);

    // The provider verified it in lower case. Unverified first: nothing.
    const verifiedAddress = `${MARK}jan.jansen@example.test`;
    const unverified = await request.get('/api/me').set('Authorization', signedIn('anyc-jan', verifiedAddress, false));
    expect(unverified.status).toBe(200);
    expect(unverified.body.tenants).toEqual([]);
    expect(unverified.body.invitations).toEqual([]);
    expect((await rowOf(granted.body.tenantId as string))[0]).toMatchObject({ status: 'invited' });

    // A stranger who verified another address: nothing either.
    const stranger = await request
      .get('/api/me')
      .set('Authorization', signedIn('anyc-stranger', `${MARK}jan.jansen@example.test.example`, true));
    expect(stranger.body.tenants).toEqual([]);
    expect((await rowOf(granted.body.tenantId as string))[0]?.user_id).toMatch(/^pending:/);

    const verified = await request.get('/api/me').set('Authorization', signedIn('anyc-jan', verifiedAddress, true));
    expect(verified.status).toBe(200);
    expect(verified.body.tenantId).toBe(granted.body.tenantId);
    expect(verified.body.role).toBe('owner');
    expect(verified.body.invitations).toEqual([]);
    // Bound, and the address is kept as it was typed: the label is the
    // person's own words, and `reconcileMemberEmail` leaves a same-address
    // label alone whatever its case.
    expect((await rowOf(granted.body.tenantId as string))[0]).toMatchObject({
      user_id: 'anyc-jan',
      status: 'active',
      email: typed,
    });
  });

  it('offers an invitation stored in another case, with spaces around it, and accepts it', async () => {
    await invitedAs(INVITED_TENANT, 'Familie Jansen', ` ${MARK}Pat@Example.test `);
    const bearer = signedIn('anyc-pat', `${MARK.toUpperCase()}PAT@EXAMPLE.TEST`, true);

    const me = await request.get('/api/me').set('Authorization', bearer);
    expect(me.status).toBe(200);
    expect(me.body.tenants).toEqual([]);
    expect(me.body.invitations).toEqual([
      expect.objectContaining({ tenantId: INVITED_TENANT, name: 'Familie Jansen', role: 'admin' }),
    ]);

    const accepted = await request.post(`/api/invitations/${INVITED_TENANT}/accept`).set('Authorization', bearer).send({});
    expect(accepted.status).toBe(200);
    expect(accepted.body.outcome).toBe('accepted');
    expect((await rowOf(INVITED_TENANT))[0]).toMatchObject({ user_id: 'anyc-pat', status: 'active' });
  });

  it('declines an invitation stored in another case, binding nobody', async () => {
    await invitedAs(DECLINED_TENANT, 'Bedrijf Nee', `${MARK}Kim@Example.TEST`);
    const bearer = signedIn('anyc-kim', `${MARK}kim@example.test`, true);

    const declined = await request.post(`/api/invitations/${DECLINED_TENANT}/decline`).set('Authorization', bearer).send({});
    expect(declined.status).toBe(200);
    expect(declined.body.outcome).toBe('declined');
    const [row] = await rowOf(DECLINED_TENANT);
    expect(row).toMatchObject({ status: 'declined' });
    expect(row?.user_id).toMatch(/^pending:/);

    const after = await request.get('/api/me').set('Authorization', bearer);
    expect(after.body.invitations).toEqual([]);
  });

  it('still answers nothing to an unverified address or another address, in any case', async () => {
    await invitedAs(INVITED_TENANT, 'Familie Jansen', `${MARK}Pat@Example.test`);

    const tries = [
      signedIn('anyc-unverified', `${MARK}pat@example.test`, false),
      signedIn('anyc-other', `${MARK}PAT@example.test.example`, true),
      signedIn('anyc-inside', `${MARK}pat @example.test`, true),
    ];
    for (const bearer of tries) {
      const me = await request.get('/api/me').set('Authorization', bearer);
      expect(me.body.invitations).toEqual([]);
      const accept = await request.post(`/api/invitations/${INVITED_TENANT}/accept`).set('Authorization', bearer).send({});
      expect(accept.status).toBe(404);
      const decline = await request.post(`/api/invitations/${INVITED_TENANT}/decline`).set('Authorization', bearer).send({});
      expect(decline.status).toBe(404);
    }
    expect((await rowOf(INVITED_TENANT))[0]).toMatchObject({ status: 'invited', user_id: `pending:${INVITED_TENANT}` });
  });

  // ROWS FROM BEFORE 0059. The Team page used to refuse only an exact repeat,
  // so an organisation can hold an invitation to a member's own address in
  // other capitals, or two open invitations to one address. Each was invisible
  // until 0059 and now matches the same person. Neither may be offered as an
  // invitation to an organisation they are already in, and accepting must
  // not trip UNIQUE (tenant_id, user_id) into a 500.
  it('offers no invitation to an organisation the person is already in, and accepting one answers 404', async () => {
    await invitedAs(MEMBER_TENANT, 'Al Binnen', `${MARK}Pat@Example.test`);
    await alsoIn(MEMBER_TENANT, {
      userId: 'anyc-member',
      email: `${MARK}pat@example.test`,
      role: 'owner',
      status: 'active',
      invitedAt: '2026-10-01T09:00:00Z',
    });
    const bearer = signedIn('anyc-member', `${MARK}pat@example.test`, true);

    const me = await request.get('/api/me').set('Authorization', bearer);
    expect(me.status).toBe(200);
    expect(me.body.tenants).toEqual([expect.objectContaining({ tenantId: MEMBER_TENANT, role: 'owner' })]);
    expect(me.body.invitations).toEqual([]);

    const accepted = await request.post(`/api/invitations/${MEMBER_TENANT}/accept`).set('Authorization', bearer).send({});
    expect(accepted.status).toBe(404);
    expect((await rowOf(MEMBER_TENANT)).map((r) => [r.user_id, r.status, r.role])).toEqual([
      ['anyc-member', 'active', 'owner'],
      [`pending:${MEMBER_TENANT}`, 'invited', 'admin'],
    ]);
  });

  it('offers two open invitations to one address in one organisation once, and accepting binds the first', async () => {
    await pool.query(`INSERT INTO tenant (id, name, status, settings) VALUES ($1, 'Twee Keer', 'active', '{}')`, [
      TWICE_TENANT,
    ]);
    await alsoIn(TWICE_TENANT, {
      userId: `pending:${TWICE_TENANT}-a`,
      email: `${MARK}Sam@Example.test`,
      role: 'admin',
      status: 'invited',
      invitedAt: '2026-10-01T09:00:00Z',
    });
    await alsoIn(TWICE_TENANT, {
      userId: `pending:${TWICE_TENANT}-b`,
      email: `${MARK}sam@example.test`,
      role: 'owner',
      status: 'invited',
      invitedAt: '2026-10-02T09:00:00Z',
    });
    const bearer = signedIn('anyc-sam', `${MARK}SAM@example.test`, true);

    const me = await request.get('/api/me').set('Authorization', bearer);
    expect(me.status).toBe(200);
    // One organisation, offered once, with the role that accepting gives.
    expect(me.body.invitations).toEqual([
      expect.objectContaining({ tenantId: TWICE_TENANT, name: 'Twee Keer', role: 'admin' }),
    ]);

    const accepted = await request.post(`/api/invitations/${TWICE_TENANT}/accept`).set('Authorization', bearer).send({});
    expect(accepted.status).toBe(200);
    expect(accepted.body.outcome).toBe('accepted');
    expect((await rowOf(TWICE_TENANT)).map((r) => [r.user_id, r.status, r.role])).toEqual([
      ['anyc-sam', 'active', 'admin'],
      [`pending:${TWICE_TENANT}-b`, 'invited', 'owner'],
    ]);

    // In once, and the other row is not offered again.
    const after = await request.get('/api/me').set('Authorization', bearer);
    expect(after.body.tenants).toEqual([expect.objectContaining({ tenantId: TWICE_TENANT, role: 'admin' })]);
    expect(after.body.invitations).toEqual([]);
    const again = await request.post(`/api/invitations/${TWICE_TENANT}/accept`).set('Authorization', bearer).send({});
    expect(again.status).toBe(404);
  });
});
