// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MONTH OF THE APPLICATION'S ERRORS (workplan 0129 T3): `app_event` is
 * pruned at one month, the owner's decision (D2), and nothing else is.
 *
 * The page these rows serve (0129 T2) shows a month of the application's
 * errors and warnings beside all of the audit log, which is kept until the
 * customer is erased. So the negative assertion matters as much as the
 * positive one: a prune of `app_event` that reached `audit_log` would destroy
 * the records the owner decided to keep.
 *
 * Real Postgres via PGlite, the appliance's own factory, because the delete
 * picks its rows by `ctid`.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from './migrate.ts';
import { pruneAppEvents, DEFAULT_APP_EVENT_RETENTION_DAYS } from './retention.ts';
import { createPgliteDb } from './pglite-driver.ts';
import type { LedgerDriver, LedgerConnection } from './driver.ts';
import type { PgDatabase } from './db-types.ts';

// UUID family 0e2c0000-…, unused elsewhere in the repo.
const TENANT = '0e2c0000-e29b-41d4-a716-446655440001';

const NOW = new Date('2026-09-23T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

let driver: LedgerDriver;
let conn: LedgerConnection;
let db: PgDatabase;

const references = async (): Promise<string[]> => {
  const { rows } = await conn.query<{ reference: string }>(
    'SELECT reference FROM app_event ORDER BY reference',
  );
  return rows.map((r) => r.reference);
};

beforeAll(async () => {
  const made = await createPgliteDb({});
  driver = made.driver;
  db = made.db;
  await runMigrations({ driver, logger: () => {} });
  conn = await driver.acquire();
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  await conn.query('DELETE FROM app_event');
  await conn.query('DELETE FROM audit_log');
  await conn.query('DELETE FROM tenant');
  await conn.query(`INSERT INTO tenant (id, name, status) VALUES ($1, 't', 'active')`, [TENANT]);

  // A reference per age, so what survived reads as a list of ages.
  for (const [reference, age] of [
    ['0000000d', 1],
    ['0000001d', 29],
    ['0000002d', 31],
    ['0000003d', 400],
  ] as const) {
    await conn.query(
      `INSERT INTO app_event (level, tenant_id, event, reference, at)
       VALUES ('error', $1, 'sync.email.failed', $2, $3)`,
      [TENANT, reference, daysAgo(age)],
    );
  }
  await conn.query(
    `INSERT INTO audit_log (tenant_id, actor, action, at) VALUES ($1, 'system', 'mapping.status', $2)`,
    [TENANT, daysAgo(400)],
  );
});

describe('the application errors and warnings', () => {
  it('are kept for a month, and no longer', async () => {
    expect(DEFAULT_APP_EVENT_RETENTION_DAYS).toBe(30);

    const result = await pruneAppEvents(db, NOW);

    expect(result).toMatchObject({ deleted: 2, moreRemaining: false, cutoff: daysAgo(30) });
    expect(await references()).toEqual(['0000000d', '0000001d']);
  });

  it('go without taking the audit log with them, however old it is', async () => {
    await pruneAppEvents(db, NOW);

    const { rows } = await conn.query<{ n: string }>('SELECT count(*)::text AS n FROM audit_log');
    expect(rows[0]?.n).toBe('1');
  });

  it('go in bounded batches, and say so when the ceiling stopped them', async () => {
    const result = await pruneAppEvents(db, NOW, { batchSize: 1, maxBatches: 1 });

    expect(result).toMatchObject({ deleted: 1, moreRemaining: true });
    expect(await references()).toHaveLength(3);
  });

  it('cannot be pruned with a window of less than a day', async () => {
    await expect(pruneAppEvents(db, NOW, { olderThanDays: 0 })).rejects.toThrow(/at least one day/);
  });
});

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(join(HERE, '../../..', path), 'utf8');

describe('both editions prune them every night', () => {
  it.each([
    ['the appliance', 'apps/selfhost/src/index.ts'],
    ['the managed worker', 'apps/worker/src/jobs/managed-retention.ts'],
  ])('%s', (_who, path) => {
    expect(read(path)).toMatch(/await pruneAppEvents\(db, now\)/);
  });
});
