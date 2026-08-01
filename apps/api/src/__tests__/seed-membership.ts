// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Integration-suite helper for the tenant-membership gate (workplan 0020 T1).
 *
 * `authenticate` confirms `(tenantId, sub)` against `tenant_member` and takes
 * the role from that row — the token's role claim is never trusted. A suite
 * that mints a bare token therefore has to seed the membership the token
 * implies, and the row's ROLE (not the claim) is what the API will enforce.
 * That churn is deliberate: the suites now prove the gate exists.
 *
 * Runs on the suite's superuser pool (which bypasses RLS, like the rest of the
 * test seeds). Rows cascade-delete with their tenant, so existing afterAll
 * cleanup keeps working.
 */
import type { Pool } from 'pg';

export async function seedMembership(
  pool: Pool,
  tenantId: string,
  userId: string,
  role: 'owner' | 'admin' | 'member' | 'viewer' = 'owner'
): Promise<void> {
  await pool.query(
    `INSERT INTO tenant_member (tenant_id, user_id, email, role, status)
     VALUES ($1, $2, $3, $4, 'active')
     ON CONFLICT (tenant_id, user_id)
     DO UPDATE SET role = EXCLUDED.role, status = 'active'`,
    [tenantId, userId, `${userId}@integration.test`, role]
  );
}
