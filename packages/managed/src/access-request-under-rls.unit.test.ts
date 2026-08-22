// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `access_request` is the one table in either chain with no `tenant_id` on the
 * way in, so `tenant_isolation_*` — the shape that protects everything else —
 * cannot be written for it. A request PRECEDES a tenant; that is what the row
 * is (workplan 0093 T1, migration 0002).
 *
 * What stands in for it: RLS on, exactly ONE policy, for INSERT. Anyone may
 * knock, and nobody holding a tenant token can read what anybody else wrote.
 * The privileged provisioning path connects as the DB OWNER, which RLS does not
 * apply to, and that asymmetry IS the access rule.
 *
 * Written as a test rather than a comment because it is the security property
 * of the whole feature, and because the shared chain's
 * `ALTER DEFAULT PRIVILEGES … GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO
 * app_user` sits waiting to undo half of it: a future table created without the
 * explicit REVOKE would be readable, and nothing would say so.
 *
 * Served as `app_user`, the role the API really runs as (`pgliteDriver({ role:
 * 'app_user' })`) — the same setup `offboarding-under-rls.unit.test.ts` uses,
 * and the reason both files exist: a policy asserted against the OWNER
 * connection proves nothing, because the owner bypasses RLS.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from './migrate-managed.ts';

// UUID family acce0000-…, unused elsewhere in the repo.
const TENANT = 'acce0000-e29b-41d4-a716-446655441901';
const OTHER = 'acce0000-e29b-41d4-a716-446655441902';

let driver: LedgerDriver;

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  // As the owner, which is how these rows can exist at all.
  const conn = await driver.acquire();
  try {
    await conn.query('DELETE FROM access_request');
    await conn.query('DELETE FROM tenant');
    await conn.query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'asked', 'active')`, [
      TENANT,
    ]);
  } finally {
    conn.release();
  }
});

describe('access_request under the role the API really uses', () => {
  it('exists, so every absence below is about policy and not a missing table', async () => {
    const conn = await driver.acquire();
    try {
      const { rows } = await conn.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'access_request'`,
      );
      expect(Number(rows[0]?.n)).toBeGreaterThan(5);
    } finally {
      conn.release();
    }
  }, 30_000);

  it('lets a stranger knock — an INSERT with no tenant context at all', async () => {
    // The public route has no tenant: nobody has been let in yet. This is the
    // one thing the table must allow, and the only policy it has.
    const conn = await driver.acquire();
    try {
      await conn.query(
        `INSERT INTO access_request (email, name, note, locale) VALUES ($1,$2,$3,$4)`,
        ['stranger@example.test', 'A Stranger', 'moving two mailboxes off Google', 'nl'],
      );
    } finally {
      conn.release();
    }

    // Read back as the OWNER — the privileged path — to prove it landed.
    const conn2 = await driver.acquire();
    try {
      const { rows } = await conn2.query<{ email: string; state: string; locale: string }>(
        `SELECT email, state, locale FROM access_request`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.email).toBe('stranger@example.test');
      // Open until a human decides. Nothing is granted by asking.
      expect(rows[0]?.state).toBe('open');
      expect(rows[0]?.locale).toBe('nl');
    } finally {
      conn2.release();
    }
  }, 30_000);

  it('shows a signed-in tenant NOTHING, with requests sitting right there', async () => {
    const conn = await driver.acquire();
    try {
      await conn.query(
        `INSERT INTO access_request (email, state, tenant_id, decided_by, decided_at)
         VALUES ($1,'granted',$2,'owner@ownpace.eu', now())`,
        ['granted@example.test', TENANT],
      );
      await conn.query(`INSERT INTO access_request (email) VALUES ($1)`, ['someone@example.test']);
    } finally {
      conn.release();
    }

    // THIS USED TO BE A REFUSAL, and the change is worth explaining rather than
    // discovering.
    //
    // Until migration 0005 `app_user` had no SELECT on this table at all, so a
    // tenant-scoped read raised `permission denied` before any policy was
    // consulted — belt and braces on top of the INSERT-only policy. That could
    // not survive an operator who reads the queue THROUGH the API, because a
    // GRANT is per-role and the operator and the tenant use the same
    // `app_user`. So the blanket REVOKE is gone and the policy is now the whole
    // of the defence (`operator_may_read`, keyed on `app.current_user`).
    //
    // The original assertion had a real argument behind it: `[]` is
    // indistinguishable from "there are no requests", so a day when the
    // protection had been quietly dropped would look exactly like a quiet day.
    // That argument is answered rather than abandoned — the rows are inserted
    // above and read back as the owner below, so an empty result here can ONLY
    // mean the policy filtered them. A dropped or widened policy fails this.
    // The other direction, that an operator DOES see them, is asserted in
    // `operator-under-rls.unit.test.ts`; between the two files there is no
    // state of the policies that passes both while doing nothing.
    for (const tenant of [TENANT, OTHER]) {
      const rows = await withTenant(driver, tenant, (db) =>
        db.execute('SELECT email FROM access_request'),
      );
      expect(rows.rows, `tenant ${tenant} could read access requests`).toHaveLength(0);
    }

    // The rows are really there. Without this the case above would pass on an
    // empty table, which is the failure mode the original refusal ruled out.
    const owner = await driver.acquire();
    try {
      const { rows } = await owner.query(`SELECT email FROM access_request`);
      expect(rows).toHaveLength(2);
    } finally {
      owner.release();
    }
  }, 30_000);

  it('refuses to call a request granted without naming the tenant it granted', async () => {
    // `granted` means a tenant was provisioned. A row claiming it without one
    // would make the owner's queue lie about what has been done.
    const conn = await driver.acquire();
    try {
      await expect(
        conn.query(
          `INSERT INTO access_request (email, state, decided_by, decided_at)
           VALUES ($1,'granted','owner@ownpace.eu', now())`,
          ['nope@example.test'],
        ),
      ).rejects.toThrow(/access_request_granted_tenant_check/);
    } finally {
      conn.release();
    }
  }, 30_000);

  it('refuses a decision with no decider, and an open row that claims one', async () => {
    const conn = await driver.acquire();
    try {
      await expect(
        conn.query(`INSERT INTO access_request (email, state) VALUES ($1,'declined')`, [
          'undecided@example.test',
        ]),
      ).rejects.toThrow(/access_request_decided_check/);
      await expect(
        conn.query(
          `INSERT INTO access_request (email, state, decided_at) VALUES ($1,'open', now())`,
          ['open-but-decided@example.test'],
        ),
      ).rejects.toThrow(/access_request_decided_check/);
    } finally {
      conn.release();
    }
  }, 30_000);
});
