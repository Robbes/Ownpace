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
 *  - `run` rows OF A TENANT WHOSE PERIOD IS NOT YET INVOICED, and of any other
 *    tenant than the one being pruned — since 0121 T5 these ARE deletable, but
 *    only as far as the caller has proved safe, and the proof is per tenant;
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
  pruneRuns,
  retentionDaysFromEnv,
  runRetentionDaysFromEnv,
  DEFAULT_RUN_EVENT_RETENTION_DAYS,
  DEFAULT_RUN_RETENTION_DAYS,
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

/**
 * 0121 T5 — the run window, and the proof it will not delete an unbilled month.
 *
 * `pruneRunEvents` above is the easy half: a log line has no second reader. A
 * run row is billing evidence, and what makes deleting it safe is the invoice
 * freeze — so most of what follows asserts that the prune STOPS where the
 * proof stops, per tenant, and that the two ways of having no date do not
 * collapse into one.
 */
describe('pruneRuns', () => {
  const OTHER_TENANT = '5a9b0000-e29b-41d4-a716-446655441502';
  const OTHER_MAPPING = '5a9b0000-e29b-41d4-a716-446655441532';

  /** A finished run of a chosen age, so the window has something to bite on. */
  async function agedRun(id: string, days: number, status = 'succeeded', tenant = TENANT, mapping = MAPPING) {
    await conn.query(
      `INSERT INTO run (id, tenant_id, mapping_id, kind, status, created_at)
       VALUES ($1, $2, $3, 'incremental', $4, $5)`,
      [id, tenant, mapping, status, daysAgo(days)],
    );
  }

  const A = '5a9b0000-e29b-41d4-a716-4466554415a1';
  const B = '5a9b0000-e29b-41d4-a716-4466554415a2';
  const C = '5a9b0000-e29b-41d4-a716-4466554415a3';

  it('deletes finished runs past the window when nothing is billed', async () => {
    await agedRun(A, 400);
    const before = await count('run');
    const result = await pruneRuns(db, NOW, { safeUpTo: 'nothing-is-billed' });
    expect(result.deleted).toBeGreaterThan(0);
    expect(await count('run')).toBeLessThan(before);
    const { rows } = await conn.query<{ id: string }>(`SELECT id FROM run WHERE id = $1`, [A]);
    expect(rows, 'a 400-day-old finished run is past any window').toHaveLength(0);
  });

  it('keeps a finished run that is still inside the window', async () => {
    await agedRun(B, 5);
    await pruneRuns(db, NOW, { safeUpTo: 'nothing-is-billed' });
    const { rows } = await conn.query<{ id: string }>(`SELECT id FROM run WHERE id = $1`, [B]);
    expect(rows).toHaveLength(1);
  });

  it('never deletes a run that has not finished, however old', async () => {
    // Not just data loss: 0022's tick reads these rows to decide whether a
    // mapping is already in flight, so deleting one lets a second writer start
    // against the same mapping.
    await agedRun(C, 400, 'running');
    await pruneRuns(db, NOW, { safeUpTo: 'nothing-is-billed' });
    const { rows } = await conn.query<{ id: string }>(`SELECT id FROM run WHERE id = $1`, [C]);
    expect(rows, 'a running pass is excluded on status, not on age').toHaveLength(1);
  });

  it('stops at safeUpTo — an old run the invoice has not covered survives', async () => {
    // THE ASSERTION THIS WHOLE TASK RESTS ON. The run is far past the window,
    // and stays because the caller has only proved the ledger safe to forget up
    // to a point BEFORE it.
    await agedRun(A, 100);
    const result = await pruneRuns(db, NOW, {
      olderThanDays: 60,
      safeUpTo: daysAgo(200),
    });
    const { rows } = await conn.query<{ id: string }>(`SELECT id FROM run WHERE id = $1`, [A]);
    expect(rows, 'past the window, but past the proof too').toHaveLength(1);
    expect(result.clampedBySafety, 'and it says the safety point decided').toBe(true);
    expect(result.cutoff.getTime()).toBe(daysAgo(200).getTime());
  });

  it('reports which bound decided, because both can delete nothing', async () => {
    // A prune that deletes nothing because nothing is old enough is healthy; a
    // prune that deletes nothing because no invoice has been issued in months
    // is a billing job that has stopped. They must not look the same.
    // Safety FURTHER BACK than the window is the restrictive case: only rows
    // older than 200 days are proved safe, so the 60-day window is not the
    // binding constraint and the safety point is.
    const bySafety = await pruneRuns(db, NOW, { olderThanDays: 60, safeUpTo: daysAgo(200) });
    expect(bySafety.clampedBySafety, 'the proof reaches back less far than the window').toBe(true);
    expect(bySafety.cutoff.getTime()).toBe(daysAgo(200).getTime());

    // Safety NEARER than the window means everything the window would delete is
    // already billed, so the window decides and nothing is being held back.
    const byWindow = await pruneRuns(db, NOW, { olderThanDays: 60, safeUpTo: daysAgo(2) });
    expect(byWindow.clampedBySafety, 'billed past the window — the window binds').toBe(false);
    expect(byWindow.cutoff.getTime()).toBe(daysAgo(60).getTime());

    const byNothing = await pruneRuns(db, NOW, { olderThanDays: 60, safeUpTo: 'nothing-is-billed' });
    expect(byNothing.clampedBySafety, 'no billing to clamp against').toBe(false);
  });

  it('prunes one tenant without touching another', async () => {
    // Invoicing is per tenant, so the proof is too. A tenant billed through
    // July must not take an unbilled tenant's June evidence with it.
    await conn.query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'other', 'active')`, [OTHER_TENANT]);
    await conn.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name)
       VALUES ($1, $2, 'source', 'imap', 'other')`,
      ['5a9b0000-e29b-41d4-a716-446655441512', OTHER_TENANT],
    );
    for (const [id, ext] of [['5a9b0000-e29b-41d4-a716-446655441523', 's'], ['5a9b0000-e29b-41d4-a716-446655441524', 't']] as const) {
      await conn.query(
        `INSERT INTO mailbox (id, tenant_id, connection_id, external_id) VALUES ($1, $2, $3, $4)`,
        [id, OTHER_TENANT, '5a9b0000-e29b-41d4-a716-446655441512', ext],
      );
    }
    await conn.query(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status, mode, pattern)
       VALUES ($1, $2, $3, $4, 'active', 'mirror', 'shared_s')`,
      [OTHER_MAPPING, OTHER_TENANT, '5a9b0000-e29b-41d4-a716-446655441523', '5a9b0000-e29b-41d4-a716-446655441524'],
    );
    await agedRun(A, 400);
    await agedRun(B, 400, 'succeeded', OTHER_TENANT, OTHER_MAPPING);

    await pruneRuns(db, NOW, { safeUpTo: 'nothing-is-billed', tenantId: TENANT });

    expect((await conn.query(`SELECT id FROM run WHERE id = $1`, [A])).rows, 'the named tenant is pruned').toHaveLength(0);
    expect((await conn.query(`SELECT id FROM run WHERE id = $1`, [B])).rows, 'the other tenant is untouched').toHaveLength(1);
  });

  it('takes the log with the run, and leaves verification standing', async () => {
    // `run_event.run_id` is ON DELETE CASCADE and `verification.run_id` is ON
    // DELETE SET NULL. Both are deliberate, and both are asserted here so a
    // schema change that flips either shows up as a failure rather than as
    // silently destroyed verification history.
    await agedRun(A, 400);
    await conn.query(
      `INSERT INTO run_event (tenant_id, run_id, level, message, at) VALUES ($1, $2, 'info', 'doomed', $3)`,
      [TENANT, A, daysAgo(400)],
    );
    await conn.query(
      `INSERT INTO verification (tenant_id, mapping_id, run_id, domain, status)
       VALUES ($1, $2, $3, 'email', 'pass')`,
      [TENANT, MAPPING, A],
    );

    await pruneRuns(db, NOW, { safeUpTo: 'nothing-is-billed' });

    expect((await conn.query(`SELECT id FROM run_event WHERE run_id = $1`, [A])).rows, 'events cascade').toHaveLength(0);
    const v = await conn.query<{ run_id: string | null }>(`SELECT run_id FROM verification WHERE mapping_id = $1`, [MAPPING]);
    expect(v.rows, 'the verification record survives').toHaveLength(1);
    expect(v.rows[0]?.run_id, 'and only loses the pointer').toBeNull();
  });

  it('the run window has its own variable, and refuses the same way', async () => {
    expect(runRetentionDaysFromEnv('45')).toBe(45);
    expect(runRetentionDaysFromEnv(undefined)).toBe(DEFAULT_RUN_RETENTION_DAYS);
    // Its own name in its own refusal — a message naming the events variable
    // would send an operator to edit the wrong setting.
    expect(() => runRetentionDaysFromEnv('thirty')).toThrow(/LEDGER_RUN_RETENTION_DAYS/);
    expect(() => retentionDaysFromEnv('thirty')).toThrow(/LEDGER_RETENTION_DAYS must/);
  });

  it('the log window follows the run window rather than outliving it', async () => {
    // ON DELETE CASCADE means a log cannot outlive its run whatever the event
    // window says. Two different numbers would describe a retention this code
    // does not perform.
    expect(DEFAULT_RUN_EVENT_RETENTION_DAYS).toBe(DEFAULT_RUN_RETENTION_DAYS);
    expect(DEFAULT_RUN_RETENTION_DAYS).toBe(60);
  });
});
