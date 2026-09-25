// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * STOP AND RESUME ONE DATA TYPE, ON POSTGRES (workplan 0128 T4, T5 slice 3b).
 *
 * The door's own tests run on PGlite. This one runs it on a real server, as the
 * serving role under row security, on a database that migrated and serves on
 * one pool, as the appliance does: the row lock on the migration, the
 * migration-status write and the audit record, and D5's refusal, each as the
 * product meets them.
 */

import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { runMigrations } from './migrate.ts';
import { pgDriver, withTenant } from './db.ts';
import { stopOrResumePath, PATH_STATUS_ACTION } from './a-stop-per-data-type.ts';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
if (!ADMIN_URL) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

// UUID family 0128f400-…, unused elsewhere in the repo.
const TENANT = '0128f400-e29b-41d4-a716-446655440001';
const CONNECTION = '0128f400-e29b-41d4-a716-446655440002';
const MAILBOX = '0128f400-e29b-41d4-a716-446655440003';
const MAPPING = '0128f400-e29b-41d4-a716-446655440005';

describe('the stop door on Postgres', () => {
  it('stops, refuses the last one copying, resumes, and records each as the serving role', async () => {
    const dbName = `stop_door_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const admin = new Pool({ connectionString: ADMIN_URL });
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${dbName}`;

    const pool = new Pool({ connectionString: url.toString(), max: 1 });
    const driver = pgDriver(pool, { role: 'app_user' });
    try {
      await runMigrations({ driver, logger: () => {} });
      // Seeded as the database's owner, past row security, as a door would have left it.
      const q = (text: string, params: unknown[] = []) => pool.query(text, params);
      await q(`INSERT INTO tenant (id, name, status) VALUES ($1, 'stops', 'active')`, [TENANT]);
      await q(
        `INSERT INTO connection (id, tenant_id, role, kind, display_name, status, config)
         VALUES ($1, $2, 'source', 'imap', 'fixture', 'connected', '{}'::jsonb)`,
        [CONNECTION, TENANT],
      );
      await q(
        `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, primary_address)
         VALUES ($1, $2, $3, 'src', 'a@example.test')`,
        [MAILBOX, TENANT, CONNECTION],
      );
      await q(`INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status) VALUES ($1, $2, $3, 'active')`, [
        MAPPING,
        TENANT,
        MAILBOX,
      ]);
      for (const domain of ['email', 'calendar']) {
        await q(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1, $2, $3, true)`, [
          TENANT,
          MAPPING,
          domain,
        ]);
        await q(
          `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at)
           VALUES ($1, $2, $3, 'active', now())`,
          [TENANT, MAPPING, domain],
        );
      }

      const press = (domain: 'email' | 'calendar', stop: boolean) =>
        withTenant(driver, TENANT, (db) => stopOrResumePath(db, TENANT, { mappingId: MAPPING, domain, stop, actor: 'someone' }));

      expect(await press('email', true)).toEqual({ changed: true, slotsTaken: false });
      expect(await press('calendar', true)).toEqual({ refused: 'last_one_copying' });
      expect(await press('email', false)).toEqual({ changed: true, slotsTaken: false });

      const records = await q(`SELECT actor, detail ->> 'to' AS "to" FROM audit_log WHERE action = $1 ORDER BY at`, [
        PATH_STATUS_ACTION,
      ]);
      expect(records.rows).toEqual([
        { actor: 'someone', to: 'stopped' },
        { actor: 'someone', to: 'running' },
      ]);
      const status = await q(`SELECT state FROM migration_status WHERE mapping_id = $1 AND domain = 'email'`, [MAPPING]);
      expect(status.rows).toEqual([{ state: 'pending' }]);
    } finally {
      await pool.end();
      const cleanup = new Pool({ connectionString: ADMIN_URL });
      await cleanup.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [dbName],
      );
      await cleanup.query(`DROP DATABASE IF EXISTS ${dbName}`);
      await cleanup.end();
    }
  }, 120_000);
});
