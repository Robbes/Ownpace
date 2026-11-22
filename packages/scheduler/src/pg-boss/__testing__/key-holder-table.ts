// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The table `key-holder.ts` writes to, and its payload, for the test that
 * reads them. Apart from the entry so a test can import it without serving
 * runs in its own process.
 */

import type pg from 'pg';

export interface KeyHolderPayload {
  readonly connectionString: string;
  readonly schema: string;
}

export async function prepareKeyHolderTable(pool: pg.Pool, schema: string): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${schema}.key_holder (run_id uuid NOT NULL, attempt int NOT NULL, pid int NOT NULL,
       started_at timestamptz NOT NULL DEFAULT clock_timestamp(), last_beat timestamptz NOT NULL DEFAULT clock_timestamp(),
       PRIMARY KEY (run_id, attempt))`,
  );
}
