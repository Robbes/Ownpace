// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PASS THAT OPENED THE OWNER'S POOL (workplan 0138 T4, landed as a ratchet
 * under T0's option (b)).
 *
 * The API's request path connects as `app_user`, so row security filters every
 * query it makes on a tenant table. The Trigger.dev tasks do not: every job in
 * `apps/worker/src/jobs/` builds its pool from `DATABASE_URL`, the database
 * owner, and the owner is a superuser on the managed stack. Postgres applies no
 * row security to a superuser, `FORCE` or not. In the task plane the boundary
 * between organisations therefore rests on each query's own `WHERE` clause and
 * nothing else (0138 §1, "What this means").
 *
 * T1 moves the per-tenant tasks to `APP_DATABASE_URL`. This guard holds the
 * line until then and after: a file that reads a database URL from the
 * environment other than `APP_DATABASE_URL` must be on one of two lists.
 *
 *   CROSS_TENANT            closed, and it stays. Each entry asks a question
 *                           that spans organisations by nature, or runs at the
 *                           machine and never as a task, and says which.
 *   KNOWN_REMOVED_BY_T1     today's per-tenant readers. It may only shrink: an
 *                           entry whose file no longer reads a database URL
 *                           fails until it is deleted, and the list cannot grow
 *                           past its size on the day it landed. T1 empties it,
 *                           and T1's PR deletes it.
 *
 * So a NEW file that reads the owner's URL fails at once, whichever way the
 * owner answers 0138 T0.
 *
 * WHAT "READS A DATABASE URL" MEANS HERE. Any name ending in `DATABASE_URL`
 * other than `APP_DATABASE_URL` (so `DATABASE_URL`, `DIRECT_DATABASE_URL`, the
 * builders' `TEST_DATABASE_URL || DATABASE_URL` fallback, and T3 step 2's system
 * variable if it is named that way), used as a property (`process.env.X`,
 * `env.X`), an element (`env['X']`), a destructured binding (`{ X } = …`) or a
 * string whose whole text is the name (`getEnv('X')`). Parsed, not grepped: a
 * comment or an error message that mentions the name is not a read.
 *
 * WHAT IT DOES NOT SEE. A `new Pool()` with no connection string, which
 * node-postgres fills from `PGHOST`, `PGUSER` and the rest. No file here does
 * that; the second rule below, on who may build a pool in `jobs/`, is the net
 * for it in the place that matters.
 *
 * The lists are exported: 0138 T5 step 2 extends the docs guard to check that
 * `docs/rls-guide.md` names every file on CROSS_TENANT, so the code and the
 * guide cannot disagree about who holds the cross-tenant connection.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Files that may read a database URL other than APP_DATABASE_URL, for good. */
export const CROSS_TENANT: Record<string, string> = {
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
  'apps/worker/src/index.ts':
    'the dev entrypoint, which the worker README places outside both editions',
  'packages/ledger/src/direct-url.ts':
    'migrationConnectionString reads the variables from an environment its caller ' +
    'passes; its callers are the API and the seed, and no task calls it',
};

/**
 * Today's per-tenant readers. May only shrink: 0138 T1 empties it, and its PR
 * deletes it together with the size check below.
 */
export const KNOWN_REMOVED_BY_T1: Record<string, string> = {
  'apps/worker/src/jobs/run-delta-sync.ts': 'a pass, on the owner pool (T1 part 1)',
  'apps/worker/src/jobs/run-discovery.ts': 'a discovery, on the owner pool (T1 part 1)',
  'apps/worker/src/jobs/run-verification.ts':
    'a verification, and the ledger reader it opens from the same URL (T1 parts 1 and 2)',
  'apps/worker/src/jobs/run-confirmation.ts':
    'a confirmation, and its rate budget opened from the same URL (T1 part 1)',
  'apps/worker/src/jobs/run-apply-deletion.ts': 'an owner-approved removal (T1 part 1)',
  'apps/worker/src/jobs/run-apply-relocation.ts': 'an owner-approved move (T1 part 1)',
  'apps/worker/src/jobs/run-cutover.ts':
    'the final sync and the cutover gate, on the owner pool (T1 parts 1 and 2)',
  'apps/worker/src/jobs/run-rollback.ts': 'a rollback, on the owner pool (T1 parts 1 and 4)',
  'packages/orchestration/src/build-deps-from-mapping.ts':
    'buildDepsFromMapping and buildDomainDepsFromMapping open their own ledger from ' +
    'TEST_DATABASE_URL || DATABASE_URL; T1 part 2 hands them their handle',
  'packages/orchestration/src/build-deps.ts':
    'openLedger falls back to DATABASE_URL; T1 part 2 removes the fallback',
  'packages/orchestration/src/orchestration.ts':
    'verifyMapping falls back to DATABASE_URL; T1 part 2 removes the fallback',
};

