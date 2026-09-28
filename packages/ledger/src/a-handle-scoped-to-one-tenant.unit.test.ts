// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A HANDLE SCOPED TO ONE TENANT RUNS EVERY STATEMENT IN THAT TENANT'S SCOPE
 * (workplan 0138 T1 part 3).
 *
 * `tenantScopedDb` is what the stores a pass builds are handed: `PgLedger`,
 * `PgCursorStore`, the verification reader. They keep it for the whole pass
 * and send one statement at a time, so the handle wraps each statement in
 * `withTenant`: `BEGIN`, the driver's role if it has one, the tenant, the
 * statement, `COMMIT`, and the connection back to the pool. What is pinned
 * here is that shape, on a recording `pg` pool, because it is what makes row
 * security bind a store once the pool is `app_user`'s; the real database's
 * answer is `apps/worker/src/jobs/a-pass-under-row-security.integration.test.ts`.
 *
 * And the one thing it must not do: pass through a statement that opens or
 * ends a transaction. Each statement is its own scope here, so a `BEGIN` would
 * open one that the next statement is not in, and `db.transaction()` would
 * report atomic work that was not. drizzle 0.45 sends a transaction's `begin`
 * through the same `query` as everything else on a client that is not a
 * `Pool`, which this handle's client is not; so both are refused, and nothing
 * reaches the database.
 *
 * And what a scope costs: `BEGIN`, the tenant and `COMMIT` around the
 * statement, and nothing more. A drizzle handle over the whole schema is about
 * 0.3 ms of CPU to build, and the first version built one for every statement
 * (`pgDriver`'s `acquire` built it eagerly, and the handle reached its client
 * through it): about a third of what a scope added to a store's lookup on a
 * local Postgres (0138 Status, 2026-09-28). A pass makes a lookup per item, so
 * that is counted here: the statements build no handle.
 */

import { describe, it, expect, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import * as nodePg from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { pgDriver, tenantScopedDb } from './db.ts';
import { pgliteDriver } from './pglite-driver.ts';
import { cursor } from './schema-pg.ts';

// Every drizzle handle built, counted; each one still the real thing.
vi.mock('drizzle-orm/node-postgres', async (importOriginal) => {
  const real = await importOriginal<typeof nodePg>();
  return { ...real, drizzle: vi.fn(real.drizzle) };
});
const handlesBuilt = () => vi.mocked(nodePg.drizzle).mock.calls.length;

const TENANT = '0138b000-e29b-41d4-a716-446655440001';

/** A `pg` pool that records every statement, which client it went on, and each release. */
function recordingPool(failOn?: RegExp) {
  const said: Array<{ client: number; text: string; values?: unknown[] }> = [];
  const released: number[] = [];
  let clients = 0;
  const pool = {
    connect: async () => {
      const id = ++clients;
      return {
        query: async (q: string | { text: string }, values?: unknown[]) => {
          const text = typeof q === 'string' ? q : q.text;
          said.push({ client: id, text, ...(values ? { values } : {}) });
          if (failOn?.test(text)) throw new Error(`refused: ${text}`);
          return { rows: [], fields: [], rowCount: 0 };
        },
        release: () => void released.push(id),
      };
    },
  } as unknown as Pool;
  return { pool, said, released };
}

/**
 * The error a statement failed with. drizzle reports every failed query as
 * "Failed query: …", on this handle as on any other, with what went wrong as
 * its `cause`.
 */
async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    const cause = (err as { cause?: unknown }).cause;
    return cause instanceof Error ? cause.message : String(err);
  }
  return 'did not fail';
}

const shape = (said: Array<{ client: number; text: string }>) =>
  said.map((s) => `${s.client}: ${s.text.trim().split(/\s+/).slice(0, 3).join(' ')}`);

