// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A ROUTE THAT OPENED THE OWNER'S POOL (workplan 0138 T6).
 *
 * The API's request path connects as `app_user`: `getDbPool()`
 * (`apps/api/src/middleware/auth.ts`) reads `APP_DATABASE_URL`, and every route
 * runs its tenant queries inside `withTenant` / `withTenantDb` on that pool, so
 * row security filters them. From 2026-08-04 (workplan 0029) until 2026-09-28
 * one file did not. `apps/api/src/routes/permissions.ts`, the permission report
 * and the sharing rescan, built its own pool:
 *
 *     new Pool({ connectionString: process.env.DATABASE_URL })
 *
 * On managed that is the database owner, a superuser, whom Postgres never holds
 * to row security. Its three helpers read `connection`, `mailbox_mapping` and
 * `mailbox` there, and one of them joined `mailbox` by id alone, so a mapping
 * whose `source_mailbox_id` named another organisation's mailbox read that
 * organisation's address. Nothing went red: 0138 T5 step 1 found it by reading
 * every pool in `apps/api/src` by hand (0138 Status, 2026-09-27), and T4's
 * guard, `a-pass-that-opened-the-owners-pool`, walks `apps/worker/src` and
 * each `packages/<name>/src` only.
 *
 * WHAT THE API IS GIVEN. `deploy/compose/managed.yml` hands the api service
 * three database URLs: `DATABASE_URL` and `DIRECT_DATABASE_URL`, both composed
 * from `${POSTGRES_USER`, the owner, and `APP_DATABASE_URL`, composed from
 * `${APP_DB_USER`. The first case below reads that block, so "a database URL
 * other than `APP_DATABASE_URL`" and "the owner's URL" stay the same set of
 * names for the API; an owner URL handed over under a name that does not end in
 * `DATABASE_URL` fails it.
 *
 * THE RULE. A non-test `.ts` file under `apps/api/src` that reads such a name
 * (as a property, an element, a destructured binding, or a string whose whole
 * text is the name, as T4 counts them; parsed, so a comment is not a read),
 * builds a node-postgres pool or client itself, or names one of the functions
 * that read the owner's URL or open a pool for their caller (OWNER_URL_HELPERS),
 * must be on OFF_THE_REQUEST_PATH, with its reason. The list is closed, and no
 * file under `apps/api/src/routes` may ever be on it. A route that calls a
 * module of `apps/api/src` which opens the owner's pool is caught at that
 * module, because it is scanned too. A package function is caught only by its
 * name, which is why OWNER_URL_HELPERS lists the ones in `packages/` that fall
 * back to `DATABASE_URL` when they are handed no connection.
 *
 * TWO OF THE FOUR ENTRIES HOLD REQUEST-PATH CODE, so they are pinned, not
 * exempt. `middleware/auth.ts` is `authenticate` as well as `getDbPool()`, and
 * `index.ts` defines handlers of its own (`/metrics`, `/health`,
 * `/api/auth/mode`). Each carries the exact list of what it reaches and where:
 * one more `new Pool` or one more read of `DATABASE_URL`, in any function,
 * fails. The two scripts are exempt as whole files, and a case checks that
 * nothing outside `apps/api/src/scripts` imports them, so they never load in
 * the API's process.
 *
 * WHY A GUARD OF ITS OWN, and not T4's scan widened to the API. T4's lists are
 * about tasks: `CROSS_TENANT` names jobs that span organisations, and its
 * ratchet is the per-tenant jobs T1 moves. A route has no reason ever to read
 * the owner's URL, so there is no list for routes, only a zero. And T4's file
 * is what the next steps of 0138 change (T1 empties and deletes its ratchet,
 * T5 step 2 moves its lists to a shared module); this one can land without
 * touching it. What the two must agree on, the names that count as a database
 * URL, is written out again here rather than imported (importing from a
 * `.unit.test.ts` runs every case in it), and the first case checks that T4
 * still carries the same pattern.
 *
 * WHAT IT DOES NOT SEE.
 *
 * - A value that reaches the owner through the environment under a name it
 *   does not know.
 * - `getDbPool()`'s own fallback: `APP_DATABASE_URL || DATABASE_URL`, which is
 *   the self-host arrangement its comment gives. On managed, `managed.yml` sets
 *   `APP_DATABASE_URL` (checked below); a deployment that dropped it would put
 *   every route on the owner, and this guard would not notice.
 * - A connection handed in rather than opened. `index.ts` builds the audit
 *   key's pool of one on the owner's URL and hands it on: to `audit-key.ts`
 *   (`setAuditKeyDriver`), which the operator's audit download in
 *   `routes/support.ts` reads the pseudonym key through, and to the audit
 *   export sink, which reads the same key for the line printed after an audit
 *   event commits. Neither reader names a URL or builds a pool, so neither is
 *   flagged. Both read `deployment_key` only, which holds no organisation's
 *   rows (`docs/rls-guide.md` §2).
 * - A package function that falls back to the owner and is not on
 *   OWNER_URL_HELPERS. The list is the ones found on 2026-09-28; T1 part 2
 *   removes their fallbacks, and each leaves the list in the same change.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API_SRC = 'apps/api/src';
