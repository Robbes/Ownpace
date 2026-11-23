// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SUPERUSER THE BRING-UP WOULD HAVE UPLOADED (workplan 0138 T3 step 2).
 *
 * Since T3 step 2 the jobs that span organisations (the sync tick, retention,
 * the purge of closed organisations), the split jobs' list of organisations
 * and every job's audit key connect as `ownpace_system`, the system role,
 * through `SYSTEM_DATABASE_URL`, which the `worker` service carries for every
 * run (`deploy/compose/managed.yml`; until alpha.18 `set-task-env.sh` uploaded
 * it to Trigger.dev's task environment, workplan 0167 T9). Managed migration
 * 0033 creates the role with `NOSUPERUSER NOCREATEROLE NOCREATEDB
 * NOREPLICATION BYPASSRLS` and no password, and grants it the statements
 * those jobs send and nothing more.
 *
 * What the migration wrote is not what the database holds for ever: a role is
 * cluster-global, anyone with the owner's socket can `ALTER ROLE` it, and
 * membership works both ways: a role this one belongs to lends it its rights
 * (the owner's, a superuser's) with one `SET ROLE`, and a role that belongs
 * to THIS one (`GRANT ownpace_system TO app_user`) takes its `BYPASSRLS` and
 * its grants the same way, so the API's own request role would read every
 * organisation's rows. The plan's step 2 says the bring-up asks Postgres
 * whether the system role is a superuser or may create roles, and refuses to
 * continue if it is or may, before its URL goes to every run. So
 * `bootstrap-managed.sh`'s `app` phase, which every bring-up runs (the
 * nightly gate's, `deploy-live.sh`'s, `stand-up-live.sh`'s), asks first, with
 * `db_roles_system_fit` (`deploy/compose/db-roles.sh`), and only then sets
 * the role's password from `.env`'s `SYSTEM_DB_PASSWORD` and clears any
 * setting left on the role (`db_roles_system_set`: an ordinary role may set
 * its own, and every run holds its URL), proves it opens where the worker
 * connects (`db_roles_system_prove`), and only then starts the worker.
 *
 * HOW IT RUNS. `db-roles.sh` is sourced in a bash of its own, from a
 * directory holding copies of it and the files it sources, with `COMPOSE`
 * pointed at a stand-in that records every argument, the one environment
 * value the set passes by name, and the SQL on its standard input, and
 * answers the role question with the line a case gives it. No database, no
 * docker. The password is made here, at random, and must appear in the
 * stand-in's environment and nowhere else.
 *
 * The question itself RUNS, rather than being read: `system_role_ready` is
 * taken out of `bootstrap-managed.sh` as it is and run in a bash of its own,
 * under the script's own `set -euo pipefail`, with `db-roles.sh` a stand-in
 * whose question answers what a case says, followed by a stand-in for the
 * worker's start, and `ensure-env-secrets.sh` a stand-in that records that it
 * ran. A refusal commented out, skipped on a path, or answered and ignored
 * starts the worker, and is red. The app phase's own statements are held to
 * calling it before the worker, unconditionally.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(REPO_ROOT, 'deploy', 'compose');
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

/** The role, as the migration names it. */
const SYSTEM_ROLE = 'ownpace_system';
const MIGRATION = 'packages/managed/migrations/0033_a_system_role_that_is_not_the_owner.sql';

const tempDirs: string[] = [];
// Many large temp folders can outlast vitest's 10 s hook timeout on a loaded run.
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
}, 120_000);

