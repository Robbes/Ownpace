// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The same question as `rls-in-force.unit.test.ts`, against a real server.
 *
 * That file asks whether the appliance's SERVED path enforces row security, and
 * answers it on PGlite. This asks it of `pgDriver`, on server Postgres, because
 * the appliance ships on both and workplan 0016 P4 is precisely the question of
 * whether a guarantee proved on one backend may be assumed on the other.
 *
 * The sharp part is the connection this uses: `TEST_DATABASE_URL`, which is the
 * Testcontainers **superuser** — the same shape as the container appliance's
 * `DATABASE_URL`, which is the database owner. Superusers and owners are the
 * two kinds of user Postgres exempts from row security, so before
 * `LedgerDriver.role` existed this connection saw every tenant's rows no matter
 * how correct the policies were. Nothing here connects as `app_user`; the
 * driver drops to it, which is the behaviour under test.
 *
 * UUID family 5c3b0000-…, a prefix of its own. The collision guard
 * (`scripts/check-fixture-uuid-collisions.sh`) is what says whether that is
 * true — it caught this file reusing 5c2b, which `rls.integration.test.ts`
 * already owns, against a shared database.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgDriver, withTenant } from './db.ts';
import { connection } from './schema-pg.ts';

const URL = process.env.TEST_DATABASE_URL;
if (!URL) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

const TENANT_A = '5c3b0000-e29b-41d4-a716-446655441401';
const TENANT_B = '5c3b0000-e29b-41d4-a716-446655441402';
const CONN_A = '5c3b0000-e29b-41d4-a716-446655441411';
const CONN_B = '5c3b0000-e29b-41d4-a716-446655441412';

let pool: Pool;

beforeAll(async () => {
  pool = new Pool({ connectionString: URL });
  // Seeded on the raw pool, as the privileged user — which is how rows for two
  // tenants come to exist at all. Every assertion below goes through the
  // driver instead.
  for (const [tenant, connId, name] of [
    [TENANT_A, CONN_A, 'A'],
    [TENANT_B, CONN_B, 'B'],
  ]) {
    await pool.query(
      'INSERT INTO tenant (id, name, status) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING',
      [tenant, `RLS in force ${name}`, 'active'],
    );
    await pool.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config)
       VALUES ($1,$2,'source','o365',$3,'{}') ON CONFLICT (id) DO NOTHING`,
      [connId, tenant, `RLS in force ${name}`],
    );
  }
});

afterAll(async () => {
  await pool.query('DELETE FROM connection WHERE tenant_id IN ($1,$2)', [TENANT_A, TENANT_B]);
  await pool.query('DELETE FROM tenant WHERE id IN ($1,$2)', [TENANT_A, TENANT_B]);
  await pool.end();
});

describe('pgDriver with a serving role', () => {
  it('enforces isolation even though the connection is privileged', async () => {
    const driver = pgDriver(pool, { role: 'app_user' });

    const a = await withTenant(driver, TENANT_A, (db) => db.select().from(connection));
    expect(a.map((r) => r.id)).toEqual([CONN_A]);

    const b = await withTenant(driver, TENANT_B, (db) => db.select().from(connection));
    expect(b.map((r) => r.id)).toEqual([CONN_B]);
  });

  it('hands the connection back to the pool without the role stuck to it', async () => {
    // `SET LOCAL`, so COMMIT reverts it. A pooled client that kept the role
    // would hand it to whatever ran next — including, on a restart, the
    // migration chain, which has to be the owner to create roles and policies.
    const driver = pgDriver(pool, { role: 'app_user' });
    await withTenant(driver, TENANT_A, (db) => db.select().from(connection));

    const { rows } = await pool.query<{ u: string }>('SELECT current_user AS u');
    expect(rows[0]!.u).not.toBe('app_user');
  });

  it('without a role, the privileged connection sees everything — the old behaviour', async () => {
    // Kept deliberately. It is the measurement that makes the tests above mean
    // something: the isolation they assert comes from the role switch, not from
    // the policies alone, and this is what the appliance did before.
    const plain = pgDriver(pool);
    const all = await withTenant(plain, TENANT_A, (db) => db.select().from(connection));
    const ids = all.map((r) => r.id);
    expect(ids).toContain(CONN_A);
    expect(ids).toContain(CONN_B);
  });
});
