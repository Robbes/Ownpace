// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A JOBS ROLE THAT OWNS ONLY ITS QUEUE (ADR-0054, workplan 0167 T7's first part).
 *
 * pg-boss keeps the managed edition's jobs in the ledger's database, in the
 * schema `pgboss`, owned by the role `ownpace_jobs`. The bring-up's data phase
 * makes both from `deploy/compose/jobs-role.sql`, not a migration (a migration
 * would make live's deploy one-way), asks the catalog whether the role is fit
 * with `db-roles.sh`'s DB_ROLES_JOBS_FIT_SQL, and sets its password with
 * DB_ROLES_JOBS_SET_SQL. `scripts/a-password-the-repository-knows` runs that
 * phase against a stand-in docker; this file runs the SQL itself on a real
 * Postgres with both migration chains applied: the Testcontainers one in
 * `pnpm test:integration`, or a throwaway one by hand (`scripts/local-pg.sh`).
 *
 * WHAT IS ASSERTED, as the job runner's points 7a and 7b were in the spike
 * (workplan 0167 §3), now against the file the bring-up runs:
 *
 *   1. the names the bring-up asks about are the file's, and the file has no
 *      psql meta-command, so what runs here is what runs there;
 *   2. the role is exactly what the file says: a login role, NOINHERIT, no
 *      superuser, no CREATEDB, CREATEROLE, REPLICATION or BYPASSRLS, a member
 *      of no role and no role a member of it, unable to create a schema, the
 *      owner of `pgboss`, and nothing on that schema granted to PUBLIC or any
 *      other role; the bring-up's own question answers fit;
 *   3. a second run of the file changes nothing, the password included;
 *   4. the statements the bring-up sets the password with clear a setting the
 *      role left on itself, which an ordinary role may;
 *   5. pg-boss installs into `pgboss` as that role, adds no extension, leaves
 *      the role owning nothing outside it and reading no `public` table, and
 *      every `public` table's `relrowsecurity` and `relforcerowsecurity` as
 *      they were; it may not read the ledger, and neither `app_user` nor
 *      `ownpace_system` may read the queue; the question still answers fit;
 *   6. the question refuses what it should: each way a role can be made unfit
 *      changes its answer (in a transaction rolled back);
 *   7. a copy taken as `copy-before-update.sh` takes it (`pg_dump
 *      --format=custom` as the owner), once `pgboss` exists, restores as the
 *      operator runbook's rollback restores it (`pg_restore -d postgres
 *      --clean --if-exists --create`), with the schema still the role's, its
 *      jobs in it, and the runner starting on it as that role. The shared test
 *      database cannot be dropped under the other files, so this one is made
 *      for the purpose: both chains, the file, pg-boss, then the dump and the
 *      restore over it. `pg_dump` and `pg_restore` are this machine's when
 *      their major version is the server's (`scripts/local-pg.sh`), and
 *      otherwise the harness's own Postgres image's, run on the host's network
 *      (CI: the runner's client is older than the server, and pg_dump refuses
 *      a newer server).
 *
 * The role is cluster-wide, and this file is the only one that makes it or
 * logs in as it; it drops the schema, the role and its own database at the
 * end, so a second run starts from nothing too.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PgBossJobRunner } from '@openmig/scheduler/pg-boss';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
if (!ADMIN_URL) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration, or scripts/local-pg.sh up');
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readRepo = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const JOBS_SQL = readRepo('deploy/compose/jobs-role.sql');
const DB_ROLES = readRepo('deploy/compose/db-roles.sh');

/** A value db-roles.sh assigns once, at the start of a line (`NAME='value'`). */
function dbRolesName(name: string): string {
  const m = new RegExp(`^${name}='([^']*)'$`, 'm').exec(DB_ROLES);
  if (!m) throw new Error(`deploy/compose/db-roles.sh assigns no ${name}`);
  return m[1]!;
}