const ROUTES = `${API_SRC}/routes/`;
const T4_GUARD = 'scripts/a-pass-that-opened-the-owners-pool.unit.test.ts';

/**
 * The files in `apps/api/src` that may reach the owner's connection, each
 * because what reaches it is not the request path. Closed: a new entry needs a
 * reason that is not a route's.
 *
 * `pinned` is the exact list of what the file reaches, one line per
 * occurrence, each with the function it sits in (`whereIn`). A file that holds
 * request-path code is pinned. A file without a pin is exempt whole, and must
 * be a script under `apps/api/src/scripts` that nothing outside that folder
 * imports.
 */
const OFF_THE_REQUEST_PATH: Record<string, { reason: string; pinned?: readonly string[] }> = {
  'apps/api/src/index.ts': {
    reason:
      'the process entry: applies both migration chains on the owner URL before it listens, ' +
      'and keeps a pool of one on it to read the audit pseudonym key, which app_user may not ' +
      '(ledger migration 0062). Its handlers (/metrics, /health, /api/auth/mode) reach nothing',
    pinned: [
      // The start-up block: `DATABASE_URL is required`, then the migrations'
      // URL and whether a pooler is in front, each imported and called once.
      'names migrationConnectionString, in the module',
      'names migrationConnectionString, in the module',
      'names poolerInFront, in the module',
      'names poolerInFront, in the module',
      'reads DATABASE_URL, in the module',
      // The audit key's pool of one, once the migrations have run.
      'builds a pool (new Pool), in a function passed to then()',
    ],
  },
  'apps/api/src/middleware/auth.ts': {
    reason:
      'getDbPool() itself: APP_DATABASE_URL, or DATABASE_URL when that is unset, the self-host ' +
      'arrangement its comment gives; managed.yml sets APP_DATABASE_URL (checked below). The rest ' +
      'of the file, authenticate and the membership gate included, is the request path',
    pinned: ['builds a pool (new Pool), in getDbPool()', 'reads DATABASE_URL, in getDbPool()'],
  },
  'apps/api/src/scripts/operator.ts': {
    reason:
      "the operator's commands, run at the machine over the owner connection because they span " +
      'every organisation (docs/rls-guide.md §2)',
  },
  'apps/api/src/scripts/seed-managed.ts': { reason: 'writes the demo organisations at the machine, as the owner' },
};

/** Where the whole-file entries live: processes of their own, never the API's. */
const SCRIPTS = `${API_SRC}/scripts/`;

/** The names 0138 T4 counts as a database URL (its `IS_DB_URL`). */
const DB_URL_NAME = /^(?:[A-Z][A-Z0-9]*_)*DATABASE_URL$/;
const IS_DB_URL = (name: string) => DB_URL_NAME.test(name) && name !== 'APP_DATABASE_URL';

/**
 * Functions, each with the file that defines it, that read the owner's URL or
 * open a pool for their caller. `direct-url.ts` returns or compares the URL.
 * The rest are in `packages/` and fall back to `DATABASE_URL` (or, for the
 * last, open a pool on the string they are handed) when they are given no
 * connection: `openLedger` in `build-deps.ts`, which is not exported, through
 * the builders that call it, and `verifyMapping`'s own check. T1 part 2 (0138
 * §3) removes those fallbacks; a function that no longer has one leaves this
 * list in the same change. None is called in `apps/api/src` on 2026-09-28.
 */