/** A directory with db-roles.sh and what it sources, a `.env`, and the stand-in for Compose. */
function aCheckout(): string {
  const dir = mkdtempSync(join(tmpdir(), 'system-role-'));
  tempDirs.push(dir);
  for (const f of ['db-roles.sh', 'env-read.sh', 'own-addresses.sh', 'stack-kind.sh', 'managed.yml']) {
    copyFileSync(join(COMPOSE_DIR, f), join(dir, f));
  }
  writeFileSync(join(dir, '.env'), 'POSTGRES_USER=ownpace_owner\nPOSTGRES_DB=ownpace\n');
  // Compose, as far as db-roles.sh asks it anything: every argument, the value
  // the set passes by name, and the SQL, recorded; the role question answered.
  writeFileSync(
    join(dir, 'compose-stand-in'),
    [
      '#!/usr/bin/env bash',
      'printf "%s\\n" "$*" >>"$STAND_IN_LOG/argv"',
      'printf "%s\\n" "${DB_ROLES_NEW_SYSTEM_PASSWORD-<unset>}" >>"$STAND_IN_LOG/env"',
      'cat >>"$STAND_IN_LOG/sql"',
      'printf "%s" "$STAND_IN_ANSWER"',
      'exit "${STAND_IN_EXIT:-0}"',
      '',
    ].join('\n'),
  );
  chmodSync(join(dir, 'compose-stand-in'), 0o755);
  return dir;
}

interface Asked {
  status: number | null;
  out: string;
  argv: string;
  env: string;
  sql: string;
}

/** Source db-roles.sh, run `call`, and say what it answered and what the stand-in saw. */
function ask(call: string, answer = '', exit = 0, extraEnv: Record<string, string> = {}): Asked {
  const dir = aCheckout();
  const script = [
    'set -uo pipefail',
    `SCRIPT_DIR='${dir}'`,
    `COMPOSE=('${dir}/compose-stand-in')`,
    '. "${SCRIPT_DIR}/db-roles.sh"',
    'db_roles_init "${SCRIPT_DIR}/.env" || exit 90',
    `${call}; rc=$?`,
    'printf "rc=%s\\nwhy=%s\\n" "$rc" "${DB_ROLES_WHY:-}"',
  ].join('\n');
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: dir,
    STAND_IN_LOG: dir,
    STAND_IN_ANSWER: answer,
    STAND_IN_EXIT: String(exit),
    ...extraEnv,
  };
  const r = spawnSync('bash', ['-c', script], { env, encoding: 'utf8' });
  const logged = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : '');
  return { status: r.status, out: `${r.stdout}${r.stderr}`, argv: logged('argv'), env: logged('env'), sql: logged('sql') };
}

const rcOf = (a: Asked) => /rc=(\d+)/.exec(a.out)?.[1];
const whyOf = (a: Asked) => /why=(.*)/.exec(a.out)?.[1] ?? '';

/**
 * The line the role question answers, in its order: superuser, create role,
 * create database, replication, BYPASSRLS, login, the roles it belongs to,
 * and the roles that belong to it.
 */
const FIT = 'f|f|f|f|t|t|0|0';
const withField = (index: number, value: string) => FIT.split('|').map((v, i) => (i === index ? value : v)).join('|');

