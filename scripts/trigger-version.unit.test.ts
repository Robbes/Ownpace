// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The Trigger.dev control plane's backup, and the version it is a backup FOR.
 *
 * ## Why this exists
 *
 * `triggerdb` holds the only copy of the things a person cannot rebuild
 * unattended — the account, the project, its API keys, the worker group, the
 * deployed-task records (deploy-tasks.sh's ONE-TIME prerequisites need a
 * browser and a magic link). The webapp applies its own schema migrations on
 * boot and Prisma has no down-migrations, so a version bump is ONE WAY: the
 * documented rollback puts the old image tag back, which restores the IMAGES
 * and not the schema they migrated.
 *
 * Nothing backed that database up. `trigger-version.sh` does — and the tests
 * below are mostly about the parts that DESTROY things, because a restore is
 * a `DROP DATABASE` with a friendly name and the only safe version of it is
 * one that refuses by default.
 *
 * ## What is tested here, and what is not
 *
 * Anything needing a live Docker daemon is not tested here and cannot
 * usefully be: a stub would be testing the stub. What IS tested is every
 * refusal that fires BEFORE the first docker call — which is deliberately all
 * of them — plus the structural promises that a reader has to be able to rely
 * on: that the drill never names the live database in a DROP, that the gate
 * actually runs the drill, and that the destructive path cannot be reached by
 * accident.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO_ROOT, 'deploy/compose/trigger-version.sh');
const script = readFileSync(SCRIPT, 'utf8');
const workflow = readFileSync(join(REPO_ROOT, '.github/workflows/e2e-managed.yml'), 'utf8');

let dir: string;
let backups: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trigger-version-'));
  backups = join(dir, 'trigger-backups');
  mkdirSync(backups, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(args: string[], env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(SCRIPT, args, {
    encoding: 'utf8',
    env: { ...process.env, MANAGED_BACKUP_DIR: backups, ...env },
    cwd: dir,
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** A file that decompresses to something that is NOT a database dump. */
const notADump = (text: string) => gzipSync(Buffer.from(text));
/** The smallest thing that passes for one: header, and enough of it. */
const looksLikeADump = () =>
  // Enough SQL to clear the floor. Deliberately repetitive: it compresses to
  // a few hundred bytes, which is exactly why the floor measures the
  // DECOMPRESSED size and not the archive.
  gzipSync(Buffer.from(`--\n-- PostgreSQL database dump\n--\n${'-- padding line\n'.repeat(600)}`));

describe('a restore refuses before it can destroy anything', () => {
  it('asks for a file, rather than guessing one', () => {
    const r = run(['restore']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('--latest');
  });

  it('refuses a backup that does not exist', () => {
    const r = run(['restore', join(dir, 'nope.sql.gz'), '--yes']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('no such backup');
  });

  it('refuses --latest when there are no backups at all', () => {
    const r = run(['restore', '--latest', '--yes']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/no backups/i);
  });

  it('refuses a gzip of an error message, which is still a valid gzip', () => {
    // The exact shape of #523: something non-empty, well-formed at the
    // envelope level, and not the thing it is claimed to be.
    const f = join(backups, 'triggerdb-20260824T000000Z.sql.gz');
    writeFileSync(f, notADump('Error response from daemon: No such container: trigger-db\n'.repeat(50)));
    const r = run(['restore', f, '--yes']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('not a pg_dump header');
  });

  it('refuses a dump too small to be a database', () => {
    const f = join(backups, 'triggerdb-20260824T000001Z.sql.gz');
    writeFileSync(f, gzipSync(Buffer.from('--\n-- PostgreSQL database dump\n--\n')));
    const r = run(['restore', f, '--yes']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/too little to be/);
  });

  it('refuses a VALID dump without --yes, and prints the commands that would do it', () => {
    // The one that matters: the happy path is the destructive one, so
    // reaching it has to be deliberate.
    const f = join(backups, 'triggerdb-20260824T000002Z.sql.gz');
    writeFileSync(f, looksLikeADump());
    const r = run(['restore', f]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('REFUSING');
    expect(r.stderr).toContain('stop trigger-api trigger-supervisor');
    expect(r.stderr).toContain('--yes');
  });
});

describe('pin refuses what it cannot pin', () => {
  it('asks for a version rather than guessing', () => {
    const r = run(['pin']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/needs a version/);
  });

  it('refuses something that is not a version, before asking the registry', () => {
    const r = run(['pin', 'latest']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('expected a tag like');
  });
});

describe('the drill cannot touch the live database', () => {
  const drill = /cmd_drill\(\) \{[\s\S]*?\n\}/.exec(script)?.[0] ?? '';

  it('read the real function', () => {
    expect(drill.length).toBeGreaterThan(400);
  });

  it('drops only the throwaway, never the database it is protecting', () => {
    // Every DROP DATABASE in the drill names ${drill_db}. One naming
    // ${DB_NAME} would destroy the thing the backup exists for, during a
    // routine nightly, which is the worst failure this file can imagine.
    // To end of line: the trap's quoting puts a `'` mid-statement, and a
    // regex stopping there would inspect `DROP DATABASE IF EXISTS ` and find
    // no database name in it — passing while reading nothing.
    const drops = [...drill.matchAll(/DROP DATABASE[^\n]*/g)].map((m) => m[0]);
    expect(drops.length).toBeGreaterThan(0);
    for (const d of drops) {
      expect(d, `a DROP in the drill does not name the throwaway: ${d}`).toContain('drill_db');
      expect(d).not.toContain('${DB_NAME}');
    }
  });

  it('compares against a schema big enough to be real', () => {
    // Two empty databases match perfectly. Without a floor, the drill would
    // pass most convincingly when it had proved nothing at all.
    expect(drill).toContain('-ge 10');
  });

  it('drops the throwaway even when the load fails', () => {
    expect(drill).toMatch(/trap .*DROP DATABASE IF EXISTS.*EXIT/);
  });
});

describe('the managed gate runs the drill, so the backup is never only a claim', () => {
  it('is a step in the gate', () => {
    expect(workflow).toContain('trigger-version.sh drill');
  });

  it('runs before the acceptance smoke, while the stack is known-good', () => {
    // After the bring-up (there is a database to dump) and before the smoke
    // starts writing to the product — a dump taken mid-migration is a
    // snapshot of a moving thing.
    const drillAt = workflow.indexOf('trigger-version.sh drill');
    const smokeAt = workflow.indexOf('The acceptance smoke');
    expect(drillAt).toBeGreaterThan(-1);
    expect(drillAt).toBeLessThan(smokeAt);
  });

  it('the gate never runs restore, which is a human decision', () => {
    expect(workflow).not.toMatch(/trigger-version\.sh restore/);
  });
});

describe('the backup lands where the next run can still find it', () => {
  it('defaults outside the checkout, like .env does', () => {
    // actions/checkout cleans ignored files before every run. A backup inside
    // the working tree would be deleted by the next run — precisely when it
    // was needed.
    expect(script).toContain('MANAGED_ENV_PERSIST_DIR');
    expect(script).not.toMatch(/BACKUP_DIR=.*SCRIPT_DIR/);
  });
});
