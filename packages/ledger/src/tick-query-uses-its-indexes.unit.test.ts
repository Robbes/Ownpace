// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Does the managed sync tick's query actually USE the indexes 0023 adds?
 * (workplan 0082 T1)
 *
 * The index that matters is not the one in the migration file — it is the one
 * the planner chooses. Those are different claims, and only the second one is
 * worth anything. An index can exist and go unused because a predicate does not
 * match its leading columns, because a partial index's WHERE is narrower than
 * the query's, or because a cast makes the expression non-sargable. Every one
 * of those failures looks exactly like a correct migration.
 *
 * So this asks Postgres. PGlite is real Postgres compiled to WASM, so `EXPLAIN`
 * here is the same planner that runs in production, against the same DDL from
 * the same migration chain — no container, no Docker, unit tier.
 *
 * ## What it deliberately does NOT assert
 *
 * Not timing. A benchmark in CI measures the runner's mood. The claim being
 * pinned is structural — *this scan is an index scan and not a sequential one*
 * — which is the thing that decides whether the tick's cost grows with a
 * mapping's entire history or stays flat.
 *
 * `enable_seqscan = off` is NOT used to force the issue. Postgres will happily
 * choose a sequential scan on a tiny table no matter what indexes exist, so the
 * fixture inserts enough run rows that a seq scan is the genuinely wrong answer
 * — which is also the situation the index exists for. Forcing the planner would
 * turn this into a test that passes whether or not the index is any good.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pgliteDriver } from './pglite-driver';
import { runMigrations } from './migrate';
import type { LedgerDriver, LedgerConnection } from './driver';

// UUID family 5a8b0000-…, unused elsewhere in the repo.
const TENANT = '5a8b0000-e29b-41d4-a716-446655441401';
const SOURCE_MAILBOX = '5a8b0000-e29b-41d4-a716-446655441411';
const TARGET_MAILBOX = '5a8b0000-e29b-41d4-a716-446655441412';
const CONNECTION = '5a8b0000-e29b-41d4-a716-446655441421';
const MAPPING = '5a8b0000-e29b-41d4-a716-446655441431';

/**
 * Enough history that a sequential scan is the wrong plan.
 *
 * This is the number the whole workplan is about: roughly one month of one
 * mapping on the default fifteen-minute cadence. The point of the test is that
 * the tick's cost must not track it.
 */
const RUNS = 3000;

/**
 * Mappings that are NOT active, so the partial index is genuinely selective.
 *
 * A service that has run for a while accumulates these — paused, cut over,
 * finished — and they never leave the table. The tick has to walk past all of
 * them once a minute to find the few that are still syncing.
 */
const INACTIVE_MAPPINGS = 500;

let driver: LedgerDriver;
let conn: LedgerConnection;

/** The tick's own query, verbatim from `managed-sync-tick.ts`. */
const TICK_SQL = `SELECT m.id, m.tenant_id, m.schedule,
              (SELECT max(r.started_at) FROM run r
                WHERE r.tenant_id = m.tenant_id AND r.mapping_id = m.id) AS last_started,
              EXISTS (SELECT 1 FROM run r
                WHERE r.tenant_id = m.tenant_id AND r.mapping_id = m.id
                  AND r.status = 'running') AS running
         FROM mailbox_mapping m
        WHERE m.status = 'active'`;

async function explain(sql: string): Promise<string> {
  const { rows } = await conn.query<Record<string, string>>(`EXPLAIN ${sql}`);
  // The column is named "QUERY PLAN"; take whatever the single column is so a
  // driver that spells it differently does not silently yield an empty plan.
  return rows.map((r) => Object.values(r)[0] ?? '').join('\n');
}

