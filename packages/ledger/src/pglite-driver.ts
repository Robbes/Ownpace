// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

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
 *    On a POOLED driver that is harmless — the setting is session-scoped and
 *    dies with the client that ran the migration. On a SINGLE-connection driver
 *    there is no other session: the appliance applies migrations at startup and
 *    then serves every request on that same connection, so one line of dump
 *    preamble disables row security for the life of the process. Setting it
 *    once at open is not enough, because migrations run after that; hence per
 *    acquire, which costs one statement per transaction.
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
 */

import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';

import * as schemaPg from './schema-pg';
import { log } from '@openmig/shared';
import type { LedgerConnection, LedgerDriver } from './driver';
import type { PgDatabase } from './db-types';

export interface PgliteDriverOptions {
  /**
   * Where the database lives on disk.
   *
   * Omit for an in-memory database, which is what the tests use. The appliance
   * passes a real directory — `%LOCALAPPDATA%` on Windows (workplan 0015 T3).
   */
  readonly dataDir?: string;
}

/**
 * A PGlite-backed `LedgerDriver`.
 *
 * Opening is lazy and happens once: PGlite's cold start is ~3 s (it is a WASM
 * Postgres booting), and doing that inside the first `acquire()` keeps it off
 * the process's critical path until something actually needs the database.
 */
export function pgliteDriver(options: PgliteDriverOptions = {}): LedgerDriver {
  let opening: Promise<PGlite> | null = null;
  // The serialisation queue. Each `acquire()` chains onto the previous holder's
  // release, so at most one caller holds the connection at a time.
  let busy: Promise<void> = Promise.resolve();

  async function open(): Promise<PGlite> {
    if (!opening) {
      opening = (async () => {
        const db = options.dataDir
          ? new PGlite(options.dataDir, { extensions: { pgcrypto } })
          : new PGlite({ extensions: { pgcrypto } });
        await db.waitReady;

        log.info(`[pglite] ready (${options.dataDir ?? 'in-memory'})`);
        return db;
      })();
    }
    return opening;
  }

  return {
    async acquire(): Promise<LedgerConnection> {
      const db = await open();

      // Wait for the previous holder, then install our own gate. Finding 1:
      // this is the whole reason the seam lets `acquire()` be async.
      const previous = busy;
      let releaseGate!: () => void;
      busy = new Promise<void>((resolve) => (releaseGate = resolve));
      await previous;

      // Finding 3: re-assert after every wait, because the migration chain's
      // pg_dump preamble turns it off and there is only one session.
      await db.exec('SET row_security = on;');

      let released = false;
      return {
        query: async <R>(text: string, params?: readonly unknown[]) => {
          const result = await db.query<R extends object ? R : never>(
            text,
            params as unknown[] | undefined,
          );
          return { rows: result.rows as R[] };
        },
        // PGlite's own simple-protocol entry point: multiple statements, no
        // parameters. `query()` above is the extended protocol and rejects them.
        exec: async (sql: string) => {
          await db.exec(sql);
        },
        db: drizzlePglite(db, { schema: schemaPg }) as unknown as PgDatabase,
        release: (err?: Error) => {
          // Guard against a double release handing the connection to two
          // waiters at once — which on a single-connection driver is the same
          // failure serialising exists to prevent.
          if (released) return;
          released = true;

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
 * handle is bound to the one PGlite instance — which is safe here precisely
 * because there IS only one connection: there is no pool to hand a statement to
 * a different session than the transaction it belongs to.
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
  const db = conn.db;
  conn.release();
  return { db, driver, close: () => driver.end() };
}
