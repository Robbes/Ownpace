// Copyright 2026 The Ownpace authors (Apache-2.0)
// Database connection utilities for the ledger.
// PostgreSQL only (see ADR-0010, ADR-0016, ADR-0023).
// Uses the `pg` driver (node-postgres) with drizzle-orm/node-postgres.

import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient, type QueryConfig } from 'pg';

import * as schemaPg from './schema-pg.ts';
import { log } from '@openmig/shared';
import {
  assertRoleName,
  isLedgerDriver,
  type LedgerConnection,
  type LedgerDriver,
} from './driver.ts';
import type { PgDatabase } from './db-types.ts';
import { holdUntilCommit } from './after-commit.ts';

export type { PgDatabase };

/**
 * The `pg` client under each connection `pgDriver` hands out, for
 * `tenantScopedDb` to send its one statement on (workplan 0138 T1). Kept off
 * `LedgerConnection` so the seam stays what both drivers can offer; a
 * connection from any other driver is simply not in here.
 */
const pgClientOf = new WeakMap<LedgerConnection, PoolClient>();

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
export function pgDriver(pool: Pool, options: { readonly role?: string } = {}): LedgerDriver {
  // Validated at construction, not at use: a bad role name should fail when the
  // process is wired up, not on the first request that happens to need it.
  const role = options.role === undefined ? undefined : assertRoleName(options.role);
  return {
    role,
    async acquire(): Promise<LedgerConnection> {
      const client = await pool.connect();
      // Built on first use. A drizzle handle over the whole schema costs about
      // 0.3 ms of CPU to build, and `tenantScopedDb` takes a connection per
      // statement and never touches it. Built on every acquire, it was about a
      // third of what a scope added to a store's lookup (0138 Status,
      // 2026-09-28).
      let db: PgDatabase | undefined;
      const conn: LedgerConnection = {
        query: <R>(text: string, params?: readonly unknown[]) =>
          client.query<R extends Record<string, unknown> ? R : never>(
            text,
            params as unknown[] | undefined,
          ),
        // No parameters, so node-postgres uses the SIMPLE protocol and accepts
        // multiple statements — which is what a migration file is.
        exec: async (sql: string) => {
          await client.query(sql);
        },
        get db(): PgDatabase {
          return (db ??= drizzlePg(client, { schema: schemaPg }) as unknown as PgDatabase);
        },
        release: (err?: Error) => client.release(err),
      };
      pgClientOf.set(conn, client);
      return conn;
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
  return inTenantScope(source, tenantId, (conn) => fn(conn.db));
}

/**
 * `withTenant`'s scope, handing over the connection rather than a drizzle
 * handle on it. `withTenant` hands its caller `conn.db`; `tenantScopedDb`
 * sends one statement on the connection's own client and needs no handle.
 * Module-private: the one place the tenant is set stays in this file.
 */
async function inTenantScope<T>(
  source: LedgerDriver | Pool,
  tenantId: string,
  fn: (conn: LedgerConnection) => Promise<T>,
): Promise<T> {
  const driver = isLedgerDriver(source) ? source : pgDriver(source);
  // May WAIT on a single-connection driver — that is the point of the seam, and
  // the reason this is the only place a connection is taken. See `driver.ts`.
  const conn = await driver.acquire();
  // Set once ROLLBACK fails: the connection may be left in an aborted transaction
  // (possibly still carrying app.current_tenant), so it must be DESTROYED rather
  // than returned for the next tenant to reuse.
  let releaseError: Error | undefined;
  // What the caller's work hands `afterCommit` (an audit event's line, 0129 T4)
  // runs once this transaction has committed, and never if it rolls back.
  const held = holdUntilCommit();
  let committed = false;

  try {
    // Begin transaction
    await conn.query('BEGIN');

    // Drop to the unprivileged role, if the driver was given one, BEFORE the
    // tenant context is set and before any of the caller's queries run.
    //
    // Without this the policies below are decoration: Postgres exempts
    // superusers from row security unconditionally, and a table's owner unless
    // the table is FORCEd — and the appliance connects as one or the other on
    // both of its backends. See `LedgerDriver.role`.
    //
    // `SET LOCAL`, so it reverts on the COMMIT or ROLLBACK this function
    // already issues. Nothing to remember to undo, and a connection handed back
    // to the pool carries no trace of it.
    if (driver.role) {
      await conn.query(`SET LOCAL ROLE "${assertRoleName(driver.role)}"`);
    }

    // Set tenant context - use set_config with bind param for safety
    // The third parameter `true` makes it transaction-local (equivalent to SET LOCAL)
    await conn.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);

    // Run the function on the transaction's connection
    const result = await held.during(() => fn(conn));

    // Commit transaction
    await conn.query('COMMIT');
    committed = true;

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
    held.end(committed);
  }
}

/**
 * The statements that open or close a transaction. A `tenantScopedDb` runs
 * every statement in a transaction of its own, so one of these would open or
 * end a scope that is not the caller's: refused, never sent.
 */
const TRANSACTION_CONTROL =
  /^\s*(?:begin|start\s+transaction|commit|end|rollback|abort|savepoint|release|prepare\s+transaction)\b/i;

/** The client a `tenantScopedDb` hands drizzle: every statement, one `withTenant` scope. */
class TenantScopedClient {
  private readonly driver: LedgerDriver;
  private readonly tenantId: string;

  constructor(driver: LedgerDriver, tenantId: string) {
    this.driver = driver;
    this.tenantId = tenantId;
  }

  query(config: unknown, values?: unknown[]): Promise<unknown> {
    const text = typeof config === 'string' ? config : ((config as { text?: string } | null)?.text ?? '');
    if (TRANSACTION_CONTROL.test(text)) {
      return Promise.reject(
        new Error(
          `A tenant-scoped handle runs each statement in a transaction of its own, so it cannot run ` +
            `"${text.trim().split(/\s+/)[0]}": the statements after it would not be in it. Use withTenant ` +
            'for work that must commit together.',
        ),
      );
    }
    return inTenantScope(this.driver, this.tenantId, async (conn) => {
      // The client the scope's transaction is on: BEGIN, the role and the
      // tenant were sent on it, so this statement runs inside them.
      const client = pgClientOf.get(conn);
      if (!client) {
        throw new Error(
          'tenantScopedDb speaks node-postgres, and this driver hands out another kind of connection ' +
            '(PGlite). Use withTenant on it instead.',
        );
      }
      // drizzle sends a config object (`text`, `rowMode`, `types`), as it does
      // on any pool; a string is taken too.
      return typeof config === 'string' ? client.query(config, values) : client.query(config as QueryConfig, values);
    });
  }
}

/**
 * A drizzle handle for ONE tenant, each of whose statements runs inside
 * `withTenant` for that tenant (workplan 0138 T1 part 3).
 *
 * The stores a pass builds (`PgLedger`, `PgCursorStore`, the verification
 * reader) are handed a drizzle handle and keep it for the whole pass, which can
 * run for many minutes. `withTenant`'s own handle is dead once its transaction
 * commits, and holding one transaction open for a pass would block vacuum and
 * is what `idle_in_transaction_session_timeout` exists to end
 * (`run-confirmation.ts` says the same). So this handle takes a fresh scope per
 * statement: `BEGIN`, the driver's role if it carries one, the tenant, the
 * statement, `COMMIT`. `withTenant`'s scope stays the one place the tenant is
 * set; this only calls it (`inTenantScope`, the same function, handing over
 * the connection). The cost is those extra round trips per statement (0138 T1,
 * "Why one transaction per statement"), and nothing more: the statement goes
 * on the scope's own `pg` client, so no drizzle handle is built for it.
 *
 * WHY ONE STATEMENT AT A TIME IS ENOUGH. Read in drizzle-orm 0.45's
 * node-postgres session (`drizzle-orm/node-postgres/session.js`), not assumed:
 * every statement a handle runs is one `client.query(config, params)` on the
 * client the handle was built over, and nothing else touches that client. The
 * stores send their statements one at a time, as they did on the plain pool
 * handle this replaces, where each statement also committed on its own. The
 * one call that would span statements is `db.transaction()`: on a client that
 * is not a `Pool` (drizzle tests `instanceof Pool` or a constructor name
 * containing "Pool"), drizzle sends its `begin` and `commit` through that same
 * `query`, so here they would land in scopes of their own and leave the work
 * between them unatomic. No code in this repository calls it (`.transaction(`
 * occurs nowhere), and the client above refuses those statements rather than
 * let one through.
 *
 * On a superuser's connection, which the managed tasks connect with until 0138
 * T1's switch, the scope changes nothing a statement sees: Postgres applies no
 * policy to a superuser. On `app_user`, a statement sees this tenant's rows and
 * no other's, whatever its own `WHERE` says.
 *
 * NODE-POSTGRES ONLY. The statement goes on the `pg` client under a connection
 * `pgDriver` handed out. A PGlite driver's connection is not one, and speaks
 * another client's protocol, so the handle refuses there at the first
 * statement. The appliance, the one user of PGlite,
 * does not use it (0138, "Not in this plan").
 *
 * Nothing to close: it opens no pool. The caller's pool is the caller's.
 */
export function tenantScopedDb(source: LedgerDriver | Pool, tenantId: string): PgDatabase {
  if (!tenantId) {
    throw new Error('tenantScopedDb needs the tenant every statement is scoped to');
  }
  const driver = isLedgerDriver(source) ? source : pgDriver(source);
  return drizzlePg(new TenantScopedClient(driver, tenantId) as unknown as Pool, {
    schema: schemaPg,
  }) as unknown as PgDatabase;
}

/**
 * A drizzle handle on a pool the CALLER owns, with no tenant scope (workplan
 * 0138 T1 part 3).
 *
 * For the tables that carry no row security by design and are keyed by tenant
 * in their own columns: the rate and byte budgets (ledger migrations 0024 and
 * 0030). A token bucket is consulted per request for a pass's whole life, so a
 * `tenantScopedDb` would buy it nothing and cost a transaction per request.
 * Opens nothing: the caller ends its pool.
 */
export function plainDb(pool: Pool): PgDatabase {
  return drizzlePg(pool, { schema: schemaPg });
}

/**
 * Run `fn` as a SUBJECT **and** scoped to a tenant, in ONE transaction
 * (workplan 0093 T6).
 *
 * **There is exactly one thing this is for: provisioning.** Granting an access
 * request has to do three things that must stand or fall together — read the
 * request (which only an operator may do, `app.current_user`), create the tenant
 * and its first owner (which the tenant policies key on `app.current_tenant`),
 * and mark the request granted against that tenant id. Split across two
 * transactions, a failure between them leaves either an organisation nobody
 * asked for or a request pointing at one that does not exist.
 *
 * **The tenant it is scoped to is the one being CREATED.** That is what makes
 * holding both scopes at once unremarkable here: the tenant is empty, so the
 * tenant half of the scope grants sight of nothing. Do not reach for this to
 * read an existing tenant as an operator — that is a different question, and it
 * should get a policy that says so rather than a caller that sets a GUC.
 *
 * WHAT IS AND IS NOT ENFORCED BY THE DATABASE HERE. That only an operator may
 * read or decide an access request IS: migration 0005's policies, asserted in
 * `operator-under-rls.unit.test.ts` against the real `app_user`. That only an
 * operator may create a tenant is NOT — `tenant_isolation_insert` asks only
 * that the row's id match the scope, so any caller that reaches this function
 * could mint one. It is guarded because provisioning only ever happens inside
 * deciding a request, which is guarded. A rogue caller would get an EMPTY
 * organisation with itself as owner: no data, no billing, nothing that was
 * anybody else's. Said plainly rather than left for a reader to work out.
 */
export async function withSubjectAndTenant<T>(
  source: LedgerDriver | Pool,
  userId: string,
  tenantId: string,
  fn: (db: PgDatabase) => Promise<T>
): Promise<T> {
  const driver = isLedgerDriver(source) ? source : pgDriver(source);
  const conn = await driver.acquire();
  let releaseError: Error | undefined;

  try {
    await conn.query('BEGIN');
    if (driver.role) {
      await conn.query(`SET LOCAL ROLE "${assertRoleName(driver.role)}"`);
    }
    await conn.query("SELECT set_config('app.current_user', $1, true)", [userId]);
    await conn.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    const result = await fn(conn.db);
    await conn.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await conn.query('ROLLBACK');
    } catch (rollbackError) {
      log.error('Rollback failed after error:', rollbackError);
      releaseError = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
    }
    throw error;
  } finally {
    conn.release(releaseError);
  }
}

