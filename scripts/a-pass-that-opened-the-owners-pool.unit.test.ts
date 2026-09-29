// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PASS THAT OPENED THE OWNER'S POOL (workplan 0138 T4, landed as a ratchet
 * under T0's option (b); the ratchet emptied and deleted by T1 step 2).
 *
 * The API's request path connects as `app_user`, so row security filters every
 * query it makes on a tenant table. Until 0138 T1's second step the Trigger.dev
 * tasks did not: every job in `apps/worker/src/jobs/` built its pool from
 * `DATABASE_URL`, the database owner, and the owner is a superuser on the
 * managed stack. Postgres applies no row security to a superuser, `FORCE` or
 * not, so in the task plane the boundary between organisations rested on each
 * query's own `WHERE` clause and nothing else (0138 §1, "What this means").
 *
 * T1 moved the per-tenant tasks to `APP_DATABASE_URL`, through one module,
 * `apps/worker/src/jobs/task-pools.ts`. This guard holds that line:
 *
 *   1. A file that reads a database URL from the environment other than
 *      `APP_DATABASE_URL` must be on CROSS_TENANT, which is closed. Each entry
 *      asks a question that spans organisations by nature, or runs at the
 *      machine and never as a task, or reads the owner's URL for one narrow
 *      thing that holds no organisation's rows, and says which.
 *   2. A file in `jobs/` that builds a pool must be on CROSS_TENANT too.
 *   3. Every task file is one of two kinds: on CROSS_TENANT, or on PER_TENANT,
 *      and a PER_TENANT file (and the standalone worker, `src/index.ts`) takes
 *      its pools from `openTaskPools` and points no sink itself, because the
 *      module points the audit export at the key's pool and nothing else may
 *      point it back at the tenant pool, where every line would be lost.
 *   4. `task-pools.ts` does nothing when it is imported. A job imports it at its
 *      top; a pool it built, or a sink it set, at import would be one the job
 *      did not ask for, in every file that imports a job to test it.
 *   5. What `openTaskPools` hands back, such a file takes the tenant pool of,
 *      and its `end`, and nothing else; it names no `end`, on any name, but in
 *      a function handed to `afterwards(…)`; and no file but the module names
 *      the key's pool. The module handed the jobs the key's pool, the owner's,
 *      until review found that one token (`const { auditKey: pool } =
 *      openTaskPools()`) put a pass back on a superuser with all 486 tests of
 *      every guard here and beside the jobs green (0138 T1 step 2's review).
 *      And an end waits for `afterwards`, which `leavesAReference` runs once a
 *      failure is recorded, because the operator's log page is on the tenant
 *      pool: ended in the run's own `finally`, it was gone before the wrapper
 *      recorded run-cutover's or run-rollback's failure there. Every end
 *      counts, not only `pools.end`: the tenant pool goes under whatever name
 *      the job gives it, and re-review ended it as `pool.end()` in
 *      run-cutover's `finally`, with `afterwards(() => pools.end())` kept and
 *      every guard green (0138 T1 step 2's re-review). An end in another
 *      file's function that the pool is handed to is out of sight; none has
 *      one.
 *   6. Three jobs are SPLIT (0138 T2, open question 3 answered 2026-09-28):
 *      the digest, the drift detector and group discovery ask ONE question
 *      across organisations, which organisations are active, and everything
 *      else they read or write is one organisation's. A SPLIT file reads no
 *      database URL and builds no pool (rules 1 and 2); takes its pools from
 *      `openTaskPools`, under rules 3 and 5, opened in its run and ended in
 *      `afterwards`; and takes its list from `activeOrganisations`
 *      (task-pools.ts). On the tenant pool a read outside a scope finds
 *      nothing, fail closed, so it names that pool, under whatever name and in
 *      whatever function, only as the first argument of `withTenant` or
 *      `tenantScopedDb`, or hands it to a function of its own file whose
 *      parameter is a `Pool` and which this rule reads in turn.
 *      `activeOrganisations` is named by the three and by the module alone.
 *      Rule 7 is what keeps the owner's side of a split job to ids. Neither
 *      rule sees a per-organisation read in the WRONG organisation's scope:
 *      that is the integration guard's
 *      (`a-job-that-reads-each-organisation-as-itself`), which seeds every
 *      queue the digest counts with different numbers per organisation.
 *   7. What reaches a job from the owner's connection is closed at both ends
 *      (0138 T2's review). Rule 6 alone rested on a split job having no
 *      owner's connection because it reads no URL and builds no pool. Review
 *      added one export to task-pools.ts, `acrossOrganisations(work)`, which
 *      asked the role question and then handed `work` the owner's pool of
 *      one, and with it read every organisation's coverage in the drift
 *      detector's run, every organisation's name and settings in the
 *      digest's, and other organisations' connections from `run-discovery`,
 *      a per-tenant job: every guard green, unit and integration. And a second
 *      list the module built with drizzle, `drizzle(list).select(…)
 *      .from(tenant)`, had no statement text for the rule on the module's
 *      statements to read. So:
 *        - task-pools.ts exports the values on TASK_POOLS_EXPORTS and types,
 *          nothing else: no `export … from`, no default.
 *        - it imports the values on TASK_POOLS_IMPORTS and nothing else: no
 *          query builder, no schema.
 *        - every pool it builds on the owner's URL (any pool whose connection
 *          string is not read from `APP_DATABASE_URL`: today the key's and
 *          the list's) is a `const`'s value, and that name is named again
 *          only to ask it one of the two statements, to `.end()` it, to hear
 *          its `.on(…)`, or, as the key's is, as `pgDriver(…)` inside
 *          `auditExportOn(…)`. Never returned, handed to another call, stored
 *          or spread. Every `.query(` in the module asks
 *          `ACTIVE_ORGANISATIONS_SQL` or `SEES_EVERY_ORGANISATION_SQL`, and
 *          each is the literal the list and the role question are held to:
 *          the list is `id` from `tenant`, no other column and no other table.
 *        - `activeOrganisations` is declared `Promise<string[]>` and returns
 *          `rows.map((row) => row.id)`, and nothing else.
 *        - a file takes from task-pools.ts only what its kind may: a
 *          PER_TENANT file and the standalone worker `openTaskPools`, a SPLIT
 *          file that and `activeOrganisations`, any other file nothing (types
 *          are free; tests are not read). No `import * as`, no `import(…)`,
 *          no re-export. And none of those files imports a value from another
 *          file on CROSS_TENANT.
 *      It reads each file's own imports: an owner's pool handed on through a
 *      module none of them imports directly would be out of its sight. No
 *      file on CROSS_TENANT exports a pool.
 *   8. No task reads the owner's URL at all (0138 T3 step 2). The files on
 *      CROSS_TENANT are of two kinds, each closed. ON_THE_SYSTEM_ROLE: the
 *      three jobs that span organisations whole and `task-pools.ts` (the
 *      split jobs' list and the audit key's pool), which run in a task and
 *      read `SYSTEM_DATABASE_URL` and no other database URL: the system role,
 *      `ownpace_system`, which is not a superuser, may not create roles or
 *      databases, and holds `BYPASSRLS` and the grants its statements need
 *      (managed migration 0032). AT_THE_MACHINE: the operator's CLI and
 *      `direct-url.ts`, which never run in a task and may read the owner's
 *      URL for the person who runs them, and never read the system role's.
 *      No other file reads `SYSTEM_DATABASE_URL`. Until step 2 the four read
 *      `DATABASE_URL`, the owner, a superuser, and `set-task-env.sh` uploaded
 *      it to every run; it uploads the system role's URL now and deletes the
 *      owner's from the store (`a-run-that-carries-no-superuser`). There is
 *      no fallback either way: a file that read both names would be one
 *      `DATABASE_URL` in `.env` away from the owner again. And no fallback
 *      this cannot see: the machine's files export exactly what is listed for
 *      them (`direct-url.ts` its OWNER_URL_HELPERS, the CLI nothing), a file on
 *      ON_THE_SYSTEM_ROLE imports nothing of theirs, and reads the environment
 *      only by a name it spells (`process.env.X`, `env['X']`): no computed key,
 *      no `process.env` handed on whole. Review put the owner back behind a
 *      new `direct-url.ts` export and behind `process.env[`${p}DATABASE_URL`]`,
 *      each with every guard green (0138 T3 step 2).
 *
 * Until T1's second step there was a second list, KNOWN_REMOVED_BY_T1, of the
 * per-tenant readers the ratchet let stand: eleven when it landed, the three
 * builder files off it in T1's first step, and the eight jobs off it, and the
 * list with its pins deleted, in its second (2026-09-28).
 *
 * So a NEW file that names a database URL other than `APP_DATABASE_URL` fails
 * at once. A file that reaches the owner's URL through a function, without
 * naming it, is caught only where the function is known:
 * `migrationConnectionString` and `poolerInFront`
 * (`packages/ledger/src/direct-url.ts`) read the owner's URL from the
 * environment their caller passes, and the first returns it, so no scanned file
 * but their own may name them. The builders were the other such functions: T1
 * part 2 (2026-09-28) had them build on the pool their caller hands in, and
 * `openLedger` and `verifyMapping` on the handle theirs does.
 *
 * WHAT "READS A DATABASE URL" MEANS HERE. Any name ending in `DATABASE_URL`
 * other than `APP_DATABASE_URL` (so `DATABASE_URL`, `DIRECT_DATABASE_URL`, the
 * builders' old `TEST_DATABASE_URL || DATABASE_URL` fallback, and T3 step 2's
 * `SYSTEM_DATABASE_URL`, which the T3 guard, `a-run-that-carries-no-superuser`,
 * only lets go up under such a name), used as a property (`process.env.X`,
 * `env.X`), an element (`env['X']`), a destructured binding (`{ X } = …`) or a
 * string whose whole text is the name (`getEnv('X')`). Parsed, not grepped: a
 * comment or an error message that mentions the name is not a read.
 *
 * WHAT IT DOES NOT SEE. A `new Pool()` with no connection string, which
 * node-postgres fills from `PGHOST`, `PGUSER` and the rest. No file here does
 * that; the rule on who may build a pool in `jobs/` is the net for it in the
 * place that matters. That rule counts a `new` of `Pool`, or of pg's `Client`,
 * under any local name (`import { Pool as PgPool } from 'pg'` got past its
 * first version), and a `drizzle(…)` given anything but a handle, since
 * drizzle then builds its own pool. It does not count an object with a
 * `connectionString` handed to something else: `cutover-gate.ts` handed one
 * to the verification reader, which opened its own connection from the URL
 * `run-cutover.ts` read, until T1 part 2 gave the reader a tenant-scoped
 * handle on the gate's pool instead. Nor does it see WHICH URL
 * `task-pools.ts` hands each pool: `a-task-pool-that-fell-back-to-the-owner`
 * (beside the module) asks the pools themselves, and
 * `a-pass-under-row-security` (integration) asks Postgres who they are.
 *
 * The list stays in this file, unexported, on purpose. 0138 §3 has T5 step 2's
 * docs guard read CROSS_TENANT, so that `docs/rls-guide.md` and the code cannot
 * disagree about who holds the cross-tenant connection. But importing from a
 * `.unit.test.ts` runs every case in it inside the importer: a one-case test
 * that imported CROSS_TENANT from here reported 63 tests. T5 step 2 therefore
 * first moves the list to a plain module both guards import, and keeps each
 * listed file's route to this guard in docs/LESSONS.md, which today comes
 * from the paths being written here.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Files that may read a database URL other than APP_DATABASE_URL, for good. */
const CROSS_TENANT: Record<string, string> = {
  'apps/worker/src/jobs/managed-sync-tick.ts':
    'which mappings are due across every organisation, how many runs are in flight, ' +
    'whether the platform is on hold (0138 T2); as the system role since T3 step 2',
  'apps/worker/src/jobs/managed-retention.ts':
    'prunes across organisations, each one only as far as its last issued invoice (0138 T2); ' +
    'as the system role since T3 step 2',
  'apps/worker/src/jobs/managed-purge-closed.ts':
    'finds closed organisations whose window has run out, revokes their stored ' +
    'credentials and removes their data (0138 T2); as the system role since T3 step 2',
  'apps/worker/src/cli/index.ts':
    "the operator's cutover CLI, run at the machine by whoever runs the deployment, never as a task",
  'apps/worker/src/jobs/task-pools.ts':
    "the system role's URL for two things that hold no organisation's rows. The audit key's pool: " +
    'one connection, reading deployment_key, which ledger migration 0062 closes to app_user (0138 ' +
    "T1 part 5). And the list of organisations the SPLIT jobs visit (activeOrganisations): one " +
    "connection, one statement, the ids of the active organisations and nothing else, closed " +
    'before it returns (0138 T2). Every tenant read and write goes to APP_DATABASE_URL. Both were ' +
    "the owner's until T3 step 2",
  'packages/ledger/src/direct-url.ts':
    'migrationConnectionString reads the variables from an environment its caller ' +
    'passes; its callers are the API and the seed, and no task calls it',
};

/**
 * The CROSS_TENANT files that run in a task (rule 8, 0138 T3 step 2). Each
 * reads `SYSTEM_DATABASE_URL`, the system role, and no other database URL:
 * never `DATABASE_URL`, the owner, a superuser on the managed stack, which
 * `set-task-env.sh` no longer uploads and deletes from the store.
 */
const ON_THE_SYSTEM_ROLE: readonly string[] = Object.freeze([
  'apps/worker/src/jobs/managed-sync-tick.ts',
  'apps/worker/src/jobs/managed-retention.ts',
  'apps/worker/src/jobs/managed-purge-closed.ts',
  'apps/worker/src/jobs/task-pools.ts',
]);

/**
 * The CROSS_TENANT files that never run in a task (rule 8): they read the
 * owner's URL, or the direct one, for the person who runs them at the
 * machine, and never the system role's.
 */
const AT_THE_MACHINE: readonly string[] = Object.freeze([
  'apps/worker/src/cli/index.ts',
  'packages/ledger/src/direct-url.ts',
]);

/** The one database URL a task reads across organisations (rule 8). */
const SYSTEM_URL = 'SYSTEM_DATABASE_URL';

/**
 * The per-tenant tasks: each asks about one organisation, and takes its pools
 * from `openTaskPools` (`task-pools.ts`), which builds the tenant pool on
 * `APP_DATABASE_URL` and nothing else (0138 T1 part 1). Until T1's second step
 * all eight were on KNOWN_REMOVED_BY_T1, reading `DATABASE_URL` themselves.
 */
const PER_TENANT: readonly string[] = Object.freeze([
  'apps/worker/src/jobs/run-delta-sync.ts',
  'apps/worker/src/jobs/run-discovery.ts',
  'apps/worker/src/jobs/run-verification.ts',
  'apps/worker/src/jobs/run-confirmation.ts',
  'apps/worker/src/jobs/run-apply-deletion.ts',
  'apps/worker/src/jobs/run-apply-relocation.ts',
  'apps/worker/src/jobs/run-cutover.ts',
  'apps/worker/src/jobs/run-rollback.ts',
]);

/**
 * The jobs split in two (0138 T2, open question 3 answered 2026-09-28, "split
 * them"): one question across organisations, which ones are active, asked
 * through `activeOrganisations`, and everything else read or written for one
 * organisation, in that organisation's scope on the tenant pool. Each entry
 * says why it crosses organisations and what it reads per organisation. The
 * list is closed: a job goes here only with both halves said, and the rules
 * below hold it to them.
 */
const SPLIT: Record<string, string> = {
  'apps/worker/src/jobs/managed-digest.ts':
    'which organisations are active, to write each its digest. Per organisation, in its own ' +
    'scope: its own row (name and notification settings), its active owners and admins, its ' +
    'migrations and their queues, its pending decisions, when its last digest went out, and ' +
    'the audit row that records this one (0138 T2)',
  'apps/worker/src/jobs/managed-drift-detect.ts':
    "which organisations are active, to compare each one's directory with what it migrates. Per " +
    'organisation, in its own scope: the addresses its migrations cover, its Microsoft sources, ' +
    'its dismissed decisions and standing preset, and the decisions it raises and closes (0138 T2)',
  'apps/worker/src/jobs/managed-group-discovery.ts':
    "which organisations are active, to list each one's shared addresses. Per organisation, in " +
    'its own scope: its source connections, the groups it records and the decisions it raises. ' +
    'Until 0138 T2 the list was every source connection across organisations, with its config ' +
    '(0138 T2)',
};

/** What a SPLIT job reads across organisations, and all it reads there: the ids of the active ones. */
const THE_LIST = /^\s*SELECT\s+id\s+FROM\s+tenant\s+WHERE\s+status\s*=\s*'active'(?:\s+ORDER\s+BY\s+id)?\s*$/i;

/**
 * The standalone worker (`src/index.ts`, the dev entrypoint the worker README
 * places outside both editions). It runs one organisation's pass from a config
 * file, and takes its pools the way the tasks do (0138 T1 step 2): until then
 * it was on CROSS_TENANT, reading `DATABASE_URL` for its ledger.
 */
const STANDALONE_WORKER = 'apps/worker/src/index.ts';

/** The one module that builds a task's pools. */
const TASK_POOLS = 'apps/worker/src/jobs/task-pools.ts';

/**
 * What task-pools.ts hands out: its values, by name, closed (rule 7). A type
 * carries nothing at run time and is not listed. The module holds the owner's
 * URL, and one more export that handed its caller the owner's pool
 * (`acrossOrganisations(work)`, 0138 T2's review) put a split job and a
 * per-tenant one on it with every guard green. A value added here is one more
 * thing the owner's side hands out, and says what.
 */
const TASK_POOLS_EXPORTS: Record<string, string> = {
  openTaskPools: "the tenant pool and its end (rules 3 and 5); the key's pool stays with its sink",
  activeOrganisations: 'the ids of the active organisations, for the SPLIT jobs (rule 6)',
  ACTIVE_ORGANISATIONS_SQL: "the list's statement as text, for the tests that read it",
};

/**
 * What task-pools.ts imports, as `<module>: <name>`, values only, closed
 * (rule 7). No query builder and no schema: a read built with drizzle has no
 * statement text for the rule on the module's statements to read, and review
 * added one (`drizzle(list).select(…).from(tenant)`) with every guard green.
 */
const TASK_POOLS_IMPORTS: Record<string, string> = {
  'pg: Pool': "the three pools it builds: the tenant pool, the key's and the list's",
  '@openmig/ledger: appEventSinkOn': "the operator's log page's sink, on the tenant pool",
  '@openmig/ledger: auditExportOn': "the audit export's sink, on the key's pool",
  '@openmig/ledger: pgDriver': 'the driver each sink writes through',
  '@openmig/shared: log': "a dropped connection's warning",
  '@openmig/shared: setAppEventSink': 'points the log page at the tenant pool',
  '@openmig/shared: setAuditExportSink': "points the audit export at the key's pool",
};

/** The two statements the module may send, by the names it declares them under (rule 7). */
const THE_MODULES_STATEMENTS = ['ACTIVE_ORGANISATIONS_SQL', 'SEES_EVERY_ORGANISATION_SQL'] as const;

/** What a file may take from task-pools.ts, by the name the module exports it under (rule 7). Types are free. */
function mayTakeFromTaskPools(file: string): readonly string[] {
  if (SPLIT[file] !== undefined) return ['activeOrganisations', 'openTaskPools'];
  if (PER_TENANT.includes(file) || file === STANDALONE_WORKER) return ['openTaskPools'];
  return [];
}

/**
 * Functions that read the owner's URL for their caller, from the environment
 * the caller passes, so the caller never names it; with the one file that may
 * name them. `migrationConnectionString` returns DIRECT_DATABASE_URL, or
 * DATABASE_URL without it; `poolerInFront` compares the two.
 */
const OWNER_URL_HELPERS: Record<string, string> = {
  migrationConnectionString: 'packages/ledger/src/direct-url.ts',
  poolerInFront: 'packages/ledger/src/direct-url.ts',
};

/**
 * What each AT_THE_MACHINE file exports as a value, closed (rule 8). They may
 * read the owner's URL, so a value one of them hands out is a way for a task
 * to reach it without naming it: `direct-url.ts` hands out its two helpers,
 * which rule 1's case keeps out of every other file, and the CLI nothing.
 */
const AT_THE_MACHINE_EXPORTS: Record<string, readonly string[]> = {
  'packages/ledger/src/direct-url.ts': Object.keys(OWNER_URL_HELPERS).sort(),
  'apps/worker/src/cli/index.ts': [],
};

/** A module specifier that names one of the AT_THE_MACHINE files. */
const NAMES_A_MACHINE_FILE = (specifier: string): boolean =>
  /(?:^|\/)direct-url(?:\.[cm]?[jt]s)?$/.test(specifier) || /(?:^|\/)cli(?:\/index)?(?:\.[cm]?[jt]s)?$/.test(specifier);

/**
 * Where a file reads the environment by a name it does not spell (rule 8): an
 * element of `process.env`, or of an object called `env` or `…Env`, by
 * anything but a string, and `process.env` used whole (handed on, spread,
 * assigned, enumerated) anywhere but as a parameter's default.
 */
function envReadsByNoName(file: string, text: string): string[] {
  if (!/\benv\b|Env\b/.test(text)) return [];
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: string[] = [];
  const isProcessEnv = (e: ts.Node): boolean =>
    ts.isPropertyAccessExpression(e) && e.name.text === 'env' && ts.isIdentifier(e.expression) && e.expression.text === 'process';
  const isAnEnv = (e: ts.Expression): boolean => {
    const b = bare(e);
    return isProcessEnv(b) || (ts.isIdentifier(b) && /^(?:env|\w*Env)$/.test(b.text));
  };
  const visit = (node: ts.Node) => {
    if (ts.isElementAccessExpression(node) && isAnEnv(node.expression) && !ts.isStringLiteralLike(node.argumentExpression)) {
      found.push(`${node.getText(sf)} (${whereIs(sf, node)})`);
    } else if (isProcessEnv(node)) {
      let up = node.parent;
      while (up && (ts.isParenthesizedExpression(up) || ts.isNonNullExpression(up) || ts.isAsExpression(up))) up = up.parent;
      const byName =
        (ts.isPropertyAccessExpression(up) || ts.isElementAccessExpression(up)) &&
        bare(up.expression) === node;
      const aDefault = ts.isParameter(up) && up.initializer !== undefined;
      if (!byName && !aDefault) found.push(`process.env, whole (${whereIs(sf, node)})`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

const JOBS_DIR = 'apps/worker/src/jobs';

/** Non-test TypeScript under apps/worker/src and every packages/<name>/src. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.d\.ts$|\.(unit|integration|e2e)\.test\.tsx?$/.test(e.name)) {
        out.push(relative(REPO_ROOT, p));
      }
    }
  };
  walk(join(REPO_ROOT, 'apps/worker/src'));
  for (const pkg of readdirSync(join(REPO_ROOT, 'packages'))) walk(join(REPO_ROOT, 'packages', pkg, 'src'));
  return out.sort();
}

const IS_DB_URL = (name: string) => /^(?:[A-Z][A-Z0-9]*_)*DATABASE_URL$/.test(name) && name !== 'APP_DATABASE_URL';

/** The database-URL names a file reads, by the four forms in the header. */
function databaseUrlReads(file: string, text: string): string[] {
  // Cheap filter first: parsing every file would put this over the unit budget.
  if (!text.includes('DATABASE_URL')) return [];
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && IS_DB_URL(node.name.text)) found.add(node.name.text);
    else if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      IS_DB_URL(node.argumentExpression.text)
    ) {
      found.add(node.argumentExpression.text);
    } else if (ts.isBindingElement(node)) {
      const key = node.propertyName ?? node.name;
      if ((ts.isIdentifier(key) || ts.isStringLiteralLike(key)) && IS_DB_URL(key.text)) found.add(key.text);
    } else if (ts.isStringLiteralLike(node) && IS_DB_URL(node.text) && !ts.isElementAccessExpression(node.parent)) {
      found.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...found].sort();
}

/** Strip what changes a value's type and not the value. */
function bare(e: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(e) ||
    ts.isNonNullExpression(e) ||
    ts.isAsExpression(e) ||
    ts.isSatisfiesExpression(e) ||
    ts.isTypeAssertionExpression(e)
  ) {
    e = e.expression;
  }
  return e;
}

/**
 * Whether a file builds a node-postgres pool, or a client, itself: a `new` of
 * `Pool`, or of pg's `Client`, under any name it is bound to; `createPgDb`; or a
 * `drizzle(…)` whose first argument is not a handle it was given.
 */
function buildsAPool(file: string, text: string): boolean {
  if (!/Pool|Client|createPgDb|drizzle/.test(text)) return false;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const PG_CLASSES = ['Pool', 'Client'];
  const pgNames = new Set<string>(); // local names bound to pg's Pool or Client
  const pgModules = new Set<string>(); // local names bound to pg itself
  const drizzleNames = new Set<string>(['drizzle']);
  const bind = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const from = node.moduleSpecifier.text;
      const clause = node.importClause?.isTypeOnly ? undefined : node.importClause;
      const named = clause?.namedBindings;
      if (from === 'pg' && clause?.name) pgModules.add(clause.name.text);
      if (from === 'pg' && named && ts.isNamespaceImport(named)) pgModules.add(named.name.text);
      if (named && ts.isNamedImports(named)) {
        for (const el of named.elements) {
          const imported = (el.propertyName ?? el.name).text;
          if (el.isTypeOnly) continue;
          if (from === 'pg' && PG_CLASSES.includes(imported)) pgNames.add(el.name.text);
          if (from.startsWith('drizzle-orm') && imported === 'drizzle') drizzleNames.add(el.name.text);
        }
      }
    } else if (ts.isVariableDeclaration(node) && node.initializer) {
      // `const P = pg.Pool` and `const { Pool: P } = pg`.
      const init = bare(node.initializer);
      if (ts.isIdentifier(node.name) && ts.isPropertyAccessExpression(init) && init.name.text === 'Pool') {
        pgNames.add(node.name.text);
      } else if (ts.isObjectBindingPattern(node.name)) {
        for (const el of node.name.elements) {
          const key = el.propertyName ?? el.name;
          if (ts.isIdentifier(key) && key.text === 'Pool' && ts.isIdentifier(el.name)) pgNames.add(el.name.text);
        }
      }
    }
    ts.forEachChild(node, bind);
  };
  bind(sf);
  const isPgClass = (callee: string) =>
    /(^|\.)Pool$/.test(callee) ||
    pgNames.has(callee) ||
    [...pgModules].some((m) => PG_CLASSES.some((c) => callee === `${m}.${c}`));
  let builds = false;
  const visit = (node: ts.Node) => {
    if (ts.isNewExpression(node)) {
      if (isPgClass(node.expression.getText(sf))) builds = true;
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf);
      if (/(^|\.)createPgDb$/.test(callee)) builds = true;
      else if (drizzleNames.has(callee)) {
        const first = node.arguments[0];
        if (!first || !ts.isIdentifier(bare(first))) builds = true;
      }
    }
    if (!builds) ts.forEachChild(node, visit);
  };
  visit(sf);
  return builds;
}

/** The OWNER_URL_HELPERS a file names as code: an identifier or a string, not a comment. */
function helperNames(file: string, text: string): string[] {
  const helpers = Object.keys(OWNER_URL_HELPERS);
  if (!helpers.some((h) => text.includes(h))) return [];
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const found = new Set<string>();
  const visit = (node: ts.Node) => {
    if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && helpers.includes(node.text)) found.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...found].sort();
}

