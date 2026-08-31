// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The managed chain's half of the FORCE ROW LEVEL SECURITY posture.
 *
 * ## The gap this closes, precisely
 *
 * `packages/ledger/src/force-rls.unit.test.ts` already asks the right question
 * the right way — "which RLS tables exempt their owner" put to the catalogs
 * rather than to a list, so a future migration that forgets FORCE fails by
 * name instead of surviving until somebody re-runs an audit.
 *
 * But it only runs `runMigrations`, so the database it asks holds the LEDGER
 * chain alone. The managed chain's thirteen RLS tables are not there to be
 * missing anything: the sweep comes back empty, green, and blind to them. Add
 * a managed table tomorrow with `ENABLE` and no `FORCE` and nothing anywhere
 * goes red — which is exactly the shape of the omission `0002_force_row_
 * security_stragglers.sql` was written to clean up, one chain over.
 *
 * ## Why an empty sweep is not enough on its own
 *
 * A query for "RLS tables missing FORCE" returns `[]` when everything is right
 * AND when the migrations never ran. Both halves of this file's first test
 * therefore exist: the sweep catches a table that forgot FORCE, and the named
 * set catches a sweep that passed because there was nothing to sweep. The
 * ledger file gets this for free — its own chain's absence would break every
 * other test in the package — and the managed chain, run second and by a
 * different function, does not.
 *
 * ## The enforcement half
 *
 * FORCE changes nothing for a superuser, and every rig we have is one (PGlite
 * runs as `postgres`; the postgres image's bootstrap user is a superuser; the
 * Testcontainers rig connects as its `POSTGRES_USER`, likewise). So, like the
 * ledger file, this manufactures the deployment shape FORCE exists for — hard
 * rule 5's operator pointing at their own Postgres, where the schema's owner
 * is an ordinary non-superuser — by handing ownership to `app_user` inside a
 * throwaway database.
 *
 * Two tables, because the managed chain guards two different things with it:
 *
 *  - `tenant_member`, on `tenant_isolation_select` — one customer's owner list
 *    must not contain another's. The same shape the ledger file proves.
 *  - `access_request`, on `operator_may_read` — the sharper one, and the
 *    reason this file is worth its runtime. That policy is the ONLY thing
 *    standing between the queue and a reader; there is no tenant column to
 *    fall back on. Without FORCE, an ordinary owner session reads every access
 *    request ever made — every address, note and decision — while being no
 *    operator at all.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from './migrate-managed.ts';

const TENANT_A = '5fce0000-e29b-41d4-a716-446655442201';
const TENANT_B = '5fce0000-e29b-41d4-a716-446655442202';

/**
 * The managed chain's RLS tables, named rather than counted.
 *
 * Named because the failure has to say WHICH — "12 of 13" sends somebody to go
 * and diff two catalog dumps. Derived by hand from the chain's own `ALTER
 * TABLE … FORCE ROW LEVEL SECURITY` statements on 2026-08-31; a table added
 * later and left out of this list is still caught by the sweep beside it,
 * which is the division of labour between the two.
 */
const MANAGED_RLS_TABLES = [
  'access_request',
  'billing_party',
  'bytes_moved',
  'invoice',
  'occupancy_peak',
  'payment_method',
  'platform_operator',
  'support_read',
  'tenant_closure',
  'tenant_member',
  'tenant_pricing',
  'usage_metric',
  'vat_consultation',
] as const;

let driver: LedgerDriver;

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  // Ledger first: every table in the managed chain references `public.tenant`.
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
}, 180_000);

afterAll(async () => {
  await driver?.end();
});