/** A statement db-roles.sh sends, by the name it reads it into (`read -r -d '' NAME <<'SQL'`). */
function dbRolesSql(name: string): string {
  const m = new RegExp(`read -r -d '' ${name} <<'SQL' \\|\\| true\n([\\s\\S]*?)\nSQL\n`).exec(DB_ROLES);
  if (!m) throw new Error(`deploy/compose/db-roles.sh reads no ${name}`);
  return m[1]!;
}

const ROLE = 'ownpace_jobs';
const SCHEMA = 'pgboss';
const PASSWORD = randomBytes(24).toString('hex');
/** The database item 7 makes, dumps and restores over. */
const COPY_DB = `jobs_copy_${randomBytes(4).toString('hex')}`;

function urlOf(base: string, change: { user?: string; password?: string; db?: string }): string {
  const u = new URL(base);
  if (change.user !== undefined) u.username = change.user;
  if (change.password !== undefined) u.password = change.password;
  if (change.db !== undefined) u.pathname = `/${change.db}`;
  return u.toString();
}

/** DB_ROLES_JOBS_FIT_SQL with its two psql variables as the bring-up passes them. */
const FIT_SQL = dbRolesSql('DB_ROLES_JOBS_FIT_SQL')
  .replaceAll(":'jobs_role'", `'${ROLE}'`)
  .replaceAll(":'jobs_schema'", `'${SCHEMA}'`);
/** What db_roles_jobs_fit reads as fit, as psql -At prints it. */
const FIT = 'f|f|f|f|f|t|f|0|0|t|0|0|0|0|f|f';

/** One row as psql -At prints it: `t`/`f`, numbers as digits, NULL as nothing, `|` between. */
const asPsqlPrints = (row: unknown[]): string =>
  row.map((v) => (v === null ? '' : typeof v === 'boolean' ? (v ? 't' : 'f') : String(v))).join('|');

async function fitAnswer(client: pg.Pool | pg.PoolClient): Promise<string[]> {
  const r = await client.query({ text: FIT_SQL, rowMode: 'array' });
  return r.rows.map((row: unknown[]) => asPsqlPrints(row));
}

const RLS_SNAPSHOT = `
  SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname`;
const EXTENSIONS = 'SELECT extname FROM pg_extension ORDER BY 1';
/** What a run of jobs-role.sql could change: the role, its memberships, its password, the schema. */
const CATALOG_SNAPSHOT = `
  SELECT row_to_json(a)::text AS role,
         (SELECT count(*) FROM pg_auth_members m WHERE a.oid IN (m.member, m.roleid))::int AS memberships,
         (SELECT row_to_json(n)::text FROM (SELECT oid, nspname, nspowner::regrole::text AS owner, nspacl::text AS acl
                                              FROM pg_namespace WHERE nspname = '${SCHEMA}') n) AS schema
    FROM pg_authid a WHERE a.rolname = '${ROLE}'`;

let admin: pg.Pool;
let jobs: pg.Pool;
let rlsBefore: unknown[];
let extensionsBefore: string[];
const runners: PgBossJobRunner[] = [];

async function dropTheRoleAndItsSchema(pool: pg.Pool): Promise<void> {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  const { rowCount } = await pool.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ROLE]);
  if (rowCount) {
    // Every database's objects of the role (item 7's is dropped before this), then the role.
    await pool.query(`DROP OWNED BY ${ROLE}`);
    await pool.query(`DROP ROLE ${ROLE}`);
  }
}

/**
 * What the data phase runs before jobs-role.sql, in its order: setup-auth.sql
 * (the pooler's lookup role and its SECURITY DEFINER function, which returns
 * any role's verifier), then pg_stat_statements, whose install script grants
 * PUBLIC SELECT on its two views in `public`. A real stack has both; a fit
 * question that did not leave the extension's views out refused every one.
 * Returns what this call made, so the shared database is put back after.
 */
