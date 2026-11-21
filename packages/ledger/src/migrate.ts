// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Startup migration runner (workplan 0010 T1).
 *
 * Applies `packages/ledger/migrations/*.sql` linearly under a Postgres advisory
 * lock, recording each applied version in a `schema_migrations` table. Used by
 * the self-host entrypoint on startup and reusable by the worker/managed edition.
 *
 * Properties (SAD §22.1):
 * - **Idempotent:** re-running applies nothing (a no-op).
 * - **Concurrency-safe:** two processes racing the advisory lock apply each
 *   migration exactly once — the loser waits, then sees them already applied.
 * - **Refuses to start** when the database reports a schema version NEWER than
 *   this build understands (a downgrade guard).
 *
 * Runs as the DB owner/superuser (migrations create roles + RLS policies —
 * 0008/0009); the application then connects as a less-privileged role in managed
 * mode, or as the owner in single-tenant self-host mode.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Pool } from 'pg';
import { log as appLog } from '@openmig/shared';
import { pgDriver } from './db.ts';
import type { LedgerConnection, LedgerDriver } from './driver.ts';

/** Dedicated advisory-lock key for schema migrations (distinct from app locks). */
const MIGRATION_ADVISORY_LOCK_KEY = 727_0010;

/**
 * A chain's own bookkeeping table. Defaults to the one every install has.
 *
 * There are TWO chains now (ADR-0036): the shared one every edition applies,
 * and a managed-only one that adds the tables an appliance has no use for. They
 * cannot share `schema_migrations`, and the reason is the downgrade guard below
 * rather than tidiness.
 *
 * That guard refuses to start when the highest RECORDED version exceeds the
 * highest one on disk. **The two chains' versions were never ordered against
 * each other**, so one ledger has it comparing numbers with nothing in common
 * — and which side breaks is an accident of how somebody named a file. With
 * today's names it is the managed chain, immediately, because
 * `0001_the_managed_service.sql` sorts below the shared chain's `0027_...`.
 * Name that file `0100_` and it becomes the appliance instead, at boot, on a
 * machine that never downgraded anything. `two-chains.unit.test.ts` pins it.
 *
 * Separate advisory-lock keys for the same reason in the concurrency dimension:
 * one key would make the two chains serialise against each other for no
 * benefit, and — worse — a chain that failed while holding it would block the
 * other one's migrator on a lock it has no business waiting for.
 */
const DEFAULT_BOOKKEEPING_TABLE = 'schema_migrations';

/**
 * How long a migration file may WAIT for a table lock before it gives up
 * (workplan 0165, the owner's D3 of 2026-11-21).
 *
 * Each file runs in one transaction, so every lock it takes is held to its
 * COMMIT. Asking for a strong lock (an `ALTER TABLE`, a `CREATE INDEX`) while a
 * long query holds a weaker one makes the migration wait, and every later
 * query on that table queues behind the migration: one slow report can stop a
 * table for as long as it runs. With a lock timeout the file fails instead,
 * its transaction rolls back with nothing applied, and the next start tries
 * again (on the managed stack the API exits and compose restarts it).
 *
 * `SET LOCAL`, so it ends with the file's transaction: the advisory lock the
 * runner takes BEFORE any file, which is meant to wait for another migrator,
 * is never cut short. It bounds the wait for a lock, not the work: there is
 * deliberately no `statement_timeout`, since a migration that holds its lock
 * and is working, such as an index build, should finish rather than be cut off
 * halfway. Five seconds is the builder's choice; D3 named no value. Moving it
 * is this one line.
 */
export const MIGRATION_LOCK_TIMEOUT = '5s';

