// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SYSTEM ROLE THAT IS NOT THE OWNER (workplan 0138 T3 step 2).
 *
 * Three Trigger.dev jobs span organisations whole: the sync tick (which
 * mappings are due, across every organisation), retention (prunes across
 * them, each only as far as its last issued invoice) and the purge of closed
 * organisations (revokes their credentials and removes their data). Beside
 * them, two narrower things cross organisations: the split jobs' list of
 * active organisations (`activeOrganisations`) and every task's audit key
 * (`deployment_key`, which ledger migration 0062 closes to `app_user`). Until
 * T3 step 2 all of them read `DATABASE_URL`, the database owner, a superuser
 * on the managed stack: Postgres applies no row security to it, and it may
 * run programs on the database server, read its files and change any role,
 * and `set-task-env.sh` put it in every run.
 *
 * They connect as `ownpace_system` now, through `SYSTEM_DATABASE_URL`. Managed
 * migration 0033 creates the role `LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB
 * NOREPLICATION BYPASSRLS` with no password (the bring-up sets it from `.env`)
 * and grants it the statements those jobs send and nothing else. `BYPASSRLS`
 * is what lets the jobs read across organisations at all: without it, with no
 * organisation set, every row-secured table answers nothing, and each job
 * would find nothing to do and say so as a quiet night.
 *
 * On a throwaway Postgres with both chains applied, this asserts:
 *
 *   1. the role: exactly those attributes, a member of no role and no role
 *      a member of it (either way one `SET ROLE` joins the owner's rights to
 *      its `BYPASSRLS`), and exactly the grants below, table by table and
 *      column by column. Twice: as the grants written to its name, and as
 *      what it may actually do, which counts a grant to PUBLIC or through a
 *      role as well; a `GRANT SELECT ON decision TO PUBLIC` reads as harmless
 *      under row security for `app_user` and hands this role every
 *      organisation's rows. Nothing on any schema, function or default but
 *      the one schema's `USAGE`, no SECURITY DEFINER function it may call, and
 *      on the database only PUBLIC's CONNECT and TEMPORARY (a temporary table
 *      lives and dies with its session). The bring-up's own question
 *      (`db-roles.sh`) and the smoke's, asked of this database, answer fit;
 *      and a setting the role leaves on itself, which an ordinary role may,
 *      is gone after the statements the bring-up sets its password with;
 *   2. each job's statements run as it: the tick's `run` (held, and then
 *      free), retention's and the purge's, on the pools the jobs build from
 *      `SYSTEM_DATABASE_URL`, each doing what it did on the owner's, and the
 *      list, the audit key and the operator's log page;
 *   3. it is refused what it was not given: creating a role or a database,
 *      `SET ROLE` to the owner, letting another role take its rights, the
 *      server's files and programs, a column or a table it was not granted, a
 *      write it was not granted, and making a permanent table.
 *
 * HOW THE JOBS RUN HERE. The three modules build their pool from
 * `SYSTEM_DATABASE_URL` when they are imported, as they do in a run, so this
 * file sets it (and `APP_DATABASE_URL`, which the tick's import of
 * run-delta-sync needs for `openTaskPools`) in its own process before it
 * imports them, and puts both back after. Never `DATABASE_URL`
 * (`an-integration-test-is-handed-its-database`): nothing here is handed the
 * owner's URL. The Trigger.dev SDK is the real one but for four members: a
 * scheduled task hands back its config, so its `run` can be called; a task's
 * `trigger` records what the tick would have started; `runs.retrieve` says a
 * run finished; `configure` does nothing. The role's password is made here,
 * at random, and set on the role by the owner, as the bring-up does from
 * `.env`: this file is the only one that logs in as the role, so no other
 * file's password races it. Everything else is the jobs' own code.
 *
 * The database is shared with the other integration files, so the tick and
 * retention see their rows as well: every assertion is about this file's own
 * organisations (the UUID family below), and the caps on passes in flight are
 * raised for the tick's run so another file's due mappings cannot crowd this
 * one's out.
 *
 * UUID family: 0138f000-e29b-41d4-a716-44665544xxxx.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { createPgDb, deploymentKeyFor, pgDriver } from '@openmig/ledger';
import { PURGED_TABLES, tenantRef } from '@openmig/managed';
import { AUDIT_PSEUDONYM_PURPOSE, exportAuditEvent, log, recordAppEvent } from '@openmig/shared';
import { activeOrganisations } from './task-pools.ts';

const stand = vi.hoisted(() => ({
  triggered: [] as Array<{ tenantId: string; mappingId: string; domains: string[] }>,
}));

vi.mock('@trigger.dev/sdk', async (importOriginal) => {
  const real = await importOriginal<typeof import('@trigger.dev/sdk')>();
  return {
    ...real,
    configure: () => undefined,
    schedules: { ...real.schedules, task: (config: unknown) => config },
    schemaTask: (config: Record<string, unknown>) => ({
      ...config,
      trigger: async (payload: { tenantId: string; mappingId: string; domains: string[] }) => {
        stand.triggered.push(payload);
        return { id: `run_stand_in_${stand.triggered.length}` };
      },
    }),
    runs: {
      ...real.runs,
      retrieve: async () => ({
        isExecuting: false,
        isQueued: false,
        isWaiting: false,
        isCompleted: true,
        isFailed: false,
        isCancelled: false,
      }),
      cancel: async () => ({}),
    },
  };
});

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

/** The role, as managed migration 0033 names it. */
const SYSTEM_ROLE = 'ownpace_system';

/** Its password here: made at random, set by the owner, as the bring-up sets .env's. */
const PASSWORD = randomBytes(24).toString('hex');

function as(url: string, user: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = user;
  parsed.password = password;
  return parsed.toString();
}
const systemUrl = () => as(PG_CONNECTION_STRING, SYSTEM_ROLE, PASSWORD);
const appUrl = () => as(PG_CONNECTION_STRING, 'app_user', 'app_password');

