// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE UPGRADE GATE (workplan 0179 T5; the maintainer's D2 (a) of 2026-11-27):
 * the previous release's appliance, with data, upgraded in place to this build.
 *
 * Run by `.github/workflows/e2e.yml` on the Postgres night only, after every
 * other gate, as its own compose project (`ownpace-upgrade-gate`, with
 * `deploy/selfhost/compose.upgrade.yml`) beside the appliance those gates
 * drove. The workflow resolves the release (`scripts/previous-release.mjs`),
 * verifies its signature and hands it here by digest, as UPGRADE_FROM_IMAGE.
 *
 *  1. The released appliance starts on an empty database, with one mapping:
 *     the one the other gates use, under its own id, writing under a folder of
 *     its own. It copies the seeded sources; every data type is read through
 *     `statusAfterAPass`, so a pass the schedule starts across the minute's turn
 *     is joined rather than read half-done.
 *  2. The ledger is read: counts per data type and state, and the migrations.
 *  3. This build's image starts on the same volumes (`--force-recreate`), the
 *     database untouched in between.
 *  4. It is healthy; its migrations apply on top of the released ones, ending at
 *     this build's newest; the ledger's counts are the ones read before; and a
 *     pass after the upgrade completes and changes none of them.
 *
 * What it does not prove: a newer Postgres (the database image is this
 * checkout's on both sides), PGlite's state directory (scripts/upgrade-drill.sh,
 * by hand before a release), or the managed edition. And when the two sides
 * carry the same migrations it says so: the upgrade is then of the code only.
 *
 * Needs, from the workflow: UPGRADE_FROM_IMAGE (`<repo>@sha256:…`, verified),
 * UPGRADE_TO_IMAGE (this build's, already built by the job), SELFHOST_PORT (a
 * port of the gate's own; the helpers of `apply-deletion-lib.ts` read it), and
 * deploy/selfhost/.env and deploy/selfhost/config/mapping.json as the job's
 * earlier steps leave them.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  BASE_URL,
  DAV_TARGET_USER,
  NEXTCLOUD_URL,
  TARGET_DAV_PASSWORD,
  startMapping,
  statusAfterAPass,
  type DomainStatus,
} from './apply-deletion-lib.ts';
import {
  UPGRADE_MAPPING_ID,
  folderMade,
  folderTakenBack,
  ledgerCounts,
  migrationsCrossed,
  prefixFolderPath,
  upgradeMapping,
  type MappingFile,
} from './upgrade-gate-lib.ts';

const FROM_IMAGE = process.env.UPGRADE_FROM_IMAGE ?? '';
const TO_IMAGE = process.env.UPGRADE_TO_IMAGE ?? 'ghcr.io/robbes/ownpace-selfhost:edge';
const PROJECT = 'ownpace-upgrade-gate';
const FILES = ['deploy/selfhost/compose.yml', 'deploy/selfhost/compose.dev.yml', 'deploy/selfhost/compose.upgrade.yml'];
const PG_USER = process.env.POSTGRES_USER || 'openmigrate';
const PG_DB = process.env.POSTGRES_DB || 'openmigrate';

/** The data types the other gates read, in `/status`'s words (selfhost-restart-resume.e2e.test.ts). */
const DOMAINS = ['email', 'calendar', 'contact', 'file', 'task'];

const configDir = mkdtempSync(join(tmpdir(), 'ownpace-upgrade-gate-'));

/** `docker compose` on the gate's own project, with the image it is given. */
function compose(image: string, ...args: string[]): string {
  return execFileSync(
    'docker',
    ['compose', '-p', PROJECT, ...FILES.flatMap((f) => ['-f', f]), ...args],
    {
      encoding: 'utf8',
      env: { ...process.env, SELFHOST_IMAGE: image, UPGRADE_CONFIG_DIR: configDir },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
}

/** One query on the gate's database, as psql -At prints it. */
function sql(image: string, query: string): string {
  return compose(image, 'exec', '-T', 'postgres', 'psql', '-U', PG_USER, '-d', PG_DB, '-Atc', query);
}

const readLedger = (image: string): Record<string, number> =>
  ledgerCounts(sql(image, 'SELECT domain, status, count(*) FROM item GROUP BY 1, 2 ORDER BY 1, 2'));
const readMigrations = (image: string): string[] =>
  sql(image, 'SELECT version FROM schema_migrations ORDER BY 1').split('\n').filter(Boolean);
const builtMigrations = (): string[] =>
  readdirSync('packages/ledger/migrations').filter((f) => f.endsWith('.sql')).sort();

async function waitHealthy(what: string): Promise<void> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const ok = await fetch(`${BASE_URL}/healthz`).then((r) => r.ok, () => false);
    if (ok) return;
    await sleep(2000);
  }
  throw new Error(`${what} never answered /healthz at ${BASE_URL}`);
}

/** A pass of every data type, each read once no pass is running. */
async function passEveryDomain(): Promise<Record<string, DomainStatus | null>> {
  const read: Record<string, DomainStatus | null> = {};
  for (const domain of DOMAINS) read[domain] = await statusAfterAPass(UPGRADE_MAPPING_ID, domain);
  return read;
}

/** The target user's own credentials, for the gate's folder on the demo Nextcloud. */
const asTarget = (): Record<string, string> => ({
  Authorization: `Basic ${Buffer.from(`${DAV_TARGET_USER}:${TARGET_DAV_PASSWORD}`).toString('base64')}`,
});

/** The gate's folder on the target, before the released appliance writes (upgrade-gate-lib.ts says why). */
async function makeTheFolder(): Promise<void> {
  const res = await fetch(`${NEXTCLOUD_URL}${prefixFolderPath(DAV_TARGET_USER)}`, { method: 'MKCOL', headers: asTarget() });
  console.log(`[upgrade] the gate's folder on the target: ${folderMade(res.status)}`);
}

/** The folder, and everything the gate wrote in it, taken back. */
async function takeTheFolderBack(): Promise<void> {
  const res = await fetch(`${NEXTCLOUD_URL}${prefixFolderPath(DAV_TARGET_USER)}`, { method: 'DELETE', headers: asTarget() });
  folderTakenBack(res.status);
}

const down = (): void => {
  try {
    compose(TO_IMAGE, 'down', '-v', '--remove-orphans');
  } catch {
    // Said by compose on stderr; the workflow's Cleanup step takes the project down again.
  }
};

let releasedPass: Record<string, DomainStatus | null> = {};
let ledgerBefore: Record<string, number> = {};
let migrationsBefore: string[] = [];

describe('the upgrade gate: the previous release, with data, upgraded in place to this build', () => {
  beforeAll(async () => {
    if (!/^[^@\s]+@sha256:[0-9a-f]{64}$/.test(FROM_IMAGE)) {
      throw new Error(
        `UPGRADE_FROM_IMAGE must name the released appliance by digest (<repo>@sha256:…); it is "${FROM_IMAGE}". ` +
          'The workflow resolves it with scripts/previous-release.mjs and verifies its signature first.',
      );
    }
    const prepared = JSON.parse(readFileSync('deploy/selfhost/config/mapping.json', 'utf8')) as MappingFile;
    writeFileSync(join(configDir, 'mapping.json'), JSON.stringify(upgradeMapping(prepared), null, 2));
    // The appliance runs as uid 10001, and its launcher writes a probe file here.
    chmodSync(configDir, 0o777);
    chmodSync(join(configDir, 'mapping.json'), 0o644);

    down();
    compose(FROM_IMAGE, 'pull', 'app');
    compose(FROM_IMAGE, 'up', '-d', '--no-build', '--wait');
    await waitHealthy(`the released appliance (${FROM_IMAGE})`);
    await makeTheFolder();
    await startMapping(UPGRADE_MAPPING_ID);
    releasedPass = await passEveryDomain();
    ledgerBefore = readLedger(FROM_IMAGE);
    migrationsBefore = readMigrations(FROM_IMAGE);

    // The upgrade: this build's image on the same volumes. The database stays up.
    compose(TO_IMAGE, 'up', '-d', '--no-build', '--no-deps', '--force-recreate', '--wait', 'app');
    await waitHealthy(`the upgraded appliance (${TO_IMAGE})`);
  }, 900_000);

  afterAll(async () => {
    // The appliance's own log, before its project goes: a red night's evidence.
    try {
      console.log(compose(TO_IMAGE, 'logs', 'app', '--no-color', '--tail', '150'));
    } catch {
      // Nothing to show: the project never started.
    }
    down();
    rmSync(configDir, { recursive: true, force: true });
    await takeTheFolderBack();
  }, 120_000);

  it('the released appliance copied the seeded sources, every data type, before the upgrade', () => {
    for (const domain of DOMAINS) {
      expect(releasedPass[domain]?.state, `${domain} on the released appliance`).toBe('completed');
    }
    for (const domain of DOMAINS) {
      const rows = Object.entries(ledgerBefore).filter(([k]) => k.startsWith(`${domain} `));
      expect(rows.length, `the released appliance's ledger has no ${domain} row`).toBeGreaterThan(0);
    }
  });

  it("this build starts on the released appliance's database, and its migrations apply on top", () => {
    const { crossed } = migrationsCrossed(migrationsBefore, readMigrations(TO_IMAGE), builtMigrations());
    console.log(
      crossed.length === 0
        ? `[upgrade] the released appliance and this build carry the same ${migrationsBefore.length} migrations: ` +
            'this upgrade is of the code only, and crosses no migration'
        : `[upgrade] crossed ${crossed.length} migration(s): ${crossed.join(', ')}`,
    );
  });

  it('the ledger holds what it held before the upgrade', () => {
    expect(readLedger(TO_IMAGE)).toEqual(ledgerBefore);
  });

  it('a pass after the upgrade completes, every data type, and changes none of the counts', async () => {
    const after = await passEveryDomain();
    for (const domain of DOMAINS) {
      expect(after[domain]?.state, `${domain} on the upgraded appliance`).toBe('completed');
      expect(after[domain]?.itemsFailed ?? 0, `${domain} failed items after the upgrade`).toBe(
        releasedPass[domain]?.itemsFailed ?? 0,
      );
    }
    expect(readLedger(TO_IMAGE)).toEqual(ledgerBefore);
  }, 600_000);
});
