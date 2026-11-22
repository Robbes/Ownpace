// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A worker process for the crash test (workplan 0167, point 2). The test
 * starts it, waits until its pass is part-way, and kills it with SIGKILL: no
 * shutdown hook runs, no heartbeat is sent again, the run is left `active`.
 *
 * Handed its database by argument, never by `DATABASE_URL`. With a fourth
 * argument, `in-child`, it works the queue with `workInChild` and the
 * key-holder run instead, for the test that a worker's death is retried.
 */

import pg from 'pg';
import { PgBossJobRunner } from '../job-runner.ts';
import { copyPass, type CopyPassPayload } from './copy-pass.ts';

const [connectionString, schema, queue, mode] = process.argv.slice(2);
if (!connectionString || !schema || !queue) {
  throw new Error('usage: worker-to-kill.ts <connection string> <schema> <queue> [in-child]');
}

const pool = new pg.Pool({ connectionString, max: 2 });
const runner = new PgBossJobRunner({ connectionString, schema, pollingIntervalSeconds: 0.5, monitorIntervalSeconds: 1, superviseIntervalSeconds: 1 });
await runner.start([{ name: queue, policy: 'singleton', heartbeatSeconds: 10, retryDelaySeconds: 1 }]);
if (mode === 'in-child') {
  await runner.workInChild(queue, new URL('./key-holder.ts', import.meta.url).href, { maxOldSpaceMb: 64 });
} else {
  await runner.work<CopyPassPayload, { copied: number }>(queue, (payload, ctx) => copyPass(pool, schema, payload, ctx));
}
process.send?.('ready');