const P = '0138f000-e29b-41d4-a716-4466554400';
const A = `${P}a1`;
const B = `${P}b1`;
const C = `${P}c1`;
const A_SOURCE = `${P}11`;
const A_BOX = `${P}12`;
const A_MAPPING = `${P}13`;
const B_SOURCE = `${P}21`;
const B_BOX = `${P}22`;
const B_MAPPING = `${P}23`;
const B_RUNNING = `${P}24`;
const C_SOURCE = `${P}31`;
const C_BOX = `${P}32`;
const C_MAPPING = `${P}33`;
const C_FINISHED_RUN = `${P}34`;
const C_STALE_RUN = `${P}35`;
const C_INVOICE = `${P}36`;
const A_OLD_RUN = `${P}41`;
const A_NEW_RUN = `${P}42`;
const A_INVOICE = `${P}43`;
const A_DECLINED = `${P}44`;
const A_OLD_EVENT = `${P}45`;
const C_REQUEST = `${P}46`;
const C_PERSON = `${P}37`;
const C_LINK = `${P}38`;

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const readRepo = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

/** A statement db-roles.sh sends, by the name it reads it into (`read -r -d '' NAME <<'SQL'`). */
function dbRolesSql(name: string): string {
  const text = readRepo('deploy/compose/db-roles.sh');
  const m = new RegExp(`read -r -d '' ${name} <<'SQL' \\|\\| true\n([\\s\\S]*?)\nSQL\n`).exec(text);
  if (!m) throw new Error(`deploy/compose/db-roles.sh reads no ${name}`);
  return m[1]!;
}

/** One row as psql -At prints it: `t`/`f`, numbers as digits, `|` between. */
const asPsqlPrints = (row: unknown[]): string =>
  row.map((v) => (typeof v === 'boolean' ? (v ? 't' : 'f') : String(v))).join('|');

/**
 * What the role is granted, and all it is granted: a privilege on the whole
 * table, or on the columns in brackets. Written out here, not read from the
 * migration, so the two are compared.
 *
 *   - Read and deleted: what the tick reads across organisations (the
 *     mappings, their runs, statuses, cutovers, paths and scopes), what the
 *     purge's revocation reads (connections and the mailboxes that join them),
 *     and each of those deleted by the purge.
 *   - Deleted, read only by the column that picks the rows: every other table
 *     the purge empties (`PURGED_TABLES`), so the role reads nobody's mail
 *     ledger, audit trail, members or budgets.
 *   - Read by the tick beside the purge's column: the three tables the tier
 *     each month bills is read from (workplan 0157 T2, managed 0041), so
 *     Free runs at its pace. Never who said yes, nor a price. And when each
 *     migration was last visited (0157 T7, managed 0042), for the automatic
 *     cadence.
 *   - The rest, each for its one job: the hold and the beat (the tick),
 *     invoices up to their period and their status (retention) and detached
 *     with the buyer's name (the purge), declined requests by their decision
 *     (retention), the erasure receipt (the purge), the audit key, and the
 *     operator's log page, written by every one of them and pruned by
 *     retention.
 */
const PURGED_ONLY = (cols = 'tenant_id') => [`SELECT(${cols})`, 'DELETE'];
const EXPECTED: Record<string, readonly string[]> = {
  tenant: ['SELECT', 'UPDATE(status)', 'DELETE'],
  tenant_closure: ['SELECT', 'DELETE'],
  run: ['SELECT', 'UPDATE(finished_at,stats,status)', 'DELETE'],
  run_event: ['SELECT', 'DELETE'],
  mailbox_mapping: ['SELECT', 'DELETE'],
  mailbox: ['SELECT', 'DELETE'],
  connection: ['SELECT', 'DELETE'],
  migration_status: ['SELECT', 'DELETE'],
  cutover_state: ['SELECT', 'DELETE'],
  path_lifecycle: ['SELECT', 'DELETE'],
  scope_selection: ['SELECT', 'DELETE'],
  app_event: ['SELECT', 'INSERT', 'DELETE'],
  platform_pause: ['SELECT'],
  sync_tick_beat: ['SELECT', 'INSERT', 'UPDATE(beat_at)'],
  deployment_key: ['SELECT', 'INSERT'],
  invoice: ['SELECT(billed_to_name,id,period_end,status,tenant_id)', 'UPDATE(billed_to_name,tenant_id)'],
  erasure_record: ['SELECT(purged_at,tenant_ref)', 'UPDATE(purged_at,purged_counts,retained_invoice_ids,revocations)'],
  access_request: PURGED_ONLY('decided_at,id,state,tenant_id'),
  billing_party: PURGED_ONLY('name,tenant_id'),
  item: PURGED_ONLY(),
  sync_checkpoint: PURGED_ONLY(),
  cursor: PURGED_ONLY(),
  collection_mapping: PURGED_ONLY(),
  verification_run: PURGED_ONLY(),
  verification: PURGED_ONLY(),
  cutover_event: PURGED_ONLY(),
  cutover: PURGED_ONLY(),
  migration_discovery: PURGED_ONLY(),
  decision: PURGED_ONLY(),
  policy_preset: PURGED_ONLY(),
  group_def: PURGED_ONLY(),
  share_grant: PURGED_ONLY(),
  apply_receipt: PURGED_ONLY(),
  setup_step: PURGED_ONLY(),
  backup_target: PURGED_ONLY(),
  mapping_link: PURGED_ONLY(),
  vat_consultation: PURGED_ONLY(),
  // The three a tier is read from: the tick reads the tier each month bills,
  // for Free's pace (workplan 0157 T2, managed 0041), and never writes them.
  // Each yes without who said it or its price.
  occupancy_peak: PURGED_ONLY('month,peak_at,peak_paths,tenant_id'),
  bytes_moved: PURGED_ONLY('alpha_bytes,bytes,tenant_id'),
  // Each yes at the data ceiling (0109 T6), granted in managed 0037.
  data_allowance: PURGED_ONLY('band_gb,consented_at,kind,tenant_id,tier_id'),
  grant_link_allowance: PURGED_ONLY(),
  payment_method: PURGED_ONLY(),
  usage_metric: PURGED_ONLY(),
  tenant_member: PURGED_ONLY(),
  tenant_pricing: PURGED_ONLY(),
  audit_log: PURGED_ONLY(),
  rate_budget: PURGED_ONLY(),
  byte_budget: PURGED_ONLY(),
  support_read: PURGED_ONLY(),
  // The people being moved (managed migration 0031, ADR-0050), erased with
  // their organisation: a name and an address the role never reads.
  person_migration: PURGED_ONLY(),
  person: PURGED_ONLY(),
  // Who accepted which texts (workplan 0139 T3, managed 0032): in PURGED_TABLES since #1360.
  legal_acceptance: PURGED_ONLY(),
  // A person's links (workplan 0153 T5 (b), managed 0034): in PURGED_TABLES since #1390, and
  // granted in managed 0035, not 0033, which runs before the table exists on a fresh database.
  // Never the secret's hash, the person or the expiry: the purge picks the rows by tenant.
  person_link: PURGED_ONLY(),
  // When each migration was last visited (workplan 0157 T7, managed 0042): the
  // tick reads it for the automatic cadence, and the purge deletes it.
  migration_visit: PURGED_ONLY('mapping_id,tenant_id,visited_at'),
};

