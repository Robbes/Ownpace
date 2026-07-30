// Database connection utilities for the ledger.
// PostgreSQL only (see ADR-0010, ADR-0016, ADR-0023).
// Uses the `pg` driver (node-postgres) with drizzle-orm/node-postgres.

import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schemaPg from './schema-pg';
import { log } from '@openmig/shared';
import { isLedgerDriver, type LedgerConnection, type LedgerDriver } from './driver';
import type { PgDatabase } from './db-types';

export type { PgDatabase };

/**
 * The `pg` implementation of the connection seam (workplan 0015 T1).
 *
 * A thin adapter, because `pg.Pool` already has the shape: `connect()` hands
 * out an independent client with `query` and `release`. The only thing it does
 * not do is bind a drizzle handle to that client, which is what the seam needs
 * so the caller's queries run inside the transaction carrying
 * `app.current_tenant`.
 *
 * A PGlite driver would implement the same interface and serialise `acquire()`
 * — see the note in `driver.ts` on why that is a correctness requirement and
 * not a performance choice.
 */
export function pgDriver(pool: Pool): LedgerDriver {
  return {
    async acquire(): Promise<LedgerConnection> {
      const client = await pool.connect();
      return {
        query: (text, params) => client.query(text, params as unknown[] | undefined),
        db: drizzlePg(client, { schema: schemaPg }) as unknown as PgDatabase,
        release: (err?: Error) => client.release(err),
      };
    },
    end: () => pool.end(),
  };
}

/**
 * Transaction-scoped helper that sets the tenant context for RLS.
 * 
 * This is the critical security gate for multi-tenant isolation. It:
 * 1. Acquires a client from the pool
 * 2. Begins a transaction
 * 3. Sets the tenant context via `SELECT set_config('app.current_tenant', $1, true)`
 * 4. Runs the provided function with a transaction-bound drizzle handle
 * 5. Commits on success, rolls back on error (re-throws the original error)
 * 
 * The use of `set_config(..., true)` ensures the context is transaction-local
 * and injection-safe (uses bind parameters, not string interpolation).
 * 
 * @param source - A `LedgerDriver`, or a `pg.Pool` (wrapped for you)
 * @param tenantId - The tenant ID to set as the current context
 * @param fn - The function to run within the tenant-scoped transaction
 * @returns The result of fn
 *
 * Takes a driver OR a pool. Every existing caller passes a pool and keeps
 * working; the pool branch exists so the seam (workplan 0015 T1) could land
 * without touching 45 call sites in the same change, and goes away when the
 * PGlite driver arrives and there is a second implementation to choose between.
 *
 * @example
 * ```typescript
 * const result = await withTenant(pool, 'tenant-uuid', async (txDb) => {
 *   return await txDb.select().from(connection);
 * });
 * ```
 */
export async function withTenant<T>(
  source: LedgerDriver | Pool,
  tenantId: string,
  fn: (db: PgDatabase) => Promise<T>
): Promise<T> {
  const driver = isLedgerDriver(source) ? source : pgDriver(source);
  // May WAIT on a single-connection driver — that is the point of the seam, and
  // the reason this is the only place a connection is taken. See `driver.ts`.
  const conn = await driver.acquire();
  // Set once ROLLBACK fails: the connection may be left in an aborted transaction
  // (possibly still carrying app.current_tenant), so it must be DESTROYED rather
  // than returned for the next tenant to reuse.
  let releaseError: Error | undefined;

  try {
    // Begin transaction
    await conn.query('BEGIN');

    // Set tenant context - use set_config with bind param for safety
    // The third parameter `true` makes it transaction-local (equivalent to SET LOCAL)
    await conn.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);

    // Run the function with the transaction-scoped db
    const result = await fn(conn.db);

    // Commit transaction
    await conn.query('COMMIT');

    return result;
  } catch (error) {
    // Rollback on error
    try {
      await conn.query('ROLLBACK');
    } catch (rollbackError) {
      // Log rollback error but don't mask the original error. Mark the connection
      // for destruction so a broken/aborted one is never reused.
      log.error('Rollback failed after error:', rollbackError);
      releaseError = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
    }

    // Re-throw the original error (never swallow it - hard rule 9)
    throw error;
  } finally {
    // Release. On a failed rollback, pass the error so the driver DISCARDS the
    // connection instead of reusing it (prevents RLS-context or
    // aborted-transaction bleed into the next request).
    conn.release(releaseError);
  }
}

/**
 * Create a Postgres database handle for the ledger.
 * Returns an object with the db and a close method.
 *
 * `maxConnections` bounds the pool. It exists because the worker can now hold
 * SEVERAL of these open at once — one per domain lane running in parallel —
 * and node-postgres defaults to 10 per pool, so four lanes across a few
 * mappings could quietly walk into Postgres's connection limit. Callers that
 * open one pool and keep it (the API) should leave it unset.
 */
export function createPgDb(
  connectionString: string,
  maxConnections?: number,
): PgDatabase & { $pool: Pool; close: () => Promise<void> } {
  const pool = new Pool(
    maxConnections === undefined ? { connectionString } : { connectionString, max: maxConnections },
  );
  const db = drizzlePg(pool, { schema: schemaPg });
  return Object.assign(db, {
    $pool: pool,
    close: async () => {
      await pool.end();
    },
  });
}
