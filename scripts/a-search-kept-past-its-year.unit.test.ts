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
 * `app_user` CANNOT, NOTHING ELSE MAY BY AGE, AND THAT IS WHY THIS IS A DUTY AT
 * THE MACHINE. The log is append-only for `app_user`, the role every request
 * runs as: 0009 grants it `SELECT, INSERT` and revokes `UPDATE, DELETE` (the
 * shared chain's default privileges would otherwise have handed it DELETE on
 * every new table), and the table's row security is FORCEd with a policy for
 * SELECT (an operator's own rows) and one for INSERT, and none for DELETE, so
 * even a grant would find no row to delete. The purge of closed organisations
 * deletes an erased organisation's rows: today as the owner, since every
 * Trigger.dev run still receives the owner's URL; after 0138 T3 step 2 as the
 * tasks' system role, `ownpace_system`, which that step's managed migration
 * grants `SELECT (tenant_id), DELETE` here and nothing more. It bypasses row
 * security, so it can delete by organisation, and it can read no other
 * column, so it can never pick a row by its age. A guard that said "no
 * migration grants DELETE on it" would have failed on that grant (a trial
 * merge, 2026-09-29) while meaning `app_user`; it says so now, and a second
 * holds every other grantee to the organisation column. So the 12-month prune
 * stays with the owner: `deploy/compose/support-read-prune.sh` deletes the
 * rows over the owner's connection, `psql` as `POSTGRES_USER` in the stack's
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
 *   - no migration lets `app_user` or `PUBLIC` delete from the log or change
 *     it, or gives it a DELETE policy; any other role a migration grants on it
 *     may read only `tenant_id`, and delete: it can purge by organisation and
 *     cannot pick a row by its age;
 *   - every place that says why this runs at the machine (the script, the
 *     duty, the runbook, the bring-up's duty row, 0139, `site/legal/README.md`
 *     and privacy §9's comment in both languages) names `app_user` as the role
 *     that cannot, and 0138 T3 step 2's system role as one that may, for the
 *     purge only; none says "the app cannot delete from this log", or calls
 *     the owner's "the one connection that may".
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

describe('who may delete from the log: never app_user, and nobody by its age but the owner at the machine', () => {
  const managed = readdirSync(join(ROOT, 'packages/managed/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => ({ f, text: sqlCode(read(`packages/managed/migrations/${f}`)) }));
  const ledger = readdirSync(join(ROOT, 'packages/ledger/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => ({ f, text: sqlCode(read(`packages/ledger/migrations/${f}`)) }));
  const statements = [...ledger, ...managed].flatMap(({ f, text }) =>
    text.split(';').map((stmt) => ({ f, s: stmt.replace(/\s+/g, ' ').trim() })),
  );

  /** Split on the commas outside parentheses: `SELECT (a, b), DELETE` is two privileges. */
  const topLevel = (list: string): string[] => {
    const out: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of list) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };

  /**
   * Every GRANT of a privilege on `support_read`, by name or through `ALL
   * TABLES IN SCHEMA public`, one row per grantee: `GRANT <privileges> ON
   * [TABLE] <tables> TO <grantees>`. A role granted to a role (`GRANT x TO y`)
   * has no ON and is not one.
   */
  const grants = statements.flatMap(({ f, s }) => {
    const m = /^GRANT (.+?) ON (?:TABLE )?(.+?) TO (.+?)(?: WITH GRANT OPTION)?$/i.exec(s);
    if (!m) return [];
    const [, privileges = '', tables = '', grantees = ''] = m;
    const onIt =
      /^ALL TABLES IN SCHEMA public$/i.test(tables) ||
      topLevel(tables).some((t) => /^(public\.)?support_read$/i.test(t.replace(/"/g, '')));
    if (!onIt) return [];
    return topLevel(grantees).map((grantee) => ({
      f,
      s,
      grantee: grantee.replace(/"/g, '').toLowerCase(),
      privileges: topLevel(privileges).map((p) => p.replace(/\s+/g, ' ').toUpperCase()),
    }));
  });

  it('0009 revokes UPDATE and DELETE from app_user, and grants it SELECT and INSERT only', () => {
    const m = managed.find((x) => x.f.startsWith('0009_'));
    expect(m?.text).toMatch(/REVOKE UPDATE, DELETE ON TABLE public\.support_read FROM app_user;/);
    expect(m?.text).toMatch(/GRANT SELECT, INSERT ON TABLE public\.support_read TO app_user;/);
    expect(m?.text).toMatch(/ALTER TABLE ONLY public\.support_read FORCE ROW LEVEL SECURITY;/);
  });

  it('no migration lets app_user or PUBLIC delete from it or change it, and none gives it a policy a DELETE could pass', () => {
    // 0009's own grant is found, so a reading that matches nothing fails here.
    expect(
      grants.some((g) => g.grantee === 'app_user' && g.f.startsWith('0009_')),
      'no grant on support_read found at all: the reading no longer matches the migrations',
    ).toBe(true);
    for (const g of grants.filter((x) => x.grantee === 'app_user' || x.grantee === 'public')) {
      for (const p of g.privileges) {
        expect(/^(DELETE|UPDATE|TRUNCATE|ALL)\b/.test(p), `${g.f}: ${g.s}`).toBe(false);
      }
    }
    for (const { f, s } of statements) {
      const policy = /^CREATE POLICY \S+ ON (?:ONLY )?(?:public\.)?"?support_read"?\b(.*)$/i.exec(s);
      if (!policy) continue;
      // A policy with no FOR is FOR ALL.
      const cmd = /\bFOR (ALL|SELECT|INSERT|UPDATE|DELETE)\b/i.exec(policy[1] ?? '')?.[1]?.toUpperCase() ?? 'ALL';
      expect(['ALL', 'DELETE'].includes(cmd), `${f}: ${s}`).toBe(false);
    }
  });

  it('any other role a migration grants on it may read only its organisation column, and delete: it can purge an organisation, never pick a row by its age', () => {
    // 0138 T3 step 2 gives the tasks' system role `SELECT (tenant_id), DELETE`
    // on it, so the purge can delete an erased organisation's rows (it
    // bypasses row security). With `at`, or the whole row, it could do what
    // only the owner at the machine does here, and read what was searched for.
    for (const g of grants.filter((x) => x.grantee !== 'app_user' && x.grantee !== 'public')) {
      for (const p of g.privileges) {
        expect(['DELETE', 'SELECT (TENANT_ID)'].includes(p), `${g.grantee}, ${p} — ${g.f}: ${g.s}`).toBe(true);
      }
    }
  });
});

describe('every place that says why this runs at the machine says who else may delete', () => {
  /** The passage, from its first words to what ends it; a passage that is not found fails. */
  const passage = (rel: string, from: string, to: RegExp): string => {
    const text = read(rel);
    const at = text.indexOf(from);
    if (at < 0) throw new Error(`${rel}: "${from}" is not there any more; this guard reads the passage that starts with it`);
    const rest = text.slice(at + from.length);
    const end = rest.search(to);
    return `${from}${end < 0 ? rest : rest.slice(0, end)}`.replace(/\s+/g, ' ');
  };
  const PLACES: Array<[string, string]> = [
    [SCRIPT_REL, read(SCRIPT_REL).replace(/\s+/g, ' ')],
    ['deploy/compose/box-duties.sh', passage('deploy/compose/box-duties.sh', '#   searches ', /\n#\s*\n/)],
    ['docs/operator-runbook.md', passage('docs/operator-runbook.md', '## Searches and downloads on the support screens', /\n## /)],
    ['docs/managed-bring-up.md', passage('docs/managed-bring-up.md', '| `searches` |', /\n/)],
    [
      'docs/workplans/0139-the-legal-gate-for-the-alpha.md',
      passage('docs/workplans/0139-the-legal-gate-for-the-alpha.md', "**2026-09-29: T6, the support screens' searches", /\n\*\*20/),
    ],
    ['site/legal/README.md', passage('site/legal/README.md', '- *Searches and downloads on the support screens, 12 months*', /\n- /)],
    ['site/legal/privacy.md', passage('site/legal/privacy.md', '- A search by address and a download of the log', /\n\s*- /)],
    ['site/legal/privacy.nl.md', passage('site/legal/privacy.nl.md', '- Een zoekopdracht op adres en een download van het logboek', /\n\s*- /)],
  ];

  it("names app_user as the role that cannot, and 0138 T3 step 2's system role as one that may, for the purge only", () => {
    for (const [rel, text] of PLACES) {
      expect(text, rel).toMatch(/`app_user`|\bapp_user\b/);
      expect(text, rel).toMatch(/0138 T3 step 2/);
      expect(text, rel).toMatch(/purge/i);
    }
  });

  it("never says the app cannot delete from the log, or calls the owner's the one connection that may", () => {
    for (const [rel, text] of PLACES) {
      expect(text, rel).not.toMatch(/\bthe app (still )?cannot (delete from|change) (this|that|the) log\b/i);
      expect(text, rel).not.toMatch(/\bthe one connection that may\b/i);
    }
  });
});
