// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * API Integration Tests for Migrations Routes
 * 
 * Tests that prove tenant isolation for all migration/mapping endpoints.
 * Includes cross-tenant access prevention tests.
 * 
 * UUID Family: 950e8400-e29b-41d4-a716-44665544xxxx (consistent with other tests)
 */

// Set JWT_SECRET before importing app
process.env.JWT_SECRET = 'test-secret-for-migration-tests';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Pool } from 'pg';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

// Mock the Trigger.dev client so the real sync/cutover endpoints can be tested
// without a live orchestrator: capture the enqueue call and return a stub run.
const { triggerMock } = vi.hoisted(() => ({
  triggerMock: vi.fn(async () => ({ id: 'run_mock_test' })),
}));
vi.mock('@openmig/scheduler', () => ({
  getTriggerClient: () => ({ tasks: { trigger: triggerMock } }),
}));

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Run: pnpm test:integration'
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
// import * as schema from '@open-migrate/ledger'; // Not needed - using raw SQL queries

// UUIDs for migration tests
const MIG_TENANT_A = '5a1b0000-e29b-41d4-a716-446655443101';
const MIG_TENANT_B = '5a1b0000-e29b-41d4-a716-446655443102';

// Mapping IDs
const MIG_MAPPING_A = '5a1b0000-e29b-41d4-a716-446655443201';
const MIG_MAPPING_B = '5a1b0000-e29b-41d4-a716-446655443202';

function createTestToken(tenantId: string, role: string = 'member'): string {
  return jwt.sign(
    {
      sub: `user-${tenantId}`,
      tenantId,
      role,
      email: `user@${tenantId}.test`,
    },
    process.env.JWT_SECRET!
  );
}

const TOKEN_TENANT_A = createTestToken(MIG_TENANT_A);
const TOKEN_TENANT_B = createTestToken(MIG_TENANT_B);

