// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A stand-in for a shadow pass, for the spike's crash test (workplan 0167,
 * point 2): it copies `items` numbered items one by one, create-if-absent, the
 * way the ledger records what a pass has written, and notes every attempt it
 * makes. Killing its process part-way and letting another worker run it again
 * must leave exactly `items` rows and two attempts.
 */

import pg from 'pg';

export interface CopyPassPayload {
  readonly mappingId: string;
  readonly items: number;
  readonly stepMs: number;
}

export async function prepareCopyTables(pool: pg.Pool, schema: string): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${schema}.spike_item (mapping_id text NOT NULL, item int NOT NULL, PRIMARY KEY (mapping_id, item))`,
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${schema}.spike_attempt (run_id uuid NOT NULL, attempt int NOT NULL, pid int NOT NULL, at timestamptz NOT NULL DEFAULT clock_timestamp())`,
  );
}

export async function copyPass(
  pool: pg.Pool,
  schema: string,
  payload: CopyPassPayload,
  ctx: { runId: string; attempt: number; signal: AbortSignal },
): Promise<{ copied: number }> {
  await pool.query(`INSERT INTO ${schema}.spike_attempt (run_id, attempt, pid) VALUES ($1, $2, $3)`, [
    ctx.runId,
    ctx.attempt,
    process.pid,
  ]);
  let copied = 0;
  for (let i = 0; i < payload.items; i++) {
    if (ctx.signal.aborted) throw new Error('The pass was stopped.');
    const r = await pool.query(
      `INSERT INTO ${schema}.spike_item (mapping_id, item) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [payload.mappingId, i],
    );
    copied += r.rowCount ?? 0;
    await new Promise((resolve) => setTimeout(resolve, payload.stepMs));
  }
  return { copied };
}
