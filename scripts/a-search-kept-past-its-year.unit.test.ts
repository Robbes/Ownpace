// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SEARCH KEPT PAST ITS YEAR (privacy §4.5 and §9; the owner's
 * privacy-search-records (a), 2026-09-28: 12 months).
 *
 * Every support-screen read is a `support_read` row (managed migration 0009):
 * who looked, at whose organisation, at which screen, and when; for a search,
 * what was searched for. An erasure deletes the rows that name the erased
 * organisation (`PURGED_TABLES` in `packages/managed/src/offboarding.ts`). The
 * rows that name none stay: a search by address across every customer
 * (`people`), a download of the audit log (`audit_export`), the organisation
 * list (`tenants`), the invoices kept after an erasure (`retained_invoices`), a
 * log page not filtered to one organisation (`log`). Privacy §4.5
 * says "they stay after that, and are deleted 12 months after they were
 * recorded", and until now nothing deleted them.
 *
 * THE APP CANNOT, AND THAT IS WHY THIS IS A DUTY AT THE MACHINE. The log is
 * append-only for `app_user`, the role every request runs as: 0009 grants it
 * `SELECT, INSERT` and revokes `UPDATE, DELETE` (the shared chain's default
 * privileges would otherwise have handed it DELETE on every new table), and
 * the table's row security is FORCEd with a policy for SELECT (an operator's
 * own rows) and one for INSERT, and none for DELETE, so even a grant would
 * find no row to delete. So `deploy/compose/support-read-prune.sh` deletes
 * them over the owner's connection, `psql` as `POSTGRES_USER` in the stack's
 * own database container, run daily by `box-duties.sh` with `--delete`.
 *
 * WHAT IS ASSERTED here, with a stand-in `docker` that records the SQL piped to
 * `psql` and answers a canned count (what that SQL deletes on a real database,
 * and that `app_user` really cannot, is
 * `a-search-kept-a-year-a-real-database-answers.integration.test.ts`):
 *
 *   - without `--delete` it counts and deletes nothing; with it, it deletes;
 *     both with one predicate: no organisation, recorded more than 12 months
 *     ago;
 *   - it prints a count, never an operator, a query or an organisation;
 *   - before it counts or deletes, it asks whether its connection passes row
 *     security (a superuser, or a role with BYPASSRLS), in the same call, and
 *     stops if not: the log's row security is FORCEd and has no DELETE policy,
 *     so any other owner would delete nothing, print "deleted 0" every day, and
 *     let the 12 months lapse in silence;
 *   - a database it cannot ask, or an answer that is not a count, fails;
 *   - its header names every read the support screens record with no
 *     organisation, so the operator knows which go at 12 months;
 *   - an argument it does not know is refused before anything is asked;
 *   - the migrations still make the log append-only for `app_user`.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT_REL = 'deploy/compose/support-read-prune.sh';
const SCRIPT = join(ROOT, SCRIPT_REL);

const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const code = (text: string): string =>
  text
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
/** SQL with its `--` comments removed. */
const sqlCode = (text: string): string =>
  text
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

const DOCKER_STUB = [
  '#!/usr/bin/env bash',
  'printf "%s\\n" "$*" >>"$STUB_DOCKER"',
  'case " $* " in',
  '  *" exec -i ownpace-live-db "*)',
  '    cat >>"$STUB_SQL"',
  '    if [ -n "${STUB_PSQL_FAIL:-}" ]; then',
  '      echo \'psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed\' >&2; exit 2',
  '    fi',
  // What psql says, with ON_ERROR_STOP, when the check the SQL opens with
  // raises: this connection does not pass row security.
  '    if [ -n "${STUB_BOUND:-}" ]; then',
  '      echo \'psql:<stdin>:9: ERROR:  support-read-prune: the role app_owner does not pass row security on support_read, and would find no row to remove\' >&2; exit 3',
  '    fi',
  '    printf "%s\\n" "${STUB_ANSWER-3}"; exit 0 ;;',
  'esac',
  'echo "docker stub: unexpected call: $*" >&2',
  'exit 98',
];

const LIVE_ENV = ['COMPOSE_PROJECT_NAME=ownpace-live', 'STACK_KIND=production', 'POSTGRES_PASSWORD=sentinel-5d2e9a', ''].join(
  '\n',
);

