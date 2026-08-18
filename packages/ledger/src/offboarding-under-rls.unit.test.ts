// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Close and reopen work as the role the API actually connects as
 * (workplan 0085, after a 500 that only the integration tier caught).
 *
 * ## The bug this exists to have caught
 *
 * `POST /close` ran `closeTenant` OUTSIDE `withTenantDb`, on the reasoning that
 * the erasure record must outlive the tenant and therefore should not be
 * written inside the tenant's transaction.
 *
 * That sounded right and was backwards. `erasure_record` has no RLS policies at
 * all — outliving the tenant is about the absence of a foreign key, not about a
 * transaction — so writing it inside is unrestricted. Meanwhile `tenant` is
 * `FORCE ROW LEVEL SECURITY` with an UPDATE policy keyed on
 * `app.current_tenant`, and the API connects as `app_user`. Without the
 * context, the UPDATE matched **zero rows**, and close reported a tenant that
 * does not exist. A 500, in the integration tier, on a route whose unit tests
 * all passed.
 *
 * They passed because `offboarding.unit.test.ts` drives PGlite as the OWNER,
 * where Postgres skips row security. That is the gap: every offboarding
 * assertion was made in a world where RLS does not apply, about code that only
 * ever runs in a world where it does.
 *
 * So this file drives the same functions through `pgliteDriver({ role:
 * 'app_user' })` and `withTenant` — the appliance's and the API's own wiring,
 * the arrangement `rls-in-force.unit.test.ts` established.
 *
 * ## What it deliberately does NOT do
 *
 * There is no "fails without the tenant context" case here. Written, it turned
 * out to be a test about Postgres's error semantics rather than about this
 * code: under `SET LOCAL ROLE app_user` with no `app.current_tenant`, the
 * UPDATE does not return zero rows so much as abort the transaction, which
 * then poisons the connection for whatever runs next. Chasing that would have
 * produced a brittle test asserting somebody else's behaviour.
 *
 * The route-level property — *close runs inside `withTenantDb`* — is pinned
 * where it belongs, by the integration test that calls `POST /close` and
 * expects 200. That is the test that went red, and it is the test that stays.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { pgliteDriver } from './pglite-driver';
import { runMigrations } from './migrate';
import { withTenant } from './db';
import { closeTenant, reopenTenant } from './offboarding';
import type { LedgerDriver } from './driver';
import type { PgDatabase } from './db-types';

// UUID family 5acb0000-…, unused elsewhere in the repo.
const TENANT = '5acb0000-e29b-41d4-a716-446655441901';
const NOW = new Date('2026-08-18T12:00:00.000Z');

/** The API's own wiring: PGlite, serving as `app_user`. */
let driver: LedgerDriver;

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  // Seeded OUTSIDE withTenant, so it runs as the owner — which is how the row
  // can be created at all. Everything asserted below goes through the served
  // path instead.
  const conn = await driver.acquire();
  try {
    await conn.query('DELETE FROM erasure_record');
    await conn.query('DELETE FROM tenant');
    await conn.query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'rls', 'active')`, [TENANT]);
  } finally {
    conn.release();
  }
});

describe('offboarding under the role the API really uses', () => {
  it('closes a tenant when the tenant context is set', async () => {
    const result = await withTenant(driver, TENANT, (db) =>
      closeTenant(db as unknown as PgDatabase, TENANT, 30, 'owner@example.test', NOW),
    );
    expect(result.windowDays).toBe(30);

    const conn = await driver.acquire();
    try {
      const { rows } = await conn.query<{ status: string }>(
        `SELECT status FROM tenant WHERE id = $1`,
        [TENANT],
      );
      expect(rows[0]?.status).toBe('closed');
      // And the erasure record was written from inside the tenant transaction,
      // which is the half the original reasoning got wrong.
      const rec = await conn.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM erasure_record`,
      );
      expect(Number(rec.rows[0]?.n)).toBe(1);
    } finally {
      conn.release();
    }
  });

  it('reopens a tenant when the context is set', async () => {
    await withTenant(driver, TENANT, (db) =>
      closeTenant(db as unknown as PgDatabase, TENANT, 30, 'owner@example.test', NOW),
    );
    await withTenant(driver, TENANT, (db) =>
      reopenTenant(db as unknown as PgDatabase, TENANT, NOW),
    );

    const conn = await driver.acquire();
    try {
      const { rows } = await conn.query<{ status: string; purge_after: Date | null }>(
        `SELECT status, purge_after FROM tenant WHERE id = $1`,
        [TENANT],
      );
      expect(rows[0]?.status).toBe('active');
      expect(rows[0]?.purge_after).toBeNull();
    } finally {
      conn.release();
    }
  });

  it('cannot DELETE an erasure record as the request path', async () => {
    await withTenant(driver, TENANT, (db) =>
      closeTenant(db as unknown as PgDatabase, TENANT, 7, 'owner@example.test', NOW),
    );
    // Migration 0025 REVOKEs delete: a request path that can remove this can
    // erase the evidence that it erased something.
    await expect(
      withTenant(driver, TENANT, async (db) => {
        await (db as unknown as PgDatabase).execute(sql`DELETE FROM erasure_record`);
      }),
    ).rejects.toThrow();
  });
});