describe('the bring-up asks Postgres about the system role before its URL goes to every run', () => {
  it('passes a role that is no superuser, creates no role or database, belongs to no role, and bypasses row security', () => {
    const a = ask('db_roles_system_fit', FIT);
    expect(rcOf(a), a.out).toBe('0');
    expect(whyOf(a)).toBe('');
  });

  it.each([
    ['a superuser', withField(0, 't'), /superuser/],
    ['a role that may create roles', withField(1, 't'), /create roles/],
    ['a role that may create databases', withField(2, 't'), /create databases/],
    ['a role that may replicate', withField(3, 't'), /replicat/],
    ['a role without BYPASSRLS, which would find no organisation', withField(4, 'f'), /BYPASSRLS/],
    ['a role that cannot log in', withField(5, 'f'), /log in/],
    ['a role that belongs to another, whose rights it can take with SET ROLE', withField(6, '1'), /belongs to/],
    ['a role another belongs to, which can take its BYPASSRLS with SET ROLE', withField(7, '1'), /belong to it/],
    ['the owner itself, as the stack creates it', 't|t|t|t|t|t|0|0', /superuser.*create roles.*create databases/],
    ['a role the migration has not created', '', /is not a role/],
  ])('refuses %s', (_label, answer, why) => {
    const a = ask('db_roles_system_fit', answer);
    expect(rcOf(a), a.out).toBe('1');
    expect(whyOf(a)).toMatch(why);
    expect(whyOf(a)).toContain(SYSTEM_ROLE);
  });

  it('says a question it could not ask is not an answer', () => {
    const a = ask('db_roles_system_fit', 'psql: error: connection to server failed: Connection refused', 2);
    expect(rcOf(a), a.out).toBe('2');
  });

  it("asks over the database's socket as the owner, naming the role by a psql variable", () => {
    const a = ask('db_roles_system_fit', FIT);
    expect(a.argv).toMatch(/^exec -T postgres psql /m);
    expect(a.argv).toContain('-U ownpace_owner');
    expect(a.argv).toContain(`-v system_role=${SYSTEM_ROLE}`);
    // Every attribute the answer is read for, and the memberships, asked of the catalog.
    for (const column of ['rolsuper', 'rolcreaterole', 'rolcreatedb', 'rolreplication', 'rolbypassrls', 'rolcanlogin']) {
      expect(a.sql).toContain(column);
    }
    expect(a.sql).toContain('pg_auth_members');
    // Membership both ways: the roles it belongs to, and the roles that belong to it.
    expect(a.sql).toMatch(/m\.member = r\.oid/);
    expect(a.sql).toMatch(/m\.roleid = r\.oid/);
    expect(a.sql).toMatch(/rolname = :'system_role'/);
  });

  it('sets its password by name, never on a command line, and keeps the statement out of the log', () => {
    const value = randomBytes(12).toString('hex');
    const a = ask(`db_roles_system_set '${value}'`);
    expect(rcOf(a), a.out).toBe('0');
    expect(a.argv).not.toContain(value);
    expect(a.sql).not.toContain(value);
    expect(a.out.replace(`db_roles_system_set '${value}'`, '')).not.toContain(value);
    expect(a.env.trim()).toBe(value);
    expect(a.argv).toMatch(/exec -T -e DB_ROLES_NEW_SYSTEM_PASSWORD postgres psql/);
    expect(a.sql).toMatch(/ALTER ROLE :"system_role" PASSWORD :'system_pw';/);
    expect(a.sql).toContain('SET log_min_error_statement = panic;');
    expect(a.sql).toContain("SET log_statement = 'none';");
  });

  it('clears every setting left on the role, in every database and in this one, with its password, in one transaction', () => {
    // An ordinary role may set its own settings, and every run holds this role's URL: a run taken
    // over could leave default_transaction_read_only = on, which a new password does not clear.
    // a-system-role-that-is-not-the-owner runs these statements against Postgres.
    const a = ask(`db_roles_system_set '${randomBytes(12).toString('hex')}'`);
    expect(rcOf(a), a.out).toBe('0');
    const statements = a.sql.split('\n').map((l) => l.trim());
    const begin = statements.indexOf('BEGIN;');
    const password = statements.findIndex((l) => /^ALTER ROLE :"system_role" PASSWORD :'system_pw';$/.test(l));
    const everywhere = statements.indexOf('ALTER ROLE :"system_role" RESET ALL;');
    const here = statements.indexOf('ALTER ROLE :"system_role" IN DATABASE :"DBNAME" RESET ALL;');
    const commit = statements.indexOf('COMMIT;');
    expect(begin, a.sql).toBeGreaterThan(-1);
    for (const at of [password, everywhere, here]) {
      expect(at, a.sql).toBeGreaterThan(begin);
      expect(at, a.sql).toBeLessThan(commit);
    }
  });

  it('refuses an empty password, which Postgres would take as none', () => {
    const a = ask("db_roles_system_set ''");
    expect(rcOf(a), a.out).toBe('1');
    expect(a.argv).toBe('');
  });
});

