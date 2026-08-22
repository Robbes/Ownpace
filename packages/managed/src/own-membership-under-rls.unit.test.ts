// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * "Which tenants do I belong to?" — the one question the isolation model could
 * not answer, and the policy that answers it (ADR-0042, migration 0003).
 *
 * Every policy on `tenant_member` keys on `app.current_tenant`, so reading it
 * required already knowing the tenant. `withSubject` sets `app.current_user`
 * instead and `own_membership_select` matches on it.
 *
 * The whole value of this file is the SECOND half: a new permissive policy is an
 * OR, so the thing to prove is not only that it opens what it should, but that
 * it opens nothing else. Both halves are asserted against `app_user` — the role
 * the API's request path really connects as (`pgliteDriver({ role: 'app_user' })`,
 * workplan 0011 T1) — because a policy checked on an owner connection proves
 * nothing at all: Postgres exempts owners and superusers from row security.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { pgliteDriver, runMigrations, withTenant, withSubject } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from './migrate-managed.ts';

// UUID family 0117…, unused elsewhere in the repo.
const TENANT_A = '01170000-e29b-41d4-a716-446655442001';
const TENANT_B = '01170000-e29b-41d4-a716-446655442002';
const ALICE = 'sub-alice';
const BOB = 'sub-bob';

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
  // Seeded as the owner, which is how these rows can exist at all. Everything
  // asserted below goes through the served, unprivileged path.
  const conn = await driver.acquire();
  try {
    await conn.query('DELETE FROM tenant_member');
    await conn.query('DELETE FROM tenant');
    for (const [id, name] of [
      [TENANT_A, 'A'],
      [TENANT_B, 'B'],
    ]) {
      await conn.query(`INSERT INTO tenant (id, name, status) VALUES ($1,$2,'active')`, [id, name]);
    }
    // Alice is in both tenants, with different roles. Bob is in one.
    await conn.query(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status) VALUES
         ($1,$3,'alice@example.test','owner','active'),
         ($2,$3,'alice@example.test','viewer','active'),
         ($1,$4,'bob@example.test','admin','active')`,
      [TENANT_A, TENANT_B, ALICE, BOB],
    );
  } finally {
    conn.release();
  }
});

const rowsOf = (result: unknown): unknown[] =>
  (result as { rows?: unknown[] }).rows ?? (result as unknown[]);

/**
 * Every message in an error's `cause` chain, joined.
 *
 * Drizzle wraps the driver's error as "Failed query: …" and hangs the real one
 * off `cause`, so matching the wrapper alone would pass just as happily for a
 * syntax error as for the refusal being asserted.
 */
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

describe('a subject can read their own memberships, in every tenant', () => {
  it('answers the question the tenant-scoped policies cannot', async () => {
    const rows = await withSubject(driver, ALICE, async (db) =>
      rowsOf(await db.execute('SELECT tenant_id, role FROM tenant_member ORDER BY role')),
    );
    // Both of hers, with the role each tenant gave her — which is the point:
    // the role is per membership, not per person.
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => (r as { role: string }).role)).toEqual(['owner', 'viewer']);
  });

  it("shows a subject NOTHING of anybody else's", async () => {
    const rows = await withSubject(driver, BOB, async (db) =>
      rowsOf(await db.execute('SELECT user_id FROM tenant_member')),
    );
    expect(rows).toHaveLength(1);
    expect((rows[0] as { user_id: string }).user_id).toBe(BOB);
  });

  it('answers an unknown subject with nothing, not an error', async () => {
    // A token whose subject has never been invited is a 403 decided upstream,
    // not an exception from the database.
    const rows = await withSubject(driver, 'sub-nobody', async (db) =>
      rowsOf(await db.execute('SELECT user_id FROM tenant_member')),
    );
    expect(rows).toEqual([]);
  });
});

describe('the new policy opens nothing else', () => {
  it('leaves a tenant-scoped request seeing exactly what it saw before', async () => {
    // The regression that would matter: a permissive policy is an OR, so a
    // careless one widens every existing request. `app.current_user` is unset
    // here, and `current_setting(…, true)` answers NULL — `user_id = NULL` is
    // NULL, never true.
    const rows = await withTenant(driver, TENANT_A, async (db) =>
      rowsOf(await db.execute('SELECT user_id FROM tenant_member')),
    );
    // Tenant A's two members, and nothing from tenant B — including none of
    // Alice's tenant-B row, which the new policy WOULD have shown her.
    expect(rows).toHaveLength(2);
    expect((rows as Array<{ user_id: string }>).map((r) => r.user_id).sort()).toEqual([ALICE, BOB]);
  });

  it('opens ONE table, not the ledger — subject scope sets no tenant', async () => {
    // `withSubject` is not a back door. Every other table still requires
    // `app.current_tenant`, which it deliberately does not set.
    //
    // It comes back REFUSED rather than empty, and that is worth knowing rather
    // than smoothing over: the tenant-scoped policies cast the setting to uuid,
    // and a custom GUC that has been `SET LOCAL` earlier in the session lingers
    // as an empty string rather than reverting to NULL — so the cast raises
    // 22P02. Either outcome satisfies the rule this test is about; the reason to
    // assert BOTH is that a future reader hitting the error should find it
    // documented here instead of filing it as a bug.
    //
    // The consequence for callers: use `withSubject` for the membership lookup
    // and nothing else. It is not a lighter `withTenant`.
    const outcome = await withSubject(driver, ALICE, async (db) =>
      rowsOf(await db.execute('SELECT id FROM tenant')),
    ).then(
      (rows) => ({ rows }),
      (err: unknown) => ({ err }),
    );

    if ('rows' in outcome) {
      expect(outcome.rows, 'subject scope could read the tenant table').toEqual([]);
    } else {
      expect(reasons(outcome.err)).toMatch(/invalid input syntax for type uuid|permission denied/);
    }
  });

  it('cannot be used to CHANGE a membership, only to read one', async () => {
    // Reading which tenants you are in is a question about yourself. Promoting
    // yourself is not, and stays behind the tenant-scoped policies.
    const failure = await withSubject(driver, ALICE, (db) =>
      db.execute(`UPDATE tenant_member SET role = 'owner' WHERE user_id = '${ALICE}'`),
    ).then(
      () => null,
      (err: unknown) => err,
    );

    // Either the statement is refused outright or it matches no row; both are
    // "nothing changed", and which one Postgres picks is not this rule's
    // business. What must never happen is a role actually changing.
    const conn = await driver.acquire();
    try {
      const { rows } = await conn.query<{ role: string }>(
        `SELECT role FROM tenant_member WHERE user_id = $1 AND tenant_id = $2`,
        [ALICE, TENANT_B],
      );
      expect(rows[0]?.role, `alice promoted herself (${String(failure)})`).toBe('viewer');
    } finally {
      conn.release();
    }
  });
});
