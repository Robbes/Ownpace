// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Root-level e2e files must not import workspace packages.
 *
 * `test/e2e/` sits at the REPO ROOT, not inside a workspace package. The root
 * package.json declares no `@openmig/*` dependency, so pnpm creates no
 * `node_modules/@openmig` link there, and Node's resolver has nothing to find:
 * an import fails on the runner with
 *
 *   Error: Cannot find package '@openmig/shared' imported from
 *   .../test/e2e/selfhost-restart-resume.e2e.test.ts
 *
 * Every other test in the repo lives under `packages/*` or `apps/*`, whose
 * package.json DOES declare the dependency — so they resolve through pnpm's
 * symlink and this never came up. vitest.config.ts's root-level
 * `resolve.alias` did not cover the case either, despite a comment that said
 * it applied to all projects.
 *
 * It cost a full E2E dispatch to find, because it is invisible locally: `tsx`
 * and `tsc` both resolve `@openmig/*` through tsconfig paths, a completely
 * different mechanism from the one that runs on the box. A check that passes
 * under a resolver you are not shipping is not a check.
 *
 * There is a second, better reason to keep the rule: these files are BLACK-BOX
 * tests of a deployed appliance. They talk to it over curl and import nothing
 * but vitest and node builtins, which is what makes them a test of the built
 * artifact rather than of the source tree. Reaching into the source to borrow
 * a helper quietly weakens that.
 *
 * If an e2e genuinely needs a shared helper, copy the few lines with a comment
 * saying why (see `fileNaturalKeyHash` in selfhost-restart-resume.e2e.test.ts)
 * — or add the dependency to the root package.json deliberately, which is a
 * lockfile change and a decision, not an accident.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const E2E_DIR = dirname(fileURLToPath(import.meta.url));

/** `import ... from '<spec>'` and `from '<spec>'` in re-exports. */
const IMPORT_SPEC = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;

function specifiersIn(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(IMPORT_SPEC)) out.push(m[1]!);
  // Dynamic imports too — same resolver, same failure.
  for (const m of source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]!);
  return out;
}

describe('root-level e2e files', () => {
  const files = readdirSync(E2E_DIR).filter((f) => f.endsWith('.e2e.test.ts'));

  it('there are e2e files to check', () => {
    // Guards the guard: a rename that emptied this list would make every
    // assertion below vacuously true.
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} imports no workspace package`, () => {
      const source = readFileSync(join(E2E_DIR, file), 'utf8');
      const offenders = specifiersIn(source).filter((s) => s.startsWith('@openmig/'));
      expect(
        offenders,
        `${file} imports ${offenders.join(', ')}. test/e2e is not inside a workspace ` +
          `package, so pnpm links no @openmig/* into scope and this fails on the runner ` +
          `with ERR_MODULE_NOT_FOUND — while tsc and tsx both resolve it locally through ` +
          `tsconfig paths. Copy the handful of lines you need, with a comment saying why.`,
      ).toEqual([]);
    });

    it(`${file} imports only vitest, node builtins and declared instruments`, () => {
      // The stronger property, and the one that keeps these tests honest about
      // what they are testing: the deployed appliance, not the source tree.
      //
      // INSTRUMENTS is the deliberate-decision path the header describes: a
      // ROOT devDependency (so it resolves on the runner — the failure reason 1
      // guards against cannot occur) that drives the appliance from outside
      // rather than borrowing its code (so reason 2 is intact). playwright-core
      // is a browser: the UI smoke's equivalent of the `execSync('docker
      // compose …')` calls these files already make. Anything added here must
      // pass both halves of that test, and be in the root package.json first.
      const INSTRUMENTS = new Set(['vitest', 'playwright-core']);
      const source = readFileSync(join(E2E_DIR, file), 'utf8');
      const disallowed = specifiersIn(source).filter(
        (s) => !INSTRUMENTS.has(s) && !s.startsWith('node:') && !s.startsWith('.'),
      );
      expect(
        disallowed,
        `${file} imports ${disallowed.join(', ')}. An e2e talks to a RUNNING appliance ` +
          `over the wire; pulling in library code makes it partly a test of this checkout.`,
      ).toEqual([]);
    });
  }
});
