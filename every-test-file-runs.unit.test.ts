// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Every test file this repository contains is collected by some project.
 *
 * `vitest.config.ts` splits the suite by an infix in the filename — `.unit.`,
 * `.integration.`, `.e2e.`, `.ui.` — and a file that carries none of them matches no
 * project and is simply never run. **This is silent in a way almost nothing
 * else is**: a failing test is loud, a skipped test is reported as skipped, an
 * empty file is reported as having no tests. An uncollected file produces no
 * line of output at all, so the suite looks exactly the same whether the file
 * exists or not.
 *
 * Found on 2026-08-07 during a sweep for checks that pass while proving
 * nothing. `packages/core/src/secrets.test.ts` (245 lines) and
 * `secret-store.test.ts` (129 lines) — the AES-GCM envelope every stored
 * credential goes through — had never been collected by any project. Renamed,
 * sixteen of their thirty-three tests failed immediately, all of them rot that
 * one run would have caught: an environment variable deleted by one test and
 * never restored, assertions matching error wording the product no longer uses,
 * and one assertion whose premise made it impossible to pass.
 *
 * Kept at the repository root, next to the config it is about. Root-level test
 * files cannot import workspace packages (see the note in `vitest.config.ts`),
 * so this uses node builtins only.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';

/** The infixes `vitest.config.ts` splits projects on. */
// `.ui.` is the managed browser smoke (test/ui/, project 'ui'). Added here in
// the same commit that introduced the infix — this guard caught it as an
// orphan on the first run, which is the guard working.
const COLLECTED = ['.unit.test.', '.integration.test.', '.e2e.test.', '.ui.test.'];

/** Directories with no test files of ours in them. */
const SKIP = new Set(['node_modules', '.git', 'dist', 'dist-selfhost', 'coverage', '.turbo']);

function testFilesUnder(dir: string, rel = ''): string[] {
  const out: string[] = [];
  // `ReturnType<typeof readdirSync<…>>` does not type-check: readdirSync is
  // OVERLOADED, not generic, so there is no type argument list to apply. The
  // element type is what this actually wanted.
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const here = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...testFilesUnder(join(dir, entry.name), here));
      continue;
    }
    if (/\.test\.(ts|tsx)$/.test(entry.name)) out.push(here);
  }
  return out;
}

describe('the test suite runs every test file in the repository', () => {
  const root = __dirname;

  it('has no test file that matches no vitest project', () => {
    const orphans = testFilesUnder(root).filter((f) => !COLLECTED.some((c) => f.includes(c)));

    expect(
      orphans,
      'these files end in .test.ts but carry none of the infixes vitest.config.ts ' +
        'splits on, so NO project collects them and they run nowhere. Rename to ' +
        '*.unit.test.ts, *.integration.test.ts, *.e2e.test.ts or *.ui.test.ts:\n' +
        orphans.join('\n'),
    ).toEqual([]);
  });

  it('actually found the test files', () => {
    // Guards the guard. A walk that returns nothing satisfies the check above
    // perfectly, and there is no way to tell the two apart from the outside.
    const all = testFilesUnder(root);
    expect(all.length, 'the walk found no test files at all').toBeGreaterThan(100);
    // And it reached past the root into the workspaces, which is where all but
    // a couple of them live.
    expect(all.filter((f) => f.startsWith('packages/')).length).toBeGreaterThan(50);
    expect(all.filter((f) => f.startsWith('apps/')).length).toBeGreaterThan(20);
  });
});
