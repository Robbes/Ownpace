// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The PGlite implementation of the connection seam (workplan 0016 P2).
 *
 * PGlite is real Postgres compiled to WASM, running **in-process**: no service,
 * no port, no `initdb`, no major-version upgrade to perform on somebody's
 * laptop. ADR-0023 is untouched — same SQL, same migrations, same schema, same
 * RLS policies. The *server* goes away, not Postgres.
 *
 * Four things here are not optional, and each is a finding rather than a
 * preference:
 *
 * 1. **`acquire()` serialises, and that is a CORRECTNESS requirement.** PGlite
 *    has exactly one connection where `pg.Pool` has N. Two concurrent
 *    `withTenant` calls on one connection would produce `BEGIN` inside `BEGIN`,
 *    one `COMMIT` ending both, and `app.current_tenant` set by one tenant while
 *    another is mid-query — cross-tenant exposure caused by concurrency alone,
 *    with every RLS policy still correctly written. The seam permits
 *    `acquire()` to wait precisely so this driver can.
 *
 * 2. **`release(err)` cannot destroy the connection**, because there is only
 *    one. Where `pg` discards a client whose ROLLBACK failed, this resets it:
 *    another ROLLBACK, then `RESET app.current_tenant`. A connection left in an
 *    aborted transaction still carrying a tenant id is exactly the state the
 *    pool path refuses to reuse, and here there is nothing else to hand out.
 *
 * 3. **`row_security` is re-asserted on EVERY acquire, and the reason is not
 *    the one workplan 0015 T0 recorded.** That spike concluded PGlite defaults
 *    the setting OFF where a real server defaults it ON. Measured here, a fresh
 *    PGlite 0.5.4 reports `on` — the same as a server. What actually turns it
 *    off is **our own migration**: `0001_baseline.sql` is a `pg_dump`, and line
 *    43 of its preamble is `SET row_security = off;`.
 *
 *    On a SINGLE-connection driver there is no other session: the appliance
 *    applies migrations at startup and then serves every request on that same
 *    connection, so one line of dump preamble disables row security for the
 *    life of the process. Setting it once at open is not enough, because
 *    migrations run after that; hence per acquire, which costs one statement
 *    per transaction. A POOLED driver is not spared either, as was once written
 *    here: a pool hands the client that ran the migration to the next caller,
 *    session settings and all. `runMigrations` now ends with `RESET ALL`, for
 *    every driver (0128 T5, slice 2b).
 *
 *    This is not a PGlite quirk. Any driver that reuses one long-lived
 *    connection across migrate-then-serve inherits it.
 *
 * 4. **`pgcrypto` needs the contrib import**, or the baseline's
 *    `CREATE EXTENSION pgcrypto` fails with "extension is not available".
 *    Nothing in the schema calls a pgcrypto function — `gen_random_uuid()` has
 *    been core Postgres since 13, so that line is a `pg_dump` artefact — but
 *    the baseline stays byte-identical to what real Postgres gets, so the
 *    squash equivalence proof stays valid. Load the contrib; do not edit the
 *    SQL.
 *
 * 5. **The shared handle waits its turn too** (2026-11-24). `createPgliteDb()`
 *    also hands out a drizzle handle for use OUTSIDE `withTenant` — the
 *    appliance builds its status store and cursor store on it. It used to send
 *    each statement straight to the one session, past the queue in finding 1.
 *    `withTenant` opens its transaction in three statements (`BEGIN`,
 *    `SET LOCAL ROLE`, `set_config`), and a statement that landed between the
 *    role and the tenant ran as `app_user` with an empty tenant: the policies'
 *    `''::uuid` raised 22P02 and aborted the other caller's transaction (25P02
 *    on its next statement). Any statement that landed later ran inside a
 *    transaction it did not belong to, and was rolled back with it.
 *
 *    So that handle now takes the queue for each statement: wait, run the one
 *    statement, give it back. It must NOT wait when it is used from inside a
 *    holder's own work — a store built on it, awaited inside a `withTenant`
 *    callback, would wait for itself forever. `acquire()` therefore marks its
 *    holder in an `AsyncLocalStorage`, entered around the holder's work with
 *    `LedgerConnection.within`, and a statement sent under the current
 *    holder's mark runs on the session directly: inside that transaction, as
 *    it always has. A mark that outlives its holder (work left running after
 *    release) no longer matches, and waits like anyone else.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';

import * as schemaPg from './schema-pg.ts';
import { log } from '@openmig/shared';
import { assertRoleName, type LedgerConnection, type LedgerDriver } from './driver.ts';
// Every Drizzle failure, and every one sent through this driver, is thrown
// without the values its message would say (workplan 0168).
import { rethrowWithoutValues } from './driver-errors.ts';
import type { PgDatabase } from './db-types.ts';