/** The callee text of every call a Trigger.dev task file registers a task with. */
const TASK_REGISTRARS = new Set(['schemaTask', 'task', 'schedules.task']);

/** Whether a file registers a Trigger.dev task: a `schemaTask(…)`, `task(…)` or `schedules.task(…)`. */
function definesATask(file: string, text: string): boolean {
  if (!/\b(?:schemaTask|task)\s*\(/.test(text)) return false;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  let found = false;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && TASK_REGISTRARS.has(node.expression.getText(sf))) found = true;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** The local names a file imports `openTaskPools` under, from the task-pools module. */
function openTaskPoolsNames(sf: ts.SourceFile): Set<string> {
  const local = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (!/(?:^|\/)task-pools\.ts$/.test(st.moduleSpecifier.text)) continue;
    const named = st.importClause?.isTypeOnly ? undefined : st.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) {
        if (!el.isTypeOnly && (el.propertyName ?? el.name).text === 'openTaskPools') local.add(el.name.text);
      }
    }
  }
  return local;
}

/** What a file may take from what `openTaskPools` hands back. `end` means: one that waits for `afterwards(…)`. */
const MAY_TAKE: readonly string[] = ['end', 'tenant'];

/**
 * Whether an `end` waits for `afterwards(…)`, the third argument
 * `leavesAReference` hands a run: it sits in a function handed to that call,
 * or is itself what is handed (`afterwards(pools.end)`). An end in the call's
 * own arguments (`afterwards(pools.end())`) runs at once, not afterwards.
 */
