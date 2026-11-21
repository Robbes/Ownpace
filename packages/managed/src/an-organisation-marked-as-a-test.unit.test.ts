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
 *  - set, replace, read and clear, each saying what it changed;
 *  - an organisation holds a migration while any `mailbox_mapping` row names
 *    it, whatever its status, a draft and a finished one alike;
 *  - the support views serve the organisation's marker and each migration's
 *    own, to an operator.
 *
 * UUID family 0162a100-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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

/** A statement in one organisation's own scope, as `app_user`, rolled back whatever it did. */
async function asTenant(tenant: string, text: string, params: unknown[] = []): Promise<Error | null> {
  const conn = await driver.acquire();
  try {
    await conn.query('BEGIN');
    await conn.query('SET LOCAL ROLE app_user');
    await conn.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant]);
    try {
      await conn.query(text, params);
      return null;
    } catch (e) {
      return e as Error;
    }
  } finally {
    await conn.query('ROLLBACK');
    conn.release();
  }
}

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

const insertMarker = (marker: string) =>
  asTenant(TENANT_A, `INSERT INTO test_organisation (tenant_id, marker, marked_by) VALUES ($1, $2, 'x')`, [
    TENANT_A,
    marker,
  ]);

describe('the table holds what a migration can copy', () => {
  it('takes a marker of 3 to 64 characters, any of them printable', async () => {
    expect(await insertMarker('[Ownpace-test]')).toBeNull();
    expect(await insertMarker('abc')).toBeNull();
    expect(await insertMarker('a'.repeat(64))).toBeNull();
    expect(await insertMarker('🧪🧪🧪')).toBeNull();
  });

  it('refuses one too short, too long, with a control character, or untrimmed', async () => {
    for (const marker of ['ab', 'a'.repeat(65), '[Own\u0001pace]', '[Own\u007fpace]', '[Own\u0085pace]', ' [x-y]', '[x-y] ']) {
      expect((await insertMarker(marker))?.message, JSON.stringify(marker)).toMatch(/test_organisation_marker_check/);
    }
  });
});

describe('each organisation reads and writes its own', () => {
  it('cannot read another organisation’s marker, or write one for it', async () => {
    await withTenant(driver, TENANT_A, (db) => markTestOrganisation(db, TENANT_A, '[Ownpace-test]', OPERATOR));
    expect(await withTenant(driver, TENANT_B, (db) => testMarkerOfOrganisation(db, TENANT_A))).toBeUndefined();
    expect(
      (await asTenant(TENANT_B, `INSERT INTO test_organisation (tenant_id, marker, marked_by) VALUES ($1, 'abc', 'x')`, [TENANT_A]))
        ?.message,
    ).toMatch(/row-level security/);
    expect(await withTenant(driver, TENANT_B, (db) => unmarkTestOrganisation(db, TENANT_A))).toEqual({ cleared: undefined });
    expect(await q(`SELECT marker FROM test_organisation WHERE tenant_id = $1`, [TENANT_A])).toEqual([
      { marker: '[Ownpace-test]' },
    ]);
  });
});

describe('set, replace, read and clear', () => {
  it('says what each changed, and records who set it', async () => {
    const inA = <T,>(fn: (db: PgDatabase) => Promise<T>) => withTenant(driver, TENANT_A, fn);
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

describe('the operator’s support views', () => {
  it('serve the organisation’s marker and each migration’s own, to an operator', async () => {
    await withTenant(driver, TENANT_A, (db) => markTestOrganisation(db, TENANT_A, '[Ownpace-test]', OPERATOR));
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
