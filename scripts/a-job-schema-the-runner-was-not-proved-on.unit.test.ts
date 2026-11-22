// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A JOB SCHEMA THE RUNNER WAS NOT PROVED ON (ADR-0054; workplan 0167 §5).
 *
 * The managed edition's job runner is pg-boss, on our own Postgres
 * (`packages/scheduler/src/pg-boss/job-runner.ts`). pg-boss keeps a schema of
 * its own in that database and migrates it itself: `start()` installs it, or
 * migrates an older one up to the version its release names (`pgboss.schema`
 * in its own `package.json`), and a schema that a later release migrated
 * further it runs on without a word. pg-boss has one main maintainer. So a
 * version range, or a lockfile that resolved a new release, would migrate the
 * jobs schema at a worker's next start in a change nobody read, and a worker
 * rolled back past that release would carry on over a schema it does not know.
 *
 * What this holds, from the files and the installed package:
 *
 *  1. pg-boss is declared at an exact version in `packages/scheduler`, and
 *     every other manifest that names it names the same one.
 *  2. The lockfile resolves that version and no other, for every importer.
 *  3. The pg-boss installed for `@openmig/scheduler` is that version, so what
 *     4 reads is the pinned release and not a stale install.
 *  4. The schema version the runner expects, `PG_BOSS_SCHEMA_VERSION`, is that
 *     release's own `pgboss.schema`. A pin moved to a release with another
 *     schema fails here until the constant moves with it, which is when that
 *     release's migration gets read.
 *
 * What it does not hold is what pg-boss does at run time. `start()` reads
 * `PgBoss#schemaVersion()` and refuses any version but the one it expects, and
 * `job-runner.integration.test.ts` proves that against a real Postgres.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

const SCHEDULER_MANIFEST = 'packages/scheduler/package.json';
const RUNNER = 'packages/scheduler/src/pg-boss/job-runner.ts';
const EXACT = /^\d+\.\d+\.\d+$/;
const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;

type DepField = (typeof DEP_FIELDS)[number];
type Manifest = Partial<Record<DepField, Record<string, string>>>;
const manifest = (rel: string): Manifest => JSON.parse(read(rel)) as Manifest;

const pin = manifest(SCHEDULER_MANIFEST).dependencies?.['pg-boss'];

describe('pg-boss is held at one exact version', () => {
  it('packages/scheduler declares it at an exact version, not a range, a tag or the catalog', () => {
    expect(pin, `${SCHEDULER_MANIFEST} no longer declares pg-boss among its dependencies`).toBeDefined();
    expect(pin, `"${String(pin)}" lets the lockfile move pg-boss, and pg-boss migrates its schema at start`).toMatch(EXACT);
  });

  it('every manifest that names it names the same version', () => {
    const manifests = globSync('{,apps/*/,packages/*/}package.json', { cwd: ROOT });
    // The root, the apps and the packages; a handful means the glob moved.
    expect(manifests.length).toBeGreaterThan(10);
    const named = manifests.flatMap((rel) =>
      DEP_FIELDS.flatMap((field) => {
        const version = manifest(rel)[field]?.['pg-boss'];
        return version === undefined ? [] : [{ rel, field, version }];
      }),
    );
    expect(named.map((n) => n.rel)).toContain(SCHEDULER_MANIFEST);
    expect(named.filter((n) => n.version !== pin), `every pg-boss must be ${String(pin)}, exactly`).toEqual([]);
  });

  it('the lockfile resolves that version, and no other, for every importer', () => {
    type Resolved = { specifier: string; version: string };
    const lock = parse(read('pnpm-lock.yaml')) as {
      importers: Record<string, Partial<Record<DepField, Record<string, Resolved>>>>;
      packages: Record<string, unknown>;
      snapshots: Record<string, unknown>;
    };
    const resolved = Object.entries(lock.importers).flatMap(([importer, fields]) =>
      DEP_FIELDS.flatMap((field) => {
        const entry = fields[field]?.['pg-boss'];
        return entry ? [{ importer, field, specifier: entry.specifier, version: entry.version.split('(')[0] }] : [];
      }),
    );
    expect(resolved.map((r) => r.importer)).toContain('packages/scheduler');
    for (const r of resolved) {
      expect({ importer: r.importer, specifier: r.specifier, version: r.version }).toEqual({
        importer: r.importer,
        specifier: pin,
        version: pin,
      });
    }
    // One release in the store and one snapshot of it, whatever its peers.
    const releases = (section: Record<string, unknown>): string[] =>
      Object.keys(section)
        .filter((key) => key.startsWith('pg-boss@'))
        .map((key) => key.split('(')[0]!);
    expect(releases(lock.packages)).toEqual([`pg-boss@${String(pin)}`]);
    expect(releases(lock.snapshots)).toEqual([`pg-boss@${String(pin)}`]);
  });
});

describe("the schema version the runner expects is the pinned release's own", () => {
  // Resolved from `@openmig/scheduler`, as the runner resolves it, not from the root.
  const required = createRequire(join(ROOT, SCHEDULER_MANIFEST));
  const installed = required('pg-boss/package.json') as { version: string; pgboss?: { schema?: unknown } };
  const runner = read(RUNNER);

  it("the installed pg-boss is the pinned one, so the schema version read below is that release's", () => {
    expect(installed.version, 'node_modules holds another pg-boss than the pin: install again').toBe(pin);
  });

  it("PG_BOSS_SCHEMA_VERSION is the release's own pgboss.schema", () => {
    const own = installed.pgboss?.schema;
    expect(Number.isInteger(own), 'pg-boss no longer names its schema version as pgboss.schema: read how it does now').toBe(true);
    const declared = [...runner.matchAll(/^const PG_BOSS_SCHEMA_VERSION = (\d+);$/gm)].map((m) => Number(m[1]));
    expect(declared, `${RUNNER} declares PG_BOSS_SCHEMA_VERSION once, as a number`).toHaveLength(1);
    expect(
      declared[0],
      `pg-boss ${String(pin)} migrates the jobs schema to version ${String(own)}: read that migration, then move PG_BOSS_SCHEMA_VERSION`,
    ).toBe(own);
  });

  it('start() compares that version with what pg-boss reads from the database', () => {
    // The behaviour is the integration test's; this keeps the comparison from
    // being dropped while the constant stays behind, agreeing with nothing.
    expect(runner).toContain('const version = await this.#boss.schemaVersion();');
    expect(runner).toContain('if (version !== PG_BOSS_SCHEMA_VERSION) {');
  });
});
