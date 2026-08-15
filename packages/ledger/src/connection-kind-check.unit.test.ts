// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The `connection.kind` enum in TypeScript, against the CHECK in the database.
 *
 * These are two independent lists that must agree, and neither compiler nor
 * runtime notices when they stop:
 *
 *  - a kind added to the TS enum only → the code accepts it, every INSERT fails
 *    with a constraint violation in production, and the error names a constraint
 *    rather than the provider somebody just added;
 *  - a kind added to the SQL only → dead capacity nothing can reach.
 *
 * Written when `google_drive` was added (workplan 0042 T5), which needed both
 * halves and would have been silently half-done either way. It reads the
 * constraint out of a REAL database with the real migration chain applied, so it
 * cannot be satisfied by a comment or a matching string in a file.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pgliteDriver } from './pglite-driver';
import { runMigrations } from './migrate';
import { connection } from './schema-pg';
import type { LedgerDriver } from './driver';

let driver: LedgerDriver;
let allowedInTheDatabase: string[];

beforeAll(async () => {
  driver = pgliteDriver();
  await runMigrations({ driver, logger: () => {} });
  const conn = await driver.acquire();
  try {
    const { rows } = await conn.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE conname = 'connection_kind_check'`,
    );
    expect(rows, 'the connection_kind_check constraint is missing entirely').toHaveLength(1);
    // `CHECK ((kind = ANY (ARRAY['o365'::text, …])))`
    allowedInTheDatabase = [...rows[0]!.def.matchAll(/'([a-z0-9_]+)'::text/g)].map((m) => m[1]!);
  } finally {
    conn.release();
  }
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe('connection.kind', () => {
  it('allows exactly the kinds the TypeScript enum declares', () => {
    expect([...allowedInTheDatabase].sort()).toEqual([...connection.kind.enumValues].sort());
  });

  it('includes google_drive — the managed edition can hold a Drive connection', () => {
    // Named explicitly as well as compared, because the equality above would go
    // on passing if BOTH lists lost it (workplan 0042 T5: an appliance that can
    // be pointed at a Drive while the managed edition cannot represent one is a
    // difference between editions, which hard rule 5 forbids).
    expect(allowedInTheDatabase).toContain('google_drive');
    expect(connection.kind.enumValues).toContain('google_drive');
  });
});
