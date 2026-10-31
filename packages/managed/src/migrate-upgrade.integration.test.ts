// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The managed chain's upgrade proof on Postgres 18 (workplan 0146 T4, the
 * Postgres leg).
 *
 * `migrate-upgrade.unit.test.ts` proves, on PGlite, that a database a managed
 * release left behind upgrades to this build and then cannot be told apart
 * from a fresh install. The managed edition does not run PGlite: `ownpace-live`
 * and the OTA stack run Postgres 18, and PGlite carries its own engine version
 * inside an npm package. A catalogue can differ between the two (a default's
 * text, a constraint's definition, a function's body as the server prints it),
 * and so can what a migration does. So the same proof runs here, against the
 * server the integration suite starts (Testcontainers pins its version), from
 * the same starting points: the managed chain's oldest supported release and
 * the newest, as `scripts/release-line.json` names them, or the one
 * `UPGRADE_FROM_REF` names.
 *
 * Each release gets two throwaway databases on that server, created and
 * dropped here: one the release's own migrators build and this build's then
 * upgrade, one a fresh install of this build. Roles are the server's, not a
 * database's, so the `roles` line of the catalogue reads the same on both and
 * proves nothing here; the unit leg, with one PGlite per database, is where
 * roles are compared.
 *
 * What is not repeated: the file-by-file comparison of what the release
 * applied, and the comment reader's own cases. Both read git, not a database,
 * and the unit leg runs them on every pull request.
 *
 * Needs the release's tag: the integration job checks out with
 * `fetch-depth: 0` for it, and under `CI` a tag it cannot reach is a failure.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { pgDriver, runMigrations, type LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from './migrate-managed.ts';
import {
  CATALOGUE,
  CHAINS,
  REPO_ROOT,
  SHARED_BOOKKEEPING,
  bookkeeping,
  catalogue,
  headFilenames,
  loadReleaseMigrators,
  materialiseRelease,
  quiet,
  refExists,
  refFilenames,
  versionsOf,
  type Chain,
  type ReleaseMigrators,
} from './__tests__/upgrade-from-a-release.ts';
import { readReleaseLine, rootVersion, startingPoints } from '../../ledger/src/__tests__/release-line.ts';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
if (!ADMIN_URL) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
}, 120_000);

/** A throwaway database on the suite's server: its pool, its driver, and its removal. */
interface Throwaway {
  driver: LedgerDriver;
  drop(): Promise<void>;
}

