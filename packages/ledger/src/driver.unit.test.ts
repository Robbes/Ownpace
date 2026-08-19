// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * `withTenant` against the connection seam (workplan 0015 T1).
 *
 * The reason these exist: the appliance is meant to run on **PGlite**, which
 * has exactly ONE connection, where `pg.Pool` has N. Every RLS guarantee in
 * this product depends on `app.current_tenant` being set transaction-locally
 * and on transactions not overlapping — and with one connection, two concurrent
 * `withTenant` calls would produce `BEGIN` inside `BEGIN`, one `COMMIT` ending
 * both, and one tenant's context live while the other is mid-query. That is
 * cross-tenant exposure caused by concurrency alone, with every policy still
 * correctly written and every integration test still green.
 *
 * PGlite is not installable in this workspace yet (it makes pnpm resolve a
 * second `drizzle-orm`, which then fails to typecheck against itself), so the
 * constraint is modelled here instead: a fake driver with one connection that
 * makes `acquire()` wait. That is exactly what a real PGlite driver must do,
 * and the property under test — that `withTenant` never interleaves — is the
 * one that would be catastrophic to get wrong.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { withTenant } from './db.ts';
import type { LedgerConnection, LedgerDriver } from './driver.ts';
import type { PgDatabase } from './db-types.ts';

/** Every statement issued, in order, across the whole driver. */
type Journal = string[];

/**
 * A driver with ONE connection, which serialises `acquire()` — PGlite's shape.
 *
 * `maxConcurrent` records the high-water mark of simultaneous holders. If the
 * seam is right it never exceeds 1; if `acquire()` were to hand the connection
 * to a second caller it would climb, and the journal would show interleaved
 * transactions.
 */
function singleConnectionDriver(journal: Journal) {
  let busy: Promise<void> | null = null;
  let inUse = 0;
  let maxConcurrent = 0;
  let destroyed = false;

  const driver: LedgerDriver = {
    async acquire(): Promise<LedgerConnection> {
      // Wait for the previous holder. This is the serialisation a
      // single-connection driver must do, and the thing `withTenant` is
      // allowed to be ignorant of.
      while (busy) await busy;
      let release!: () => void;
      busy = new Promise<void>((r) => (release = r));
      inUse += 1;
      maxConcurrent = Math.max(maxConcurrent, inUse);

      return {
        query: async (text: string, params?: readonly unknown[]) => {
          journal.push(params?.length ? `${text} :: ${String(params[0])}` : text);
          return { rows: [] };
        },
        exec: async (sql: string) => {
          journal.push(sql);
        },
        db: {} as PgDatabase,
        release: (err?: Error) => {
          if (err) destroyed = true;
          inUse -= 1;
          const done = release;
          busy = null;
          done();
        },
      };
    },
    end: async () => {},
  };

  return {
    driver,
    get maxConcurrent() {
      return maxConcurrent;
    },
    get destroyed() {
      return destroyed;
    },
  };
}

describe('withTenant on a single-connection driver (PGlite’s shape)', () => {
  it('never overlaps two tenants on the one connection', async () => {
    const journal: Journal = [];
    const d = singleConnectionDriver(journal);

    // Two mappings syncing at once — the ordinary case, since the sync path
    // runs several items in flight (DEFAULT_CONCURRENCY, currently 4).
    await Promise.all([
      withTenant(d.driver, 'tenant-a', async () => {
        // Yield inside the transaction, so an unserialised driver WOULD
        // interleave here. Without the await this test could pass on a broken
        // implementation purely because nothing gave up the event loop.
        await new Promise((r) => setTimeout(r, 5));
        return 'a';
      }),
      withTenant(d.driver, 'tenant-b', async () => {
        await new Promise((r) => setTimeout(r, 1));
        return 'b';
      }),
    ]);

    expect(d.maxConcurrent).toBe(1);

    // Each transaction is a complete, unbroken BEGIN → set_config → COMMIT.
    // Splitting on COMMIT gives one group per transaction; neither may mention
    // the other tenant.
    const first = journal.slice(0, journal.indexOf('COMMIT') + 1);
    const second = journal.slice(journal.indexOf('COMMIT') + 1);

    expect(first[0]).toBe('BEGIN');
    expect(first[first.length - 1]).toBe('COMMIT');
    expect(second[0]).toBe('BEGIN');
    expect(second[second.length - 1]).toBe('COMMIT');

    const tenantOf = (g: string[]) =>
      g.find((s) => s.includes('set_config'))?.split(' :: ')[1];
    expect(tenantOf(first)).not.toBe(tenantOf(second));
    expect([tenantOf(first), tenantOf(second)].sort()).toEqual(['tenant-a', 'tenant-b']);
  });

  it('sets the tenant transaction-locally, inside the transaction', async () => {
    // `set_config(..., true)` is SET LOCAL: it dies with the transaction. Issued
    // BEFORE any of the caller's work and AFTER BEGIN — outside the transaction
    // it would leak to whoever holds the connection next, which on a
    // single-connection driver is everybody.
    const journal: Journal = [];
    const d = singleConnectionDriver(journal);

    await withTenant(d.driver, 'tenant-a', async () => 'ok');

    expect(journal[0]).toBe('BEGIN');
    expect(journal[1]).toContain("set_config('app.current_tenant', $1, true)");
    expect(journal[1]).toContain('tenant-a');
    expect(journal[2]).toBe('COMMIT');
  });

  it('releases the connection even when the caller throws, or the next tenant waits forever', async () => {
    const journal: Journal = [];
    const d = singleConnectionDriver(journal);

    await expect(
      withTenant(d.driver, 'tenant-a', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(journal).toEqual(expect.arrayContaining(['ROLLBACK']));
    // The proof it was released: a second call completes rather than hanging.
    await expect(withTenant(d.driver, 'tenant-b', async () => 'ok')).resolves.toBe('ok');
  });

  it('re-throws the ORIGINAL error when the rollback also fails, and marks the connection unusable', async () => {
    // Hard rule 9: the rollback failure must not mask what actually went wrong.
    // And a connection left in an aborted transaction, possibly still carrying
    // app.current_tenant, must never be handed to the next tenant.
    const journal: Journal = [];
    const d = singleConnectionDriver(journal);
    const original = new Error('the real problem');

    const driver: LedgerDriver = {
      ...d.driver,
      acquire: async () => {
        const conn = await d.driver.acquire();
        return {
          ...conn,
          query: async (text: string, params?: readonly unknown[]) => {
            if (text === 'ROLLBACK') throw new Error('rollback failed too');
            return conn.query(text, params);
          },
        };
      },
    };

    await expect(
      withTenant(driver, 'tenant-a', async () => {
        throw original;
      }),
    ).rejects.toBe(original);

    expect(d.destroyed).toBe(true);
  });
});

describe('the pool path', () => {
  it('still accepts a pg.Pool, so existing callers are unaffected', async () => {
    // The transition affordance. 45 call sites pass a pool; the seam landed
    // without touching them.
    const journal: Journal = [];
    const client = {
      query: vi.fn(async (text: string, params?: unknown[]) => {
        journal.push(params?.length ? `${text} :: ${String(params[0])}` : text);
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };

    const out = await withTenant(pool as unknown as Pool, 'tenant-a', async () => 'ok');

    expect(out).toBe('ok');
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(undefined);
    expect(journal[0]).toBe('BEGIN');
    expect(journal[journal.length - 1]).toBe('COMMIT');
  });
});
