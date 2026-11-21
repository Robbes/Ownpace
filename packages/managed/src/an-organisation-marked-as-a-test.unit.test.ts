// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ORGANISATION MARKED AS A TEST (workplan 0162 T1; managed migration 0062).
 *
 * The organisation's marker is a row of `test_organisation`, and every reader
 * and writer of it runs in the organisation's own scope, as `app_user`. On
 * PGlite with both chains:
 *
 *  - the table holds a marker the column a migration copies it into can hold
 *    (0070's CHECK) and nothing else: 3 to 64 characters, no control
 *    character, trimmed;
 *  - row security: one organisation can neither read nor write another's;
 *  - only an appointed operator writes it, in their own name, and the
 *    database says so: an `app_user` in the organisation's scope who is not
 *    one inserts, updates and deletes nothing, and still reads the marker, as
 *    the create door does;
 *  - set, replace, read and clear, each saying what it changed;
 *  - an organisation holds a migration while any `mailbox_mapping` row names
 *    it, whatever its status, a draft and a finished one alike;
 *  - the support views serve the organisation's marker and each migration's
 *    own, to an operator.
 *
 * UUID family 0162a100-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver, PgDatabase } from '@openmig/ledger';
import { runManagedMigrations } from './migrate-managed.ts';
import {
  markTestOrganisation,
  migrationsHeldBy,
  testMarkerOfOrganisation,
  unmarkTestOrganisation,
  holdsMigrationsSaid,
} from './test-organisation.ts';

const TENANT_A = '0162a100-e29b-41d4-a716-446655440001';
const TENANT_B = '0162a100-e29b-41d4-a716-446655440002';
const CONN = '0162a100-e29b-41d4-a716-446655440011';
const BOX = '0162a100-e29b-41d4-a716-446655440021';
const OPERATOR = 'operator-subject-0162-t1';
const NOT_OPERATOR = 'ordinary-subject-0162-t1';

let driver: LedgerDriver;

/** One statement as the owner, past row security: the witness. */
async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(text, params)).rows as T[];
  } finally {
    conn.release();
  }
}

/**
 * A statement in one organisation's own scope, as `app_user`, acting as `user`
 * when one is named, rolled back whatever it did: the error it met, or the rows
 * it returned, which for a write is the rows it touched (`RETURNING`).
 */
async function asTenant(
  tenant: string,
  text: string,
  params: unknown[] = [],
  user?: string,
): Promise<Error | { readonly touched: number; readonly rows: Record<string, unknown>[] }> {
  const conn = await driver.acquire();
  try {
    await conn.query('BEGIN');
    await conn.query('SET LOCAL ROLE app_user');
    await conn.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant]);
    if (user !== undefined) await conn.query(`SELECT set_config('app.current_user', $1, true)`, [user]);
    try {
      // What it touched is what it returned: every write below says RETURNING.
      const result = await conn.query(text, params);
      return { touched: result.rows.length, rows: result.rows as Record<string, unknown>[] };
    } catch (e) {
      return e as Error;
    }
  } finally {
    await conn.query('ROLLBACK');
    conn.release();
  }
}

const refusal = (outcome: Awaited<ReturnType<typeof asTenant>>): string | null =>
  outcome instanceof Error ? outcome.message : null;

/** In one organisation's scope, acting as the operator, as the doors do. */
const asOperatorIn = <T,>(tenant: string, fn: (db: PgDatabase) => Promise<T>) =>
  withTenant(driver, tenant, async (db) => {
    await db.execute(sql`SELECT set_config('app.current_user', ${OPERATOR}, true)`);
    return fn(db);
  });

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await q(`INSERT INTO platform_operator (user_id, email) VALUES ($1, 'operator@example.com')`, [OPERATOR]);
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  await q('DELETE FROM test_organisation');
  await q('DELETE FROM mailbox_mapping');
  await q('DELETE FROM mailbox');
  await q('DELETE FROM connection');
  await q('DELETE FROM tenant WHERE id IN ($1, $2)', [TENANT_A, TENANT_B]);
  await q(`INSERT INTO tenant (id, name, status) VALUES ($1, 'A', 'active'), ($2, 'B', 'active')`, [TENANT_A, TENANT_B]);
});

