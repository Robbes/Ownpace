// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// A CLOSED ORGANISATION TAKES NOBODY IN (workplan 0139 T7 (b); found on live on
// 2026-11-20). Runs against Testcontainers Postgres (pnpm test:integration), as
// `app_user`.
//
// An organisation made by a granted access request, which nobody had signed in
// to, was closed from the support page. Two days later somebody signed up with
// that address, and their first sign-in bound them to it as an active owner:
// `claimRequestedMembership` never read the organisation's status. A closed
// organisation starts nothing (409 `account_closed`), so they landed in one they
// could not use, and were never sent to ask for a fresh one. An invitation into
// a closed organisation was offered, and could be accepted, the same way.
//
// WHAT ONLY A SERVED REQUEST SHOWS is that the statements `auth.ts` sends can
// read the organisation's status at all. They run under the invitee's own
// policies with no tenant scope, where only `see_tenant_you_were_invited_to`
// (managed 0008, 0059) lets them read `tenant`, and a check they could not read
// would silently bind nobody. So every case beside a closed organisation binds,
// offers or accepts an open one in the same request.
//
// UUID Family: c1053d00-e29b-41d4-a716-44665544xxxx (subjects are text, not uuids)

process.env.JWT_SECRET = 'test-secret-for-integration-tests';
process.env.ACCESS_REQUEST_MAX_PER_HOUR = '1000';
process.env.WEB_URL = 'https://app.integration.test';

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { tenantRef } from '@openmig/managed';

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

const OPERATOR = 'cltn-operator-subject';
const OPEN = 'c1053d00-e29b-41d4-a716-446655440001';
const CLOSED = 'c1053d00-e29b-41d4-a716-446655440002';
const ERASING = 'c1053d00-e29b-41d4-a716-446655440003';
const SUSPENDED = 'c1053d00-e29b-41d4-a716-446655440004';
const SEEDED = [OPEN, CLOSED, ERASING, SUSPENDED];

/**
 * Every address this file writes starts with this, in lower case, so its
 * cleanup never reaches a sibling file's rows (integration files may run in
 * parallel and share `access_request`).
 */
const MARK = 'cltn-';

/** A token as an issuer signs one, verified or not. */
function signedIn(sub: string, email: string, verified: boolean): string {
  return `Bearer ${jwt.sign(
    verified ? { sub, email, email_verified: true } : { sub, email },
    process.env.JWT_SECRET!,
  )}`;
}

const asOperator = () => signedIn(OPERATOR, 'op@integration.test', true);