describe('both chains applied', () => {
  it('leaves NO RLS-enabled table without FORCE — asked of the catalogs, not a list', async () => {
    const conn = await driver.acquire();
    try {
      const { rows } = await conn.query<{ relname: string }>(
        `SELECT c.relname
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relrowsecurity           -- RLS enabled…
            AND NOT c.relforcerowsecurity  -- …but the owner still exempt
          ORDER BY c.relname`,
      );
      expect(
        rows.map((r) => r.relname),
        'these tables ENABLE row security but exempt their owner — add FORCE in a migration',
      ).toEqual([]);
    } finally {
      conn.release();
    }
  }, 30_000);

  it('actually ran the managed chain — every table above present, RLS on, FORCEd', async () => {
    // The assertion that keeps the sweep honest. Without it, a managed chain
    // that silently applied nothing leaves a catalog with no managed tables in
    // it, the sweep finds no offenders because there are no candidates, and
    // the file above reports green while guarding nothing at all.
    const conn = await driver.acquire();
    try {
      const { rows } = await conn.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
          ORDER BY c.relname`,
        [[...MANAGED_RLS_TABLES]],
      );

      const seen = new Map(rows.map((r) => [r.relname, r]));
      for (const table of MANAGED_RLS_TABLES) {
        const row = seen.get(table);
        expect(row, `${table} is not in the catalog — did the managed chain run?`).toBeDefined();
        expect(row!.relrowsecurity, `${table} does not ENABLE row security`).toBe(true);
        expect(row!.relforcerowsecurity, `${table} does not FORCE row security`).toBe(true);
      }
    } finally {
      conn.release();
    }
  }, 30_000);
});

describe('FORCE, demonstrated on the deployment shape it exists for', () => {
  /**
   * One throwaway database for both cases: this mutates table ownership, which
   * must never leak into the instance the sweep above reads, and standing up a
   * second PGlite with two migration chains costs more than the isolation
   * between two read-only assertions is worth.
   */
  let scratch: LedgerDriver;

  beforeAll(async () => {
    scratch = pgliteDriver({ role: 'app_user' });
    await runMigrations({ driver: scratch, logger: () => {} });
    await runManagedMigrations({ driver: scratch, logger: () => {} });

    const conn = await scratch.acquire();
    try {
      // Seeded as the superuser, before ownership moves.
      for (const [t, name] of [
        [TENANT_A, 'A'],
        [TENANT_B, 'B'],
      ] as const) {
        await conn.query(`INSERT INTO tenant (id, name) VALUES ($1, $2)`, [t, name]);
        await conn.query(
          `INSERT INTO tenant_member (tenant_id, user_id, email, role, status)
           VALUES ($1, $2, $3, 'owner', 'active')`,
          [t, `subject-${name}`, `owner-${name}@force.local`],
        );
      }
      // Two knocks, neither belonging to any tenant — which is the point of
      // the table and why it has no tenant column to fall back on.
      for (const who of ['first@force.local', 'second@force.local']) {
        await conn.query(`INSERT INTO access_request (email) VALUES ($1)`, [who]);
      }

      // The shape under test: app_user OWNS them, as an operator's ordinary
      // non-superuser database user would own everything we migrated into
      // their server.
      await conn.exec('ALTER TABLE public.tenant_member OWNER TO app_user');
      await conn.exec('ALTER TABLE public.access_request OWNER TO app_user');
    } finally {
      conn.release();
    }
  }, 180_000);

  afterAll(async () => {
    await scratch?.end();
  });

  /**
   * Served the way the managed API serves: as `app_user` — who is now also the
   * owner — with the two GUCs set and nothing else.
   *
   * Inside an explicit transaction, because `SET LOCAL` outside one is a no-op
   * that silently leaves the session as the superuser. `support-views.unit.
   * test.ts` records having fooled itself exactly that way, reading everything
   * and proving nothing; this is the same guard against the same mistake.
   */
  async function served<T>(
    subject: string,
    tenant: string,
    fn: (q: (sql: string, p?: unknown[]) => Promise<{ rows: unknown[] }>) => Promise<T>,
  ): Promise<T> {
    const conn = await scratch.acquire();
    try {
      const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
      await q('BEGIN');
      try {
        await q('SET LOCAL ROLE app_user');
        await q("SELECT set_config('app.current_user', $1, true)", [subject]);
        await q("SELECT set_config('app.current_tenant', $1, true)", [tenant]);
        const out = await fn(q as never);
        await q('COMMIT');
        return out;
      } catch (e) {
        await q('ROLLBACK');
        throw e;
      }
    } finally {
      conn.release();
    }
  }

  it('is really serving as a non-superuser who OWNS the table', async () => {
    // The precondition the two cases below rest on, asserted rather than
    // assumed: if `SET LOCAL ROLE` had not taken, both would pass for the
    // wrong reason — a superuser sees nothing surprising in an empty result.
    const [who] = await served(TENANT_A, TENANT_A, async (q) => {
      const { rows } = await q(
        `SELECT current_user AS role,
                pg_catalog.pg_get_userbyid(c.relowner) AS owner,
                (SELECT usesuper FROM pg_user WHERE usename = current_user) AS super
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = 'access_request'`,
      );
      return rows as Array<{ role: string; owner: string; super: boolean }>;
    });
    expect(who).toMatchObject({ role: 'app_user', owner: 'app_user', super: false });
  }, 60_000);

  it('binds an owner of tenant_member to the tenant policies', async () => {
    const seen = await served('subject-A', TENANT_A, async (q) => {
      const { rows } = await q(`SELECT tenant_id FROM tenant_member`);
      return rows as Array<{ tenant_id: string }>;
    });
    // Without FORCE, ownership trumps every policy and B's owner comes back too.
    expect(seen).toHaveLength(1);
    expect(seen[0]!.tenant_id).toBe(TENANT_A);
  }, 60_000);

  it('binds an owner of access_request to operator_may_read, so a non-operator reads NOTHING', async () => {
    // Nobody was ever appointed in this database, so `operator_may_read` is
    // false for every subject. The only thing that could return a row here is
    // the owner exemption FORCE takes away.
    const seen = await served('nobody-in-particular', '', async (q) => {
      const { rows } = await q(`SELECT email FROM access_request`);
      return rows as Array<{ email: string }>;
    });
    expect(
      seen,
      'an ordinary owner read the access queue — FORCE ROW LEVEL SECURITY is not binding on access_request',
    ).toEqual([]);
  }, 60_000);
});