export interface PgliteDriverOptions {
  /**
   * Where the database lives on disk.
   *
   * Omit for an in-memory database, which is what the tests use. The appliance
   * passes a real directory — `%LOCALAPPDATA%` on Windows (workplan 0015 T3).
   */
  readonly dataDir?: string;
  /**
   * Serve tenant traffic as this role — `app_user` for the appliance.
   *
   * PGlite runs as `postgres`, a superuser, and superusers bypass row security
   * unconditionally. Without a role the appliance's 96 policies are inert. See
   * `LedgerDriver.role`; `withTenant()` applies it transaction-locally, so the
   * migration chain still runs as the owner that has to create those policies.
   */
  readonly role?: string;
}

/**
 * A snapshot of a pristine, freshly-initialised cluster, kept for the life of
 * the process.
 *
 * Booting an in-memory PGlite is not mostly WASM loading — it is `initdb`,
 * which builds a whole Postgres cluster from nothing. Measured on this repo:
 *
 *     new PGlite()                          3242ms / 2857ms
 *     PGlite.create({ loadDataDir: dump })   783ms /  768ms
 *     dumpDataDir('none')                    150ms   (39 MB, uncompressed)
 *
 * The unit tier creates 32 of these, so `initdb` was running 32 times to
 * produce 32 byte-identical empty clusters. This runs it ONCE per process and
 * restores the rest from the dump.
 *
 * **It changes nothing about what a caller gets.** The snapshot is taken
 * immediately after `waitReady` and before any migration or query, so a
 * restored database is the same empty cluster `initdb` would have produced —
 * every test still applies its own migrations and still gets its own isolated
 * database. This is not a shared instance and not a pre-migrated fixture;
 * caching a MIGRATED snapshot would have been the tempting version and would
 * have quietly stopped the migration tests from running migrations.
 *
 * Only the in-memory path uses it. The appliance passes `dataDir` and opens
 * its real database on disk, untouched by any of this.
 */
let pristineCluster: Promise<Blob> | null = null;

async function openInMemory(): Promise<PGlite> {
  pristineCluster ??= (async () => {
    const seed = new PGlite({ extensions: { pgcrypto } });
    await seed.waitReady;
    const dump = await seed.dumpDataDir('none');
    await seed.close();
    return dump;
  })();
  return PGlite.create({ loadDataDir: await pristineCluster, extensions: { pgcrypto } });
}

/** A PGlite driver, and the one way to get a handle for use outside a transaction. */
export interface PgliteLedgerDriver extends LedgerDriver {
  /**
   * A drizzle handle for statements outside any `withTenant`, each taking the
   * driver's queue in turn (finding 5). Never the raw instance.
   */
  sharedDb(): Promise<PgDatabase>;
}

/**
 * The PGlite instance as drizzle sees it, with every statement sent in its turn.
 *
 * Drizzle's PGlite session sends statements through `query()` and opens
 * transactions through `transaction()`; `exec()` is the simple protocol. Those
 * three wait their turn. Everything else passes through to the instance.
 */
function queued(db: PGlite, inTurn: <T>(run: () => Promise<T>) => Promise<T>): PGlite {
  const gated = new Set<PropertyKey>(['query', 'exec', 'transaction']);
  return new Proxy(db, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      const bound = (value as (...a: unknown[]) => unknown).bind(target);
      if (!gated.has(prop)) return bound;
      return (...args: unknown[]) => inTurn(() => bound(...args) as Promise<unknown>);
    },
  });
}

/**
 * A PGlite-backed `LedgerDriver`.
 *
 * Opening is lazy and happens once: PGlite's cold start is ~3 s (it is a WASM
 * Postgres booting), and doing that inside the first `acquire()` keeps it off
 * the process's critical path until something actually needs the database.
 */
