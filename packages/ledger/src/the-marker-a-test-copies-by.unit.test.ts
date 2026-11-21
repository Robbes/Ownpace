// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE MARKER A TEST COPIES BY, on PGlite (migration 0070, workplan 0162 T2).
 *
 * The appliance may run the ledger chain on PGlite (ADR-0028), so the column's
 * CHECK and the trigger that keeps it from changing (§2 (c)) are held here, on
 * every pull request, to the same cases a real Postgres is held to in
 * `the-marker-a-test-copies-by.integration.test.ts`
 * (`__tests__/the-marker-column.ts`): a marker of 3 to 64 characters with no
 * control character is kept as written and carried by the reader; anything
 * else is refused at the CHECK; and once a row exists, no update changes it,
 * whoever sends it, while every other update of the row goes through.
 */

import { beforeAll, afterAll } from 'vitest';
import { createPgliteDb } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import type { LedgerDriver } from './driver.ts';
import type { PgDatabase } from './db-types.ts';
import { theMarkerColumn } from './__tests__/the-marker-column.ts';

let driver: LedgerDriver;
let db: PgDatabase;

beforeAll(async () => {
  const made = await createPgliteDb({});
  driver = made.driver;
  db = made.db;
  await runMigrations({ driver, logger: () => {} });
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

theMarkerColumn({
  acquire: () => driver.acquire(),
  db: () => db,
});