function run(args: string[], env: NodeJS.ProcessEnv = {}) {
  if (!existsSync(SCRIPT)) throw new Error(`${SCRIPT_REL} does not exist`);
  const root = mkdtempSync(join(tmpdir(), 'support-read-prune-'));
  tempDirs.push(root);
  const compose = join(root, 'deploy', 'compose');
  mkdirSync(compose, { recursive: true });
  for (const f of ['support-read-prune.sh', 'env-read.sh', 'managed.yml']) copyFileSync(join(ROOT, 'deploy/compose', f), join(compose, f));
  chmodSync(join(compose, 'support-read-prune.sh'), 0o755);
  writeFileSync(join(compose, '.env'), LIVE_ENV);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'docker'), `${DOCKER_STUB.join('\n')}\n`);
  chmodSync(join(bin, 'docker'), 0o755);
  const log = join(root, 'docker.log');
  const sql = join(root, 'sql.log');
  writeFileSync(log, '');
  writeFileSync(sql, '');
  const r = spawnSync(join(compose, 'support-read-prune.sh'), args, {
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, HOME: root, STUB_DOCKER: log, STUB_SQL: sql, ...env },
    cwd: root,
    timeout: 30_000,
  });
  return {
    status: r.status ?? -1,
    out: `${r.stdout ?? ''}${r.stderr ?? ''}`,
    docker: readFileSync(log, 'utf8').split('\n').filter(Boolean),
    sql: readFileSync(sql, 'utf8'),
  };
}

/** The one predicate, as the SQL spells it, whitespace folded. */
const PREDICATE = /WHERE tenant_id IS NULL AND at < now\(\) - interval '12 months'/;
const fold = (s: string) => sqlCode(s).replace(/\s+/g, ' ');

