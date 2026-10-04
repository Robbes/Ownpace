// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * API Integration Tests for Members Routes
 *
 * Tests that prove tenant isolation for members endpoints using RLS.
 * These tests use supertest against a Testcontainers Postgres instance.
 * Tests connect as the non-owner app_user role to ensure RLS is enforced.
 *
 * UUID Family: 950e8400-e29b-41d4-a716-44665544xxxx
 */

// Set JWT_SECRET before importing app
process.env.JWT_SECRET = 'test-secret-for-integration-tests';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests require Testcontainers to be running. ' +
    'Run: pnpm test:integration'
  );
}

// Set APP_DATABASE_URL with app_user role to ensure RLS is enforced
const getAppUserConnectionString = (originalUrl: string): string => {
  const url = new URL(originalUrl);
  url.username = 'app_user';
  url.password = 'app_password';
  return url.toString();
};
process.env.APP_DATABASE_URL = getAppUserConnectionString(PG_CONNECTION_STRING);

import app from '../../index.ts';
import { seedMembership } from '../../__tests__/seed-membership.ts';

// UUIDs for API isolation tests (950e8400-e29b-41d4-a716-44665544xxxx)
const API_TENANT_A = '5d2b0000-e29b-41d4-a716-446655444101';
const API_TENANT_B = '5d2b0000-e29b-41d4-a716-446655444102';

// One sub per (tenant, role): the membership gate (0020 T1) takes the role
// from the tenant_member row, so two tokens with the same sub can no longer
// act as two different roles.
function createTestToken(
  tenantId: string,
  role: string = 'member',
  sub: string = `user-${role}-${tenantId}`
): string {
  return jwt.sign(
    {
      sub,
      tenantId,
      role,
      email: `user@${tenantId}.test`,
    },
    process.env.JWT_SECRET!
  );
}

const TOKEN_TENANT_A = createTestToken(API_TENANT_A);
const TOKEN_TENANT_B = createTestToken(API_TENANT_B);
const TOKEN_ADMIN_A = createTestToken(API_TENANT_A, 'admin');
// The owner token IS the seeded sole owner (user-owner-001): seeding a second
// ACTIVE owner row for a separate token sub would break the last-owner guard
// tests. An invited or a declined owner row does not (0137 T3 (b)): only an
// active owner counts, and the owner-invites-owner case below leaves one.
const TOKEN_OWNER_A = createTestToken(API_TENANT_A, 'owner', 'user-owner-001');

