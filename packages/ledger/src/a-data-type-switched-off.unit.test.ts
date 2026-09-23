// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A data type switched off after copying is `stopped`, not `skipped`
 * (workplan 0125 T7, migration 0057).
 *
 * The owner, 2026-09-23: *"don't refuse but do the 3 steps"*. An appliance's
 * mapping file can switch a data type off after it has copied things. Nothing
 * is lost, and nothing was said either: every pass wrote `skipped`, the word
 * for a data type the migration never had, over a calendar with four hundred
 * copies that had stopped following the source.
 *
 * Pinned here, on real Postgres via PGlite, because every property is the
 * statement's: which items make a data type stopped, that the count is the
 * number `itemsSynced` shows, that the database accepts the word at all, and
 * that switching back on undoes only what a switch-off wrote.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { createPgliteDb } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import { PgMigrationStatusStore } from './migration-status-store.ts';
import type { LedgerDriver, LedgerConnection } from './driver.ts';
import type { PgDatabase } from './db-types.ts';
import { DOMAIN_STATES, type MappingId, type PauseReason, type TenantId } from '@openmig/shared';

// UUID family 0057…, unused elsewhere in the repo.
const TENANT = '00570000-e29b-41d4-a716-446655440001' as TenantId;
const MAPPING = '00570000-e29b-41d4-a716-446655440002' as MappingId;
const OTHER_MAPPING = '00570000-e29b-41d4-a716-446655440003' as MappingId;
const CONN = '00570000-e29b-41d4-a716-446655440004';
const MAILBOXES = [
  '00570000-e29b-41d4-a716-446655440005',
  '00570000-e29b-41d4-a716-446655440006',
  '00570000-e29b-41d4-a716-446655440007',
  '00570000-e29b-41d4-a716-446655440008',
] as const;

const CEILING: PauseReason = {
  kind: 'daily-download-ceiling',
  provider: 'imap.example.invalid',
  windowResetsAt: '2026-09-24T06:00:00.000Z',
};

let driver: LedgerDriver;
let conn: LedgerConnection;
let db: PgDatabase;
let store: PgMigrationStatusStore;

beforeAll(async () => {
  const made = await createPgliteDb({});
  driver = made.driver;
  db = made.db;
  await runMigrations({ driver, logger: () => {} });
  conn = await driver.acquire();
  await conn.query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'Switched off', 'active')`, [
    TENANT,
  ]);
  await conn.query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
     VALUES ($1,$2,'source','imap','t','{}'::jsonb,'connected')`,
    [CONN, TENANT],
  );
  for (const [i, id] of MAILBOXES.entries()) {
    const addr = `box${i}@switched-off.invalid`;
    await conn.query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, primary_address, display_name, status)
       VALUES ($1,$2,$3,$4,'user',$4,$4,'active')`,
      [id, TENANT, CONN, addr],
    );
  }
  for (const [id, src, dst] of [
    [MAPPING, MAILBOXES[0], MAILBOXES[1]],
    [OTHER_MAPPING, MAILBOXES[2], MAILBOXES[3]],
  ] as const) {
    await conn.query(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
       VALUES ($1,$2,$3,$4,'mirror','active')`,
      [id, TENANT, src, dst],
    );
  }
  store = new PgMigrationStatusStore(db);
}, 120_000);

afterAll(async () => {
  conn?.release();
  await driver?.end();
});

beforeEach(async () => {
  await conn.query('DELETE FROM migration_status');
  await conn.query('DELETE FROM item');
});

let serial = 0;
/** One ledger row in the given state, under a key nothing else uses. */
async function item(
  status: string,
  opts: { domain?: 'calendar' | 'contact'; mapping?: MappingId } = {},
): Promise<string> {
  const domain = opts.domain ?? 'calendar';
  const key = `key-${++serial}`;
  await conn.query(
    `INSERT INTO item
       (tenant_id, mapping_id, domain, item_type, collection, natural_key, natural_key_hash, status)
     VALUES ($1,$2,$3,$3,'',$4,$4,$5)`,
    [TENANT, opts.mapping ?? MAPPING, domain, key, status],
  );
  return key;
}

async function stateOf(domain: 'calendar' | 'contact' = 'calendar'): Promise<string | undefined> {
  const r = await conn.query<{ state: string }>(
    `SELECT state FROM migration_status WHERE tenant_id = $1 AND mapping_id = $2 AND domain = $3`,
    [TENANT, MAPPING, domain],
  );
  return r.rows[0]?.state;
}

describe('the database accepts every state the product can write', () => {
  // The CHECK is the one copy of the list that cannot import it. A state the
  // code writes and the database refuses is a pass that dies mid-way with a
  // constraint violation, which is why 0057 widens it before anything writes
  // `stopped`, and why this writes every value through it.
  it('from pending to stopped', async () => {
    await store.initDomainStatus(TENANT, MAPPING, 'calendar');
    for (const state of DOMAIN_STATES) {
      await conn.query(
        `UPDATE migration_status SET state = $1 WHERE tenant_id = $2 AND mapping_id = $3`,
        [state, TENANT, MAPPING],
      );
      expect(await stateOf()).toBe(state);
    }
  });
});

