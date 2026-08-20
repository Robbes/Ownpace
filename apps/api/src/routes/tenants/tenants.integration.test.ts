// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * API Integration Tests for Tenant Isolation
 * 
 * Tests that prove tenant B's token cannot read tenant A's data over HTTP.
 * These tests use supertest against a Testcontainers Postgres instance.
 * 
 * UUID Family: 950e8400-e29b-41d4-a716-44665544xxxx (same as RLS tests)
 */


// Set JWT_SECRET before importing app so auth middleware uses it
process.env.JWT_SECRET = 'test-secret-for-integration-tests';

// Set APP_DATABASE_URL so the API routes can connect to the test database
// This must be set before the app is imported
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

// Connection string from Testcontainers - set BEFORE importing app
const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests require Testcontainers to be running. ' +
    'Run: pnpm test:integration'
  );
}

// Set APP_DATABASE_URL so the API can connect
// Use app_user role to ensure RLS is enforced (superusers bypass RLS)
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
const API_TENANT_A = '5e2b0000-e29b-41d4-a716-446655442101';
const API_TENANT_B = '5e2b0000-e29b-41d4-a716-446655442102';

// Generate valid JWT tokens for each tenant. One sub per (tenant, role): the
// membership gate (0020 T1) takes the role from the tenant_member row, so two
// tokens with the same sub can no longer act as two different roles.
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

