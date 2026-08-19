// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Is RLS in force on the path the appliance actually serves? (workplan 0016 P4)
 *
 * ## The gap this closes
 *
 * `rls.integration.test.ts` proves the policies are correct — but it proves it
 * by opening its own `Pool` as `app_user`. Nothing in it goes through the
 * driver the appliance is built from, so it can be entirely green while the
 * shipped product bypasses every policy it asserts.
 *
 * That is not hypothetical; it was the state of things. Postgres exempts two
 * kinds of user from row security: **superusers, unconditionally**, and a
 * table's **owner** unless the table is `FORCE`d. The appliance connects as the
 * database owner on the container path and as `postgres` on the PGlite path, so
 * on both backends the 96 policies in `0001_baseline.sql` were created,
 * granted, tested — and skipped. Measured, not deduced: with `role` removed
 * from the driver, the first test below sees both tenants' rows.
 *
 * `pglite-driver.unit.test.ts` does exercise real enforcement, but it does so
 * by issuing `SET LOCAL ROLE app_user` in the test itself. It therefore tests a
 * configuration the appliance did not run in — exactly the "asserted against a
 * database nobody ships" hazard P4 was written to name, in its sharpest form.
 *
 * ## What this file does differently
 *
 * It touches nothing but `pgliteDriver({ role })` and `withTenant()` — the two
 * things the appliance is wired from — and asks what a caller SEES. No `SET
 * ROLE` here, no second pool, no privileged setup inside the assertions. If the
 * production wiring stops enforcing, these fail.
 *
 * PGlite makes that affordable: real Postgres, real policies, no container.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pgliteDriver } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import { withTenant } from './db.ts';
import { connection } from './schema-pg.ts';
import type { LedgerDriver } from './driver.ts';

// UUID family 5c3b0000-…, a prefix of this file's own. `5c2b` was the first
// choice and is already owned by `rls.integration.test.ts`; the collision guard
// (`scripts/check-fixture-uuid-collisions.sh`) is what said so.
const TENANT_A = '5c3b0000-e29b-41d4-a716-446655441301';
const TENANT_B = '5c3b0000-e29b-41d4-a716-446655441302';
const CONN_A = '5c3b0000-e29b-41d4-a716-446655441311';
const CONN_B = '5c3b0000-e29b-41d4-a716-446655441312';

/** The appliance's own wiring: PGlite, serving as `app_user`. */
let driver: LedgerDriver;

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });

  // Seeded OUTSIDE `withTenant`, so this runs as the owner — which is how the
  // rows for two different tenants can exist at all. Everything asserted below
  // goes through the served path instead.
  const conn = await driver.acquire();
  try {
    for (const [tenant, connId, name] of [
      [TENANT_A, CONN_A, 'A'],
      [TENANT_B, CONN_B, 'B'],
    ]) {
      await conn.query('INSERT INTO tenant (id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [
        tenant,
        name,
      ]);
      await conn.query(
        `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
         VALUES ($1,$2,'source','imap',$3,'{}'::jsonb,'connected') ON CONFLICT DO NOTHING`,
        [connId, tenant, name],
      );
    }
  } finally {
    conn.release();
  }
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe('the appliance serves with RLS in force', () => {
  it('shows a tenant only its own rows', async () => {
    // THE test. Without `role` on the driver this returns 2 — the appliance
    // connects as a superuser, and a superuser is exempt from row security no
    // matter how many policies exist or how correct they are.
    const rows = await withTenant(driver, TENANT_A, (db) => db.select().from(connection));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tenantId).toBe(TENANT_A);

    const other = await withTenant(driver, TENANT_B, (db) => db.select().from(connection));
    expect(other).toHaveLength(1);
    expect(other[0]!.tenantId).toBe(TENANT_B);
  }, 30_000);

  it('runs as the unprivileged role, not as the owner', async () => {
    const [who] = (
      await withTenant(driver, TENANT_A, (db) =>
        db.execute<{ u: string; superuser: boolean }>(
          `SELECT current_user AS u,
                  COALESCE((SELECT usesuper FROM pg_user WHERE usename = current_user), false)
                    AS superuser`,
        ),
    ).then((r) => r.rows as Array<{ u: string; superuser: boolean }>)) as [
      { u: string; superuser: boolean },
    ];
    expect(who.u).toBe('app_user');
    // The property that matters. `current_user` being right is circumstantial;
    // not being a superuser is what makes the policies apply.
    expect(who.superuser).toBe(false);
  }, 30_000);

  it('refuses a write stamped with somebody else’s tenant', async () => {
    const smuggled = '5c3b0000-e29b-41d4-a716-446655441399';
    const rejection = await withTenant(driver, TENANT_A, (db) =>
      db.insert(connection).values({
        id: smuggled,
        tenantId: TENANT_B, // not the tenant in context
        role: 'target' as const,
        kind: 'imap' as const,
        displayName: 'smuggled',
        config: {},
      }),
    ).then(
      () => null,
      (err: Error) => err,
    );

    // Drizzle wraps the driver's error as "Failed query: …" and keeps the real
    // one on `cause`, so the reason has to be read from there — asserting on
    // the wrapper alone would pass for a typo in the SQL just as happily.
    expect(rejection).not.toBeNull();
    expect(String((rejection as Error & { cause?: unknown }).cause)).toMatch(
      /row-level security|violates/i,
    );

    // And the property underneath the error message: nothing was written.
    const bsRows = await withTenant(driver, TENANT_B, (db) => db.select().from(connection));
    expect(bsRows.map((r) => r.id)).toEqual([CONN_B]);
  }, 30_000);

  it('gives the role back at COMMIT, so the next caller is not stuck with it', async () => {
    // `SET LOCAL`, not `SET`. On the PGlite driver this matters more than
    // anywhere else: there is ONE connection, so a role that leaked past the
    // transaction would be the role the next migration ran as.
    await withTenant(driver, TENANT_A, async (db) => db.select().from(connection));
    const conn = await driver.acquire();
    try {
      const { rows } = await conn.query<{ u: string }>('SELECT current_user AS u');
      expect(rows[0]!.u).toBe('postgres');
    } finally {
      conn.release();
    }
  }, 30_000);
});

describe('a driver with no role behaves exactly as before', () => {
  // The managed edition takes its role from the connection string it is
  // deployed with. Adding the option must not change what it does.
  it('does not switch roles, and says nothing about it', async () => {
    const plain = pgliteDriver();
    try {
      await runMigrations({ driver: plain, logger: () => {} });
      await withTenant(plain, TENANT_A, async (db) => {
        const res = await db.execute<{ u: string }>('SELECT current_user AS u');
        expect((res.rows as Array<{ u: string }>)[0]!.u).toBe('postgres');
        return null;
      });
    } finally {
      await plain.end();
    }
  }, 120_000);

  it('refuses a role name that is not a plain identifier', () => {
    // `SET ROLE` takes an identifier and identifiers cannot be bound, so this
    // is the one value that reaches SQL by concatenation. Refuse, do not escape.
    expect(() => pgliteDriver({ role: 'app_user; DROP TABLE tenant' })).toThrow(/Refusing/);
    expect(() => pgliteDriver({ role: '"; --' })).toThrow(/Refusing/);
  });
});