describe('a switched-off data type with copies is stopped', () => {
  it('says stopped, with how many copies stay', async () => {
    await item('copied');
    await item('copied');
    await item('updated');
    expect(await store.markSwitchedOff(TENANT, MAPPING, 'calendar')).toEqual({
      state: 'stopped',
      copies: 3,
    });
    expect(await stateOf()).toBe('stopped');
  });

  it('counts exactly what itemsSynced counts, so the line and the page agree', async () => {
    // What the migration has on the target, and what it does not: a failure,
    // an item the owner already had, one left behind by decision, a removed
    // copy, and a name the document outgrew. Only the first three are copies.
    for (const s of ['copied', 'updated', 'skipped']) await item(s);
    for (const s of ['failed', 'adopted', 'left_behind', 'tombstoned', 'superseded', 'pending']) {
      await item(s);
    }
    const now = await store.markSwitchedOff(TENANT, MAPPING, 'calendar');
    expect(now).toEqual({ state: 'stopped', copies: 3 });

    const calendar = (await store.getStatus(TENANT, MAPPING)).find((s) => s.domain === 'calendar');
    expect(calendar?.state).toBe('stopped');
    expect(calendar?.itemsSynced).toBe(3);
  });

  it('counts only this data type of this migration', async () => {
    await item('copied', { domain: 'contact' });
    await item('copied', { mapping: OTHER_MAPPING });
    expect(await store.markSwitchedOff(TENANT, MAPPING, 'calendar')).toEqual({ state: 'skipped' });
  });

  it('clears a pause, since a data type nobody copies waits for no window', async () => {
    await item('copied');
    await store.initDomainStatus(TENANT, MAPPING, 'calendar');
    await store.markPaused(TENANT, MAPPING, 'calendar', CEILING);
    await store.markSwitchedOff(TENANT, MAPPING, 'calendar');
    const [calendar] = await store.getStatus(TENANT, MAPPING);
    expect(calendar?.state).toBe('stopped');
    expect(calendar?.pausedReason).toBeUndefined();
  });

  it('writes its own row, so no caller has to create one first', async () => {
    await item('copied');
    expect(await stateOf()).toBeUndefined();
    await store.markSwitchedOff(TENANT, MAPPING, 'calendar');
    expect(await stateOf()).toBe('stopped');
  });

  it('says the same thing twice, and changes nothing the second time', async () => {
    await item('copied');
    const first = await store.markSwitchedOff(TENANT, MAPPING, 'calendar');
    const second = await store.markSwitchedOff(TENANT, MAPPING, 'calendar');
    expect(second).toEqual(first);
    const rows = await conn.query(`SELECT 1 FROM migration_status WHERE mapping_id = $1`, [MAPPING]);
    expect(rows.rows).toHaveLength(1);
  });
});

describe('a switched-off data type without copies is skipped', () => {
  it('when it never copied anything', async () => {
    expect(await store.markSwitchedOff(TENANT, MAPPING, 'calendar')).toEqual({ state: 'skipped' });
    expect(await stateOf()).toBe('skipped');
  });

  it('when all it has is failures and the owner’s own items', async () => {
    await item('failed');
    await item('adopted');
    expect(await store.markSwitchedOff(TENANT, MAPPING, 'calendar')).toEqual({ state: 'skipped' });
  });

  it('once its last copy was removed, the next time it is recorded', async () => {
    const only = await item('copied');
    expect((await store.markSwitchedOff(TENANT, MAPPING, 'calendar')).state).toBe('stopped');
    await conn.query(`UPDATE item SET status = 'tombstoned' WHERE natural_key_hash = $1`, [only]);
    expect(await store.markSwitchedOff(TENANT, MAPPING, 'calendar')).toEqual({ state: 'skipped' });
  });
});

describe('switching back on undoes only what a switch-off wrote', () => {
  it('a stopped data type is pending until its next pass starts', async () => {
    await item('copied');
    await store.markSwitchedOff(TENANT, MAPPING, 'calendar');
    await store.markSwitchedOn(TENANT, MAPPING, 'calendar');
    expect(await stateOf()).toBe('pending');
  });

  for (const [state, write] of [
    ['completed', () => store.markCompleted(TENANT, MAPPING, 'calendar')],
    ['failed', () => store.markFailed(TENANT, MAPPING, 'calendar', 'the target refused')],
    ['in_progress', () => store.markInProgress(TENANT, MAPPING, 'calendar')],
    ['skipped', () => store.markSwitchedOff(TENANT, MAPPING, 'calendar')],
  ] as const) {
    it(`a ${state} data type keeps the state its last pass gave it`, async () => {
      await store.initDomainStatus(TENANT, MAPPING, 'calendar');
      await write();
      await store.markSwitchedOn(TENANT, MAPPING, 'calendar');
      expect(await stateOf()).toBe(state);
    });
  }

  it('touches no other data type', async () => {
    await item('copied');
    await item('copied', { domain: 'contact' });
    await store.markSwitchedOff(TENANT, MAPPING, 'calendar');
    await store.markSwitchedOff(TENANT, MAPPING, 'contact');
    await store.markSwitchedOn(TENANT, MAPPING, 'calendar');
    expect(await stateOf('calendar')).toBe('pending');
    expect(await stateOf('contact')).toBe('stopped');
  });
});
