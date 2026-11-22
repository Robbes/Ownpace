// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ADDRESS CHANGE ANOTHER ORGANISATION NEVER SEES (ADR-0055; workplan 0168
 * T2, §4.2).
 *
 * The table holds other people's addresses: a family member's old and new
 * ones. It is under forced row security like every tenant table, and this
 * holds it, on the real migrations in PGlite, as the appliance and the managed
 * API read it (`withTenant`, which drops to `app_user`):
 *
 *  - another organisation never sees a row, through the store or a bare
 *    SELECT, and cannot write one into this organisation's table;
 *  - the refusals: `not_an_address`, `same_address`, `already_changed` and
 *    `chained` both ways, each naming the row, each in English and Dutch,
 *    and none writing anything;
 *  - the same change twice writes nothing; a new address unconfirms;
 *  - the engine's reader returns the confirmed rows only, by old key;
 *  - the file door makes the table the file's, idempotently.
 *
 * Addresses are invented, at `example.org` and Gmail's own domain, which the
 * key folds.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { parseAddressChangesFile, type TenantId } from '@openmig/shared';
import { pgliteDriver } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import { withTenant } from './db.ts';
import type { LedgerDriver } from './driver.ts';
import { PgLedger } from './ledger.ts';
import {
  addAddressChange,
  deleteAddressChange,
  readAddressChanges,
  replaceAddressChangesFromFile,
  updateAddressChange,
} from './address-change-store.ts';

const A = '0168a2d0-e29b-41d4-a716-446655440001';
const B = '0168a2d0-e29b-41d4-a716-446655440002';
const BY = 'subject-of-a-member';

let driver: LedgerDriver;

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  const conn = await driver.acquire();
  try {
    await conn.query(`INSERT INTO tenant (id, name) VALUES ($1, 'A'), ($2, 'B')`, [A, B]);
  } finally {
    conn.release();
  }
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

const add = (tenant: string, oldAddress: string, newAddress: string, confirm = false) =>
  withTenant(driver, tenant, (db) => addAddressChange(db, tenant, { oldAddress, newAddress, confirm, by: BY }));

