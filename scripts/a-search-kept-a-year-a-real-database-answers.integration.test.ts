// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SEARCH KEPT A YEAR, AGAINST A REAL DATABASE (privacy §4.5 and §9; the
 * owner's privacy-search-records (a); workplan 0139 T6).
 *
 * `a-search-kept-past-its-year` runs `support-read-prune.sh` against a
 * stand-in `psql` that answers a canned count. A canned answer cannot find a
 * column that is not there, a comparison that never matches, or a predicate
 * that takes one row too many. So here the SQL the script pipes to `psql` runs
 * on a real Postgres with both migration chains applied: the Testcontainers one
 * in `pnpm test:integration`, or a throwaway one by hand:
 *
 *   LOCAL_PG_DIR=/tmp/ownpace-local-pg-searchyear LOCAL_PG_PORT=55451 ./scripts/local-pg.sh up
 *
 * WHAT IS ASSERTED. Without `--delete` it counts and deletes nothing; with it,
 * it deletes a read with no organisation recorded more than 12 months ago (a
 * search, a download, the invoices kept after an erasure, an unfiltered log
 * page), and nothing else: not one 11 months old, not one a day short of 12
 * months, and not one that names an organisation however old and whatever its
 * screen (`tenant`, `person`, `migration`, a `log` page filtered to one
 * organisation: those go with the organisation's erasure). `app_user`, the
 * role every request runs as, cannot delete or change a row of that log, which
 * is why the script runs as the database's owner at the machine; and an owner
 * that does not pass row security would delete nothing, so the script stops
 * before it counts or deletes, and says so.
 *
 * `docker exec … psql` is stood in for by a small Node program that runs the
 * piped SQL on this database with `pg` and prints rows as `psql -At` does:
 * the integration runners are not promised a `psql` client, and the question
 * here is what the SQL does, not what psql prints.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DB_URL) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration, or scripts/local-pg.sh up');
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PG_ENTRY = pathToFileURL(createRequire(import.meta.url).resolve('pg')).href;

// UUID family 5ea40000-…, unused elsewhere in the repo.
const TENANT = '5ea40000-e29b-41d4-a716-446655440001';
const OPERATOR_MARK = 'search-kept-a-year-integration-operator';
/** The role the prune is run as to show an owner bound by row security. */
const BOUND_ROLE = 'search_year_bound_owner';

let pool: pg.Pool;
const tempDirs: string[] = [];