function waitsForAfterwards(node: ts.Node): boolean {
  const handedToAfterwards = (n: ts.Node): boolean =>
    n.parent !== undefined &&
    ts.isCallExpression(n.parent) &&
    ts.isIdentifier(n.parent.expression) &&
    n.parent.expression.text === 'afterwards' &&
    n.parent.arguments.some((a) => a === n);
  if (handedToAfterwards(node)) return true;
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && handedToAfterwards(n)) return true;
  }
  return false;
}

/**
 * What a file takes from what `openTaskPools` hands back: each property it
 * reads, whether off the call, out of a destructuring, or off a name the whole
 * was bound to; and `the whole` wherever the lot is handed on, spread or kept
 * under another name, since what is done with it then is out of sight. Names
 * are matched in the whole file, not per scope: a job has one such binding.
 *
 * And every `end` the file names, on whatever it names it on: read off a name
 * (`pool.end`), by its key (`pool['end']`) or out of a destructuring
 * (`{ end: close }`). The tenant pool goes under whatever name the job gives
 * it, and its own `end` ends the same pool as the one handed back: 0138 T1
 * step 2's re-review added `finally { await pool.end(); }` to run-cutover, on
 * `const pool = pools.tenant`, kept `afterwards(() => pools.end())`, and every
 * guard stayed green while a failure's event was lost again. So this does not
 * ask which object a name holds: each end counts as `end` where it waits for
 * `afterwards` ({@link waitsForAfterwards}) and as `end, outside afterwards`
 * anywhere else. It reads this one file: an end in a function of another file
 * that the pool is handed to is out of its sight (none has one).
 */
function takenFromTaskPools(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const local = openTaskPoolsNames(sf);
  const taken = new Set<string>();
  const take = (name: string, at: ts.Node) =>
    taken.add(name === 'end' && !waitsForAfterwards(at) ? 'end, outside afterwards' : name);
  const above = (node: ts.Node): ts.Node => {
    let up = node.parent;
    while (ts.isParenthesizedExpression(up) || ts.isNonNullExpression(up) || ts.isAsExpression(up)) up = up.parent;
    return up;
  };
  const bound = new Set<string>();
  const calls = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && local.has(node.expression.text)) {
      const up = above(node);
      if (ts.isPropertyAccessExpression(up)) take(up.name.text, up);
      else if (ts.isVariableDeclaration(up) && ts.isObjectBindingPattern(up.name)) {
        for (const el of up.name.elements) {
          const key = el.propertyName ?? el.name;
          if (el.dotDotDotToken) taken.add('the whole');
          else take(ts.isIdentifier(key) || ts.isStringLiteralLike(key) ? key.text : 'the whole', el);
        }
      } else if (ts.isVariableDeclaration(up) && ts.isIdentifier(up.name)) bound.add(up.name.text);
      else taken.add('the whole');
    }
    ts.forEachChild(node, calls);
  };
  calls(sf);
  const uses = (node: ts.Node) => {
    if (ts.isIdentifier(node) && bound.has(node.text)) {
      const parent = node.parent;
      const declared = ts.isVariableDeclaration(parent) && parent.name === node;
      const aPropertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isBindingElement(parent) && parent.propertyName === node);
      if (declared || aPropertyName) {
        // The binding itself, or another object's property of the same name.
      } else if (ts.isPropertyAccessExpression(parent) && parent.expression === node) take(parent.name.text, parent);
      else if (ts.isVariableDeclaration(parent) && ts.isObjectBindingPattern(parent.name) && parent.initializer === node) {
        for (const el of parent.name.elements) {
          const key = el.propertyName ?? el.name;
          if (el.dotDotDotToken) taken.add('the whole');
          else take(ts.isIdentifier(key) || ts.isStringLiteralLike(key) ? key.text : 'the whole', el);
        }
      } else taken.add('the whole');
    }
    ts.forEachChild(node, uses);
  };
  if (bound.size > 0) uses(sf);
  const ends = (node: ts.Node) => {
    const keyOf = (k: ts.Node) => (ts.isIdentifier(k) || ts.isStringLiteralLike(k) ? k.text : undefined);
    const key = ts.isPropertyAccessExpression(node)
      ? node.name.text
      : ts.isElementAccessExpression(node)
        ? keyOf(node.argumentExpression)
        : ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)
          ? keyOf(node.propertyName ?? node.name)
          : undefined;
    if (key === 'end') take('end', node);
    ts.forEachChild(node, ends);
  };
  ends(sf);
  return [...taken].sort();
}

/** Whether a file names the key's pool as code: an identifier or a string, not a comment. */
function namesTheKeyPool(file: string, text: string): boolean {
  if (!text.includes('auditKey')) return false;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  let found = false;
  const visit = (node: ts.Node) => {
    if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && node.text === 'auditKey') found = true;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/**
 * How a file gets its pools and points its sinks: whether it imports
 * `openTaskPools` from the task-pools module and calls it, and which of the two
 * sink setters it calls itself.
 */
function poolWiring(file: string, text: string): { opensTaskPools: boolean; setsSinks: string[] } {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const local = openTaskPoolsNames(sf);
  let opensTaskPools = false;
  const setsSinks = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf);
      if (local.has(callee)) opensTaskPools = true;
      if (/(?:^|\.)(?:setAuditExportSink|setAppEventSink)$/.test(callee)) setsSinks.add(callee.replace(/^.*\./, ''));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { opensTaskPools, setsSinks: [...setsSinks].sort() };
}

/** The two calls a tenant pool may be handed to: the ones that open its organisation's scope. */
const SCOPES = new Set(['withTenant', 'tenantScopedDb']);

/**
 * Where a SPLIT file names its tenant pool other than to open a scope on it.
 *
 * The tenant pool is every name bound to what `openTaskPools` hands back as
 * `tenant` (off the call, off a name the whole was bound to, or out of a
 * destructuring), `<whole>.tenant` itself, and every parameter the file types
 * `Pool`. Each place one is read must be the first argument of `withTenant` or
 * `tenantScopedDb`, which counts as scoped, or an argument to a function this
 * file declares whose parameter in that place is typed `Pool`, which this
 * reads in turn. Anything else (`pool.query(…)`, `pgDriver(pool)`,
 * `plainDb(pool)`, `drizzle(pool)`, `const other = pool`, `{ pool }` handed on,
 * another file's function) is a place a statement can run on `app_user` with no
 * organisation set, where it finds nothing: it is listed, with its line. Names
 * are matched in the whole file, not per scope, as `takenFromTaskPools` does.
 */