/** What the role holds beyond tables: its schema's USAGE, and nothing else anywhere. */
const EXPECTED_ELSEWHERE = ['schema public: USAGE'];

let owner: ReturnType<typeof createPgDb>;
let system: Pool;
const rowsOf = <R>(result: unknown): R[] => (result as { rows: R[] }).rows;
const ownerRows = async <R>(query: ReturnType<typeof sql>): Promise<R[]> => rowsOf<R>(await owner.execute(query));

type ScheduledRun = (payload: unknown, context: unknown) => Promise<Record<string, unknown>>;
let tickRun: ScheduledRun;
let retentionRun: ScheduledRun;
let purgeRun: ScheduledRun;

const saved: Record<string, string | undefined> = {};
const ENV = ['SYSTEM_DATABASE_URL', 'APP_DATABASE_URL', 'MAX_PASSES_IN_FLIGHT', 'MAX_PASSES_PER_ORGANISATION'];

/**
 * What an earlier run of this file left, gone, so every run starts from the
 * same rows: as the owner, every row of this file's organisations in every
 * table the purge empties, their invoices, receipt, hold and log-page events.
 */
async function forgetThisFilesRows(): Promise<void> {
  const mine = [A, B, C];
  await owner.execute(sql`DELETE FROM platform_pause WHERE id = ${`${P}ff`}`);
  await owner.execute(sql`DELETE FROM invoice WHERE id IN (${A_INVOICE}, ${C_INVOICE}) OR tenant_id IN (${A}, ${B}, ${C})`);
  await owner.execute(sql`DELETE FROM erasure_record WHERE tenant_ref = ${tenantRef(C)}`);
  await owner.execute(sql`DELETE FROM app_event WHERE id = ${A_OLD_EVENT} OR reference IN ('0138f0e1', '0138f0e2', '0138f0e3')`);
  await owner.execute(sql`DELETE FROM access_request WHERE id IN (${A_DECLINED}, ${C_REQUEST})`);
  for (const table of PURGED_TABLES) {
    await owner.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE tenant_id IN (${mine[0]}, ${mine[1]}, ${mine[2]})`);
  }
  await owner.execute(sql`DELETE FROM tenant WHERE id IN (${A}, ${B}, ${C})`);
}

beforeAll(async () => {
  owner = createPgDb(PG_CONNECTION_STRING);
  await forgetThisFilesRows();
  // As the bring-up does from .env, after the migration made the role with none.
  await owner.execute(sql.raw(`ALTER ROLE ${SYSTEM_ROLE} PASSWORD '${PASSWORD}'`));
  system = new Pool({ connectionString: systemUrl(), max: 2 });

  for (const name of ENV) saved[name] = process.env[name];
  process.env.SYSTEM_DATABASE_URL = systemUrl();
  process.env.APP_DATABASE_URL = appUrl();
  // Another file's due mappings may not take this one's place under the caps.
  process.env.MAX_PASSES_IN_FLIGHT = '100000';
  process.env.MAX_PASSES_PER_ORGANISATION = '100000';
  const tick = await import('./managed-sync-tick.ts');
  const retention = await import('./managed-retention.ts');
  const purge = await import('./managed-purge-closed.ts');
  tickRun = (tick.managedSyncTick as unknown as { run: ScheduledRun }).run;
  retentionRun = (retention.managedRetention as unknown as { run: ScheduledRun }).run;
  purgeRun = (purge.managedPurgeClosed as unknown as { run: ScheduledRun }).run;
}, 120_000);

afterAll(async () => {
  for (const name of ENV) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  await system?.end();
  await owner?.$pool.end();
});

describe('the role: no superuser, no role or database of its own, a member of nothing, past row security', () => {
  it('has exactly the attributes the migration gave it', async () => {
    const [role] = await ownerRows<Record<string, boolean>>(sql`
      SELECT rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
        FROM pg_roles WHERE rolname = ${SYSTEM_ROLE}`);
    expect(role, `${SYSTEM_ROLE} does not exist: managed migration 0033 creates it`).toEqual({
      rolcanlogin: true,
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
      rolbypassrls: true,
    });
  });

  it('is a member of no role, and no role is a member of it: SET ROLE joins nobody\'s rights to its BYPASSRLS', async () => {
    const [ways] = await ownerRows<{ belongs_to: number; members: number }>(sql`
      SELECT (SELECT count(*)::int FROM pg_auth_members m WHERE m.member = ${SYSTEM_ROLE}::regrole) AS belongs_to,
             (SELECT count(*)::int FROM pg_auth_members m WHERE m.roleid = ${SYSTEM_ROLE}::regrole) AS members`);
    // A member of another role takes that role's rights with SET ROLE: the owner's, a superuser's.
    expect(ways!.belongs_to, `${SYSTEM_ROLE} belongs to a role`).toBe(0);
    // A role that is a member of it takes ITS rights the same way: app_user, the API's own request
    // role, would read every organisation's rows past row security with one SET ROLE.
    expect(ways!.members, `a role is a member of ${SYSTEM_ROLE}`).toBe(0);
  });

  it("the bring-up's own question and the smoke's, asked of this database, answer fit", async () => {
    // db-roles.sh's db_roles_system_fit, as psql -At prints its one line: superuser, create role,
    // create database, replication, BYPASSRLS, login, roles it belongs to, roles that belong to it.
    const fitSql = dbRolesSql('DB_ROLES_SYSTEM_FIT_SQL').replaceAll(":'system_role'", `'${SYSTEM_ROLE}'`);
    const fit = await owner.$pool.query({ text: fitSql, rowMode: 'array' });
    expect(fit.rows.map((r: unknown[]) => asPsqlPrints(r))).toEqual(['f|f|f|f|t|t|0|0']);
    // smoke-managed.sh's, at the end of the nightly run, and the answer it passes.
    const smoke = readRepo('deploy/compose/smoke-managed.sh');
    const asked = /^system_role="\$\(q "([^"]+)" 2>&1 \| tail -n1\)"$/m.exec(smoke);
    const passes = /^if \[ "\$system_role" = "([^"]+)" \]; then$/m.exec(smoke);
    expect(asked, 'smoke-managed.sh no longer asks the system role question in the shape this reads').not.toBeNull();
    expect(passes, 'smoke-managed.sh no longer compares the answer in the shape this reads').not.toBeNull();
    const [answer] = rowsOf<{ line: string }>(await owner.$pool.query(`SELECT (${asked![1]}) AS line`));
    expect(answer!.line).toBe(passes![1]);
  });

  it('logs in as itself, and is no superuser there', async () => {
    const { rows } = await system.query<{ who: string; session: string; superuser: string }>(
      "SELECT current_user AS who, session_user AS session, current_setting('is_superuser') AS superuser",
    );
    expect(rows[0]).toEqual({ who: SYSTEM_ROLE, session: SYSTEM_ROLE, superuser: 'off' });
  });

  it('holds exactly the grants its jobs need, table by table and column by column', async () => {
    const tables = await ownerRows<{ tbl: string; priv: string }>(sql`
      SELECT c.relname AS tbl, a.privilege_type AS priv
        FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
       WHERE a.grantee = ${SYSTEM_ROLE}::regrole`);
    const columns = await ownerRows<{ tbl: string; col: string; priv: string }>(sql`
      SELECT c.relname AS tbl, att.attname AS col, a.privilege_type AS priv
        FROM pg_attribute att JOIN pg_class c ON c.oid = att.attrelid
             CROSS JOIN LATERAL aclexplode(att.attacl) a
       WHERE a.grantee = ${SYSTEM_ROLE}::regrole`);
    const held: Record<string, string[]> = {};
    for (const t of tables) (held[t.tbl] ??= []).push(t.priv);
    const byColumn = new Map<string, string[]>();
    for (const c of columns) {
      const key = `${c.tbl}\u0000${c.priv}`;
      byColumn.set(key, [...(byColumn.get(key) ?? []), c.col]);
    }
    for (const [key, cols] of byColumn) {
      const [tbl, priv] = key.split('\u0000') as [string, string];
      (held[tbl] ??= []).push(`${priv}(${cols.sort().join(',')})`);
    }
    const order = (privs: readonly string[]) => [...privs].sort();
    const heldSorted = Object.fromEntries(Object.entries(held).map(([t, p]) => [t, order(p)]));
    const expected = Object.fromEntries(Object.entries(EXPECTED).map(([t, p]) => [t, order(p)]));
    expect(heldSorted).toEqual(expected);
  });

  it('may do exactly that, whoever granted it: PUBLIC and any role included, table by table and column by column', async () => {
    // What it may actually do, not the rows written to its name: a grant to PUBLIC, or to a role it
    // belongs to, is a privilege it holds too, and with BYPASSRLS every organisation's rows come with it.
    const v17 = Number((await ownerRows<{ v: string }>(sql`SELECT current_setting('server_version_num') AS v`))[0]!.v) >= 170000;
    const privileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', ...(v17 ? ['MAINTAIN'] : [])];
    const relations = sql`
      SELECT c.oid, CASE WHEN n.nspname = 'public' THEN c.relname ELSE n.nspname || '.' || c.relname END AS tbl
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
         AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND left(n.nspname, 3) <> 'pg_'`;
    const tables = await ownerRows<{ tbl: string; priv: string }>(sql`
      SELECT r.tbl, p.priv FROM (${relations}) r
        CROSS JOIN unnest(ARRAY[${sql.raw(privileges.map((p) => `'${p}'`).join(', '))}]) AS p(priv)
       WHERE has_table_privilege(${SYSTEM_ROLE}, r.oid, p.priv)`);
    const columns = await ownerRows<{ tbl: string; col: string; priv: string }>(sql`
      SELECT r.tbl, a.attname AS col, p.priv FROM (${relations}) r
        JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
        CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) AS p(priv)
       WHERE NOT has_table_privilege(${SYSTEM_ROLE}, r.oid, p.priv)
         AND has_column_privilege(${SYSTEM_ROLE}, r.oid, a.attnum, p.priv)`);
    const held: Record<string, string[]> = {};
    for (const t of tables) (held[t.tbl] ??= []).push(t.priv);
    const byColumn = new Map<string, string[]>();
    for (const c of columns) {
      const key = `${c.tbl}\u0000${c.priv}`;
      byColumn.set(key, [...(byColumn.get(key) ?? []), c.col]);
    }
    for (const [key, cols] of byColumn) {
      const [tbl, priv] = key.split('\u0000') as [string, string];
      (held[tbl] ??= []).push(`${priv}(${cols.sort().join(',')})`);
    }
    const order = (privs: readonly string[]) => [...privs].sort();
    const heldSorted = Object.fromEntries(Object.entries(held).map(([t, p]) => [t, order(p)]));
    const expected = Object.fromEntries(Object.entries(EXPECTED).map(([t, p]) => [t, order(p)]));
    expect(heldSorted).toEqual(expected);
  });

  it('may do nothing else anywhere: no SECURITY DEFINER function, no sequence, no schema to create in, no default for PUBLIC', async () => {
    const elsewhere = await ownerRows<{ what: string }>(sql`
      SELECT 'function ' || p.oid::regprocedure::text || ': EXECUTE, as its owner' AS what
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema')
         AND has_function_privilege(${SYSTEM_ROLE}, p.oid, 'EXECUTE')
      UNION ALL
      SELECT 'sequence ' || c.relname || ': ' || p.priv
        FROM pg_class c CROSS JOIN unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) AS p(priv)
       WHERE c.relkind = 'S' AND has_sequence_privilege(${SYSTEM_ROLE}, c.oid, p.priv)
      UNION ALL
      SELECT 'schema ' || n.nspname || ': ' || p.priv
        FROM pg_namespace n CROSS JOIN unnest(ARRAY['USAGE', 'CREATE']) AS p(priv)
       WHERE has_schema_privilege(${SYSTEM_ROLE}, n.oid, p.priv)
         AND NOT (p.priv = 'USAGE' AND n.nspname IN ('pg_catalog', 'information_schema'))
      UNION ALL
      SELECT 'database ' || current_database() || ': ' || p.priv
        FROM unnest(ARRAY['CONNECT', 'TEMPORARY', 'CREATE']) AS p(priv)
       WHERE has_database_privilege(${SYSTEM_ROLE}, current_database(), p.priv)
      UNION ALL
      SELECT 'default privileges for ' || CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END
             || ' on ' || d.defaclobjtype::text || ': ' || a.privilege_type
        FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
       WHERE a.grantee = 0 OR a.grantee = ${SYSTEM_ROLE}::regrole`);
    const db = (await ownerRows<{ db: string }>(sql`SELECT current_database() AS db`))[0]!.db;
    // The database's CONNECT and TEMPORARY are PUBLIC's, as Postgres makes every database: it may
    // connect, and make a table that lives and dies with its own session. Never CREATE.
    expect(elsewhere.map((e) => e.what).sort()).toEqual([`database ${db}: CONNECT`, `database ${db}: TEMPORARY`, 'schema public: USAGE']);
  });

  it('holds nothing on any schema, database, function or default but its schema\'s USAGE', async () => {
    const elsewhere = await ownerRows<{ what: string }>(sql`
      SELECT 'schema ' || n.nspname || ': ' || a.privilege_type AS what
        FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a WHERE a.grantee = ${SYSTEM_ROLE}::regrole
      UNION ALL
      SELECT 'database ' || d.datname || ': ' || a.privilege_type
        FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a WHERE a.grantee = ${SYSTEM_ROLE}::regrole
      UNION ALL
      SELECT 'function ' || p.proname || ': ' || a.privilege_type
        FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE a.grantee = ${SYSTEM_ROLE}::regrole
      UNION ALL
      SELECT 'default privileges: ' || d.defaclobjtype::text
        FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE a.grantee = ${SYSTEM_ROLE}::regrole
      UNION ALL
      SELECT 'owns ' || c.relname FROM pg_class c WHERE c.relowner = ${SYSTEM_ROLE}::regrole`);
    expect(elsewhere.map((e) => e.what).sort()).toEqual(EXPECTED_ELSEWHERE);
  });

  it('is granted DELETE on every table the purge empties, so no erasure stops on one', () => {
    for (const table of PURGED_TABLES) {
      // `?? []`: a table missing from EXPECTED reads "expected [] to include 'DELETE'"
      // after its name, not an argument-type error about `undefined`.
      expect(EXPECTED[table] ?? [], `${table} is in PURGED_TABLES and has no grant listed here`).toContain('DELETE');
    }
  });
});

describe('it is refused what it was not given', () => {
  /**
   * One statement as the role, on a connection of its own that is closed
   * after it, inside a transaction rolled back after it: a statement a broken
   * role is let through (a `SET ROLE`, a hold, a `TRUNCATE`) changes nothing
   * the next case reads. `CREATE DATABASE` cannot run in a transaction; what
   * it would make is dropped in `afterAll`.
   */
  const refused = async (statement: string, inATransaction = true): Promise<string> => {
    const client = new Client({ connectionString: systemUrl() });
    await client.connect();
    try {
      if (inATransaction) await client.query('BEGIN');
      await client.query(statement);
      return 'accepted';
    } catch (err) {
      return (err as Error).message;
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  };

  afterAll(async () => {
    // Only a role let through makes it; as the owner, outside a transaction.
    await owner.execute(sql.raw('DROP DATABASE IF EXISTS x0138f_database'));
  });

  it.each([
    ['creating a role', 'CREATE ROLE x0138f_role', /permission denied to create role/],
    ['creating a database', 'CREATE DATABASE x0138f_database', /permission denied to create database/],
    ['making itself a superuser', `ALTER ROLE ${SYSTEM_ROLE} SUPERUSER`, /permission denied/],
    ["taking a role that reads the server's files", 'SET ROLE pg_read_server_files', /permission denied to set role/],
    ["reading the server's files", "SELECT pg_read_file('PG_VERSION')", /permission denied/],
    ['running a program on the server', "COPY (SELECT 1) TO PROGRAM 'true'", /permission denied|must be superuser|pg_execute_server_program/],
    ['making a permanent table', 'CREATE TABLE x0138f_table (i int)', /permission denied/],
    ['letting another role take its rights', `GRANT ${SYSTEM_ROLE} TO app_user`, /permission denied|must have admin option/],
    ["reading a purged table's rows", 'SELECT natural_key FROM item LIMIT 1', /permission denied/],
    ["reading a member's address", 'SELECT email FROM tenant_member LIMIT 1', /permission denied/],
    ["reading a person's link", 'SELECT secret_hash, person_id, expires_at FROM person_link LIMIT 1', /permission denied/],
    ["reading a request's name", 'SELECT name, email FROM access_request LIMIT 1', /permission denied/],
    ['reading an invoice\'s amounts', 'SELECT total FROM invoice LIMIT 1', /permission denied/],
    ['reading who the operators are', 'SELECT * FROM platform_operator LIMIT 1', /permission denied/],
    ["reading the operator's screens", 'SELECT * FROM support_tenants LIMIT 1', /permission denied/],
    ['writing an organisation', "INSERT INTO tenant (name) VALUES ('x0138f')", /permission denied/],
    ['changing a connection', "UPDATE connection SET display_name = 'x' WHERE false", /permission denied/],
    ['deleting an invoice', 'DELETE FROM invoice WHERE false', /permission denied/],
    ['emptying a table in one go', 'TRUNCATE run', /permission denied/],
    ['a hold of its own', "INSERT INTO platform_pause (message) VALUES ('x')", /permission denied/],
  ])('%s', async (_label, statement, why) => {
    expect(await refused(statement, !statement.startsWith('CREATE DATABASE'))).toMatch(why);
  });

  it('and the owner, by name, too', async () => {
    const [who] = await ownerRows<{ owner: string }>(sql`SELECT current_user AS owner`);
    expect(await refused(`SET ROLE "${who!.owner}"`)).toMatch(/permission denied to set role/);
  });
});

describe('the list, the audit key and the log page, as the system role', () => {
  beforeAll(async () => {
    await owner.execute(sql`
      INSERT INTO tenant (id, name, status) VALUES
        (${A}, 'A the system role reads', 'active'),
        (${B}, 'B the system role reads', 'active'),
        (${C}, 'C closed, its window run out', 'closed')
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`);
  });

  it('lists the active organisations and not the closed one', async () => {
    const listed = await activeOrganisations({ SYSTEM_DATABASE_URL: systemUrl() });
    expect(listed).toContain(A);
    expect(listed).toContain(B);
    expect(listed).not.toContain(C);
  });

  it('keeps and reads the audit key', async () => {
    const key = await deploymentKeyFor(pgDriver(system), AUDIT_PSEUDONYM_PURPOSE);
    expect(key).toHaveLength(32);
  });

  it("writes the operator's log page and an audit line on the jobs' own pool", async () => {
    const warnings: string[] = [];
    const warn = vi.spyOn(log, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    });
    const printed: string[] = [];
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
      printed.push(String(chunk));
      return true;
    }) as never);
    try {
      // The sinks the last job imported pointed at its pool: the system role's.
      await recordAppEvent({ level: 'error', event: 'task.system_role_check', reference: '0138f0e1', tenantId: A });
      exportAuditEvent({
        id: '0138f000-e29b-41d4-a716-446655440fff',
        at: '2026-09-28T12:00:00.000000Z',
        tenantId: A,
        actor: 'system:probe',
        action: 'probe.the_system_role',
      });
      await vi.waitFor(() => expect(printed.some((p) => p.includes('probe.the_system_role'))).toBe(true), {
        timeout: 15_000,
        interval: 50,
      });
    } finally {
      warn.mockRestore();
      write.mockRestore();
    }
    expect(warnings.filter((w) => w.includes('[app-event]') || w.includes('[audit-export]'))).toEqual([]);
    const [events] = await ownerRows<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM app_event WHERE reference = '0138f0e1' AND tenant_id = ${A}`,
    );
    expect(events!.n).toBe(1);
  });
});

