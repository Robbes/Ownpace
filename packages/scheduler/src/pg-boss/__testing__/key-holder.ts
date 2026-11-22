// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A run that never ends, for the time-limit and lost-claim tests (workplan
 * 0167 T5, gap E5). Forked as the run's process by `workInChild`, it notes
 * when it started, then notes that it is still running every 100 ms, until
 * it is killed. Two runs of one key whose notes overlap would be two writers
 * on one mapping.
 *
 * Only ever a process's entry: importing it would serve runs in the importer.
 * What a test needs of it is in `key-holder-table.ts`.
 */

import pg from 'pg';
import { serveRuns, type ChildRunInfo } from '../run-in-child.ts';
import type { KeyHolderPayload } from './key-holder-table.ts';

async function holdsTheKey(payload: unknown, run: ChildRunInfo | undefined): Promise<never> {
  const { connectionString, schema } = payload as KeyHolderPayload;
  if (!run) throw new Error('key-holder needs its run');
  const client = new pg.Client({ connectionString });
  await client.connect();
  await client.query(`INSERT INTO ${schema}.key_holder (run_id, attempt, pid) VALUES ($1, $2, $3)`, [
    run.runId,
    run.attempt,
    process.pid,
  ]);
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await client.query(`UPDATE ${schema}.key_holder SET last_beat = clock_timestamp() WHERE run_id = $1 AND attempt = $2`, [
      run.runId,
      run.attempt,
    ]);
  }
}

serveRuns({ run: holdsTheKey });
