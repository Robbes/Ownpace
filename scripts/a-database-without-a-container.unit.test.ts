// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DATABASE YOU CAN ASK, ON A MACHINE WITH NO CONTAINER RUNTIME.
 *
 * `pnpm test:integration` self-manages its stack through Testcontainers, which
 * needs a docker daemon. A remote agent session has none — `docker` is on the
 * PATH with nothing behind it — so every integration test dies at
 * `Could not find a working container runtime strategy` before a test body
 * runs. The effect is not that integration tests fail. It is that SQL stops
 * being CHECKABLE, and queries start being reasoned about instead of run.
 *
 * On 2026-09-01 five housekeeping queries were written for `operator.sh check`,
 * reviewed, and not executed. Standing up a cluster by hand took about fifteen
 * minutes of trial and error — initdb refuses to run as root, the data
 * directory's PARENTS have to be traversable by `postgres`, the two migration
 * chains have to go on in order — and the first run then found
 * `connection.display_name` is NOT NULL in roughly a second. The fifteen
 * minutes are what `scripts/local-pg.sh` exists to not spend again.
 *
 * WHAT IS PINNED HERE. The properties that make it safe to reach for without
 * reading it: it applies BOTH chains in the order the schema requires, a failed
 * migration stops it, `down` can only remove what `up` made, and `up` on a
 * running cluster reuses it rather than destroying somebody's work.
 *
 * AND IT IS RUN, where the machine can. The last case executes the real script
 * end to end whenever server binaries are present, on its own port and its own
 * directory. CI has no server installed and skips it; this container does, and
 * the check-in that found the `status` bug below was exactly this test.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'local-pg.sh');
const source = readFileSync(SCRIPT, 'utf8');

/**
 * The script with its comments removed.
 *
 * FOUND BY BREAKING THIS FILE. Two assertions below searched a function's whole
 * body for a token — `ON_ERROR_STOP=1` and `require_pgbin` — and both tokens
 * also appear in the COMMENT that explains why they are there. So deleting the
 * flag and deleting the call both left the test green: it was reading the
 * prose about the property, not the property.
 *
 * That is `the-check-postgres-never-made` in miniature — a check whose success
 * does not depend on the thing it checks. Anything asserting that the script
 * DOES something reads this; anything asserting what it SAYS reads the source.
 */
const code = source
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

/** Does this machine have a Postgres SERVER, not just the psql client? */
const hasServer = (): boolean => {
  if (spawnSync('sh', ['-c', 'command -v initdb'], { encoding: 'utf8' }).status === 0) return true;
  try {
    return readdirSync('/usr/lib/postgresql').some((v) =>
      existsSync(join('/usr/lib/postgresql', v, 'bin', 'initdb')),
    );
  } catch {
    return false;
  }
};