/** The operator's insert, in their own name, in A's scope. */
const insertMarker = (marker: string) =>
  asTenant(
    TENANT_A,
    `INSERT INTO test_organisation (tenant_id, marker, marked_by) VALUES ($1, $2, $3)`,
    [TENANT_A, marker, OPERATOR],
    OPERATOR,
  );

describe('the table holds what a migration can copy', () => {
  it('takes a marker of 3 to 64 characters, any of them printable', async () => {
    for (const marker of ['[Ownpace-test]', 'abc', 'a'.repeat(64), '🧪🧪🧪']) {
      expect(refusal(await insertMarker(marker)), JSON.stringify(marker)).toBeNull();
    }
  });

  it('refuses one too short, too long, with a control character, or untrimmed', async () => {
    for (const marker of ['ab', 'a'.repeat(65), '[Own\u0001pace]', '[Own\u007fpace]', '[Own\u0085pace]', ' [x-y]', '[x-y] ']) {
      expect(refusal(await insertMarker(marker)), JSON.stringify(marker)).toMatch(/test_organisation_marker_check/);
    }
  });
});

describe('each organisation reads and writes its own', () => {
  it('cannot read another organisation’s marker, or write one for it, even as an operator', async () => {
    await asOperatorIn(TENANT_A, (db) => markTestOrganisation(db, TENANT_A, '[Ownpace-test]', OPERATOR));
    expect(await withTenant(driver, TENANT_B, (db) => testMarkerOfOrganisation(db, TENANT_A))).toBeUndefined();
    expect(
      refusal(
        await asTenant(
          TENANT_B,
          `INSERT INTO test_organisation (tenant_id, marker, marked_by) VALUES ($1, 'abc', $2)`,
          [TENANT_A, OPERATOR],
          OPERATOR,
        ),
      ),
    ).toMatch(/row-level security/);
    expect(await asOperatorIn(TENANT_B, (db) => unmarkTestOrganisation(db, TENANT_A))).toEqual({ cleared: undefined });
    expect(await q(`SELECT marker FROM test_organisation WHERE tenant_id = $1`, [TENANT_A])).toEqual([
      { marker: '[Ownpace-test]' },
    ]);
  });
});

