// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Two migration chains over one database (ADR-0036).
 *
 * The appliance applies the shared chain. A managed deployment applies both.
 * That is the entire mechanism by which an appliance ends up without an
 * `invoice` table, so it is worth asking a database rather than reading the
 * code and believing it.
 *
 * ## Why the chains need separate bookkeeping, corrected by this test
 *
 * I wrote first that a shared `schema_migrations` would make the APPLIANCE
 * refuse to boot: it would read the managed chain's versions, find them higher
 * than anything it ships, and trip `runMigrations`' downgrade guard. Writing
 * the test found that is not what happens — the managed chain's one file is
 * `0001_the_managed_service.sql`, which sorts BELOW `0027_...`, so it is the
 * MANAGED chain that refuses, immediately, the first time it runs.
 *
 * The correct statement is the more uncomfortable one. **The two chains'
 * versions were never ordered against each other**, so a shared ledger has the
 * guard comparing numbers that mean nothing in common — and which side breaks
 * is an accident of how somebody named a file. Today it is the managed chain,
 * loudly, at the moment of the mistake. Name that file `0100_` instead and it
 * is the appliance, at boot, on a machine that never downgraded anything.
 *
 * A guard that fires on the wrong deployment for the wrong reason is worse than
 * one that fires here, which is why the last case pins the behaviour rather
 * than describing it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createPgliteDb,
  runMigrations,
  type LedgerDriver,
  type LedgerConnection,
} from '@openmig/ledger';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Temp directories this file makes, and the removal that used to be missing.
 *
 * See the sweep in workplan 0099: `mkdtempSync` with no matching `rmSync`
 * leaks for the lifetime of the machine, a PGlite data directory is 41MB, and
 * the suite was measured leaking 322MB per run after quietly accumulating
 * 29GB and filling the disk of the box running it. `unit-tests` runs on the
 * SELF-HOSTED runner for pushes to main — the same Spark the managed stack
 * needs ~15GB free on.
 *
 * Registered rather than removed at each call site, so a new test here cannot
 * forget.
 */
const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

import {
  runManagedMigrations,
  managedMigrationsDir,
  MANAGED_BOOKKEEPING_TABLE,
} from './migrate-managed.ts';

// packages/managed/src -> repo root
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RELEASED_REF = process.env.UPGRADE_FROM_REF || 'v0.1.0-rc.1';
const MIGRATIONS_PATH = 'packages/ledger/migrations';

const git = (...args: string[]): string =>
  execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });

/**
 * Make sure `RELEASED_REF` is actually resolvable, and say so plainly if not.
 *
 * THE FAILURE THIS REPLACES, found 2026-08-19. A shallow clone has no tags —
 * `actions/checkout` and every Claude Code web session get one — so `git
 * ls-tree` died with `fatal: Not a valid object name v0.1.0-rc.1` and took the
 * whole suite's 12 cases with it. The message named the tag but not the reason
 * or the fix, so the honest reading of a local `pnpm test` became "290 passed,
 * 1 failed, and the failure is environmental" — which is a sentence nobody
 * should have to write twice about the same test.
 *
 * It fetches the ref rather than skipping. **A skip would be the worse bug**:
 * this is the UPGRADE case — a database that predates the chain split, the one
 * that broke the nightly — and a test that quietly does not run is exactly the
 * shape this repository keeps having to dig out of a green. So: try to get it,
 * and if that cannot be done, fail with the command that fixes it.
 */
function ensureReleasedRef(): void {
  const resolvable = (): boolean => {
    try {
      git('rev-parse', '-q', '--verify', `${RELEASED_REF}^{commit}`);
      return true;
    } catch {
      return false;
    }
  };
  if (resolvable()) return;

  // A tag first, because that is what the default ref is and the fetch is
  // cheap; then the general form, so an overridden UPGRADE_FROM_REF pointing at
  // a branch or a sha is not left out.
  for (const args of [
    ['fetch', '--depth=1', 'origin', 'tag', RELEASED_REF],
    ['fetch', '--depth=1', 'origin', RELEASED_REF],
  ]) {
    try {
      git(...args);
      if (resolvable()) return;
    } catch {
      // Offline, or the ref is not a tag. Try the next form, then give up
      // loudly below — never silently.
    }
  }

  throw new Error(
    `Cannot resolve ${RELEASED_REF}, so the pre-split schema cannot be materialised.\n` +
      'This clone has no such ref — a shallow clone carries no tags, which is what\n' +
      'CI checkouts and Claude Code web sessions get. Fetching it is enough:\n' +
      `  git fetch --depth=1 origin tag ${RELEASED_REF}\n` +
      'Set UPGRADE_FROM_REF to test the upgrade from a different released ref.',
  );
}

