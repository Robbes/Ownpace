// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The PGlite driver against the REAL schema (workplan 0016 P2/P3).
 *
 * No Docker and no container: PGlite is Postgres compiled to WASM running
 * in-process, which is the entire point — this suite applies the real 2580-line
 * `0001_baseline.sql`, unmodified, and then checks the thing that actually
 * matters.
 *
 * **"96 policies created" is not the same claim as "96 policies enforcing."**
 * Postgres exempts superusers and table owners from RLS, and an in-process WASM
 * database runs as exactly that — so a test that merely counted policies would
 * pass on a database that leaks every tenant's rows to every other tenant. The
 * enforcement tests below `SET ROLE app_user` first, which is how the appliance
 * will connect.
 *
 * It lives in the UNIT project despite exercising a real database and the real
 * migration chain, because it needs no infrastructure: no Docker, no
 * Testcontainers, no network. That is worth noticing rather than glossing —
 * RLS enforcement previously could not be tested without a Postgres container,
 * which is why the integration suite exists and why it cannot run on a machine
 * without a container runtime. This suite runs anywhere Node runs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runMigrations } from './migrate';
import { withTenant } from './db';
import { pgliteDriver } from './pglite-driver';
import type { LedgerDriver } from './driver';

let driver: LedgerDriver;