describe('a closed organisation takes nobody in', () => {
  let pool: Pool;
  const request = supertest(app);
  const provisioned: string[] = [];

  const cleanUp = async () => {
    // Requests first: a granted one keeps its organisation from being deleted.
    await pool.query(`DELETE FROM access_request WHERE lower(btrim(email)) LIKE $1`, [`${MARK}%`]);
    const all = [...SEEDED, ...provisioned];
    // A close writes its erasure record, which has no key to the organisation.
    await pool.query(`DELETE FROM erasure_record WHERE tenant_ref = ANY($1::text[])`, [all.map(tenantRef)]);
    await pool.query(`DELETE FROM tenant WHERE id = ANY($1::uuid[])`, [all]);
    provisioned.length = 0;
    await pool.query(`DELETE FROM platform_operator WHERE user_id = $1`, [OPERATOR]);
  };

  /** An organisation in the given state, as the owner of the database writes it. */
  const organisation = async (id: string, name: string, status: 'active' | 'closed' | 'deleting' | 'suspended') => {
    await pool.query(`INSERT INTO tenant (id, name, status, settings) VALUES ($1, $2, $3, '{}')`, [id, name, status]);
  };

  /** An open row nobody holds yet: what a grant writes (`requested`) or the Team page (`invited`). */
  const openRow = async (tenantId: string, email: string, origin: 'requested' | 'invited') => {
    await pool.query(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status, origin, invited_at)
       VALUES ($1, $2, $3, $4, 'invited', $5, now())`,
      [tenantId, `pending:${tenantId}`, email, origin === 'requested' ? 'owner' : 'admin', origin],
    );
  };

  const rowOf = async (tenantId: string) =>
    (
      await pool.query<{ user_id: string; status: string; origin: string }>(
        `SELECT user_id, status, origin FROM tenant_member WHERE tenant_id = $1`,
        [tenantId],
      )
    ).rows;

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

  it('binds nobody to a granted organisation closed from the support page before its first sign-in, and binds it after a reopen', async () => {
    // The path live took: a request, a grant, nobody signs in, the operator
    // closes it from its support page.
    const typed = `${MARK}granted@example.test`;
    const knocked = await request.post('/api/access-requests').send({ email: typed, note: 'one mailbox', locale: 'en' });
    expect(knocked.status).toBe(201);
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM access_request WHERE email = $1`, [typed]);
    expect(rows, 'the request is gone: a sibling file emptied access_request').toHaveLength(1);
    const granted = await request
      .post(`/api/access-requests/${rows[0]!.id}/grant`)
      .set('Authorization', asOperator())
      .send({});
    expect(granted.status).toBe(201);
    const tenantId = granted.body.tenantId as string;
    provisioned.push(tenantId);

    const closed = await request
      .post(`/api/support/tenants/${tenantId}/close`)
      .set('Authorization', asOperator())
      .send({ windowDays: 7, reference: 'closed before anybody signed in' });
    expect(closed.status).toBe(200);

    // Somebody signs up with that address and signs in for the first time.
    const bearer = signedIn(`${MARK}newcomer`, typed, true);
    const first = await request.get('/api/me').set('Authorization', bearer);
    expect(first.status).toBe(200);
    // No organisation, so the client sends them to ask for access, and no
    // invitation either: a requested row is never offered as one.
    expect(first.body.tenants).toEqual([]);
    expect(first.body.tenantId).toBeUndefined();
    expect(first.body.invitations).toEqual([]);
    const [waiting] = await rowOf(tenantId);
    expect(waiting).toMatchObject({ status: 'invited', origin: 'requested' });
    expect(waiting?.user_id).toMatch(/^pending:/);

    // Reopened from the support page before its erasure: the row waited, and
    // the next sign-in takes it up.
    const reopened = await request
      .post(`/api/support/tenants/${tenantId}/reopen`)
      .set('Authorization', asOperator())
      .send({ reference: 'closed by mistake' });
    expect(reopened.status).toBe(200);
    const after = await request.get('/api/me').set('Authorization', bearer);
    expect(after.status).toBe(200);
    expect(after.body.tenantId).toBe(tenantId);
    expect(after.body.role).toBe('owner');
    expect(await rowOf(tenantId)).toEqual([
      { user_id: `${MARK}newcomer`, status: 'active', origin: 'requested' },
    ]);
  });

  it('binds the open organisation and neither the closed one nor the one being erased, in one sign-in', async () => {
    // One address granted three organisations: one open, one closed, one whose
    // erasure is running. The open one binding is what shows the check can
    // read the organisation inside the claim at all.
    await organisation(OPEN, 'Open', 'active');
    await organisation(CLOSED, 'Closed', 'closed');
    await organisation(ERASING, 'Erasing', 'deleting');
    await openRow(OPEN, `${MARK}Pat@Example.test`, 'requested');
    await openRow(CLOSED, `${MARK}pat@example.test`, 'requested');
    await openRow(ERASING, ` ${MARK}PAT@example.test `, 'requested');

    const me = await request
      .get('/api/me')
      .set('Authorization', signedIn(`${MARK}pat`, `${MARK}pat@example.test`, true));
    expect(me.status).toBe(200);
    expect(me.body.tenants).toEqual([{ tenantId: OPEN, role: 'owner' }]);
    expect(me.body.tenantId).toBe(OPEN);
    expect(me.body.invitations).toEqual([]);

    expect(await rowOf(OPEN)).toEqual([{ user_id: `${MARK}pat`, status: 'active', origin: 'requested' }]);
    for (const id of [CLOSED, ERASING]) {
      expect(await rowOf(id), id).toEqual([{ user_id: `pending:${id}`, status: 'invited', origin: 'requested' }]);
    }
  });

  it('still binds a suspended organisation, as before: nothing writes that state and no erasure picks it', async () => {
    // The decision, pinned: only the two states the erasure acts on take
    // nobody in. Whatever first writes `suspended` decides again, here.
    await organisation(SUSPENDED, 'Held', 'suspended');
    await openRow(SUSPENDED, `${MARK}sam@example.test`, 'requested');

    const me = await request
      .get('/api/me')
      .set('Authorization', signedIn(`${MARK}sam`, `${MARK}sam@example.test`, true));
    expect(me.status).toBe(200);
    expect(me.body.tenants).toEqual([{ tenantId: SUSPENDED, role: 'owner' }]);
    expect(await rowOf(SUSPENDED)).toEqual([{ user_id: `${MARK}sam`, status: 'active', origin: 'requested' }]);
  });

  it('offers and accepts no invitation into a closed organisation or one being erased, and the open one as before', async () => {
    const address = `${MARK}kim@example.test`;
    const bearer = signedIn(`${MARK}kim`, address, true);

    // Only the closed one first. Nothing is offered, and a route that needs an
    // organisation says there is none rather than naming an invitation that
    // accepting would not honour.
    await organisation(CLOSED, 'Closed', 'closed');
    await openRow(CLOSED, address, 'invited');
    const alone = await request.get('/api/me').set('Authorization', bearer);
    expect(alone.status).toBe(200);
    expect(alone.body.invitations).toEqual([]);
    const refused = await request.get('/api/connections').set('Authorization', bearer);
    expect(refused.status).toBe(403);
    expect(refused.body.message).toBe('No active membership for this tenant');
    const intoClosed = await request.post(`/api/invitations/${CLOSED}/accept`).set('Authorization', bearer).send({});
    expect(intoClosed.status).toBe(404);

    // Then an open one and one being erased beside it.
    await organisation(OPEN, 'Open', 'active');
    await organisation(ERASING, 'Erasing', 'deleting');
    await openRow(OPEN, address, 'invited');
    await openRow(ERASING, address, 'invited');
    const offered = await request.get('/api/me').set('Authorization', bearer);
    expect(offered.status).toBe(200);
    expect(offered.body.invitations).toEqual([expect.objectContaining({ tenantId: OPEN, name: 'Open', role: 'admin' })]);

    const intoErasing = await request.post(`/api/invitations/${ERASING}/accept`).set('Authorization', bearer).send({});
    expect(intoErasing.status).toBe(404);
    const intoOpen = await request.post(`/api/invitations/${OPEN}/accept`).set('Authorization', bearer).send({});
    expect(intoOpen.status).toBe(200);
    expect(intoOpen.body.outcome).toBe('accepted');

    expect(await rowOf(OPEN)).toEqual([{ user_id: `${MARK}kim`, status: 'active', origin: 'invited' }]);
    for (const id of [CLOSED, ERASING]) {
      expect(await rowOf(id), id).toEqual([{ user_id: `pending:${id}`, status: 'invited', origin: 'invited' }]);
    }
    const after = await request.get('/api/me').set('Authorization', bearer);
    expect(after.body.tenants).toEqual([{ tenantId: OPEN, role: 'admin' }]);
    expect(after.body.invitations).toEqual([]);
  });
});
