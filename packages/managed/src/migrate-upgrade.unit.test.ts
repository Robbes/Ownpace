// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The managed chain's upgrade proof: a release's database, upgraded to this
 * build, on both chains (workplan 0146 T4, the alpha leg).
 *
 * `packages/ledger/src/migrate-upgrade.unit.test.ts` proves the SHARED chain
 * upgrades. Nothing proved the managed one did, and from `v0.2.0-alpha.1` on
 * that is the chain that moves: alpha.1 carries 46 managed migrations and
 * this build more, while the shared chain is byte for byte what alpha.1
 * shipped. So the shared gate, and the appliance's container drill, both
 * exercise no migration from alpha.1. `ownpace-live` is a managed stack, and
 * its first upgrade runs on testers' data.
 *
 * `two-chains.unit.test.ts` is NOT this. It builds a database from rc.1's
 * shared chain, which predates the managed chain, and proves the managed chain
 * ADOPTS it. Nothing in it starts from a database a managed release left
 * behind.
 *
 * WHAT IT DOES. Reads both chains out of the release (`git show <ref>:...`),
 * and the two migrators the release shipped (`migrate.ts`, `migrate-managed.ts`),
 * into a temp tree laid out like the repository. Applies them to an empty
 * database the way the API at that release did: the shared chain, then the
 * managed chain, each with its own bookkeeping table, by the release's own
 * code. Then applies this build's two chains with this build's migrators, and
 * asserts:
 *
 *   1. no file of either chain at the release is gone, and every new file
 *      sorts after the last one the release applied;
 *   2. exactly the files added since the release apply (names, count, order),
 *      and nothing the release applied is applied again or re-recorded;
 *   3. every file the release applied is still the SQL this build ships;
 *   4. the upgraded database is INDISTINGUISHABLE from a fresh install at this
 *      build: tables, columns (their order and collation too), indexes,
 *      constraints, row security and its policies, triggers, functions, views,
 *      grants, roles and comments;
 *   5. a further run of either chain applies nothing;
 *   6. the release's own migrators refuse the upgraded database wherever a
 *      chain moved on.
 *
 * **Assertion 3 is the migrator's documented behaviour, checked.** `migrate.ts`
 * records a file's NAME, never its content, and never reads a recorded file
 * again. An edit to the SQL of a file a release applied therefore reaches
 * every fresh install and no upgraded one. Assertion 4 sees that when the edit
 * changes the schema; an edit that changes data (a backfill, an UPDATE) shows
 * in no catalogue, so the files are compared as well. A change to COMMENTS is
 * harmless for the same reason the edit is dangerous (the file is never read
 * again), and there were two after alpha.1: managed 0006 and 0008 gained a
 * note pointing at 0059 (#1650). Files are compared with comments removed, and
 * a file whose comments alone changed is reported. That is looser than 0146
 * T3's rule, which `scripts/a-chain-that-only-grows.unit.test.ts` holds: every
 * file a release shipped is byte for byte what the newest release that shipped
 * it carries. This stays comment-blind because it starts from older releases
 * too, and alpha.1's 0006 and 0008 differ from alpha.3's in their notes alone.
 *
 * **THERE IS NO ALLOW-LIST.** The shared gate carries one, for the tables a
 * pre-release break left behind on rc.1 (`MOVED_TO_MANAGED_CHAIN`). A release
 * after the alpha began has testers' data on it; a difference between its
 * upgrade and a fresh install is a defect, not an exception to declare
 * (0146 T4).
 *
 * WHY THE RELEASE'S OWN MIGRATORS. "Applied the way the release did" is the
 * claim, and a migrator that records versions differently (another table,
 * another lock, checksums) is precisely what would make an upgrade go wrong
 * while every file is unchanged. So the release's `migrate.ts` and
 * `migrate-managed.ts` run, not this build's. Their imports are pointed as
 * follows, and nothing else in them is touched:
 *
 * - a relative import of a file materialised here stays as it is;
 * - `@openmig/ledger` in the managed migrator becomes the release's
 *   `migrate.ts` beside it (all it imports from that package is
 *   `runMigrations`);
 * - any other relative import is this build's file at the same path. That is
 *   `db.ts`, for `pgDriver`, which a migrator uses only when it is given a
 *   connection string; every call here passes a driver;
 * - a bare third-party specifier (`pg`) resolves through the packages' own
 *   `node_modules`, linked into the temp tree, as it does in the repository;
 * - any other `@openmig/*` specifier does NOT reach the release: vitest's
 *   aliases (`vitest.aliases.ts`) catch it first and resolve it to THIS
 *   build's source. That is `@openmig/shared`, for `log`, which a migrator
 *   uses only when it is given no logger; every call here passes one.
 *
 * The temp tree's `node_modules` are symbolic links into the checkout, and
 * the removal below unlinks them without following them.
 *
 * ON PGLITE, as the shared gate runs, so it gates every pull request in the
 * unit project with nothing but git (`ci.yml` checks out with
 * `fetch-depth: 0`). The managed edition runs Postgres, so the same proof
 * runs there too, from the same starting points (the managed chain's oldest
 * supported release and the newest), in `migrate-upgrade.integration.test.ts`. Both read the release through
 * `__tests__/upgrade-from-a-release.ts`, which holds what the two legs share.
 *
 * FROM WHICH RELEASES (0146 T4). From each that `scripts/release-line.json`
 * names: the managed chain's oldest supported release, `v0.2.0-alpha.1`, the
 * first with a managed chain, and the newest release, §22.1's "from N-1 (and
 * at least one older) to N". Until 2026-10-31 a pull request proved alpha.1
 * alone. `UPGRADE_FROM_REF` names one instead: the release workflow's
 * preflight runs this file and the shared gate with the previous tag and
 * refuses unless every `skipIf(!HAVE_REF)` case executed. A ref that
 * predates the managed chain (rc.1) is refused by name: that upgrade is the
 * adoption case above.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  pgliteDriver,
  runMigrations,
  type LedgerDriver,
  type RunMigrationsResult,
} from '@openmig/ledger';
import { runManagedMigrations } from './migrate-managed.ts';
import {
  CATALOGUE,
  CHAINS,
  MIGRATIONS,
  REPO_ROOT,
  SHARED_BOOKKEEPING,
  atRef,
  bookkeeping,
  catalogue,
  headFilenames,
  loadReleaseMigrators,
  materialiseRelease,
  quiet,
  refExists,
  refFilenames,
  sha256,
  sqlWithoutComments,
  versionsOf,
  type Chain,
  type ReleaseMigrators,
} from './__tests__/upgrade-from-a-release.ts';
import { readReleaseLine, rootVersion, startingPoints } from '../../ledger/src/__tests__/release-line.ts';

