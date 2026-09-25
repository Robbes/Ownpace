// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE LEDGER'S OWN DOOR HANDS ITS CALLER THE SLOTS IT TOOK (workplan 0109 T2).
 *
 * A rollback puts a migration back to `active` through `applyMappingStatusChange`
 * (the cutover CLI, the `run-rollback` job), and its paths take their slots
 * again. The month's peak is the managed edition's table, which this package
 * may not write, so the door calls `onSlotsTaken` for it: once, only when the
 * change took slots, and inside the change's own transaction, so a peak that
 * fails takes the change back with it rather than leaving slots no month
 * remembers.
 *
 * On PGlite, with the ledger chain only: what a self-hosted database has.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createPgliteDb } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import type { LedgerDriver } from './driver.ts';
import type { PgDatabase } from './db-types.ts';
import { applyMappingStatusChange, mappingLifecyclePort, MAPPING_STATUS_ACTION } from './mapping-status-audit.ts';

// UUID family 0109c000-…, unused elsewhere in the repo.
const TENANT = '0109c000-e29b-41d4-a716-446655440001';
const CONNECTION = '0109c000-e29b-41d4-a716-446655440002';
const SOURCE = '0109c000-e29b-41d4-a716-446655440003';
const TARGET = '0109c000-e29b-41d4-a716-446655440004';
const MAPPING = '0109c000-e29b-41d4-a716-446655440005';
const PATHLESS = '0109c000-e29b-41d4-a716-446655440006';

let driver: LedgerDriver;

/** One statement, on a connection taken and given back (PGlite has one). */
async function q(text: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(text, params)).rows as Array<Record<string, unknown>>;
  } finally {
    conn.release();
  }
}

const status = async (id = MAPPING) =>
  (await q('SELECT status FROM mailbox_mapping WHERE id = $1', [id]))[0]!.status;
const pathStates = async () =>
  (await q('SELECT domain, state FROM path_lifecycle WHERE mapping_id = $1 ORDER BY domain', [MAPPING])).map(
    (r) => `${r.domain}:${r.state}`,
  );
const audited = async () =>
  (await q('SELECT count(*)::int AS n FROM audit_log WHERE action = $1', [MAPPING_STATUS_ACTION]))[0]!.n;

/** A recorder for the hook: what it was handed, and what the transaction showed it. */
function hook(fail = false) {
  const seen: Array<{ status: unknown }> = [];
  const onSlotsTaken = async (db: PgDatabase) => {
    const rows = await db.execute(sql`SELECT status FROM mailbox_mapping WHERE id = ${MAPPING}`);
    seen.push({ status: (rows.rows[0] as { status: unknown } | undefined)?.status });
    if (fail) throw new Error('the peak could not be written');
  };
  return { seen, onSlotsTaken };
}

const rollBack = (options: Parameters<typeof applyMappingStatusChange>[3]) =>
  applyMappingStatusChange(
    driver,
    TENANT,
    { mappingId: MAPPING, from: 'cutover', to: 'active', actor: 'cli', via: 'rollback' },
    options,
  );