/** The released shared chain, written out so the real loader reads it. */
function materialiseReleasedMigrations(): string {
  ensureReleasedRef();
  const dir = join(tempDir('ownpace-presplit-'), 'migrations');
  mkdirSync(dir, { recursive: true });
  const names = git('ls-tree', '--name-only', RELEASED_REF, `${MIGRATIONS_PATH}/`)
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => p.endsWith('.sql'))
    .map((p) => p.slice(MIGRATIONS_PATH.length + 1));
  for (const name of names) {
    writeFileSync(join(dir, name), git('show', `${RELEASED_REF}:${MIGRATIONS_PATH}/${name}`));
  }
  return dir;
}

/** Everything the managed chain creates, and nothing else does. */
const MANAGED_TABLES = [
  'invoice',
  'payment_method',
  'usage_metric',
  'tenant_member',
  'erasure_record',
  'tenant_pricing',
  'tenant_closure',
  'access_request',
];

async function tablesIn(conn: LedgerConnection): Promise<Set<string>> {
  const { rows } = await conn.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  return new Set(rows.map((r) => r.table_name));
}

describe('the appliance applies one chain and gets one schema', () => {
  let driver: LedgerDriver;
  let conn: LedgerConnection;

  beforeAll(async () => {
    const made = await createPgliteDb({});
    driver = made.driver;
    await runMigrations({ driver, logger: () => {} });
    conn = await driver.acquire();
  }, 120_000);

  afterAll(async () => {
    await driver?.end();
  });

  it('builds a real schema, so the absences below are not an empty database', async () => {
    // Every "table X is not here" assertion is true of a database where nothing
    // ran at all.
    const tables = await tablesIn(conn);
    for (const table of ['tenant', 'connection', 'item', 'run']) {
      expect(tables.has(table), `${table} is missing — the shared chain did not apply`).toBe(true);
    }
    expect(tables.size).toBeGreaterThan(20);
  }, 30_000);

  it('has NONE of the managed tables', async () => {
    const tables = await tablesIn(conn);
    const present = MANAGED_TABLES.filter((t) => tables.has(t));
    expect(
      present,
      'the shared chain creates a managed-only table, so every appliance would ' +
        'have it — move the DDL to packages/managed/migrations (ADR-0036):\n' +
        present.map((t) => `  - ${t}`).join('\n'),
    ).toEqual([]);
  }, 30_000);

  it('has no managed column left on tenant', async () => {
    const { rows } = await conn.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tenant'`,
    );
    const columns = rows.map((r) => r.column_name);
    expect(columns.length).toBeGreaterThan(3);
    for (const gone of ['pricing', 'closed_at', 'purge_after', 'closed_by']) {
      expect(columns, `tenant.${gone} is back on the shared chain`).not.toContain(gone);
    }
  }, 30_000);

  it('still allows the closed status, which deliberately did not move', async () => {
    // A CHECK constraint is a statement about what is ALLOWED, and an
    // allowed-but-unused value costs an appliance nothing. Moving it would mean
    // the managed chain rewriting a constraint the shared chain owns.
    await conn.query(
      `INSERT INTO tenant (id, name, status) VALUES (gen_random_uuid(), 'x', 'closed')`,
    );
  }, 30_000);
});

