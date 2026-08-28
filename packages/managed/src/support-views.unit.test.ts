// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The operator's read model, against a real database (workplan 0110 T1 + T2).
 *
 * ## Why this file is unusually insistent
 *
 * These views bypass row security. That is deliberate — an operator has no
 * tenant, so a view honouring the tenant policy would return nothing and be
 * useless — but it means **there is no second net**. Everything rests on one
 * `EXISTS` against `platform_operator` inside every view. A view added later
 * without it is silently total access across every customer: no error, no log
 * line, nothing red.
 *
 * So the tests here are mostly about the FAILURE direction, and one of them is
 * about views that do not exist yet: `every support_ view carries the
 * predicate` reads the catalog and fails on any that does not, so a seventh
 * view cannot arrive quietly.
 *
 * ## The precondition, asserted rather than assumed
 *
 * The bypass works because a view runs with its OWNER's privileges and the
 * owner is the migrating superuser. That is a property of how this product is
 * deployed, not a law: on a database where migrations run as a non-superuser
 * owner, `FORCE ROW LEVEL SECURITY` would reach the view too and every operator
 * screen would go quietly empty. Fail-closed, but broken. `the mechanism these
 * views depend on` pins it, so a change in deployment model is a red test
 * rather than an empty screen.
 *
 * UUID family 5f5b0000-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pgliteDriver, runMigrations, withSubject } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from './migrate-managed.ts';
import { recordSupportRead } from './support-read-log.ts';
import { sql as rawSql } from 'drizzle-orm';

const TENANT_A = '5f5b0000-e29b-41d4-a716-446655442101';
const TENANT_B = '5f5b0000-e29b-41d4-a716-446655442102';
const CONN_A = '5f5b0000-e29b-41d4-a716-446655442111';
const BOX_A = '5f5b0000-e29b-41d4-a716-446655442121';
const MAPPING_A = '5f5b0000-e29b-41d4-a716-446655442131';
const OPERATOR = 'operator-subject-1';
const NOT_OPERATOR = 'ordinary-subject-2';

let driver: LedgerDriver;

/**
 * Read as `app_user` with a chosen `app.current_user` and NO tenant — an
 * operator's situation exactly. Inside an explicit transaction, because
 * `SET LOCAL` outside one is a no-op: the first version of this probe fooled
 * itself that way, reading everything as superuser and proving nothing.
 */
async function asSubject<T>(
  subject: string,
  fn: (q: (sql: string, p?: unknown[]) => Promise<{ rows: unknown[] }>) => Promise<T>,
): Promise<T> {
  const conn = await driver.acquire();
  try {
    const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
    await q('BEGIN');
    try {
      await q('SET LOCAL ROLE app_user');
      await q("SELECT set_config('app.current_user', $1, true)", [subject]);
      await q("SELECT set_config('app.current_tenant', '', true)");
      const out = await fn(q as never);
      await q('COMMIT');
      return out;
    } catch (e) {
      await q('ROLLBACK');
      throw e;
    }
  } finally {
    await conn.release();
  }
}

const count = async (subject: string, view: string): Promise<number> =>
  asSubject(subject, async (q) => {
    const r = await q(`SELECT count(*)::int AS n FROM public.${view}`);
    return (r.rows[0] as { n: number }).n;
  });