/** Its size on the day it landed (2026-09-27). Lower it as entries go; never raise it. */
const KNOWN_REMOVED_BY_T1_AT_MOST = 11;

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
export function databaseUrlReads(file: string, text: string): string[] {
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

/** Whether a file builds a node-postgres pool itself. */
export function buildsAPool(file: string, text: string): boolean {
  if (!/Pool|createPgDb/.test(text)) return false;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  let builds = false;
  const visit = (node: ts.Node) => {
    if (ts.isNewExpression(node)) {
      const callee = node.expression.getText(sf);
      if (/(^|\.)Pool$/.test(callee)) builds = true;
    } else if (ts.isCallExpression(node) && /(^|\.)createPgDb$/.test(node.expression.getText(sf))) {
      builds = true;
    }
    if (!builds) ts.forEachChild(node, visit);
  };
  visit(sf);
  return builds;
}

const files = sourceFiles();
const texts = new Map(files.map((f) => [f, readFileSync(join(REPO_ROOT, f), 'utf8')]));
const readers = new Map(
  files.map((f) => [f, databaseUrlReads(f, texts.get(f)!)] as const).filter(([, names]) => names.length > 0),
);

describe('who reads a database URL other than the application role', () => {
  it('found the tick and the builders, so the rest is not vacuous', () => {
    // If the parse or the walk stops matching, this goes red rather than every
    // case below passing over nothing.
    expect(files.length).toBeGreaterThan(100);
    expect(readers.get('apps/worker/src/jobs/managed-sync-tick.ts')).toEqual(['DATABASE_URL']);
    expect(readers.get('packages/orchestration/src/build-deps-from-mapping.ts')).toEqual([
      'DATABASE_URL',
      'TEST_DATABASE_URL',
    ]);
    // And a comment or a message is not a read: this file names DATABASE_URL
    // only in its header.
    expect(texts.get('apps/worker/src/jobs/stopping-a-pass.ts')).toContain('DATABASE_URL');
    expect(readers.has('apps/worker/src/jobs/stopping-a-pass.ts')).toBe(false);
  });

  it.each([...readers.keys()].map((f) => [f]))('%s is on a list, with its reason', (file) => {
    expect(
      CROSS_TENANT[file] ?? KNOWN_REMOVED_BY_T1[file],
      `${file} reads ${readers.get(file)!.join(', ')} from the environment.\n\n` +
        'On the managed stack that is the database owner, a superuser, whom row security\n' +
        'never binds. A per-tenant task reads APP_DATABASE_URL (0138 T1). A job that asks a\n' +
        'question spanning organisations goes on CROSS_TENANT with the reason it must.\n' +
        'KNOWN_REMOVED_BY_T1 does not take new entries.',
    ).toBeDefined();
  });

  it('no file is on both lists', () => {
    for (const file of Object.keys(KNOWN_REMOVED_BY_T1)) expect(CROSS_TENANT[file]).toBeUndefined();
  });

  it.each(Object.keys(CROSS_TENANT).map((f) => [f]))('CROSS_TENANT names %s, which exists and reads one', (file) => {
    expect(texts.has(file), `${file} is on CROSS_TENANT and is not a source file here`).toBe(true);
    expect(readers.has(file), `${file} is on CROSS_TENANT and reads no database URL: delete the entry`).toBe(true);
  });
});

describe('the list T1 empties only shrinks', () => {
  it.each(Object.keys(KNOWN_REMOVED_BY_T1).map((f) => [f]))('%s still reads one, or leaves the list', (file) => {
    expect(
      readers.has(file),
      `${file} no longer reads a database URL other than APP_DATABASE_URL.\n` +
        'Delete it from KNOWN_REMOVED_BY_T1 and lower KNOWN_REMOVED_BY_T1_AT_MOST.',
    ).toBe(true);
  });

  it('has not grown', () => {
    expect(Object.keys(KNOWN_REMOVED_BY_T1).length).toBeLessThanOrEqual(KNOWN_REMOVED_BY_T1_AT_MOST);
    // The ceiling follows the list down, so a freed place cannot be refilled.
    expect(KNOWN_REMOVED_BY_T1_AT_MOST).toBe(Object.keys(KNOWN_REMOVED_BY_T1).length);
  });
});

describe('a per-tenant job builds no pool of its own', () => {
  const jobs = files.filter((f) => f.startsWith(`${JOBS_DIR}/`));

  it('found the jobs', () => {
    expect(jobs).toContain(`${JOBS_DIR}/run-delta-sync.ts`);
    expect(buildsAPool(`${JOBS_DIR}/managed-sync-tick.ts`, texts.get(`${JOBS_DIR}/managed-sync-tick.ts`)!)).toBe(
      true,
    );
  });

  it.each(jobs.map((f) => [f]))('%s', (file) => {
    if (!buildsAPool(file, texts.get(file)!)) return;
    // T1 part 1 adds the one module that builds the tasks' pools, and adds it
    // here; until then no per-tenant job has a sanctioned way to build one.
    expect(
      CROSS_TENANT[file] ?? KNOWN_REMOVED_BY_T1[file],
      `${file} builds a Pool itself. A per-tenant job takes its pool from the one module\n` +
        'that builds every task pool from APP_DATABASE_URL (0138 T1 part 1).',
    ).toBeDefined();
  });
});
