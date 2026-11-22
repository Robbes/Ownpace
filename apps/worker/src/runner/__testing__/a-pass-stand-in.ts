// Copyright 2026 The Ownpace authors (Apache-2.0)

// A pass, for `../worker.integration.test.ts` only: forked by the worker in
// place of `run-delta-sync`'s entry, through the same `onPgBoss`. It writes a
// row for each attempt to the test's own table (its pid, and how many earlier
// attempts on its key still had a live process when it started), holds as its
// payload asks, and ends. Never shipped: nothing outside the test names it.

import pg from 'pg';
import { z } from 'zod';
import { serveRuns } from '@openmig/scheduler/pg-boss';
import { onPgBoss } from '../serve-job.ts';

const StandInPassSchema = z.object({
  tenantId: z.string(),
  mappingId: z.string(),
  domains: z.array(z.string()).optional(),
  /** How long to hold before ending. */
  holdMs: z.number().int().nonnegative().optional(),
  /** Hold only on this attempt; every attempt when absent. */
  holdOnAttempt: z.number().int().positive().optional(),
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

serveRuns({
  run: onPgBoss(StandInPassSchema, async (payload, context) => {
    const pool = new pg.Pool({ connectionString: process.env.WORKER_TEST_DATABASE_URL, max: 1 });
    try {
      const { rows } = await pool.query<{ pid: number }>(
        'SELECT pid FROM worker_test_run WHERE key = $1 AND finished_at IS NULL',
        [payload.mappingId],
      );
      const othersAlive = rows.filter((r) => r.pid !== process.pid && alive(r.pid)).length;
      await pool.query(
        `INSERT INTO worker_test_run (run_id, queue, attempt, key, pid, others_alive, payload)
         VALUES ($1, 'run-delta-sync', $2, $3, $4, $5, $6)`,
        [context.runId, context.attempt, payload.mappingId, process.pid, othersAlive, JSON.stringify(payload)],
      );
      const hold = payload.holdMs ?? 0;
      if (hold > 0 && (payload.holdOnAttempt === undefined || payload.holdOnAttempt === context.attempt)) {
        await new Promise((resolve) => setTimeout(resolve, hold));
      }
      await pool.query('UPDATE worker_test_run SET finished_at = clock_timestamp() WHERE run_id = $1 AND attempt = $2', [
        context.runId,
        context.attempt,
      ]);
      return { copied: 0, attempt: context.attempt, runId: context.runId };
    } finally {
      await pool.end();
    }
  }),
});