beforeAll(async () => {
  driver = pgliteDriver({});
  await runMigrations({ driver, logger: () => {} });
  conn = await driver.acquire();

  await conn.query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'perf', 'active')`, [TENANT]);
  await conn.query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, status, config)
     VALUES ($1, $2, 'source', 'imap', 'perf fixture', 'connected', '{}'::jsonb)`,
    [CONNECTION, TENANT],
  );
  for (const [id, ext] of [
    [SOURCE_MAILBOX, 'src'],
    [TARGET_MAILBOX, 'dst'],
  ] as const) {
    await conn.query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, primary_address)
       VALUES ($1, $2, $3, $4, 'a@example.test')`,
      [id, TENANT, CONNECTION, ext],
    );
  }
  await conn.query(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status, mode, pattern)
     VALUES ($1, $2, $3, $4, 'active', 'mirror', 'shared_s')`,
    [MAPPING, TENANT, SOURCE_MAILBOX, TARGET_MAILBOX],
  );

  // Mappings the tick must scan PAST. The partial index only earns its place
  // when most mappings are not active — which is the real shape of a service
  // that has been running a while: paused, cut over and finished migrations
  // accumulate and never leave. With one row in the table a sequential scan is
  // the correct plan and the assertion below would be measuring nothing.
  for (const side of ['bulksrc', 'bulkdst']) {
    await conn.query(
      `INSERT INTO mailbox (tenant_id, connection_id, external_id, primary_address)
       SELECT $1, $2, $3 || '-' || g, $3 || g || '@example.test'
         FROM generate_series(1, $4) AS g`,
      [TENANT, CONNECTION, side, INACTIVE_MAPPINGS],
    );
  }
  await conn.query(
    `INSERT INTO mailbox_mapping (tenant_id, source_mailbox_id, target_mailbox_id, status, mode, pattern)
     SELECT $1, s.id, t.id, 'done', 'mirror', 'shared_s'
       FROM mailbox s
       JOIN mailbox t ON t.external_id = 'bulkdst-' || substring(s.external_id from 9)
      WHERE s.external_id LIKE 'bulksrc-%'`,
    [TENANT],
  );

  // A month of history, all finished — which is the state the tick meets on
  // nearly every firing, and the state the old EXISTS scanned in full.
  await conn.query(
    `INSERT INTO run (tenant_id, mapping_id, kind, status, started_at, created_at)
     SELECT $1, $2, 'incremental', 'succeeded',
            now() - (g || ' minutes')::interval,
            now() - (g || ' minutes')::interval
       FROM generate_series(1, $3) AS g`,
    [TENANT, MAPPING, RUNS],
  );
  await conn.query('ANALYZE');
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe('the managed sync tick reads indexes, not history', () => {
  it('answers "is a run in flight?" without scanning the run table', async () => {
    const plan = await explain(
      `SELECT EXISTS (SELECT 1 FROM run r
         WHERE r.tenant_id = '${TENANT}' AND r.mapping_id = '${MAPPING}'
           AND r.status = 'running')`,
    );
    expect(plan).toContain('ix_run_active');
    // The failure this guards: 3000 finished rows read to conclude "none".
    expect(plan).not.toContain('Seq Scan on run');
  });

  it('answers "when did it last start?" without aggregating the whole history', async () => {
    const plan = await explain(
      `SELECT max(r.started_at) FROM run r
        WHERE r.tenant_id = '${TENANT}' AND r.mapping_id = '${MAPPING}'`,
    );
    expect(plan).toContain('ix_run_started');
    expect(plan).not.toContain('Seq Scan on run');
  });

  it('enumerates active mappings through the partial index', async () => {
    const plan = await explain(`SELECT m.id FROM mailbox_mapping m WHERE m.status = 'active'`);
    expect(plan).toContain('ix_mapping_active');
    expect(plan).not.toContain('Seq Scan on mailbox_mapping');
  });

  it('plans the tick query itself without a sequential scan of run', async () => {
    // The three above are the parts; this is the query the worker actually
    // sends. A part can be fast on its own and still be planned differently
    // once it is a correlated subquery inside a join.
    const plan = await explain(TICK_SQL);
    expect(plan).not.toContain('Seq Scan on run');
    expect(plan).toContain('ix_run_active');
    expect(plan).toContain('ix_run_started');
  });

  it('still returns the right answers, not just a pretty plan', async () => {
    // An index the planner loves and the query gets wrong is worse than a scan.
    const { rows } = await conn.query<{ last_started: Date | null; running: boolean }>(TICK_SQL);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.running).toBe(false);
    expect(rows[0]?.last_started).toBeInstanceOf(Date);

    await conn.query(
      `INSERT INTO run (tenant_id, mapping_id, kind, status, started_at)
       VALUES ($1, $2, 'incremental', 'running', now())`,
      [TENANT, MAPPING],
    );
    const after = await conn.query<{ running: boolean }>(TICK_SQL);
    expect(after.rows[0]?.running).toBe(true);
  });
});
