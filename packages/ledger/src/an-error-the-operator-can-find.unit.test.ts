// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ERROR THE OPERATOR CAN FIND (workplan 0129 T1): the table's half.
 *
 * Migration 0059 stores the application's errors and warnings as metadata only,
 * and holds that line itself: no message column, and a CHECK on each text
 * column that nothing personal fits. The application's role may write an event
 * and may not read one. These run the real migration chain on PGlite.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { pgliteDriver } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import { withTenant } from './db.ts';
import { appEvent } from './schema-pg.ts';
import { PgAppEventStore, appEventSinkOn } from './app-event-store.ts';
import type { LedgerDriver } from './driver.ts';

const TENANT = '0e230000-e29b-41d4-a716-446655440001';
const CONN = '0e230000-e29b-41d4-a716-446655440002';
const BOX = '0e230000-e29b-41d4-a716-446655440003';
const MAPPING = '0e230000-e29b-41d4-a716-446655440004';

let driver: LedgerDriver;

async function asOwner<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(sql, params)).rows as T[];
  } finally {
    conn.release();
  }
}

async function seed(): Promise<void> {
  await asOwner('INSERT INTO tenant (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING', [TENANT, 'A']);
  await asOwner(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
     VALUES ($1, $2, 'source', 'imap', 'A', '{}'::jsonb, 'connected') ON CONFLICT DO NOTHING`,
    [CONN, TENANT],
  );
  await asOwner(
    `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
     VALUES ($1, $2, $3, 'user', 'a@example.invalid') ON CONFLICT DO NOTHING`,
    [BOX, TENANT, CONN],
  );
  await asOwner(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status)
     VALUES ($1, $2, $3, 'paused') ON CONFLICT DO NOTHING`,
    [MAPPING, TENANT, BOX],
  );
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  await asOwner('DELETE FROM app_event');
  await seed();
});

const EVENT = {
  level: 'error' as const,
  event: 'sync.domain-failed',
  reference: '0a1b2c3d',
  tenantId: TENANT,
  mappingId: MAPPING,
  category: 'auth_expired' as const,
};

describe('an event, as the table keeps it', () => {
  it('is written by the process sink and read back as metadata', async () => {
    await appEventSinkOn(driver).record(EVENT);

    const rows = await asOwner<Record<string, unknown>>(
      'SELECT level, event, reference, tenant_id, mapping_id, category, at FROM app_event',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      level: 'error',
      event: 'sync.domain-failed',
      reference: '0a1b2c3d',
      tenant_id: TENANT,
      mapping_id: MAPPING,
      category: 'auth_expired',
    });
    expect(rows[0]!.at).toBeDefined();
  });

  it('has no column a message could go in', async () => {
    const columns = await asOwner<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'app_event' ORDER BY column_name`,
    );
    expect(columns.map((c) => c.column_name)).toEqual([
      'at',
      'category',
      'event',
      'id',
      'level',
      'mapping_id',
      'reference',
      'tenant_id',
    ]);
  });

  it('can belong to no customer: a request that failed before anybody signed in', async () => {
    await appEventSinkOn(driver).record({ level: 'warn', event: 'api.unhandled', reference: 'ffff0000' });

    const rows = await asOwner<{ tenant_id: string | null }>('SELECT tenant_id FROM app_event');
    expect(rows).toEqual([{ tenant_id: null }]);
  });
});

describe('the table refuses what is not metadata', () => {
  const insert = (level: string, event: string, reference: string, category: string | null) =>
    asOwner('INSERT INTO app_event (level, event, reference, category) VALUES ($1, $2, $3, $4)', [
      level,
      event,
      reference,
      category,
    ]);

  it.each([
    ['a sentence as the event', 'error', 'the sync failed', '0a1b2c3d', null],
    ['an address as the event', 'error', 'someone@example.invalid', '0a1b2c3d', null],
    ['a path as the event', 'error', 'Documents/report', '0a1b2c3d', null],
    ['a reference that is not eight hex characters', 'error', 'sync.failed', 'ref 0a1b', null],
    ['a sentence as the category', 'error', 'sync.failed', '0a1b2c3d', 'could not reach it'],
    ['a level other than warn or error', 'info', 'sync.failed', '0a1b2c3d', null],
  ])('refuses %s', async (_what, level, event, reference, category) => {
    await expect(insert(level, event, reference, category)).rejects.toThrow(/check constraint/i);
  });
});

describe("the application's role", () => {
  it('may write an event, inside a tenant session', async () => {
    await withTenant(driver, TENANT, (db) => new PgAppEventStore(db).record(EVENT));

    expect(await asOwner('SELECT 1 FROM app_event')).toHaveLength(1);
  });

  it('may not read one, not even its own', async () => {
    await appEventSinkOn(driver).record(EVENT);

    const refused = await withTenant(driver, TENANT, (db) => db.select().from(appEvent)).then(
      () => undefined,
      (err: Error & { cause?: Error }) => err,
    );
    // Drizzle wraps the database's answer; the refusal itself is the cause.
    expect(refused?.cause?.message ?? refused?.message).toMatch(/permission denied/i);
  });
});

describe('what happens to an event when what it names goes', () => {
  it('goes with the customer, when the customer is erased', async () => {
    await appEventSinkOn(driver).record(EVENT);

    await asOwner('DELETE FROM tenant WHERE id = $1', [TENANT]);

    expect(await asOwner('SELECT 1 FROM app_event')).toEqual([]);
  });

  it('stays, without its migration, when the migration is deleted', async () => {
    await appEventSinkOn(driver).record(EVENT);

    await asOwner('DELETE FROM mailbox_mapping WHERE id = $1', [MAPPING]);

    expect(await asOwner('SELECT tenant_id, mapping_id FROM app_event')).toEqual([
      { tenant_id: TENANT, mapping_id: null },
    ]);
  });
});
