// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PATH ROW FOR EVERY MIGRATION THAT STARTED (workplan 0128 T5, slice 2a).
 *
 * Ledger migration 0065 gives every started migration's paths their
 * lifecycle rows, from the migration's own status, and `pathsFromTheMapping`
 * applies the same rule to one migration (the appliance, at every start-up).
 * Both are run here on the same rows: a database migrated up to 0064 and
 * filled, then taken to the end of the chain; and a second one, filled after
 * the whole chain, where the function is asked migration by migration. They
 * must write the same rows.
 *
 * The rule's edges are the fixtures: a draft that never ran, a paused one
 * that did, one running with no pass yet, a cutover, a finished one, one in
 * the continuous lane, a data type switched off, and a row that already
 * existed and must be left as it was.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPgliteDb } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import { withTenant } from './db.ts';
import type { LedgerDriver } from './driver.ts';
import { pathsFromTheMapping, recordScope } from './a-path-for-every-migration.ts';

// UUID family 0128c000-…, unused elsewhere in the repo.
const TENANT = '0128c000-e29b-41d4-a716-446655440001';
const CONNECTION = '0128c000-e29b-41d4-a716-446655440002';
const id = (n: number) => `0128c000-e29b-41d4-a716-4466554401${String(n).padStart(2, '0')}`;

/** Each migration, by what makes it an edge of the rule. */
const MIGRATIONS = {
  draft: { id: id(10), status: 'paused', ran: false },
  pausedThatRan: { id: id(11), status: 'paused', ran: true },
  runningNoPassYet: { id: id(12), status: 'active', ran: false },
  cutOver: { id: id(13), status: 'cutover', ran: true },
  finished: { id: id(14), status: 'done', ran: true },
  inTheLane: { id: id(15), status: 'continuous', ran: true },
  alreadyHadRows: { id: id(16), status: 'active', ran: true },
} as const;

const FIRST_PASS = '2026-08-01T09:00:00.000Z';
const CREATED = '2026-07-15T12:00:00.000Z';
const LAST_CHANGE = '2026-09-01T18:00:00.000Z';
const OLD_ROW = '2026-08-20T08:00:00.000Z';

const dirs: string[] = [];
const drivers: LedgerDriver[] = [];
afterAll(async () => {
  for (const d of drivers) await d.end();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** One statement, on a connection taken and given back (PGlite has one). */
async function q(driver: LedgerDriver, text: string, params: unknown[] = []) {
  const conn = await driver.acquire();
  try {
    return (await conn.query(text, params)).rows as Array<Record<string, unknown>>;
  } finally {
    conn.release();
  }
}

/** The ledger chain up to and including 0064, the one before this slice. */
function theChainBeforeThisSlice(): string {
  const here = join(import.meta.dirname, '..', 'migrations');
  const dir = mkdtempSync(join(tmpdir(), 'ownpace-0065-'));
  dirs.push(dir);
  for (const f of readdirSync(here).filter((f) => f.endsWith('.sql') && f < '0065')) {
    copyFileSync(join(here, f), join(dir, f));
  }
  return dir;
}

/** Every migration above, with email and calendar included and contact switched off. */
async function fill(driver: LedgerDriver): Promise<void> {
  await q(driver, `INSERT INTO tenant (id, name, status) VALUES ($1, 'Paths', 'active')`, [TENANT]);
  await q(
    driver,
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
     VALUES ($1, $2, 'source', 'imap', 'src', '{}'::jsonb, 'connected')`,
    [CONNECTION, TENANT],
  );
  let n = 40;
  for (const m of Object.values(MIGRATIONS)) {
    const [from, to] = [id(n++), id(n++)];
    for (const box of [from, to]) {
      await q(
        driver,
        `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, primary_address)
         VALUES ($1, $2, $3, $4, 'user', $4)`,
        [box, TENANT, CONNECTION, `${box}@example.invalid`],
      );
    }
    await q(
      driver,
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'mirror', $5, $6, $7)`,
      [m.id, TENANT, from, to, m.status, CREATED, LAST_CHANGE],
    );
    await q(
      driver,
      `INSERT INTO scope_selection (tenant_id, mapping_id, domain, included)
       VALUES ($1, $2, 'email', true), ($1, $2, 'calendar', true), ($1, $2, 'contact', false)`,
      [TENANT, m.id],
    );
    if (m.ran) {
      await q(
        driver,
        `INSERT INTO run (tenant_id, mapping_id, kind, trigger, status, started_at)
         VALUES ($1, $2, 'incremental', 'schedule', 'succeeded', $3),
                ($1, $2, 'incremental', 'schedule', 'succeeded', $3::timestamptz + interval '1 day')`,
        [TENANT, m.id, FIRST_PASS],
      );
    }
  }
  // Written by a door before this slice: left exactly as it is.
  await q(
    driver,
    `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at)
     VALUES ($1, $2, 'email', 'paused', $3)`,
    [TENANT, MIGRATIONS.alreadyHadRows.id, OLD_ROW],
  );
}

