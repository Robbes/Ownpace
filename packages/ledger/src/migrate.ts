// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

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
import { pgDriver } from './db';
import type { LedgerConnection, LedgerDriver } from './driver';

/** Dedicated advisory-lock key for schema migrations (distinct from app locks). */
const MIGRATION_ADVISORY_LOCK_KEY = 727_0010;

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
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);
    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
           version text PRIMARY KEY,
           applied_at timestamptz NOT NULL DEFAULT now()
         )`,
      );

      const appliedRows = await client.query<{ version: string }>(
        'SELECT version FROM schema_migrations',
      );
      const alreadyApplied = new Set(appliedRows.rows.map((r) => r.version));

      // Downgrade guard: refuse if the DB carries a version newer than we ship.
      const highestApplied = [...alreadyApplied].sort().pop();
      if (highestApplied && highestApplied > highestKnown) {
        throw new Error(
          `Database schema version ${highestApplied} is newer than this build understands ` +
            `(highest known: ${highestKnown}). Refusing to start rather than guess.\n` +
            'Either this build is older than the database (upgrade the application), or the ' +
            'migration chain was SQUASHED and this database still records the pre-squash ' +
            'filenames — see scripts/squash-migrations.sh. A squash only ever happens ' +
            'pre-release, and the fix for it is to drop and recreate the database; the ledger ' +
            'is a rebuildable cache (ADR-0020), so nothing irreplaceable lives here.',
        );
      }

      const applied: string[] = [];
      for (const version of versions) {
        if (alreadyApplied.has(version)) continue;
        await applyOne(client, migrationsDir, version, log);
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
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);
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
  log: (m: string) => void,
): Promise<void> {
  const sql = readFileSync(join(migrationsDir, version), 'utf-8');
  log(`[migrate] applying ${version}`);
  await client.query('BEGIN');
  try {
    // exec, not query: a migration file is many statements, and the extended
    // protocol accepts one. See `LedgerConnection.exec`.
    await client.exec(sql);
    await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error(
      `Migration ${version} failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}