describe('the sync tick runs as the system role', () => {
  beforeAll(async () => {
    await owner.execute(sql`
      INSERT INTO connection (id, tenant_id, role, kind, display_name, status) VALUES
        (${A_SOURCE}, ${A}, 'source', 'imap', 'A mail', 'connected'),
        (${B_SOURCE}, ${B}, 'source', 'imap', 'B mail', 'connected'),
        (${C_SOURCE}, ${C}, 'source', 'imap', 'C mail', 'connected')
      ON CONFLICT (id) DO NOTHING`);
    await owner.execute(sql`
      INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES
        (${A_BOX}, ${A}, ${A_SOURCE}, 'user', 'a@system-role.example.invalid'),
        (${B_BOX}, ${B}, ${B_SOURCE}, 'user', 'b@system-role.example.invalid'),
        (${C_BOX}, ${C}, ${C_SOURCE}, 'user', 'c@system-role.example.invalid')
      ON CONFLICT (id) DO NOTHING`);
    await owner.execute(sql`
      INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, name, status) VALUES
        (${A_MAPPING}, ${A}, ${A_BOX}, 'A due', 'active'),
        (${B_MAPPING}, ${B}, ${B_BOX}, 'B running', 'active'),
        (${C_MAPPING}, ${C}, ${C_BOX}, 'C closed', 'active')
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`);
    await owner.execute(sql`
      INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES
        (${A}, ${A_MAPPING}, 'email', true),
        (${B}, ${B_MAPPING}, 'email', true),
        (${C}, ${C_MAPPING}, 'email', true)
      ON CONFLICT DO NOTHING`);
    // B's pass is under way: the tick counts it and leaves B alone.
    await owner.execute(sql`
      INSERT INTO run (id, tenant_id, mapping_id, kind, status, started_at) VALUES
        (${B_RUNNING}, ${B}, ${B_MAPPING}, 'incremental', 'running', now())
      ON CONFLICT (id) DO UPDATE SET status = 'running', started_at = now()`);
  });

  const theBeat = async (): Promise<Date | undefined> => {
    const [beat] = await ownerRows<{ at: string | Date }>(
      sql`SELECT beat_at AS at FROM sync_tick_beat WHERE task = 'managed-sync-tick'`,
    );
    return beat ? new Date(beat.at) : undefined;
  };

  it('under a hold: starts nothing, counts what is in flight, and beats', async () => {
    const hold = `${P}ff`;
    await owner.execute(sql`INSERT INTO platform_pause (id, message, started_by) VALUES (${hold}, 'a drain, 0138 T3', 'system:probe')`);
    const before = Date.now();
    try {
      stand.triggered.splice(0);
      const summary = await tickRun({}, {});
      expect(summary.heldSince).toBeTruthy();
      expect(summary.stillRunning).toBeGreaterThanOrEqual(1);
      expect(stand.triggered).toEqual([]);
      expect((await theBeat())!.getTime()).toBeGreaterThanOrEqual(before - 1_000);
    } finally {
      await owner.execute(sql`UPDATE platform_pause SET ended_at = now(), ended_by = 'system:probe' WHERE id = ${hold}`);
    }
  });

  it("starts A's due migration, leaves B's running one and the closed C's alone, and beats", async () => {
    const before = Date.now();
    stand.triggered.splice(0);
    const summary = await tickRun({}, {});
    expect(summary.heldSince).toBeUndefined();
    expect(summary.failedToEnqueue).toBe(0);
    const mine = stand.triggered.filter((t) => [A, B, C].includes(t.tenantId));
    expect(mine).toEqual([{ tenantId: A, mappingId: A_MAPPING, domains: ['email'] }]);
    expect(summary.skippedRunning).toBeGreaterThanOrEqual(1);
    expect((await theBeat())!.getTime()).toBeGreaterThanOrEqual(before - 1_000);
  });
});

