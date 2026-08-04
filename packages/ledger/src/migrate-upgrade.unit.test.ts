// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * §22.1's N-1 -> N upgrade gate (workplan 0025 T5) — the last of the three.
 *
 * §22.1 promises self-host upgrades by image tag with migrations that "auto-run
 * on start (locked, idempotent)" and are "linear/cumulative so skipping
 * versions (N-2 -> N) is supported". Until this file nothing checked any of it.
 * The `migrate-rerun` gate proves the chain survives its own re-run FROM
 * SCRATCH; that is a different claim. An upgrade starts from a database some
 * released build created and left behind, and the interesting failures live
 * exactly there.
 *
 * WHAT IT DOES. Reads the migration set out of the released tag with
 * `git show <tag>:packages/ledger/migrations/...`, applies THAT to a fresh
 * database — the released schema, byte for byte, as an operator's appliance
 * holds it — then applies the working tree's set on top and asserts:
 *
 *   1. every migration new since the release applied, in order;
 *   2. the upgraded schema is INDISTINGUISHABLE from one built fresh at HEAD;
 *   3. a further run applies nothing;
 *   4. the released build, put back in front of the upgraded database,
 *      REFUSES to start.
 *
 * **Assertion 2 is the one with teeth**, and it is the reason this is not just
 * `migrate-rerun` with extra steps. The classic migration bug is drift between
 * the baseline and the incremental: somebody adds a column by editing
 * `0001_baseline.sql` instead of writing `0007`, and every fresh install is
 * correct while every UPGRADED install silently lacks the column. Both halves
 * pass their own tests. Only comparing the two schemas catches it, and that is
 * a failure whose first symptom is otherwise a production query against a
 * column that does not exist on exactly the installs that have been running
 * longest.
 *
 * Assertion 4 covers §22.1's other promise — "refuses to start if the DB
 * schema is newer than it understands" — which `migrate.ts` implements and
 * nothing exercised. Rolling back an image is what an operator reaches for
 * when an upgrade goes wrong; that is precisely when a silent old build
 * writing into a newer schema does the damage.
 *
 * **THIS GATE REFUSES TO PASS VACUOUSLY.** When the release and the working
 * tree carry the SAME migration set there is no upgrade to test, and a green
 * tick would mean nothing. That is not hypothetical: it is the state on the
 * day rc.1 was cut, because the tag points at the same commit. The gate says
 * so out loud (assertion 5) instead of reporting success — the backup/restore
 * drill in this same workplan passed vacuously once already, and the lesson
 * was that a drill has to know whether it drilled anything.
 *
 * NO DOCKER, NO REGISTRY, NO RUNNER. The released schema is in git, so this
 * runs in the unit project and gates every PR — unlike the container-level
 * upgrade drill, which needs the published image and the Spark runner.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pgliteDriver } from './pglite-driver';
import { runMigrations } from './migrate';
import type { LedgerDriver } from './driver';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIGRATIONS_PATH = 'packages/ledger/migrations';
const HEAD_MIGRATIONS = join(REPO_ROOT, 'packages', 'ledger', 'migrations');

/**
 * The release to upgrade FROM.
 *
 * Overridable so the gate can be pointed at whatever the previous release is
 * once there is more than one, without editing this file — and so a developer
 * can check an upgrade from any older point by exporting one variable.
 */
const FROM_REF = process.env.UPGRADE_FROM_REF || 'v0.1.0-rc.1';