describe('only an appointed operator writes it, and the database says so', () => {
  const insert = (user: string | undefined, markedBy: string) =>
    asTenant(
      TENANT_A,
      `INSERT INTO test_organisation (tenant_id, marker, marked_by) VALUES ($1, '[Ownpace-test]', $2)`,
      [TENANT_A, markedBy],
      user,
    );

  it('refuses the insert of anybody who is not one, and of an operator in somebody else’s name', async () => {
    // Nobody named, and somebody who is not an appointed operator: the
    // organisation's own scope is not enough.
    expect(refusal(await insert(undefined, 'x'))).toMatch(/row-level security/);
    expect(refusal(await insert(NOT_OPERATOR, NOT_OPERATOR))).toMatch(/row-level security/);
    // An operator, in another subject's name.
    expect(refusal(await insert(OPERATOR, NOT_OPERATOR))).toMatch(/row-level security/);
    // An operator, in their own name.
    expect(refusal(await insert(OPERATOR, OPERATOR))).toBeNull();
    expect(await q(`SELECT 1 FROM test_organisation`)).toEqual([]);
  });

  it('lets anybody else change and clear nothing, and still read the marker the create reads', async () => {
    await asOperatorIn(TENANT_A, (db) => markTestOrganisation(db, TENANT_A, '[Ownpace-test]', OPERATOR));
    for (const user of [undefined, NOT_OPERATOR]) {
      const update = await asTenant(
        TENANT_A,
        `UPDATE test_organisation SET marker = 'changed', marked_by = $2 WHERE tenant_id = $1 RETURNING tenant_id`,
        [TENANT_A, user ?? 'x'],
        user,
      );
      expect(update, String(user)).toEqual({ touched: 0, rows: [] });
      const clear = await asTenant(
        TENANT_A,
        `DELETE FROM test_organisation WHERE tenant_id = $1 RETURNING tenant_id`,
        [TENANT_A],
        user,
      );
      expect(clear, String(user)).toEqual({ touched: 0, rows: [] });
      const read = await asTenant(TENANT_A, `SELECT marker FROM test_organisation WHERE tenant_id = $1`, [TENANT_A], user);
      expect(read, String(user)).toEqual({ touched: 1, rows: [{ marker: '[Ownpace-test]' }] });
    }
    // The operator changes it in somebody else's name: refused too.
    expect(
      refusal(
        await asTenant(
          TENANT_A,
          `UPDATE test_organisation SET marker = 'changed', marked_by = $2 WHERE tenant_id = $1`,
          [TENANT_A, NOT_OPERATOR],
          OPERATOR,
        ),
      ),
    ).toMatch(/row-level security/);
    expect(await q(`SELECT marker, marked_by FROM test_organisation WHERE tenant_id = $1`, [TENANT_A])).toEqual([
      { marker: '[Ownpace-test]', marked_by: OPERATOR },
    ]);
    // The same statements, as the operator in their own name: each touches the row.
    expect(
      await asTenant(
        TENANT_A,
        `UPDATE test_organisation SET marker = 'changed', marked_by = $2 WHERE tenant_id = $1 RETURNING tenant_id`,
        [TENANT_A, OPERATOR],
        OPERATOR,
      ),
    ).toEqual({ touched: 1, rows: [{ tenant_id: TENANT_A }] });
    expect(
      await asTenant(TENANT_A, `DELETE FROM test_organisation WHERE tenant_id = $1 RETURNING tenant_id`, [TENANT_A], OPERATOR),
    ).toEqual({ touched: 1, rows: [{ tenant_id: TENANT_A }] });
  });
});

describe('set, replace, read and clear', () => {
  it('says what each changed, and records who set it', async () => {
    const inA = <T,>(fn: (db: PgDatabase) => Promise<T>) => asOperatorIn(TENANT_A, fn);
    expect(await inA((db) => testMarkerOfOrganisation(db, TENANT_A))).toBeUndefined();
    expect(await inA((db) => markTestOrganisation(db, TENANT_A, '[Ownpace-test]', OPERATOR))).toEqual({
      replaced: undefined,
    });
    expect(await inA((db) => testMarkerOfOrganisation(db, TENANT_A))).toBe('[Ownpace-test]');
    expect(await inA((db) => markTestOrganisation(db, TENANT_A, '[Other-test]', OPERATOR))).toEqual({
      replaced: '[Ownpace-test]',
    });
    expect(await q(`SELECT marker, marked_by FROM test_organisation WHERE tenant_id = $1`, [TENANT_A])).toEqual([
      { marker: '[Other-test]', marked_by: OPERATOR },
    ]);
    expect(await inA((db) => unmarkTestOrganisation(db, TENANT_A))).toEqual({ cleared: '[Other-test]' });
    expect(await inA((db) => unmarkTestOrganisation(db, TENANT_A))).toEqual({ cleared: undefined });
    expect(await inA((db) => testMarkerOfOrganisation(db, TENANT_A))).toBeUndefined();
  });
});