async function asTheDataPhaseDoes(pool: pg.Pool): Promise<{ authRole: boolean; authSchema: boolean; extension: boolean }> {
  const had = (
    await pool.query<{ role: boolean; schema: boolean; extension: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pgbouncer_auth') AS role,
              EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'pgbouncer_auth') AS schema,
              EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') AS extension`,
    )
  ).rows[0]!;
  const setupAuth = readRepo('deploy/compose/pgbouncer/setup-auth.sql')
    .split('\n')
    .filter((l) => !/^\s*\\/.test(l))
    .join('\n');
  // The password reaches it as the session setting it reads, as the phase's PGOPTIONS gives it.
  await pool.query(`SET my.pw = '${randomBytes(24).toString('hex')}'; ${setupAuth}; RESET my.pw;`);
  await pool.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
  await pool.query(JOBS_SQL);
  return { authRole: !had.role, authSchema: !had.schema, extension: !had.extension };
}
let madeHere: { authRole: boolean; authSchema: boolean; extension: boolean } | undefined;

beforeAll(async () => {
  admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
  await dropTheRoleAndItsSchema(admin);
  rlsBefore = (await admin.query(RLS_SNAPSHOT)).rows;
  madeHere = await asTheDataPhaseDoes(admin);
  // After the phase's own extension: what pg-boss installs must add none.
  extensionsBefore = (await admin.query(EXTENSIONS)).rows.map((e: { extname: string }) => e.extname);
  expect(extensionsBefore).toContain('pg_stat_statements');
  // What db_roles_jobs_set does with .env's value; the value is this file's, made here.
  await admin.query(`ALTER ROLE ${ROLE} PASSWORD '${PASSWORD}'`);
  jobs = new pg.Pool({ connectionString: urlOf(ADMIN_URL, { user: ROLE, password: PASSWORD }), max: 2 });
}, 60_000);

afterAll(async () => {
  for (const r of runners) await r.stop({ graceful: false }).catch(() => undefined);
  await jobs?.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS ${COPY_DB} WITH (FORCE)`);
    await dropTheRoleAndItsSchema(admin);
    // What asTheDataPhaseDoes made in the shared database, and only that.
    if (madeHere?.extension) await admin.query('DROP EXTENSION IF EXISTS pg_stat_statements');
    if (madeHere?.authSchema) await admin.query('DROP SCHEMA IF EXISTS pgbouncer_auth CASCADE');
    if (madeHere?.authRole) await admin.query('DROP ROLE IF EXISTS pgbouncer_auth');
    await admin.end();
  }
}, 60_000);

describe('the file the bring-up runs, and the names it asks about', () => {
  it('names the role and the schema db-roles.sh asks about, and nothing else', () => {
    expect(dbRolesName('DB_ROLES_JOBS')).toBe(ROLE);
    expect(dbRolesName('DB_ROLES_JOBS_SCHEMA')).toBe(SCHEMA);
    const code = JOBS_SQL.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
    expect(code).toContain(
      `CREATE ROLE ${ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;`,
    );
    expect(code).toContain(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA} AUTHORIZATION ${ROLE};`);
    // No REVOKE: it would take back a grant on an existing schema before the question could refuse it.
    expect(code).not.toMatch(/\bREVOKE\b/);
    // No psql meta-command, so the file this test runs is the file the bring-up runs.
    expect(code.split('\n').filter((l) => /^\s*\\/.test(l))).toEqual([]);
    // And no password: the role is made with none, and the bring-up sets .env's.
    expect(code).not.toMatch(/PASSWORD/i);
  });
});

