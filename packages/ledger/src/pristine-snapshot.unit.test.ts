// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The cached cluster must stay EMPTY.
 *
 * `pglite-driver.ts` runs `initdb` once per process and restores every later
 * in-memory database from a snapshot of it, because `initdb` is ~3.2s and a
 * restore is ~0.78s. That is a pure speed-up only while the snapshot is of a
 * cluster with nothing in it.
 *
 * The tempting next optimisation is to snapshot a MIGRATED database — it would
 * save another ~0.45s per instance and it would be a disaster, quietly. Every
 * migration test in this repo starts by asking for a database and applying a
 * chain to it. Hand those tests a database where the chain is already applied
 * and they still pass: `runMigrations` finds its bookkeeping table populated,
 * applies nothing, reports success. `migrate-rerun`, `migrate-upgrade` and
 * `two-chains` would all go green while testing nothing at all, and the first
 * sign would be a broken upgrade on a real appliance.
 *
 * So this asserts the property the speed-up depends on, in the only terms that
 * cannot drift: a fresh in-memory database has no tables of ours in it.
 */

import { describe, it, expect } from 'vitest';
import { createPgliteDb } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';

describe('the cached pristine cluster is empty, not pre-migrated', () => {
  it('hands out an empty database that a chain genuinely applies to', async () => {
    // Two databases, not one: the first pays initdb and SEEDS the snapshot,
    // the second is served FROM it. Only the second can be contaminated, so it
    // is the one that carries both assertions. Two rather than three because
    // each costs ~0.8s and this file is part of the cost it exists to protect.
    const first = await createPgliteDb({});
    await first.close();

    const restored = await createPgliteDb({});
    try {
      const conn = await restored.driver.acquire();
      try {
        const { rows } = await conn.query<{ name: string }>(
          `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public'`,
        );
        expect(rows.map((r) => r.name), 'restored from the snapshot: not a pristine cluster').toEqual([]);
      } finally {
        await conn.release();
      }

      // The consequence, asserted directly rather than inferred from the table
      // list: a pre-migrated snapshot makes this report an empty `applied`.
      const result = await runMigrations({ driver: restored.driver, logger: () => {} });
      expect(
        result.applied.length,
        'runMigrations applied nothing — it was handed a database that was already migrated',
      ).toBeGreaterThan(10);
    } finally {
      await restored.close();
    }
  }, 120_000);
});