describe('retention runs as the system role', () => {
  beforeAll(async () => {
    // A's old run, finished long ago and billed through, goes with its log;
    // its new one stays. A declined request past its thirty days goes, and an
    // event of the log page past its month.
    await owner.execute(sql`
      INSERT INTO run (id, tenant_id, mapping_id, kind, status, created_at, started_at, finished_at) VALUES
        (${A_OLD_RUN}, ${A}, ${A_MAPPING}, 'incremental', 'succeeded', now() - interval '300 days', now() - interval '300 days', now() - interval '300 days'),
        (${A_NEW_RUN}, ${A}, ${A_MAPPING}, 'incremental', 'succeeded', now() - interval '1 day', now() - interval '1 day', now() - interval '1 day')
      ON CONFLICT (id) DO NOTHING`);
    await owner.execute(sql`
      INSERT INTO run_event (tenant_id, run_id, message, at) VALUES
        (${A}, ${A_OLD_RUN}, 'an old line', now() - interval '300 days'),
        (${A}, ${A_NEW_RUN}, 'a new line', now())`);
    await owner.execute(sql`
      INSERT INTO invoice (id, tenant_id, period_start, period_end, status) VALUES
        (${A_INVOICE}, ${A}, (now() - interval '130 days')::date, (now() - interval '100 days')::date, 'sent')
      ON CONFLICT (id) DO NOTHING`);
    await owner.execute(sql`
      INSERT INTO access_request (id, email, name, organisation, state, decided_by, decided_at) VALUES
        (${A_DECLINED}, 'declined@system-role.example.invalid', 'Declined', 'Nobody', 'declined', 'system:probe', now() - interval '40 days')
      ON CONFLICT (id) DO NOTHING`);
    await owner.execute(sql`
      INSERT INTO app_event (id, at, level, tenant_id, event, reference) VALUES
        (${A_OLD_EVENT}, now() - interval '40 days', 'warn', ${A}, 'task.an_old_warning', '0138f0e2')
      ON CONFLICT (id) DO NOTHING`);
  });

  it('prunes each thing to its window, and each organisation only as far as its last issued invoice', async () => {
    const summary = await retentionRun({}, {});
    expect(summary.runsDeleted).toBeGreaterThanOrEqual(1);
    const runs = await ownerRows<{ id: string }>(sql`SELECT id FROM run WHERE id IN (${A_OLD_RUN}, ${A_NEW_RUN})`);
    expect(runs.map((r) => r.id)).toEqual([A_NEW_RUN]);
    const lines = await ownerRows<{ message: string }>(sql`SELECT message FROM run_event WHERE tenant_id = ${A}`);
    expect(lines.map((l) => l.message)).toEqual(['a new line']);
    expect(await ownerRows(sql`SELECT 1 FROM access_request WHERE id = ${A_DECLINED}`)).toEqual([]);
    expect(await ownerRows(sql`SELECT 1 FROM app_event WHERE id = ${A_OLD_EVENT}`)).toEqual([]);
  });
});