function tenantPoolOutsideAScope(file: string, text: string): { scoped: number; outside: string[] } {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const local = openTaskPoolsNames(sf);
  const isOpen = (e: ts.Expression): boolean => {
    const b = bare(e);
    return ts.isCallExpression(b) && ts.isIdentifier(b.expression) && local.has(b.expression.text);
  };
  const isPoolType = (t: ts.TypeNode | undefined): boolean =>
    t !== undefined && ts.isTypeReferenceNode(t) && t.typeName.getText(sf) === 'Pool';

  // The names the whole of what openTaskPools hands back is bound to.
  const wholes = new Set<string>();
  const findWholes = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name) && isOpen(node.initializer)) {
      wholes.add(node.name.text);
    }
    ts.forEachChild(node, findWholes);
  };
  findWholes(sf);
  const isTenantOf = (e: ts.Node): boolean =>
    ts.isPropertyAccessExpression(e) &&
    e.name.text === 'tenant' &&
    ((ts.isIdentifier(e.expression) && wholes.has(e.expression.text)) || isOpen(e.expression));

  // The names the tenant pool is bound to, and the functions of the file's own that take a Pool.
  const pools = new Set<string>();
  const takesAPool = new Map<string, boolean[]>();
  const findPools = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = bare(node.initializer);
      if (ts.isIdentifier(node.name) && isTenantOf(init)) pools.add(node.name.text);
      if (ts.isObjectBindingPattern(node.name) && ((ts.isIdentifier(init) && wholes.has(init.text)) || isOpen(init))) {
        for (const el of node.name.elements) {
          const key = el.propertyName ?? el.name;
          if (ts.isIdentifier(key) && key.text === 'tenant' && ts.isIdentifier(el.name)) pools.add(el.name.text);
        }
      }
      if (ts.isIdentifier(node.name) && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
        takesAPool.set(node.name.text, init.parameters.map((p) => isPoolType(p.type)));
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name) {
      takesAPool.set(node.name.text, node.parameters.map((p) => isPoolType(p.type)));
    }
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && isPoolType(node.type)) pools.add(node.name.text);
    ts.forEachChild(node, findPools);
  };
  findPools(sf);

  let scoped = 0;
  const outside: string[] = [];
  const at = (node: ts.Node) =>
    `line ${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${node.parent.getText(sf).split('\n')[0]!.slice(0, 90)}`;
  const judge = (node: ts.Expression) => {
    let up: ts.Node = node;
    while (ts.isParenthesizedExpression(up.parent) || ts.isNonNullExpression(up.parent) || ts.isAsExpression(up.parent)) {
      up = up.parent;
    }
    const call = up.parent;
    if (ts.isCallExpression(call) && ts.isIdentifier(call.expression) && call.arguments.includes(up as ts.Expression)) {
      const callee = call.expression.text;
      const index = call.arguments.indexOf(up as ts.Expression);
      if (SCOPES.has(callee) && index === 0) {
        scoped++;
        return;
      }
      if (takesAPool.get(callee)?.[index] === true) return;
    }
    outside.push(at(node));
  };
  const visit = (node: ts.Node) => {
    if (isTenantOf(node)) {
      // `const pool = pools.tenant` binds a name, read in its turn.
      const decl = node.parent;
      if (!(ts.isVariableDeclaration(decl) && decl.initializer === node && ts.isIdentifier(decl.name))) {
        judge(node as ts.Expression);
      }
      return;
    }
    if (ts.isIdentifier(node) && pools.has(node.text)) {
      const p = node.parent;
      const aBinding =
        ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p)) && p.name === node) ||
        (ts.isBindingElement(p) && p.propertyName === node) ||
        (ts.isPropertyAccessExpression(p) && p.name === node) ||
        (ts.isPropertyAssignment(p) && p.name === node) ||
        ts.isTypeReferenceNode(p);
      if (!aBinding) {
        if (ts.isShorthandPropertyAssignment(p)) outside.push(at(node));
        else judge(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { scoped, outside };
}

/** Every string in a file whose text is a statement: a literal or a template, not a comment. */
function sqlStatements(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node)) && /^\s*(?:SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(node.text)) {
      found.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/**
 * The one other statement the module may send on the list's connection: whether
 * the role it connects as sees every organisation (a superuser, or
 * `BYPASSRLS`, T3 step 2's system role). On `app_user` the list would find no
 * organisation and every SPLIT job would visit nobody, reporting it as nothing
 * to do; asked first, it refuses instead.
 */
const THE_ROLE_QUESTION =
  /^\s*SELECT\s+rolsuper\s+OR\s+rolbypassrls\b[\s\S]*\bFROM\s+pg_roles\s+WHERE\s+rolname\s*=\s*current_user\s*$/i;

/** Whether a file names `activeOrganisations` as code, and whether it calls it imported from task-pools.ts. */
function activeOrganisationsUse(file: string, text: string): { names: boolean; calls: boolean } {
  if (!text.includes('activeOrganisations')) return { names: false, calls: false };
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const imported = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (!/(?:^|\/)task-pools\.ts$/.test(st.moduleSpecifier.text)) continue;
    const named = st.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) {
        if ((el.propertyName ?? el.name).text === 'activeOrganisations') imported.add(el.name.text);
      }
    }
  }
  let names = false;
  let calls = false;
  const visit = (node: ts.Node) => {
    if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && node.text === 'activeOrganisations') names = true;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && imported.has(node.expression.text)) calls = true;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { names, calls };
}

/** An initialiser that runs nothing when the module is loaded. */
function inert(e: ts.Expression): boolean {
  const x = bare(e);
  if (
    ts.isStringLiteralLike(x) ||
    ts.isNumericLiteral(x) ||
    ts.isArrowFunction(x) ||
    ts.isFunctionExpression(x) ||
    x.kind === ts.SyntaxKind.TrueKeyword ||
    x.kind === ts.SyntaxKind.FalseKeyword ||
    x.kind === ts.SyntaxKind.NullKeyword
  ) {
    return true;
  }
  if (ts.isArrayLiteralExpression(x)) return x.elements.every((el) => ts.isExpression(el) && inert(el));
  if (ts.isObjectLiteralExpression(x)) {
    return x.properties.every((pr) => ts.isPropertyAssignment(pr) && inert(pr.initializer));
  }
  return false;
}

/**
 * What a module does when it is imported: every top-level statement that is
 * not an import, a declaration, or a constant whose value runs nothing.
 */
function importTimeEffects(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const effects: string[] = [];
  for (const st of sf.statements) {
    if (
      ts.isImportDeclaration(st) ||
      ts.isFunctionDeclaration(st) ||
      ts.isInterfaceDeclaration(st) ||
      ts.isTypeAliasDeclaration(st) ||
      (ts.isExportDeclaration(st) && st.moduleSpecifier === undefined)
    ) {
      continue;
    }
    if (ts.isVariableStatement(st) && st.declarationList.declarations.every((d) => !d.initializer || inert(d.initializer))) {
      continue;
    }
    effects.push(st.getText(sf).split('\n')[0]!.slice(0, 100));
  }
  return effects;
}

/** Where a node is, for a message: its line and its first line of text. */
function whereIs(sf: ts.SourceFile, node: ts.Node): string {
  return `line ${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}: ${node.getText(sf).split('\n')[0]!.slice(0, 90)}`;
}

/** A module specifier that names task-pools.ts. */
const NAMES_TASK_POOLS = (specifier: string): boolean => /(?:^|\/)task-pools(?:\.[cm]?[jt]s)?$/.test(specifier);

/**
 * What a file takes from the modules `names` picks out: each value it imports,
 * by the name the module exports it under, and each shape whose names are out
 * of sight (`import * as`, a default import, `export … from`, `import(…)`,
 * `require(…)`). A type-only import takes nothing; a bare `import '…'` takes
 * nothing either (rule 4: the module runs nothing when loaded).
 */
function valuesTakenFrom(file: string, text: string, names: (specifier: string) => boolean): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const taken = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && names(node.moduleSpecifier.text)) {
      const clause = node.importClause;
      if (clause && !clause.isTypeOnly) {
        if (clause.name) taken.add('a default import');
        const named = clause.namedBindings;
        if (named && ts.isNamespaceImport(named)) taken.add('import * as');
        if (named && ts.isNamedImports(named)) {
          for (const el of named.elements) if (!el.isTypeOnly) taken.add((el.propertyName ?? el.name).text);
        }
      }
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      names(node.moduleSpecifier.text) &&
      !node.isTypeOnly
    ) {
      const clause = node.exportClause;
      const typesOnly = clause !== undefined && ts.isNamedExports(clause) && clause.elements.every((el) => el.isTypeOnly);
      if (!typesOnly) taken.add('export … from');
    } else if (ts.isCallExpression(node)) {
      const first = node.arguments[0];
      const loads =
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require');
      if (loads && first !== undefined && ts.isStringLiteralLike(first) && names(first.text)) taken.add('import(…)');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...taken].sort();
}

/**
 * The CROSS_TENANT files other than task-pools.ts that a file names by a
 * relative specifier, for {@link valuesTakenFrom}.
 */
function namesAnotherCrossTenantFile(file: string): (specifier: string) => boolean {
  return (specifier) => {
    if (!specifier.startsWith('.')) return false;
    const resolved = join(dirname(file), specifier).replace(/\.js$/, '.ts');
    const withExtension = /\.[cm]?tsx?$/.test(resolved) ? resolved : `${resolved}.ts`;
    return withExtension !== TASK_POOLS && CROSS_TENANT[withExtension] !== undefined;
  };
}

/**
 * What a module exports as a value: each name, and each shape that hands out
 * names not written here (`export * from`, `export { … } from`, a default).
 * Interfaces and type aliases carry nothing at run time and are left out.
 */
function valueExports(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = new Set<string>();
  const exported = (node: ts.Node) =>
    ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const isDefault = (node: ts.Node) =>
    ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
  for (const st of sf.statements) {
    if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) continue;
    if (ts.isExportAssignment(st)) found.add(st.isExportEquals ? 'export =' : 'default');
    else if (ts.isExportDeclaration(st)) {
      if (st.isTypeOnly) continue;
      if (st.moduleSpecifier !== undefined) {
        found.add(`export … from ${st.moduleSpecifier.getText(sf)}`);
      } else if (st.exportClause && ts.isNamedExports(st.exportClause)) {
        for (const el of st.exportClause.elements) if (!el.isTypeOnly) found.add(el.name.text);
      }
    } else if (exported(st)) {
      if (isDefault(st)) found.add('default');
      else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name)) found.add(d.name.text);
          else found.add(`a destructured export, ${d.name.getText(sf)}`);
        }
      } else if (
        (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st) || ts.isModuleDeclaration(st)) &&
        st.name !== undefined
      ) {
        found.add(st.name.text);
      } else found.add(`an export, ${whereIs(sf, st)}`);
    }
  }
  return [...found].sort();
}

/** What a module imports as a value, as `<module>: <name>`, `<module>: * as`, `<module>: default` or `<module>: (loaded)`. */
function valueImports(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const from = node.moduleSpecifier.text;
      const clause = node.importClause;
      if (clause === undefined) found.add(`${from}: (loaded)`);
      else if (!clause.isTypeOnly) {
        if (clause.name) found.add(`${from}: default`);
        const named = clause.namedBindings;
        if (named && ts.isNamespaceImport(named)) found.add(`${from}: * as`);
        if (named && ts.isNamedImports(named)) {
          for (const el of named.elements) if (!el.isTypeOnly) found.add(`${from}: ${(el.propertyName ?? el.name).text}`);
        }
      }
    } else if (ts.isCallExpression(node)) {
      const first = node.arguments[0];
      const loads =
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require');
      if (loads) found.add(`${first !== undefined && ts.isStringLiteralLike(first) ? first.text : first?.getText(sf)}: import(…)`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...found].sort();
}

/** Whether a connection string's text reads `APP_DATABASE_URL` and no other database URL. */
const READS_THE_TENANT_URL = (text: string): boolean =>
  text.includes('APP_DATABASE_URL') && !text.replace(/APP_DATABASE_URL/g, '').includes('DATABASE_URL');

/**
 * How a module uses each pool it builds on the owner's URL (rule 7).
 *
 * A pool is the owner's unless its connection string is read from
 * `APP_DATABASE_URL`, followed through the `const` it is named by: every other
 * `new Pool`/`new Client`, whatever it is built from, counts, a pool with no
 * connection string among them. Each must be a `const`'s value, so it has a
 * name to follow; each other place that name is read must be
 * `.query(<one of THE_MODULES_STATEMENTS>, …)`, `.end()`, `.on(…)`, or the one
 * argument of `pgDriver(…)` that is itself the first argument of
 * `auditExportOn(…)`, the key's sink. Anything else (returned, handed to a
 * call, stored, spread, `.connect()`, another statement) is listed with its
 * line. Names are matched in the whole file, not per scope.
 */
function ownerPoolUses(file: string, text: string): { owners: string[]; outside: string[] } {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const pgNames = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || st.moduleSpecifier.text !== 'pg') continue;
    const named = st.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) if (['Pool', 'Client'].includes((el.propertyName ?? el.name).text)) pgNames.add(el.name.text);
    }
  }
  const isAPool = (callee: string) => /(?:^|\.)(?:Pool|Client)$/.test(callee) || pgNames.has(callee);

  // Every const's initialisers, by name: a name declared twice is the tenant's only if both are.
  const initialisers = new Map<string, ts.Expression[]>();
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      initialisers.set(node.name.text, [...(initialisers.get(node.name.text) ?? []), node.initializer]);
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);
  const onTheTenantsUrl = (built: ts.NewExpression): boolean => {
    const options = built.arguments?.[0];
    if (options === undefined || !ts.isObjectLiteralExpression(bare(options))) return false;
    const property = (bare(options) as ts.ObjectLiteralExpression).properties.find(
      (p) => p.name !== undefined && ts.isIdentifier(p.name) && p.name.text === 'connectionString',
    );
    if (property === undefined) return false;
    const value = ts.isPropertyAssignment(property)
      ? bare(property.initializer)
      : ts.isShorthandPropertyAssignment(property)
        ? property.name
        : undefined;
    if (value === undefined) return false;
    const texts =
      ts.isIdentifier(value) && initialisers.has(value.text)
        ? initialisers.get(value.text)!.map((e) => e.getText(sf))
        : [value.getText(sf)];
    return texts.every(READS_THE_TENANT_URL);
  };

  const owners = new Set<string>();
  const outside: string[] = [];
  const findOwners = (node: ts.Node) => {
    if (ts.isNewExpression(node) && isAPool(node.expression.getText(sf)) && !onTheTenantsUrl(node)) {
      let up: ts.Node = node;
      while (ts.isParenthesizedExpression(up.parent) || ts.isAsExpression(up.parent) || ts.isSatisfiesExpression(up.parent)) {
        up = up.parent;
      }
      const decl = up.parent;
      if (
        ts.isVariableDeclaration(decl) &&
        decl.initializer === up &&
        ts.isIdentifier(decl.name) &&
        ts.isVariableDeclarationList(decl.parent) &&
        (decl.parent.flags & ts.NodeFlags.Const) !== 0
      ) {
        owners.add(decl.name.text);
      } else {
        outside.push(`a pool on the owner's URL that no const names, ${whereIs(sf, node)}`);
      }
    }
    ts.forEachChild(node, findOwners);
  };
  findOwners(sf);

  const allowed = (id: ts.Identifier): boolean => {
    const p = id.parent;
    if (ts.isVariableDeclaration(p) && p.name === id) return true; // the pool's own const
    if (ts.isPropertyAccessExpression(p) && p.name === id) return true; // another object's property of that name
    if (ts.isPropertyAssignment(p) && p.name === id) return true;
    if (ts.isBindingElement(p) && p.propertyName === id) return true;
    if (ts.isPropertyAccessExpression(p) && p.expression === id) {
      const call = p.parent;
      if (!ts.isCallExpression(call) || call.expression !== p) return false;
      if (p.name.text === 'end' || p.name.text === 'on') return true;
      const first = call.arguments[0];
      return (
        p.name.text === 'query' &&
        first !== undefined &&
        ts.isIdentifier(first) &&
        (THE_MODULES_STATEMENTS as readonly string[]).includes(first.text)
      );
    }
    if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === 'pgDriver' && p.arguments.length === 1) {
      const sink = p.parent;
      return (
        ts.isCallExpression(sink) &&
        ts.isIdentifier(sink.expression) &&
        sink.expression.text === 'auditExportOn' &&
        sink.arguments[0] === p
      );
    }
    return false;
  };
  const uses = (node: ts.Node) => {
    if (ts.isIdentifier(node) && owners.has(node.text) && !allowed(node)) outside.push(whereIs(sf, node.parent));
    ts.forEachChild(node, uses);
  };
  uses(sf);
  return { owners: [...owners].sort(), outside };
}