/** Extra context `withSubject` may carry. */
export interface WithSubjectOptions {
  /**
   * An email address the ISSUER SAID IT VERIFIED, exposed to policies as
   * `app.current_email` (migration 0006).
   *
   * The only thing it unlocks is claiming an invitation addressed to that
   * address, and it is the reason the word "verified" is in the name rather
   * than in a comment: passing an unverified address here would let whoever can
   * create an account bearing it inherit whatever was invited to it. Callers
   * must read `email_verified` and pass nothing when it is not true — omitted
   * means no claim, which is the safe direction.
   */
  readonly verifiedEmail?: string;
}

/**
 * Run `fn` scoped to a SUBJECT rather than to a tenant (ADR-0042).
 *
 * The one question that cannot be asked inside `withTenant`: *which tenants do I
 * belong to?* Every policy on `tenant_member` keys on `app.current_tenant`, so
 * answering it requires already knowing the answer. This sets `app.current_user`
 * instead, which migration `0003_a_person_can_see_their_own_memberships`
 * matches with a SELECT policy for your own rows.
 *
 * **Deliberately narrow.** It sets no tenant, so nothing tenant-scoped is
 * readable through it: every other table's policies require
 * `app.current_tenant`, which is not set here. So this is not a back door into
 * the ledger — it opens exactly one table, for exactly the rows naming this
 * subject. Keep it that way: if a second question ever needs subject scope, add
 * a policy for it rather than widening what this sets.
 *
 * **AND THE TABLE IT OPENS NEEDS NULL-SAFE TENANT POLICIES.** This comment used
 * to say the tenant policies "answer NULL rather than raising", and that is only
 * true on a connection that has never held a tenant. `SET LOCAL` reverts to the
 * SESSION value, which for a setting never assigned at session level is the
 * EMPTY STRING — so from the second transaction on a pooled connection,
 * `current_setting('app.current_tenant', true)` is `''`, and `''::uuid` RAISES.
 * Permissive policies are OR'd and all of them are evaluated, so a subject-scoped
 * read runs the tenant policies too and the whole query fails with a 500.
 * `tenant_member`'s policies were made NULL-safe in migration `0004`;
 * `guc-decay-under-rls.unit.test.ts` reproduces the decay and fails without it.
 * Any table brought into subject scope later needs the same treatment.
 *
 * Same shape as `withTenant` otherwise, and for the same reasons: it drops to
 * the unprivileged role FIRST (policies are decoration to an owner or a
 * superuser), uses `SET LOCAL`/`set_config(…, true)` so the context cannot
 * outlive the transaction, and destroys the connection when a rollback fails
 * rather than handing a poisoned one back.
 */
