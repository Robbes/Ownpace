// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * EACH DATA TYPE'S PHASE, AS EVERY GATE READS IT (workplan 0128 T5, slice 1).
 *
 * On PGlite as `app_user`: the reader the managed pass, its dependency
 * builders and the appliance's pass all ask. Until a data type can have a phase
 * of its own, it must answer exactly what the migration's row and its cutover's
 * window answered before, for every data type alike.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DISCOVERY_DOMAINS } from '@openmig/shared';
import { pgliteDriver } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import { withTenant } from './db.ts';
import type { LedgerDriver } from './driver.ts';
import { readPathPhases } from './path-phases.ts';

// UUID family 0128b000-…, unused elsewhere in the repo.
const TENANT = '0128b000-e29b-41d4-a716-446655440001';
const OTHER_TENANT = '0128b000-e29b-41d4-a716-446655440011';
const CONNECTION = '0128b000-e29b-41d4-a716-446655440002';
const SOURCE_MAILBOX = '0128b000-e29b-41d4-a716-446655440003';
const TARGET_MAILBOX = '0128b000-e29b-41d4-a716-446655440004';
const MAPPING = '0128b000-e29b-41d4-a716-446655440005';
const GONE = '0128b000-e29b-41d4-a716-446655440006';

let driver: LedgerDriver;

/** One statement, on a connection taken and given back (PGlite has one). */
async function query(text: string, params: unknown[] = []): Promise<void> {
  const conn = await driver.acquire();
  try {
    await conn.query(text, params);
  } finally {
    conn.release();
  }
}

const read = (tenant: string, mapping: string) =>
  withTenant(driver, tenant, (db) => readPathPhases(db, tenant, mapping));

/** The migration's own row, and its cutover's, as a test places them. */
async function place(status: string, cutover?: { copies: boolean; minutesPastTheEnd: number }): Promise<void> {
  await query(`UPDATE mailbox_mapping SET status = $2, grant_withdrawn_at = NULL WHERE id = $1`, [MAPPING, status]);
  await query(`DELETE FROM cutover_state WHERE mapping_id = $1`, [MAPPING]);
  if (cutover) {
    await query(
      `INSERT INTO cutover_state (tenant_id, mapping_id, state, grace_period_hours, copies_through_grace,
                                  grace_period_started_at, updated_at)
       SELECT $1, $2, 'GRACE_PERIOD', 72, $3, s, s
         FROM (SELECT now() - interval '72 hours' - ($4::int * interval '1 minute') AS s) t`,
      [TENANT, MAPPING, cutover.copies, cutover.minutesPastTheEnd],
    );
  }
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'phases', 'active'), ($2, 'other', 'active')`, [
    TENANT,
    OTHER_TENANT,
  ]);
  await query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, status, config)
     VALUES ($1, $2, 'source', 'imap', 'fixture', 'connected', '{}'::jsonb)`,
    [CONNECTION, TENANT],
  );
  for (const [id, ext] of [
    [SOURCE_MAILBOX, 'src'],
    [TARGET_MAILBOX, 'dst'],
  ] as const) {
    await query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, primary_address)
       VALUES ($1, $2, $3, $4, 'a@example.test')`,
      [id, TENANT, CONNECTION, ext],
    );
  }
  await query(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status, mode, pattern)
     VALUES ($1, $2, $3, $4, 'active', 'mirror', 'shared_s')`,
    [MAPPING, TENANT, SOURCE_MAILBOX, TARGET_MAILBOX],
  );
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe("every data type's phase, while none has a phase of its own", () => {
  for (const status of ['active', 'paused', 'done', 'continuous']) {
    it(`is the migration's own, for every data type, when it is ${status}`, async () => {
      await place(status);
      const phases = await read(TENANT, MAPPING);
      expect(phases).toMatchObject({ status, stillCopies: false, grantWithdrawnAt: null });
      for (const domain of DISCOVERY_DOMAINS) {
        expect(phases!.phaseOf(domain)).toEqual({ phase: status, stillCopies: false });
      }
    });
  }

  it("carries a cutover's grace period to every data type while it is open, and not after", async () => {
    await place('cutover', { copies: true, minutesPastTheEnd: -5 });
    const open = await read(TENANT, MAPPING);
    expect(open!.stillCopies).toBe(true);
    for (const domain of DISCOVERY_DOMAINS) {
      expect(open!.phaseOf(domain)).toEqual({ phase: 'cutover', stillCopies: true });
    }

    await place('cutover', { copies: true, minutesPastTheEnd: 5 });
    const over = await read(TENANT, MAPPING);
    expect(over!.stillCopies).toBe(false);
    expect(over!.phaseOf('file')).toEqual({ phase: 'cutover', stillCopies: false });
  });

  it('never lets a cutover copy that was not copying when it was executed', async () => {
    await place('cutover', { copies: false, minutesPastTheEnd: -5 });
    expect((await read(TENANT, MAPPING))!.phaseOf('email')).toEqual({ phase: 'cutover', stillCopies: false });
  });

  it("keeps a cutover's grace period to a migration in `cutover`, whatever row is left beside another", async () => {
    // A rollback puts the migration back to `active` before its ledger row
    // moves (ADR-0047, mapping first): the window is not the migration's then.
    await place('cutover', { copies: true, minutesPastTheEnd: -5 });
    await query(`UPDATE mailbox_mapping SET status = 'active' WHERE id = $1`, [MAPPING]);
    const phases = await read(TENANT, MAPPING);
    expect(phases!.stillCopies).toBe(false);
    expect(phases!.phaseOf('email')).toEqual({ phase: 'active', stillCopies: false });
  });

  it('says when the grant was taken back', async () => {
    await place('active');
    await query(`UPDATE mailbox_mapping SET grant_withdrawn_at = now() WHERE id = $1`, [MAPPING]);
    expect((await read(TENANT, MAPPING))!.grantWithdrawnAt).toBeInstanceOf(Date);
  });

  it('answers null for a migration that is gone, or that another organisation owns', async () => {
    expect(await read(TENANT, GONE)).toBeNull();
    // Row security, not a filter: the other organisation's transaction sees no row.
    expect(await read(OTHER_TENANT, MAPPING)).toBeNull();
  });
});