beforeAll(async () => {
  driver = pgliteDriver(); // in-memory
  // The real migration chain, through the seam, with no connection string —
  // PGlite is a file, not a server, and has none.
  const result = await runMigrations({ driver, logger: () => {} });
  expect(result.applied.length).toBeGreaterThan(0);
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

/** Run a statement outside `withTenant`, as the owner. */
async function sql<R = Record<string, unknown>>(
  text: string,
  params?: readonly unknown[],
): Promise<R[]> {
  const conn = await driver.acquire();
  try {
    const { rows } = await conn.query<R>(text, params);
    return rows;
  } finally {
    conn.release();
  }
}

describe('the real baseline applies', () => {
  it('creates the schema', async () => {
    const [row] = await sql<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    expect(Number(row!.n)).toBeGreaterThanOrEqual(26);
  });

  it('creates the RLS policies and enables RLS on the tables', async () => {
    const [pol] = await sql<{ n: string }>(`SELECT count(*)::text AS n FROM pg_policies`);
    expect(Number(pol!.n)).toBeGreaterThanOrEqual(90);

    const [rls] = await sql<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_class c
       JOIN pg_namespace ns ON ns.oid = c.relnamespace
       WHERE ns.nspname = 'public' AND c.relrowsecurity`,
    );
    expect(Number(rls!.n)).toBeGreaterThanOrEqual(20);
  });

  it('creates the app_user role the appliance connects as', async () => {
    const rows = await sql(`SELECT 1 FROM pg_roles WHERE rolname = 'app_user'`);
    expect(rows).toHaveLength(1);
  });

  it('has pgcrypto and gen_random_uuid, so the baseline is byte-identical to what a server gets', async () => {
    // The baseline's CREATE EXTENSION pgcrypto is a pg_dump artefact — nothing
    // calls a pgcrypto function — but it must still succeed, which is why the
    // driver loads the contrib rather than editing the SQL.
    const ext = await sql(`SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto'`);
    expect(ext).toHaveLength(1);
    const [id] = await sql<{ id: string }>(`SELECT gen_random_uuid()::text AS id`);
    expect(id!.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('is idempotent — a second run applies nothing', async () => {
    const again = await runMigrations({ driver, logger: () => {} });
    expect(again.applied).toEqual([]);
  });
});

describe('row_security', () => {
  it('is ON after migrations, which is NOT free — see the driver', async () => {
    // Workplan 0015 T0 concluded that PGlite defaults this OFF where a real
    // server defaults it ON. That is not what happens. A fresh PGlite reports
    // `on`; what turns it off is OUR OWN MIGRATION — `0001_baseline.sql` is a
    // pg_dump, and line 43 of its preamble is `SET row_security = off;`.
    //
    // Harmless on a pool (session-scoped, dies with the client that migrated);
    // on one persistent connection it would disable row security for the life
    // of the process. The driver re-asserts it per acquire, and this asserts
    // that it worked AFTER the migration chain has run.
    const [row] = await sql<{ row_security: string }>(`SHOW row_security`);
    expect(row!.row_security).toBe('on');
  });
});

describe('RLS actually enforces, not merely exists', () => {
  const A = '11111111-1111-1111-1111-111111111111';
  const B = '22222222-2222-2222-2222-222222222222';

  beforeAll(async () => {
    // Two tenants, one row each, inserted as the OWNER (which bypasses RLS).
    for (const [id, name] of [
      [A, 'tenant-a'],
      [B, 'tenant-b'],
    ]) {
      await sql(`INSERT INTO tenant (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [
        id,
        name,
      ]);
    }
    // app_user needs table privileges; RLS is what restricts it to its tenant.
    await sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user`);
  });

  it('shows a tenant only its own rows once the role is app_user', async () => {
    const conn = await driver.acquire();
    try {
      await conn.query('BEGIN');
      await conn.query("SELECT set_config('app.current_tenant', $1, true)", [A]);
      // THE line that makes this a real test. PGlite runs as a SUPERUSER,
      // which bypasses RLS unconditionally — so without switching role, both
      // rows come back however correct the policies are, and the test would
      // pass on a database that leaks everything.
      await conn.query('SET LOCAL ROLE app_user');
      const { rows } = await conn.query<{ id: string }>(`SELECT id FROM tenant`);
      expect(rows.map((r) => r.id)).toEqual([A]);
      await conn.query('ROLLBACK');
    } finally {
      conn.release();
    }
  });

  it('shows the OTHER tenant only its own rows, so it is filtering rather than hiding everything', async () => {
    const conn = await driver.acquire();
    try {
      await conn.query('BEGIN');
      await conn.query("SELECT set_config('app.current_tenant', $1, true)", [B]);
      await conn.query('SET LOCAL ROLE app_user');
      const { rows } = await conn.query<{ id: string }>(`SELECT id FROM tenant`);
      expect(rows.map((r) => r.id)).toEqual([B]);
      await conn.query('ROLLBACK');
    } finally {
      conn.release();
    }
  });

  it('refuses a cross-tenant INSERT', async () => {
    const conn = await driver.acquire();
    try {
      await conn.query('BEGIN');
      await conn.query("SELECT set_config('app.current_tenant', $1, true)", [A]);
      await conn.query('SET LOCAL ROLE app_user');
      await expect(
        conn.query(
          `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
           VALUES (gen_random_uuid(), $1, 'source', 'imap', 'x', '{}'::jsonb, 'connected')`,
          [B],
        ),
      ).rejects.toThrow();
      await conn.query('ROLLBACK');
    } finally {
      conn.release();
    }
  });
});

describe('the single connection', () => {
  it('serialises withTenant, so two tenants never overlap', async () => {
    // The correctness requirement the seam exists for, now against the real
    // driver rather than a fake. Interleaving here would mean BEGIN inside
    // BEGIN and one tenant's context live during another's query.
    const order: string[] = [];
    await Promise.all([
      withTenant(driver, '11111111-1111-1111-1111-111111111111', async () => {
        order.push('a:start');
        await new Promise((r) => setTimeout(r, 30));
        order.push('a:end');
      }),
      withTenant(driver, '22222222-2222-2222-2222-222222222222', async () => {
        order.push('b:start');
        await new Promise((r) => setTimeout(r, 1));
        order.push('b:end');
      }),
    ]);

    // Whichever ran first, it finished before the other started.
    expect(order).toHaveLength(4);
    expect(order[1]).toBe(order[0]!.replace(':start', ':end'));
    expect(order[3]).toBe(order[2]!.replace(':start', ':end'));
  });

  it('recovers from a failed transaction rather than wedging every later tenant', async () => {
    await expect(
      withTenant(driver, '11111111-1111-1111-1111-111111111111', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // The proof it was released and reset: the next tenant works.
    const ok = await withTenant(driver, '22222222-2222-2222-2222-222222222222', async () => 'ok');
    expect(ok).toBe('ok');
  });
});
