// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE DATA TYPES A MIGRATION'S OWNER STOPPED (workplan 0128 T4, D6), as the
 * managed verification and the cutover gate read them: only data types the
 * migration carries, and only those with a stop. On PGlite, as the worker's
 * pool reads them.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { pgliteDriver, runMigrations, type LedgerDriver } from '@openmig/ledger';
import { stoppedDomains } from './enabled-domains.ts';

// UUID family 0128f300-…, unused elsewhere in the repo.
const TENANT = '0128f300-e29b-41d4-a716-446655440001';
const CONNECTION = '0128f300-e29b-41d4-a716-446655440002';
const MAILBOX = '0128f300-e29b-41d4-a716-446655440003';
const MAPPING = '0128f300-e29b-41d4-a716-446655440005';

let driver: LedgerDriver;

async function query(text: string, params: unknown[] = []) {
  const conn = await driver.acquire();
  try {
    return await conn.query<Record<string, unknown>>(text, params);
  } finally {
    conn.release();
  }
}

/** The worker's pool, as far as `stoppedDomains` uses one. */
const pool = { query: (text: string, params: unknown[]) => query(text, params) } as unknown as Pool;

beforeAll(async () => {
  driver = pgliteDriver({});
  await runMigrations({ driver, logger: () => {} });
  await query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'stopped', 'active')`, [TENANT]);
  await query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, status, config)
     VALUES ($1, $2, 'source', 'imap', 'fixture', 'connected', '{}'::jsonb)`,
    [CONNECTION, TENANT],
  );
  await query(
    `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, primary_address)
     VALUES ($1, $2, $3, 'src', 'a@example.test')`,
    [MAILBOX, TENANT, CONNECTION],
  );
  await query(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status) VALUES ($1, $2, $3, 'active')`,
    [MAPPING, TENANT, MAILBOX],
  );
  // Mail stopped, calendars running, contacts stopped but no longer carried.
  for (const [domain, included, stopped] of [
    ['email', true, true],
    ['calendar', true, false],
    ['contact', false, true],
  ] as const) {
    await query(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1, $2, $3, $4)`, [
      TENANT,
      MAPPING,
      domain,
      included,
    ]);
    await query(
      `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at, stopped_at)
       VALUES ($1, $2, $3, 'active', now(), ${stopped ? 'now()' : 'NULL'})`,
      [TENANT, MAPPING, domain],
    );
  }
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe('stoppedDomains', () => {
  it('answers the carried data types with a stop, and no others', async () => {
    expect([...(await stoppedDomains(pool, TENANT, MAPPING))]).toEqual(['email']);
  });

  it('answers nothing for a migration with no stop, or another organisation', async () => {
    await query(`UPDATE path_lifecycle SET stopped_at = NULL WHERE mapping_id = $1 AND domain = 'email'`, [MAPPING]);
    expect([...(await stoppedDomains(pool, TENANT, MAPPING))]).toEqual([]);
    expect([...(await stoppedDomains(pool, '0128f300-e29b-41d4-a716-446655440099', MAPPING))]).toEqual([]);
  });
});