describe('a tenant-scoped handle', () => {
  it('runs a statement inside BEGIN, the tenant and COMMIT, on one client it then gives back', async () => {
    const { pool, said, released } = recordingPool();
    const db = tenantScopedDb(pool, TENANT);

    await db.execute(sql`SELECT count(*) FROM connection`);

    expect(shape(said)).toEqual([
      '1: BEGIN',
      "1: SELECT set_config('app.current_tenant', $1,",
      '1: SELECT count(*) FROM',
      '1: COMMIT',
    ]);
    expect(said[1]!.values).toEqual([TENANT]);
    expect(released).toEqual([1]);
  });

  it('drops to the driver\'s role first, when the driver carries one', async () => {
    const { pool, said } = recordingPool();
    const db = tenantScopedDb(pgDriver(pool, { role: 'app_user' }), TENANT);

    await db.select().from(cursor);

    expect(shape(said)).toEqual([
      '1: BEGIN',
      '1: SET LOCAL ROLE',
      "1: SELECT set_config('app.current_tenant', $1,",
      '1: select "id", "tenant_id",',
      '1: COMMIT',
    ]);
  });

  it('takes a scope per statement, never one held across them', async () => {
    const { pool, said, released } = recordingPool();
    const db = tenantScopedDb(pool, TENANT);

    await db.execute(sql`SELECT 1`);
    await db.execute(sql`SELECT 2`);

    expect(said.filter((s) => s.text === 'BEGIN').map((s) => s.client)).toEqual([1, 2]);
    expect(said.filter((s) => s.text === 'COMMIT').map((s) => s.client)).toEqual([1, 2]);
    expect(released).toEqual([1, 2]);
  });

  it('builds no drizzle handle for a statement: the scope is BEGIN, the tenant and COMMIT, and nothing more', async () => {
    const { pool, said } = recordingPool();
    const db = tenantScopedDb(pool, TENANT);
    const before = handlesBuilt();

    for (let i = 0; i < 5; i++) await db.execute(sql`SELECT 1`);

    expect(said.filter((s) => s.text === 'COMMIT')).toHaveLength(5);
    expect(handlesBuilt() - before).toBe(0);
  });

  it('rolls a failed statement back and says why, and the next one runs', async () => {
    const { pool, said } = recordingPool(/boom/);
    const db = tenantScopedDb(pool, TENANT);

    expect(await failure(db.execute(sql`SELECT boom`))).toMatch(/refused: SELECT boom/);
    expect(shape(said).slice(-1)).toEqual(['1: ROLLBACK']);

    await db.execute(sql`SELECT 3`);
    expect(shape(said).slice(-1)).toEqual(['2: COMMIT']);
  });

  it('refuses a statement that opens or ends a transaction, and sends nothing', async () => {
    const { pool, said } = recordingPool();
    const db = tenantScopedDb(pool, TENANT);

    for (const statement of ['BEGIN', 'begin isolation level serializable', 'COMMIT', 'ROLLBACK', 'SAVEPOINT a', 'START TRANSACTION']) {
      expect(await failure(db.execute(sql.raw(statement))), statement).toMatch(/transaction of its own/);
    }
    expect(said).toEqual([]);
  });

  it('refuses db.transaction(), whose work would not be atomic here', async () => {
    const { pool, said } = recordingPool();
    const db = tenantScopedDb(pool, TENANT);
    let ran = false;

    expect(
      await failure(
        db.transaction(async (tx) => {
          ran = true;
          await tx.execute(sql`SELECT 1`);
        }),
      ),
    ).toMatch(/transaction of its own/);
    expect(ran).toBe(false);
    expect(said).toEqual([]);
  });

  it('needs a tenant', () => {
    const { pool } = recordingPool();
    expect(() => tenantScopedDb(pool, '')).toThrow(/needs the tenant/);
  });

  it('refuses a PGlite driver at the first statement, rather than speak the wrong protocol to it', async () => {
    const driver = pgliteDriver({});
    try {
      expect(await failure(tenantScopedDb(driver, TENANT).execute(sql`SELECT 1`))).toMatch(/node-postgres/);
    } finally {
      await driver.end();
    }
  });
});