describe('every bring-up runs the question, and stops, before the worker starts with the URL', () => {
  const bootstrap = read('deploy/compose/bootstrap-managed.sh');
  /** A function of bootstrap-managed.sh, as it is written there: `name() {` to the `}` that ends it. */
  const definition = (name: string): string => {
    const start = bootstrap.indexOf(`\n${name}() {`);
    expect(start, `bootstrap-managed.sh defines no ${name}()`).toBeGreaterThan(-1);
    const oneLine = new RegExp(`^${name}\\(\\) \\{.*\\}$`, 'm').exec(bootstrap.slice(start + 1));
    if (oneLine && oneLine.index === 0) return oneLine[0];
    return bootstrap.slice(start + 1, bootstrap.indexOf('\n}\n', start) + 2);
  };

  interface Ran {
    status: number | null;
    out: string;
    /** What ran, in order: fit, set, prove, the worker, and each stand-in with its arguments. */
    steps: string[];
  }

  /**
   * system_role_ready, as bootstrap-managed.sh writes it, then the worker's
   * start (a stand-in), as phase_app runs them, under the script's own
   * `set -euo pipefail`, with db-roles.sh and ensure-env-secrets.sh stand-ins
   * answering what `answers` says.
   */
  function readyThenWorker(answers: Record<string, string> = {}, env = ''): Ran {
    const dir = mkdtempSync(join(tmpdir(), 'system-role-ready-'));
    tempDirs.push(dir);
    copyFileSync(join(COMPOSE_DIR, 'env-read.sh'), join(dir, 'env-read.sh'));
    writeFileSync(join(dir, '.env'), env);
    const record = (what: string) => `printf '%s\\n' "${what}" >>"$STAND_IN_LOG"`;
    writeFileSync(
      join(dir, 'db-roles.sh'),
      [
        "DB_ROLES_SYSTEM='ownpace_system'",
        'db_roles_init() { :; }',
        `db_roles_system_fit() { ${record('fit')}; DB_ROLES_WHY='ownpace_system: it is a superuser'; return "\${STAND_IN_FIT:-0}"; }`,
        `db_roles_system_set() { ${record('set')}; return "\${STAND_IN_SET:-0}"; }`,
        `db_roles_system_prove() { ${record('prove')}; DB_ROLES_PROOF="ownpace_system|pooler|\${STAND_IN_PROVE:-0}|"; return "\${STAND_IN_PROVE:-0}"; }`,
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(dir, 'ensure-env-secrets.sh'),
      ['#!/usr/bin/env bash', `printf '%s\\n' "ensure-env-secrets.sh" >>"$STAND_IN_LOG"`, 'exit 0', ''].join('\n'),
    );
    chmodSync(join(dir, 'ensure-env-secrets.sh'), 0o755);
    const harness = [
      'set -euo pipefail',
      `SCRIPT_DIR='${dir}'`,
      'ENV_FILE="${SCRIPT_DIR}/.env"',
      '. "${SCRIPT_DIR}/env-read.sh"',
      definition('say'),
      definition('note'),
      definition('die'),
      definition('env_get'),
      definition('system_role_ready'),
      `worker_up() { ${record('worker')}; }`,
      'system_role_ready',
      'worker_up',
    ].join('\n');
    const log = join(dir, 'ran');
    const r = spawnSync('bash', ['-c', harness], {
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, STAND_IN_LOG: log, ...answers },
      encoding: 'utf8',
    });
    const steps = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
    return { status: r.status, out: `${r.stdout}${r.stderr}`, steps };
  }

  const withPassword = () => `SYSTEM_DB_PASSWORD=${randomBytes(12).toString('hex')}\n`;

  it('a fit role: asked, set, proven, then the worker', () => {
    const r = readyThenWorker({}, withPassword());
    expect(r.status, r.out).toBe(0);
    expect(r.steps).toEqual(['fit', 'set', 'prove', 'worker']);
  });

  it.each([
    ['a role that is unfit', { STAND_IN_FIT: '1' }, /REFUSED.*superuser/],
    ['a question that could not be asked', { STAND_IN_FIT: '2' }, /could not ask Postgres/],
  ])('%s stops the bring-up before a password is set or the worker starts', (_label, answers, why) => {
    const r = readyThenWorker(answers, withPassword());
    expect(r.status, r.out).not.toBe(0);
    expect(r.out).toMatch(why);
    expect(r.steps).toEqual(['fit']);
  });

  it.each([
    ['a password that did not set', { STAND_IN_SET: '1' }, ['fit', 'set']],
    ['a password that does not open where the worker connects', { STAND_IN_PROVE: '1' }, ['fit', 'set', 'prove']],
    ['a password that could not be tried', { STAND_IN_PROVE: '2' }, ['fit', 'set', 'prove']],
  ])('%s stops it before the worker', (_label, answers, steps) => {
    const r = readyThenWorker(answers, withPassword());
    expect(r.status, r.out).not.toBe(0);
    expect(r.steps).toEqual(steps);
  });

  it('a password a URL does not carry as it is stops it before the question', () => {
    const r = readyThenWorker({}, 'SYSTEM_DB_PASSWORD=a/b@c\n');
    expect(r.status, r.out).not.toBe(0);
    expect(r.steps).toEqual([]);
  });

  it('a .env with no password yet has one generated, and is asked about as any other', () => {
    const r = readyThenWorker({}, '');
    // The stand-in generates nothing, so it stops on the empty value: after asking for it.
    expect(r.status, r.out).not.toBe(0);
    expect(r.steps).toEqual(['ensure-env-secrets.sh']);
  });

  it('phase_app asks it unconditionally, as a statement of its own, before the worker is readied and started', () => {
    // Behaviour above cannot see a skip keyed on a variable it does not set
    // (`[ "${SKIP:-0}" = 1 ] || system_role_ready`), so the phase's statements
    // are held to what they are. Comments and blank lines do not count.
    const statements = definition('phase_app')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'));
    const at = (what: string) => statements.indexOf(what);
    expect(at('system_role_ready'), 'phase_app does not ask the system role as a statement of its own').toBeGreaterThan(-1);
    expect(at('worker_ready_to_start')).toBe(at('system_role_ready') + 1);
    expect(at('worker_up "$api_before" "$api_after"')).toBe(at('system_role_ready') + 2);
    // Nothing before it in the phase starts the worker.
    expect(statements.slice(0, at('system_role_ready')).filter((l) => /\bworker_up\b|up\b.*\bworker\b/.test(l))).toEqual([]);
  });

  it('there is no tasks phase any more, and nothing calls set-task-env.sh (0167 T9)', () => {
    expect(bootstrap).not.toMatch(/\nphase_tasks\(\) \{/);
    expect(bootstrap.split('\n').filter((l) => !/^\s*#/.test(l) && /set-task-env\.sh|deploy-tasks\.sh/.test(l))).toEqual([]);
  });

  it('is the bring-up deploy-live.sh runs, and the one stand-up-live.sh runs from the plane phase on', () => {
    expect(read('deploy/compose/deploy-live.sh')).toMatch(/bootstrap-managed\.sh" --from data/);
    expect(read('deploy/compose/stand-up-live.sh')).toMatch(/bootstrap-managed\.sh.*--from plane/);
  });
});

describe('the role the bring-up asks about is the one the migration creates and the worker connects as', () => {
  it('one name in the migration, db-roles.sh and the worker service', () => {
    expect(read(MIGRATION)).toMatch(new RegExp(`CREATE ROLE ${SYSTEM_ROLE}\\b`));
    expect(read('deploy/compose/db-roles.sh')).toContain(`DB_ROLES_SYSTEM='${SYSTEM_ROLE}'`);
    expect(read('deploy/compose/managed.yml')).toContain(`SYSTEM_DATABASE_URL: postgresql://${SYSTEM_ROLE}:\${SYSTEM_DB_PASSWORD:-}@`);
  });

  it('its password is generated into .env, and the example ships none', () => {
    expect(read('deploy/compose/ensure-env-secrets.sh')).toMatch(/^ensure SYSTEM_DB_PASSWORD \d+$/m);
    expect(read('deploy/compose/managed.env.example')).toMatch(/^SYSTEM_DB_PASSWORD=$/m);
    // The migration gives the role no password: a value here would be public.
    expect(read(MIGRATION)).not.toMatch(/PASSWORD\s+'/);
  });
});