describe('the cluster it builds is the one the product runs on', () => {
  it('applies both migration chains, ledger before managed', () => {
    // THE ORDER IS THE SCHEMA'S, not a preference: every table in the managed
    // chain references `public.tenant`, which the ledger chain creates.
    // `vitest.global-setup.ts` says the same thing about the Testcontainers
    // database — two readings of one fact, and this is the one a person runs
    // by hand at the moment they are least likely to check.
    const chains = /CHAINS=\((?<body>[^)]*)\)/.exec(source)?.groups?.body ?? '';
    expect(chains, 'the CHAINS array is gone').not.toBe('');
    const ledger = chains.indexOf('packages/ledger/migrations');
    const managed = chains.indexOf('packages/managed/migrations');
    expect(ledger, 'the ledger chain is not applied').toBeGreaterThan(-1);
    expect(managed, 'the managed chain is not applied').toBeGreaterThan(-1);
    expect(managed, 'managed must come after ledger, or its foreign keys have no target')
      .toBeGreaterThan(ledger);
  });

  it('stops on the first failed statement', () => {
    // Without `ON_ERROR_STOP`, psql reports every failed statement and STILL
    // EXITS 0 — so the cluster comes up missing a table and nothing said so.
    // Hard rule 9 as one flag, on the one command that would otherwise hide it.
    const migrate = code.slice(code.indexOf('cmd_migrate() {'), code.indexOf('cmd_url() {'));
    expect(migrate, 'the migrate step is gone').not.toBe('');
    expect(migrate).toContain('ON_ERROR_STOP=1');
    expect(migrate, 'and it applies files, not just one').toContain('-f "$file"');
  });

  it('reuses a running cluster instead of destroying it', () => {
    // `up` does `rm -rf` on its own directory, which is right for a fresh
    // start and catastrophic for a cluster somebody is mid-way through using.
    // The reuse branch must come FIRST — idempotency (hard rule 1) here means
    // "a second `up` converges", not "a second `up` starts over".
    const up = code.slice(code.indexOf('cmd_up() {'), code.indexOf('cmd_migrate() {'));
    const reuse = up.indexOf('already running');
    const wipe = up.indexOf('rm -rf');
    expect(reuse, '`up` no longer detects a cluster that is already up').toBeGreaterThan(-1);
    expect(wipe).toBeGreaterThan(-1);
    expect(reuse, '`up` wipes before it checks — a second run destroys the first').toBeLessThan(wipe);
  });

  it('only ever removes the directory it was told to make', () => {
    // The one line in here that could cost somebody real data. It must take
    // its path from the configured root and from nothing else.
    const down = code.slice(code.indexOf('cmd_down() {'));
    const removals = [...down.matchAll(/rm -rf "(?<path>[^"]*)"/g)].map((m) => m.groups!.path!);
    expect(removals, '`down` removes nothing').not.toHaveLength(0);
    for (const path of removals) {
      expect(path, `down removes ${path}, which is not the configured root`).toBe('${PGDIR}');
    }
  });

  it('keeps the cluster out of the repository', () => {
    // `git clean -ffdx` is a routine step on the runner and would take a data
    // directory with it; `Check for committed artifacts` would refuse it first.
    const dir = /PGDIR="\$\{LOCAL_PG_DIR:-(?<path>[^}]*)\}"/.exec(source)?.groups?.path ?? '';
    expect(dir, 'the default cluster location is gone').not.toBe('');
    expect(dir.startsWith('/'), `${dir} is relative — it would land inside the checkout`).toBe(true);
    expect(dir).not.toContain('Ownpace');
  });

  it('says which package to install when there is no server', () => {
    // A refusal that names its remedy — the lesson
    // `a-refusal-that-named-no-remedy.unit.test.ts` was written for. "initdb
    // was not found" sends somebody looking for a bug in this script.
    expect(source).toContain('apt-get install -y postgresql');
    expect(source, 'and the other ordinary machine').toContain('brew install postgresql');
    expect(source, 'and the way out for somebody who already has a database').toContain(
      'TEST_DATABASE_URL=postgresql://',
    );
  });

  it('every command that asks whether it is running can find pg_ctl first', () => {
    // FOUND BY RUNNING IT. `status` called `is_running`, which shells out to
    // `pg_ctl` through `as_server_user` — and `PGBIN` is only set by
    // `require_pgbin`, which `status` did not call. So `status` reported "not
    // running" about a cluster that was running, one minute after its own `up`
    // printed the URL. A wrong answer, not an error, which is the shape this
    // repository keeps finding.
    for (const command of ['cmd_up', 'cmd_status']) {
      const start = code.indexOf(`${command}() {`);
      expect(start, `${command} is gone`).toBeGreaterThan(-1);
      const body = code.slice(start, code.indexOf('\n}\n', start));
      if (!body.includes('is_running')) continue;
      const needs = body.indexOf('require_pgbin');
      expect(needs, `${command} asks is_running without require_pgbin`).toBeGreaterThan(-1);
      expect(needs, `${command} asks is_running before require_pgbin`).toBeLessThan(
        body.indexOf('is_running'),
      );
    }
  });

  it('prints the URL on stdout and everything else on stderr', () => {
    // What makes `eval "$(./scripts/local-pg.sh up)"` work at all. One progress
    // line that forgot its `>&2` and the eval tries to run it as shell.
    const chatter = [...source.matchAll(/^\s*echo "\[local-pg\][^\n]*$/gm)].map((m) => m[0]);
    expect(chatter.length, 'no progress output at all').toBeGreaterThan(3);
    for (const line of chatter) {
      expect(line.trimEnd().endsWith('>&2'), `this line would land in the eval:\n${line}`).toBe(true);
    }
    const url = source.slice(source.indexOf('cmd_url() {'), source.indexOf('cmd_status() {'));
    expect(url, 'the URL must be eval-able as an export').toContain(
      "echo \"export TEST_DATABASE_URL='${URL}'\"",
    );
  });
});

/**
 * AND IT ACTUALLY WORKS, on any machine that can run it.
 *
 * Every case above reads the script. This one runs it — because a script that
 * is beautifully shaped and does not start a database is worth nothing, and
 * that is exactly the failure the source-only half cannot see.
 *
 * Its own directory and its own port, so it cannot disturb a cluster somebody
 * is using, and `down` in a `finally` so it leaves none of its own behind.
 */
describe.skipIf(!hasServer())('and it really does stand one up', () => {
  const env = {
    ...process.env,
    LOCAL_PG_DIR: '/tmp/ownpace-local-pg-selftest',
    LOCAL_PG_PORT: '55997',
    LOCAL_PG_DB: 'localpg_selftest',
  };
  const run = (arg: string): string =>
    execFileSync('bash', [SCRIPT, arg], { env, encoding: 'utf8', cwd: REPO_ROOT });

  it('brings up a cluster with both chains on it, then takes it away', () => {
    try {
      const up = run('up');
      expect(up).toContain("export TEST_DATABASE_URL='postgresql://");
      expect(up, 'the port it was told to use').toContain(':55997/localpg_selftest');

      // THE POINT OF ALL OF IT: a table from EACH chain. `tenant` is the
      // ledger's, `platform_operator` is the managed chain's, and a cluster
      // with only the first is the failure the order guard above describes.
      const url = /export TEST_DATABASE_URL='(?<u>[^']+)'/.exec(up)!.groups!.u!;
      const count = execFileSync(
        'psql',
        [url, '-Atc', `SELECT count(*) FROM information_schema.tables
                        WHERE table_schema = 'public'
                          AND table_name IN ('tenant', 'platform_operator', 'audit_log')`],
        { encoding: 'utf8' },
      ).trim();
      expect(count, 'a chain did not go on').toBe('3');

      expect(run('status')).toContain('55997');
    } finally {
      execFileSync('bash', [SCRIPT, 'down'], { env, encoding: 'utf8', cwd: REPO_ROOT });
    }
    // And `down` really removed it — a teardown that reports success without
    // removing anything is the same lie in the other direction.
    expect(existsSync('/tmp/ownpace-local-pg-selftest')).toBe(false);
  }, 120_000);
});