/** Every path row, without the moment it was written. */
async function rows(driver: LedgerDriver) {
  const all = await q(
    driver,
    `SELECT mapping_id, domain, state, first_activated_at, ended_at
       FROM path_lifecycle ORDER BY mapping_id, domain`,
  );
  return all.map((r) => ({
    mapping: Object.entries(MIGRATIONS).find(([, m]) => m.id === r.mapping_id)![0],
    domain: r.domain,
    state: r.state,
    first: r.first_activated_at ? new Date(r.first_activated_at as string).toISOString() : null,
    ended: r.ended_at ? new Date(r.ended_at as string).toISOString() : null,
  }));
}

const BOTH = (mapping: string, state: string, first: string, ended: string | null = null) =>
  ['calendar', 'email'].map((domain) => ({ mapping, domain, state, first, ended }));

/** What the rule writes for the fixtures above. */
const EXPECTED = [
  ...BOTH('pausedThatRan', 'paused', FIRST_PASS),
  ...BOTH('runningNoPassYet', 'active', CREATED),
  ...BOTH('cutOver', 'cutover', FIRST_PASS, LAST_CHANGE),
  ...BOTH('finished', 'done', FIRST_PASS, LAST_CHANGE),
  ...BOTH('inTheLane', 'continuous', FIRST_PASS),
  { mapping: 'alreadyHadRows', domain: 'calendar', state: 'active', first: FIRST_PASS, ended: null },
  { mapping: 'alreadyHadRows', domain: 'email', state: 'paused', first: OLD_ROW, ended: null },
];

const order = (a: { mapping: string; domain: unknown }, b: { mapping: string; domain: unknown }) =>
  `${a.mapping}/${a.domain}`.localeCompare(`${b.mapping}/${b.domain}`);

describe('ledger migration 0065', () => {
  let driver: LedgerDriver;
  beforeAll(async () => {
    driver = (await createPgliteDb({})).driver;
    drivers.push(driver);
    await runMigrations({ driver, migrationsDir: theChainBeforeThisSlice(), logger: () => {} });
    await fill(driver);
    const { applied } = await runMigrations({ driver, logger: () => {} });
    expect(applied.some((v) => v.startsWith('0065'))).toBe(true);
  }, 120_000);

  it('gives every started migration its path rows from its own status, and no draft any', async () => {
    expect((await rows(driver)).sort(order)).toEqual([...EXPECTED].sort(order));
  });
});

describe('pathsFromTheMapping, the same rule for one migration', () => {
  let driver: LedgerDriver;
  beforeAll(async () => {
    driver = (await createPgliteDb({})).driver;
    drivers.push(driver);
    await runMigrations({ driver, logger: () => {} });
    await fill(driver);
  }, 120_000);

  it('writes what 0065 writes, and answers the data types it gave a row', async () => {
    const written: Record<string, readonly string[]> = {};
    for (const [name, m] of Object.entries(MIGRATIONS)) {
      written[name] = await withTenant(driver, TENANT, (db) => pathsFromTheMapping(db, TENANT, m.id));
    }
    expect((await rows(driver)).sort(order)).toEqual([...EXPECTED].sort(order));
    expect(written).toEqual({
      draft: [],
      pausedThatRan: ['calendar', 'email'],
      runningNoPassYet: ['calendar', 'email'],
      cutOver: ['calendar', 'email'],
      finished: ['calendar', 'email'],
      inTheLane: ['calendar', 'email'],
      alreadyHadRows: ['calendar'],
    });
  });

  it('writes nothing the second time', async () => {
    const again = await withTenant(driver, TENANT, (db) =>
      pathsFromTheMapping(db, TENANT, MIGRATIONS.inTheLane.id),
    );
    expect(again).toEqual([]);
  });
});

describe('recordScope', () => {
  let driver: LedgerDriver;
  beforeAll(async () => {
    driver = (await createPgliteDb({})).driver;
    drivers.push(driver);
    await runMigrations({ driver, logger: () => {} });
    await fill(driver);
  }, 120_000);

  const scope = async () =>
    q(driver, `SELECT domain, included FROM scope_selection WHERE mapping_id = $1 ORDER BY domain`, [
      MIGRATIONS.draft.id,
    ]);

  it('adds the data types a configuration names, and follows it when one is switched on or off', async () => {
    await withTenant(driver, TENANT, (db) =>
      recordScope(db, TENANT, MIGRATIONS.draft.id, [
        { domain: 'email', included: true },
        { domain: 'calendar', included: false },
        { domain: 'contact', included: true },
        { domain: 'task', included: true },
      ]),
    );
    expect(await scope()).toEqual([
      { domain: 'calendar', included: false },
      { domain: 'contact', included: true },
      { domain: 'email', included: true },
      { domain: 'task', included: true },
    ]);
  });
});
