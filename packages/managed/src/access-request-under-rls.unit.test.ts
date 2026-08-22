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

/** Every message in an error's `cause` chain, joined — see the SELECT case. */
function reasons(err: unknown): string {
  const out: string[] = [];
  let current: unknown = err;
  while (current instanceof Error) {
    out.push(current.message);
    current = current.cause;
  }
  if (typeof current === 'object' && current !== null && 'message' in current) {
    out.push(String((current as { message: unknown }).message));
  }
  return out.join(' | ');
}

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

  it('REFUSES a signed-in tenant the read outright — not an empty result', async () => {
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

    // The two protections are not redundant, and this is where the difference
    // shows: the REVOKE fires BEFORE the policy is ever consulted, so a
    // tenant-scoped request thread — the only kind the API serves — gets
    // `permission denied for table access_request` rather than a filtered view.
    //
    // Asserted as a refusal rather than as `[]` deliberately. An empty result
    // is indistinguishable from "there are no requests", so a day when the
    // REVOKE and the policy were both quietly dropped would look exactly like a
    // quiet day. A permission error cannot be mistaken for anything.
    for (const tenant of [TENANT, OTHER]) {
      const failure = await withTenant(driver, tenant, (db) =>
        db.execute('SELECT email FROM access_request'),
      ).then(
        (rows) => ({ read: rows }),
        (err: unknown) => ({ err }),
      );

      expect(
        failure,
        `tenant ${tenant} could read access requests — the REVOKE and the INSERT-only policy are gone`,
      ).not.toHaveProperty('read');

      // Drizzle wraps the driver's error ("Failed query: …") and hangs the real
      // one off `cause`, so the reason has to be read from the chain — matching
      // the wrapper alone would pass for a syntax error just as happily.
      expect(reasons(('err' in failure ? failure.err : undefined))).toContain(
        'permission denied for table access_request',
      );
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
