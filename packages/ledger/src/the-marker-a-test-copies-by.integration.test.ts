// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE MARKER A TEST COPIES BY, on a real Postgres (migration 0070, workplan
 * 0162 T2).
 *
 * The same cases `the-marker-a-test-copies-by.unit.test.ts` runs on PGlite
 * (`__tests__/the-marker-column.ts`), against the server the managed stacks
 * run. A control-character class, a character count and a trigger are each
 * the database's own reading, so the two engines are asked separately rather
 * than one being trusted for both.
 */

import { afterAll } from 'vitest';
import { Pool } from 'pg';
import { createPgDb, pgDriver } from './db.ts';
import { theMarkerColumn } from './__tests__/the-marker-column.ts';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests require Testcontainers to be running. ' +
      'Run: pnpm test:integration',
  );
}

const pool = new Pool({ connectionString: PG_CONNECTION_STRING });
const driver = pgDriver(pool);
const db = createPgDb(PG_CONNECTION_STRING);

afterAll(async () => {
  await db.close();
  await pool.end();
});

theMarkerColumn({
  acquire: () => driver.acquire(),
  db: () => db,
});