/**
 * Temp directories this file makes, and the removal that used to be missing.
 *
 * See the sweep in workplan 0099: `mkdtempSync` with no matching `rmSync`
 * leaks for the lifetime of the machine. `unit-tests` runs on the SELF-HOSTED
 * runner for pushes to main. Registered rather than removed at each call site,
 * so a new test here cannot forget. `rmSync` removes a symbolic link, never
 * what it points at, so the linked `node_modules` stay where they are.
 */
const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
}, 120_000);

/**
 * The releases to upgrade FROM (workplan 0146 T4): the managed chain's oldest
 * supported release, `v0.2.0-alpha.1`, the first with a managed chain, and
 * the newest release, as `scripts/release-line.json` names them; or the one
 * `UPGRADE_FROM_REF` names, which is how the Release preflight runs this
 * file from the release before alone.
 */
const FROM_REFS = startingPoints(readReleaseLine(REPO_ROOT), 'managed', {
  fromRef: process.env.UPGRADE_FROM_REF,
  version: rootVersion(REPO_ROOT),
  isTagged: refExists,
});

/** One leg of the proof: everything below, from one release. */
function upgradeProofFrom(FROM_REF: string): void {
  const HAVE_REF = refExists(FROM_REF);
  const atRelease = (path: string): Buffer => atRef(FROM_REF, path);

  describe(`upgrading a managed database from ${FROM_REF}, both chains (0146 T4)`, () => {
    // Inside the describe, so each release's two databases exist only while
    // its own cases run, and not all of them at once.
    let release: ReleaseMigrators;
    let upgraded: LedgerDriver;
    let fresh: LedgerDriver;
    const fromRef = {} as Record<Chain, string[]>;
    const added = {} as Record<Chain, string[]>;
    /** The release's bookkeeping rows, read back right after the release applied its chains. */
    const recordedByRelease = {} as Record<Chain, string[]>;

    beforeAll(async () => {
      if (!HAVE_REF) return;
      for (const chain of CHAINS) {
        fromRef[chain] = refFilenames(FROM_REF, chain);
        added[chain] = headFilenames(chain).filter((f) => !fromRef[chain].includes(f));
      }
      release = await loadReleaseMigrators(FROM_REF, materialiseRelease(FROM_REF, tempDir));
      upgraded = pgliteDriver();
      fresh = pgliteDriver();
    }, 180_000);

    afterAll(async () => {
      await upgraded?.end();
      await fresh?.end();
    });

    it('can actually reach the release it upgrades from', () => {
      // The skip below is this gate's vacuous-pass hole, and this is the plug,
      // as in the shared gate. A depth-1 checkout has no tags; locally that is
      // ordinary and gets a warning, and in CI it is a broken gate.
      if (!HAVE_REF && process.env.CI) {
        throw new Error(
          `${FROM_REF} is not reachable, so the managed upgrade gate cannot run. CI must ` +
            `check out with tags (fetch-depth: 0). Set UPGRADE_FROM_REF to override.`,
        );
      }
      if (!HAVE_REF) {
        console.warn(`[managed-upgrade] ${FROM_REF} not reachable locally — gate skipped.`);
      }
      expect(true).toBe(true);
    });

    it.skipIf(!HAVE_REF)('knows what each chain added since the release, and lost nothing', () => {
      expect(fromRef.shared.length).toBeGreaterThan(0);
      expect(fromRef.managed.length).toBeGreaterThan(0);
      for (const chain of CHAINS) {
        const head = headFilenames(chain);
        // Migrations are append-only: a database the release built has run
        // every one of these, and without the file its schema cannot be rebuilt.
        expect(
          fromRef[chain].filter((f) => !head.includes(f)),
          `the ${chain} chain lost files ${FROM_REF} applied`,
        ).toEqual([]);
        // A new file that sorts below the release's last one applies AFTER it on
        // an upgraded database and BEFORE it on a fresh one: two orders, two
        // possible schemas, and a number that says nothing about when it ran.
        const last = fromRef[chain][fromRef[chain].length - 1]!;
        expect(
          added[chain].filter((f) => f < last),
          `new ${chain} migrations sort before ${last}, the last one ${FROM_REF} applied`,
        ).toEqual([]);
      }
      const total = added.shared.length + added.managed.length;
      console.info(
        `[managed-upgrade] ${FROM_REF} -> this build: shared chain ${fromRef.shared.length} -> ` +
          `${fromRef.shared.length + added.shared.length} (${added.shared.length} added), managed ` +
          `chain ${fromRef.managed.length} -> ${fromRef.managed.length + added.managed.length} ` +
          `(${added.managed.length} added).`,
      );
      if (total === 0) {
        console.warn(
          `[managed-upgrade] ${FROM_REF} and this build carry the SAME migrations on both chains. ` +
            'This run proves the mechanics and exercises NO migration.',
        );
      }
    });

    it.skipIf(!HAVE_REF)(
      "applies the release's two chains with the release's own migrators, shared first",
      { timeout: 120_000 },
      async () => {
        const shared = await release.runShared(upgraded);
        expect(shared.applied).toEqual(fromRef.shared);
        const managed = await release.runManaged(upgraded);
        expect(managed.applied).toEqual(fromRef.managed);

        recordedByRelease.shared = await bookkeeping(upgraded, SHARED_BOOKKEEPING);
        recordedByRelease.managed = await bookkeeping(upgraded, release.managedBookkeeping);
        expect(versionsOf(recordedByRelease.shared)).toEqual(fromRef.shared);
        expect(versionsOf(recordedByRelease.managed)).toEqual(fromRef.managed);
      },
    );

    it.skipIf(!HAVE_REF)(
      "applies only the files added since, with this build's migrators, and re-applies nothing",
      { timeout: 120_000 },
      async () => {
        const shared = await runMigrations({ driver: upgraded, logger: quiet });
        const managed = await runManagedMigrations({ driver: upgraded, logger: quiet });
        const ran: Record<Chain, RunMigrationsResult> = { shared, managed };

        for (const chain of CHAINS) {
          // Names, count and order: exactly the new files, in the order the
          // migrator sorts them, and none of the release's.
          expect(ran[chain].applied, `the ${chain} chain applied something other than its new files`).toEqual(
            added[chain],
          );
          expect(
            [...ran[chain].alreadyApplied].sort(),
            `this build's ${chain} migrator does not read what ${FROM_REF} recorded as applied`,
          ).toEqual(fromRef[chain]);
        }

        // And the release's own rows are as the release wrote them: nothing
        // re-recorded, nothing re-dated, nothing dropped.
        const table: Record<Chain, string> = {
          shared: SHARED_BOOKKEEPING,
          managed: release.managedBookkeeping,
        };
        for (const chain of CHAINS) {
          const now = await bookkeeping(upgraded, table[chain]);
          expect(
            now.filter((row) => fromRef[chain].includes(versionsOf([row])[0]!)),
            `the ${chain} chain's bookkeeping rows from ${FROM_REF} changed`,
          ).toEqual(recordedByRelease[chain]);
          expect(versionsOf(now)).toEqual([...fromRef[chain], ...added[chain]]);
        }
      },
    );

    it.skipIf(!HAVE_REF)("keeps every file the release applied the SQL it applied", () => {
      // The migrator records a name and never reads that file again, so this is
      // the only place a change to an applied file can be seen at all.
      const changed: string[] = [];
      const notesOnly: string[] = [];
      for (const chain of CHAINS) {
        for (const name of fromRef[chain]) {
          const path = `${MIGRATIONS[chain]}/${name}`;
          // A file that is gone is the first case's failure, said there.
          if (!existsSync(join(REPO_ROOT, path))) continue;
          const then = atRelease(path);
          const now = readFileSync(join(REPO_ROOT, path));
          if (sha256(then) === sha256(now)) continue;
          if (sqlWithoutComments(then.toString('utf8')) === sqlWithoutComments(now.toString('utf8'))) {
            notesOnly.push(path);
          } else {
            changed.push(path);
          }
        }
      }
      if (notesOnly.length > 0) {
        console.info(
          `[managed-upgrade] comments changed since ${FROM_REF}, SQL unchanged: ${notesOnly.join(', ')}`,
        );
      }
      expect(
        changed,
        `the SQL of a migration ${FROM_REF} applied has changed. An upgraded database recorded ` +
          'that file as applied and will never run it again, so the change reaches fresh ' +
          'installs only. Put the file back as it was and write the change as a new migration.\n' +
          changed.map((p) => `  - ${p}`).join('\n'),
      ).toEqual([]);
    });

    it.skipIf(!HAVE_REF)(
      'lands on the schema a fresh install of this build has',
      { timeout: 120_000 },
      async () => {
        await runMigrations({ driver: fresh, logger: quiet });
        await runManagedMigrations({ driver: fresh, logger: quiet });

        const up = await catalogue(upgraded);
        const at = await catalogue(fresh);
        expect(at.relations!.length, 'the fresh install has no tables: the catalogue read nothing').toBeGreaterThan(40);
        expect(at.policies!.length, 'the fresh install has no policies: the catalogue read nothing').toBeGreaterThan(40);
        expect(at.comments!.length, 'the fresh install has no comments: the catalogue read nothing').toBeGreaterThan(50);
        console.info(
          `[managed-upgrade] compared with a fresh install: ` +
            Object.keys(CATALOGUE)
              .map((kind) => `${at[kind]!.length} ${kind}`)
              .join(', ') +
            '.',
        );

        for (const kind of Object.keys(CATALOGUE)) {
          const upSet = new Set(up[kind]);
          const atSet = new Set(at[kind]);
          const missing = at[kind]!.filter((line) => !upSet.has(line));
          const extra = up[kind]!.filter((line) => !atSet.has(line));
          expect(
            { missing, extra },
            `${kind}: an upgraded database differs from a fresh install of this build. ` +
              '"missing" is in the fresh install and not the upgraded one (the usual cause: an ' +
              'applied migration edited instead of a new one written); "extra" is the reverse ' +
              '(a new migration that undoes or skips something only for upgraded databases).',
          ).toEqual({ missing: [], extra: [] });
        }

        // The same versions recorded, on both routes, in both ledgers.
        for (const table of [SHARED_BOOKKEEPING, release.managedBookkeeping]) {
          expect(versionsOf(await bookkeeping(upgraded, table))).toEqual(
            versionsOf(await bookkeeping(fresh, table)),
          );
        }
      },
    );

    it.skipIf(!HAVE_REF)('applies nothing on a further run of either chain', { timeout: 60_000 }, async () => {
      // Every API start re-runs both chains.
      expect((await runMigrations({ driver: upgraded, logger: quiet })).applied).toEqual([]);
      expect((await runManagedMigrations({ driver: upgraded, logger: quiet })).applied).toEqual([]);
    });

    it.skipIf(!HAVE_REF)(
      "the release's own migrators refuse the upgraded database wherever a chain moved on",
      { timeout: 60_000 },
      async () => {
        // §22.1: a build refuses a schema newer than it understands. Rolling the
        // API back to the release is what an operator reaches for when an upgrade
        // goes wrong, and it is the release's code that has to say no.
        const run = { shared: release.runShared, managed: release.runManaged };
        for (const chain of CHAINS) {
          if (added[chain].length > 0) {
            await expect(run[chain](upgraded), `${FROM_REF}'s ${chain} migrator`).rejects.toThrow(
              /newer than this build understands/,
            );
          } else {
            // Nothing new on this chain, so the release is not behind on it:
            // it must accept the database and apply nothing.
            expect((await run[chain](upgraded)).applied).toEqual([]);
          }
        }
      },
    );
  });
}