async function throwawayDatabase(label: string): Promise<Throwaway> {
  const name = `upgrade_${label}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = new Pool({ connectionString: ADMIN_URL });
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  const url = new URL(ADMIN_URL!);
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.toString() });
  return {
    driver: pgDriver(pool),
    async drop() {
      await pool.end();
      const cleanup = new Pool({ connectionString: ADMIN_URL });
      try {
        await cleanup.query(
          'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
          [name],
        );
        await cleanup.query(`DROP DATABASE IF EXISTS ${name}`);
      } finally {
        await cleanup.end();
      }
    },
  };
}

const FROM_REFS = startingPoints(readReleaseLine(REPO_ROOT), 'managed', {
  fromRef: process.env.UPGRADE_FROM_REF,
  version: rootVersion(REPO_ROOT),
  isTagged: refExists,
});

function upgradeOnPostgresFrom(FROM_REF: string): void {
  const HAVE_REF = refExists(FROM_REF);

  describe(`upgrading a managed database from ${FROM_REF} on Postgres (0146 T4)`, () => {
    let release: ReleaseMigrators;
    let upgraded: Throwaway | undefined;
    let fresh: Throwaway | undefined;
    const fromRef = {} as Record<Chain, string[]>;
    const added = {} as Record<Chain, string[]>;

    beforeAll(async () => {
      if (!HAVE_REF) return;
      for (const chain of CHAINS) {
        fromRef[chain] = refFilenames(FROM_REF, chain);
        added[chain] = headFilenames(chain).filter((f) => !fromRef[chain].includes(f));
      }
      release = await loadReleaseMigrators(FROM_REF, materialiseRelease(FROM_REF, tempDir));
      upgraded = await throwawayDatabase('upgraded');
      fresh = await throwawayDatabase('fresh');
    }, 180_000);

    afterAll(async () => {
      await upgraded?.drop();
      await fresh?.drop();
    }, 60_000);

    it('can actually reach the release it upgrades from', () => {
      if (!HAVE_REF && process.env.CI) {
        throw new Error(
          `${FROM_REF} is not reachable, so the managed upgrade cannot be proved on Postgres. ` +
            'The integration job checks out with fetch-depth: 0 for it.',
        );
      }
      if (!HAVE_REF) console.warn(`[managed-upgrade/postgres] ${FROM_REF} not reachable locally — skipped.`);
      expect(true).toBe(true);
    });

    it.skipIf(!HAVE_REF)(
      "applies the release's chains with its own migrators, then only what this build added",
      { timeout: 180_000 },
      async () => {
        const db = upgraded!.driver;
        expect((await release.runShared(db)).applied).toEqual(fromRef.shared);
        expect((await release.runManaged(db)).applied).toEqual(fromRef.managed);

        const shared = await runMigrations({ driver: db, logger: quiet });
        const managed = await runManagedMigrations({ driver: db, logger: quiet });
        expect(shared.applied).toEqual(added.shared);
        expect(managed.applied).toEqual(added.managed);
        console.info(
          `[managed-upgrade/postgres] ${FROM_REF} -> this build: shared ${fromRef.shared.length} + ` +
            `${added.shared.length}, managed ${fromRef.managed.length} + ${added.managed.length}.`,
        );
      },
    );

    it.skipIf(!HAVE_REF)(
      'lands on the schema a fresh install of this build has, on Postgres',
      { timeout: 180_000 },
      async () => {
        await runMigrations({ driver: fresh!.driver, logger: quiet });
        await runManagedMigrations({ driver: fresh!.driver, logger: quiet });

        const up = await catalogue(upgraded!.driver);
        const at = await catalogue(fresh!.driver);
        expect(at.relations!.length, 'the fresh install has no tables: the catalogue read nothing').toBeGreaterThan(40);
        expect(at.policies!.length, 'the fresh install has no policies: the catalogue read nothing').toBeGreaterThan(40);
        for (const kind of Object.keys(CATALOGUE)) {
          const upSet = new Set(up[kind]);
          const atSet = new Set(at[kind]);
          expect(
            {
              missing: at[kind]!.filter((line) => !upSet.has(line)),
              extra: up[kind]!.filter((line) => !atSet.has(line)),
            },
            `${kind}: on Postgres, a database upgraded from ${FROM_REF} differs from a fresh install`,
          ).toEqual({ missing: [], extra: [] });
        }
        for (const table of [SHARED_BOOKKEEPING, release.managedBookkeeping]) {
          expect(versionsOf(await bookkeeping(upgraded!.driver, table))).toEqual(
            versionsOf(await bookkeeping(fresh!.driver, table)),
          );
        }
      },
    );

    it.skipIf(!HAVE_REF)('applies nothing on a further run of either chain', { timeout: 60_000 }, async () => {
      expect((await runMigrations({ driver: upgraded!.driver, logger: quiet })).applied).toEqual([]);
      expect((await runManagedMigrations({ driver: upgraded!.driver, logger: quiet })).applied).toEqual([]);
    });

    it.skipIf(!HAVE_REF)(
      "the release's own migrators refuse the upgraded database wherever a chain moved on",
      { timeout: 60_000 },
      async () => {
        const run = { shared: release.runShared, managed: release.runManaged };
        for (const chain of CHAINS) {
          if (added[chain].length > 0) {
            await expect(run[chain](upgraded!.driver), `${FROM_REF}'s ${chain} migrator`).rejects.toThrow(
              /newer than this build understands/,
            );
          } else {
            expect((await run[chain](upgraded!.driver)).applied).toEqual([]);
          }
        }
      },
    );
  });
}

for (const FROM_REF of FROM_REFS) upgradeOnPostgresFrom(FROM_REF);