export function pgliteDriver(options: PgliteDriverOptions = {}): PgliteLedgerDriver {
  const role = options.role === undefined ? undefined : assertRoleName(options.role);
  let opening: Promise<PGlite> | null = null;
  // The serialisation queue. Each `acquire()` chains onto the previous holder's
  // release, so at most one caller holds the connection at a time.
  let busy: Promise<void> = Promise.resolve();
  // Who holds the session now, and whose work is running (finding 5). A
  // statement on the shared handle under the current holder's mark is that
  // holder's own, and runs without waiting.
  let holder: symbol | null = null;
  const holding = new AsyncLocalStorage<symbol>();

  /** Wait for the previous holder, then hold the session; resolves to the release. */
  async function takeTurn(): Promise<() => void> {
    const previous = busy;
    let releaseGate!: () => void;
    busy = new Promise<void>((resolve) => (releaseGate = resolve));
    await previous;
    return releaseGate;
  }

  /**
   * Run ONE statement of the shared handle in its turn (finding 5).
   *
   * Directly when it comes from the current holder's own work; otherwise it
   * takes the queue like `acquire()`, and holds the session for exactly this
   * statement. Its own mark covers a drizzle `transaction()` callback, so the
   * statements that callback sends on the shared handle run inside it too.
   */
  async function inTurn<T>(run: () => Promise<T>): Promise<T> {
    if (holder !== null && holding.getStore() === holder) return run();
    const releaseGate = await takeTurn();
    const mark = Symbol('pglite statement');
    holder = mark;
    try {
      return await holding.run(mark, run);
    } finally {
      holder = null;
      releaseGate();
    }
  }

  async function open(): Promise<PGlite> {
    if (!opening) {
      opening = (async () => {
        const db = options.dataDir
          ? new PGlite(options.dataDir, { extensions: { pgcrypto } })
          : await openInMemory();
        await db.waitReady;

        log.info(`[pglite] ready (${options.dataDir ?? 'in-memory'})`);
        return db;
      })();
    }
    return opening;
  }

  return {
    role,

    async acquire(): Promise<LedgerConnection> {
      const db = await open();

      // Wait for the previous holder, then install our own gate. Finding 1:
      // this is the whole reason the seam lets `acquire()` be async.
      const releaseGate = await takeTurn();
      const mark = Symbol('pglite holder');
      holder = mark;

      // Finding 3: re-assert after every wait, because the migration chain's
      // pg_dump preamble turns it off and there is only one session.
      await db.exec('SET row_security = on;');

      let released = false;
      return {
        query: async <R>(text: string, params?: readonly unknown[]) => {
          const result = await db
            .query<R extends object ? R : never>(text, params as unknown[] | undefined)
            .catch(rethrowWithoutValues);
          return { rows: result.rows as R[] };
        },
        // PGlite's own simple-protocol entry point: multiple statements, no
        // parameters. `query()` above is the extended protocol and rejects them.
        exec: async (sql: string) => {
          await db.exec(sql).catch(rethrowWithoutValues);
        },
        db: drizzlePglite(db, { schema: schemaPg }) as unknown as PgDatabase,
        // Finding 5: the holder's work, marked, so the shared handle used
        // inside it runs on this session rather than waiting for itself.
        within: <T>(work: () => Promise<T>) => holding.run(mark, work),
        release: (err?: Error) => {
          // Guard against a double release handing the connection to two
          // waiters at once — which on a single-connection driver is the same
          // failure serialising exists to prevent.
          if (released) return;
          released = true;
          if (holder === mark) holder = null;

          if (!err) {
            releaseGate();
            return;
          }

          // Finding 2. There is no second connection to switch to, so reset
          // this one rather than discard it. Deliberately fire-and-forget with
          // a logged failure: `release()` is synchronous by contract, and a
          // reset that cannot complete is worth shouting about but must not
          // deadlock every subsequent tenant by never opening the gate.
          log.error('[pglite] resetting the connection after a failed rollback:', err);
          void db
            .exec("ROLLBACK; RESET ROLE; SELECT set_config('app.current_tenant', '', false);")
            .catch((resetErr: unknown) => {
              log.error('[pglite] connection reset FAILED — state may be dirty:', resetErr);
            })
            .finally(releaseGate);
        },
      };
    },

    /** The shared handle `createPgliteDb()` hands out (finding 5). */
    async sharedDb(): Promise<PgDatabase> {
      return drizzlePglite(queued(await open(), inTurn), { schema: schemaPg }) as unknown as PgDatabase;
    },

    async end(): Promise<void> {
      if (!opening) return;
      const db = await opening;
      opening = null;
      await db.close();
    },
  };
}

/**
 * A PGlite database handle plus its driver, shaped for the appliance's startup.
 *
 * Mirrors what `createPgDb()` returns for the `pg` path, so the entrypoint can
 * choose a backend and then wire the stores identically either way. The drizzle
 * handle is bound to the one PGlite instance, and each statement it sends takes
 * the driver's queue (finding 5). This comment used to call the bare handle
 * safe because there is only one connection; that one connection is exactly
 * why it was not.
 */
export async function createPgliteDb(options: PgliteDriverOptions = {}): Promise<{
  readonly db: PgDatabase;
  readonly driver: LedgerDriver;
  close: () => Promise<void>;
}> {
  const driver = pgliteDriver(options);
  // Take and release a connection once, so the WASM database is booted and its
  // drizzle handle exists before anything asks for it. Cold start is ~3 s and
  // belongs at startup, not inside the first request.
  const conn = await driver.acquire();
  conn.release();
  const db = await driver.sharedDb();
  return { db, driver, close: () => driver.end() };
}