export async function withSubject<T>(
  source: LedgerDriver | Pool,
  userId: string,
  fn: (db: PgDatabase) => Promise<T>,
  options: WithSubjectOptions = {}
): Promise<T> {
  const driver = isLedgerDriver(source) ? source : pgDriver(source);
  const conn = await driver.acquire();
  let releaseError: Error | undefined;

  try {
    await conn.query('BEGIN');
    if (driver.role) {
      await conn.query(`SET LOCAL ROLE "${assertRoleName(driver.role)}"`);
    }
    await conn.query("SELECT set_config('app.current_user', $1, true)", [userId]);
    if (options.verifiedEmail !== undefined) {
      await conn.query("SELECT set_config('app.current_email', $1, true)", [options.verifiedEmail]);
    }
    const result = await fn(conn.db);
    await conn.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await conn.query('ROLLBACK');
    } catch (rollbackError) {
      log.error('Rollback failed after error:', rollbackError);
      releaseError = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
    }
    throw error;
  } finally {
    conn.release(releaseError);
  }
}

/**
 * The context a MIGRATOR'S LINK reads in (workplan 0108 T1, ADR-0035).
 *
 * The one question that cannot be asked inside `withTenant` OR `withSubject`:
 * *which mapping is this link for?* A link holder has no session, no subject
 * and no tenant — the row is what would tell us which tenant to assume, so
 * reading it cannot require already knowing. This sets `app.current_link`,
 * which migration 0031's `link_sees_itself` matches for exactly the row whose
 * id was presented.
 *
 * **It authorises nothing, and the narrowness is the point.** Knowing an id is
 * not knowing the secret; the hash comparison in the API is what
 * authenticates a bearer. What this bounds is BLAST RADIUS — one row, no
 * other, so a mistake in a WHERE clause cannot become a walk of other
 * tenants' links. Everything the link then goes on to do runs under
 * `withTenant` with the tenant the verified row named, so the ordinary
 * policies apply to every write.
 *
 * Keep it that way: if a second table ever needs link scope, give it its own
 * policy rather than widening what this sets — and give that table NULL-safe
 * tenant policies first, for the reason `withSubject` records above.
 */
export async function withMappingLink<T>(
  source: LedgerDriver | Pool,
  linkId: string,
  fn: (db: PgDatabase) => Promise<T>
): Promise<T> {
  const driver = isLedgerDriver(source) ? source : pgDriver(source);
  const conn = await driver.acquire();
  let releaseError: Error | undefined;

  try {
    await conn.query('BEGIN');
    if (driver.role) {
      await conn.query(`SET LOCAL ROLE "${assertRoleName(driver.role)}"`);
    }
    await conn.query("SELECT set_config('app.current_link', $1, true)", [linkId]);
    const result = await fn(conn.db);
    await conn.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await conn.query('ROLLBACK');
    } catch (rollbackError) {
      log.error('Rollback failed after error:', rollbackError);
      releaseError = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
    }
    throw error;
  } finally {
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