describe('the support log keeps a read with no organisation for 12 months, and no longer', () => {
  it('without --delete: counts, deletes nothing, and says so', () => {
    const r = run([]);
    expect(r.status, r.out).toBe(0);
    expect(fold(r.sql)).toMatch(PREDICATE);
    expect(fold(r.sql)).toMatch(/SELECT count\(\*\) FROM public\.support_read/);
    expect(r.sql, 'a count that deletes').not.toMatch(/\bDELETE\b/i);
    expect(r.out).toMatch(/\b3\b/);
    expect(r.out).toMatch(/nothing deleted/i);
  });

  it('with --delete: deletes with the same predicate, and says how many', () => {
    const r = run(['--delete'], { STUB_ANSWER: '2' });
    expect(r.status, r.out).toBe(0);
    expect(fold(r.sql)).toMatch(/DELETE FROM public\.support_read WHERE/);
    expect(fold(r.sql)).toMatch(PREDICATE);
    expect(r.out).toMatch(/deleted 2\b/);
  });

  it('asks its own stack\'s database, as its owner, and never through the app\'s role', () => {
    const r = run([]);
    const exec = r.docker.find((d) => d.startsWith('exec -i ownpace-live-db '));
    expect(exec, r.docker.join('\n')).toBeDefined();
    expect(exec).toContain('$POSTGRES_USER');
    expect(exec).toContain('ON_ERROR_STOP=1');
    expect(exec).not.toMatch(/app_user|APP_DB_USER/);
  });

  it('asks whether its connection passes row security before it counts or deletes, in the same call', () => {
    for (const args of [[], ['--delete']]) {
      const r = run(args);
      const sql = fold(r.sql);
      const check = sql.search(/SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user/);
      const work = sql.search(/DELETE FROM public\.support_read|SELECT count\(\*\) FROM public\.support_read/);
      expect(check, sql).toBeGreaterThanOrEqual(0);
      expect(work, sql).toBeGreaterThan(check);
      // It stops the call, rather than printing an answer somebody could miss.
      expect(sql.slice(check, work)).toMatch(/RAISE EXCEPTION/);
      expect(r.docker.filter((d) => d.startsWith('exec -i ownpace-live-db ')), 'one call').toHaveLength(1);
    }
  });

  it('a connection that does not pass row security fails, and is never "deleted 0"', () => {
    for (const args of [[], ['--delete']]) {
      const r = run(args, { STUB_BOUND: '1' });
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).not.toMatch(/deleted \d/);
      expect(r.out).toMatch(/does not pass row security/);
    }
  });

  it('names in its header every read the support screens record with no organisation', () => {
    // `recordSupportRead(db, { ..., tenantId: null, view: '<view>' })` in the
    // support routes: each goes at 12 months, and the operator reads which in
    // the header and the runbook.
    const routes = read('apps/api/src/routes/support.ts');
    const views = [...routes.matchAll(/tenantId: null,\s*view: '([a-z_]+)'/g)].map((m) => m[1]);
    expect(views.length, 'no read with no organisation found: the pattern no longer matches the routes').toBeGreaterThanOrEqual(4);
    const header = read(SCRIPT_REL).split('\nset -euo pipefail')[0] ?? '';
    for (const v of [...views, 'log']) expect(header, v).toContain(`\`${v}\``);
  });

  it('a database it cannot ask fails, and is never "nothing to delete"', () => {
    for (const args of [[], ['--delete']]) {
      const r = run(args, { STUB_PSQL_FAIL: '1' });
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).not.toMatch(/deleted \d/);
    }
  });

  it('an answer that is not a count fails', () => {
    for (const answer of ['', 'DELETE 2', 'ERROR:  relation "support_read" does not exist']) {
      const r = run(['--delete'], { STUB_ANSWER: answer });
      expect(r.status, `${JSON.stringify(answer)}: ${r.out}`).not.toBe(0);
    }
  });

  it('refuses an argument it does not know, before it asks anything', () => {
    for (const args of [['--apply'], ['--delete', 'now']]) {
      const r = run(args);
      expect(r.status, r.out).toBe(2);
      expect(r.docker).toEqual([]);
    }
  });

  it('prints a count, and no value from the .env', () => {
    const r = run(['--delete']);
    expect(r.out).not.toContain('sentinel-5d2e9a');
    expect(r.out).not.toMatch(/operator_user_id|query/);
  });

  it('is written the way the scripts beside it are', () => {
    const text = read(SCRIPT_REL);
    expect(text).toMatch(/^set -euo pipefail$/m);
    expect(text).toMatch(/^\. "\$\{SCRIPT_DIR\}\/env-read\.sh"$/m);
    expect(code(text)).toMatch(/\bcompose_project\b/);
    expect(code(text)).not.toMatch(/set\s+-[a-wyz]*x/);
  });
});

describe('the app cannot delete from the log, which is why this runs at the machine', () => {
  const managed = readdirSync(join(ROOT, 'packages/managed/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => ({ f, text: sqlCode(read(`packages/managed/migrations/${f}`)) }));
  const ledger = readdirSync(join(ROOT, 'packages/ledger/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => ({ f, text: sqlCode(read(`packages/ledger/migrations/${f}`)) }));

  it('0009 revokes UPDATE and DELETE from app_user, and grants it SELECT and INSERT only', () => {
    const m = managed.find((x) => x.f.startsWith('0009_'));
    expect(m?.text).toMatch(/REVOKE UPDATE, DELETE ON TABLE public\.support_read FROM app_user;/);
    expect(m?.text).toMatch(/GRANT SELECT, INSERT ON TABLE public\.support_read TO app_user;/);
    expect(m?.text).toMatch(/ALTER TABLE ONLY public\.support_read FORCE ROW LEVEL SECURITY;/);
  });

  it('no migration grants DELETE on it, or gives it a policy a DELETE could pass', () => {
    for (const { f, text } of [...ledger, ...managed]) {
      for (const stmt of text.split(';')) {
        const s = stmt.replace(/\s+/g, ' ');
        if (!/\bsupport_read\b/.test(s)) continue;
        expect(/\bGRANT\b[^;]*\b(DELETE|ALL)\b[^;]*\bON\b[^;]*\bsupport_read\b/i.test(s), `${f}: ${s}`).toBe(false);
        expect(/\bCREATE POLICY\b[^;]*\bON\b[^;]*\bsupport_read\b[^;]*\bFOR (DELETE|ALL)\b/i.test(s), `${f}: ${s}`).toBe(false);
      }
    }
  });
});