/** The first argument of every `.query(…)` call in a file, as text. */
function queriesAsked(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const asked: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'query') {
      asked.push(node.arguments[0]?.getText(sf) ?? '(nothing)');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return asked;
}

/** The text a module-level const is a string literal of, or undefined when it is anything else. */
function literalOf(file: string, text: string, name: string): string | undefined {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || d.name.text !== name || d.initializer === undefined) continue;
      const value = bare(d.initializer);
      return ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value) ? value.text : undefined;
    }
  }
  return undefined;
}

/**
 * What `activeOrganisations` says it answers and what it returns: its declared
 * return type and each `return`'s expression, whitespace dropped, not counting
 * the returns of the functions inside it.
 */
function activeOrganisationsAnswers(file: string, text: string): { declared?: string; returns: string[] } {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const squeeze = (n: ts.Node) => n.getText(sf).replace(/\s+/g, '');
  const fn = sf.statements.find(
    (st): st is ts.FunctionDeclaration => ts.isFunctionDeclaration(st) && st.name?.text === 'activeOrganisations',
  );
  if (fn === undefined || fn.body === undefined) return { returns: [] };
  const returns: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node)) returns.push(node.expression ? squeeze(node.expression) : '(nothing)');
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(fn.body, visit);
  return { ...(fn.type ? { declared: squeeze(fn.type) } : {}), returns };
}

const files = sourceFiles();
const texts = new Map(files.map((f) => [f, readFileSync(join(REPO_ROOT, f), 'utf8')]));
const readers = new Map(
  files.map((f) => [f, databaseUrlReads(f, texts.get(f)!)] as const).filter(([, names]) => names.length > 0),
);

describe('who reads a database URL other than the application role', () => {
  it('found the tick, and reads the builders\' old fallback as a read, so the rest is not vacuous', () => {
    // If the parse or the walk stops matching, this goes red rather than every
    // case below passing over nothing.
    expect(files.length).toBeGreaterThan(100);
    expect(readers.get('apps/worker/src/jobs/managed-sync-tick.ts')).toEqual(['SYSTEM_DATABASE_URL']);
    expect(readers.get('apps/worker/src/cli/index.ts')).toEqual(['DATABASE_URL']);
    // The fallback the builders carried until T1 part 2, both halves a read.
    expect(
      databaseUrlReads('shape.ts', 'const u = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;'),
    ).toEqual(['DATABASE_URL', 'TEST_DATABASE_URL']);
    // And a read through the env a function is handed, the task-pools shape.
    expect(databaseUrlReads('shape.ts', 'function f(env: E) { return env.DATABASE_URL ?? env.APP_DATABASE_URL; }')).toEqual(
      ['DATABASE_URL'],
    );
    // And the builders read none now: they are handed their pool (T1 part 2).
    for (const builder of [
      'packages/orchestration/src/build-deps-from-mapping.ts',
      'packages/orchestration/src/build-deps.ts',
      'packages/orchestration/src/orchestration.ts',
    ]) {
      expect(texts.has(builder), builder).toBe(true);
      expect(readers.has(builder), `${builder} reads ${readers.get(builder)?.join(', ')}`).toBe(false);
    }
    // And a comment or a message is not a read: this file names DATABASE_URL
    // only in its header.
    expect(texts.get('apps/worker/src/jobs/stopping-a-pass.ts')).toContain('DATABASE_URL');
    expect(readers.has('apps/worker/src/jobs/stopping-a-pass.ts')).toBe(false);
  });

  it.each([...readers.keys()].map((f) => [f]))('%s is on CROSS_TENANT, with its reason', (file) => {
    expect(
      CROSS_TENANT[file],
      `${file} reads ${readers.get(file)!.join(', ')} from the environment.\n\n` +
        'On the managed stack that is the database owner, a superuser, whom row security\n' +
        'never binds. A per-tenant task takes its pools from openTaskPools (task-pools.ts),\n' +
        'which reads APP_DATABASE_URL (0138 T1). A job that asks a question spanning\n' +
        'organisations goes on CROSS_TENANT with the reason it must.',
    ).toBeDefined();
  });

  it.each(Object.keys(CROSS_TENANT).map((f) => [f]))('CROSS_TENANT names %s, which exists and reads one', (file) => {
    expect(texts.has(file), `${file} is on CROSS_TENANT and is not a source file here`).toBe(true);
    expect(readers.has(file), `${file} is on CROSS_TENANT and reads no database URL: delete the entry`).toBe(true);
  });

  it('no file but direct-url.ts names the functions that read the owner URL for their caller', () => {
    // direct-url.ts is on CROSS_TENANT because its callers are the API and the
    // seed. That is only true while no scanned file calls it: a task that did
    // would open the owner's pool without naming a variable.
    for (const [helper, home] of Object.entries(OWNER_URL_HELPERS)) {
      expect(helperNames(home, texts.get(home)!), `${home} no longer defines ${helper}`).toContain(helper);
    }
    for (const file of files) {
      const named = helperNames(file, texts.get(file)!).filter((h) => OWNER_URL_HELPERS[h] !== file);
      expect(
        named,
        `${file} names ${named.join(', ')}, which reads the database owner's URL from the environment it is passed.\n` +
          'A per-tenant task reads APP_DATABASE_URL (0138 T1). A job that must span organisations goes\n' +
          'on CROSS_TENANT with its reason, and its own entry in OWNER_URL_HELPERS.',
      ).toEqual([]);
    }
  });
});

describe("no task reads the owner's URL: the jobs across organisations read the system role's (rule 8)", () => {
  it('CROSS_TENANT is the system role\'s task files and the machine\'s, each once', () => {
    expect([...ON_THE_SYSTEM_ROLE, ...AT_THE_MACHINE].sort()).toEqual(Object.keys(CROSS_TENANT).sort());
    expect(new Set([...ON_THE_SYSTEM_ROLE, ...AT_THE_MACHINE]).size).toBe(ON_THE_SYSTEM_ROLE.length + AT_THE_MACHINE.length);
  });

  it.each(ON_THE_SYSTEM_ROLE.map((f) => [f]))('%s reads SYSTEM_DATABASE_URL, and no other database URL', (file) => {
    expect(
      readers.get(file) ?? [],
      `${file} reads ${readers.get(file)?.join(', ') ?? 'no database URL'}. A task that spans organisations\n` +
        `connects as the system role, ${SYSTEM_URL}, and nothing else: DATABASE_URL is the database owner,\n` +
        'a superuser on the managed stack, which set-task-env.sh no longer uploads and deletes from the store\n' +
        '(0138 T3 step 2). A fallback from one to the other is one DATABASE_URL in .env away from the owner.',
    ).toEqual([SYSTEM_URL]);
  });

  it.each(AT_THE_MACHINE.map((f) => [f]))('%s runs at the machine and reads no SYSTEM_DATABASE_URL', (file) => {
    expect(readers.has(file), `${file} reads no database URL: its entry is stale`).toBe(true);
    expect(readers.get(file)).not.toContain(SYSTEM_URL);
  });

  it('no file but the system role\'s task files reads SYSTEM_DATABASE_URL', () => {
    const reading = [...readers.entries()].filter(([f, names]) => names.includes(SYSTEM_URL) && !ON_THE_SYSTEM_ROLE.includes(f));
    expect(
      reading.map(([f]) => f),
      `${reading.map(([f]) => f).join(', ')} reads ${SYSTEM_URL}, the system role, which reads past row security\n` +
        'on every table it is granted. A per-tenant task or a split job reads APP_DATABASE_URL (0138 T1, T2).',
    ).toEqual([]);
  });

  it.each(Object.keys(AT_THE_MACHINE_EXPORTS).map((f) => [f]))('%s exports exactly what is listed for it, and nothing a task could reach the owner through', (file) => {
    expect(AT_THE_MACHINE).toContain(file);
    expect(
      valueExports(file, texts.get(file)!),
      `${file} runs at the machine and may read the database owner's URL. A value it exports is a way for a\n` +
        "task to reach the owner without naming it: review added `pooledConnectionString(env)` to direct-url.ts,\n" +
        'returning env.DATABASE_URL, imported it in a job through @openmig/ledger, and every guard stayed green.',
    ).toEqual([...AT_THE_MACHINE_EXPORTS[file]!]);
  });

  it.each(ON_THE_SYSTEM_ROLE.map((f) => [f]))('%s imports nothing from the files at the machine', (file) => {
    const machine = new Set(valueExports('packages/ledger/src/direct-url.ts', texts.get('packages/ledger/src/direct-url.ts')!));
    const taken = valueImports(file, texts.get(file)!).filter((entry) => {
      const [from, name] = entry.split(': ') as [string, string];
      return NAMES_A_MACHINE_FILE(from) || (from === '@openmig/ledger' && (machine.has(name) || name === '* as'));
    });
    expect(taken, `${file} runs in a task as the system role, and takes ${taken.join(', ')} from where the owner's URL is read`).toEqual([]);
  });

  it.each(ON_THE_SYSTEM_ROLE.map((f) => [f]))('%s reads the environment only by names it spells', (file) => {
    const unnamed = envReadsByNoName(file, texts.get(file)!);
    expect(
      unnamed,
      `${file} reads the environment by a name it does not spell: ${unnamed.join('; ')}.\n` +
        "A computed key is a read this guard cannot name: review read `process.env[`${p}DATABASE_URL`]` behind\n" +
        'the visible SYSTEM_DATABASE_URL, and every guard stayed green.',
    ).toEqual([]);
  });

  it('sees a read by no name, and an owner helper by another name, in each shape review found', () => {
    const shape = (code: string) => envReadsByNoName('shape.ts', code);
    expect(
      shape(
        "const u = process.env.SYSTEM_DATABASE_URL?.trim() || ['', 'DIRECT_'].map((p) => process.env[`${p}DATABASE_URL`]?.trim()).find(Boolean);",
      ),
    ).toHaveLength(1);
    expect(shape("const k = 'DATABASE_URL'; const u = process.env[k];")).toHaveLength(1);
    expect(shape('function f(env: E) { const n = pick(); return env[n]; }')).toHaveLength(1);
    expect(shape('const all = { ...process.env };')).toHaveLength(1);
    expect(shape('const v = Object.values(process.env).find((x) => x?.startsWith("postgres"));')).toHaveLength(1);
    expect(shape('const e = process.env; const u = e.DATABASE_URL;')).toHaveLength(1);
    expect(shape('open(process.env);')).toHaveLength(1);
    // By a name it spells, or a parameter's default: none.
    expect(shape("const a = process.env.SYSTEM_DATABASE_URL; const b = process.env['LOG_LEVEL']; const c = process.env[`MAX`];")).toEqual([]);
    expect(shape('export function f(env: E = process.env) { return env.SYSTEM_DATABASE_URL ?? env["X"]; }')).toEqual([]);
    // A new export beside the two helpers is an export this closes.
    expect(
      valueExports(
        'packages/ledger/src/direct-url.ts',
        `${texts.get('packages/ledger/src/direct-url.ts')!}\nexport function pooledConnectionString(env: { DATABASE_URL?: string }) { return env.DATABASE_URL?.trim() || undefined; }\n`,
      ),
    ).toEqual(['migrationConnectionString', 'pooledConnectionString', 'poolerInFront']);
    expect(NAMES_A_MACHINE_FILE('@openmig/ledger/direct-url')).toBe(true);
    expect(NAMES_A_MACHINE_FILE('../../packages/ledger/src/direct-url.ts')).toBe(true);
    expect(NAMES_A_MACHINE_FILE('../cli/index.ts')).toBe(true);
    expect(NAMES_A_MACHINE_FILE('./task-pools.ts')).toBe(false);
  });

  it("no scanned file that runs in a task reads the owner's names, DATABASE_URL or DIRECT_DATABASE_URL", () => {
    const owners = [...readers.entries()].filter(
      ([f, names]) => !AT_THE_MACHINE.includes(f) && names.some((n) => n === 'DATABASE_URL' || n === 'DIRECT_DATABASE_URL'),
    );
    expect(
      owners.map(([f, names]) => `${f}: ${names.join(', ')}`),
      "No task run holds the owner's URL since 0138 T3 step 2, and none may read it.",
    ).toEqual([]);
  });
});

