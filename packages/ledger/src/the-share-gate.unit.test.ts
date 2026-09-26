// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE SHARE GATE, READ (ADR-0032 §5; workplan 0128 T5, slice 6).
 *
 * `readShareGate` asks each share's own data type, as every gate reads a data
 * type's phase (`readPathPhases`): calendars cut over on their own let their
 * shares through while the files' wait; rows that do not add up to the status
 * are not believed, so a status written alone answers for every data type, as
 * it did before the rows existed; and a migration that is gone lets nothing
 * through.
 *
 * PGlite as `app_user`, under row security, on the real migration chain.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { pgliteDriver } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import { withTenant } from './db.ts';
import type { LedgerDriver } from './driver.ts';
import { readShareGate } from './path-phases.ts';

// UUID family 0128fb00-…, unused elsewhere in the repo.
const TENANT = '0128fb00-e29b-41d4-a716-446655440001';
const CONNECTION = '0128fb00-e29b-41d4-a716-446655440002';
const MAILBOX = '0128fb00-e29b-41d4-a716-446655440003';
const MAPPING = '0128fb00-e29b-41d4-a716-446655440005';
const GONE = '0128fb00-e29b-41d4-a716-446655440006';

let driver: LedgerDriver;

async function query(text: string, params: unknown[] = []): Promise<void> {
  const conn = await driver.acquire();
  try {
    await conn.query(text, params);
  } finally {
    conn.release();
  }
}

async function phases(status: string, calendar: string, file: string): Promise<void> {
  await query(`UPDATE mailbox_mapping SET status = $2 WHERE id = $1`, [MAPPING, status]);
  await query(`UPDATE path_lifecycle SET state = $2 WHERE mapping_id = $1 AND domain = 'calendar'`, [MAPPING, calendar]);
  await query(`UPDATE path_lifecycle SET state = $2 WHERE mapping_id = $1 AND domain = 'file'`, [MAPPING, file]);
}

const gate = (mappingId = MAPPING) => withTenant(driver, TENANT, (db) => readShareGate(db, TENANT, mappingId));

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'shares', 'active')`, [TENANT]);
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
  await query(`INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status) VALUES ($1, $2, $3, 'active')`, [
    MAPPING,
    TENANT,
    MAILBOX,
  ]);
  for (const domain of ['calendar', 'file']) {
    await query(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1, $2, $3, true)`, [
      TENANT,
      MAPPING,
      domain,
    ]);
    await query(
      `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at)
       VALUES ($1, $2, $3, 'active', now())`,
      [TENANT, MAPPING, domain],
    );
  }
}, 120_000);

beforeEach(async () => {
  await phases('active', 'active', 'active');
});

afterAll(async () => {
  await driver?.end();
});

describe('the share gate, read from each data type’s phase', () => {
  it('calendars cut over on their own let their shares through; the files’ wait, and mail follows the migration', async () => {
    await phases('active', 'cutover', 'active');
    const mayApply = await gate();
    expect(mayApply('calendar')).toBe(true);
    expect(mayApply('drive_item')).toBe(false);
    // Mail is not carried here: it has no row, so it follows the migration.
    expect(mayApply('mailbox')).toBe(false);
  });

  it('every data type at or past its cutover lets every share through, in its cutover and not only once done', async () => {
    await phases('cutover', 'cutover', 'done');
    const mayApply = await gate();
    expect(['calendar', 'drive_item', 'mailbox'].map(mayApply)).toEqual([true, true, true]);
  });

  it('a status written alone is every data type’s phase: the rows are not believed', async () => {
    // As the managed smoke fakes a cutover, and an appliance operator sets it
    // back by hand: the status moved, the rows did not.
    await phases('done', 'active', 'active');
    const mayApply = await gate();
    expect(['calendar', 'drive_item', 'something_new'].map(mayApply)).toEqual([true, true, true]);
  });

  it('a migration that is gone lets nothing through', async () => {
    const mayApply = await gate(GONE);
    expect(['calendar', 'drive_item', 'mailbox'].map(mayApply)).toEqual([false, false, false]);
  });
});
