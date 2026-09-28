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
 * system variable, which the T3 guard, `a-run-that-carries-no-superuser`, only
 * lets go up under such a name), used as a property (`process.env.X`,
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
    'whether the platform is on hold (0138 T2)',
  'apps/worker/src/jobs/managed-retention.ts':
    'prunes across organisations, each one only as far as its last issued invoice (0138 T2)',
  'apps/worker/src/jobs/managed-purge-closed.ts':
    'finds closed organisations whose window has run out, revokes their stored ' +
    'credentials and removes their data (0138 T2)',
  'apps/worker/src/jobs/managed-digest.ts':
    'the list of organisations to write to; its per-organisation reads move under ' +
    'withTenant if 0138 open question 3 says split (0138 T2)',
  'apps/worker/src/jobs/managed-drift-detect.ts':
    'the list of organisations to look at; the same open question 3 (0138 T2)',
  'apps/worker/src/jobs/managed-group-discovery.ts':
    'the list of source connections across organisations; the same open question 3 (0138 T2)',
  'apps/worker/src/cli/index.ts':
    "the operator's cutover CLI, run at the machine by whoever runs the deployment, never as a task",
  'apps/worker/src/jobs/task-pools.ts':
    "the owner's URL for the audit key's pool alone: one connection, reading deployment_key, " +
    "which holds no organisation's rows and which ledger migration 0062 closes to app_user " +
    '(0138 T1 part 5). Every tenant read and write goes to APP_DATABASE_URL; T3 step 2 moves ' +
    "the key's pool to the system role",
  'packages/ledger/src/direct-url.ts':
    'migrationConnectionString reads the variables from an environment its caller ' +
    'passes; its callers are the API and the seed, and no task calls it',
};

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
 * The standalone worker (`src/index.ts`, the dev entrypoint the worker README
 * places outside both editions). It runs one organisation's pass from a config
 * file, and takes its pools the way the tasks do (0138 T1 step 2): until then
 * it was on CROSS_TENANT, reading `DATABASE_URL` for its ledger.
 */
const STANDALONE_WORKER = 'apps/worker/src/index.ts';

/** The one module that builds a task's pools. */
const TASK_POOLS = 'apps/worker/src/jobs/task-pools.ts';

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
    expect(readers.get('apps/worker/src/jobs/managed-sync-tick.ts')).toEqual(['DATABASE_URL']);
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

  it.each(taskFiles.map((f) => [f]))('%s is one of the two kinds', (file) => {
    // A new task is either one that asks about one organisation, and goes on
    // PER_TENANT to take its pools from openTaskPools, or one that spans them,
    // and goes on CROSS_TENANT with its reason.
    expect(
      PER_TENANT.includes(file) || CROSS_TENANT[file] !== undefined,
      `${file} registers a task and is on neither PER_TENANT nor CROSS_TENANT.`,
    ).toBe(true);
    expect(PER_TENANT.includes(file) && CROSS_TENANT[file] !== undefined, `${file} is on both lists`).toBe(false);
  });

  it.each([...PER_TENANT, STANDALONE_WORKER].map((f) => [f]))('%s opens its pools with openTaskPools and points no sink itself', (file) => {
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

  it.each([...PER_TENANT, STANDALONE_WORKER].map((f) => [f]))(
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

  it('task-pools.ts is on CROSS_TENANT for the key alone, and does nothing when it is imported', () => {
    expect(texts.has(TASK_POOLS), `${TASK_POOLS} is not a source file here`).toBe(true);
    expect(CROSS_TENANT[TASK_POOLS]).toMatch(/audit key/);
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
