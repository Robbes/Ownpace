// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * TWO PRESSES OF THE TABLE OF ADDRESS CHANGES AT ONCE, ON POSTGRES (ADR-0055;
 * workplan 0168 T2; the review of 0168's table, finding 6).
 *
 * That a new address is never an old one (`chained`) is a rule over two rows,
 * which no constraint holds. The store holds it by taking the organisation's
 * advisory lock before it reads the table (`lockAddressChanges`), so the
 * second of two presses is decided on what the first wrote. PGlite has one
 * connection, so nothing there can race: the store's own tests, the routes'
 * and the appliance's all passed with the lock removed. This runs two
 * connections on a real server, as the serving role under row security. The
 * first press writes and holds its transaction open; the second starts inside
 * it. With the lock the second waits for the first and is refused; without
 * it, the second reads a table without the first's row, and both are written.
 *
 * Each case is one the review ran by hand: a chain either way, two new
 * addresses for one old one, the same change twice, a new address into a
 * chain another press is making, two deletes, and the table's last row. And
 * that `withTenant` is READ COMMITTED, which lock-then-read needs: a snapshot
 * taken before the lock would not see the first press's row.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { ADDRESS_CHANGE_ROWS_MAX } from '@openmig/shared';
import { runMigrations } from './migrate.ts';
import { pgDriver, withTenant, type PgDatabase } from './db.ts';
import type { LedgerDriver } from './driver.ts';
import {
  addAddressChange,
  deleteAddressChange,
  readAddressChanges,
  updateAddressChange,
} from './address-change-store.ts';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
if (!ADMIN_URL) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

// UUID family 0168a2c0-…, unused elsewhere in the repo.
const TENANT = '0168a2c0-e29b-41d4-a716-446655440001';

/** How long the first press holds its transaction open, and when the second starts. */
const HOLD_MS = 600;
const SECOND_AFTER_MS = 100;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let dbName: string;
let pool: Pool;
let driver: LedgerDriver;

beforeAll(async () => {
  dbName = `address_races_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = new Pool({ connectionString: ADMIN_URL });
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  const url = new URL(ADMIN_URL!);
  url.pathname = `/${dbName}`;
  pool = new Pool({ connectionString: url.toString(), max: 4 });
  driver = pgDriver(pool, { role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  // Seeded as the database's owner, past row security.
  await pool.query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'races', 'active')`, [TENANT]);
}, 120_000);

