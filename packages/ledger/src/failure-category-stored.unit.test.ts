// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The category is actually WRITTEN, and cleared, against a real database
 * (workplan 0110 T3).
 *
 * `failure-category.unit.test.ts` proves the classifier. This proves the store
 * acts on it — the gap that has been real three times in this repository: a
 * value computed correctly and dropped between the function and the row. A
 * classifier is a pure function and stays green whether or not `markFailed`
 * ever calls it, so the table is asked directly.
 *
 * PGlite as `app_user`, through the real migrations, so the column, its RLS
 * and its nullability are the product's rather than a fixture's.
 *
 * UUID family 5f570000-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { pgliteDriver, runMigrations, withTenant } from './index.ts';
import type { LedgerDriver } from './index.ts';
import { PgMigrationStatusStore } from './migration-status-store.ts';
import type { MappingId, TenantId } from '@openmig/shared';

const TENANT = '5f570000-e29b-41d4-a716-446655442001' as TenantId;
const CONN = '5f570000-e29b-41d4-a716-446655442011';
const BOX = '5f570000-e29b-41d4-a716-446655442021';
const MAPPING = '5f570000-e29b-41d4-a716-446655442031' as MappingId;

let driver: LedgerDriver;

/** Read the column directly, outside the store, as superuser-free app_user. */
async function storedCategory(): Promise<string | null> {
  const conn = await driver.acquire();
  try {
    const r = await conn.query(
      'SELECT last_error, last_error_category FROM migration_status WHERE mapping_id = $1',
      [MAPPING],
    );
    const row = r.rows[0] as { last_error_category: string | null } | undefined;
    return row ? row.last_error_category : null;
  } finally {
    await conn.release();
  }
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  const conn = await driver.acquire();
  try {
    const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
    await q('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'classified']);
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1,$2,'source','imap','i','{}'::jsonb,'connected')`,
      [CONN, TENANT],
    );
    await q(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
       VALUES ($1,$2,$3,'user','m@example.invalid')`,
      [BOX, TENANT, CONN],
    );
    await q(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status)
       VALUES ($1,$2,$3,'active')`,
      [MAPPING, TENANT, BOX],
    );
  } finally {
    await conn.release();
  }
});

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  const conn = await driver.acquire();
  try {
    await conn.query('DELETE FROM migration_status WHERE mapping_id = $1', [MAPPING]);
  } finally {
    await conn.release();
  }
});

const store = (db: ConstructorParameters<typeof PgMigrationStatusStore>[0]) =>
  new PgMigrationStatusStore(db);

describe('markFailed stores the category beside the prose', () => {
  it('classifies and writes it, and keeps last_error VERBATIM', async () => {
    const raw =
      'Google refused the token request (400): {"error":"invalid_grant",' +
      '"error_description":"Token has been expired or revoked."}';
    await withTenant(driver, TENANT, async (db) => {
      const s = store(db);
      await s.initDomainStatus(TENANT, MAPPING, 'email');
      await s.markFailed(TENANT, MAPPING, 'email', raw);
    });

    expect(await storedCategory()).toBe('auth_expired');

    const conn = await driver.acquire();
    try {
      const r = await conn.query('SELECT last_error FROM migration_status WHERE mapping_id = $1', [
        MAPPING,
      ]);
      // The prose boundary: not summarised, not truncated, not replaced.
      expect((r.rows[0] as { last_error: string }).last_error).toBe(raw);
    } finally {
      await conn.release();
    }
  });

  it("writes 'unknown' rather than NULL when nothing matched", async () => {
    // NULL means "nothing has failed"; 'unknown' means "something failed and
    // we could not say what". A screen must be able to tell those apart.
    await withTenant(driver, TENANT, async (db) => {
      const s = store(db);
      await s.initDomainStatus(TENANT, MAPPING, 'email');
      await s.markFailed(TENANT, MAPPING, 'email', 'the frobnicator declined');
    });
    expect(await storedCategory()).toBe('unknown');
  });

  it('is NULL before anything has failed', async () => {
    await withTenant(driver, TENANT, async (db) => {
      await store(db).initDomainStatus(TENANT, MAPPING, 'email');
    });
    expect(await storedCategory()).toBeNull();
  });

  it('is CLEARED when the domain succeeds — a category must not outlive its failure', async () => {
    await withTenant(driver, TENANT, async (db) => {
      const s = store(db);
      await s.initDomainStatus(TENANT, MAPPING, 'email');
      await s.markFailed(TENANT, MAPPING, 'email', '429 too many requests');
    });
    expect(await storedCategory()).toBe('rate_limited');

    await withTenant(driver, TENANT, async (db) => {
      await store(db).markCompleted(TENANT, MAPPING, 'email');
    });
    // Otherwise a green screen carries last week's red sentence.
    expect(await storedCategory()).toBeNull();
  });
});