const OWNER_URL_HELPERS: Record<string, string> = {
  migrationConnectionString: 'packages/ledger/src/direct-url.ts',
  poolerInFront: 'packages/ledger/src/direct-url.ts',
  buildDeps: 'packages/orchestration/src/build-deps.ts',
  buildDomainDeps: 'packages/orchestration/src/build-deps.ts',
  runAllDomains: 'packages/orchestration/src/orchestration.ts',
  discoverAllDomains: 'packages/orchestration/src/orchestration.ts',
  verifyMapping: 'packages/orchestration/src/orchestration.ts',
  applianceOpener: 'packages/orchestration/src/orchestration.ts',
  applyMappingDeletion: 'packages/orchestration/src/orchestration.ts',
  applyMappingRelocation: 'packages/orchestration/src/orchestration.ts',
  buildDepsFromMapping: 'packages/orchestration/src/build-deps-from-mapping.ts',
  buildDomainDepsFromMapping: 'packages/orchestration/src/build-deps-from-mapping.ts',
  createLedgerVerificationReader: 'packages/ledger/src/verification-queries.ts',
};
const HELPER_NAMES = Object.keys(OWNER_URL_HELPERS);

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.ts$/.test(e.name) && !/\.d\.ts$|\.(unit|integration|e2e)\.test\.ts$/.test(e.name)) {
        out.push(relative(REPO_ROOT, p));
      }
    }
  };
  walk(join(REPO_ROOT, API_SRC));
  return out.sort();
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

/** The function a node sits in, by the name it is called or bound by, or the module. */
function whereIn(node: ts.Node, sf: ts.SourceFile): string {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name) return `${n.name.getText(sf)}()`;
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
      const p = n.parent;
      if (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p)) return `${p.name.getText(sf)}()`;
      if (ts.isCallExpression(p)) {
        const callee = ts.isPropertyAccessExpression(p.expression) ? p.expression.name.text : p.expression.getText(sf);
        return `a function passed to ${callee}()`;
      }
      return 'an unnamed function';
    }
  }
  return 'the module';
}

interface Reach {
  what: string;
  where: string;
}