export interface RunMigrationsOptions {
  /**
   * Owner/superuser connection string (migrations create roles + RLS).
   *
   * Optional only because `driver` is the alternative — exactly one of the two
   * is required.
   */
  connectionString?: string;
  /**
   * Run against an already-built driver instead of opening a pool (workplan
   * 0015 T1).
   *
   * The point of the seam here: PGlite is a FILE, not a server, so there is no
   * connection string to give — a `connectionString`-only signature is the one
   * thing that would keep the appliance tied to a running Postgres even after
   * every query became portable. A caller that passes a driver owns its
   * lifetime; this function will not close it.
   */
  driver?: LedgerDriver;
  /** Override the migrations directory (defaults to this package's migrations/). */
  migrationsDir?: string;
  /** Optional logger; defaults to console.log. */
  logger?: (message: string) => void;
  /**
   * Which chain this is. Both default to the shared chain's values, so every
   * existing caller keeps its exact behaviour.
   */
  bookkeepingTable?: string;
  advisoryLockKey?: number;
  /**
   * How long one file may wait for a lock; defaults to MIGRATION_LOCK_TIMEOUT.
   * A Postgres duration (`'5s'`, `'200ms'`). For tests, which shorten it.
   */
  lockTimeout?: string;
}

export interface RunMigrationsResult {
  /** Versions applied during this run (empty on a no-op re-run). */
  readonly applied: readonly string[];
  /** Versions already present before this run. */
  readonly alreadyApplied: readonly string[];
  /** Highest applied version after this run, or null on an empty DB. */
  readonly currentVersion: string | null;
}

function defaultMigrationsDir(): string {
  // packages/ledger/src/migrate.ts -> packages/ledger/migrations
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
}

/** List migration versions (filenames) in linear order. */
export function listMigrationVersions(migrationsDir = defaultMigrationsDir()): string[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // zero-padded numeric prefixes sort lexicographically == numerically
}

/**
 * Apply all pending migrations. Safe to call on every startup.
 */