for (const FROM_REF of FROM_REFS) upgradeProofFrom(FROM_REF);

describe('the comparison of an applied file reads past comments and nothing else', () => {
  it('drops line and nested block comments, and collapses whitespace', () => {
    expect(sqlWithoutComments('-- a note\nCREATE  TABLE t (\n  a int -- why\n);\n')).toBe(
      'CREATE TABLE t ( a int );',
    );
    expect(sqlWithoutComments('SELECT /* outer /* inner */ still */ 1;')).toBe('SELECT 1;');
    expect(sqlWithoutComments('-- only a note\n')).toBe('');
  });

  it('keeps strings, quoted names and dollar-quoted bodies exactly, comments in them included', () => {
    expect(sqlWithoutComments("SELECT '--  kept', 'it''s -- kept';")).toBe(
      "SELECT '--  kept', 'it''s -- kept';",
    );
    expect(sqlWithoutComments("SELECT E'\\' -- kept';")).toBe("SELECT E'\\' -- kept';");
    expect(sqlWithoutComments('SELECT 1 AS "a -- b";')).toBe('SELECT 1 AS "a -- b";');
    const body = 'CREATE FUNCTION f() RETURNS int AS $fn$\n  -- in the body\n  SELECT 1;\n$fn$ LANGUAGE sql;';
    expect(sqlWithoutComments(body)).toBe(
      'CREATE FUNCTION f() RETURNS int AS $fn$\n  -- in the body\n  SELECT 1;\n$fn$ LANGUAGE sql;',
    );
    expect(sqlWithoutComments('SELECT $$ /* kept */ $$, $1;')).toBe('SELECT $$ /* kept */ $$, $1;');
  });

  it('tells a changed statement from a changed note', () => {
    const was = '-- v1\nALTER TABLE t ADD COLUMN a int;\n';
    expect(sqlWithoutComments('-- v2, longer\n\nALTER TABLE t ADD COLUMN a int; -- see 0059\n')).toBe(
      sqlWithoutComments(was),
    );
    expect(sqlWithoutComments('-- v1\nALTER TABLE t ADD COLUMN a bigint;\n')).not.toBe(
      sqlWithoutComments(was),
    );
    expect(sqlWithoutComments("UPDATE t SET a = 'x';")).not.toBe(sqlWithoutComments("UPDATE t SET a = 'x ';"));
  });

  it('refuses SQL it cannot read to the end, rather than guessing', () => {
    expect(() => sqlWithoutComments("SELECT 'open")).toThrow(/unterminated/);
    expect(() => sqlWithoutComments('SELECT /* open')).toThrow(/unterminated/);
    expect(() => sqlWithoutComments('SELECT $x$ open')).toThrow(/unterminated/);
  });
});