describe('the role and its schema, as jobs-role.sql makes them', () => {
  it('is a plain login role that may create nothing and belongs to nobody', async () => {
    const { rows } = await admin.query(
      `SELECT r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls, r.rolinherit, r.rolcanlogin,
              has_database_privilege(r.oid, current_database(), 'CREATE') AS can_create_schema,
              (SELECT count(*)::int FROM pg_auth_members m WHERE m.member = r.oid) AS member_of,
              (SELECT count(*)::int FROM pg_auth_members m WHERE m.roleid = r.oid) AS members
         FROM pg_roles r WHERE r.rolname = $1`,
      [ROLE],
    );
    expect(rows).toEqual([
      {
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolbypassrls: false,
        rolinherit: false,
        rolcanlogin: true,
        can_create_schema: false,
        member_of: 0,
        members: 0,
      },
    ]);
  });

  it('owns pgboss, and nobody else is granted anything on it', async () => {
    const { rows } = await admin.query(
      `SELECT n.nspowner::regrole::text AS owner,
              (SELECT count(*)::int FROM aclexplode(n.nspacl) a WHERE a.grantee <> n.nspowner) AS others
         FROM pg_namespace n WHERE n.nspname = $1`,
      [SCHEMA],
    );
    expect(rows).toEqual([{ owner: ROLE, others: 0 }]);
    for (const other of ['app_user', 'ownpace_system']) {
      const r = await admin.query(`SELECT has_schema_privilege($1, $2, 'USAGE') AS usage`, [other, SCHEMA]);
      expect(r.rows[0].usage, `${other} may use ${SCHEMA}`).toBe(false);
    }
  });

  it("the bring-up's own question, asked of this database, answers fit", async () => {
    expect(await fitAnswer(admin)).toEqual([FIT]);
  });

  it('logs in as itself with the password the bring-up set, and is no superuser there', async () => {
    const { rows } = await jobs.query("SELECT current_user AS who, current_setting('is_superuser') AS superuser");
    expect(rows).toEqual([{ who: ROLE, superuser: 'off' }]);
  });

  it('a second run of the file changes nothing, the password included', async () => {
    const before = (await admin.query(CATALOG_SNAPSHOT)).rows;
    expect(before).toHaveLength(1);
    await admin.query(JOBS_SQL);
    expect((await admin.query(CATALOG_SNAPSHOT)).rows).toEqual(before);
  });

  it('the statements the bring-up sets the password with clear a setting the role left on itself', async () => {
    const db = (await admin.query<{ db: string }>('SELECT current_database() AS db')).rows[0]!.db;
    // An ordinary role may set its own, for every database and for one.
    await jobs.query(`ALTER ROLE ${ROLE} SET default_transaction_read_only = on`);
    await jobs.query(`ALTER ROLE ${ROLE} IN DATABASE "${db}" SET statement_timeout = '1ms'`);
    const settings = `SELECT count(*)::int AS n FROM pg_db_role_setting WHERE setrole = '${ROLE}'::regrole`;
    expect((await admin.query(settings)).rows[0].n).toBe(2);
    const resets = dbRolesSql('DB_ROLES_JOBS_SET_SQL')
      .split('\n')
      .filter((l) => /RESET ALL;$/.test(l))
      .map((l) => l.replaceAll(':"jobs_role"', ROLE).replaceAll(':"DBNAME"', `"${db}"`));
    expect(resets).toHaveLength(2);
    for (const statement of resets) await admin.query(statement);
    expect((await admin.query(settings)).rows[0].n).toBe(0);
  });
});

