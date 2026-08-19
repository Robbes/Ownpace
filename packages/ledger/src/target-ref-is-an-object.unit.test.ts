// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The target handle every item claimed not to have.
 *
 * `PgLedger` wrote `target_ref` as `JSON.stringify({ id })` into a drizzle
 * `jsonb` column. Drizzle serialises whatever it is handed, so the JSON *text*
 * was stored as a jsonb string scalar — `"{\"id\":\"abc\"}"` — not the object
 * `{"id":"abc"}`. Nothing complained. `target_ref->>'id'` was NULL on every row
 * ever written, and `mapRowToRecord` read `.id` off a string and got
 * `undefined`, so every `targetId` in the system came back as `''`.
 *
 * It stayed invisible because the only code that needs the handle is the apply
 * path, and the managed gate had never let its apply half run. The first run
 * that did reported `copied` items that all claimed no target handle.
 *
 * Run through the REAL PgLedger against real migrations, because that is the
 * layer the bug lived in: a test that inserted the row itself would have
 * written a correct object and proved nothing. That is exactly how it hid — a
 * hand-written INSERT of the same value stores a proper object; only drizzle's
 * own serialisation double-encodes.
 */

import { it, expect, beforeAll, afterAll } from 'vitest';
import { createPgliteDb } from './pglite-driver';
import { runMigrations } from './migrate';
import { PgLedger } from './ledger';

const T = '9b2e0000-e29b-41d4-a716-4466554471a1';
const C = '9b2e0000-e29b-41d4-a716-4466554471a2';
const S = '9b2e0000-e29b-41d4-a716-4466554471a3';
const D = '9b2e0000-e29b-41d4-a716-4466554471a4';
const M = '9b2e0000-e29b-41d4-a716-4466554471a5';

let db: Awaited<ReturnType<typeof createPgliteDb>>['db'];
let driver: Awaited<ReturnType<typeof createPgliteDb>>['driver'];
let close: Awaited<ReturnType<typeof createPgliteDb>>['close'];
let conn: Awaited<ReturnType<typeof driver.acquire>>;

beforeAll(async () => {
  ({ db, driver, close } = await createPgliteDb());
  await runMigrations({ driver, logger: () => {} });
  conn = await driver.acquire();
  await conn.query(`INSERT INTO tenant (id,name) VALUES ($1,'target-ref')`, [T]);
  await conn.query(
    `INSERT INTO connection (id,tenant_id,role,kind,display_name,config,status)
     VALUES ($1,$2,'source','imap','t','{}'::jsonb,'connected')`,
    [C, T],
  );
  for (const [id, addr] of [
    [S, 's@tref.local'],
    [D, 'd@tref.local'],
  ]) {
    await conn.query(
      `INSERT INTO mailbox (id,tenant_id,connection_id,external_id,kind,primary_address,display_name,status)
       VALUES ($1,$2,$3,$4,'user',$4,$4,'active')`,
      [id, T, C, addr],
    );
  }
  await conn.query(
    `INSERT INTO mailbox_mapping (id,tenant_id,source_mailbox_id,target_mailbox_id,mode,status)
     VALUES ($1,$2,$3,$4,'mirror','active')`,
    [M, T, S, D],
  );
  await new PgLedger(db).recordIfAbsent({
    tenantId: T,
    mappingId: M,
    itemType: 'calendar',
    naturalKeyHash: 'h-handle',
    contentHash: 'c1',
    targetId: 'target-abc',
    createdAt: new Date().toISOString(),
    status: 'copied',
    collection: 'personal',
  } as Parameters<PgLedger['recordIfAbsent']>[0]);
}, 120_000);

afterAll(async () => {
  conn?.release();
  await close?.();
});

it('stores a jsonb OBJECT, not a string of one', async () => {
  const { rows } = await conn.query<{ t: string }>(
    `SELECT jsonb_typeof(target_ref) AS t FROM item WHERE natural_key_hash='h-handle'`,
  );
  // Before the fix this was 'string'.
  expect(rows[0]!.t).toBe('object');
});

it("SQL can read the handle back with ->>'id'", async () => {
  // The predicate smoke-managed.sh's apply half selects on. It returned NULL
  // for every row in existence.
  const { rows } = await conn.query<{ id: string | null }>(
    `SELECT target_ref->>'id' AS id FROM item WHERE natural_key_hash='h-handle'`,
  );
  expect(rows[0]!.id).toBe('target-abc');
});

it('and the read path hands back the id rather than an empty string', async () => {
  // `mapRowToRecord` does `(row.targetRef as {id?}).id ?? ''`. Off a string
  // that is `undefined`, so apply-deletion received '' and passed it to
  // removeItem — see the empty-handle guard in dav-remove.ts.
  const { rows } = await conn.query<{ target_ref: unknown }>(
    `SELECT target_ref FROM item WHERE natural_key_hash='h-handle'`,
  );
  const ref = rows[0]!.target_ref;
  expect(typeof ref).toBe('object');
  expect((ref as { id?: string }).id).toBe('target-abc');
});
