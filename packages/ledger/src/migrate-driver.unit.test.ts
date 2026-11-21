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

import { describe, it, expect, vi, afterAll } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIGRATION_LOCK_TIMEOUT, runMigrations } from './migrate.ts';
import type { LedgerConnection, LedgerDriver } from './driver.ts';
import type { PgDatabase } from './db-types.ts';

/**
 * Temp directories this file makes, and the removal that used to be missing.
 *
 * `mkdtempSync` with no matching `rmSync` leaks for the lifetime of the
 * machine. A PGlite data directory is 41MB, and the unit suite as a whole was
 * measured on 2026-08-24 leaking 24 directories — 322MB — PER RUN, having
 * quietly accumulated 29GB and filled the disk of the box it was running on.
 *
 * That matters beyond a developer's laptop: `unit-tests` runs on the
 * SELF-HOSTED runner for pushes to main, which is the same machine the managed
 * stack needs ~15GB free on. Nothing was watching, because a test that leaks
 * still passes.
 *
 * Registered rather than removed at each call site: every directory this file
 * creates goes through here, so a new test cannot forget.
 */
const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  // `force` so a directory a test already removed is not an error, and
  // `recursive` because these hold whole databases.
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});


/** A migrations directory with one trivial file. */
function migrationsDirWith(...files: string[]): string {
  const dir = tempDir('ownpace-migrations-');
  for (const f of files) writeFileSync(join(dir, f), 'SELECT 1;');
  return dir;
}

/**
 * A driver that records every statement and reports an empty
 * `schema_migrations`, so the runner sees a fresh database.
 */
function fakeDriver(execFails?: Error) {
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
      if (execFails) throw execFails;
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

/**
 * A LOCK TIMEOUT PER FILE (workplan 0165, D3 of 2026-11-21). A
 * file that waits for a table lock gives up after MIGRATION_LOCK_TIMEOUT
 * rather than queueing every query on that table behind it. Set with `SET
 * LOCAL` inside the file's own transaction, before the file runs, so it ends
 * at its COMMIT and never reaches the advisory lock, which is taken before any
 * file and is meant to wait. Against a real Postgres, in
 * `migrate.integration.test.ts`: a file that waits is refused, applies
 * nothing, and applies on the next run.
 */
describe('a lock timeout for each file', () => {
  it('is set inside each file transaction, after BEGIN and before the file, and never before the advisory lock', async () => {
    const d = fakeDriver();
    const dir = migrationsDirWith('0001_a.sql', '0002_b.sql');

    await runMigrations({ driver: d.driver, migrationsDir: dir, logger: () => {} });

    const set = `SET LOCAL lock_timeout = '${MIGRATION_LOCK_TIMEOUT}'`;
    expect(MIGRATION_LOCK_TIMEOUT).toBe('5s');
    expect(d.statements.filter((s) => s === set)).toHaveLength(2);
    for (const [i, s] of d.statements.entries()) {
      if (s !== set) continue;
      expect(d.statements[i - 1], 'the timeout is not the first statement of the file transaction').toBe('BEGIN');
      expect(d.statements[i + 1], 'the file does not run right after the timeout').toMatch(/^EXEC /);
    }
    expect(d.statements.findIndex((s) => s.includes('pg_advisory_lock'))).toBeLessThan(d.statements.indexOf(set));
    // Never a session-wide SET, which would outlive the file and reach the next one's advisory wait.
    expect(d.statements.some((s) => /^SET lock_timeout/i.test(s))).toBe(false);
  });

  it('takes a shorter one when asked, and refuses one that is not a whole number of ms or s', async () => {
    const d = fakeDriver();
    const dir = migrationsDirWith('0001_a.sql');
    await runMigrations({ driver: d.driver, migrationsDir: dir, logger: () => {}, lockTimeout: '200ms' });
    expect(d.statements).toContain("SET LOCAL lock_timeout = '200ms'");

    for (const bad of ['0', '0s', '5', '5 s', "5s'; DROP TABLE item; --", '1min']) {
      await expect(runMigrations({ driver: fakeDriver().driver, migrationsDir: dir, logger: () => {}, lockTimeout: bad })).rejects.toThrow(
        /Not a usable lock timeout/,
      );
    }
  });

  it('says plainly when a file gave up waiting for a lock, rolls it back, and records nothing', async () => {
    const timedOut = Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' });
    const d = fakeDriver(timedOut);
    const dir = migrationsDirWith('0001_a.sql');

    const run = runMigrations({ driver: d.driver, migrationsDir: dir, logger: () => {} });
    await expect(run).rejects.toThrow(
      /^Migration 0001_a\.sql failed: canceling statement due to lock timeout It waited more than 5s for a lock another connection holds on a table it changes\. Nothing of it was applied; it is tried again at the next start\./,
    );
    expect(d.statements).toContain('ROLLBACK');
    expect(d.statements.some((s) => s.startsWith('INSERT INTO schema_migrations'))).toBe(false);
    expect(d.statements).toContain('SELECT pg_advisory_unlock($1) :: 7270010');
  });

  it('adds nothing to any other failure', async () => {
    const d = fakeDriver(Object.assign(new Error('relation "nope" does not exist'), { code: '42P01' }));
    const dir = migrationsDirWith('0001_a.sql');
    await expect(runMigrations({ driver: d.driver, migrationsDir: dir, logger: () => {} })).rejects.toThrow(
      /^Migration 0001_a\.sql failed: relation "nope" does not exist$/,
    );
  });

  it('cannot be undone by a migration file: none sets lock_timeout, except the baseline dump of an empty database', () => {
    const chains = ['../migrations', '../../managed/migrations'].map((rel) => fileURLToPath(new URL(rel, import.meta.url)));
    const setters: string[] = [];
    for (const dir of chains) {
      for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
        const code = readFileSync(join(dir, file), 'utf8').replace(/--.*$/gm, '');
        if (/\block_timeout\b/i.test(code)) setters.push(file);
      }
    }
    // The baseline's pg_dump preamble (`SET lock_timeout = 0;`) runs once,
    // on a database with no tables and no other connection to wait for.
    expect(setters).toEqual(['0001_baseline.sql']);
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