describe('a managed deployment applies both chains', () => {
  let driver: LedgerDriver;
  let conn: LedgerConnection;

  beforeAll(async () => {
    const made = await createPgliteDb({});
    driver = made.driver;
    await runMigrations({ driver, logger: () => {} });
    await runManagedMigrations({ driver, logger: () => {} });
    conn = await driver.acquire();
  }, 120_000);

  afterAll(async () => {
    await driver?.end();
  });

  it('gets every managed table', async () => {
    const tables = await tablesIn(conn);
    expect(MANAGED_TABLES.filter((t) => !tables.has(t))).toEqual([]);
  }, 30_000);

  it('keeps the two chains in separate ledgers, with nothing recorded twice', async () => {
    const shared = await conn.query<{ version: string }>('SELECT version FROM schema_migrations');
    const managed = await conn.query<{ version: string }>(
      `SELECT version FROM ${MANAGED_BOOKKEEPING_TABLE}`,
    );
    expect(shared.rows.length).toBeGreaterThan(5);
    expect(managed.rows.length).toBeGreaterThan(0);

    // A version in both would mean one chain applied the other's file.
    const sharedVersions = new Set(shared.rows.map((r) => r.version));
    expect(managed.rows.map((r) => r.version).filter((v) => sharedVersions.has(v))).toEqual([]);
  }, 30_000);

});

describe('re-running either chain is a no-op', () => {
  // Its own driver, and no connection held open across the calls: PGlite is a
  // single backend, so a test that holds `driver.acquire()` while
  // `runMigrations` tries to take one deadlocks on the pool rather than on
  // anything this file is about. Found by writing it the other way first.
  it('applies nothing the second time, including from an appliance-shaped call', async () => {
    const made = await createPgliteDb({});
    try {
      await runMigrations({ driver: made.driver, logger: () => {} });
      await runManagedMigrations({ driver: made.driver, logger: () => {} });

      expect((await runMigrations({ driver: made.driver, logger: () => {} })).applied).toEqual([]);
      expect(
        (await runManagedMigrations({ driver: made.driver, logger: () => {} })).applied,
      ).toEqual([]);
      // The appliance shape: a build shipping only the shared chain re-reads a
      // database a managed deployment has migrated, and must not trip the
      // downgrade guard on versions belonging to a chain it does not have.
      expect((await runMigrations({ driver: made.driver, logger: () => {} })).applied).toEqual([]);
    } finally {
      await made.driver.end();
    }
  }, 120_000);
});

describe('one ledger for two chains breaks the downgrade guard', () => {
  it('refuses — and the side that breaks is an accident of the filename', async () => {
    // The mutation, run as a test rather than left as a comment: apply the
    // managed chain into the SHARED chain's bookkeeping table.
    //
    // It throws on the MANAGED call, because `0001_the_managed_service.sql`
    // sorts below the shared chain's `0027_...` already recorded there. Rename
    // that file `0100_` and this passes while the APPLIANCE starts refusing
    // instead — same defect, different victim. Neither is acceptable, and the
    // fix for both is that the versions of two chains are never compared.
    const made = await createPgliteDb({});
    try {
      await runMigrations({ driver: made.driver, logger: () => {} });

      await expect(
        runMigrations({
          driver: made.driver,
          migrationsDir: managedMigrationsDir(),
          logger: () => {},
        }),
      ).rejects.toThrow(/newer than this build understands/);
    } finally {
      await made.driver.end();
    }
  }, 120_000);
});

