// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * API Integration Tests for the drift decision queue (workplan 0028 T1).
 *
 * Proves the route contract against real Postgres with RLS enforced
 * (app_user): tenant isolation on the list, owner/admin-only answering, the
 * 409 never-overwrite contract, and the migration-0005 idempotency holding
 * through the store from the route's side of the seam.
 *
 * UUID Family: 5e3c0000-e29b-41d4-a716-44665544xxxx
 */

// Set JWT_SECRET before importing app
process.env.JWT_SECRET = 'test-secret-for-integration-tests';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests require Testcontainers to be running. ' +
      'Run: pnpm test:integration',
  );
}

const getAppUserConnectionString = (originalUrl: string): string => {
  const url = new URL(originalUrl);
  url.username = 'app_user';
  url.password = 'app_password';
  return url.toString();
};
process.env.APP_DATABASE_URL = getAppUserConnectionString(PG_CONNECTION_STRING);

import app from '../index.ts';
import { seedMembership } from '../__tests__/seed-membership.ts';

const DEC_TENANT_A = '5e3c0000-e29b-41d4-a716-446655440001';
const DEC_TENANT_B = '5e3c0000-e29b-41d4-a716-446655440002';

function createTestToken(tenantId: string, role: string = 'member', sub?: string): string {
  return jwt.sign(
    {
      sub: sub ?? `user-${role}-${tenantId}`,
      tenantId,
      role,
      email: `user@${tenantId}.test`,
    },
    process.env.JWT_SECRET!,
  );
}

const TOKEN_MEMBER_A = createTestToken(DEC_TENANT_A);
const TOKEN_OWNER_A = createTestToken(DEC_TENANT_A, 'owner');