describe('pg-boss, installed as that role', () => {
  it('installs into pgboss, adds no extension, and reaches nothing of the ledger', async () => {
    const runner = new PgBossJobRunner({
      connectionString: urlOf(ADMIN_URL, { user: ROLE, password: PASSWORD }),
      schema: SCHEMA,
      maxConnections: 2,
    });
    runners.push(runner);
    await runner.start([{ name: 'jobs-role-probe', policy: 'standard' }]);
    const queued = await runner.enqueue('jobs-role-probe', { mappingId: 'a-mapping-id' });
    expect(queued.runId).toBeTruthy();
    await runner.stop();

    const inside = await admin.query(
      `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relowner = $2::regrole`,
      [SCHEMA, ROLE],
    );
    expect(inside.rows[0].n).toBeGreaterThan(0);
    const outside = await admin.query(
      `SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relowner = $1::regrole AND n.nspname NOT IN ($2, 'pg_toast')`,
      [ROLE, SCHEMA],
    );
    expect(outside.rows).toEqual([]);
    const readable = await admin.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
          AND NOT EXISTS (SELECT 1 FROM pg_depend e
                           WHERE e.classid = 'pg_class'::regclass AND e.objid = c.oid AND e.deptype = 'e')
          AND (has_table_privilege($1, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
               OR has_any_column_privilege($1, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')
               OR (c.relkind = 'S' AND has_sequence_privilege($1, c.oid, 'USAGE')))`,
      [ROLE],
    );
    expect(readable.rows).toEqual([]);
    expect((await admin.query(EXTENSIONS)).rows.map((e: { extname: string }) => e.extname)).toEqual(extensionsBefore);
    expect((await admin.query(RLS_SNAPSHOT)).rows).toEqual(rlsBefore);
    expect(rlsBefore.length).toBeGreaterThan(0);
    // And the question the bring-up asks on every run still answers fit, its tables in place.
    expect(await fitAnswer(admin)).toEqual([FIT]);
  }, 60_000);

  it('may not read the ledger, and the ledger roles may not read the queue', async () => {
    await expect(jobs.query('SELECT count(*) FROM public.tenant')).rejects.toThrow(/permission denied/);
    const job = `${SCHEMA}.job`;
    for (const other of ['app_user', 'ownpace_system']) {
      const r = await admin.query(`SELECT has_table_privilege($1, $2, 'SELECT') AS can`, [other, job]);
      expect(r.rows[0].can, `${other} may read ${job}`).toBe(false);
    }
  });
});

describe('the question refuses a role made unfit', () => {
  /** Each change, and the field of the answer it moves (0-based, as db_roles_jobs_fit reads them). */
  const CHANGES: ReadonlyArray<readonly [string, string, number, string]> = [
    ['a superuser', `ALTER ROLE ${ROLE} SUPERUSER`, 0, 't'],
    ['one that may create roles', `ALTER ROLE ${ROLE} CREATEROLE`, 1, 't'],
    ['one that may create databases', `ALTER ROLE ${ROLE} CREATEDB`, 2, 't'],
    ['one that replicates', `ALTER ROLE ${ROLE} REPLICATION`, 3, 't'],
    ['one with BYPASSRLS', `ALTER ROLE ${ROLE} BYPASSRLS`, 4, 't'],
    ['one that cannot log in', `ALTER ROLE ${ROLE} NOLOGIN`, 5, 'f'],
    ['one that inherits', `ALTER ROLE ${ROLE} INHERIT`, 6, 't'],
    ['a member of app_user', `GRANT app_user TO ${ROLE}`, 7, '1'],
    ['a role app_user is a member of', `GRANT ${ROLE} TO app_user`, 8, '1'],
    ['one whose schema is the owner’s', `ALTER SCHEMA ${SCHEMA} OWNER TO CURRENT_USER`, 9, 'f'],
    ['one with no schema', `DROP SCHEMA ${SCHEMA} CASCADE`, 9, ''],
    ['one that owns a table of public', `CREATE TABLE public.jobs_role_probe (); ALTER TABLE public.jobs_role_probe OWNER TO ${ROLE}`, 10, '3'],
    ['one granted a column of public through PUBLIC', 'GRANT SELECT (id) ON public.tenant TO PUBLIC', 11, '1'],
    ['one whose schema app_user may use', `GRANT USAGE ON SCHEMA ${SCHEMA} TO app_user`, 12, '1'],
    ['one whose queue PUBLIC may read', `GRANT SELECT ON ${SCHEMA}.job TO PUBLIC`, 12, '1'],
    ['one whose schema PUBLIC may use', `GRANT USAGE ON SCHEMA ${SCHEMA} TO PUBLIC`, 12, '1'],
    // The bring-up runs the file before the question: it must not take the grant back first.
    ['one whose schema PUBLIC may use, the file run again before the question', `GRANT USAGE ON SCHEMA ${SCHEMA} TO PUBLIC; ${JOBS_SQL}`, 12, '1'],
    ['one granted a sequence of public through PUBLIC', 'CREATE SEQUENCE public.jobs_role_probe_seq; GRANT USAGE ON SEQUENCE public.jobs_role_probe_seq TO PUBLIC', 11, '1'],
    ["one granted an extension's view by name", `GRANT SELECT ON public.pg_stat_statements TO ${ROLE}`, 13, '1'],
    ['one that may create in this database, by name', `GRANT CREATE ON DATABASE "THIS_DATABASE" TO ${ROLE}`, 14, 't'],
    ['one that may create in this database, through PUBLIC', `GRANT CREATE ON DATABASE "THIS_DATABASE" TO PUBLIC`, 14, 't'],
    ['one that may create in public, by name', `GRANT CREATE ON SCHEMA public TO ${ROLE}`, 15, 't'],
    ['one that may create in public, through PUBLIC', 'GRANT CREATE ON SCHEMA public TO PUBLIC', 15, 't'],
    ['one given USAGE on public by name', `GRANT USAGE ON SCHEMA public TO ${ROLE}`, 13, '1'],
    ['one given a default privilege in public', `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${ROLE}`, 13, '1'],
    ["one that may call the pooler's lookup, which returns any role's verifier", `GRANT USAGE ON SCHEMA pgbouncer_auth TO ${ROLE}; GRANT EXECUTE ON FUNCTION pgbouncer_auth.user_lookup(text) TO ${ROLE}`, 13, '2'],
  ];

  it.each(CHANGES)('%s', async (_what, change, field, value) => {
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      const db = (await client.query<{ db: string }>('SELECT current_database() AS db')).rows[0]!.db;
      await client.query(change.replaceAll('THIS_DATABASE', db));
      const [line] = await fitAnswer(client);
      expect(line!.split('|')[field]).toBe(value);
      expect(line, 'db_roles_jobs_fit would read this as fit').not.toBe(FIT);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    expect(await fitAnswer(admin)).toEqual([FIT]);
  });
});

describe('a copy taken once pgboss exists restores as the rollback restores it', () => {
  /** The flags the two read from where the operator's commands are written, so the test runs those. */
  const DUMP_FLAGS = (/pg_dump -U "\$POSTGRES_USER" -d "\$1" ([^']+)'/.exec(readRepo('deploy/compose/copy-before-update.sh'))?.[1] ?? '')
    .split(' ')
    .filter(Boolean);
  const RESTORE_FLAGS = (
    /pg_restore -U "\$POSTGRES_USER" -d postgres ([^']+)'/.exec(readRepo('docs/operator-runbook.md'))?.[1] ?? ''
  )
    .split(' ')
    .filter(Boolean);

  it('reads the dump the copy takes and the restore the rollback runs', () => {
    expect(DUMP_FLAGS, 'copy-before-update.sh no longer dumps the app database in the shape this reads').toEqual(['--format=custom']);
    expect(RESTORE_FLAGS, "the runbook's rollback no longer restores in the shape this reads").toEqual([
      '--clean',
      '--if-exists',
      '--create',
    ]);
  });

  /** pg_dump and pg_restore: this machine's when their major is the server's, else the harness image's. */
  function client(): (tool: 'pg_dump' | 'pg_restore', args: string[], input?: Buffer) => Buffer {
    const serverMajor = (version: string): number => Number.parseInt(version, 10);
    return (tool, args, input) => {
      const local = spawnSync(tool, ['--version'], { encoding: 'utf8' });
      const localMajor = local.status === 0 ? /\s(\d+)(\.\d+)*/.exec(local.stdout)?.[1] : undefined;
      let r;
      if (localMajor !== undefined && Number(localMajor) === serverMajor(SERVER_VERSION)) {
        r = spawnSync(tool, args, { input, maxBuffer: 1 << 30 });
      } else {
        const setup = readRepo('packages/testing/src/testcontainers-setup.ts');
        const image = /new GenericContainer\('(postgres:[^']+)'\)/.exec(setup)?.[1];
        if (!image) throw new Error('packages/testing/src/testcontainers-setup.ts names no postgres image to run the client from');
        r = spawnSync('docker', ['run', '--rm', '-i', '--network', 'host', image, tool, ...args], {
          input,
          maxBuffer: 1 << 30,
        });
      }
      if (r.error) throw r.error;
      if (r.status !== 0) {
        throw new Error(`${tool} exited ${String(r.status)}: ${r.stderr.toString()}`);
      }
      return r.stdout;
    };
  }
  let SERVER_VERSION = '';

  it('keeps the schema the role’s, its jobs in it, and the runner starts on it as that role', async () => {
    SERVER_VERSION = (await admin.query<{ v: string }>("SELECT current_setting('server_version') AS v")).rows[0]!.v;
    const run = client();
    await admin.query(`CREATE DATABASE ${COPY_DB}`);
    const copyUrl = urlOf(ADMIN_URL, { db: COPY_DB });
    const owner = new pg.Pool({ connectionString: copyUrl, max: 1 });
    try {
      // Both chains, as the stacks' api applies them, then the file, as the bring-up runs it.
      for (const chain of ['packages/ledger/migrations', 'packages/managed/migrations']) {
        for (const f of readdirSync(join(ROOT, chain)).filter((n) => n.endsWith('.sql')).sort()) {
          await owner.query(readRepo(`${chain}/${f}`));
        }
      }
      await asTheDataPhaseDoes(owner);
      expect(await fitAnswer(owner)).toEqual([FIT]);
    } finally {
      await owner.end();
    }
    const first = new PgBossJobRunner({
      connectionString: urlOf(ADMIN_URL, { user: ROLE, password: PASSWORD, db: COPY_DB }),
      schema: SCHEMA,
      maxConnections: 2,
    });
    runners.push(first);
    await first.start([{ name: 'jobs-role-copy', policy: 'standard' }]);
    const kept = await first.enqueue('jobs-role-copy', { mappingId: 'kept-across-the-copy' });
    await first.stop();

    // copy-before-update.sh's dump, with its own flags: the owner's pg_dump of the app's database.
    const dump = run('pg_dump', ['-d', copyUrl, ...DUMP_FLAGS]);
    expect(dump.length).toBeGreaterThan(0);
    // The runbook's rollback, step 5, with its own flags: over the database, from the copy.
    run('pg_restore', ['-d', urlOf(ADMIN_URL, { db: 'postgres' }), ...RESTORE_FLAGS], dump);

    const restored = new pg.Pool({ connectionString: copyUrl, max: 1 });
    try {
      const schema = await restored.query(
        `SELECT n.nspowner::regrole::text AS owner,
                (SELECT count(*)::int FROM aclexplode(n.nspacl) a WHERE a.grantee <> n.nspowner) AS others
           FROM pg_namespace n WHERE n.nspname = $1`,
        [SCHEMA],
      );
      expect(schema.rows).toEqual([{ owner: ROLE, others: 0 }]);
      expect(await fitAnswer(restored)).toEqual([FIT]);
      const job = await restored.query(`SELECT data FROM ${SCHEMA}.job WHERE id = $1`, [kept.runId]);
      expect(job.rows).toHaveLength(1);
      expect(JSON.stringify(job.rows[0].data)).toContain('kept-across-the-copy');
    } finally {
      await restored.end();
    }
    const after = new PgBossJobRunner({
      connectionString: urlOf(ADMIN_URL, { user: ROLE, password: PASSWORD, db: COPY_DB }),
      schema: SCHEMA,
      maxConnections: 2,
    });
    runners.push(after);
    await after.start([{ name: 'jobs-role-copy', policy: 'standard' }]);
    expect((await after.status('jobs-role-copy', kept.runId!))?.state).toBe('queued');
    await after.stop();
  }, 300_000);
});