describe('what an organisation holds', () => {
  it('counts every migration that names it, whatever its status', async () => {
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1, $2, 'source', 'imap', 'i', '{}'::jsonb, 'connected')`,
      [CONN, TENANT_A],
    );
    await q(`INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES ($1, $2, $3, 'user', 'a@example.com')`, [
      BOX,
      TENANT_A,
      CONN,
    ]);
    const held = (tenant: string) => withTenant(driver, tenant, (db) => migrationsHeldBy(db, tenant));
    expect(await held(TENANT_A)).toBe(0);
    let n = 0;
    for (const status of ['paused', 'done', 'active']) {
      n += 1;
      await q(`INSERT INTO mailbox_mapping (tenant_id, source_mailbox_id, status, target_folder_prefix) VALUES ($1, $2, $3, $4)`, [
        TENANT_A,
        BOX,
        status,
        `p${n}`,
      ]);
      expect(await held(TENANT_A), status).toBe(n);
    }
    // Another organisation's are not this one's.
    expect(await held(TENANT_B)).toBe(0);
  });

  it('says so in the sentence the Support screen shows', () => {
    expect(holdsMigrationsSaid(1, 'mark')).toMatch(/^It holds 1 migration: an organisation becomes a test only while it holds none/);
    expect(holdsMigrationsSaid(3, 'unmark')).toMatch(/^It holds 3 migrations: an organisation stops being a test only while it holds none/);
  });
});

describe('an answer that is not one is never read as none (hard rule 9)', () => {
  // Stand-ins for a database that answered nothing the doors could act on:
  // "no migrations" and "no marker" are answers a door writes on.
  const answering = (rows: unknown, executed: unknown) =>
    ({
      select: () => ({ from: () => ({ where: async () => rows }) }),
      execute: async () => executed,
    }) as unknown as PgDatabase;

  it('throws on a count that is no count, rather than read it as no migrations', async () => {
    for (const rows of [[], [{ held: '3' }], [{ held: 1 }, { held: 2 }], [{}]]) {
      await expect(migrationsHeldBy(answering(rows, { rows: [] }), TENANT_A), JSON.stringify(rows)).rejects.toThrow(
        /not one count/,
      );
    }
    expect(await migrationsHeldBy(answering([{ held: 2 }], { rows: [] }), TENANT_A)).toBe(2);
  });

  it('throws on an answer with no rows, or a marker that is not text, rather than read it as no marker', async () => {
    await expect(testMarkerOfOrganisation(answering([], {}), TENANT_A)).rejects.toThrow(/answered no rows/);
    await expect(testMarkerOfOrganisation(answering([], { rows: [{ marker: null }] }), TENANT_A)).rejects.toThrow(
      /not text/,
    );
    await expect(unmarkTestOrganisation(answering([], null), TENANT_A)).rejects.toThrow(/answered no rows/);
    expect(await testMarkerOfOrganisation(answering([], { rows: [] }), TENANT_A)).toBeUndefined();
  });
});

describe('the operator’s support views', () => {
  it('serve the organisation’s marker and each migration’s own, to an operator', async () => {
    await asOperatorIn(TENANT_A, (db) => markTestOrganisation(db, TENANT_A, '[Ownpace-test]', OPERATOR));
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1, $2, 'source', 'imap', 'i', '{}'::jsonb, 'connected')`,
      [CONN, TENANT_A],
    );
    await q(`INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES ($1, $2, $3, 'user', 'a@example.com')`, [
      BOX,
      TENANT_A,
      CONN,
    ]);
    await q(`INSERT INTO mailbox_mapping (tenant_id, source_mailbox_id, test_marker) VALUES ($1, $2, '[Ownpace-test]')`, [
      TENANT_A,
      BOX,
    ]);
    const asOperator = async (text: string, params: unknown[]) => {
      const conn = await driver.acquire();
      try {
        await conn.query('BEGIN');
        await conn.query('SET LOCAL ROLE app_user');
        await conn.query(`SELECT set_config('app.current_user', $1, true)`, [OPERATOR]);
        return (await conn.query(text, params)).rows;
      } finally {
        await conn.query('ROLLBACK');
        conn.release();
      }
    };
    expect(
      await asOperator(`SELECT tenant_id, test_marker FROM support_tenants WHERE tenant_id IN ($1, $2) ORDER BY tenant_name`, [
        TENANT_A,
        TENANT_B,
      ]),
    ).toEqual([
      { tenant_id: TENANT_A, test_marker: '[Ownpace-test]' },
      { tenant_id: TENANT_B, test_marker: null },
    ]);
    expect(await asOperator(`SELECT test_marker FROM support_tenant_migrations WHERE tenant_id = $1`, [TENANT_A])).toEqual([
      { test_marker: '[Ownpace-test]' },
    ]);
  });
});
