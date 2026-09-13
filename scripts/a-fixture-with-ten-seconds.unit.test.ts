// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A hook that builds a database gets more than ten seconds to do it.
 *
 * ## The failure this prevents
 *
 * A `beforeAll` that starts a PGlite cluster and runs the full migration chain
 * costs most of a second per migration. Vitest gives a hook **10s by default**,
 * and that budget is spent per-file in a run where dozens of other files are
 * competing for the same machine. So the fixture passes alone and times out in
 * `--project unit`, which is the worst way to find out: a hook timeout reports
 * as SKIPPED tests, not as a failure with a cause. Nothing is red, nothing
 * names a defect, and the file's assertions simply did not run.
 *
 * That is #652, and by 2026-09-13 it had been met and fixed one file at a time
 * at least five separate times — `support-routes`, `support-views`, `grant`,
 * `migrate-upgrade`, `force-rls-managed` — each carrying its own note saying so,
 * each written after the same night of confusion. Five fixtures still had no
 * allowance at all.
 *
 * ## Why a test rather than a sixth note
 *
 * The per-file notes are the fix applied five times; this is the fix applied to
 * the CLASS. A fixture added tomorrow gets the same 10s default and the same
 * silent skip, and no amount of prose in a neighbouring file prevents it.
 *
 * ## Why the AST, and not a pattern
 *
 * Because a pattern got this wrong while the sweep was being written. The
 * allowance is written two ways — `}, 120_000);` on one line, and `},` then a
 * comment then `60_000,` then `);` across four — and a grep for the first
 * spelling reports the second as MISSING. Worse, a "find the first `});`"
 * repair then lands on the NEXT hook and puts a migration timeout on an
 * `afterAll`. `runs-without-a-transpiler.unit.test.ts` states the same rule
 * from its own scar: the thing being checked is syntax, so ask a parser.
 *
 * What is asserted is only that a second argument EXISTS. The right number is
 * a judgement per fixture — 30s, 60s, 120s and 180s are all in the tree, each
 * with a reason written beside it — and a test that insisted on one number
 * would be wrong about four of them.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The trees that hold unit fixtures. */
const TREES = ['apps', 'packages', 'scripts'];

/** The hooks vitest gives a 10s default to. */
const HOOKS = new Set(['beforeAll', 'beforeEach']);

/** Calls that build a database and are therefore what costs the time. */
const MIGRATORS = new Set(['runMigrations', 'runManagedMigrations']);

function everyUnitTest(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.unit.test.ts')) out.push(p);
    }
  };
  for (const t of TREES) walk(join(ROOT, t));
  return out;
}

/** Does this node's subtree call one of the migrators? */
function migratesWithin(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && MIGRATORS.has(n.expression.text)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

/** Every migrating hook in one file, and whether it was given a timeout. */
function migratingHooks(file: string): Array<{ line: number; hasTimeout: boolean }> {
  const text = readFileSync(file, 'utf8');
  // Cheap pre-filter: parsing every unit test would cost seconds for nothing.
  if (![...MIGRATORS].some((m) => text.includes(m))) return [];

  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const hooks: Array<{ line: number; hasTimeout: boolean }> = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && HOOKS.has(n.expression.text)) {
      const body = n.arguments[0];
      if (body && migratesWithin(body)) {
        hooks.push({
          line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
          // The number itself is the author's call; only its presence is ours.
          hasTimeout: n.arguments.length >= 2,
        });
      }
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  return hooks;
}

describe('a hook that migrates is given time to migrate', () => {
  const files = everyUnitTest();

  it('finds the fixtures to check', () => {
    // Guards the guard: a scan over nothing passes silently, and this whole
    // test is a scan.
    expect(files.length).toBeGreaterThan(200);
    const migrating = files.flatMap((f) => migratingHooks(f));
    expect(migrating.length).toBeGreaterThan(30);
  });

  it('gives every one of them an explicit timeout', () => {
    const bare: string[] = [];
    for (const file of files) {
      for (const hook of migratingHooks(file)) {
        if (!hook.hasTimeout) bare.push(`${relative(ROOT, file)}:${hook.line}`);
      }
    }

    expect(
      bare,
      'These hooks start a database and run the migration chain on vitest\'s 10s default. ' +
        'Under a full `--project unit` run that budget is spent competing with dozens of ' +
        'other files, and the fixture times out — reporting its tests as SKIPPED rather ' +
        'than failing with a cause (#652). Give the hook a second argument: the numbers ' +
        'already in this tree are 30_000, 60_000, 120_000 and 180_000, each with a note ' +
        'beside it saying what it measured.',
    ).toEqual([]);
  });
});