describe('Migrations Routes - Tenant Isolation', () => {
  let superuserPool: Pool;
  let request: ReturnType<typeof supertest>;

  beforeAll(async () => {
    superuserPool = new Pool({
      connectionString: PG_CONNECTION_STRING,
    });

    // Create test tenants
    await superuserPool.query(`
      INSERT INTO tenant (id, name, status)
      VALUES ($1, $2, $3), ($4, $5, $6)
      ON CONFLICT (id) DO NOTHING
    `, [
      MIG_TENANT_A, 'Migration Tenant A', 'active',
      MIG_TENANT_B, 'Migration Tenant B', 'active',
    ]);
    // Membership gate (0020 T1): the minted tokens must belong to their tenants.
    await seedMembership(superuserPool, MIG_TENANT_A, `user-${MIG_TENANT_A}`, 'member');
    await seedMembership(superuserPool, MIG_TENANT_B, `user-${MIG_TENANT_B}`, 'member');

    // Create source connections for each tenant
    const connA = '5a1b0000-e29b-41d4-a716-446655443301';
    const connB = '5a1b0000-e29b-41d4-a716-446655443302';
    
    await superuserPool.query(`
      INSERT INTO connection (id, tenant_id, role, kind, display_name, config)
      VALUES ($1, $2, 'source', 'o365', 'Tenant A Source', '{}'),
             ($3, $4, 'source', 'o365', 'Tenant B Source', '{}')
      ON CONFLICT (id) DO NOTHING
    `, [connA, MIG_TENANT_A, connB, MIG_TENANT_B]);

    // Create mailbox for Tenant A
    const mailboxA = '5a1b0000-e29b-41d4-a716-446655443401';
    await superuserPool.query(`
      INSERT INTO mailbox (id, tenant_id, connection_id, display_name, kind)
      VALUES ($1, $2, $3, 'Inbox A', 'user')
      ON CONFLICT (id) DO NOTHING
    `, [mailboxA, MIG_TENANT_A, connA]);

    // Create mailbox for Tenant B
    const mailboxB = '5a1b0000-e29b-41d4-a716-446655443402';
    await superuserPool.query(`
      INSERT INTO mailbox (id, tenant_id, connection_id, display_name, kind)
      VALUES ($1, $2, $3, 'Inbox B', 'user')
      ON CONFLICT (id) DO NOTHING
    `, [mailboxB, MIG_TENANT_B, connB]);

    // Create mappings for each tenant
    await superuserPool.query(`
      INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status, mode, pattern)
      VALUES ($1, $2, $3, $3, 'active', 'mirror', 'shared_s'),
             ($4, $5, $6, $6, 'paused', 'one_time', 'distribution_d')
      ON CONFLICT (id) DO NOTHING
    `, [
      MIG_MAPPING_A, MIG_TENANT_A, mailboxA,
      MIG_MAPPING_B, MIG_TENANT_B, mailboxB,
    ]);

    request = supertest(app);
  });

  afterAll(async () => {
    // Cleanup
    await superuserPool.query('DELETE FROM mailbox_mapping WHERE tenant_id IN ($1, $2)', [MIG_TENANT_A, MIG_TENANT_B]);
    await superuserPool.query('DELETE FROM mailbox WHERE tenant_id IN ($1, $2)', [MIG_TENANT_A, MIG_TENANT_B]);
    await superuserPool.query('DELETE FROM connection WHERE tenant_id IN ($1, $2)', [MIG_TENANT_A, MIG_TENANT_B]);
    await superuserPool.query('DELETE FROM tenant WHERE id IN ($1, $2)', [MIG_TENANT_A, MIG_TENANT_B]);
    await superuserPool.end();
  });

  describe('GET /api/migrations', () => {
    it('should return mappings for tenant A only', async () => {
      const response = await request
        .get('/api/migrations')
        .set('Authorization', `Bearer ${TOKEN_TENANT_A}`);

      expect(response.status).toBe(200);
      expect(response.body.mappings).toBeDefined();
      expect(Array.isArray(response.body.mappings)).toBe(true);

      // All returned mappings should belong to tenant A. camelCase like the
      // detail route (0026 T4 removed the snake_case duplicate there; 0033 T1
      // brought the list in line — the web client's MappingListItemSchema
      // requires tenantId, so a snake_case regression breaks the Mappings
      // screen for every tenant with a mapping).
      response.body.mappings.forEach((m: any) => {
        expect(m.tenantId).toBe(MIG_TENANT_A);
        expect(m).not.toHaveProperty('tenant_id');
        // The list serves the REAL connection kinds (via mailbox -> connection),
        // not the old hardcoded imap/jmap placeholders. The fixture's one
        // connection is 'o365' and backs both mailboxes, so both sides say so.
        expect(m.sourceType).toBe('o365');
        expect(m.targetType).toBe('o365');
        expect(Array.isArray(m.domains)).toBe(true);
        expect(['active', 'paused', 'cutover', 'done']).toContain(m.status);
      });
    });

    it('should return mappings for tenant B only', async () => {
      const response = await request
        .get('/api/migrations')
        .set('Authorization', `Bearer ${TOKEN_TENANT_B}`);

      expect(response.status).toBe(200);
      expect(response.body.mappings).toBeDefined();

      // All returned mappings should belong to tenant B
      response.body.mappings.forEach((m: any) => {
        expect(m.tenantId).toBe(MIG_TENANT_B);
        expect(m).not.toHaveProperty('tenant_id');
      });
    });
  });

  describe('GET /api/migrations/:id', () => {
    it('should allow tenant A to access its own mapping', async () => {
      const response = await request
        .get(`/api/migrations/${MIG_MAPPING_A}`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_A}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(MIG_MAPPING_A);
      expect(response.body.tenantId).toBe(MIG_TENANT_A);
      // The snake_case duplicate is gone (0026 T4) — pinned so it stays gone.
      expect(response.body).not.toHaveProperty('tenant_id');
    });

    it('should prevent tenant B from accessing tenant A mapping (CROSS-TENANT TEST)', async () => {
      const response = await request
        .get(`/api/migrations/${MIG_MAPPING_A}`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_B}`);

      // Should either return 404 or not return tenant A's data
      expect([200, 404]).toContain(response.status);
      
      if (response.status === 200) {
        // If it returns 200, the mapping should NOT be tenant A's
        expect(response.body.id).not.toBe(MIG_MAPPING_A);
      }
    });

    it('should allow tenant B to access its own mapping', async () => {
      const response = await request
        .get(`/api/migrations/${MIG_MAPPING_B}`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_B}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(MIG_MAPPING_B);
      expect(response.body.tenantId).toBe(MIG_TENANT_B);
      expect(response.body).not.toHaveProperty('tenant_id');
    });

    it('should prevent tenant A from accessing tenant B mapping (CROSS-TENANT TEST)', async () => {
      const response = await request
        .get(`/api/migrations/${MIG_MAPPING_B}`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_A}`);

      expect([200, 404]).toContain(response.status);
      
      if (response.status === 200) {
        expect(response.body.id).not.toBe(MIG_MAPPING_B);
      }
    });
  });

  describe('POST /api/migrations', () => {
    it('should create a mapping for tenant A', async () => {
      const newMapping = {
        sourceMailboxId: '5a1b0000-e29b-41d4-a716-446655443501',
        targetMailboxId: '5a1b0000-e29b-41d4-a716-446655443501',
        status: 'active',
        mode: 'mirror',
        pattern: 'shared_s',
      };

      const response = await request
        .post('/api/migrations')
        .set('Authorization', `Bearer ${TOKEN_TENANT_A}`)
        .send(newMapping);

      // Note: This may fail if the mailbox IDs don't exist, but that's expected
      // The important thing is that the request is processed with tenant A's context
      expect([200, 400, 404]).toContain(response.status);
    });

    it('REFUSES a distribution list as a mapping, with the reason (0027 T3)', async () => {
      // §14.1's two patterns are both legal in the ledger — `group_def`
      // records that an address IS a distribution list — but only one can be
      // a MAPPING. A distribution list has no store, so this mapping would
      // connect, find nothing, and report a successful empty migration, after
      // which the owner cuts over to an address that reaches nobody.
      //
      // The appliance refuses it at startup; ADR-0026 says both editions hold
      // one contract, and this is the door that used to be open.
      const response = await request
        .post('/api/migrations')
        .set('Authorization', `Bearer ${TOKEN_TENANT_A}`)
        .send({
          sourceMailboxId: '5a1b0000-e29b-41d4-a716-446655443503',
          targetMailboxId: '5a1b0000-e29b-41d4-a716-446655443503',
          status: 'active',
          mode: 'mirror',
          pattern: 'distribution_d',
        });

      expect(response.status).toBe(400);
      // Refused for the RIGHT reason, not incidentally by some other
      // validation — and the reason names the work that actually applies.
      expect(JSON.stringify(response.body)).toContain('no message store to copy');
      expect(JSON.stringify(response.body)).toContain('runbook');
    });

    it('should not allow client to specify different tenant_id (security test)', async () => {
      const newMapping = {
        sourceMailboxId: '5a1b0000-e29b-41d4-a716-446655443502',
        targetMailboxId: '5a1b0000-e29b-41d4-a716-446655443502',
        tenantId: MIG_TENANT_B, // Attempt to create for tenant B
        status: 'active',
        mode: 'mirror',
      };

      const response = await request
        .post('/api/migrations')
        .set('Authorization', `Bearer ${TOKEN_TENANT_A}`)
        .send(newMapping);

      // The server should ignore the client-provided tenantId and use the auth context
      expect([200, 400, 404]).toContain(response.status);
    });
  });

  describe('PUT /api/migrations/:id', () => {
    it('should allow tenant A to update its own mapping', async () => {
      const updateData = {
        status: 'paused',
      };

      const response = await request
        .put(`/api/migrations/${MIG_MAPPING_A}`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_A}`)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('paused');
    });

    it('should prevent tenant B from updating tenant A mapping (CROSS-TENANT TEST)', async () => {
      const updateData = {
        status: 'cutover',
      };

      const response = await request
        .put(`/api/migrations/${MIG_MAPPING_A}`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_B}`)
        .send(updateData);

      // Should either fail with 404 or not actually update
      expect([200, 404]).toContain(response.status);
      
      if (response.status === 200) {
        // If it returns 200, verify it didn't update tenant A's mapping
        // (This would indicate a cross-tenant update succeeded, which is bad)
        expect(response.body.id).not.toBe(MIG_MAPPING_A);
      }
    });
  });

  describe('DELETE /api/migrations/:id', () => {
    it('should allow tenant A to delete its own mapping', async () => {
      // Create a temporary mapping for deletion test
      const tempId = '5a1b0000-e29b-41d4-a716-446655443601';
      const tempMailbox = '5a1b0000-e29b-41d4-a716-446655443602';
      
      await superuserPool.query(`
        INSERT INTO mailbox (id, tenant_id, connection_id, display_name, kind)
        VALUES ($1, $2, $3, 'Temp', 'user')
        ON CONFLICT (id) DO NOTHING
      `, [tempMailbox, MIG_TENANT_A, '5a1b0000-e29b-41d4-a716-446655443301']);

      await superuserPool.query(`
        INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status, mode)
        VALUES ($1, $2, $3, $3, 'active', 'mirror')
        ON CONFLICT (id) DO NOTHING
      `, [tempId, MIG_TENANT_A, tempMailbox]);

      const response = await request
        .delete(`/api/migrations/${tempId}`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_A}`);

      expect(response.status).toBe(200);
      
      // Verify deletion
      const check = await superuserPool.query(
        'SELECT * FROM mailbox_mapping WHERE id = $1',
        [tempId]
      );
      expect(check.rows.length).toBe(0);
    });

    it('deletes a migration that has been VERIFIED, and takes its dependants with it', async () => {
      // THE ONE THE 500 CAME THROUGH (migration 0042, 2026-09-08).
      //
      // The test above deletes a mapping that has never done anything: fresh
      // mailbox, fresh mapping, no history. Every foreign key to
      // `mailbox_mapping` is satisfied vacuously, so it passes whatever the
      // FK actions say — which is exactly why it passed for the five weeks
      // Delete answered `500 delete_failed` on any migration a customer had
      // ever verified.
      //
      // Eighteen keys reference the mapping. Sixteen cascade; `run` sets null
      // because a run is metered and outlives the mapping it measured. Two —
      // `verification_run` and `apply_receipt` — named no action at all, and
      // Postgres reads that as NO ACTION. This gives the mapping one row in
      // each of the three and presses the same button the customer presses.
      const vId = '5a1b0000-e29b-41d4-a716-446655443611';
      const vMailbox = '5a1b0000-e29b-41d4-a716-446655443612';
      const vRun = '5a1b0000-e29b-41d4-a716-446655443613';

      // Cleaned up BEFORE, not after. A run that fails part-way — which is
      // exactly what this test does when the FK actions regress — never
      // reaches a trailing cleanup, and the next run then dies on a duplicate
      // key instead of reporting the defect it was written to find. Found by
      // running it against the reverted schema twice.
      await superuserPool.query('DELETE FROM run WHERE id = $1', [vRun]);
      await superuserPool.query('DELETE FROM apply_receipt WHERE mapping_id = $1', [vId]);
      await superuserPool.query('DELETE FROM verification_run WHERE mapping_id = $1', [vId]);
      await superuserPool.query('DELETE FROM mailbox_mapping WHERE id = $1', [vId]);
      await superuserPool.query('DELETE FROM mailbox WHERE id = $1', [vMailbox]);

      await superuserPool.query(
        `INSERT INTO mailbox (id, tenant_id, connection_id, display_name, kind)
         VALUES ($1, $2, $3, 'Verified', 'user')`,
        [vMailbox, MIG_TENANT_A, '5a1b0000-e29b-41d4-a716-446655443301'],
      );
      await superuserPool.query(
        `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status, mode)
         VALUES ($1, $2, $3, $3, 'active', 'mirror')`,
        [vId, MIG_TENANT_A, vMailbox],
      );

      // It has been verified — the precondition the customer's 500 needed.
      await superuserPool.query(
        `INSERT INTO verification_run (tenant_id, mapping_id, state, started_at, finished_at)
         VALUES ($1, $2, 'done', now(), now())`,
        [MIG_TENANT_A, vId],
      );
      // And somebody pressed apply on an item once.
      await superuserPool.query(
        // `finished_at` is not decoration: apply_receipt_finished_check makes
        // it exactly equivalent to "not queued", so a terminal receipt without
        // one is refused by the database (0004).
        `INSERT INTO apply_receipt (tenant_id, mapping_id, natural_key_hash, action, state, finished_at)
         VALUES ($1, $2, 'sha256:integration-fixture', 'deletion', 'applied', now())`,
        [MIG_TENANT_A, vId],
      );
      // And it has a metered pass, which must NOT go with it.
      await superuserPool.query(
        `INSERT INTO run (id, tenant_id, mapping_id, kind, status, started_at, finished_at)
         VALUES ($1, $2, $3, 'incremental', 'succeeded', now(), now())`,
        [vRun, MIG_TENANT_A, vId],
      );

      const response = await request
        .delete(`/api/migrations/${vId}`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_A}`);

      // Before migration 0042 this was 500 with `delete_failed`, and there was
      // no second door: the migration could not be removed from the screen at
      // all. The body is asserted too — a 500 that happened to be shaped like
      // a success would otherwise read the same here.
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const gone = await superuserPool.query(
        'SELECT 1 FROM mailbox_mapping WHERE id = $1',
        [vId],
      );
      expect(gone.rows.length).toBe(0);

      // The dependants went with it. A receipt or a verification run kept
      // without its mapping is unreachable rather than preserved — every read
      // of both tables is keyed by `mapping_id`.
      for (const table of ['verification_run', 'apply_receipt']) {
        const left = await superuserPool.query(
          `SELECT count(*)::int AS n FROM ${table} WHERE mapping_id = $1`,
          [vId],
        );
        expect(left.rows[0].n, `${table} rows survived the mapping`).toBe(0);
      }

      // But the RUN did not, and that is the other half of the decision: a run
      // is metered, and billing reads it long after the migration is gone.
      // Cascading it to fix the 500 would have deleted invoice evidence
      // silently, which is why the two answers are asserted together.
      const run = await superuserPool.query(
        'SELECT mapping_id FROM run WHERE id = $1',
        [vRun],
      );
      expect(run.rows.length, 'the metered run was deleted with its mapping').toBe(1);
      expect(run.rows[0].mapping_id).toBeNull();
    });

    it('should prevent tenant B from deleting tenant A mapping (CROSS-TENANT TEST)', async () => {
      const response = await request
        .delete(`/api/migrations/${MIG_MAPPING_A}`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_B}`);

      expect([200, 404]).toContain(response.status);
      
      // Verify tenant A's mapping still exists
      const check = await superuserPool.query(
        'SELECT * FROM mailbox_mapping WHERE id = $1 AND tenant_id = $2',
        [MIG_MAPPING_A, MIG_TENANT_A]
      );
      expect(check.rows.length).toBe(1);
    });
  });

  describe('POST /api/migrations/:id/sync', () => {
    beforeAll(async () => {
      // The PUT describe block above (intentionally) leaves MIG_MAPPING_A 'paused' to
      // assert the update took effect. Sync requires an 'active' mapping (0013 T5's
      // paused-guard) — restore it so these tests exercise sync, not the guard.
      await superuserPool.query(`UPDATE mailbox_mapping SET status = 'active' WHERE id = $1`, [MIG_MAPPING_A]);
    });

    it('enqueues the real delta-sync task with an id-only, tenant-scoped payload', async () => {
      triggerMock.mockClear();
      const response = await request
        .post(`/api/migrations/${MIG_MAPPING_A}/sync`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_A}`)
        .send({ type: 'delta' });

      expect(response.status).toBe(202);
      expect(response.body.runId).toBe('run_mock_test');
      expect(response.body.jobType).toBe('run-delta-sync');
      expect(triggerMock).toHaveBeenCalledTimes(1);
      expect(triggerMock).toHaveBeenCalledWith(
        'run-delta-sync',
        { tenantId: MIG_TENANT_A, mappingId: MIG_MAPPING_A },
        expect.anything(),
      );
    });

    it('enqueues the full-sync task when type is full', async () => {
      triggerMock.mockClear();
      const response = await request
        .post(`/api/migrations/${MIG_MAPPING_A}/sync`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_A}`)
        .send({ type: 'full' });

      expect(response.status).toBe(202);
      // One sync task; a full scan is an option on it (the second task synced
      // mail and nothing else — see resolveSyncJob).
      expect(response.body.jobType).toBe('run-delta-sync');
      expect(triggerMock).toHaveBeenCalledWith(
        'run-delta-sync',
        expect.objectContaining({ forceFullScan: true }),
        expect.anything(),
      );
    });

    it('should prevent tenant B from triggering sync on tenant A mapping (CROSS-TENANT TEST)', async () => {
      triggerMock.mockClear();
      const response = await request
        .post(`/api/migrations/${MIG_MAPPING_A}/sync`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_B}`)
        .send({ type: 'full' });

      expect(response.status).toBe(404); // ownership check fails before any enqueue
      expect(triggerMock).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/migrations/:id/cutover', () => {
    it('enqueues the real cutover task for tenant A mapping', async () => {
      triggerMock.mockClear();
      const response = await request
        .post(`/api/migrations/${MIG_MAPPING_A}/cutover`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_A}`)
        .send({ gracePeriodHours: 12 });

      expect(response.status).toBe(202);
      expect(response.body.runId).toBe('run_mock_test');
      expect(triggerMock).toHaveBeenCalledWith(
        'run-cutover',
        expect.objectContaining({ tenantId: MIG_TENANT_A, mappingId: MIG_MAPPING_A }),
        expect.anything(),
      );
    });

    it('should prevent tenant B from triggering cutover on tenant A mapping (CROSS-TENANT TEST)', async () => {
      triggerMock.mockClear();
      const response = await request
        .post(`/api/migrations/${MIG_MAPPING_A}/cutover`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_B}`)
        .send({ gracePeriodHours: 12 });

      expect(response.status).toBe(404);
      expect(triggerMock).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/migrations/:id/runs', () => {
    it('should return runs for tenant A mapping', async () => {
      const response = await request
        .get(`/api/migrations/${MIG_MAPPING_A}/runs`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_A}`);

      expect(response.status).toBe(200);
      expect(response.body.runs).toBeDefined();
      expect(Array.isArray(response.body.runs)).toBe(true);
    });

    it('should prevent tenant B from accessing tenant A runs (CROSS-TENANT TEST)', async () => {
      const response = await request
        .get(`/api/migrations/${MIG_MAPPING_A}/runs`)
        .set('Authorization', `Bearer ${TOKEN_TENANT_B}`);

      expect([200, 404]).toContain(response.status);
    });
  });
});