describe('the table of address changes, under row security', () => {
  it('adds a proposed row, keyed by the folded old address', async () => {
    const w = await add(A, 'An.Example+old@gmail.com', 'an@example.org');
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    expect(w.created).toBe(true);
    expect(w.row).toMatchObject({
      oldKey: 'anexample@gmail.com',
      oldAddress: 'An.Example+old@gmail.com',
      newAddress: 'an@example.org',
      state: 'proposed',
      setBy: BY,
      confirmedBy: null,
      confirmedAt: null,
    });
  });

  it('another organisation never sees it: not through the store, not through a bare SELECT', async () => {
    const seen = await withTenant(driver, B, (db) => readAddressChanges(db, A));
    expect(seen).toEqual([]);
    const bare = await withTenant(driver, B, async (db) => (await db.execute(sql`SELECT * FROM address_change`)).rows);
    expect(bare).toEqual([]);
    const own = await withTenant(driver, A, (db) => readAddressChanges(db, A));
    expect(own.map((r) => r.oldKey)).toEqual(['anexample@gmail.com']);
  });

  it('another organisation cannot write a row into this one', async () => {
    const err = await withTenant(driver, B, (db) =>
      db.execute(sql`INSERT INTO address_change (tenant_id, old_key, old_address, new_address, set_by)
                     VALUES (${A}::uuid, 'x@example.org', 'x@example.org', 'y@example.org', 'b')`),
    ).then(
      () => undefined,
      (e: unknown) => e as Error & { cause?: Error },
    );
    // Drizzle wraps the database's refusal; the refusal itself is the cause.
    expect(String(err?.cause?.message ?? err?.message)).toMatch(/row-level security/);
  });

  it('the same change again writes nothing; with confirm it confirms', async () => {
    const again = await add(A, 'anexample@gmail.com', 'an@example.org');
    expect(again.ok && again.created === false && again.changed === false).toBe(true);
    const confirmed = await add(A, 'anexample@gmail.com', 'an@example.org', true);
    expect(confirmed.ok && confirmed.row.state === 'confirmed' && confirmed.row.confirmedBy === BY).toBe(true);
  });

  it.each([
    ['not an address', 'nobody', 'x@example.org', 'not_an_address', 'geen e-mailadres'],
    ['the same address in another spelling', 'b.c@gmail.com', 'BC@googlemail.com', 'same_address', 'hetzelfde adres'],
    ['a second row for one old address', 'an.example@gmail.com', 'other@example.org', 'already_changed', 'wordt al'],
    ['a new address that is an old one', 'kid@example.net', 'anexample@gmail.com', 'chained', 'verandert zelf ook'],
    ['an old address that is a new one', 'an@example.org', 'later@example.org', 'chained', 'wordt al'],
  ])('refuses %s, in English and Dutch, and writes nothing', async (_what, oldAddress, newAddress, error, dutch) => {
    const before = await withTenant(driver, A, (db) => readAddressChanges(db, A));
    const w = await add(A, oldAddress, newAddress);
    expect(w.ok).toBe(false);
    if (w.ok) return;
    expect(w.refusal.error).toBe(error);
    expect(w.refusal.message).not.toBe(w.refusal.messageNl);
    expect(w.refusal.messageNl).toContain(dutch);
    if (error === 'already_changed' || error === 'chained') {
      expect(w.refusal.row).toEqual({ oldAddress: 'An.Example+old@gmail.com', oldKey: 'anexample@gmail.com', newAddress: 'an@example.org' });
      expect(w.refusal.message).toContain('An.Example+old@gmail.com');
      expect(w.refusal.messageNl).toContain('An.Example+old@gmail.com');
    }
    expect(await withTenant(driver, A, (db) => readAddressChanges(db, A))).toEqual(before);
  });

  it('a new address on a confirmed row leaves it proposed; confirming again names who', async () => {
    const moved = await withTenant(driver, A, (db) =>
      updateAddressChange(db, A, 'anexample@gmail.com', { newAddress: 'an.other@example.org', by: 'someone-else' }),
    );
    expect(moved.ok && moved.row.state === 'proposed' && moved.row.confirmedBy === null).toBe(true);
    const back = await withTenant(driver, A, (db) =>
      updateAddressChange(db, A, 'anexample@gmail.com', { state: 'confirmed', by: 'someone-else' }),
    );
    expect(back.ok && back.row.confirmedBy === 'someone-else').toBe(true);
    const same = await withTenant(driver, A, (db) =>
      updateAddressChange(db, A, 'anexample@gmail.com', { state: 'confirmed', by: BY }),
    );
    expect(same.ok && same.changed === false && same.row.confirmedBy === 'someone-else').toBe(true);
  });

  it("the engine's reader returns the confirmed rows only, by old key, and only this organisation's", async () => {
    await add(A, 'zed@example.net', 'zed@example.org', true);
    await add(A, 'proposal@example.net', 'proposal@example.org');
    await add(B, 'b-only@example.net', 'b-only@example.org', true);
    const rows = await withTenant(driver, A, (db) => new PgLedger(db).listConfirmedAddressChanges(A as TenantId));
    expect(rows).toEqual([
      { oldKey: 'anexample@gmail.com', oldAddress: 'An.Example+old@gmail.com', newAddress: 'an.other@example.org' },
      { oldKey: 'zed@example.net', oldAddress: 'zed@example.net', newAddress: 'zed@example.org' },
    ]);
  });

  it('deletes a row, and a second delete finds nothing', async () => {
    const gone = await withTenant(driver, A, (db) => deleteAddressChange(db, A, 'proposal@example.net'));
    expect(gone?.oldKey).toBe('proposal@example.net');
    expect(await withTenant(driver, A, (db) => deleteAddressChange(db, A, 'proposal@example.net'))).toBeUndefined();
  });

  it("the file door makes the table the file's, and a second run changes nothing", async () => {
    const file = parseAddressChangesFile(
      JSON.stringify({ changes: [{ oldAddress: 'zed@example.net', newAddress: 'zed@example.org' }, { oldAddress: 'new@example.net', newAddress: 'new@example.org' }] }),
    );
    const first = await withTenant(driver, A, (db) => replaceAddressChangesFromFile(db, A, file, 'address-changes.json'));
    expect(first).toEqual({ added: 1, changed: 1, removed: 1, kept: 0 });
    const rows = await withTenant(driver, A, (db) => readAddressChanges(db, A));
    expect(rows.map((r) => [r.oldKey, r.state, r.setBy, r.confirmedBy])).toEqual([
      ['zed@example.net', 'confirmed', 'address-changes.json', 'address-changes.json'],
      ['new@example.net', 'confirmed', 'address-changes.json', 'address-changes.json'],
    ]);
    const second = await withTenant(driver, A, (db) => replaceAddressChangesFromFile(db, A, file, 'address-changes.json'));
    expect(second).toEqual({ added: 0, changed: 0, removed: 0, kept: 2 });
  });
});