describe('Members Route Isolation', () => {
  let superuserPool: Pool;
  let request: ReturnType<typeof supertest>;
  let memberAId: string;
  let ownerAId: string;

  beforeAll(async () => {
    superuserPool = new Pool({
      connectionString: PG_CONNECTION_STRING,
    });

    // Create test tenants
    await superuserPool.query(`
      INSERT INTO tenant (id, name, status, settings)
      VALUES ($1, $2, $3, '{}'), ($4, $5, $6, '{}')
      ON CONFLICT (id) DO NOTHING
    `, [
      API_TENANT_A, 'Members Tenant A', 'active',
      API_TENANT_B, 'Members Tenant B', 'active',
    ]);

    // Create members for tenant A
    const memberId = randomUUID();
    const result = await superuserPool.query(`
      INSERT INTO tenant_member (id, tenant_id, user_id, email, role, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `, [
      memberId,
      API_TENANT_A,
      'user-member-001',
      'member@example.com',
      'member',
      'active',
    ]);
    memberAId = result.rows[0].id;

    // Create an owner for tenant A (needed for "prevent removing last owner" test)
    const ownerId = randomUUID();
    await superuserPool.query(`
      INSERT INTO tenant_member (id, tenant_id, user_id, email, role, status)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      ownerId,
      API_TENANT_A,
      'user-owner-001',
      'owner@example.com',
      'owner',
      'active',
    ]);
    ownerAId = ownerId;

    // Membership gate (0020 T1): rows for the minted member/admin tokens (the
    // owner token reuses user-owner-001 above), and tenant B's requester.
    await seedMembership(superuserPool, API_TENANT_A, `user-member-${API_TENANT_A}`, 'member');
    await seedMembership(superuserPool, API_TENANT_A, `user-admin-${API_TENANT_A}`, 'admin');
    await seedMembership(superuserPool, API_TENANT_B, `user-member-${API_TENANT_B}`, 'member');

    request = supertest(app);
  });

  afterAll(async () => {
    // Cleanup test data
    await superuserPool.query(`DELETE FROM tenant_member WHERE tenant_id IN ($1, $2)`, [
      API_TENANT_A,
      API_TENANT_B,
    ]);
    await superuserPool.query(`DELETE FROM tenant WHERE id IN ($1, $2)`, [
      API_TENANT_A,
      API_TENANT_B,
    ]);
    await superuserPool.end();
  });

  describe('GET /api/tenants/:tenantId/members', () => {
    it('should list members for authenticated tenant', async () => {
      const response = await request
        .get(`/api/tenants/${API_TENANT_A}/members`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_A}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.members)).toBe(true);
      expect(response.body.members.length).toBeGreaterThan(0);
    });

    it('should prevent tenant B from accessing tenant A members', async () => {
      const response = await request
        .get(`/api/tenants/${API_TENANT_A}/members`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_B}`);

      expect(response.status).toBe(200);
      // RLS scopes the query to the REQUESTER's tenant: B sees only its own
      // membership (the gate requires the requester to be a member), never
      // anything of tenant A's.
      expect(
        (response.body.members as { userId: string }[]).map((m) => m.userId)
      ).toEqual([`user-member-${API_TENANT_B}`]);
    });

    it('should return 401 without token', async () => {
      const response = await request.get(`/api/tenants/${API_TENANT_A}/members`);
      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/tenants/:tenantId/members', () => {
    it('should invite member as admin', async () => {
      // As an admin, since owner and admin are the only roles granted until
      // every write names its roles (0137 T7): a `member` invitation answers
      // 400, which `a-role-that-promises-less-than-it-allows.unit.test.ts`
      // holds.
      const response = await request
        .post(`/api/tenants/${API_TENANT_A}/members`)
        .set('Authorization', `Bearer ${TOKEN_ADMIN_A}`)
        .send({
          email: 'newmember@example.com',
          role: 'admin',
        });

      expect(response.status).toBe(201);
      expect(response.body.email).toBe('newmember@example.com');
      expect(response.body.role).toBe('admin');
      expect(response.body.status).toBe('invited');
    });

    it('refuses a duplicate invite in plain words (0039 T5)', async () => {
      // First invite lands...
      const first = await request
        .post(`/api/tenants/${API_TENANT_A}/members`)
        .set('Authorization', `Bearer ${TOKEN_ADMIN_A}`)
        .send({ email: 'duplicate@example.com', role: 'admin' });
      expect(first.status).toBe(201);

      // ...the second is refused, naming the row that exists. Before this
      // check the pending:UUID placeholder defeated the unique constraint
      // and a second row was silently created — which row's role won on
      // acceptance was undefined.
      const second = await request
        .post(`/api/tenants/${API_TENANT_A}/members`)
        .set('Authorization', `Bearer ${TOKEN_ADMIN_A}`)
        .send({ email: 'duplicate@example.com', role: 'admin' });
      expect(second.status).toBe(409);
      expect(second.body.message).toContain('duplicate@example.com');
      expect(second.body.message).toContain('open invitation');

      // Exactly one live row exists.
      const rows = await superuserPool.query(
        `SELECT COUNT(*)::int AS n FROM tenant_member
         WHERE tenant_id = $1 AND email = 'duplicate@example.com' AND status IN ('active','invited')`,
        [API_TENANT_A],
      );
      expect(rows.rows[0].n).toBe(1);
    });

    it('refuses an admin inviting an owner (no self-escalation)', async () => {
      // The PATCH door refused this and the invite door did not: acceptance
      // keeps the invited role, and a second owner row let the admin then
      // demote or remove the real one (0137 T3 (a)).
      const response = await request
        .post(`/api/tenants/${API_TENANT_A}/members`)
        .set('Authorization', `Bearer ${TOKEN_ADMIN_A}`)
        .send({ email: 'escalate@example.com', role: 'owner' });

      expect(response.status).toBe(403);
      const rows = await superuserPool.query(
        `SELECT COUNT(*)::int AS n FROM tenant_member WHERE tenant_id = $1 AND email = 'escalate@example.com'`,
        [API_TENANT_A],
      );
      expect(rows.rows[0].n).toBe(0);
    });

    it('lets an owner invite an owner, and the invitation is not a second owner (0137 T3 (b))', async () => {
      // This row stays for the rest of the file, beside the last-owner cases
      // below. It counted as a second owner until T3 (b): with it, the old
      // count read two and let the sole active owner be demoted.
      const response = await request
        .post(`/api/tenants/${API_TENANT_A}/members`)
        .set('Authorization', `Bearer ${TOKEN_OWNER_A}`)
        .send({ email: 'second-owner@example.com', role: 'owner' });

      expect(response.status).toBe(201);
      expect(response.body.role).toBe('owner');
      expect(response.body.status).toBe('invited');
    });

    it('should prevent member role from inviting members', async () => {
      const response = await request
        .post(`/api/tenants/${API_TENANT_A}/members`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_A}`)
        .send({
          email: 'hacker@example.com',
          role: 'admin',
        });

      expect(response.status).toBe(403);
    });

    it('should prevent tenant B from adding members to tenant A', async () => {
      const response = await request
        .post(`/api/tenants/${API_TENANT_A}/members`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_B}`)
        .send({
          email: 'hacker@example.com',
          role: 'member',
        });

      // Should fail because tenant B is not a member of tenant A
      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/tenants/:tenantId/members/:memberId', () => {
    it('should get member details for authenticated tenant', async () => {
      const response = await request
        .get(`/api/tenants/${API_TENANT_A}/members/${memberAId}`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_A}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(memberAId);
      expect(response.body.email).toBe('member@example.com');
    });

    it('should return 404 for tenant B accessing tenant A member', async () => {
      const response = await request
        .get(`/api/tenants/${API_TENANT_A}/members/${memberAId}`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_B}`);

      // RLS should filter out tenant A's member
      expect(response.status).toBe(404);
    });
  });

  describe('PATCH /api/tenants/:tenantId/members/:memberId', () => {
    it('should update member role as admin', async () => {
      const response = await request
        .patch(`/api/tenants/${API_TENANT_A}/members/${memberAId}`)
        .set('Authorization', `Bearer ${TOKEN_ADMIN_A}`)
        .send({
          role: 'admin',
        });

      expect(response.status).toBe(200);
      expect(response.body.role).toBe('admin');
    });

    it('should prevent member from updating roles', async () => {
      // Reset member role first
      await superuserPool.query(`
        UPDATE tenant_member SET role = 'member' WHERE id = $1
      `, [memberAId]);

      const response = await request
        .patch(`/api/tenants/${API_TENANT_A}/members/${memberAId}`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_A}`)
        .send({
          role: 'admin',
        });

      expect(response.status).toBe(403);
    });

    it('should prevent tenant B from updating tenant A members', async () => {
      const response = await request
        .patch(`/api/tenants/${API_TENANT_A}/members/${memberAId}`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_B}`)
        .send({
          role: 'owner',
        });

      expect(response.status).toBe(403);
    });

    it('should prevent demoting the last owner (would orphan the tenant)', async () => {
      // ownerAId is the sole ACTIVE owner; demoting them must be rejected. The
      // owner invitation the POST cases left does not count (0137 T3 (b)).
      const response = await request
        .patch(`/api/tenants/${API_TENANT_A}/members/${ownerAId}`)
        .set('Authorization', `Bearer ${TOKEN_OWNER_A}`)
        .send({ role: 'admin' });

      // To admin, and the sentence asserted: a demotion to `member` would now
      // answer 400 for its role (0137 T7) before this guard is reached.
      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Cannot demote the last owner');
    });

    it('should prevent an admin from granting the owner role (no self-escalation)', async () => {
      const response = await request
        .patch(`/api/tenants/${API_TENANT_A}/members/${memberAId}`)
        .set('Authorization', `Bearer ${TOKEN_ADMIN_A}`)
        .send({ role: 'owner' });

      expect(response.status).toBe(403);
    });
  });

  describe('DELETE /api/tenants/:tenantId/members/:memberId', () => {
    it('should remove member as admin', async () => {
      // Create a new member to delete
      const newMember = await superuserPool.query(`
        INSERT INTO tenant_member (id, tenant_id, user_id, email, role, status)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `, [
        randomUUID(),
        API_TENANT_A,
        'user-to-delete',
        'todelete@example.com',
        'member',
        'active',
      ]);

      const memberId = newMember.rows[0].id;

      const response = await request
        .delete(`/api/tenants/${API_TENANT_A}/members/${memberId}`)
        .set('Authorization', `Bearer ${TOKEN_OWNER_A}`);

      expect(response.status).toBe(204);

      // Verify member is deleted
      const verifyResponse = await request
        .get(`/api/tenants/${API_TENANT_A}/members/${memberId}`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_A}`);
      
      expect(verifyResponse.status).toBe(404);
    });

    it('should prevent removing the last owner', async () => {
      // Try to delete the only owner (ownerAId is the sole owner). The owner
      // asks about themselves, so the self-removal guard answers first; the
      // only active owner removed by somebody else is in the 0137 T3 block.
      const response = await request
        .delete(`/api/tenants/${API_TENANT_A}/members/${ownerAId}`)
        .set('Authorization', `Bearer ${TOKEN_OWNER_A}`);

      // Should fail because it's the last owner
      expect(response.status).toBe(400);
    });

    it('should prevent tenant B from deleting tenant A members', async () => {
      const response = await request
        .delete(`/api/tenants/${API_TENANT_A}/members/${memberAId}`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_B}`);

      expect(response.status).toBe(403);
    });
  });

  /**
   * THE OWNER ROLE ON EVERY DOOR (workplan 0137 T3 (b) and (c); the owner chose
   * both together on 2026-10-04).
   *
   * (b) Only an ACTIVE owner counts, and only an active owner is protected as
   * the last one: an invitation as owner and a declined one hold no power. The
   * count and the write are one transaction, with the owner rows locked.
   * (c) Only an owner can demote or remove an owner; an admin gets 403. Who is
   * an owner is read from the same locked rows, so an owner demoted or removed
   * while their request waited is refused as an admin would be.
   *
   * Each case gets an organisation of its own, so a case the old route let
   * through (a demotion, a removal) leaves nothing behind for the next one. A
   * person's subject is `<key>-<tenant>`; an invitation's is a `pending:`
   * placeholder, as the invite route writes it.
   */
  describe('the owner role on every door (0137 T3)', () => {
    type Person = { role: 'owner' | 'admin'; status: 'active' | 'invited' | 'declined' };
    type Organisation = {
      tenantId: string;
      ids: Record<string, string>;
      tokens: Record<string, string>;
    };
    const ACTIVE_OWNER: Person = { role: 'owner', status: 'active' };
    const INVITED_OWNER: Person = { role: 'owner', status: 'invited' };
    const DECLINED_OWNER: Person = { role: 'owner', status: 'declined' };
    const ACTIVE_ADMIN: Person = { role: 'admin', status: 'active' };
    const made: string[] = [];

    async function organisation(people: Record<string, Person>): Promise<Organisation> {
      const tenantId = randomUUID();
      made.push(tenantId);
      await superuserPool.query(
        `INSERT INTO tenant (id, name, status, settings) VALUES ($1, $2, 'active', '{}')`,
        [tenantId, `Owner guard ${tenantId.slice(0, 8)}`],
      );
      const ids: Record<string, string> = {};
      const tokens: Record<string, string> = {};
      for (const [key, person] of Object.entries(people)) {
        const sub = person.status === 'invited' ? `pending:${randomUUID()}` : `${key}-${tenantId}`;
        const { rows } = await superuserPool.query(
          `INSERT INTO tenant_member (tenant_id, user_id, email, role, status)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [tenantId, sub, `${key}@owner-guard.test`, person.role, person.status],
        );
        ids[key] = rows[0].id;
        tokens[key] = createTestToken(tenantId, person.role, sub);
      }
      return { tenantId, ids, tokens };
    }

    const patch = (org: Organisation, as: string, target: string, role: string) =>
      request
        .patch(`/api/tenants/${org.tenantId}/members/${org.ids[target]}`)
        .set('Authorization', `Bearer ${org.tokens[as]}`)
        .send({ role });

    const remove = (org: Organisation, as: string, target: string) =>
      request
        .delete(`/api/tenants/${org.tenantId}/members/${org.ids[target]}`)
        .set('Authorization', `Bearer ${org.tokens[as]}`);

    async function activeOwners(tenantId: string): Promise<number> {
      const { rows } = await superuserPool.query(
        `SELECT COUNT(*)::int AS n FROM tenant_member
         WHERE tenant_id = $1 AND role = 'owner' AND status = 'active'`,
        [tenantId],
      );
      return rows[0].n;
    }

    async function rowOf(memberId: string): Promise<{ role: string; status: string } | undefined> {
      const { rows } = await superuserPool.query(
        `SELECT role, status FROM tenant_member WHERE id = $1`,
        [memberId],
      );
      return rows[0];
    }

    async function removals(tenantId: string): Promise<number> {
      const { rows } = await superuserPool.query(
        `SELECT COUNT(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND action = 'member.removed'`,
        [tenantId],
      );
      return rows[0].n;
    }

    /** Wait until `n` backends wait on `holderPid`'s locks, directly or queued behind each other. */
    async function waitUntilQueued(holderPid: number, n: number): Promise<void> {
      const deadline = Date.now() + 20_000;
      for (;;) {
        const { rows } = await superuserPool.query<{ pid: number; blockers: number[] }>(
          `SELECT pid, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
           WHERE wait_event_type = 'Lock'`,
        );
        const behind = new Set([holderPid]);
        for (let grew = true; grew; ) {
          grew = false;
          for (const row of rows) {
            if (!behind.has(row.pid) && row.blockers.some((pid) => behind.has(pid))) {
              behind.add(row.pid);
              grew = true;
            }
          }
        }
        if (behind.size - 1 >= n) return;
        if (Date.now() > deadline) {
          throw new Error(`${behind.size - 1} of ${n} requests waited behind the held owner rows`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }

    /**
     * Two requests at once, as two owners pressing at the same moment arrive:
     * both past `authenticate` as owners before either writes. The test holds
     * the organisation's owner rows locked on a connection of its own until
     * both requests wait behind that lock, then lets go. The old route read
     * its count outside any lock, so both counts read two and both writes
     * landed. The new one counts inside the lock, so the second request counts
     * after the first has written.
     *
     * `meanwhile` runs on the holder's connection once the requests wait, and
     * commits with it: another owner's write landing first, in a known order.
     */
    async function atOnce(
      tenantId: string,
      sends: ReadonlyArray<() => PromiseLike<supertest.Response>>,
      meanwhile?: (holder: PoolClient) => Promise<unknown>,
    ): Promise<supertest.Response[]> {
      const holder = await superuserPool.connect();
      let held = false;
      try {
        await holder.query('BEGIN');
        held = true;
        await holder.query(
          `SELECT id FROM tenant_member WHERE tenant_id = $1 AND role = 'owner' FOR UPDATE`,
          [tenantId],
        );
        const holderPid: number = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        const answers = sends.map((send) => Promise.resolve(send()));
        for (const answer of answers) answer.catch(() => undefined);
        await waitUntilQueued(holderPid, answers.length);
        if (meanwhile) await meanwhile(holder);
        await holder.query('COMMIT');
        held = false;
        return await Promise.all(answers);
      } finally {
        if (held) await holder.query('ROLLBACK').catch(() => undefined);
        holder.release();
      }
    }

    afterAll(async () => {
      await superuserPool.query(`DELETE FROM tenant WHERE id = ANY($1::uuid[])`, [made]);
    });

    // (b): only an active owner counts.

    it('refuses demoting the only active owner while an owner invitation is pending', async () => {
      const org = await organisation({ owner: ACTIVE_OWNER, invited: INVITED_OWNER });

      const response = await patch(org, 'owner', 'owner', 'admin');

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Cannot demote the last owner');
      expect(await activeOwners(org.tenantId)).toBe(1);
    });

    it('refuses demoting the only active owner while a declined owner row exists', async () => {
      const org = await organisation({ owner: ACTIVE_OWNER, declined: DECLINED_OWNER });

      const response = await patch(org, 'owner', 'owner', 'admin');

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Cannot demote the last owner');
      expect(await activeOwners(org.tenantId)).toBe(1);
    });

    it('lets the one active owner withdraw an invitation as owner', async () => {
      // What stops (b) from counting too little: the invitation is not an
      // owner, so withdrawing it is not removing the last one.
      const org = await organisation({ owner: ACTIVE_OWNER, invited: INVITED_OWNER });

      const response = await remove(org, 'owner', 'invited');

      expect(response.status).toBe(204);
      expect(await rowOf(org.ids.invited!)).toBeUndefined();
      expect(await removals(org.tenantId)).toBe(1);
      expect(await activeOwners(org.tenantId)).toBe(1);
    });

    it("lets the one active owner change an invitation as owner's role", async () => {
      // The PATCH twin of the withdrawal above: the invitation is not an
      // owner, so changing it is not demoting the last one.
      const org = await organisation({ owner: ACTIVE_OWNER, invited: INVITED_OWNER });

      const response = await patch(org, 'owner', 'invited', 'admin');

      expect(response.status).toBe(200);
      expect(await rowOf(org.ids.invited!)).toEqual({ role: 'admin', status: 'invited' });
      expect(await activeOwners(org.tenantId)).toBe(1);
    });

    it('lets the one active owner remove a declined owner row', async () => {
      const org = await organisation({ owner: ACTIVE_OWNER, declined: DECLINED_OWNER });

      const response = await remove(org, 'owner', 'declined');

      expect(response.status).toBe(204);
      expect(await rowOf(org.ids.declined!)).toBeUndefined();
      expect(await activeOwners(org.tenantId)).toBe(1);
    });

    // (c): only an owner can demote or remove an owner.

    it("refuses an admin's demotion of an owner, though another active owner would remain", async () => {
      const org = await organisation({ first: ACTIVE_OWNER, second: ACTIVE_OWNER, admin: ACTIVE_ADMIN });

      const response = await patch(org, 'admin', 'second', 'admin');

      expect(response.status).toBe(403);
      expect(response.body.message).toBe("Only an owner can change an owner's role");
      expect(await rowOf(org.ids.second!)).toEqual({ role: 'owner', status: 'active' });
    });

    it("refuses an admin's demotion of the only active owner while an owner invitation is pending: 403 before the count", async () => {
      // The PATCH twin of the removal below. The old count read two here.
      const org = await organisation({ owner: ACTIVE_OWNER, invited: INVITED_OWNER, admin: ACTIVE_ADMIN });

      const response = await patch(org, 'admin', 'owner', 'admin');

      expect(response.status).toBe(403);
      expect(response.body.message).toBe("Only an owner can change an owner's role");
      expect(await activeOwners(org.tenantId)).toBe(1);
    });

    it("refuses an admin's change to an invitation as owner: the grant is an owner's", async () => {
      const org = await organisation({ owner: ACTIVE_OWNER, invited: INVITED_OWNER, admin: ACTIVE_ADMIN });

      const response = await patch(org, 'admin', 'invited', 'admin');

      expect(response.status).toBe(403);
      expect(response.body.message).toBe("Only an owner can change an owner's role");
      expect(await rowOf(org.ids.invited!)).toEqual({ role: 'owner', status: 'invited' });
    });

    it("refuses an admin's removal of an owner, though another active owner would remain", async () => {
      const org = await organisation({ first: ACTIVE_OWNER, second: ACTIVE_OWNER, admin: ACTIVE_ADMIN });

      const response = await remove(org, 'admin', 'second');

      expect(response.status).toBe(403);
      expect(response.body.message).toBe('Only an owner can remove an owner');
      expect(await rowOf(org.ids.second!)).toEqual({ role: 'owner', status: 'active' });
      expect(await removals(org.tenantId)).toBe(0);
    });

    it("refuses an admin's removal of the only active owner while an owner invitation is pending", async () => {
      // The old count read two here, and the organisation was left with no
      // active owner.
      const org = await organisation({ owner: ACTIVE_OWNER, invited: INVITED_OWNER, admin: ACTIVE_ADMIN });

      const response = await remove(org, 'admin', 'owner');

      expect(response.status).toBe(403);
      expect(await activeOwners(org.tenantId)).toBe(1);
    });

    it("refuses an admin's withdrawal of an invitation as owner: the grant is an owner's", async () => {
      const org = await organisation({ owner: ACTIVE_OWNER, invited: INVITED_OWNER, admin: ACTIVE_ADMIN });

      const response = await remove(org, 'admin', 'invited');

      expect(response.status).toBe(403);
      expect(await rowOf(org.ids.invited!)).toEqual({ role: 'owner', status: 'invited' });
    });

    it('still lets an admin remove an admin', async () => {
      const org = await organisation({ owner: ACTIVE_OWNER, admin: ACTIVE_ADMIN, other: ACTIVE_ADMIN });

      const response = await remove(org, 'admin', 'other');

      expect(response.status).toBe(204);
      expect(await rowOf(org.ids.other!)).toBeUndefined();
    });

    // (b)'s lock: two at once cannot both pass.

    it('two owners demoting each other at once: one passes, and an active owner remains', async () => {
      // The loser was demoted by the winner while it waited, so it is no
      // longer an owner when its turn comes.
      const org = await organisation({ first: ACTIVE_OWNER, second: ACTIVE_OWNER });

      const answers = await atOnce(org.tenantId, [
        () => patch(org, 'first', 'second', 'admin'),
        () => patch(org, 'second', 'first', 'admin'),
      ]);

      expect(answers.map((a) => a.status).sort()).toEqual([200, 403]);
      expect(answers.find((a) => a.status === 403)!.body.message).toBe("Only an owner can change an owner's role");
      expect(await activeOwners(org.tenantId)).toBe(1);
    });

    it('two owners removing each other at once, with an owner invitation pending: one passes, and an active owner remains', async () => {
      // The loser was removed by the winner while it waited, and the pending
      // invitation beside the winner does not count.
      const org = await organisation({ first: ACTIVE_OWNER, second: ACTIVE_OWNER, invited: INVITED_OWNER });

      const answers = await atOnce(org.tenantId, [
        () => remove(org, 'first', 'second'),
        () => remove(org, 'second', 'first'),
      ]);

      expect(answers.map((a) => a.status).sort()).toEqual([204, 403]);
      expect(answers.find((a) => a.status === 403)!.body.message).toBe('Only an owner can remove an owner');
      expect(await activeOwners(org.tenantId)).toBe(1);
      expect(await rowOf(org.ids.invited!)).toEqual({ role: 'owner', status: 'invited' });
      expect(await removals(org.tenantId)).toBe(1);
    });

    // Who is an owner is read from the locked rows, not from `authenticate`
    // (review of 2026-10-04). Each case holds the owner rows, sends one
    // owner's request, and demotes or removes that owner on the holder's
    // connection, as another owner's request landing first would. With three
    // owners the last-owner count never stops it, so only this does.

    it('an owner demoted while their demotion of another owner waits is refused', async () => {
      const org = await organisation({ first: ACTIVE_OWNER, second: ACTIVE_OWNER, third: ACTIVE_OWNER });

      const [answer] = await atOnce(org.tenantId, [() => patch(org, 'second', 'third', 'admin')], (holder) =>
        holder.query(`UPDATE tenant_member SET role = 'admin' WHERE id = $1`, [org.ids.second]),
      );

      expect(answer!.status).toBe(403);
      expect(answer!.body.message).toBe("Only an owner can change an owner's role");
      expect(await rowOf(org.ids.third!)).toEqual({ role: 'owner', status: 'active' });
    });

    it('an owner removed while their removal of another owner waits is refused, and nothing is recorded', async () => {
      const org = await organisation({ first: ACTIVE_OWNER, second: ACTIVE_OWNER, third: ACTIVE_OWNER });

      const [answer] = await atOnce(org.tenantId, [() => remove(org, 'second', 'third')], (holder) =>
        holder.query(`DELETE FROM tenant_member WHERE id = $1`, [org.ids.second]),
      );

      expect(answer!.status).toBe(403);
      expect(answer!.body.message).toBe('Only an owner can remove an owner');
      expect(await rowOf(org.ids.third!)).toEqual({ role: 'owner', status: 'active' });
      expect(await removals(org.tenantId)).toBe(0);
    });

    it('an owner demoted while their making themselves owner again waits is refused', async () => {
      // Two owners: the second's request would undo the first's demotion of it.
      const org = await organisation({ first: ACTIVE_OWNER, second: ACTIVE_OWNER });

      const [answer] = await atOnce(org.tenantId, [() => patch(org, 'second', 'second', 'owner')], (holder) =>
        holder.query(`UPDATE tenant_member SET role = 'admin' WHERE id = $1`, [org.ids.second]),
      );

      expect(answer!.status).toBe(403);
      expect(answer!.body.message).toBe('Only an owner can grant the owner role');
      expect(await rowOf(org.ids.second!)).toEqual({ role: 'admin', status: 'active' });
      expect(await activeOwners(org.tenantId)).toBe(1);
    });

    it('finds a member by an id written in capitals, as the database and GET do', async () => {
      // The database compares uuids, not strings, and so does the lock.
      const org = await organisation({ owner: ACTIVE_OWNER, admin: ACTIVE_ADMIN, other: ACTIVE_ADMIN });
      const capitals = (key: string) => `/api/tenants/${org.tenantId}/members/${org.ids[key]!.toUpperCase()}`;
      const asOwner = `Bearer ${org.tokens.owner}`;

      expect((await request.get(capitals('admin')).set('Authorization', asOwner)).status).toBe(200);
      const changed = await request.patch(capitals('admin')).set('Authorization', asOwner).send({ role: 'admin' });
      expect(changed.status).toBe(200);
      const removed = await request.delete(capitals('other')).set('Authorization', asOwner);
      expect(removed.status).toBe(204);
      expect(await rowOf(org.ids.other!)).toBeUndefined();
    });
  });
});