describe('the purge of a closed organisation runs as the system role', () => {
  beforeAll(async () => {
    await owner.execute(sql`
      INSERT INTO tenant_closure (tenant_id, closed_at, purge_after, closed_by) VALUES
        (${C}, now() - interval '8 days', now() - interval '1 day', 'system:probe')
      ON CONFLICT (tenant_id) DO UPDATE SET purge_after = EXCLUDED.purge_after`);
    await owner.execute(sql`
      INSERT INTO erasure_record (tenant_ref, requested_at, window_days, backup_retention_days, backups_expire_at)
      VALUES (${tenantRef(C)}, now() - interval '8 days', 7, 7, now() + interval '6 days')`);
    await owner.execute(sql`
      INSERT INTO run (id, tenant_id, mapping_id, kind, status, created_at, started_at, finished_at, orchestrator_ref) VALUES
        (${C_FINISHED_RUN}, ${C}, ${C_MAPPING}, 'incremental', 'succeeded', now() - interval '9 days', now() - interval '9 days', now() - interval '9 days', NULL),
        (${C_STALE_RUN}, ${C}, ${C_MAPPING}, 'incremental', 'running', now() - interval '9 days', now() - interval '9 days', NULL, 'run_c_long_gone')
      ON CONFLICT (id) DO NOTHING`);
    await owner.execute(sql`
      INSERT INTO run_event (tenant_id, run_id, message) VALUES (${C}, ${C_FINISHED_RUN}, 'C copied something')`);
    await owner.execute(sql`
      INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash, status) VALUES
        (${C}, ${C_MAPPING}, 'email', 'INBOX', 'c-1', 'h-0138f-c-1', 'copied')`);
    await owner.execute(sql`INSERT INTO audit_log (tenant_id, action) VALUES (${C}, 'mapping.created')`);
    // The person C's migration is for (managed migration 0031): a name and an address to erase.
    await owner.execute(sql`
      INSERT INTO person (id, tenant_id, display_name, email) VALUES
        (${C_PERSON}, ${C}, 'C the person moved', 'moved@c.system-role.example.invalid')
      ON CONFLICT (id) DO NOTHING`);
    await owner.execute(sql`
      INSERT INTO person_migration (mapping_id, person_id, tenant_id) VALUES (${C_MAPPING}, ${C_PERSON}, ${C})
      ON CONFLICT (mapping_id) DO NOTHING`);
    // That person's grant link (managed migration 0034): a door left open, which the purge closes.
    await owner.execute(sql`
      INSERT INTO person_link (id, tenant_id, person_id, purpose, secret_hash, created_by, expires_at) VALUES
        (${C_LINK}, ${C}, ${C_PERSON}, 'grant', 'h-0138f-c-link', 'user-0138f-c-owner', now() + interval '7 days')
      ON CONFLICT (id) DO NOTHING`);
    // When C's migration was last visited (workplan 0157 T7, managed migration 0042): erased with it.
    await owner.execute(sql`
      INSERT INTO migration_visit (mapping_id, tenant_id) VALUES (${C_MAPPING}, ${C})
      ON CONFLICT (mapping_id) DO NOTHING`);
    await owner.execute(sql`
      INSERT INTO tenant_member (tenant_id, user_id, email, role, status) VALUES
        (${C}, 'user-0138f-c-owner', 'owner@c.system-role.example.invalid', 'owner', 'active')
      ON CONFLICT DO NOTHING`);
    await owner.execute(sql`
      INSERT INTO billing_party (tenant_id, name, address_line1, postal_code, city, country_code) VALUES
        (${C}, 'C the buyer', 'Street 1', '1234 AB', 'Utrecht', 'NL')
      ON CONFLICT DO NOTHING`);
    await owner.execute(sql`
      INSERT INTO invoice (id, tenant_id, period_start, period_end, status) VALUES
        (${C_INVOICE}, ${C}, (now() - interval '40 days')::date, (now() - interval '10 days')::date, 'sent')
      ON CONFLICT (id) DO NOTHING`);
    await owner.execute(sql`
      INSERT INTO access_request (id, email, name, organisation, state, tenant_id, decided_by, decided_at) VALUES
        (${C_REQUEST}, 'c@system-role.example.invalid', 'C', 'C', 'granted', ${C}, 'system:probe', now() - interval '60 days')
      ON CONFLICT (id) DO NOTHING`);
    await owner.execute(sql`
      INSERT INTO app_event (level, tenant_id, event, reference) VALUES ('warn', ${C}, 'task.about_c', '0138f0e3')`);
  });

  it('lands the run that is gone, revokes, erases every row of C, keeps its invoice detached, and writes the receipt', async () => {
    const summary = await purgeRun({}, {});
    expect(summary.failed).toBe(0);
    expect(summary.purged).toBeGreaterThanOrEqual(1);

    expect(await ownerRows(sql`SELECT 1 FROM tenant WHERE id = ${C}`)).toEqual([]);
    for (const table of PURGED_TABLES) {
      const [left] = await ownerRows<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE tenant_id = ${C}::uuid`,
      );
      expect(left!.n, `${table} still holds C's rows`).toBe(0);
    }
    const [invoice] = await ownerRows<{ tenant_id: string | null; billed_to_name: string }>(
      sql`SELECT tenant_id, billed_to_name FROM invoice WHERE id = ${C_INVOICE}`,
    );
    expect(invoice).toEqual({ tenant_id: null, billed_to_name: 'C the buyer' });
    const [receipt] = await ownerRows<{ purged: boolean; counts: Record<string, number>; kept: string[] }>(sql`
      SELECT purged_at IS NOT NULL AS purged, purged_counts AS counts, retained_invoice_ids AS kept
        FROM erasure_record WHERE tenant_ref = ${tenantRef(C)}`);
    expect(receipt!.purged).toBe(true);
    expect(receipt!.kept).toEqual([C_INVOICE]);
    expect(receipt!.counts.item).toBe(1);
    expect(receipt!.counts.run).toBe(2);
    expect(receipt!.counts.tenant).toBe(1);
    expect(receipt!.counts.person).toBe(1);
    expect(receipt!.counts.person_migration).toBe(1);
    expect(receipt!.counts.person_link).toBe(1);
    expect(receipt!.counts.migration_visit).toBe(1);
  });

  it('and A and B are as they were', async () => {
    const left = await ownerRows<{ id: string }>(sql`SELECT id FROM tenant WHERE id IN (${A}, ${B}) ORDER BY id`);
    expect(left.map((t) => t.id)).toEqual([A, B]);
  });
});

