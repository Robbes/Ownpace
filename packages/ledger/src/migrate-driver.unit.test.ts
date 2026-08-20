// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `runMigrations` through the connection seam (workplan 0015 T1).
 *
 * The behaviour of the migration runner itself — advisory lock, linear
 * application, downgrade guard — is covered against a real Postgres in
 * `migrate.integration.test.ts`, and stays there: those properties are about
 * Postgres, not about the seam.
 *
 * What is new and worth testing here is the seam: **PGlite is a file, not a
 * server, so there is no connection string to give it.** A
 * `connectionString`-only signature is the one thing that would keep the
 * appliance tied to a running Postgres even after every query became portable.
 * These tests run the real runner against a fake driver, with no database
 * anywhere, which is only possible because that is now true.
 *
 * The ownership rule gets its own tests because getting it backwards is a
 * quiet, real bug in both directions: closing a driver the caller still holds,
 * or leaking a pool we opened.
 */

import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from './migrate.ts';
import type { LedgerConnection, LedgerDriver } from './driver.ts';
import type { PgDatabase } from './db-types.ts';

/** A migrations directory with one trivial file. */
function migrationsDirWith(...files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'openmig-migrations-'));
  for (const f of files) writeFileSync(join(dir, f), 'SELECT 1;');
  return dir;
}

/**
 * A driver that records every statement and reports an empty
 * `schema_migrations`, so the runner sees a fresh database.
 */
function fakeDriver() {
  const statements: string[] = [];
  const ended = vi.fn(async () => {});
  const released = vi.fn();

  const conn: LedgerConnection = {
    query: async <R>(text: string, params?: readonly unknown[]) => {
      statements.push(params?.length ? `${text.split('\n')[0]} :: ${String(params[0])}` : text.split('\n')[0]!);
      return { rows: [] as R[] };
    },
    // The migration BODY goes through exec (many statements, no params);
    // schema_migrations bookkeeping goes through query. See LedgerConnection.
    exec: async (sql: string) => {
      statements.push(`EXEC ${sql.split('\n')[0]!.slice(0, 40)}`);
    },
    db: {} as PgDatabase,
    release: released,
  };

  const driver: LedgerDriver = {
    acquire: async () => conn,
    end: ended,
  };

  return { driver, statements, ended, released };
}

describe('runMigrations against a driver', () => {
  it('runs with no connection string at all — the point of the seam', async () => {
    // PGlite has no connection string. If this test needs one, the appliance
    // can never leave a running Postgres behind.
    const d = fakeDriver();
    const dir = migrationsDirWith('0001_baseline.sql');

    const result = await runMigrations({ driver: d.driver, migrationsDir: dir, logger: () => {} });

    expect(result.applied).toEqual(['0001_baseline.sql']);
    expect(result.currentVersion).toBe('0001_baseline.sql');
  });

  it('still takes the advisory lock and releases it', async () => {
    // Concurrency-safety is not something the seam is allowed to quietly drop.
    const d = fakeDriver();
    const dir = migrationsDirWith('0001_baseline.sql');

    await runMigrations({ driver: d.driver, migrationsDir: dir, logger: () => {} });

    expect(d.statements.some((s) => s.includes('pg_advisory_lock'))).toBe(true);
    expect(d.statements.some((s) => s.includes('pg_advisory_unlock'))).toBe(true);
  });

  it('applies each migration in its own transaction, and records it', async () => {
    const d = fakeDriver();
    const dir = migrationsDirWith('0001_a.sql', '0002_b.sql');

    const result = await runMigrations({ driver: d.driver, migrationsDir: dir, logger: () => {} });

    expect(result.applied).toEqual(['0001_a.sql', '0002_b.sql']);
    expect(d.statements.filter((s) => s === 'BEGIN')).toHaveLength(2);
    expect(d.statements.filter((s) => s === 'COMMIT')).toHaveLength(2);
    expect(d.statements.filter((s) => s.startsWith('INSERT INTO schema_migrations'))).toHaveLength(2);
  });
});

describe('driver ownership', () => {
  it('does NOT close a driver the caller supplied', async () => {
    // The caller still holds it — the appliance passes the same driver it will
    // serve requests with. Closing it here would take the database out from
    // under the process that just started up.
    const d = fakeDriver();
    const dir = migrationsDirWith('0001_baseline.sql');

    await runMigrations({ driver: d.driver, migrationsDir: dir, logger: () => {} });

    expect(d.ended).not.toHaveBeenCalled();
    // The connection is still handed back, though — that is not ownership.
    expect(d.released).toHaveBeenCalled();
  });
});

describe('when neither is given', () => {
  it('refuses rather than opening a pool to nowhere', async () => {
    // `new Pool({ connectionString: undefined })` does not throw — it falls
    // back to libpq environment defaults and tries to reach whatever PGHOST
    // happens to say. Refusing here means a caller that forgot both gets told
    // so, instead of a confusing connection error against someone else's
    // database.
    const dir = migrationsDirWith('0001_baseline.sql');
    await expect(runMigrations({ migrationsDir: dir, logger: () => {} })).rejects.toThrow(
      /requires either a connectionString or a driver/,
    );
  });
});