describe('the managed chain adopts a database that predates the split', () => {
  // E2E (managed) run #16, verbatim:
  //
  //   [migrate] schema up to date at 0027_the_target_handle_was_a_string_of_itself.sql
  //   [migrate] applying 0001_the_managed_service.sql
  //   Seed failed: Migration 0001_the_managed_service.sql failed:
  //     relation "invoice" already exists
  //
  // The Spark's database was built by the OLD shared baseline, which created
  // these four tables. The managed chain's bookkeeping table is empty there —
  // it is a new chain — so its first run tried to create them again.
  //
  // This is the NORMAL condition for every managed deployment older than the
  // split, and nothing drops the old copies (doing so on the shared chain
  // would destroy invoices we are required to keep). So the chain has to
  // converge onto a database that already looks like its own output.
  //
  // The fixture is built from the REAL released baseline out of git rather
  // than from hand-written CREATE TABLEs: the whole failure was a mismatch
  // between what an old database actually holds and what this file assumes,
  // and a fixture written from the same assumption would reproduce nothing.
  let driver: LedgerDriver;

  beforeAll(async () => {
    const made = await createPgliteDb({});
    driver = made.driver;

    // 1. The released shared chain — its 0001_baseline.sql still creates
    //    invoice, payment_method, usage_metric and tenant_member.
    const released = materialiseReleasedMigrations();
    await runMigrations({ driver, migrationsDir: released, logger: () => {} });

    // 2. The columns that pre-split migrations 0007 and 0025 added to `tenant`.
    //    Added by hand because those files no longer exist in the tree — the
    //    split moved their content — so there is nothing left to replay. This
    //    is the one part of the fixture that is a reconstruction, and it is
    //    narrow: two column sets, exactly as those migrations declared them.
    let conn = await driver.acquire();
    try {
      await conn.query(`ALTER TABLE public.tenant
        ADD COLUMN IF NOT EXISTS pricing jsonb,
        ADD COLUMN IF NOT EXISTS closed_at timestamptz,
        ADD COLUMN IF NOT EXISTS purge_after timestamptz,
        ADD COLUMN IF NOT EXISTS closed_by text`);
    } finally {
      conn.release();
    }

    // 3. Today's SHARED chain. It skips 0001 (already recorded under the same
    //    filename) and applies 0002 onward.
    await runMigrations({ driver, logger: () => {} });

    // 4. The rows, written between the two chains rather than before both:
    //    `status = 'closed'` is only an allowed value from 0025 onward, and
    //    the released baseline predates it. Their position relative to the
    //    shared chain is not what is under test — their existence before the
    //    MANAGED chain runs is.
    conn = await driver.acquire();
    try {
      await conn.query(`INSERT INTO public.tenant (id, name, status, pricing)
        VALUES ('11111111-1111-4111-8111-111111111111', 'agreed at 1500',
                'active', '{"baseFee":1500}'::jsonb)`);
      await conn.query(`INSERT INTO public.tenant
          (id, name, status, closed_at, purge_after, closed_by)
        VALUES ('22222222-2222-4222-8222-222222222222', 'closing', 'closed',
                now(), now() + interval '30 days', 'owner@example.com')`);
    } finally {
      conn.release();
    }

    // 5. And the managed chain, which is the thing that failed on the Spark.
    await runManagedMigrations({ driver, logger: () => {} });
  }, 180_000);

  afterAll(async () => {
    await driver?.end();
  });

  it('applies at all — this is the case that broke the nightly', async () => {
    // Reaching here means the four CREATE TABLEs, twelve constraints, nine
    // indexes and twenty-four policies all landed on objects that already
    // existed. beforeAll would have thrown otherwise.
    const conn = await driver.acquire();
    try {
      const { rows } = await conn.query<{ version: string }>(
        `SELECT version FROM ${MANAGED_BOOKKEEPING_TABLE}`,
      );
      expect(rows.map((r) => r.version)).toContain('0001_the_managed_service.sql');
    } finally {
      conn.release();
    }
  }, 60_000);

  it('carries each tenant\'s AGREED prices into tenant_pricing', async () => {
    // The quiet one. An empty tenant_pricing beside a populated tenant.pricing
    // reads as "nobody agreed anything", and the next billing touch pins every
    // existing customer to TODAY'S template — re-pricing people already being
    // billed, through the door migration 0007 was written to close.
    const conn = await driver.acquire();
    try {
      const { rows } = await conn.query<{ pricing: unknown }>(
        `SELECT pricing FROM public.tenant_pricing
          WHERE tenant_id = '11111111-1111-4111-8111-111111111111'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.pricing).toMatchObject({ baseFee: 1500 });
    } finally {
      conn.release();
    }
  }, 60_000);

  it('carries a closed tenant\'s dates into tenant_closure', async () => {
    // The other direction of the same risk: a closed tenant whose dates did
    // not follow reads as active, the purge job joins tenant_closure and finds
    // nothing, and an erasure somebody was promised silently never runs.
    const conn = await driver.acquire();
    try {
      const { rows } = await conn.query<{ closed_by: string }>(
        `SELECT closed_by FROM public.tenant_closure
          WHERE tenant_id = '22222222-2222-4222-8222-222222222222'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.closed_by).toBe('owner@example.com');
    } finally {
      conn.release();
    }
  }, 60_000);

  it('re-running the managed chain is still a no-op', async () => {
    const again = await runManagedMigrations({ driver, logger: () => {} });
    expect(again.applied).toEqual([]);
  }, 60_000);
});