beforeAll(async () => {
  driver = (await createPgliteDb({})).driver;
  await runMigrations({ driver, logger: () => {} });
  await q(`INSERT INTO tenant (id, name, status) VALUES ($1, 'Peaks', 'active')`, [TENANT]);
  await q(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
     VALUES ($1, $2, 'source', 'imap', 'src', '{}'::jsonb, 'connected')`,
    [CONNECTION, TENANT],
  );
  for (const [id, address] of [
    [SOURCE, 'source@example.invalid'],
    [TARGET, 'target@example.invalid'],
  ] as const) {
    await q(
      `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, primary_address)
       VALUES ($1, $2, $3, $4, 'user', $4)`,
      [id, TENANT, CONNECTION, address],
    );
  }
  // The second the other way round: one pair of mailboxes is one migration.
  for (const [id, from, to] of [
    [MAPPING, SOURCE, TARGET],
    [PATHLESS, TARGET, SOURCE],
  ] as const) {
    await q(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
       VALUES ($1, $2, $3, $4, 'mirror', 'cutover')`,
      [id, TENANT, from, to],
    );
  }
  // Two paths, and one domain that is not one.
  await q(
    `INSERT INTO scope_selection (tenant_id, mapping_id, domain, included)
     VALUES ($1, $2, 'email', true), ($1, $2, 'calendar', true), ($1, $2, 'contact', false)`,
    [TENANT, MAPPING],
  );
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  // As an executed cutover leaves them: the migration in `cutover`, its paths
  // too, their slots released.
  await q(`UPDATE mailbox_mapping SET status = 'cutover'`);
  await q('DELETE FROM path_lifecycle');
  await q(
    `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at, ended_at)
     VALUES ($1, $2, 'email', 'cutover', now(), now()), ($1, $2, 'calendar', 'cutover', now(), now())`,
    [TENANT, MAPPING],
  );
  await q('DELETE FROM audit_log');
});

describe('a change through the ledger door that takes slots', () => {
  it('hands them to its caller once, inside the change, after the paths moved', async () => {
    const { seen, onSlotsTaken } = hook();
    await rollBack({ onSlotsTaken });
    // The transaction the hook was handed already holds the change.
    expect(seen).toEqual([{ status: 'active' }]);
    expect(await pathStates()).toEqual(['calendar:active', 'email:active']);
    expect(await audited()).toBe(1);
  });

  it('is taken back whole when the caller cannot record them', async () => {
    const { onSlotsTaken } = hook(true);
    await expect(rollBack({ onSlotsTaken })).rejects.toThrow('the peak could not be written');
    expect(await status()).toBe('cutover');
    expect(await pathStates()).toEqual(['calendar:cutover', 'email:cutover']);
    expect(await audited()).toBe(0);
  });

  it('is passed on by the port the CLI and the rollback job hold', async () => {
    const { seen, onSlotsTaken } = hook();
    await mappingLifecyclePort(driver, TENANT, MAPPING, 'trigger-job', { onSlotsTaken }).setStatus({
      from: 'cutover',
      to: 'active',
      via: 'rollback',
    });
    expect(seen).toHaveLength(1);
  });

  it('writes only its own rows when nobody hands it a hook, as on a self-hosted database', async () => {
    await rollBack({});
    expect(await status()).toBe('active');
    expect(await pathStates()).toEqual(['calendar:active', 'email:active']);
  });
});

describe('a change that takes no slots calls nobody', () => {
  it('a cutover releases them', async () => {
    await q(`UPDATE mailbox_mapping SET status = 'active' WHERE id = $1`, [MAPPING]);
    await q(`UPDATE path_lifecycle SET state = 'active', ended_at = NULL`);
    const { seen, onSlotsTaken } = hook();
    await applyMappingStatusChange(
      driver,
      TENANT,
      { mappingId: MAPPING, from: 'active', to: 'cutover', actor: 'cli', via: 'cutover' },
      { onSlotsTaken },
    );
    expect(seen).toEqual([]);
    expect(await pathStates()).toEqual(['calendar:cutover', 'email:cutover']);
  });

  it('restating the status a migration has is not a change', async () => {
    const { seen, onSlotsTaken } = hook();
    await applyMappingStatusChange(
      driver,
      TENANT,
      { mappingId: MAPPING, from: 'active', to: 'active', actor: 'cli', via: 'rollback' },
      { onSlotsTaken },
    );
    expect(seen).toEqual([]);
  });

  it('a migration with no paths takes none', async () => {
    const { seen, onSlotsTaken } = hook();
    await applyMappingStatusChange(
      driver,
      TENANT,
      { mappingId: PATHLESS, from: 'cutover', to: 'active', actor: 'cli', via: 'rollback' },
      { onSlotsTaken },
    );
    expect(seen).toEqual([]);
    expect(await status(PATHLESS)).toBe('active');
  });
});