afterAll(async () => {
  await pool?.end();
  const admin = new Pool({ connectionString: ADMIN_URL });
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

beforeEach(async () => {
  await pool.query(`DELETE FROM address_change WHERE tenant_id = $1`, [TENANT]);
});

type Press<T> = (db: PgDatabase) => Promise<T>;

/**
 * The first press writes and holds its transaction open for `HOLD_MS`; the
 * second starts `SECOND_AFTER_MS` into it. Each answer says when it came, and
 * a press that threw says what the database said.
 */
async function atOnce<A, B>(first: Press<A>, second: Press<B>) {
  const t0 = Date.now();
  const one = withTenant(driver, TENANT, async (db) => {
    const r = await first(db);
    await sleep(HOLD_MS);
    return r;
  }).then((r) => ({ r, at: Date.now() - t0 }));
  await sleep(SECOND_AFTER_MS);
  const two = withTenant(driver, TENANT, second).then(
    (r) => ({ r, thrown: undefined as string | undefined, at: Date.now() - t0 }),
    (e: unknown) => ({ r: undefined, thrown: String((e as Error & { cause?: Error }).cause?.message ?? e), at: Date.now() - t0 }),
  );
  return Promise.all([one, two]);
}

const add =
  (oldAddress: string, newAddress: string, confirm = true): Press<Awaited<ReturnType<typeof addAddressChange>>> =>
  (db) =>
    addAddressChange(db, TENANT, { oldAddress, newAddress, confirm, by: 'races' });

const refusalOf = (w: { ok: boolean; refusal?: { error: string } } | undefined) => (w && !w.ok ? w.refusal?.error : undefined);

const table = () => withTenant(driver, TENANT, (db) => readAddressChanges(db, TENANT));

describe('two presses at once', () => {
  it('a → b and b → c: the second waits for the first, and is refused chained', async () => {
    const [one, two] = await atOnce(add('a@example.com', 'b@example.com'), add('b@example.com', 'c@example.org'));
    expect(one.r.ok).toBe(true);
    expect(two.thrown).toBeUndefined();
    // It waited for the first press's transaction, and was decided on its row.
    expect(two.at).toBeGreaterThanOrEqual(HOLD_MS);
    expect(refusalOf(two.r)).toBe('chained');
    expect((await table()).map((r) => r.oldKey)).toEqual(['a@example.com']);
  });

  it('b → c, then a → b: refused chained the other way', async () => {
    const [one, two] = await atOnce(add('b@example.com', 'c@example.org'), add('a@example.com', 'b@example.com'));
    expect(one.r.ok).toBe(true);
    expect(refusalOf(two.r)).toBe('chained');
    expect((await table()).map((r) => r.oldKey)).toEqual(['b@example.com']);
  });

  it('a → b and a → c: already_changed, said in both languages, not a key violation', async () => {
    const [one, two] = await atOnce(add('a@example.com', 'b@example.org'), add('A@example.com', 'c@example.org'));
    expect(one.r.ok).toBe(true);
    expect(two.thrown).toBeUndefined();
    expect(refusalOf(two.r)).toBe('already_changed');
    const refusal = two.r && !two.r.ok ? two.r.refusal : undefined;
    expect(refusal?.messageNl).toContain('wordt al');
    expect(refusal?.messageNl).not.toBe(refusal?.message);
    expect((await table()).map((r) => r.newAddress)).toEqual(['b@example.org']);
  });

  it('the same a → b twice: added, then answered with its row and nothing written', async () => {
    const [one, two] = await atOnce(add('a@example.com', 'b@example.org'), add('a@example.com', 'b@example.org'));
    expect(one.r.ok && one.r.created).toBe(true);
    expect(two.r?.ok && !two.r.created && !two.r.changed).toBe(true);
    expect(await table()).toHaveLength(1);
  });

  it('a new address into a chain while another press adds the row it would chain to: chained', async () => {
    await withTenant(driver, TENANT, add('a@example.com', 'b@example.org'));
    const [one, two] = await atOnce(add('x@example.com', 'y@example.org'), (db) =>
      updateAddressChange(db, TENANT, 'a@example.com', { newAddress: 'x@example.com', state: 'confirmed', by: 'races' }),
    );
    expect(one.r.ok).toBe(true);
    expect(refusalOf(two.r)).toBe('chained');
    expect((await table()).find((r) => r.oldKey === 'a@example.com')?.newAddress).toBe('b@example.org');
  });

  it('two deletes at once: one removes the row, and the other finds nothing to remove', async () => {
    await withTenant(driver, TENANT, add('gone@example.com', 'here@example.org'));
    const del: Press<unknown> = (db) => deleteAddressChange(db, TENANT, 'gone@example.com');
    const [one, two] = await atOnce(del, del);
    expect(one.r).toMatchObject({ oldKey: 'gone@example.com' });
    expect(two.thrown).toBeUndefined();
    expect(two.r).toBeUndefined();
  });

  it(`two new rows at once for the table's last place: one is added, the other refused`, async () => {
    await pool.query(
      `INSERT INTO address_change (tenant_id, old_key, old_address, new_address, set_by)
       SELECT $1, 'old' || n || '@example.com', 'old' || n || '@example.com', 'new' || n || '@example.org', 'races'
         FROM generate_series(1, $2::int) AS n`,
      [TENANT, ADDRESS_CHANGE_ROWS_MAX - 1],
    );
    const [one, two] = await atOnce(add('last@example.com', 'last@example.org'), add('one-more@example.com', 'one-more@example.org'));
    expect(one.r.ok).toBe(true);
    expect(refusalOf(two.r)).toBe('too_many_address_changes');
    expect(await table()).toHaveLength(ADDRESS_CHANGE_ROWS_MAX);
  });

  it('withTenant reads at READ COMMITTED, which a read after the lock needs', async () => {
    const level = await withTenant(driver, TENANT, async (db) => (await db.execute(sql`SHOW transaction_isolation`)).rows);
    expect(level).toEqual([{ transaction_isolation: 'read committed' }]);
  });
});
