// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * TWO PRESSES AT ONCE, ON A REAL POSTGRES (workplan 0168 §4.4, D6). Until
 * this, nothing in the repository tested the organisation's lock on a server
 * that can run two transactions at once.
 *
 * A person's link answers through `answerAddressChangeByLink`, which takes the
 * organisation's lock first, through the ledger's one writer, before it asks
 * whose row it is. PGlite has one connection and never overlaps two
 * transactions, so this is where the lock is seen to matter: the first
 * transaction holds its answer open, and the second starts inside it.
 *
 *  - *Yes* twice, from the grant page and the progress page: the second waits
 *    for the first, writes nothing, and both answer the one confirmed row;
 *  - *Yes* and *Not right?* at once: the second waits, and the row ends as
 *    the second answer says;
 *  - an owner moving the row to another person while the person presses
 *    *Yes*: the press waits, answers as for a row that is not theirs, and the
 *    row is not confirmed by somebody it no longer belongs to.
 *
 * TEST_DATABASE_URL (Testcontainers under `pnpm test:integration`, or
 * `scripts/local-pg.sh`), as the owner of the database, with `app_user`
 * taken in each transaction (`withTenant`). UUID family 0168c4e2-….
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { addAddressChange, pgDriver, updateAddressChange, withTenant, type LedgerDriver } from '@openmig/ledger';
import type { PgDatabase } from '@openmig/ledger/db';
import { addressChangeNotFound } from '@openmig/shared';
import { answerAddressChangeByLink, linkAddressChangePerson } from './address-change-person.ts';

const URL = process.env.TEST_DATABASE_URL;
if (!URL) throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');

const U = (n: string) => `0168c4e2-e29b-41d4-a716-4466554430${n}`;
const TENANT = U('01');
const KID = U('41');
const MUM = U('42');
const KEY = 'kidname@gmail.com';

/** How long the first transaction stays open after its write. */
const HOLD = 600;
/** Who answered, as the route says it: the progress link's holder, and a reference that is no address. */
const AUDIT = { actor: 'progress-link', pseudonym: () => 'a-row-reference' };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let pool: Pool;
let driver: LedgerDriver;

/**
 * The first transaction does its work and stays open for `HOLD`; the second
 * starts 100 ms into it. Each answer comes back with when it came, counted
 * from the start of the first.
 */
async function interleave<A, B>(first: (db: PgDatabase) => Promise<A>, second: (db: PgDatabase) => Promise<B>) {
  const t0 = Date.now();
  const one = withTenant(driver, TENANT, async (db) => {
    const r = await first(db);
    await sleep(HOLD);
    return r;
  }).then((r) => ({ r, at: Date.now() - t0 }));
  await sleep(100);
  const two = withTenant(driver, TENANT, second).then((r) => ({ r, at: Date.now() - t0 }));
  return Promise.all([one, two]);
}

type Stored = { state: string; confirmed_by: string | null; confirmed_at: Date | string | null };

/** A timestamp as one instant, whether the driver gave a Date or its text. */
const instant = (v: Date | string | null): string | null => (v === null ? null : new Date(v).toISOString());

const stored = async (): Promise<Stored[]> =>
  (await pool.query<Stored>('SELECT state, confirmed_by, confirmed_at FROM address_change WHERE tenant_id = $1', [TENANT]))
    .rows;

/** The row as the transaction holding `db` sees it, its own write included. */
async function seenBy(db: PgDatabase): Promise<Stored> {
  const result = (await db.execute(
    sql`SELECT state, confirmed_by, confirmed_at FROM address_change WHERE tenant_id = ${TENANT}::uuid AND old_key = ${KEY}`,
  )) as unknown as { rows: Stored[] };
  return result.rows[0]!;
}

const linkedTo = async () =>
  (await pool.query<{ person_id: string }>('SELECT person_id FROM address_change_person WHERE tenant_id = $1', [TENANT]))
    .rows;

