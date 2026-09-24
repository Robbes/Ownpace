// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CUTOVER WITHOUT MAIL (workplan 0128 T1), against a real ledger.
 *
 * A Microsoft → Nextcloud migration of calendars, contacts and files. Both
 * cutover gates, the preparation task's and the operator's `verify`, used to
 * build the mail source and target before measuring anything, and never used
 * them. For this migration that build refuses: a Nextcloud target cannot
 * receive email. So its cutover could not be prepared or verified at all, with
 * a sentence about email nobody had selected.
 *
 * The first test pins that cause: the mail builder refuses this migration. The
 * rest show the gate going past it and verifying what the migration has: mail
 * and tasks are not asked about, and calendars, contacts and files are.
 *
 * Nothing is recorded yet, so nothing needs a target to answer; the gate's
 * per-data-type measuring has its own tests in `@openmig/core`.
 *
 * UUID Family: 0e128000-e29b-41d4-a716-44665544xxxx
 *
 * Runs against a Testcontainers Postgres (pnpm test:integration).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { createPgDb } from '@openmig/ledger';
import { buildDepsFromMapping } from '@openmig/orchestration/build-deps-from-mapping';
import { runCutoverGate } from './cutover-gate.ts';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

const TENANT = '0e128000-e29b-41d4-a716-446655440001';
const SOURCE = '0e128000-e29b-41d4-a716-4466554400c1';
const TARGET = '0e128000-e29b-41d4-a716-4466554400c2';
const SOURCE_BOX = '0e128000-e29b-41d4-a716-4466554400b1';
const TARGET_BOX = '0e128000-e29b-41d4-a716-4466554400b2';
const MAPPING = '0e128000-e29b-41d4-a716-4466554400d1';

let db: ReturnType<typeof createPgDb>;
let pool: Pool;

beforeAll(async () => {
  db = createPgDb(PG_CONNECTION_STRING);
  pool = new Pool({ connectionString: PG_CONNECTION_STRING });

  await db.execute(sql`
    INSERT INTO tenant (id, name, status) VALUES (${TENANT}, 'Cutover Without Mail', 'active')
    ON CONFLICT (id) DO NOTHING`);
  // Credentials in the config, which the builders accept for tests; the
  // addresses are invented and nothing here is ever contacted.
  await db.execute(sql`
    INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
    VALUES
      (${SOURCE}, ${TENANT}, 'source', 'o365', 'src',
       ${JSON.stringify({ credentials: { accessToken: 'not-a-token' } })}::jsonb, 'connected'),
      (${TARGET}, ${TENANT}, 'target', 'nextcloud', 'dst',
       ${JSON.stringify({
         url: 'https://cloud.example.invalid',
         credentials: { username: 'nobody', password: 'not-a-password' },
       })}::jsonb, 'connected')
    ON CONFLICT (id) DO NOTHING`);
  await db.execute(sql`
    INSERT INTO mailbox (id, tenant_id, connection_id, kind, external_id)
    VALUES (${SOURCE_BOX}, ${TENANT}, ${SOURCE}, 'user', 'source'),
           (${TARGET_BOX}, ${TENANT}, ${TARGET}, 'user', 'target')
    ON CONFLICT (id) DO NOTHING`);
  await db.execute(sql`
    INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
    VALUES (${MAPPING}, ${TENANT}, ${SOURCE_BOX}, ${TARGET_BOX}, 'mirror', 'active')
    ON CONFLICT (id) DO NOTHING`);
  await db.execute(sql`DELETE FROM scope_selection WHERE tenant_id = ${TENANT} AND mapping_id = ${MAPPING}`);
  await db.execute(sql`
    INSERT INTO scope_selection (tenant_id, mapping_id, domain, included)
    VALUES (${TENANT}, ${MAPPING}, 'calendar', true),
           (${TENANT}, ${MAPPING}, 'contact', true),
           (${TENANT}, ${MAPPING}, 'file', true)`);
});

afterAll(async () => {
  await pool?.end();
  await db?.close();
});

describe('a Microsoft → Nextcloud migration of calendars, contacts and files', () => {
  it('cannot have mail built for it: the step both gates used to take first', async () => {
    await expect(buildDepsFromMapping(pool, TENANT, MAPPING)).rejects.toThrow(
      /cannot receive the 'email' data type/,
    );
  });

  it('is verified by the cutover gate, which goes past mail rather than failing on it', async () => {
    const verdict = await runCutoverGate(pool, PG_CONNECTION_STRING, TENANT, MAPPING);

    expect(verdict.tenantId).toBe(TENANT);
    expect(verdict.mappingId).toBe(MAPPING);
  });

  it('is not asked about the data types it does not have', async () => {
    const verdict = await runCutoverGate(pool, PG_CONNECTION_STRING, TENANT, MAPPING);

    for (const notCarried of ['mail', 'tasks'] as const) {
      expect(verdict[notCarried].status).toBe('SKIPPED');
      expect(verdict[notCarried].issues[0]?.message).toMatch(/disabled in the config/);
    }
  });

  it('is asked about the ones it does have, each against what the ledger recorded', async () => {
    const verdict = await runCutoverGate(pool, PG_CONNECTION_STRING, TENANT, MAPPING);

    for (const carried of ['calendar', 'contacts', 'files'] as const) {
      expect(verdict[carried].status).toBe('SKIPPED');
      expect(verdict[carried].issues[0]?.message).toMatch(/were recorded for this mapping/);
    }
    // Nothing is copied yet, so nothing was measured anywhere: the gate says
    // no, as it should, rather than the cutover passing on an empty ledger.
    expect(verdict.overallStatus).toBe('FAIL');
    expect(verdict.canProceedToCutover).toBe(false);
  });
});