describe('a per-tenant job builds no pool of its own', () => {
  const jobs = files.filter((f) => f.startsWith(`${JOBS_DIR}/`));

  it('found the jobs, and sees a pool built in each shape review found', () => {
    expect(jobs).toContain(`${JOBS_DIR}/run-delta-sync.ts`);
    expect(buildsAPool(`${JOBS_DIR}/managed-sync-tick.ts`, texts.get(`${JOBS_DIR}/managed-sync-tick.ts`)!)).toBe(
      true,
    );
    for (const shape of [
      "import { Pool as PgPool } from 'pg'; new PgPool({});",
      "import pg from 'pg'; const { Pool: P } = pg; new P();",
      "import { drizzle } from 'drizzle-orm/node-postgres'; drizzle(process.env.APP_DATABASE_URL!);",
      "import { drizzle as d } from 'drizzle-orm/node-postgres'; d({ connection: { connectionString: 'x' } });",
      "import { Client } from 'pg'; new Client({ connectionString: 'x' });",
      "import * as pg from 'pg'; new pg.Client();",
    ]) {
      expect(buildsAPool('shape.ts', shape), shape).toBe(true);
    }
    // And a job that is handed its pool builds none.
    expect(buildsAPool('shape.ts', "import { drizzle } from 'drizzle-orm/node-postgres'; drizzle(pool);")).toBe(false);
    expect(buildsAPool(`${JOBS_DIR}/cutover-gate.ts`, texts.get(`${JOBS_DIR}/cutover-gate.ts`)!)).toBe(false);
  });

  it.each(jobs.map((f) => [f]))('%s', (file) => {
    if (!buildsAPool(file, texts.get(file)!)) return;
    expect(
      CROSS_TENANT[file],
      `${file} builds a Pool itself. A per-tenant job takes its pools from openTaskPools\n` +
        '(task-pools.ts), the one module that builds a task pool, on APP_DATABASE_URL (0138 T1 part 1).',
    ).toBeDefined();
  });
});

describe('a per-tenant task takes its pools from the one module that builds them', () => {
  const taskFiles = files.filter((f) => f.startsWith(`${JOBS_DIR}/`) && definesATask(f, texts.get(f)!));

  it('found the fourteen task files, and knows each shape a task is registered in', () => {
    expect(taskFiles).toContain('apps/worker/src/jobs/run-delta-sync.ts');
    expect(taskFiles).toContain('apps/worker/src/jobs/managed-sync-tick.ts');
    expect(taskFiles.length).toBeGreaterThanOrEqual(14);
    expect(definesATask('shape.ts', "export const t = schemaTask({ id: 'x' });")).toBe(true);
    expect(definesATask('shape.ts', "export const t = schedules.task({ id: 'x' });")).toBe(true);
    expect(definesATask('shape.ts', "export const t = task({ id: 'x' });")).toBe(true);
    expect(definesATask('shape.ts', '// schemaTask({ id }) in a comment')).toBe(false);
  });

  it.each(taskFiles.map((f) => [f]))('%s is one of the three kinds', (file) => {
    // A new task is one that asks about one organisation, and goes on
    // PER_TENANT to take its pools from openTaskPools; one that asks which
    // organisations there are and then about each alone, and goes on SPLIT
    // with both halves said; or one that spans them, and goes on CROSS_TENANT
    // with its reason.
    const kinds = [PER_TENANT.includes(file), SPLIT[file] !== undefined, CROSS_TENANT[file] !== undefined];
    expect(
      kinds.filter(Boolean).length,
      `${file} registers a task and is on ${kinds.some(Boolean) ? 'more than one' : 'none'} of PER_TENANT, SPLIT and CROSS_TENANT.`,
    ).toBe(1);
  });

  it.each([...PER_TENANT, ...Object.keys(SPLIT), STANDALONE_WORKER].map((f) => [f]))('%s opens its pools with openTaskPools and points no sink itself', (file) => {
    expect(texts.has(file), `${file} is not a source file here`).toBe(true);
    const wiring = poolWiring(file, texts.get(file)!);
    expect(
      wiring.opensTaskPools,
      `${file} does not call openTaskPools from task-pools.ts. A per-tenant task's pool is\n` +
        "app_user's, built from APP_DATABASE_URL in that one module (0138 T1 part 1).",
    ).toBe(true);
    expect(
      wiring.setsSinks,
      `${file} points ${wiring.setsSinks.join(' and ')} itself. openTaskPools points both: the audit export\n` +
        "at the key's own pool, since app_user may not read deployment_key (ledger 0062), and a second\n" +
        'setter after it would put the lines back on the tenant pool, where every one is lost (0138 T1 part 5).',
    ).toEqual([]);
  });

  it('sees a job that calls openTaskPools, one that does not, and one that points a sink itself', () => {
    const imp = "import { openTaskPools } from './task-pools.ts';";
    expect(poolWiring('shape.ts', `${imp} const pools = openTaskPools();`)).toEqual({
      opensTaskPools: true,
      setsSinks: [],
    });
    expect(poolWiring('shape.ts', `${imp} const pool = new Pool({ connectionString: url });`).opensTaskPools).toBe(
      false,
    );
    expect(poolWiring('shape.ts', "import { openTaskPools as o } from '../jobs/task-pools.ts'; o();").opensTaskPools).toBe(
      true,
    );
    expect(
      poolWiring('shape.ts', `${imp} openTaskPools(); setAuditExportSink(auditExportOn(pgDriver(pools.tenant), {}));`)
        .setsSinks,
    ).toEqual(['setAuditExportSink']);
  });

  it.each([...PER_TENANT, ...Object.keys(SPLIT), STANDALONE_WORKER].map((f) => [f]))(
    '%s takes the tenant pool from openTaskPools, and ends nothing, on any name, but in afterwards',
    (file) => {
      const taken = takenFromTaskPools(file, texts.get(file)!);
      expect(taken, `${file} takes nothing from openTaskPools: the case above should have said so`).not.toEqual([]);
      expect(
        taken.filter((t) => !MAY_TAKE.includes(t)),
        `${file} takes ${taken.join(', ')} from what openTaskPools hands back. A per-tenant task reads and\n` +
          "writes on the tenant pool, app_user's, and nothing else: the key's pool is the owner, whom row\n" +
          'security never binds (0138 T1 step 2). And whatever it ends, under whatever name (pools.end,\n' +
          'or pool.end on const pool = pools.tenant), it ends in a function handed to afterwards(…), which\n' +
          "leavesAReference runs once the run's failure is on the operator's log page, on that same pool.\n" +
          "Every end counts, whatever object it is on: an end that is not a pool's (a stream's, a range's)\n" +
          'trips this too, so give it another name or move it out of the job file.',
      ).toEqual([]);
    },
  );

  it('no file but task-pools.ts names the key\'s pool', () => {
    expect(namesTheKeyPool(TASK_POOLS, texts.get(TASK_POOLS)!), `${TASK_POOLS} no longer names auditKey`).toBe(true);
    const naming = files.filter((f) => f !== TASK_POOLS && namesTheKeyPool(f, texts.get(f)!));
    expect(
      naming,
      `${naming.join(', ')} names auditKey, the owner's pool of one for deployment_key, which only\n` +
        'task-pools.ts may hold: on it row security never binds (0138 T1 step 2).',
    ).toEqual([]);
  });

  it('sees what a file takes from openTaskPools, in each shape review found', () => {
    const imp = "import { openTaskPools } from './task-pools.ts';";
    const takes = (code: string) => takenFromTaskPools('shape.ts', `${imp}\n${code}`);
    // The three one-token changes review made, each green on every guard then.
    expect(takes('const { auditKey: pool } = openTaskPools();')).toEqual(['auditKey']);
    expect(takes('const pool = openTaskPools().auditKey;')).toEqual(['auditKey']);
    expect(takes('const pools = openTaskPools(); const pool = pools.auditKey;')).toEqual(['auditKey']);
    // The shapes the jobs use.
    expect(takes('const { tenant: pool } = openTaskPools();')).toEqual(['tenant']);
    expect(takes('const pools = openTaskPools(); const pool = pools.tenant; afterwards(() => pools.end());')).toEqual(
      ['end', 'tenant'],
    );
    // The end in the run's own finally, before the failure is recorded.
    expect(takes('const pools = openTaskPools(); try { run(pools.tenant); } finally { await pools.end(); }')).toEqual([
      'end, outside afterwards',
      'tenant',
    ]);
    // The same pool ended under the name the job gave it, with the end in
    // afterwards kept: the re-review's change to run-cutover, green on every
    // guard then, and the shape the jobs on main ended their one pool in.
    expect(
      takes(
        'const pools = openTaskPools(); afterwards(() => pools.end()); const pool = pools.tenant;\n' +
          'try { return await run(pool); } finally { await pool.end(); }',
      ),
    ).toEqual(['end', 'end, outside afterwards', 'tenant']);
    expect(takes('const { tenant: pool } = openTaskPools(); try { run(pool); } finally { await pool.end(); }')).toEqual([
      'end, outside afterwards',
      'tenant',
    ]);
    expect(takes('const pools = openTaskPools(); const { tenant: pool } = pools; await pool.end();')).toEqual([
      'end, outside afterwards',
      'tenant',
    ]);
    expect(takes('const pools = openTaskPools(); await pools.tenant.end();')).toEqual(['end, outside afterwards', 'tenant']);
    // Under a second name, by its key, taken out of it, or in a helper of the file's own.
    expect(takes("const p = openTaskPools().tenant; const q = p; await q['end']();")).toEqual([
      'end, outside afterwards',
      'tenant',
    ]);
    expect(takes('const { tenant } = openTaskPools(); const { end: close } = tenant; await close();')).toEqual([
      'end, outside afterwards',
      'tenant',
    ]);
    expect(takes('const { tenant: pool } = openTaskPools(); const close = (p: Pool) => p.end(); await close(pool);')).toEqual([
      'end, outside afterwards',
      'tenant',
    ]);
    // An end in afterwards's own arguments runs at once, not afterwards.
    expect(takes('const pools = openTaskPools(); afterwards(pools.end());')).toEqual(['end, outside afterwards']);
    // And the ends that do wait: in a function handed to afterwards, or the end itself handed to it.
    expect(takes('const pools = openTaskPools(); afterwards(pools.end);')).toEqual(['end']);
    expect(takes('const { tenant: pool } = openTaskPools(); afterwards(async () => { await pool.end(); });')).toEqual([
      'end',
      'tenant',
    ]);
    expect(takes('const { tenant: pool } = openTaskPools(); // finally { await pool.end(); }')).toEqual(['tenant']);
    // The lot handed on, or taken apart later.
    expect(takes('const pools = openTaskPools(); helper(pools);')).toEqual(['the whole']);
    expect(takes('const { ...rest } = openTaskPools();')).toEqual(['the whole']);
    expect(takes('const pools = openTaskPools(); const { auditKey } = pools;')).toEqual(['auditKey']);
    expect(takes('helper(openTaskPools());')).toEqual(['the whole']);
    // And a comment that names the key's pool names nothing.
    expect(namesTheKeyPool('shape.ts', '// the auditKey pool')).toBe(false);
    expect(namesTheKeyPool('shape.ts', 'const p = pools.auditKey;')).toBe(true);
  });

  it('task-pools.ts is on CROSS_TENANT for the key and the list alone, and does nothing when it is imported', () => {
    expect(texts.has(TASK_POOLS), `${TASK_POOLS} is not a source file here`).toBe(true);
    expect(CROSS_TENANT[TASK_POOLS]).toMatch(/audit key/);
    expect(CROSS_TENANT[TASK_POOLS]).toMatch(/list of organisations the SPLIT jobs visit/);
    // A job imports it at its top, and a test imports the job's helpers from
    // the job: a pool built or a sink set here at import would be one nobody
    // asked for, on whatever URL the environment happened to hold.
    expect(importTimeEffects(TASK_POOLS, texts.get(TASK_POOLS)!)).toEqual([]);
  });

  it('sees what a module does at import', () => {
    expect(importTimeEffects('shape.ts', "import { Pool } from 'pg';\nexport function f() { return new Pool(); }")).toEqual(
      [],
    );
    expect(importTimeEffects('shape.ts', "const KEY_POOL_SIZE = 1;\nconst NAMES = ['a', 'b'];")).toEqual([]);
    expect(importTimeEffects('shape.ts', "import { Pool } from 'pg';\nconst pool = new Pool();")).toHaveLength(1);
    expect(importTimeEffects('shape.ts', 'setAppEventSink(undefined);')).toHaveLength(1);
    expect(importTimeEffects('shape.ts', 'export const pools = openTaskPools();')).toHaveLength(1);
    expect(importTimeEffects('shape.ts', "if (!process.env.APP_DATABASE_URL) throw new Error('x');")).toHaveLength(1);
  });
});