beforeAll(async () => {
  pool = new Pool({ connectionString: URL, max: 6 });
  driver = pgDriver(pool, { role: 'app_user' });
  await pool.query('DELETE FROM tenant WHERE id = $1', [TENANT]);
  await pool.query(`INSERT INTO tenant (id, name) VALUES ($1, 'Two presses at once')`, [TENANT]);
  await pool.query(`INSERT INTO person (id, tenant_id, display_name) VALUES ($1, $3, 'Kid'), ($2, $3, 'Mum')`, [
    KID,
    MUM,
    TENANT,
  ]);
});

afterAll(async () => {
  await pool.query('DELETE FROM tenant WHERE id = $1', [TENANT]);
  await pool.end();
});

beforeEach(async () => {
  await pool.query('DELETE FROM address_change WHERE tenant_id = $1', [TENANT]);
  await withTenant(driver, TENANT, async (db) => {
    const w = await addAddressChange(db, TENANT, {
      oldAddress: 'Kid.Name@gmail.com',
      newAddress: 'kid@example.org',
      confirm: false,
      by: 'owner-subject',
    });
    if (!w.ok) throw new Error(w.refusal.message);
    await linkAddressChangePerson(db, TENANT, KEY, KID);
  });
});

describe('two presses at once, through a person’s links', () => {
  it('Yes twice: the second waits, writes nothing, and both answer the one confirmed row', async () => {
    const [one, two] = await interleave(
      async (db) => ({ answer: await answerAddressChangeByLink(db, TENANT, KID, KEY, 'confirmed', AUDIT), row: await seenBy(db) }),
      (db) => answerAddressChangeByLink(db, TENANT, KID, KEY, 'confirmed', AUDIT),
    );
    expect(one.r.answer).toMatchObject({ ok: true, row: { oldKey: KEY, state: 'confirmed' } });
    expect(two.r).toMatchObject({ ok: true, row: { oldKey: KEY, state: 'confirmed' } });
    expect(two.at, 'the second press waited for the first').toBeGreaterThanOrEqual(HOLD);

    const rows = await stored();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: 'confirmed', confirmed_by: `person:${KID}` });
    // Confirmed once: the moment is the first press's, which the second left alone.
    expect(instant(rows[0]!.confirmed_at)).toBe(instant(one.r.row.confirmed_at));
    expect(instant(rows[0]!.confirmed_at)).not.toBeNull();
  });

  it('Yes and Not right? at once: the second waits, and the row ends as it says', async () => {
    const [one, two] = await interleave(
      (db) => answerAddressChangeByLink(db, TENANT, KID, KEY, 'confirmed', AUDIT),
      (db) => answerAddressChangeByLink(db, TENANT, KID, KEY, 'proposed', AUDIT),
    );
    expect(one.r).toMatchObject({ ok: true, row: { state: 'confirmed' } });
    expect(two.r).toMatchObject({ ok: true, row: { state: 'proposed' } });
    expect(two.at, 'the second press waited for the first').toBeGreaterThanOrEqual(HOLD);
    expect(await stored()).toEqual([{ state: 'proposed', confirmed_by: null, confirmed_at: null }]);
  });

  it('an owner moving the row to Mum while Kid presses Yes: the press waits and finds no row of Kid’s', async () => {
    const [one, two] = await interleave(
      // The organisation's PUT with a person: the one writer first, which
      // takes the lock, then the link, in one transaction.
      async (db) => {
        const w = await updateAddressChange(db, TENANT, KEY, { by: 'owner-subject' });
        await linkAddressChangePerson(db, TENANT, KEY, MUM);
        return w.ok;
      },
      (db) => answerAddressChangeByLink(db, TENANT, KID, KEY, 'confirmed', AUDIT),
    );
    expect(one.r).toBe(true);
    expect(two.at, 'the press waited for the owner').toBeGreaterThanOrEqual(HOLD);
    expect(two.r).toEqual({ ok: false, refusal: addressChangeNotFound(KEY) });
    expect(await stored()).toEqual([{ state: 'proposed', confirmed_by: null, confirmed_at: null }]);
    expect(await linkedTo()).toEqual([{ person_id: MUM }]);
  });
});
