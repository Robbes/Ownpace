// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The connection seam (workplan 0015 T1).
 *
 * `withTenant()` is the RLS gate: it takes a connection, opens a transaction,
 * sets `app.current_tenant` transaction-locally, and hands a drizzle handle to
 * the caller. Everything it needs from the driver is in this file, so that the
 * appliance can one day run on **PGlite** (Postgres compiled to WASM,
 * in-process — no server, no port, no `initdb`) without a single query being
 * rewritten. ADR-0023 stays intact either way: same SQL, same migrations, same
 * schema, same policies. The *server* is what goes away, not Postgres.
 *
 * ## Why this is an interface and not a swap
 *
 * `pg.Pool` hands out N independent connections. **PGlite has exactly one.**
 * That is not a detail — it is the whole reason a seam is needed rather than a
 * find-and-replace:
 *
 *  - With a pool, two concurrent `withTenant` calls get two clients and two
 *    genuinely separate transactions.
 *  - With one connection, the same two calls would interleave on it: `BEGIN`
 *    inside `BEGIN`, one `COMMIT` ending both, and `app.current_tenant` set by
 *    one tenant while the other is mid-query. That is cross-tenant data
 *    exposure produced by concurrency alone, with every RLS policy still
 *    correctly written.
 *
 * So `acquire()` is allowed to WAIT. A single-connection driver serialises by
 * not resolving until the previous holder releases, and `withTenant` — which
 * already acquires, uses and releases in a `try/finally` — needs no knowledge
 * of which kind it is talking to. The cost is throughput, and the spike says
 * that is affordable: ~1700 ledger rows/s against network I/O measured in
 * items per second, so the ledger is not the bottleneck by orders of magnitude.
 * That number came from 5,000 synthetic inserts, though, and wants re-measuring
 * against a real corpus before anyone relies on it.
 *
 * ## Why PGlite is not implemented here yet
 *
 * Installing `@electric-sql/pglite` into the workspace makes pnpm resolve a
 * SECOND copy of `drizzle-orm` — drizzle declares pglite as an optional peer,
 * so the store key changes — and the workspace then typechecks two
 * incompatible `SQL<unknown>` types against each other and fails outright.
 * Found the hard way during the T0 spike. The driver switch therefore has to be
 * one whole-workspace change, so this commit builds the seam and leaves `pg`
 * as the only implementation. The single-connection behaviour is not left
 * untested for it: `driver.unit.test.ts` exercises `withTenant` against a fake
 * driver with PGlite's constraint, which is the property that actually needs
 * proving.
 */

import type { PgDatabase } from './db-types';

/**
 * One connection, held for the duration of a transaction.
 *
 * Deliberately tiny. `withTenant` issues BEGIN/COMMIT/ROLLBACK and the
 * `set_config` that arms RLS; it needs to send those, to get a drizzle handle
 * bound to the SAME connection, and to give it back.
 */
/**
 * What a statement gives back.
 *
 * Only `rows`, because only `rows` is portable. `pg` returns `rowCount`,
 * `fields`, `command` and `oid`; PGlite returns `fields` and `affectedRows`.
 * Putting anything but the intersection here would be inviting a caller to
 * depend on something one of the two drivers does not have — which would show
 * up only when the driver is switched, and the whole point of the seam is that
 * switching drivers is not supposed to be a discovery exercise.
 */
export interface LedgerQueryResult<R = Record<string, unknown>> {
  readonly rows: R[];
}

export interface LedgerConnection {
  /**
   * Send a statement on this connection. Parameters are bound, never
   * interpolated.
   *
   * Returns rows rather than `unknown`: the migration runner reads
   * `schema_migrations` through this seam, and a caller forced to cast the
   * result would be casting away the one thing both drivers agree on.
   */
  query<R = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<LedgerQueryResult<R>>;
  /**
   * Run a SCRIPT: one or more statements, no parameters, no rows back.
   *
   * Separate from `query()` because Postgres has two wire protocols and they
   * differ in exactly this. `query()` with parameters uses the EXTENDED
   * protocol, which accepts **one** statement — a migration file full of them
   * fails with "cannot insert multiple commands into a prepared statement".
   * `pg` hides this by falling back to the simple protocol when there are no
   * parameters; PGlite does not, and exposes the two as `query()` and `exec()`.
   *
   * Found by running the real migration chain through the real PGlite driver,
   * which is the sort of thing a spike against the raw library cannot surface.
   *
   * Never interpolate user input into a script: with no parameters there is
   * nothing binding it. Callers here pass migration files read from disk.
   */
  exec(sql: string): Promise<void>;
  /**
   * A drizzle handle bound to THIS connection.
   *
   * Bound to the connection rather than the driver on purpose: a handle that
   * went back to the pool for each statement would run the caller's queries
   * outside the transaction that carries `app.current_tenant`, so RLS would see
   * no tenant and the query would fail — or, with `row_security` off, return
   * every tenant's rows.
   */
  readonly db: PgDatabase;
  /**
   * Give the connection back.
   *
   * Passing an error marks it UNUSABLE. A client whose ROLLBACK failed may
   * still be in an aborted transaction and may still carry
   * `app.current_tenant`, so it must be destroyed rather than handed to the
   * next tenant. A driver that cannot destroy connections (there is only one)
   * must reset that state itself instead.
   */
  release(err?: Error): void;
}

/**
 * Something `withTenant` can get a connection from.
 *
 * Implemented by `pgDriver(pool)` today. A PGlite driver would implement the
 * same two methods and serialise `acquire()`.
 */
export interface LedgerDriver {
  /**
   * Take a connection, waiting if none is free.
   *
   * Waiting is a legitimate implementation: see the single-connection note at
   * the top of this file. Callers must release in a `finally`.
   */
  acquire(): Promise<LedgerConnection>;
  /** Close everything. Idempotent by convention. */
  end(): Promise<void>;
}

/** Narrow a `pg.Pool` from a `LedgerDriver` without importing `pg` into the type. */
export function isLedgerDriver(x: unknown): x is LedgerDriver {
  return typeof (x as LedgerDriver | undefined)?.acquire === 'function';
}