describe('a split job asks across organisations for the list alone, and reads each one in its own scope', () => {
  const splitFiles = Object.keys(SPLIT);
  const taskFiles = files.filter((f) => f.startsWith(`${JOBS_DIR}/`) && definesATask(f, texts.get(f)!));

  it('found the three, each a task file, and each entry says both halves', () => {
    expect(splitFiles.sort()).toEqual([
      'apps/worker/src/jobs/managed-digest.ts',
      'apps/worker/src/jobs/managed-drift-detect.ts',
      'apps/worker/src/jobs/managed-group-discovery.ts',
    ]);
    for (const file of splitFiles) {
      expect(texts.has(file), `${file} is on SPLIT and is not a source file here`).toBe(true);
      expect(taskFiles, `${file} is on SPLIT and registers no task`).toContain(file);
    }
  });

  it.each(Object.entries(SPLIT))('%s states why it crosses organisations and what it reads per organisation', (_file, reason) => {
    // Closed, and each entry says both halves: a job put here without them is
    // one nobody decided the line for.
    expect(reason).toMatch(/^which organisations are active, to /);
    expect(reason).toMatch(/Per organisation, in its own scope: /);
    expect(reason).toMatch(/\(0138 T2\)$/);
  });

  it.each(splitFiles.map((f) => [f]))('%s reads no database URL and builds no pool of its own', (file) => {
    // Rules 1 and 2 say so too; said here in the category's own words. No URL
    // and no pool of its own is half of it: the other half is what task-pools.ts
    // may hand it, which the cases under rule 7 below close.
    expect(
      readers.get(file) ?? [],
      `${file} reads ${readers.get(file)?.join(', ')} from the environment. A split job asks its one question\n` +
        'across organisations through activeOrganisations (task-pools.ts), which hands back the ids and\n' +
        'nothing else, and reads everything about one organisation on the tenant pool, in its scope (0138 T2).',
    ).toEqual([]);
    expect(buildsAPool(file, texts.get(file)!), `${file} builds a pool of its own`).toBe(false);
  });

  it.each(splitFiles.map((f) => [f]))('%s takes its list from activeOrganisations', (file) => {
    expect(
      activeOrganisationsUse(file, texts.get(file)!).calls,
      `${file} does not call activeOrganisations from task-pools.ts: the one question a split job\n` +
        'asks across organisations, on the one connection that may (0138 T2).',
    ).toBe(true);
  });

  it.each(splitFiles.map((f) => [f]))('%s names its tenant pool only to open an organisation\'s scope on it', (file) => {
    const { scoped, outside } = tenantPoolOutsideAScope(file, texts.get(file)!);
    expect(
      outside,
      `${file} names its tenant pool outside withTenant and tenantScopedDb:\n  ${outside.join('\n  ')}\n\n` +
        "The pool is app_user's. A statement on it with no organisation set finds nothing, and the job\n" +
        'reports nothing to do; or, on a plain-form table after a scope, it fails (docs/rls-guide.md,\n' +
        '"Policies"). Every read and write for one organisation runs in that organisation\'s scope (0138 T2).',
    ).toEqual([]);
    // And it does open scopes on it, so the rule is not passing over nothing.
    expect(scoped, `${file} opens no scope on its tenant pool`).toBeGreaterThanOrEqual(2);
  });

  it('no file but the three and task-pools.ts names activeOrganisations', () => {
    // A per-tenant job that could list every organisation would ask across
    // them with nothing on SPLIT saying so.
    expect(activeOrganisationsUse(TASK_POOLS, texts.get(TASK_POOLS)!).names, `${TASK_POOLS} no longer defines it`).toBe(true);
    const naming = files.filter(
      (f) => f !== TASK_POOLS && SPLIT[f] === undefined && activeOrganisationsUse(f, texts.get(f)!).names,
    );
    expect(naming, `${naming.join(', ')} names activeOrganisations and is not on SPLIT`).toEqual([]);
  });

  it("the module's one statement across organisations is the list: the active ones' ids, from tenant alone", () => {
    const statements = sqlStatements(TASK_POOLS, texts.get(TASK_POOLS)!);
    expect(
      statements.filter((s) => THE_LIST.test(s)),
      `${TASK_POOLS} has no list, or more than one:\n  ${statements.join('\n  ')}`,
    ).toHaveLength(1);
    expect(
      statements.filter((s) => !THE_LIST.test(s) && !THE_ROLE_QUESTION.test(s)),
      `${TASK_POOLS} sends a statement on the owner's connection that is neither the list nor the question\n` +
        'whether that connection sees every organisation. Across organisations a split job learns which\n' +
        "ones are active, and nothing else: each one's rows are read in its own scope, on app_user (0138 T2).",
    ).toEqual([]);
  });

  it('sees a tenant pool used outside a scope, in each shape, and a list that reads more than ids', () => {
    const imp =
      "import { openTaskPools, activeOrganisations } from './task-pools.ts';\n" +
      "import { withTenant, tenantScopedDb } from '@openmig/ledger';\n";
    const judge = (code: string) => tenantPoolOutsideAScope('shape.ts', `${imp}${code}`);
    // In a scope: none outside.
    expect(judge('const pools = openTaskPools(); await withTenant(pools.tenant, id, f);')).toEqual({ scoped: 1, outside: [] });
    expect(judge('const { tenant: pool } = openTaskPools(); new PgLedger(tenantScopedDb(pool, id));')).toEqual({
      scoped: 1,
      outside: [],
    });
    // Handed to a function of the file's own that takes a Pool, and read there.
    expect(
      judge(
        'function reads(pool: Pool, id: string) { return withTenant(pool, id, f); }\n' +
          'const pools = openTaskPools(); await reads(pools.tenant, id);',
      ),
    ).toEqual({ scoped: 1, outside: [] });
    // Outside one, each a statement with no organisation set.
    const outside = (code: string) => judge(code).outside.length;
    expect(outside('const pools = openTaskPools(); const pool = pools.tenant; await pool.query(SQL, [id]);')).toBe(1);
    expect(outside('const pools = openTaskPools(); await pools.tenant.query(SQL, [id]);')).toBe(1);
    expect(outside('const pool = openTaskPools().tenant; new PgDecisionStore(drizzle(pool));')).toBe(1);
    expect(outside('const { tenant } = openTaskPools(); new PgLedger(plainDb(tenant));')).toBe(1);
    expect(outside('const { tenant: pool } = openTaskPools(); setSink(pgDriver(pool));')).toBe(1);
    expect(outside('const { tenant: pool } = openTaskPools(); const other = pool; await other.query(SQL);')).toBe(1);
    expect(outside('const { tenant: pool } = openTaskPools(); elsewhere({ pool });')).toBe(1);
    expect(outside('const { tenant: pool } = openTaskPools(); await withTenant(owner, id, f); await elsewhere(pool);')).toBe(1);
    // A Pool parameter is the tenant pool, whatever it is called.
    expect(outside('export async function reads(p: Pool, id: string) { return (await p.query(SQL, [id])).rows; }')).toBe(1);
    // Handed to a function of the file's own whose parameter is not a Pool.
    expect(outside('function reads(p: unknown) { return p; }\nconst pools = openTaskPools(); reads(pools.tenant);')).toBe(1);
    // And a scope opened on something else is not one opened on it.
    expect(outside('const { tenant: pool } = openTaskPools(); await withTenant(id, pool, f);')).toBe(1);

    // The list, and the statements that are not it.
    expect(THE_LIST.test("SELECT id FROM tenant WHERE status = 'active' ORDER BY id")).toBe(true);
    expect(THE_LIST.test("SELECT id, name, settings FROM tenant WHERE status = 'active'")).toBe(false);
    expect(
      THE_LIST.test(
        "SELECT c.id, c.tenant_id, c.kind, c.config FROM connection c JOIN tenant t ON t.id = c.tenant_id WHERE t.status = 'active'",
      ),
    ).toBe(false);
    expect(THE_ROLE_QUESTION.test('SELECT rolsuper OR rolbypassrls AS sees FROM pg_roles WHERE rolname = current_user')).toBe(
      true,
    );
    expect(sqlStatements('shape.ts', "const A = `SELECT id FROM tenant`; // SELECT in a comment\nconst m = 'select nothing';")).toEqual([
      'SELECT id FROM tenant',
      'select nothing',
    ]);
    // And the list's caller, seen as one.
    expect(activeOrganisationsUse('shape.ts', `${imp}const ids = await activeOrganisations();`)).toEqual({ names: true, calls: true });
    expect(activeOrganisationsUse('shape.ts', '// activeOrganisations in a comment')).toEqual({ names: false, calls: false });
  });
});

