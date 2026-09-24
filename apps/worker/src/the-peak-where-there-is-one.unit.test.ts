// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A ROLLBACK'S SLOTS ARE IN THE MONTH'S PEAK (workplan 0109 T2).
 *
 * The cutover CLI and the `run-rollback` job put a migration back to `active`
 * through the ledger's own door, and hand it `raiseThePeakWhereThereIsOne` for
 * the slots that takes. On a managed database the month's mark rises with
 * them; on a self-hosted one, which has no such table, nothing is written and
 * the managed package is not even loaded.
 *
 * On PGlite: once with both migration chains, once with the ledger's only.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createPgliteDb, runMigrations, mappingLifecyclePort, type LedgerDriver } from '@openmig/ledger';
import type { TenantId } from '@openmig/shared';
import { raiseThePeakWhereThereIsOne } from './the-peak-where-there-is-one.ts';

// Counts every time the managed package is loaded through its mock, which is
// how the helper loads it. The managed database's own setup loads the real
// one directly, and is not counted.
const loaded = vi.hoisted(() => ({ count: 0 }));
vi.mock('@openmig/managed', async (importOriginal) => {
  loaded.count += 1;
  return importOriginal();
});

// UUID family 0109d000-…, unused elsewhere in the repo.
const TENANT = '0109d000-e29b-41d4-a716-446655440001' as TenantId;
const CONNECTION = '0109d000-e29b-41d4-a716-446655440002';
const SOURCE = '0109d000-e29b-41d4-a716-446655440003';
const TARGET = '0109d000-e29b-41d4-a716-446655440004';
const MAPPING = '0109d000-e29b-41d4-a716-446655440005';

/** A database holding one migration just cut over, with two paths that released their slots. */
async function aDatabase(managed: boolean): Promise<LedgerDriver> {
  const driver = (await createPgliteDb({})).driver;
  await runMigrations({ driver, logger: () => {} });
  if (managed) {
    const real = await vi.importActual<typeof import('@openmig/managed')>('@openmig/managed');
    await real.runManagedMigrations({ driver, logger: () => {} });
  }
  const q = (text: string, params: unknown[] = []) => one(driver, text, params);
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
  await q(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
     VALUES ($1, $2, $3, $4, 'mirror', 'cutover')`,
    [MAPPING, TENANT, SOURCE, TARGET],
  );
  await q(
    `INSERT INTO scope_selection (tenant_id, mapping_id, domain, included)
     VALUES ($1, $2, 'email', true), ($1, $2, 'calendar', true)`,
    [TENANT, MAPPING],
  );
  await q(
    `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at, ended_at)
     VALUES ($1, $2, 'email', 'cutover', now(), now()), ($1, $2, 'calendar', 'cutover', now(), now())`,
    [TENANT, MAPPING],
  );
  return driver;
}

/** One statement, on a connection taken and given back (PGlite has one). */
async function one(driver: LedgerDriver, text: string, params: unknown[] = []) {
  const conn = await driver.acquire();
  try {
    return (await conn.query(text, params)).rows as Array<Record<string, unknown>>;
  } finally {
    conn.release();
  }
}

/** The rollback, as the CLI presses it. */
const rollBack = (driver: LedgerDriver) =>
  mappingLifecyclePort(driver, TENANT, MAPPING, 'cli', {
    onSlotsTaken: raiseThePeakWhereThereIsOne(TENANT),
  }).setStatus({ from: 'cutover', to: 'active', via: 'rollback' });

const drivers: LedgerDriver[] = [];
afterAll(async () => {
  for (const d of drivers) await d.end();
});

describe('on a self-hosted database', () => {
  let driver: LedgerDriver;
  beforeAll(async () => {
    driver = await aDatabase(false);
    drivers.push(driver);
  }, 120_000);

  it('rolls back, writes no peak, and never loads the managed package', async () => {
    await rollBack(driver);
    expect(
      (await one(driver, 'SELECT state FROM path_lifecycle WHERE mapping_id = $1', [MAPPING])).map((r) => r.state),
    ).toEqual(['active', 'active']);
    expect((await one(driver, `SELECT to_regclass('public.occupancy_peak') AS t`))[0]!.t).toBeNull();
    expect(loaded.count).toBe(0);
  });
});

describe('on a managed database', () => {
  let driver: LedgerDriver;
  beforeAll(async () => {
    driver = await aDatabase(true);
    drivers.push(driver);
  }, 120_000);

  it("raises this month's peak with the slots the rollback took back", async () => {
    expect(await one(driver, 'SELECT * FROM occupancy_peak')).toEqual([]);
    await rollBack(driver);
    const peaks = await one(driver, 'SELECT tenant_id, peak_paths FROM occupancy_peak');
    expect(peaks).toEqual([{ tenant_id: TENANT, peak_paths: 2 }]);
    expect(loaded.count).toBe(1);
  });
});

describe('every caller of the ledger door hands it the peak', () => {
  // The door takes slots on a rollback. A caller that leaves `onSlotsTaken`
  // out puts them in no month's peak, which is how the CLI and the rollback
  // job were until 2026-09-24.
  const ROOT = join(import.meta.dirname, '..', '..', '..');
  const DOORS = /\b(mappingLifecyclePort|applyMappingStatusChange)\(/;

  function sources(dir: string, out: string[]): string[] {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) sources(full, out);
      else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(full);
    }
    return out;
  }

  it('in every file that calls it, outside the ledger and the tests', () => {
    const callers = [...sources(join(ROOT, 'apps'), []), ...sources(join(ROOT, 'packages'), [])]
      .filter((f) => !f.includes(join('packages', 'ledger')))
      .filter((f) => !f.includes(join('packages', 'core')))
      .map((f) => ({ file: relative(ROOT, f), text: readFileSync(f, 'utf8') }))
      .filter(({ text }) =>
        text.split('\n').some((line) => DOORS.test(line) && !/^\s*(\*|\/\/|import)/.test(line)),
      );
    expect(callers.map((c) => c.file).sort()).toEqual([
      'apps/selfhost/src/index.ts',
      'apps/worker/src/cli/index.ts',
      'apps/worker/src/jobs/run-rollback.ts',
    ]);
    for (const { file, text } of callers) {
      if (file === 'apps/selfhost/src/index.ts') continue; // Below: it has no peak.
      expect(text, `${file} calls the ledger door without the peak`).toMatch(
        /mappingLifecyclePort\(pool, tenantId, mappingId, '[a-z-]+', \{\s*onSlotsTaken: raiseThePeakWhereThereIsOne\(/,
      );
    }
  });

  it("but the appliance's, whose database keeps no peak and which cannot load the managed package", () => {
    // Its Start and Finish go through the door since 0128 T5, slice 2a. It runs
    // only the ledger's chain, and `occupancy_peak` is the managed chain's.
    const manifest = JSON.parse(readFileSync(join(ROOT, 'apps', 'selfhost', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies ?? {})).not.toContain('@openmig/managed');
    const ledgerChain = readdirSync(join(ROOT, 'packages', 'ledger', 'migrations'))
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(join(ROOT, 'packages', 'ledger', 'migrations', f), 'utf8'));
    expect(ledgerChain.some((text) => /CREATE TABLE[^;]*occupancy_peak/i.test(text))).toBe(false);
    const appliance = readFileSync(join(ROOT, 'apps', 'selfhost', 'src', 'index.ts'), 'utf8');
    expect(appliance).not.toMatch(/onSlotsTaken:/);
  });
});
