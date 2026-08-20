// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Retention deletes the logs and nothing else (workplan 0082 T2).
 *
 * The interesting assertions here are the negative ones. A pruner is easy to
 * write and easy to write slightly too widely, and the cost of "slightly too
 * wide" is not a slow query — it is destroyed data. So most of this file is
 * about what survives:
 *
 *  - `item` rows, because deleting one does not reclaim space, it tells the
 *    next pass to copy that item again and duplicate it in the target;
 *  - `audit_log`, whose retention period is a compliance question with a legal
 *    answer, deliberately left to the owner;
 *  - `run` rows, which are the answer to "when did this last work";
 *  - the log of anything still RUNNING, however old — a pass that has outlived
 *    the window is exactly the one somebody is about to ask about.
 *
 * Real Postgres via PGlite, because the delete uses `ctid` and a subquery join
 * and neither is worth asserting against a mock.
 */

import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { runMigrations } from './migrate.ts';
import {
  pruneRunEvents,
  retentionDaysFromEnv,
  DEFAULT_RUN_EVENT_RETENTION_DAYS,
} from './retention.ts';
import { createPgliteDb } from './pglite-driver.ts';
import type { LedgerDriver, LedgerConnection } from './driver.ts';
import type { PgDatabase } from './db-types.ts';

// UUID family 5a9b0000-…, unused elsewhere in the repo.
const TENANT = '5a9b0000-e29b-41d4-a716-446655441501';
const CONNECTION = '5a9b0000-e29b-41d4-a716-446655441511';
const SRC = '5a9b0000-e29b-41d4-a716-446655441521';
const DST = '5a9b0000-e29b-41d4-a716-446655441522';
const MAPPING = '5a9b0000-e29b-41d4-a716-446655441531';
const OLD_RUN = '5a9b0000-e29b-41d4-a716-446655441541';
const FRESH_RUN = '5a9b0000-e29b-41d4-a716-446655441542';
const STILL_RUNNING = '5a9b0000-e29b-41d4-a716-446655441543';
const ITEM = '5a9b0000-e29b-41d4-a716-446655441551';