/** Every view this migration added, read from the catalog rather than listed. */
const SUPPORT_VIEWS = [
  'support_tenants',
  'support_tenant_connections',
  'support_tenant_migrations',
  'support_tenant_invoices',
  'support_migration_domains',
] as const;

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });

  const conn = await driver.acquire();
  try {
    const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
    for (const [id, name] of [
      [TENANT_A, 'Alpha'],
      [TENANT_B, 'Beta'],
    ]) {
      await q('INSERT INTO tenant (id, name) VALUES ($1,$2)', [id, name]);
    }
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
       VALUES ($1,$2,'source','imap','Alpha mail','{"host":"secret.internal"}'::jsonb,'connected','ref')`,
      [CONN_A, TENANT_A],
    );
    await q(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
       VALUES ($1,$2,$3,'user','someone@example.invalid')`,
      [BOX_A, TENANT_A, CONN_A],
    );
    await q(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status, name)
       VALUES ($1,$2,$3,'active','Alpha migration')`,
      [MAPPING_A, TENANT_A, BOX_A],
    );
    await q(
      `INSERT INTO migration_status (id, tenant_id, mapping_id, domain, state, last_error, last_error_category)
       VALUES (gen_random_uuid(),$1,$2,'email','failed',$3,'auth_expired')`,
      [TENANT_A, MAPPING_A, 'IMAP login failed for someone@example.invalid'],
    );
    await q('INSERT INTO platform_operator (user_id, email) VALUES ($1,$2)', [
      OPERATOR,
      'rob@example.invalid',
    ]);
  } finally {
    await conn.release();
  }
});

afterAll(async () => {
  await driver.end?.();
});

describe('the mechanism these views depend on', () => {
  it('a view crosses row security where a DIRECT read does not', async () => {
    // The precondition, pinned. If migrations ever run as a non-superuser
    // owner, FORCE ROW LEVEL SECURITY reaches the view too and every operator
    // screen goes quietly empty — fail-closed, but broken. This says so first.
    const direct = await asSubject(OPERATOR, async (q) => {
      const r = await q('SELECT count(*)::int AS n FROM public.tenant');
      return (r.rows[0] as { n: number }).n;
    });
    expect(direct, 'a direct read must still be blocked by RLS').toBe(0);
    expect(await count(OPERATOR, 'support_tenants')).toBeGreaterThan(0);
  });
});

describe('not an operator, no rows — every view, by name', () => {
  it.each(SUPPORT_VIEWS)('%s returns nothing to an ordinary subject', async (view) => {
    expect(await count(NOT_OPERATOR, view)).toBe(0);
  });

  it.each(SUPPORT_VIEWS)('%s returns nothing when app.current_user is unset', async (view) => {
    // The decayed-GUC case migration 0004 exists for: on a pooled connection
    // `app.current_user` reads as the empty string. It must be a refusal, not
    // an error and certainly not a match.
    expect(await count('', view)).toBe(0);
  });
});

describe('an operator sees metadata, and only metadata', () => {
  it('sees both organisations, with counts', async () => {
    const rows = await asSubject(OPERATOR, async (q) => {
      const r = await q(
        'SELECT tenant_name, migration_count, failing_domain_count FROM public.support_tenants ORDER BY tenant_name',
      );
      return r.rows as Array<{
        tenant_name: string;
        migration_count: string;
        failing_domain_count: string;
      }>;
    });
    expect(rows.map((r) => r.tenant_name)).toEqual(['Alpha', 'Beta']);
    expect(Number(rows[0]?.migration_count)).toBe(1);
    expect(Number(rows[0]?.failing_domain_count)).toBe(1);
  });

  it('CANNOT reach last_error, however it asks', async () => {
    // The column list is the boundary. This is the field an operator most
    // wants and may not have: it is free provider prose and the fixture's
    // carries an address on purpose.
    await expect(
      asSubject(OPERATOR, (q) =>
        q('SELECT last_error FROM public.support_migration_domains'),
      ),
    ).rejects.toThrow();
  });

  it('sees the failure CATEGORY instead, which is why 0110 T3 came first', async () => {
    const rows = await asSubject(OPERATOR, async (q) => {
      const r = await q(
        'SELECT domain, state, last_error_category FROM public.support_migration_domains',
      );
      return r.rows as Array<{ state: string; last_error_category: string }>;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: 'failed', last_error_category: 'auth_expired' });
  });

  it('CANNOT reach a connection secret or its config', async () => {
    for (const column of ['secret_ref', 'encrypted_credentials', 'config']) {
      await expect(
        asSubject(OPERATOR, (q) =>
          q(`SELECT ${column} FROM public.support_tenant_connections`),
        ),
        `${column} must not be reachable`,
      ).rejects.toThrow();
    }
  });

  it('CANNOT reach anything about the items being migrated', async () => {
    // No view over `item`, `collection_mapping` or `mailbox`. A screen that
    // lists items is a screen that shows subject lines.
    for (const view of ['support_items', 'support_mailboxes', 'support_collections']) {
      await expect(
        asSubject(OPERATOR, (q) => q(`SELECT 1 FROM public.${view}`)),
      ).rejects.toThrow();
    }
  });
});

describe('a view cannot arrive without the predicate', () => {
  it('every support_ view in the schema checks platform_operator', async () => {
    // The one that guards views nobody has written yet. A support view added
    // later without this predicate is total access across every customer, with
    // nothing red to notice — so the catalog is read rather than a hand-kept
    // list, and the hand-kept list is checked against it too.
    const conn = await driver.acquire();
    try {
      const r = await conn.query(
        "SELECT viewname, definition FROM pg_views WHERE viewname LIKE 'support%'",
      );
      const rows = r.rows as Array<{ viewname: string; definition: string }>;
      expect(rows.length, 'no support views found — this test would pass vacuously').toBe(
        SUPPORT_VIEWS.length,
      );
      expect(rows.map((v) => v.viewname).sort()).toEqual([...SUPPORT_VIEWS].sort());
      for (const v of rows) {
        expect(
          v.definition,
          `${v.viewname} does not check platform_operator — it would return every ` +
            "customer's rows to any signed-in caller",
        ).toContain('platform_operator');
        expect(v.definition, `${v.viewname} does not read app.current_user`).toContain(
          'app.current_user',
        );
      }
    } finally {
      await conn.release();
    }
  });
});


describe('the log that has to earn standing access', () => {
  /** What this subject can see of `support_read` — their own reads, per policy. */
  const myReads = (subject: string) =>
    asSubject(subject, async (q) => {
      const r = await q(
        'SELECT operator_user_id, tenant_id, view_name FROM public.support_read ORDER BY at',
      );
      return r.rows as Array<{
        operator_user_id: string;
        tenant_id: string | null;
        view_name: string;
      }>;
    });

  it('records who looked at whose, and which screen', async () => {
    // Through the REAL helper and the real subject-scoped handle — the point
    // being that the recorder writes, not that an INSERT works.
    await withSubject(driver, OPERATOR, (db) =>
      recordSupportRead(db, { operatorUserId: OPERATOR, tenantId: TENANT_A, view: 'tenant' }),
    );

    const rows = await myReads(OPERATOR);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      operator_user_id: OPERATOR,
      tenant_id: TENANT_A,
      view_name: 'tenant',
    });
  });

  it('records the tenant LIST as one read of everybody, not N reads', async () => {
    await withSubject(driver, OPERATOR, (db) =>
      recordSupportRead(db, { operatorUserId: OPERATOR, tenantId: null, view: 'tenants' }),
    );
    const rows = await myReads(OPERATOR);
    expect(rows.filter((r) => r.view_name === 'tenants')).toHaveLength(1);
    // NULL rather than a row per organisation: one decision was made, and a
    // row per tenant would be a lie about how many.
    expect(rows.find((r) => r.view_name === 'tenants')?.tenant_id).toBeNull();
  });

  it("an operator cannot survey ANOTHER subject's reads", async () => {
    // A log somebody can browse tells them what their colleagues are
    // investigating, which is not what it is for.
    expect(await myReads(NOT_OPERATOR)).toEqual([]);
  });

  it('is append-only: UPDATE and DELETE are refused', async () => {
    await expect(
      withSubject(driver, OPERATOR, (db) =>
        db.execute(rawSql.raw("UPDATE support_read SET view_name = 'tenants'")),
      ),
    ).rejects.toThrow();
    await expect(
      withSubject(driver, OPERATOR, (db) => db.execute(rawSql.raw('DELETE FROM support_read'))),
    ).rejects.toThrow();
  });

  it('refuses a fourth screen name — the vocabulary IS the surface', async () => {
    await expect(
      withSubject(driver, OPERATOR, (db) =>
        db.execute(
          rawSql.raw(
            `INSERT INTO support_read (operator_user_id, view_name) VALUES ('${OPERATOR}','items')`,
          ),
        ),
      ),
    ).rejects.toThrow();
  });

  it('a NON-operator writes nothing to the log, and is told nothing', async () => {
    // The middleware in front of the support routes asks only for a valid
    // token. The views already return zero rows to a non-operator; without a
    // guard here they could still write into the log, polluting the one record
    // standing in for the consent that was dropped. No error — there is no
    // failure, only an absence.
    await withSubject(driver, NOT_OPERATOR, (db) =>
      recordSupportRead(db, {
        operatorUserId: NOT_OPERATOR,
        tenantId: TENANT_A,
        view: 'tenant',
      }),
    );
    const conn = await driver.acquire();
    try {
      const r = await conn.query('SELECT count(*)::int AS n FROM support_read WHERE operator_user_id = $1', [
        NOT_OPERATOR,
      ]);
      expect((r.rows[0] as { n: number }).n).toBe(0);
    } finally {
      await conn.release();
    }
  });

  it('refuses to record a read attributed to nobody', async () => {
    // The decayed-GUC case migration 0004 exists for. A row attributing a read
    // to no subject makes the log look complete while an unattributable read
    // passed through it — worse than no row at all.
    await expect(
      withSubject(driver, OPERATOR, (db) =>
        recordSupportRead(db, { operatorUserId: '', tenantId: null, view: 'tenants' }),
      ),
    ).rejects.toThrow(/unattributable/);
  });
});
