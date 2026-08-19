// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Every RLS-enabled table is FORCEd — and FORCE actually binds an owner.
 *
 * `0001_baseline.sql` FORCEs 22 of its 24 RLS tables; `migration_discovery`
 * and `migration_status` had `ENABLE` without `FORCE`, a pre-squash omission
 * the squash preserved. `0002_force_row_security_stragglers.sql` closes it.
 *
 * Two kinds of assertion here, because they fail differently:
 *
 * 1. **Completeness, from the catalogs.** "Which tables are FORCEd" is a fact
 *    Postgres will simply state (`pg_class.relforcerowsecurity`), so ask it —
 *    for every RLS table at once. A future migration that adds an RLS table
 *    and forgets FORCE fails this test by name, rather than surviving until
 *    someone re-runs the audit that found these two.
 *
 * 2. **Enforcement, by making the exemption reachable.** FORCE only changes
 *    behaviour for a NON-SUPERUSER owner, and every rig we have runs as a
 *    superuser (PGlite is `postgres`; the postgres image's bootstrap user is a
 *    superuser), for whom FORCE is unenforceable by design. So the test
 *    manufactures the deployment shape that matters — hard rule 5's operator
 *    pointing at their own Postgres with an ordinary owner — by handing
 *    ownership of the table to `app_user` inside a throwaway PGlite database.
 *    Owner + ENABLE alone = sees everything; owner + FORCE = filtered. The
 *    second is what the migration buys.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pgliteDriver } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import { withTenant } from './db.ts';
import type { LedgerDriver } from './driver.ts';

const TENANT_A = '5d3b0000-e29b-41d4-a716-446655441501';
const TENANT_B = '5d3b0000-e29b-41d4-a716-446655441502';

let driver: LedgerDriver;

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe('the migration chain with 0002 applied', () => {
  it('is idempotent — a second run applies nothing', async () => {
    // The property every startup depends on: the appliance migrates on boot,
    // every boot.
    const applied: string[] = [];
    await runMigrations({ driver, logger: (m: string) => applied.push(m) });
    expect(applied.join('\n')).toContain('up to date');
  }, 60_000);

  it('leaves NO RLS-enabled table without FORCE — asked of the catalogs, not a list', async () => {
    const conn = await driver.acquire();
    try {
      const { rows } = await conn.query<{ relname: string }>(
        `SELECT c.relname
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relrowsecurity        -- RLS enabled…
            AND NOT c.relforcerowsecurity  -- …but the owner still exempt
          ORDER BY c.relname`,
      );
      // Before 0002 this returned exactly [migration_discovery, migration_status].
      expect(
        rows.map((r) => r.relname),
        'these tables ENABLE row security but exempt their owner — add FORCE in a migration',
      ).toEqual([]);
    } finally {
      conn.release();
    }
  }, 30_000);
});

describe('FORCE, demonstrated on the deployment shape it exists for', () => {
  it('binds a non-superuser OWNER of migration_discovery to the tenant policies', async () => {
    // A separate throwaway database: this test mutates table ownership, which
    // must never leak into the suite-wide instance above. Role app_user on the
    // DRIVER, because `withTenant` is what applies it — migrations below still
    // run as the owner, since they acquire the connection directly.
    const scratch = pgliteDriver({ role: 'app_user' });
    try {
      await runMigrations({ driver: scratch, logger: () => {} });
      const conn = await scratch.acquire();
      try {
        // Two tenants' discovery rows, seeded as the superuser. The FK chain
        // (connection → mailboxes → mapping) exists because migration_discovery
        // references a real mapping — the same chain the bench seeds.
        for (const [i, [t, name]] of (
          [
            [TENANT_A, 'A'],
            [TENANT_B, 'B'],
          ] as const
        ).entries()) {
          const cid = `5d3b0000-e29b-41d4-a716-4466554416${i}1`;
          const src = `5d3b0000-e29b-41d4-a716-4466554416${i}2`;
          const dst = `5d3b0000-e29b-41d4-a716-4466554416${i}3`;
          const map = `5d3b0000-e29b-41d4-a716-4466554416${i}4`;
          await conn.query(`INSERT INTO tenant (id, name) VALUES ($1, $2)`, [t, name]);
          await conn.query(
            `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
             VALUES ($1,$2,'source','imap',$3,'{}'::jsonb,'connected')`,
            [cid, t, name],
          );
          for (const [id, addr] of [
            [src, `src-${name}@force.local`],
            [dst, `dst-${name}@force.local`],
          ]) {
            await conn.query(
              `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, primary_address, display_name, status)
               VALUES ($1,$2,$3,$4,'user',$4,$4,'active')`,
              [id, t, cid, addr],
            );
          }
          await conn.query(
            `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
             VALUES ($1,$2,$3,$4,'mirror','active')`,
            [map, t, src, dst],
          );
          await conn.query(
            `INSERT INTO migration_discovery (tenant_id, mapping_id, domain)
             VALUES ($1, $2, 'email')`,
            [t, map],
          );
        }
        // The shape under test: app_user OWNS the table, as an operator's
        // ordinary non-superuser database user would own everything the
        // appliance migrated into their server.
        await conn.exec('ALTER TABLE public.migration_discovery OWNER TO app_user');
      } finally {
        conn.release();
      }

      // Served exactly as the appliance serves: withTenant drops to app_user —
      // who is now the OWNER. Without FORCE, ownership would trump every
      // policy and both tenants' rows would come back.
      const seen = await withTenant(scratch, TENANT_A, async (db) => {
        const res = await db.execute<{ tenant_id: string }>(
          'SELECT tenant_id FROM migration_discovery',
        );
        return res.rows as Array<{ tenant_id: string }>;
      });
      expect(seen).toHaveLength(1);
      expect(seen[0]!.tenant_id).toBe(TENANT_A);
    } finally {
      await scratch.end();
    }
  }, 120_000);
});