describe('a setting the role leaves on itself is gone after the bring-up sets its password', () => {
  /**
   * An ordinary role may change its own password and its own settings, and
   * every run holds this role's URL. A run that had been taken over could leave
   * `default_transaction_read_only = on` on it, for every database or for this
   * one: from then on the tick, retention, the purge and the audit key fail on
   * every write, and resetting the password does not clear it. So the
   * statements the bring-up sets the password with (`db-roles.sh`,
   * DB_ROLES_SYSTEM_SET_SQL) reset both, and the smoke asks that none is left.
   * Run here as the owner, the psql variables written in.
   */
  const db = async () => (await ownerRows<{ db: string }>(sql`SELECT current_database() AS db`))[0]!.db;
  const settings = async () =>
    (
      await ownerRows<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM pg_db_role_setting
         WHERE setrole = ${SYSTEM_ROLE}::regrole
           AND setdatabase IN (0, (SELECT oid FROM pg_database WHERE datname = current_database()))`)
    )[0]!.n;

  afterAll(async () => {
    const name = await db();
    await owner.execute(sql.raw(`ALTER ROLE ${SYSTEM_ROLE} RESET ALL`));
    await owner.execute(sql.raw(`ALTER ROLE ${SYSTEM_ROLE} IN DATABASE "${name}" RESET ALL`));
  });

  it('may leave one, which stops its writes', async () => {
    const name = await db();
    const client = new Client({ connectionString: systemUrl() });
    await client.connect();
    try {
      await client.query(`ALTER ROLE ${SYSTEM_ROLE} SET default_transaction_read_only = on`);
      await client.query(`ALTER ROLE ${SYSTEM_ROLE} IN DATABASE "${name}" SET statement_timeout = 1`);
    } finally {
      await client.end();
    }
    expect(await settings()).toBe(2);
    const late = new Client({ connectionString: systemUrl() });
    await late.connect();
    try {
      await expect(late.query("INSERT INTO app_event (level, event, reference) VALUES ('warn', 'task.x', '0138f0e4')")).rejects.toThrow(
        /read-only transaction|statement timeout/,
      );
    } finally {
      await late.end();
    }
  });

  it("and the bring-up's statements clear both", async () => {
    const name = await db();
    const resets = dbRolesSql('DB_ROLES_SYSTEM_SET_SQL')
      .split('\n')
      .filter((line) => /RESET ALL;\s*$/.test(line))
      .map((line) => line.replaceAll(':"system_role"', `"${SYSTEM_ROLE}"`).replaceAll(':"DBNAME"', `"${name}"`));
    expect(resets, 'DB_ROLES_SYSTEM_SET_SQL resets no setting').not.toEqual([]);
    for (const statement of resets) await owner.execute(sql.raw(statement));
    expect(await settings()).toBe(0);
  });
});