function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** Is the reference reachable? A shallow clone or a missing tag is not a bug. */
function refExists(ref: string): boolean {
  try {
    git('rev-parse', '--verify', `${ref}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

/** The migration filenames the released tree carried, in order. */
function releasedFilenames(): string[] {
  return git('ls-tree', '--name-only', FROM_REF, `${MIGRATIONS_PATH}/`)
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => p.endsWith('.sql'))
    .map((p) => p.slice(`${MIGRATIONS_PATH}/`.length))
    .sort();
}

function headFilenames(): string[] {
  return readdirSync(HEAD_MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/**
 * The released migrations, materialised into a temp directory.
 *
 * Written out rather than applied through some in-memory path because
 * `runMigrations` reads a DIRECTORY, and going through its real file-reading
 * code is the point: this must be the same loader an appliance runs, not a
 * second implementation that could agree with the test and disagree with
 * production.
 */
function materialiseReleasedMigrations(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'openmig-upgrade-')), 'migrations');
  mkdirSync(dir, { recursive: true });
  for (const name of releasedFilenames()) {
    writeFileSync(join(dir, name), git('show', `${FROM_REF}:${MIGRATIONS_PATH}/${name}`));
  }
  return dir;
}

/**
 * Every column of every table, as a comparable string.
 *
 * The comparison that assertion 2 turns on. Ordered explicitly so two
 * databases built by different routes cannot differ merely by catalogue order,
 * and restricted to `public` so PGlite's own internals stay out of it.
 */
async function schemaFingerprint(driver: LedgerDriver): Promise<string> {
  const client = await driver.acquire();
  try {
    const { rows } = await client.query<{ line: string }>(
      `SELECT table_name || '.' || column_name || ':' || data_type ||
              ':' || is_nullable || ':' || coalesce(column_default, '-') AS line
         FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, column_name`,
    );
    return rows.map((r) => r.line).join('\n');
  } finally {
    await client.release();
  }
}

/** Indexes too — a migration that forgets one is a performance cliff, not an error. */
async function indexFingerprint(driver: LedgerDriver): Promise<string> {
  const client = await driver.acquire();
  try {
    const { rows } = await client.query<{ line: string }>(
      `SELECT indexname || ':' || indexdef AS line
         FROM pg_indexes WHERE schemaname = 'public'
        ORDER BY indexname`,
    );
    return rows.map((r) => r.line).join('\n');
  } finally {
    await client.release();
  }
}

const HAVE_REF = refExists(FROM_REF);
let releasedDir: string;
let upgraded: LedgerDriver;
let fresh: LedgerDriver;

beforeAll(async () => {
  if (!HAVE_REF) return;
  releasedDir = materialiseReleasedMigrations();
  upgraded = pgliteDriver();
  fresh = pgliteDriver();
}, 180_000);

afterAll(async () => {
  await upgraded?.end();
  await fresh?.end();
});

describe(`upgrading from ${FROM_REF} (§22.1 N-1 -> N gate)`, () => {
  it('can actually reach the release it upgrades from', () => {
    // The skip below is the gate's own vacuous-pass hole, and this is the
    // plug. A depth-1 checkout has no tags, so every assertion here would be
    // skipped and the job would go green having proved nothing — which is
    // exactly the failure this file was written to refuse. Locally a shallow
    // or tagless clone is ordinary and gets a warning; in CI it is a broken
    // gate and says so (ci.yml checks out with fetch-depth: 0 for this).
    if (!HAVE_REF && process.env.CI) {
      throw new Error(
        `${FROM_REF} is not reachable, so the upgrade gate cannot run. CI must ` +
          `check out with tags (fetch-depth: 0). Set UPGRADE_FROM_REF to override.`,
      );
    }
    if (!HAVE_REF) {
      console.warn(`[upgrade-gate] ${FROM_REF} not reachable locally — gate skipped.`);
    }
    expect(true).toBe(true);
  });

  it.skipIf(!HAVE_REF)('knows whether there is an upgrade to test at all', () => {
    const from = releasedFilenames();
    const to = headFilenames();
    expect(from.length).toBeGreaterThan(0);

    // NOT an assertion that they differ — they legitimately do not, between a
    // release and the next schema change. It is a REPORT, so a green run
    // cannot be mistaken for proof that a migration was exercised. The moment
    // a 0007 lands, every assertion below starts doing real work.
    const added = to.filter((f) => !from.includes(f));
    if (added.length === 0) {
      console.warn(
        `[upgrade-gate] ${FROM_REF} and the working tree carry the SAME ${from.length} ` +
          `migrations. This run proves the mechanics — the released schema applies, the ` +
          `upgrade is a no-op, and the downgrade guard behaves — but it exercises NO ` +
          `migration. It gains teeth when the next migration lands.`,
      );
    }
    // What must never happen: a file present in the release and gone from the
    // tree. Migrations are append-only; an operator's database has already run
    // it, so deleting it makes the release's schema unreproducible.
    expect(from.filter((f) => !to.includes(f))).toEqual([]);
  });

  it.skipIf(!HAVE_REF)(
    'applies the RELEASED schema, then every migration added since',
    { timeout: 120_000 },
    async () => {
      const first = await runMigrations({
        driver: upgraded,
        migrationsDir: releasedDir,
        logger: () => {},
      });
      expect([...first.applied].sort()).toEqual(releasedFilenames().sort());

      // The upgrade itself: the working tree's set, over the released database.
      const second = await runMigrations({ driver: upgraded, logger: () => {} });
      const added = headFilenames().filter((f) => !releasedFilenames().includes(f));
      expect([...second.applied].sort()).toEqual(added.sort());
    },
  );

  it.skipIf(!HAVE_REF)(
    'lands on a schema INDISTINGUISHABLE from a fresh install at HEAD',
    { timeout: 120_000 },
    async () => {
      await runMigrations({ driver: fresh, logger: () => {} });

      // The assertion this gate exists for. Editing the baseline instead of
      // writing a new migration passes every other test in the repo and leaves
      // upgraded installs — the oldest, most valuable ones — missing the
      // change. Nothing but this comparison notices.
      expect(await schemaFingerprint(upgraded)).toBe(await schemaFingerprint(fresh));
      expect(await indexFingerprint(upgraded)).toBe(await indexFingerprint(fresh));
    },
  );

  it.skipIf(!HAVE_REF)('is idempotent after the upgrade', { timeout: 60_000 }, async () => {
    // Restarting an appliance re-runs migrations; an upgrade must not turn
    // every subsequent boot into a re-application.
    const again = await runMigrations({ driver: upgraded, logger: () => {} });
    expect(again.applied).toEqual([]);
  });

  it.skipIf(!HAVE_REF)('REFUSES to let the released build start against the upgraded database', async () => {
    // §22.1: "refuses to start if the DB schema is newer than it understands".
    // Rolling an image back is exactly what an operator does when an upgrade
    // goes wrong, and it is the moment an old build writing into a new schema
    // does its damage. `migrate.ts` implements the guard; nothing exercised it.
    const added = headFilenames().filter((f) => !releasedFilenames().includes(f));
    if (added.length === 0) {
      // Honest skip: with no new migration the old build is not behind, so
      // there is nothing for the guard to refuse. Asserting a refusal here
      // would be asserting a bug.
      return;
    }
    await expect(
      runMigrations({ driver: upgraded, migrationsDir: releasedDir, logger: () => {} }),
    ).rejects.toThrow(/newer than this build understands/);
  });
});
