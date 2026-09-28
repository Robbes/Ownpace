// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SUPERUSER THE BRING-UP WOULD HAVE UPLOADED (workplan 0138 T3 step 2).
 *
 * Since T3 step 2 the jobs that span organisations (the sync tick, retention,
 * the purge of closed organisations), the split jobs' list of organisations
 * and every task's audit key connect as `ownpace_system`, the system role,
 * through `SYSTEM_DATABASE_URL`, which `deploy/compose/set-task-env.sh`
 * uploads to every run. Managed migration 0032 creates the role with
 * `NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION BYPASSRLS` and no
 * password, and grants it the statements those jobs send and nothing more.
 *
 * What the migration wrote is not what the database holds for ever: a role is
 * cluster-global, anyone with the owner's socket can `ALTER ROLE` it, and a
 * role that is a member of another takes that role's rights, the owner's
 * included, with one `SET ROLE`. The plan's step 2 says the bring-up asks
 * Postgres whether the system role is a superuser or may create roles, and
 * refuses to continue if it is or may, before its URL goes to every run. So
 * `bootstrap-managed.sh`'s `tasks` phase, which every bring-up runs (the
 * nightly gate's, `deploy-live.sh`'s, `stand-up-live.sh`'s), asks first, with
 * `db_roles_system_fit` (`deploy/compose/db-roles.sh`), and only then sets
 * the role's password from `.env`'s `SYSTEM_DB_PASSWORD`
 * (`db_roles_system_set`), proves it opens where the tasks connect
 * (`db_roles_system_prove`), and runs `set-task-env.sh`.
 *
 * HOW IT RUNS. `db-roles.sh` is sourced in a bash of its own, from a
 * directory holding copies of it and the files it sources, with `COMPOSE`
 * pointed at a stand-in that records every argument, the one environment
 * value the set passes by name, and the SQL on its standard input, and
 * answers the role question with the line a case gives it. No database, no
 * docker. The password is made here, at random, and must appear in the
 * stand-in's environment and nowhere else.
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
const MIGRATION = 'packages/managed/migrations/0032_a_system_role_that_is_not_the_owner.sql';

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

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
 * create database, replication, BYPASSRLS, login, the roles it belongs to.
 */
const FIT = 'f|f|f|f|t|t|0';
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
    ['the owner itself, as the stack creates it', 't|t|t|t|t|t|0', /superuser.*create roles.*create databases/],
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

  it('refuses an empty password, which Postgres would take as none', () => {
    const a = ask("db_roles_system_set ''");
    expect(rcOf(a), a.out).toBe('1');
    expect(a.argv).toBe('');
  });
});

describe('every bring-up runs the question, and stops, before set-task-env.sh', () => {
  const bootstrap = read('deploy/compose/bootstrap-managed.sh');
  const body = (name: string): string => {
    const start = bootstrap.indexOf(`\n${name}() {`);
    expect(start, `bootstrap-managed.sh defines no ${name}()`).toBeGreaterThan(-1);
    return bootstrap.slice(start, bootstrap.indexOf('\n}\n', start));
  };

  it('the tasks phase readies the system role before it uploads the environment and deploys', () => {
    const tasks = body('phase_tasks');
    const ready = tasks.indexOf('system_role_ready');
    const upload = tasks.indexOf('set-task-env.sh');
    expect(ready, 'phase_tasks does not call system_role_ready').toBeGreaterThan(-1);
    expect(upload).toBeGreaterThan(ready);
    expect(tasks.indexOf('deploy-tasks.sh')).toBeGreaterThan(upload);
  });

  it('system_role_ready asks, then sets, then proves, and dies on anything but a fit role', () => {
    const ready = body('system_role_ready');
    const fit = ready.indexOf('db_roles_system_fit');
    const set = ready.indexOf('db_roles_system_set');
    const prove = ready.indexOf('db_roles_system_prove');
    expect(fit).toBeGreaterThan(-1);
    expect(set).toBeGreaterThan(fit);
    expect(prove).toBeGreaterThan(set);
    // A role that is unfit, or a question that could not be asked, stops the
    // bring-up; nothing between the question and the die lets it through.
    const verdict = ready.slice(fit, set);
    expect(verdict).toMatch(/1\)\s*die /);
    expect(verdict).toMatch(/\*\)\s*die /);
    expect(ready).toContain('SYSTEM_DB_PASSWORD');
  });

  it('is the bring-up deploy-live.sh runs, and the one stand-up-live.sh runs to the tasks', () => {
    expect(read('deploy/compose/deploy-live.sh')).toMatch(/bootstrap-managed\.sh" --from data/);
    expect(read('deploy/compose/stand-up-live.sh')).toMatch(/bootstrap-managed\.sh.*--from trigger/);
  });
});

describe('the role the bring-up asks about is the one the migration creates and the upload names', () => {
  it('one name in the migration, db-roles.sh and set-task-env.sh', () => {
    expect(read(MIGRATION)).toMatch(new RegExp(`CREATE ROLE ${SYSTEM_ROLE}\\b`));
    expect(read('deploy/compose/db-roles.sh')).toContain(`DB_ROLES_SYSTEM='${SYSTEM_ROLE}'`);
    expect(read('deploy/compose/set-task-env.sh')).toContain(`postgresql://${SYSTEM_ROLE}:\${SYSTEM_DB_PASSWORD}@`);
  });

  it('its password is generated into .env, and the example ships none', () => {
    expect(read('deploy/compose/ensure-env-secrets.sh')).toMatch(/^ensure SYSTEM_DB_PASSWORD \d+$/m);
    expect(read('deploy/compose/managed.env.example')).toMatch(/^SYSTEM_DB_PASSWORD=$/m);
    // The migration gives the role no password: a value here would be public.
    expect(read(MIGRATION)).not.toMatch(/PASSWORD\s+'/);
  });
});
