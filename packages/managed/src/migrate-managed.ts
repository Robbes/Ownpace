// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * Apply the managed edition's own migration chain (ADR-0036).
 *
 * A thin wrapper over `runMigrations`, and the only reason it exists is that
 * the three constants below must agree at every call site or the chain is
 * silently wrong. One that passed the default bookkeeping table would write
 * these versions into the SHARED chain's ledger, where the downgrade guard
 * compares them against a chain they were never ordered against — see
 * `two-chains.unit.test.ts`, which runs that mistake and pins what it does.
 * A default nobody typed, breaking a guard on some other deployment.
 *
 * Run it AFTER the shared chain: every table here references `public.tenant`.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations, type RunMigrationsResult } from '@openmig/ledger';

/** Its own ledger, so the two chains cannot read each other's versions. */
export const MANAGED_BOOKKEEPING_TABLE = 'managed_schema_migrations';

/**
 * Its own advisory lock. Sharing the shared chain's key would serialise two
 * unrelated migrators, and a chain that died holding it would block the other
 * one on a lock it has no business waiting for.
 */
export const MANAGED_ADVISORY_LOCK_KEY = 727_0036;

/** packages/managed/src/migrate-managed.ts -> packages/managed/migrations */
export function managedMigrationsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
}

export interface RunManagedMigrationsOptions {
  connectionString?: string;
  /** An already-built driver, whose lifetime stays the caller's. */
  driver?: Parameters<typeof runMigrations>[0]['driver'];
  logger?: (message: string) => void;
}

export async function runManagedMigrations(
  options: RunManagedMigrationsOptions,
): Promise<RunMigrationsResult> {
  return runMigrations({
    ...options,
    migrationsDir: managedMigrationsDir(),
    bookkeepingTable: MANAGED_BOOKKEEPING_TABLE,
    advisoryLockKey: MANAGED_ADVISORY_LOCK_KEY,
  });
}
