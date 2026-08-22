// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A pooled connection remembers, and `SET LOCAL` does not undo itself
 * (migration 0004).
 *
 * **This file exists because a sibling file was not enough.**
 * `own-membership-under-rls.unit.test.ts` proves the subject-scoped read works —
 * on a connection that has never held a tenant. Every REAL connection has: the
 * API serves tenant-scoped requests on a pool, and `GET /api/me` runs on
 * whichever connection comes back. So the sibling passed, CI's first served
 * request returned **500**, and the difference between them was one earlier
 * transaction.
 *
 * The mechanism is worth stating exactly, because "it reverts at COMMIT" is the
 * intuition that hides it: `SET LOCAL` does revert — to the SESSION value, which
 * for a custom setting that was never assigned at session level is the EMPTY
 * STRING, not unset. So `current_setting('app.current_tenant', true)` answers
 * `''` rather than NULL from the second transaction onwards, and `''::uuid` is
 * not a mismatch, it is an ERROR — raised inside a policy, which fails the
 * query, which is a 500.
 *
 * That matters here and not elsewhere because permissive policies are OR'd and
 * Postgres evaluates ALL of them: a subject-scoped read of `tenant_member` runs
 * the tenant policies too, whether or not they can match.
 *
 * So every case below runs a tenant-scoped transaction FIRST. Without that line
 * they all pass against the broken policies, which is precisely how this reached
 * CI.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { pgliteDriver, runMigrations, withTenant, withSubject } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from './migrate-managed.ts';

// UUID family 0118…, unused elsewhere in the repo.
const TENANT_A = '01180000-e29b-41d4-a716-446655442001';
const TENANT_B = '01180000-e29b-41d4-a716-446655442002';
const ALICE = 'sub-alice-decay';
const BOB = 'sub-bob-decay';

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
  const conn = await driver.acquire();
  try {
    await conn.query('DELETE FROM tenant_member');
    await conn.query('DELETE FROM tenant');
    await conn.query(
      `INSERT INTO tenant (id, name, status) VALUES ($1,'A','active'), ($2,'B','active')`,
      [TENANT_A, TENANT_B],
    );
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

/** The line that makes this file different from its sibling. */
const serveOneTenantScopedRequest = () =>
  withTenant(driver, TENANT_A, async (db) => db.execute('SELECT 1'));

const memberships = (userId: string) =>
  withSubject(driver, userId, async (db) =>
    db.execute(
      `SELECT tenant_id, role FROM tenant_member WHERE user_id = '${userId}' ORDER BY role`,
    ),
  );

describe('the setting a previous request left behind', () => {
  it('is the EMPTY STRING, not unset — which is the whole bug', async () => {
    await serveOneTenantScopedRequest();

    const conn = await driver.acquire();
    try {
      const { rows } = await conn.query<{ raw: string | null; safe: string | null }>(
        `SELECT current_setting('app.current_tenant', true) AS raw,
                NULLIF(current_setting('app.current_tenant', true), '') AS safe`,
      );
      // If this ever starts answering NULL, migration 0004 is no longer load
      // bearing and this file should say so rather than quietly still passing.
      expect(rows[0]?.raw).toBe('');
      expect(rows[0]?.safe).toBeNull();
    } finally {
      conn.release();
    }
  });

  it('cannot be cleared with set_config — the fix had to be in the policy', async () => {
    await serveOneTenantScopedRequest();

    const conn = await driver.acquire();
    try {
      await conn.query('BEGIN');
      await conn.query(`SELECT set_config('app.current_tenant', NULL, true)`);
      const { rows } = await conn.query<{ v: string | null }>(
        `SELECT current_setting('app.current_tenant', true) AS v`,
      );
      await conn.query('COMMIT');
      // Still ''. This is why `withSubject` cannot fix it on its own.
      expect(rows[0]?.v).toBe('');
    } finally {
      conn.release();
    }
  });
});

describe('a subject-scoped read on a connection that has served a tenant', () => {
  it('answers, rather than failing with a uuid syntax error', async () => {
    await serveOneTenantScopedRequest();

    const result = await memberships(ALICE);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => (r as { role: string }).role).sort()).toEqual([
      'owner',
      'viewer',
    ]);
  });

  it('still shows a subject NOTHING of anybody else’s', async () => {
    await serveOneTenantScopedRequest();

    const result = await withSubject(driver, ALICE, async (db) =>
      db.execute('SELECT user_id FROM tenant_member'),
    );
    // Alice is in TENANT_A, and so is Bob. The decayed tenant setting must not
    // become a key to that tenant's rows.
    expect(new Set(result.rows.map((r) => (r as { user_id: string }).user_id))).toEqual(
      new Set([ALICE]),
    );
  });

  it('holds when the two kinds of transaction alternate', async () => {
    // The pool hands connections back and forth; neither order may poison the
    // other. The reverse direction is safe for a different reason —
    // `app.current_user` is compared as text, so a decayed '' is a mismatch
    // rather than a cast error — and that is asserted rather than assumed.
    for (let i = 0; i < 3; i += 1) {
      await serveOneTenantScopedRequest();
      expect((await memberships(BOB)).rows).toHaveLength(1);
      const scoped = await withTenant(driver, TENANT_A, async (db) =>
        db.execute('SELECT user_id FROM tenant_member'),
      );
      expect(scoped.rows).toHaveLength(2);
    }
  });
});

describe('a tenant-scoped read after a subject-scoped one', () => {
  it('sees its own tenant and no more, with app.current_user left behind', async () => {
    await memberships(ALICE);

    const scoped = await withTenant(driver, TENANT_B, async (db) =>
      db.execute('SELECT user_id, tenant_id FROM tenant_member'),
    );
    // TENANT_B holds only Alice's viewer row. Bob is in A and must not appear
    // because `app.current_user` still reads as Alice's decayed ''.
    expect(scoped.rows).toHaveLength(1);
    expect((scoped.rows[0] as { user_id: string }).user_id).toBe(ALICE);
  });
});