const NOW = new Date('2026-08-18T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

let driver: LedgerDriver;
let conn: LedgerConnection;
let db: PgDatabase;

async function count(table: string): Promise<number> {
  const { rows } = await conn.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`);
  return Number(rows[0]?.n ?? '0');
}

beforeAll(async () => {
  // The appliance's own factory, so the drizzle handle under test is the one
  // the appliance runs — which is what makes the `affectedRows` spelling in
  // `rowCount()` a real code path rather than a defensive guess.
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
  await conn.query('DELETE FROM run_event');
  await conn.query('DELETE FROM item');
  await conn.query('DELETE FROM audit_log');
  await conn.query('DELETE FROM run');
  await conn.query('DELETE FROM mailbox_mapping');
  await conn.query('DELETE FROM mailbox');
  await conn.query('DELETE FROM connection');
  await conn.query('DELETE FROM tenant');

  await conn.query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'r', 'active')`, [TENANT]);
  await conn.query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name)
     VALUES ($1, $2, 'source', 'imap', 'fixture')`,
    [CONNECTION, TENANT],
  );
  for (const [id, ext] of [[SRC, 's'], [DST, 't']] as const) {
    await conn.query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, external_id) VALUES ($1, $2, $3, $4)`,
      [id, TENANT, CONNECTION, ext],
    );
  }
  await conn.query(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status, mode, pattern)
     VALUES ($1, $2, $3, $4, 'active', 'mirror', 'shared_s')`,
    [MAPPING, TENANT, SRC, DST],
  );

  for (const [id, status] of [
    [OLD_RUN, 'succeeded'],
    [FRESH_RUN, 'succeeded'],
    [STILL_RUNNING, 'running'],
  ] as const) {
    await conn.query(
      `INSERT INTO run (id, tenant_id, mapping_id, kind, status) VALUES ($1, $2, $3, 'incremental', $4)`,
      [id, TENANT, MAPPING, status],
    );
  }

  // One ancient log line per run, plus one recent one on the old run.
  for (const [runId, at] of [
    [OLD_RUN, daysAgo(400)],
    [STILL_RUNNING, daysAgo(400)],
    [FRESH_RUN, daysAgo(1)],
  ] as const) {
    await conn.query(
      `INSERT INTO run_event (tenant_id, run_id, level, message, at) VALUES ($1, $2, 'info', 'x', $3)`,
      [TENANT, runId, at],
    );
  }
  await conn.query(
    `INSERT INTO run_event (tenant_id, run_id, level, message, at) VALUES ($1, $2, 'info', 'recent', $3)`,
    [TENANT, OLD_RUN, daysAgo(2)],
  );

  await conn.query(
    `INSERT INTO item (id, tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash, last_synced_at)
     VALUES ($1, $2, $3, 'email', 'INBOX', 'k', 'h', $4)`,
    [ITEM, TENANT, MAPPING, daysAgo(400)],
  );
  await conn.query(
    `INSERT INTO audit_log (tenant_id, actor, action, at) VALUES ($1, 'someone', 'did.a.thing', $2)`,
    [TENANT, daysAgo(400)],
  );
});

describe('pruneRunEvents', () => {
  it('deletes only the log lines older than the window', async () => {
    const result = await pruneRunEvents(db, NOW);
    // The 400-day line on the finished run, and nothing else.
    expect(result.deleted).toBe(1);
    expect(result.moreRemaining).toBe(false);
    expect(await count('run_event')).toBe(3);
  });

  it('keeps the log of a run that is still going, however old it is', async () => {
    await pruneRunEvents(db, NOW);
    const { rows } = await conn.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM run_event WHERE run_id = $1`,
      [STILL_RUNNING],
    );
    // A pass that has outlived the retention window is the one somebody is
    // about to ask about — pruning its log is the opposite of useful.
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('never touches item, audit_log or run', async () => {
    await pruneRunEvents(db, NOW);
    // item: deleting a row does not free space, it re-copies the item.
    expect(await count('item')).toBe(1);
    // audit_log: retention here is a legal question, left to the owner.
    expect(await count('audit_log')).toBe(1);
    // run: the answer to "when did this last work".
    expect(await count('run')).toBe(3);
  });

  it('reports rows remaining rather than looking finished', async () => {
    // One row per batch, one batch allowed: there IS more to do and saying so
    // is the difference between "nothing left" and "I stopped early".
    const result = await pruneRunEvents(db, NOW, {
      olderThanDays: 1,
      batchSize: 1,
      maxBatches: 1,
    });
    expect(result.deleted).toBe(1);
    expect(result.moreRemaining).toBe(true);
  });

  it('reports a real count, because the batch loop steers by it', async () => {
    // Not decoration: the loop stops when a batch returns fewer rows than the
    // batch size, so a driver whose row count this failed to read would look
    // finished after one pass and leave the table growing.
    const result = await pruneRunEvents(db, NOW, { olderThanDays: 1, batchSize: 100 });
    expect(result.deleted).toBeGreaterThan(0);
  });

  it('refuses a window that would delete today', async () => {
    await expect(pruneRunEvents(db, NOW, { olderThanDays: 0 })).rejects.toThrow(/at least one day/);
  });

  it('reads the operator override, and refuses one it cannot honour', () => {
    // Both editions read this variable, so both must agree about it (rule 5).
    expect(retentionDaysFromEnv('45')).toBe(45);
    expect(retentionDaysFromEnv(undefined)).toBe(DEFAULT_RUN_EVENT_RETENTION_DAYS);
    expect(retentionDaysFromEnv('')).toBe(DEFAULT_RUN_EVENT_RETENTION_DAYS);
    // Refused, not quietly defaulted: whoever wrote these believes something
    // about how long their logs are kept, and they are wrong either way — but
    // only one of the two outcomes tells them so.
    for (const bad of ['thirty', '0', '-5', '2.5', 'NaN']) {
      expect(() => retentionDaysFromEnv(bad), bad).toThrow(/whole number of days/);
    }
  });

  it('defaults to a window the run list cannot notice', async () => {
    // listRunsWithEvents shows the newest 20 runs; the default has to be well
    // clear of anything a reader could reach.
    expect(DEFAULT_RUN_EVENT_RETENTION_DAYS).toBeGreaterThanOrEqual(30);
  });
});