describe("what reaches a job from the owner's connection is ids, closed at both ends", () => {
  const moduleText = () => texts.get(TASK_POOLS)!;

  it('task-pools.ts exports openTaskPools, activeOrganisations and the list\'s text, and types, and nothing else', () => {
    expect(texts.has(TASK_POOLS), `${TASK_POOLS} is not a source file here`).toBe(true);
    const exported = valueExports(TASK_POOLS, moduleText());
    expect(
      exported.filter((name) => TASK_POOLS_EXPORTS[name] === undefined),
      `${TASK_POOLS} exports ${exported.join(', ')}. It holds the owner's URL, and what it exports is what\n` +
        "the owner's side hands a job: the tenant pool (openTaskPools), the ids of the active\n" +
        "organisations (activeOrganisations) and the list's text. One more export that handed its caller the\n" +
        "owner's pool (acrossOrganisations(work), 0138 T2's review) put a split job and a per-tenant job\n" +
        'on it, reading every organisation, with every guard green. A value added goes on TASK_POOLS_EXPORTS\n' +
        'with what it hands out.',
    ).toEqual([]);
    // And each listed one is still there, so the list is not wider than the module.
    expect(exported).toEqual(Object.keys(TASK_POOLS_EXPORTS).sort());
  });

  it('task-pools.ts imports no query builder and no schema: only what TASK_POOLS_IMPORTS says', () => {
    const imported = valueImports(TASK_POOLS, moduleText());
    expect(
      imported.filter((name) => TASK_POOLS_IMPORTS[name] === undefined),
      `${TASK_POOLS} imports ${imported.join(', ')}. A statement built with a query builder has no text for\n` +
        "the rule on the module's statements to read: review built a second list with drizzle,\n" +
        'drizzle(list).select({ id, name, settings }).from(tenant), and every guard stayed green (0138 T2).\n' +
        'An import added goes on TASK_POOLS_IMPORTS with what the module needs it for.',
    ).toEqual([]);
    expect(imported).toEqual(Object.keys(TASK_POOLS_IMPORTS).sort());
  });

  it("every pool task-pools.ts builds on the owner's URL is asked its two statements, ended and heard, and goes nowhere", () => {
    const { owners, outside } = ownerPoolUses(TASK_POOLS, moduleText());
    expect(
      outside,
      `${TASK_POOLS} hands out a pool it built on the owner's URL, or asks it something else:\n  ${outside.join('\n  ')}\n\n` +
        "The owner is a superuser on the managed stack, whom row security never binds. The key's pool\n" +
        "goes to the audit sink (pgDriver inside auditExportOn) and nowhere else; the list's is asked\n" +
        'ACTIVE_ORGANISATIONS_SQL and SEES_EVERY_ORGANISATION_SQL and ended. Returned, handed to a call\n' +
        "(work(list), drizzle(list)), stored or connected to, it is the owner's connection in a job's\n" +
        "hands (0138 T2's review).",
    ).toEqual([]);
    // Found the two it builds, so the rule is not passing over nothing.
    expect(owners).toEqual(['auditKey', 'list']);
  });

  it('every statement task-pools.ts asks is the list or the role question, by name, each the literal it is held to', () => {
    const asked = queriesAsked(TASK_POOLS, moduleText());
    expect(
      asked.filter((a) => !(THE_MODULES_STATEMENTS as readonly string[]).includes(a)),
      `${TASK_POOLS} asks ${asked.join(', ')}. It asks two things on the owner's connection, by name:\n` +
        'whether that connection sees every organisation, and which organisations are active (0138 T2).',
    ).toEqual([]);
    expect([...new Set(asked)].sort()).toEqual([...THE_MODULES_STATEMENTS].sort());
    const list = literalOf(TASK_POOLS, moduleText(), 'ACTIVE_ORGANISATIONS_SQL');
    const question = literalOf(TASK_POOLS, moduleText(), 'SEES_EVERY_ORGANISATION_SQL');
    expect(list !== undefined && THE_LIST.test(list), `ACTIVE_ORGANISATIONS_SQL is not the list: ${list}`).toBe(true);
    expect(
      question !== undefined && THE_ROLE_QUESTION.test(question),
      `SEES_EVERY_ORGANISATION_SQL is not the role question: ${question}`,
    ).toBe(true);
  });

  it('activeOrganisations says it answers ids, and answers the ids of the rows and nothing else', () => {
    const answers = activeOrganisationsAnswers(TASK_POOLS, moduleText());
    expect(
      answers,
      `${TASK_POOLS}'s activeOrganisations is declared ${answers.declared} and returns ${answers.returns.join(', ')}.\n` +
        "It answers the ids of the active organisations and nothing else: rows or a handle handed back\n" +
        "would carry what the owner's connection read to a split job (0138 T2).",
    ).toEqual({ declared: 'Promise<string[]>', returns: ['rows.map((row)=>row.id)'] });
  });

  // The files that name the module at all: parsing every file would put this over the unit budget.
  const naming = files.filter((f) => f !== TASK_POOLS && texts.get(f)!.includes('task-pools'));

  it('found every file that opens the pools among those that name the module', () => {
    expect(naming).toEqual(expect.arrayContaining([...PER_TENANT, ...Object.keys(SPLIT), STANDALONE_WORKER]));
  });

  it.each(naming.map((f) => [f]))('%s takes from task-pools.ts only what its kind may', (file) => {
    const text = texts.get(file)!;
    const taken = valuesTakenFrom(file, text, NAMES_TASK_POOLS);
    const may = mayTakeFromTaskPools(file);
    expect(
      taken.filter((name) => !may.includes(name)),
      `${file} takes ${taken.join(', ')} from task-pools.ts, and may take ${may.join(' and ') || 'nothing'}.\n` +
        'A per-tenant job and the standalone worker take openTaskPools; a split job that and\n' +
        'activeOrganisations; any other file nothing (types are free). The whole module, a re-export or\n' +
        "an import(…) takes names out of this guard's sight (0138 T2's review).",
    ).toEqual([]);
  });

  it.each([...PER_TENANT, ...Object.keys(SPLIT), STANDALONE_WORKER].map((f) => [f]))(
    '%s imports no value from another file on CROSS_TENANT',
    (file) => {
      const taken = valuesTakenFrom(file, texts.get(file)!, namesAnotherCrossTenantFile(file));
      expect(
        taken,
        `${file} takes ${taken.join(', ')} from a file on CROSS_TENANT, which reads the owner's URL.\n` +
          "What a job gets of the owner's side comes through task-pools.ts, and is ids (0138 T2's review).",
      ).toEqual([]);
    },
  );

  it('sees each shape review found, and each way around them', () => {
    // What a file takes from the module.
    const takes = (code: string) => valuesTakenFrom('apps/worker/src/jobs/shape.ts', code, NAMES_TASK_POOLS);
    expect(takes("import { openTaskPools, type TaskPools } from './task-pools.ts';")).toEqual(['openTaskPools']);
    expect(takes("import type { TaskPools } from './task-pools.ts';")).toEqual([]);
    expect(takes("import { acrossOrganisations as across, openTaskPools } from '../jobs/task-pools';")).toEqual([
      'acrossOrganisations',
      'openTaskPools',
    ]);
    expect(takes("import * as pools from './task-pools.ts';")).toEqual(['import * as']);
    expect(takes("export { activeOrganisations } from './task-pools.ts';")).toEqual(['export … from']);
    expect(takes("export * from './task-pools.ts';")).toEqual(['export … from']);
    expect(takes("export type { TaskPools } from './task-pools.ts';")).toEqual([]);
    expect(takes("const m = await import('./task-pools.ts');")).toEqual(['import(…)']);
    expect(takes("import { openTaskPools } from './task-pools-of-another-kind.ts';")).toEqual([]);
    expect(mayTakeFromTaskPools('apps/worker/src/jobs/run-discovery.ts')).toEqual(['openTaskPools']);
    expect(mayTakeFromTaskPools('apps/worker/src/jobs/managed-digest.ts')).toEqual(['activeOrganisations', 'openTaskPools']);
    expect(mayTakeFromTaskPools('apps/worker/src/jobs/managed-sync-tick.ts')).toEqual([]);
    // Another CROSS_TENANT file, by a relative path.
    const fromTheTick = (code: string) =>
      valuesTakenFrom('apps/worker/src/jobs/run-cutover.ts', code, namesAnotherCrossTenantFile('apps/worker/src/jobs/run-cutover.ts'));
    expect(fromTheTick("import { ACTIVE_MAPPINGS_SQL } from './managed-sync-tick.ts';")).toEqual(['ACTIVE_MAPPINGS_SQL']);
    expect(fromTheTick("import { openTaskPools } from './task-pools.ts';")).toEqual([]);
    expect(fromTheTick("import { leavesAReference } from './what-a-run-leaves.ts';")).toEqual([]);

    // What the module exports and imports.
    expect(
      valueExports(
        'shape.ts',
        'export async function acrossOrganisations<T>(work: (p: Pool) => Promise<T>) { return work(p); }\n' +
          "export const A = 'x'; const b = 1; export { b as c }; export type T = 1; export interface I { x: 1 }",
      ),
    ).toEqual(['A', 'acrossOrganisations', 'c']);
    expect(valueExports('shape.ts', "export * from './a.ts';\nexport default function f() {}")).toEqual([
      'default',
      "export … from './a.ts'",
    ]);
    expect(
      valueImports(
        'shape.ts',
        "import { eq } from 'drizzle-orm';\nimport { drizzle } from 'drizzle-orm/node-postgres';\n" +
          "import { tenant } from '@openmig/ledger/schema-pg';\nimport type { PgDatabase } from '@openmig/ledger';\n" +
          "import * as ledger from '@openmig/ledger';\nimport { Pool } from 'pg';",
      ),
    ).toEqual([
      '@openmig/ledger/schema-pg: tenant',
      '@openmig/ledger: * as',
      'drizzle-orm/node-postgres: drizzle',
      'drizzle-orm: eq',
      'pg: Pool',
    ]);

    // What the module does with a pool on the owner's URL.
    const head =
      "import { Pool } from 'pg';\n" +
      "const ACTIVE_ORGANISATIONS_SQL = \"SELECT id FROM tenant WHERE status = 'active'\";\n" +
      "const SEES_EVERY_ORGANISATION_SQL = 'SELECT rolsuper OR rolbypassrls AS s FROM pg_roles WHERE rolname = current_user';\n";
    const owned = (body: string) => ownerPoolUses('shape.ts', `${head}${body}`);
    const ownersList =
      'export async function activeOrganisations(env: E): Promise<string[]> {\n' +
      '  const ownerUrl = env.DATABASE_URL?.trim();\n' +
      '  const list = new Pool({ connectionString: ownerUrl, max: 1 });\n' +
      "  list.on('error', () => {});\n" +
      '  try {\n' +
      '    await list.query(SEES_EVERY_ORGANISATION_SQL);\n' +
      '    const { rows } = await list.query(ACTIVE_ORGANISATIONS_SQL);\n' +
      '    return rows.map((row) => row.id);\n' +
      '  } finally { await list.end(); }\n' +
      '}\n';
    expect(owned(ownersList)).toEqual({ owners: ['list'], outside: [] });
    // The review's: the pool handed to a callback, returned, handed to drizzle,
    // stored, connected to, asked another statement; and one no const names.
    const across = ownersList.replace('return rows.map((row) => row.id);', 'return await work(list);');
    expect(owned(across).outside).toHaveLength(1);
    expect(owned(ownersList.replace('return rows.map((row) => row.id);', 'return list;')).outside).toHaveLength(1);
    expect(owned(ownersList.replace('return rows.map((row) => row.id);', 'return drizzle(list).select().from(tenant);')).outside).toHaveLength(1);
    expect(owned(ownersList.replace('return rows.map((row) => row.id);', 'held.pool = list; return [];')).outside).toHaveLength(1);
    expect(owned(ownersList.replace('return rows.map((row) => row.id);', 'return { owner: list };')).outside).toHaveLength(1);
    expect(owned(ownersList.replace('return rows.map((row) => row.id);', 'return { list };')).outside).toHaveLength(1);
    expect(owned(ownersList.replace('return rows.map((row) => row.id);', 'const c = await list.connect(); return [];')).outside).toHaveLength(1);
    expect(
      owned(ownersList.replace('return rows.map((row) => row.id);', "return (await list.query('SELECT id, name FROM tenant')).rows;"))
        .outside,
    ).toHaveLength(1);
    expect(owned('export function f(env: E) { return new Pool({ connectionString: env.DATABASE_URL }); }').outside).toHaveLength(1);
    // A pool with no connection string, or one read through something unseen, is the owner's.
    expect(owned('export function f() { const p = new Pool(); return p; }')).toEqual({
      owners: ['p'],
      outside: [expect.stringContaining('return p')],
    });
    // The key's pool goes to its sink and nowhere else; the tenant pool may be handed back.
    const keyAndTenant =
      'export function open(env: E) {\n' +
      '  const appUrl = env.APP_DATABASE_URL?.trim();\n' +
      '  const ownerUrl = env.DATABASE_URL?.trim();\n' +
      '  const tenant = new Pool({ connectionString: appUrl });\n' +
      '  const auditKey = new Pool({ connectionString: ownerUrl, max: 1 });\n' +
      "  auditKey.on('error', () => {});\n" +
      '  setAppEventSink(appEventSinkOn(pgDriver(tenant)));\n' +
      '  setAuditExportSink(auditExportOn(pgDriver(auditKey), {}));\n' +
      '  return { tenant, end: () => tenant.end() };\n' +
      '}\n';
    expect(owned(keyAndTenant)).toEqual({ owners: ['auditKey'], outside: [] });
    expect(owned(keyAndTenant.replace('pgDriver(tenant)', 'pgDriver(auditKey)')).outside).toHaveLength(1);
    expect(owned(keyAndTenant.replace('return { tenant,', 'return { tenant, auditKey,')).outside).toHaveLength(1);
    // The tenant pool built on the owner's URL is an owner's pool, and handing it back is refused.
    expect(owned(keyAndTenant.replace('connectionString: appUrl', 'connectionString: ownerUrl')).outside.length).toBeGreaterThan(0);

    // What the module asks, and what activeOrganisations answers.
    expect(queriesAsked('shape.ts', `${head}${ownersList}`)).toEqual(['SEES_EVERY_ORGANISATION_SQL', 'ACTIVE_ORGANISATIONS_SQL']);
    expect(queriesAsked('shape.ts', "await owner.query<DigestTenant>(\"SELECT id, name, settings FROM tenant\");")).toEqual([
      '"SELECT id, name, settings FROM tenant"',
    ]);
    expect(literalOf('shape.ts', head, 'ACTIVE_ORGANISATIONS_SQL')).toBe("SELECT id FROM tenant WHERE status = 'active'");
    expect(literalOf('shape.ts', "const ACTIVE_ORGANISATIONS_SQL = ['SELECT id', 'FROM tenant'].join(' ');", 'ACTIVE_ORGANISATIONS_SQL')).toBe(
      undefined,
    );
    expect(activeOrganisationsAnswers('shape.ts', `${head}${ownersList}`)).toEqual({
      declared: 'Promise<string[]>',
      returns: ['rows.map((row)=>row.id)'],
    });
    // The review's own: the answer handed through a callback on the owner's pool.
    expect(
      activeOrganisationsAnswers(
        'shape.ts',
        'export async function activeOrganisations(env: E = process.env): Promise<string[]> {\n' +
          '  return acrossOrganisations(async (owner) => (await owner.query(ACTIVE_ORGANISATIONS_SQL)).rows.map((row) => row.id), env);\n' +
          '}\n',
      ).returns,
    ).toEqual(['acrossOrganisations(async(owner)=>(awaitowner.query(ACTIVE_ORGANISATIONS_SQL)).rows.map((row)=>row.id),env)']);
    expect(
      activeOrganisationsAnswers('shape.ts', 'export async function activeOrganisations(): Promise<unknown[]> { return rows; }'),
    ).toEqual({ declared: 'Promise<unknown[]>', returns: ['rows'] });
  });
});
