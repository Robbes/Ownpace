// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Integration tests for the startup migration runner (workplan 0010 T1),
 * proving the SAD §22.1 gates: fresh install empty→latest, idempotent re-run,
 * concurrent double-start applies once, and the newer-schema refusal.
 *
 * Each test runs against a throwaway database it creates + drops, so it doesn't
 * touch the shared Testcontainers schema. Requires TEST_DATABASE_URL (Docker).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { runMigrations, listMigrationVersions } from './migrate.ts';
import { pgDriver, withTenant } from './db.ts';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
if (!ADMIN_URL) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

/** Create a fresh empty database and return its connection string. */
async function withFreshDb<T>(fn: (connectionString: string) => Promise<T>): Promise<T> {
  const dbName = `migrate_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = new Pool({ connectionString: ADMIN_URL });
  try {
    await admin.query(`CREATE DATABASE ${dbName}`);
  } finally {
    await admin.end();
  }
  const url = new URL(ADMIN_URL!);
  url.pathname = `/${dbName}`;
  try {
    return await fn(url.toString());
  } finally {
    const cleanup = new Pool({ connectionString: ADMIN_URL });
    try {
      // Terminate stragglers, then drop.
      await cleanup.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [dbName],
      );
      await cleanup.query(`DROP DATABASE IF EXISTS ${dbName}`);
    } finally {
      await cleanup.end();
    }
  }
}

const ALL_VERSIONS = listMigrationVersions();
const HIGHEST = ALL_VERSIONS[ALL_VERSIONS.length - 1]!;

async function appliedVersions(connectionString: string): Promise<string[]> {
  const pool = new Pool({ connectionString });
  try {
    const res = await pool.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version');
    return res.rows.map((r) => r.version);
  } finally {
    await pool.end();
  }
}

describe('runMigrations', () => {
  it('applies all migrations on a fresh database (empty → latest)', async () => {
    await withFreshDb(async (url) => {
      const result = await runMigrations({ connectionString: url, logger: () => {} });
      expect(result.applied).toEqual(ALL_VERSIONS);
      expect(result.currentVersion).toBe(HIGHEST);
      expect(await appliedVersions(url)).toEqual([...ALL_VERSIONS].sort());
    });
  });

  it('is idempotent: re-running applies nothing', async () => {
    await withFreshDb(async (url) => {
      await runMigrations({ connectionString: url, logger: () => {} });
      const second = await runMigrations({ connectionString: url, logger: () => {} });
      expect(second.applied).toEqual([]);
      expect(second.currentVersion).toBe(HIGHEST);
    });
  });

  it('applies each migration exactly once under concurrent double-start', async () => {
    await withFreshDb(async (url) => {
      const [a, b] = await Promise.all([
        runMigrations({ connectionString: url, logger: () => {} }),
        runMigrations({ connectionString: url, logger: () => {} }),
      ]);
      // Union of applied == all versions, and no version applied by both.
      const union = new Set([...a.applied, ...b.applied]);
      expect([...union].sort()).toEqual([...ALL_VERSIONS].sort());
      expect(a.applied.length + b.applied.length).toBe(ALL_VERSIONS.length);
      // Exactly one row per migration in the DB (no duplicates / no error).
      expect(await appliedVersions(url)).toEqual([...ALL_VERSIONS].sort());
    });
  });

  it('refuses to start when the DB schema is newer than the build', async () => {
    await withFreshDb(async (url) => {
      await runMigrations({ connectionString: url, logger: () => {} });
      // Simulate a future migration applied by a newer build.
      const pool = new Pool({ connectionString: url });
      try {
        await pool.query('INSERT INTO schema_migrations (version) VALUES ($1)', ['9999_from_the_future.sql']);
      } finally {
        await pool.end();
      }
      await expect(runMigrations({ connectionString: url, logger: () => {} })).rejects.toThrow(
        /newer than this build understands/,
      );
    });
  });

  it('hands its connection back as a fresh session, so a pool that migrates can serve (0128 T5, slice 2b)', async () => {
    // The appliance on Postgres migrates and serves on ONE pool. The baseline's
    // pg_dump preamble sets `row_security = off` for the session, and a pool
    // hands that session to the next caller: a `withTenant` that dropped to
    // the serving role on it was refused. One connection, so the one that ran
    // the migration is the one that serves.
    await withFreshDb(async (url) => {
      const pool = new Pool({ connectionString: url, max: 1 });
      const driver = pgDriver(pool, { role: 'app_user' });
      try {
        await runMigrations({ driver, logger: () => {} });
        const conn = await driver.acquire();
        try {
          expect((await conn.query<{ row_security: string }>('SHOW row_security')).rows[0]?.row_security).toBe('on');
        } finally {
          conn.release();
        }
        const tenant = '0128e000-e29b-41d4-a716-446655440001';
        const seen = await withTenant(driver, tenant, (db) => db.execute(sql`SELECT count(*)::int AS n FROM mailbox_mapping`));
        expect(seen.rows).toEqual([{ n: 0 }]);
      } finally {
        await pool.end();
      }
    });
  });
});

/**
 * A FILE THAT WAITS FOR A LOCK GIVES UP (workplan 0165, the owner's D3 of
 * 2026-11-21). Another connection holds a lock on a table, in an open
 * transaction, as a long query would; a migration that alters that table must
 * fail within its lock timeout, apply nothing, record nothing, and apply on the
 * next run once the lock is gone. The timeout is shortened here so the test
 * does not wait the five seconds the runner uses.
 */
describe('a migration that waits for a lock', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });
  /** A chain of two files: one makes a table, the next adds a CHECK to it. */
  function chain(): string {
    const dir = mkdtempSync(join(tmpdir(), 'ownpace-lock-wait-'));
    dirs.push(dir);
    writeFileSync(join(dir, '0001_a_table.sql'), 'CREATE TABLE waited_on (n int NOT NULL);\nINSERT INTO waited_on VALUES (1);\n');
    writeFileSync(join(dir, '0002_a_check.sql'), 'ALTER TABLE waited_on ADD CONSTRAINT waited_on_n_check CHECK (n > 0);\n');
    return dir;
  }

  it('fails within its lock timeout, applies and records nothing, and applies on the next run', async () => {
    await withFreshDb(async (url) => {
      const migrationsDir = chain();
      const first = await runMigrations({ connectionString: url, migrationsDir, logger: () => {}, lockTimeout: '300ms' });
      expect(first.applied).toEqual(['0001_a_table.sql', '0002_a_check.sql']);
      // A third file, written after the first run, that needs the same lock.
      writeFileSync(join(migrationsDir, '0003_another_check.sql'), 'ALTER TABLE waited_on ADD CONSTRAINT waited_on_n_small CHECK (n < 100);\n');

      const holder = new Pool({ connectionString: url, max: 1 });
      const held = await holder.connect();
      try {
        // A reader in an open transaction: ACCESS SHARE, which every ALTER TABLE has to wait for.
        await held.query('BEGIN');
        await held.query('SELECT count(*) FROM waited_on');

        const started = Date.now();
        await expect(runMigrations({ connectionString: url, migrationsDir, logger: () => {}, lockTimeout: '300ms' })).rejects.toThrow(
          /^Migration 0003_another_check\.sql failed: canceling statement due to lock timeout It waited more than 300ms for a lock/,
        );
        const waited = Date.now() - started;
        expect(waited, 'it gave up well before a wait with no timeout would end').toBeLessThan(5_000);
        expect(await appliedVersions(url)).toEqual(['0001_a_table.sql', '0002_a_check.sql']);
        // The reader was never blocked or cancelled: its transaction still answers.
        expect((await held.query<{ n: number }>('SELECT count(*)::int AS n FROM waited_on')).rows).toEqual([{ n: 1 }]);
      } finally {
        await held.query('ROLLBACK');
        held.release();
        await holder.end();
      }

      const next = await runMigrations({ connectionString: url, migrationsDir, logger: () => {}, lockTimeout: '300ms' });
      expect(next.applied).toEqual(['0003_another_check.sql']);
      const pool = new Pool({ connectionString: url });
      try {
        const checks = await pool.query<{ conname: string }>(
          "SELECT conname FROM pg_constraint WHERE conrelid = 'waited_on'::regclass AND contype = 'c' ORDER BY conname",
        );
        expect(checks.rows.map((r) => r.conname)).toEqual(['waited_on_n_check', 'waited_on_n_small']);
      } finally {
        await pool.end();
      }
    });
  });

  it('leaves no lock timeout on the connection it hands back', async () => {
    await withFreshDb(async (url) => {
      const pool = new Pool({ connectionString: url, max: 1 });
      const driver = pgDriver(pool);
      try {
        await runMigrations({ driver, migrationsDir: chain(), logger: () => {}, lockTimeout: '300ms' });
        const conn = await driver.acquire();
        try {
          expect((await conn.query<{ lock_timeout: string }>('SHOW lock_timeout')).rows[0]?.lock_timeout).toBe('0');
        } finally {
          conn.release();
        }
      } finally {
        await pool.end();
      }
    });
  });
});