describe('Decision Queue Routes', () => {
  let superuserPool: Pool;
  let request: ReturnType<typeof supertest>;
  let pendingId: string;
  let tenantBDecisionId: string;

  beforeAll(async () => {
    superuserPool = new Pool({ connectionString: PG_CONNECTION_STRING });

    await superuserPool.query(
      `INSERT INTO tenant (id, name, status, settings)
       VALUES ($1, 'Decisions Tenant A', 'active', '{}'), ($2, 'Decisions Tenant B', 'active', '{}')
       ON CONFLICT (id) DO NOTHING`,
      [DEC_TENANT_A, DEC_TENANT_B],
    );

    // The membership gate (0020 T1): every token's (tenantId, sub) must exist.
    for (const [tenant, role] of [
      [DEC_TENANT_A, 'member'],
      [DEC_TENANT_A, 'owner'],
      [DEC_TENANT_B, 'owner'],
    ] as const) {
      await seedMembership(superuserPool, tenant, `user-${role}-${tenant}`, role);
    }

    // Seed decisions directly (raising is detector-side; no route creates them).
    const a = await superuserPool.query(
      `INSERT INTO decision (tenant_id, category, subject_key, summary, detail, proposed_default)
       VALUES ($1, 'new_mailbox', 'nieuw@acme.nl', 'A mailbox appeared: nieuw@acme.nl', '{"address":"nieuw@acme.nl"}', 'create a mapping')
       RETURNING id`,
      [DEC_TENANT_A],
    );
    pendingId = a.rows[0].id;
    const b = await superuserPool.query(
      `INSERT INTO decision (tenant_id, category, subject_key, summary)
       VALUES ($1, 'new_mailbox', 'geheim@other.nl', 'Tenant B private drift')
       RETURNING id`,
      [DEC_TENANT_B],
    );
    tenantBDecisionId = b.rows[0].id;

    request = supertest(app);
  }, 60_000);

  afterAll(async () => {
    await superuserPool.query(`DELETE FROM decision WHERE tenant_id = ANY($1::uuid[])`, [
      [DEC_TENANT_A, DEC_TENANT_B],
    ]);
    // The group rows go with their connections (FK ON DELETE CASCADE); the
    // suite shares a database, so leaving them would leak into the next run's
    // uniqueness assumptions.
    await superuserPool.query(`DELETE FROM connection WHERE tenant_id = ANY($1::uuid[])`, [
      [DEC_TENANT_A, DEC_TENANT_B],
    ]);
    await superuserPool.end();
  });

  describe('GET /api/decisions', () => {
    it('lists the tenant own queue, and NEVER the other tenant rows (RLS)', async () => {
      const response = await request
        .get('/api/decisions')
        .set('Authorization', `Bearer ${TOKEN_MEMBER_A}`);

      expect(response.status).toBe(200);
      const subjects = response.body.decisions.map((d: { subjectKey?: string }) => d.subjectKey);
      expect(subjects).toContain('nieuw@acme.nl');
      expect(subjects).not.toContain('geheim@other.nl');
    });

    it('filters by status', async () => {
      const response = await request
        .get('/api/decisions?status=resolved')
        .set('Authorization', `Bearer ${TOKEN_MEMBER_A}`);
      expect(response.status).toBe(200);
      expect(
        response.body.decisions.every((d: { status: string }) => d.status === 'resolved'),
      ).toBe(true);
    });
  });

  describe('POST /api/decisions/:id/resolve', () => {
    it('refuses a plain member — answering is owner/admin', async () => {
      const response = await request
        .post(`/api/decisions/${pendingId}/resolve`)
        .set('Authorization', `Bearer ${TOKEN_MEMBER_A}`)
        .send({ resolution: { action: 'create_mapping' } });
      expect(response.status).toBe(403);
    });

    it('refuses to answer another tenant decision (RLS)', async () => {
      const response = await request
        .post(`/api/decisions/${tenantBDecisionId}/resolve`)
        .set('Authorization', `Bearer ${TOKEN_OWNER_A}`)
        .send({ resolution: { action: 'create_mapping' } });
      // RLS makes the row invisible: same 409 as not-found, no existence leak.
      expect(response.status).toBe(409);
    });

    it('records the answer once; the second answer gets the 409, not a quiet win', async () => {
      const first = await request
        .post(`/api/decisions/${pendingId}/resolve`)
        .set('Authorization', `Bearer ${TOKEN_OWNER_A}`)
        .send({ resolution: { action: 'create_mapping' } });
      expect(first.status).toBe(200);
      expect(first.body.status).toBe('resolved');
      expect(first.body.resolution).toEqual({ action: 'create_mapping' });
      expect(first.body.resolvedBy).toBe(`user-owner-${DEC_TENANT_A}`);

      const second = await request
        .post(`/api/decisions/${pendingId}/resolve`)
        .set('Authorization', `Bearer ${TOKEN_OWNER_A}`)
        .send({ resolution: { action: 'ignore' } });
      expect(second.status).toBe(409);
      expect(second.body.message).toBe(
        'This decision does not exist or has already been answered.',
      );
    });
  });

  describe('answering the shared-address question (workplan 0028 T3)', () => {
    /** A discovered group with no pattern, plus the decision asking about it. */
    async function seedAmbiguous(address: string) {
      const conn = await superuserPool.query(
        `INSERT INTO connection (tenant_id, role, kind, display_name, config, status)
         VALUES ($1, 'source', 'o365', 'Source', '{}', 'connected') RETURNING id`,
        [DEC_TENANT_A],
      );
      await superuserPool.query(
        `INSERT INTO group_def (tenant_id, source_connection_id, address, members)
         VALUES ($1, $2, $3, '[]')`,
        [DEC_TENANT_A, conn.rows[0].id, address],
      );
      const dec = await superuserPool.query(
        `INSERT INTO decision (tenant_id, category, subject_key, summary)
         VALUES ($1, 'shared_address_pattern', $2, 'Shared mailbox or distribution list?')
         RETURNING id`,
        [DEC_TENANT_A, address],
      );
      return dec.rows[0].id as string;
    }

    it('writes the chosen pattern back to the discovered group', async () => {
      const id = await seedAmbiguous('sales@acme.nl');

      const response = await request
        .post(`/api/decisions/${id}/resolve`)
        .set('Authorization', `Bearer ${TOKEN_OWNER_A}`)
        .send({ resolution: { action: 'set_shared_address_pattern', pattern: 'distribution_d' } });

      expect(response.status).toBe(200);
      // The whole point of the category: the answer CHANGES something. A
      // decision that closes and leaves the ledger untouched is dead surface.
      const { rows } = await superuserPool.query(
        `SELECT pattern FROM group_def WHERE tenant_id = $1 AND address = 'sales@acme.nl'`,
        [DEC_TENANT_A],
      );
      expect(rows[0].pattern).toBe('distribution_d');
    });

    it('leaves the group alone when the answer names no pattern', async () => {
      const id = await seedAmbiguous('vague@acme.nl');

      const response = await request
        .post(`/api/decisions/${id}/resolve`)
        .set('Authorization', `Bearer ${TOKEN_OWNER_A}`)
        .send({ resolution: { action: 'accept_default' } });

      // The decision is answered — that is the caller's business — but
      // recording a pattern nobody chose is worse than leaving it open.
      expect(response.status).toBe(200);
      const { rows } = await superuserPool.query(
        `SELECT pattern FROM group_def WHERE tenant_id = $1 AND address = 'vague@acme.nl'`,
        [DEC_TENANT_A],
      );
      expect(rows[0].pattern).toBeNull();
    });

    it('does not let a losing second answer rewrite the group', async () => {
      const id = await seedAmbiguous('once@acme.nl');
      await request
        .post(`/api/decisions/${id}/resolve`)
        .set('Authorization', `Bearer ${TOKEN_OWNER_A}`)
        .send({ resolution: { pattern: 'shared_s' } });

      const second = await request
        .post(`/api/decisions/${id}/resolve`)
        .set('Authorization', `Bearer ${TOKEN_OWNER_A}`)
        .send({ resolution: { pattern: 'distribution_d' } });

      // The conditional UPDATE is what guarantees exactly one answer wins, so
      // the pattern write has to come AFTER it — otherwise the 409'd answer
      // would still have changed the ledger.
      expect(second.status).toBe(409);
      const { rows } = await superuserPool.query(
        `SELECT pattern FROM group_def WHERE tenant_id = $1 AND address = 'once@acme.nl'`,
        [DEC_TENANT_A],
      );
      expect(rows[0].pattern).toBe('shared_s');
    });
  });

  describe('POST /api/decisions/:id/dismiss', () => {
    it('closes a pending decision without acting, once', async () => {
      const seeded = await superuserPool.query(
        `INSERT INTO decision (tenant_id, category, subject_key, summary)
         VALUES ($1, 'new_mailbox', 'sluit@acme.nl', 'A mailbox appeared: sluit@acme.nl')
         RETURNING id`,
        [DEC_TENANT_A],
      );
      const id = seeded.rows[0].id;

      const dismissed = await request
        .post(`/api/decisions/${id}/dismiss`)
        .set('Authorization', `Bearer ${TOKEN_OWNER_A}`);
      expect(dismissed.status).toBe(200);
      expect(dismissed.body.status).toBe('dismissed');

      const again = await request
        .post(`/api/decisions/${id}/dismiss`)
        .set('Authorization', `Bearer ${TOKEN_OWNER_A}`);
      expect(again.status).toBe(409);
    });
  });
});