export async function runMigrations(options: RunMigrationsOptions): Promise<RunMigrationsResult> {
  const { connectionString, driver: suppliedDriver } = options;
  if (!connectionString && !suppliedDriver) {
    throw new Error('runMigrations requires either a connectionString or a driver');
  }
  const migrationsDir = options.migrationsDir ?? defaultMigrationsDir();
  const log = options.logger ?? ((m: string) => appLog.info(m));
  const bookkeeping = options.bookkeepingTable ?? DEFAULT_BOOKKEEPING_TABLE;
  const lockKey = options.advisoryLockKey ?? MIGRATION_ADVISORY_LOCK_KEY;
  // Interpolated into DDL below — a parameter cannot carry an identifier, so
  // the check is the only thing standing between a caller's string and the
  // statement. Callers are all in-repo constants today; that is exactly the
  // fact that quietly stops being true.
  if (!/^[a-z][a-z0-9_]*$/.test(bookkeeping)) {
    throw new Error(`Not a usable bookkeeping table name: ${bookkeeping}`);
  }
  // Interpolated as well: `SET` takes no parameter.
  const lockTimeout = options.lockTimeout ?? MIGRATION_LOCK_TIMEOUT;
  if (!/^[1-9][0-9]*(?:ms|s)$/.test(lockTimeout)) {
    throw new Error(`Not a usable lock timeout: ${lockTimeout} (a whole number of ms or s)`);
  }

  const versions = listMigrationVersions(migrationsDir);
  if (versions.length === 0) {
    throw new Error(`No migration files found in ${migrationsDir}`);
  }
  const highestKnown = versions[versions.length - 1]!;

  // A supplied driver is the caller's to close; one we opened is ours. Getting
  // this backwards would either leak a pool or close a driver still in use by
  // the process that handed it over.
  const ownsDriver = suppliedDriver === undefined;
  const driver = suppliedDriver ?? pgDriver(new Pool({ connectionString }));
  const client = await driver.acquire();
  try {
    // Serialize concurrent migrators. The loser blocks here until the winner
    // releases the lock, then finds every migration already applied.
    await client.query('SELECT pg_advisory_lock($1)', [lockKey]);
    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${bookkeeping} (
           version text PRIMARY KEY,
           applied_at timestamptz NOT NULL DEFAULT now()
         )`,
      );

      const appliedRows = await client.query<{ version: string }>(
        `SELECT version FROM ${bookkeeping}`,
      );
      const alreadyApplied = new Set(appliedRows.rows.map((r) => r.version));

      // Downgrade guard: refuse if the DB carries a version newer than we ship.
      // Its advice never says to drop the database (workplan 0134 T3). Only the
      // ledger's items can be rebuilt from a target; what sits beside them
      // cannot, and on a managed stack that is every organisation. Nor does it
      // name a squash as a cause any more: pre-release ended with the first
      // alpha tag, and the squash script refuses (workplan 0146 T3, ADR-0045).
      const highestApplied = [...alreadyApplied].sort().pop();
      if (highestApplied && highestApplied > highestKnown) {
        throw new Error(
          `Database schema version ${highestApplied} is newer than this build understands ` +
            `(highest known: ${highestKnown}). Refusing to start rather than guess.\n` +
            'Either this build is older than the database: deploy the release the database ' +
            'was last migrated by, or a newer one. Or a migration a release shipped was ' +
            'renamed or removed after it shipped: that is a defect in the build, which ' +
            'scripts/a-chain-that-only-grows.unit.test.ts exists to refuse, and the fix is a ' +
            'build that carries the file again (ADR-0045). Do not drop this database to get ' +
            'past this. The ledger\'s items can be rebuilt from the target (ADR-0020), but ' +
            'the connections and their stored credentials, the migrations and their ' +
            'settings, and on a managed stack the organisations and the audit log, cannot: ' +
            'a database that holds real data is restored from a backup, never dropped.',
        );
      }

      const applied: string[] = [];
      for (const version of versions) {
        if (alreadyApplied.has(version)) continue;
        await applyOne(client, migrationsDir, version, bookkeeping, lockTimeout, log);
        applied.push(version);
      }

      const currentVersion =
        [...alreadyApplied, ...applied].sort().pop() ?? null;

      if (applied.length === 0) {
        log(`[migrate] schema up to date at ${currentVersion ?? 'empty'}`);
      } else {
        log(`[migrate] applied ${applied.length} migration(s); now at ${currentVersion}`);
      }

      return { applied, alreadyApplied: [...alreadyApplied], currentVersion };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [lockKey]);
      // Hand the connection back as a fresh session. The baseline is a
      // `pg_dump`, and its preamble sets `row_security = off` for the SESSION.
      // A pool does not end the session: it hands the same connection to the
      // next caller, and a `withTenant` that drops to the serving role on it is
      // refused ("query would be affected by row-level security policy"). The
      // appliance on Postgres migrates and serves on one pool, and met exactly
      // that at start-up (0128 T5, slice 2b). PGlite's driver re-asserts the
      // setting on every acquire; this puts back every setting a migration
      // changed, on every driver.
      await client.query('RESET ALL');
    }
  } finally {
    client.release();
    if (ownsDriver) await driver.end();
  }
}

/** Apply a single migration file + record it, atomically. */
async function applyOne(
  client: LedgerConnection,
  migrationsDir: string,
  version: string,
  bookkeeping: string,
  lockTimeout: string,
  log: (m: string) => void,
): Promise<void> {
  const sql = readFileSync(join(migrationsDir, version), 'utf-8');
  log(`[migrate] applying ${version}`);
  await client.query('BEGIN');
  try {
    // For this file's transaction only (MIGRATION_LOCK_TIMEOUT says why).
    await client.query(`SET LOCAL lock_timeout = '${lockTimeout}'`);
    // exec, not query: a migration file is many statements, and the extended
    // protocol accepts one. See `LedgerConnection.exec`.
    await client.exec(sql);
    await client.query(`INSERT INTO ${bookkeeping} (version) VALUES ($1)`, [version]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    // 55P03 is lock_not_available, what Postgres raises when lock_timeout
    // runs out. Said plainly, because "canceling statement due to lock
    // timeout" alone reads like the migration is wrong, and it is not.
    const waited =
      (err as { code?: unknown } | null)?.code === '55P03'
        ? ` It waited more than ${lockTimeout} for a lock another connection holds on a table it changes. ` +
          'Nothing of it was applied; it is tried again at the next start. If it keeps failing, ' +
          'find the long-running query that holds the lock (pg_stat_activity) and let it finish first.'
        : '';
    throw new Error(
      `Migration ${version} failed: ${err instanceof Error ? err.message : String(err)}${waited}`,
      { cause: err },
    );
  }
}