/** A checkout's deploy/compose with the script, and the stand-in `docker` on PATH. */
function stage() {
  const root = mkdtempSync(join(tmpdir(), 'search-kept-a-year-'));
  tempDirs.push(root);
  const compose = join(root, 'deploy', 'compose');
  mkdirSync(compose, { recursive: true });
  for (const f of ['support-read-prune.sh', 'env-read.sh', 'managed.yml']) {
    copyFileSync(join(ROOT, 'deploy/compose', f), join(compose, f));
  }
  chmodSync(join(compose, 'support-read-prune.sh'), 0o755);
  writeFileSync(join(compose, '.env'), ['COMPOSE_PROJECT_NAME=ownpace-live', 'STACK_KIND=production', ''].join('\n'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const forwarder = join(root, 'psql-stand-in.mjs');
  writeFileSync(
    forwarder,
    [
      `import pg from ${JSON.stringify(PG_ENTRY)};`,
      "import { readFileSync } from 'node:fs';",
      "const sql = readFileSync(0, 'utf8');",
      'const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });',
      'await client.connect();',
      'try {',
      // As another role, when a case asks: the owner's connection bound by row security.
      "  if (process.env.PSQL_ROLE) await client.query(`SET ROLE ${process.env.PSQL_ROLE}`);",
      '  const res = await client.query(sql);',
      '  for (const r of Array.isArray(res) ? res : [res]) {',
      "    for (const row of r.rows ?? []) process.stdout.write(Object.values(row).map((v) => (v === null ? '' : String(v))).join('|') + '\\n');",
      '  }',
      '} catch (e) {',
      '  process.stderr.write(`ERROR:  ${e.message}\\n`);',
      '  process.exitCode = 3;',
      '} finally {',
      '  await client.end();',
      '}',
      '',
    ].join('\n'),
  );
  const docker = [
    '#!/usr/bin/env bash',
    'case " $* " in',
    `  *" exec -i ownpace-live-db "*) exec node ${JSON.stringify(forwarder)} ;;`,
    'esac',
    'echo "docker stand-in: unexpected call: $*" >&2',
    'exit 98',
  ];
  writeFileSync(join(bin, 'docker'), `${docker.join('\n')}\n`);
  chmodSync(join(bin, 'docker'), 0o755);
  const run = (args: string[], extra: NodeJS.ProcessEnv = {}) => {
    const r = spawnSync(join(compose, 'support-read-prune.sh'), args, {
      encoding: 'utf8',
      env: {
        PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
        HOME: root,
        TEST_DATABASE_URL: TEST_DB_URL,
        ...extra,
      },
      cwd: root,
      timeout: 60_000,
    });
    return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };
  return { run };
}

async function cleanUp(): Promise<void> {
  await pool.query('DELETE FROM support_read WHERE operator_user_id = $1', [OPERATOR_MARK]);
  await pool.query('DELETE FROM tenant WHERE id = $1', [TENANT]);
  const { rows } = await pool.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [BOUND_ROLE]);
  if (rows.length > 0) {
    await pool.query(`DROP OWNED BY ${BOUND_ROLE}`);
    await pool.query(`DROP ROLE ${BOUND_ROLE}`);
  }
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: TEST_DB_URL, max: 2 });
  await cleanUp();
  await pool.query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'search-kept-a-year', 'active')`, [TENANT]);
});

afterAll(async () => {
  await cleanUp();
  await pool.end();
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

describe('support-read-prune.sh deletes a read with no organisation after 12 months, and nothing else', () => {
  const ROWS: Array<{ key: string; tenant: string | null; view: string; age: string; query: string | null; goes: boolean }> = [
    { key: 'search, 13 months', tenant: null, view: 'people', age: '13 months', query: 'someone@', goes: true },
    { key: 'download, 400 days', tenant: null, view: 'audit_export', age: '400 days', query: 'from:0', goes: true },
    { key: 'search, 11 months', tenant: null, view: 'people', age: '11 months', query: 'another@', goes: false },
    { key: 'list, a day short of 12 months', tenant: null, view: 'tenants', age: '12 months - 1 day', query: null, goes: false },
    { key: 'kept invoices, 13 months', tenant: null, view: 'retained_invoices', age: '13 months', query: null, goes: true },
    { key: 'an unfiltered log page, 13 months', tenant: null, view: 'log', age: '13 months', query: 'level=error', goes: true },
    { key: 'an organisation, 13 months', tenant: TENANT, view: 'tenant', age: '13 months', query: null, goes: false },
    { key: 'an organisation, today', tenant: TENANT, view: 'tenant', age: '0 days', query: null, goes: false },
    // Old, and naming an organisation, on each screen that records one: they
    // go with that organisation's erasure (privacy §9), never at 12 months.
    { key: 'a person, 13 months', tenant: TENANT, view: 'person', age: '13 months', query: null, goes: false },
    { key: 'a migration, 13 months', tenant: TENANT, view: 'migration', age: '13 months', query: null, goes: false },
    { key: 'a log page filtered to one organisation, 13 months', tenant: TENANT, view: 'log', age: '13 months', query: 'tenant=one', goes: false },
  ];

  async function present(): Promise<string[]> {
    const { rows } = await pool.query<{ key: string }>(
      `SELECT (CASE WHEN query IS NULL THEN '' ELSE query END) || '|' || view_name || '|' || coalesce(tenant_id::text, '') AS key
         FROM support_read WHERE operator_user_id = $1`,
      [OPERATOR_MARK],
    );
    return rows.map((r) => r.key).sort();
  }
  const keyOf = (r: (typeof ROWS)[number]) => `${r.query ?? ''}|${r.view}|${r.tenant ?? ''}`;

  beforeAll(async () => {
    for (const r of ROWS) {
      await pool.query(
        `INSERT INTO support_read (operator_user_id, tenant_id, view_name, query, result_count, at)
         VALUES ($1, $2::uuid, $3, $4::text, CASE WHEN $4::text IS NULL THEN NULL ELSE 1 END, now() - $5::interval)`,
        [OPERATOR_MARK, r.tenant, r.view, r.query, r.age],
      );
    }
    expect(await present()).toHaveLength(ROWS.length);
  });

  it('without --delete, counts them and deletes nothing', async () => {
    const s = stage();
    const r = s.run([]);
    expect(r.status, r.out).toBe(0);
    const counted = Number(/:\s*(\d+)\b/.exec(r.out)?.[1] ?? 'NaN');
    expect(counted, r.out).toBeGreaterThanOrEqual(ROWS.filter((x) => x.goes).length);
    expect(await present()).toEqual(ROWS.map(keyOf).sort());
  });

  it('a connection that does not pass row security stops before it counts or deletes, and says so', async () => {
    // An owner that is not a superuser and has no BYPASSRLS. The log's row
    // security is FORCEd and has no DELETE policy, so its DELETE would match
    // nothing and its count would see only its own rows.
    await pool.query(`CREATE ROLE ${BOUND_ROLE} NOSUPERUSER NOBYPASSRLS NOLOGIN`);
    await pool.query(`GRANT USAGE ON SCHEMA public TO ${BOUND_ROLE}`);
    await pool.query(`GRANT SELECT, DELETE ON public.support_read TO ${BOUND_ROLE}`);
    const s = stage();
    for (const args of [[], ['--delete']]) {
      const r = s.run(args, { PSQL_ROLE: BOUND_ROLE });
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).not.toMatch(/deleted \d/);
      expect(r.out).toMatch(/does not pass row security/);
    }
    expect(await present()).toEqual(ROWS.map(keyOf).sort());
  });

  it('with --delete, the ones with no organisation and older than 12 months go, and only they', async () => {
    const s = stage();
    const r = s.run(['--delete']);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/deleted \d+/);
    expect(await present()).toEqual(
      ROWS.filter((x) => !x.goes)
        .map(keyOf)
        .sort(),
    );
    // A second run finds nothing more of these.
    const again = s.run(['--delete']);
    expect(again.status, again.out).toBe(0);
    expect(await present()).toHaveLength(ROWS.filter((x) => !x.goes).length);
  });

  it('app_user, the role every request runs as, can neither delete nor change a row of the log', async () => {
    const client = await pool.connect();
    try {
      for (const stmt of [
        'DELETE FROM support_read WHERE operator_user_id = $1',
        "UPDATE support_read SET view_name = 'tenants' WHERE operator_user_id = $1",
      ]) {
        await client.query('BEGIN');
        try {
          await client.query('SET LOCAL ROLE app_user');
          let code = '';
          try {
            await client.query(stmt, [OPERATOR_MARK]);
          } catch (e) {
            code = (e as { code?: string }).code ?? '';
          }
          expect(code, stmt).toBe('42501'); // insufficient_privilege
        } finally {
          await client.query('ROLLBACK');
        }
      }
    } finally {
      client.release();
    }
    expect(await present()).toHaveLength(ROWS.filter((x) => !x.goes).length);
  });
});