/** Everything in one file that reaches for a connection of its own: every occurrence, and where. */
function reachesIn(file: string, text: string): Reach[] {
  if (!/DATABASE_URL|Pool|Client|createPgDb|drizzle/.test(text) && !HELPER_NAMES.some((h) => text.includes(h))) {
    return [];
  }
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: Reach[] = [];
  const add = (what: string, node: ts.Node) => found.push({ what, where: whereIn(node, sf) });

  // Local names bound to pg's Pool or Client, to pg itself, and to drizzle.
  const pgClasses = new Set<string>();
  const pgModules = new Set<string>();
  const drizzleNames = new Set<string>();
  const bind = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const from = node.moduleSpecifier.text;
      const clause = node.importClause?.isTypeOnly ? undefined : node.importClause;
      const named = clause?.namedBindings;
      if (from === 'pg' && clause?.name) pgModules.add(clause.name.text);
      if (from === 'pg' && named && ts.isNamespaceImport(named)) pgModules.add(named.name.text);
      if (named && ts.isNamedImports(named)) {
        for (const el of named.elements) {
          if (el.isTypeOnly) continue;
          const imported = (el.propertyName ?? el.name).text;
          if (from === 'pg' && (imported === 'Pool' || imported === 'Client')) pgClasses.add(el.name.text);
          if (from.startsWith('drizzle-orm') && imported === 'drizzle') drizzleNames.add(el.name.text);
        }
      }
    } else if (ts.isVariableDeclaration(node) && node.initializer && ts.isObjectBindingPattern(node.name)) {
      // `const { Pool: P } = pg`.
      for (const el of node.name.elements) {
        const key = el.propertyName ?? el.name;
        if (ts.isIdentifier(key) && (key.text === 'Pool' || key.text === 'Client') && ts.isIdentifier(el.name)) {
          pgClasses.add(el.name.text);
        }
      }
    }
    ts.forEachChild(node, bind);
  };
  bind(sf);

  const visit = (node: ts.Node) => {
    // The four forms of a read.
    if (ts.isPropertyAccessExpression(node) && IS_DB_URL(node.name.text)) {
      add(`reads ${node.name.text}`, node);
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      IS_DB_URL(node.argumentExpression.text)
    ) {
      add(`reads ${node.argumentExpression.text}`, node);
    } else if (ts.isBindingElement(node)) {
      const key = node.propertyName ?? node.name;
      if ((ts.isIdentifier(key) || ts.isStringLiteralLike(key)) && IS_DB_URL(key.text)) add(`reads ${key.text}`, node);
    } else if (ts.isStringLiteralLike(node) && IS_DB_URL(node.text) && !ts.isElementAccessExpression(node.parent)) {
      add(`reads ${node.text}`, node);
    }
    // A pool or a client of its own.
    if (ts.isNewExpression(node)) {
      const callee = node.expression.getText(sf);
      if (
        pgClasses.has(callee) ||
        [...pgModules].some((m) => callee === `${m}.Pool` || callee === `${m}.Client`)
      ) {
        add(`builds a pool (new ${callee})`, node);
      }
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf);
      if (/(^|\.)createPgDb$/.test(callee)) add('builds a pool (createPgDb)', node);
      else if (drizzleNames.has(callee)) {
        // Handed a pool, or a call that returns one, drizzle builds nothing.
        // Handed a URL or a config, it builds a pool of its own.
        const first = node.arguments[0] && bare(node.arguments[0]);
        if (!first || !(ts.isIdentifier(first) || ts.isCallExpression(first))) {
          add('builds a pool (drizzle given no pool)', node);
        }
      }
    }
    // A function that reads the owner's URL, or opens a pool, for its caller.
    if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && HELPER_NAMES.includes(node.text)) {
      add(`names ${node.text}`, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** What a file reaches, once each, without where: the shapes below are written this way. */
function reaches(file: string, text: string): string[] {
  return [...new Set(reachesIn(file, text).map((r) => r.what))].sort();
}

/** Every occurrence as one line, `what, in where`, sorted, as a pin is written. */
const asPinned = (found: readonly Reach[]): string[] => found.map((r) => `${r.what}, in ${r.where}`).sort();

/** The relative modules a file imports or re-exports, statically or not, as repository paths. */
function relativeImports(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    let spec: ts.Expression | undefined;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) spec = node.moduleSpecifier;
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) spec = node.arguments[0];
    if (spec && ts.isStringLiteralLike(spec) && spec.text.startsWith('.')) out.push(join(dirname(file), spec.text));
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** The api service's `environment:` block in managed.yml, as NAME → value. */
function apiEnvironment(): Map<string, string> {
  const managed = readFileSync(join(REPO_ROOT, 'deploy/compose/managed.yml'), 'utf8');
  const start = managed.indexOf('\n  api:\n');
  if (start < 0) return new Map();
  const lines = managed.slice(start + 1).split('\n').slice(1);
  const end = lines.findIndex((l) => /^ {2}\S/.test(l));
  const block = end < 0 ? lines : lines.slice(0, end);
  const env = new Map<string, string>();
  let inside = false;
  for (const line of block) {
    if (/^ {4}environment:\s*$/.test(line)) {
      inside = true;
      continue;
    }
    if (inside && /^ {4}\S/.test(line)) break;
    const m = inside ? /^ {6}([A-Z][A-Z0-9_]*):\s*(.*)$/.exec(line) : null;
    if (m) env.set(m[1]!, m[2]!);
  }
  return env;
}

const files = sourceFiles();
const texts = new Map(files.map((f) => [f, readFileSync(join(REPO_ROOT, f), 'utf8')]));
const reaching = new Map(
  files.map((f) => [f, reachesIn(f, texts.get(f)!)] as const).filter(([, found]) => found.length > 0),
);

describe('the API is given the owner under the names this guard counts', () => {
  it('managed.yml composes the owner only into names it reads as a database URL', () => {
    const env = apiEnvironment();
    expect(env.size, 'found no environment block for the api service in managed.yml').toBeGreaterThan(10);
    const owner = [...env].filter(([, v]) => /\$\{POSTGRES_USER\b/.test(v)).map(([k]) => k).sort();
    expect(owner, 'the owner URLs the API is handed').toEqual(['DATABASE_URL', 'DIRECT_DATABASE_URL']);
    for (const name of owner) expect(IS_DB_URL(name), `${name} is the owner's and not counted`).toBe(true);
    // And the request path's URL is the application role's, and is set.
    expect(env.get('APP_DATABASE_URL')).toMatch(/^postgresql:\/\/\$\{APP_DB_USER\b/);
    // T4 still counts the same names.
    expect(readFileSync(join(REPO_ROOT, T4_GUARD), 'utf8')).toContain(DB_URL_NAME.source);
  });
});

describe('no route opens the owner pool', () => {
  it('found the API, and sees each shape it refuses', () => {
    expect(files.length).toBeGreaterThan(60);
    expect(files).toContain('apps/api/src/routes/permissions.ts');
    expect(files).toContain('apps/api/src/routes/migrations/operating-routes.ts');
    // The shape permissions.ts had until 2026-09-28, exactly.
    expect(
      reaches(
        'shape.ts',
        "import { Pool } from 'pg';\n" +
          'let _pool: Pool | null = null;\n' +
          'function pool(): Pool {\n' +
          '  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL });\n' +
          '  return _pool;\n' +
          '}\n',
      ),
    ).toEqual(['builds a pool (new Pool)', 'reads DATABASE_URL']);
    for (const [shape, what] of [
      ["const { DIRECT_DATABASE_URL: url } = process.env;", 'reads DIRECT_DATABASE_URL'],
      ["const url = process.env['DATABASE_URL'];", 'reads DATABASE_URL'],
      ["const url = getEnv('DATABASE_URL');", 'reads DATABASE_URL'],
      ["import { Pool as PgPool } from 'pg'; new PgPool({});", 'builds a pool (new PgPool)'],
      ["import pg from 'pg'; new pg.Client();", 'builds a pool (new pg.Client)'],
      ["import { drizzle } from 'drizzle-orm/node-postgres'; drizzle(process.env.APP_DATABASE_URL!);", 'builds a pool (drizzle given no pool)'],
      ["import { drizzle } from 'drizzle-orm/node-postgres'; drizzle({ connection: 'x' });", 'builds a pool (drizzle given no pool)'],
      ['const url = migrationConnectionString(process.env);', 'names migrationConnectionString'],
      // A package function that falls back to the owner when handed no connection.
      ["import { verifyMapping } from '@openmig/orchestration'; await verifyMapping(config);", 'names verifyMapping'],
      ["import { buildDeps } from '@openmig/orchestration'; await buildDeps(config);", 'names buildDeps'],
    ] as const) {
      expect(reaches('shape.ts', shape), shape).toContain(what);
    }
    // Every occurrence counts, with where it sits: a second owner pool beside
    // getDbPool's, or one in a handler, is a line its pin does not have.
    expect(
      asPinned(
        reachesIn(
          'shape.ts',
          "import { Pool } from 'pg';\n" +
            'export function getDbPool(): Pool {\n' +
            '  return new Pool({ connectionString: process.env.APP_DATABASE_URL || process.env.DATABASE_URL });\n' +
            '}\n' +
            'const gatePool = new Pool({ connectionString: process.env.DATABASE_URL });\n' +
            "app.get('/x', async (_req, res) => {\n" +
            '  res.json(await new Pool({ connectionString: process.env.DATABASE_URL }).query(\'SELECT 1\'));\n' +
            '});\n',
        ),
      ),
    ).toEqual([
      'builds a pool (new Pool), in a function passed to get()',
      'builds a pool (new Pool), in getDbPool()',
      'builds a pool (new Pool), in the module',
      'reads DATABASE_URL, in a function passed to get()',
      'reads DATABASE_URL, in getDbPool()',
      'reads DATABASE_URL, in the module',
    ]);
    // And what a route does is none of those: the pool it is handed, or the
    // call that hands it one, and a comment that names the variable.
    for (const fine of [
      "import { drizzle } from 'drizzle-orm/node-postgres'; drizzle(pool());",
      "import { drizzle } from 'drizzle-orm/node-postgres'; drizzle(getSharedPool());",
      'const url = process.env.APP_DATABASE_URL;',
      '// getDbPool() throws when DATABASE_URL is unset\nconst p = getDbPool();',
    ]) {
      expect(reaches('shape.ts', fine), fine).toEqual([]);
    }
    // Two routes name DATABASE_URL in a comment only.
    for (const file of ['apps/api/src/routes/view.ts', 'apps/api/src/routes/grant.ts']) {
      expect(texts.get(file), `${file} no longer mentions DATABASE_URL`).toContain('DATABASE_URL');
      expect(reaching.has(file), `${file} is counted for a comment`).toBe(false);
    }
  });

  it.each([...reaching.keys()].map((f) => [f]))('%s is off the request path, with its reason', (file) => {
    expect(
      OFF_THE_REQUEST_PATH[file],
      `${file}: ${asPinned(reaching.get(file)!).join('; ')}.\n\n` +
        "On managed, a database URL other than APP_DATABASE_URL is the database owner's, a superuser\n" +
        'whom row security never binds. A route takes its connection from getDbPool() and runs its\n' +
        "tenant's queries inside withTenant or withTenantDb (docs/rls-guide.md, \"Where row security\n" +
        'holds today"). OFF_THE_REQUEST_PATH is for what runs at the machine or before the API listens.',
    ).toBeDefined();
  });

  it('no route is on the list, and every entry still reaches the owner', () => {
    for (const file of Object.keys(OFF_THE_REQUEST_PATH)) {
      expect(file.startsWith(ROUTES), `${file} is a route; a route is never off the request path`).toBe(false);
      expect(texts.has(file), `${file} is on OFF_THE_REQUEST_PATH and is not a source file here`).toBe(true);
      expect(reaching.has(file), `${file} no longer reaches a connection of its own: delete its entry`).toBe(true);
    }
  });

  it.each(
    Object.entries(OFF_THE_REQUEST_PATH)
      .filter(([, entry]) => entry.pinned)
      .map(([file]) => [file]),
  )('%s reaches exactly what its pin lists, and nowhere else', (file) => {
    // It holds request-path code, so the entry covers these lines, not the file.
    expect(
      asPinned(reaching.get(file) ?? []),
      `${file} reaches the owner's connection somewhere its pin does not list. It holds code that runs\n` +
        'on a request, and a route takes its connection from getDbPool() inside withTenant or\n' +
        'withTenantDb. Change the pin only for something that is not the request path.',
    ).toEqual([...OFF_THE_REQUEST_PATH[file]!.pinned!].sort());
  });

  it('an entry without a pin is a script the API never loads', () => {
    const whole = Object.entries(OFF_THE_REQUEST_PATH)
      .filter(([, entry]) => !entry.pinned)
      .map(([file]) => file);
    expect(whole).toEqual(['apps/api/src/scripts/operator.ts', 'apps/api/src/scripts/seed-managed.ts']);
    for (const file of whole) expect(file.startsWith(SCRIPTS), `${file} is exempt whole and is not a script`).toBe(true);
    for (const file of files.filter((f) => !f.startsWith(SCRIPTS))) {
      const into = relativeImports(file, texts.get(file)!).filter((m) => m.startsWith(SCRIPTS));
      expect(into, `${file} imports from ${SCRIPTS}, which this guard exempts as never loaded by the API`).toEqual([]);
    }
    // The walk sees an import where there is one.
    expect(relativeImports('apps/api/src/routes/x.ts', "import { a } from '../scripts/operator.ts';")).toEqual([
      'apps/api/src/scripts/operator.ts',
    ]);
    expect(relativeImports('apps/api/src/x.ts', "const m = await import('./scripts/seed-managed.ts');")).toEqual([
      'apps/api/src/scripts/seed-managed.ts',
    ]);
  });

  it('each function on OWNER_URL_HELPERS is still defined where the list says', () => {
    for (const [helper, home] of Object.entries(OWNER_URL_HELPERS)) {
      expect(
        readFileSync(join(REPO_ROOT, home), 'utf8'),
        `${home} no longer defines ${helper}: find where it went, or take it off the list if it no longer falls back`,
      ).toMatch(new RegExp(`export (?:async )?function ${helper}\\b`));
    }
  });
});