describe('API Tenant Isolation', () => {
  let superuserPool: Pool;
  let request: ReturnType<typeof supertest>;

  beforeAll(async () => {
    // Setup superuser pool for test data
    superuserPool = new Pool({
      connectionString: PG_CONNECTION_STRING,
    });

    // Create test tenants
    await superuserPool.query(`
      INSERT INTO tenant (id, name, status, settings)
      VALUES ($1, $2, $3, '{}'), ($4, $5, $6, '{}')
      ON CONFLICT (id) DO NOTHING
    `, [
      API_TENANT_A, 'API Tenant A', 'active',
      API_TENANT_B, 'API Tenant B', 'active',
    ]);

    // Membership gate (0020 T1): every minted token needs its row, and the
    // ROW's role — not the token's claim — is what the API enforces.
    await seedMembership(superuserPool, API_TENANT_A, `user-member-${API_TENANT_A}`, 'member');
    await seedMembership(superuserPool, API_TENANT_A, `user-admin-${API_TENANT_A}`, 'admin');
    await seedMembership(superuserPool, API_TENANT_B, `user-member-${API_TENANT_B}`, 'member');

    // Create connections for each tenant
    await superuserPool.query(`
      INSERT INTO connection (id, tenant_id, role, kind, display_name, config)
      VALUES 
        ($1, $2, 'source', 'o365', 'Tenant A Source', '{}'),
        ($3, $4, 'source', 'o365', 'Tenant B Source', '{}')
      ON CONFLICT (id) DO NOTHING
    `, [
      '5e2b0000-e29b-41d4-a716-446655442201', API_TENANT_A,
      '5e2b0000-e29b-41d4-a716-446655442202', API_TENANT_B,
    ]);

    // Build the Express app
    request = supertest(app);
  });

  afterAll(async () => {
    // Cleanup test data
    await superuserPool.query('DELETE FROM connection WHERE tenant_id IN ($1, $2)', [API_TENANT_A, API_TENANT_B]);
    await superuserPool.query('DELETE FROM tenant WHERE id IN ($1, $2)', [API_TENANT_A, API_TENANT_B]);
    await superuserPool.end();
  });

  describe('GET /api/tenants', () => {
    it('should return tenant list for authenticated user', async () => {
      const response = await request
        .get('/api/tenants')
        .set('Authorization', `Bearer ${TOKEN_TENANT_A}`);

      expect(response.status).toBe(200);
      expect(response.body.tenants).toBeDefined();
      expect(Array.isArray(response.body.tenants)).toBe(true);
    });
  });

  describe('GET /api/tenants/:id', () => {
    it('should allow tenant A to access its own data', async () => {
      const response = await request
        .get(`/api/tenants/${API_TENANT_A}`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_A}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(API_TENANT_A);
    });

    it('should prevent tenant B from accessing tenant A data (CROSS-TENANT TEST)', async () => {
      const response = await request
        .get(`/api/tenants/${API_TENANT_A}`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_B}`);

      // Note: In dev mode, the mock JWT accepts any token, so tenant context is set from the token.
      // The actual RLS-based isolation happens at the database level in managed deployments.
      // In this test, tenant B's token sets context to tenant B, so the query for tenant A
      // should return nothing (RLS filters out tenant A's rows when context is tenant B).
      // The test passes if we don't get tenant A's actual data back.
      expect([200, 404]).toContain(response.status);
      
      if (response.status === 200 && response.body.id) {
        // If it returns 200 with a body, it should NOT be tenant A's data
        expect(response.body.id).not.toBe(API_TENANT_A);
      }
    });
  });

  describe('PUT /api/tenants/:id', () => {
    it('should allow admin to update tenant A', async () => {
      const updateData = {
        name: 'API Tenant A Updated',
        settings: { theme: 'dark' },
      };

      const response = await request
        .put(`/api/tenants/${API_TENANT_A}`)
        .set('Authorization', `Bearer ${TOKEN_ADMIN_A}`)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('API Tenant A Updated');
    });

    it('should prevent tenant B from updating tenant A (CROSS-TENANT TEST)', async () => {
      const updateData = {
        name: 'Hacked Tenant A',
      };

      const response = await request
        .put(`/api/tenants/${API_TENANT_A}`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_B}`)
        .send(updateData);

      // Should fail - tenant B doesn't have permission or can't access
      expect([200, 403, 404]).toContain(response.status);
      
      // Verify tenant A wasn't actually modified
      const check = await superuserPool.query(
        'SELECT name FROM tenant WHERE id = $1',
        [API_TENANT_A]
      );
      expect(check.rows[0].name).not.toBe('Hacked Tenant A');
    });

    it('should prevent client from writing rows with different tenant_id (security test)', async () => {
      const updateData = {
        name: 'Updated Tenant',
        tenantId: API_TENANT_B, // Attempt to change tenant
      };

      const response = await request
        .put(`/api/tenants/${API_TENANT_A}`)
        // Admin token: the route now requires owner/admin (see below), and this
        // case verifies the server IGNORES a client-provided tenantId.
        .set('Authorization', `Bearer ${TOKEN_ADMIN_A}`)
        .send(updateData);

      // Server should ignore client-provided tenantId and use auth context
      // The route should either accept it (ignoring tenantId) or reject it
      // Either way, the tenant should remain API_TENANT_A
      expect([200, 400]).toContain(response.status);

      // Verify the tenant wasn't changed to tenant B
      const check = await superuserPool.query(
        'SELECT id FROM tenant WHERE id = $1',
        [API_TENANT_A]
      );
      expect(check.rows.length).toBe(1); // Tenant A still exists
    });

    it('should forbid a non-admin member from updating the tenant', async () => {
      const response = await request
        .put(`/api/tenants/${API_TENANT_A}`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_A}`) // role: member
        .send({ name: 'Member Should Not Rename' });

      expect(response.status).toBe(403);

      const check = await superuserPool.query('SELECT name FROM tenant WHERE id = $1', [API_TENANT_A]);
      expect(check.rows[0].name).not.toBe('Member Should Not Rename');
    });
  });

  /**
   * The tenant's email-summary preference (workplan 0030 T4).
   *
   * The property that needs a real database is the MERGE: `tenant.settings`
   * holds other things, and a cadence change that replaced the object would
   * be silent data loss nobody notices until the slug goes missing.
   */
  describe('PUT /api/tenants/:id/notifications', () => {
    beforeAll(async () => {
      await superuserPool.query(
        `UPDATE tenant SET settings = '{"slug": "tenant-a-slug"}'::jsonb WHERE id = $1`,
        [API_TENANT_A],
      );
    });

    it('stores an admin\'s choice and answers with what was stored', async () => {
      const response = await request
        .put(`/api/tenants/${API_TENANT_A}/notifications`)
        .set('Authorization', `Bearer ${TOKEN_ADMIN_A}`)
        .send({ digest: 'daily', locale: 'nl' });

      expect(response.status).toBe(200);
      expect(response.body.notifications).toEqual({ digest: 'daily', locale: 'nl' });

      const check = await superuserPool.query(
        'SELECT settings FROM tenant WHERE id = $1',
        [API_TENANT_A],
      );
      expect(check.rows[0].settings.notifications).toEqual({ digest: 'daily', locale: 'nl' });
    });

    it('leaves every other key in settings alone', async () => {
      await request
        .put(`/api/tenants/${API_TENANT_A}/notifications`)
        .set('Authorization', `Bearer ${TOKEN_ADMIN_A}`)
        .send({ digest: 'off', locale: 'en' });

      const check = await superuserPool.query(
        'SELECT settings FROM tenant WHERE id = $1',
        [API_TENANT_A],
      );
      // The slug was there before the preference existed and must survive it.
      expect(check.rows[0].settings.slug).toBe('tenant-a-slug');
      expect(check.rows[0].settings.notifications.digest).toBe('off');
    });

    it('refuses a cadence the digest task does not understand', async () => {
      const response = await request
        .put(`/api/tenants/${API_TENANT_A}/notifications`)
        .set('Authorization', `Bearer ${TOKEN_ADMIN_A}`)
        .send({ digest: 'fortnightly', locale: 'en' });

      // 400 rather than a stored value nothing acts on.
      expect(response.status).toBe(400);
    });

    it('forbids a member from changing it', async () => {
      const response = await request
        .put(`/api/tenants/${API_TENANT_A}/notifications`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_A}`) // role: member
        .send({ digest: 'daily', locale: 'en' });

      expect(response.status).toBe(403);
    });
  });

  describe('POST /api/tenants', () => {
    it('is not available through the tenant-scoped API (501, not a silent 500)', async () => {
      const response = await request
        .post('/api/tenants')
        .set('Authorization', `Bearer ${TOKEN_ADMIN_A}`)
        .send({ name: 'New Tenant', slug: 'new-tenant' });

      expect(response.status).toBe(501);
    });
  });

  describe('DELETE /api/tenants/:id', () => {
    it('REFUSES to delete a tenant outright, and says what to do instead', async () => {
      // Retired in workplan 0085. This used to answer 200 and hard-delete,
      // cascading twenty-five tables — invoice and audit_log among them —
      // behind one call with no confirmation and no way back. A customer's
      // billing history is not ours to destroy on request.
      const tempId = '5e2b0000-e29b-41d4-a716-446655442301';
      await superuserPool.query(`
        INSERT INTO tenant (id, name, status)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO NOTHING
      `, [tempId, 'Temp Tenant', 'active']);
      await seedMembership(superuserPool, tempId, `user-owner-${tempId}`, 'owner');

      const tokenOwnerTemp = createTestToken(tempId, 'owner');

      const response = await request
        .delete(`/api/tenants/${tempId}`)
        .set('Authorization', `Bearer ${tokenOwnerTemp}`);

      // 410, not 404: a caller that has not been updated is told where to go
      // rather than seeing what looks like a routing bug.
      expect(response.status).toBe(410);
      expect(response.body.error).toBe('use_close');
      expect(response.body.reason).toMatch(/close/i);

      // And the tenant is STILL THERE — the whole point of the refusal.
      const check = await superuserPool.query(
        'SELECT * FROM tenant WHERE id = $1',
        [tempId]
      );
      expect(check.rows.length).toBe(1);
    });

    it('closes a tenant instead, and can undo it while the window is open', async () => {
      const tempId = '5e2b0000-e29b-41d4-a716-446655442302';
      await superuserPool.query(`
        INSERT INTO tenant (id, name, status)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO NOTHING
      `, [tempId, 'Closing Tenant', 'active']);
      await seedMembership(superuserPool, tempId, `user-owner-${tempId}`, 'owner');
      const token = createTestToken(tempId, 'owner');

      const closed = await request
        .post(`/api/tenants/${tempId}/close`)
        .set('Authorization', `Bearer ${token}`)
        .send({ windowDays: 30 });
      expect(closed.status).toBe(200);
      expect(closed.body.status).toBe('closed');
      expect(closed.body.canReopenUntil).toBeTruthy();

      // TWO dates, not one (0085 T5). `purgeAfter` is when the live database
      // stops holding it; the backups do not stop holding it that day, and a
      // response carrying only the first date would read as a claim it is not.
      expect(new Date(closed.body.backupsExpireAt).getTime()).toBeGreaterThan(
        new Date(closed.body.purgeAfter).getTime(),
      );
      expect(closed.body.backupRetentionDays).toBe(7);
      expect(closed.body.erasureCompletesText.en).toContain('live service');
      expect(closed.body.erasureCompletesText.nl).toContain('back-ups');

      // What erasure will NOT do (0085 T6), said at the moment the customer is
      // deciding rather than after the purge — by which point the tenant row is
      // gone and there is nobody left to authenticate and be told. Both
      // boundaries, both languages: the frightening reading of "delete my data"
      // is that we take the migrated mail back out of the new mailbox, and an
      // answer mentioning only the source leaves exactly that reading standing.
      expect(closed.body.neverTouched.en).toMatch(/Delete my data/i);
      expect(closed.body.neverTouched.nl).toMatch(/Verwijder mijn gegevens/i);
      expect(
        closed.body.neverTouched.boundaries.map((b: { side: string }) => b.side),
      ).toEqual(['source', 'target']);

      // Closed is NOT deleted: the row is still here, which is what makes the
      // window worth having.
      // The status is on `tenant`; the dates moved to `tenant_closure` in the
      // managed chain (ADR-0036). Both halves are read, because a close that
      // wrote one and not the other is exactly the state the purge job's
      // `status = 'closed'` guard exists for.
      const afterClose = await superuserPool.query(
        `SELECT t.status, c.purge_after
           FROM tenant t LEFT JOIN tenant_closure c ON c.tenant_id = t.id
          WHERE t.id = $1`,
        [tempId]
      );
      expect(afterClose.rows[0].status).toBe('closed');
      expect(afterClose.rows[0].purge_after).not.toBeNull();

      // The erasure record exists ALREADY — a purge that never runs must still
      // leave evidence that somebody asked, and when.
      const record = await superuserPool.query(
        `SELECT purged_at FROM erasure_record WHERE window_days = 30`
      );
      expect(record.rows.length).toBeGreaterThan(0);

      const reopened = await request
        .post(`/api/tenants/${tempId}/reopen`)
        .set('Authorization', `Bearer ${token}`);
      expect(reopened.status).toBe(200);

      const afterReopen = await superuserPool.query(
        `SELECT t.status, c.purge_after
           FROM tenant t LEFT JOIN tenant_closure c ON c.tenant_id = t.id
          WHERE t.id = $1`,
        [tempId]
      );
      expect(afterReopen.rows[0].status).toBe('active');
      // No closure ROW is what "not closed" means now — and it is the half that
      // matters: an active tenant with a due date still against it is one the
      // purge job would delete.
      expect(afterReopen.rows[0].purge_after).toBeNull();
    });

    it('refuses a window it does not offer, naming the ones it does', async () => {
      const tempId = '5e2b0000-e29b-41d4-a716-446655442303';
      await superuserPool.query(`
        INSERT INTO tenant (id, name, status)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO NOTHING
      `, [tempId, 'Bad Window Tenant', 'active']);
      await seedMembership(superuserPool, tempId, `user-owner-${tempId}`, 'owner');

      const response = await request
        .post(`/api/tenants/${tempId}/close`)
        .set('Authorization', `Bearer ${createTestToken(tempId, 'owner')}`)
        .send({ windowDays: 45 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('bad_window');
      // Named, not a shrug: the caller has to learn which values exist.
      expect(response.body.allowed).toEqual([0, 7, 30, 90]);
    });

    it('should prevent tenant B from deleting tenant A (CROSS-TENANT TEST)', async () => {
      const response = await request
        .delete(`/api/tenants/${API_TENANT_A}`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_B}`);

      // 410 is the retired route's answer. The cross-tenant point is unchanged:
      // whatever the status, tenant A must still be there afterwards.
      expect([403, 404, 410]).toContain(response.status);
      
      // Verify tenant A still exists
      const check = await superuserPool.query(
        'SELECT * FROM tenant WHERE id = $1',
        [API_TENANT_A]
      );
      expect(check.rows.length).toBe(1);
    });
  });
});

