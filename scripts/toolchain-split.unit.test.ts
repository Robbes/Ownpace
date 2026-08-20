// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The two TypeScripts are crossed ON PURPOSE. This test says so in a way that
 * fails instead of arguing.
 *
 * `package.json` reads, and is meant to read:
 *
 *     "typescript":          "npm:@typescript/typescript6@…"   <- the 6.x API
 *     "@typescript/native":  "npm:typescript@7…"               <- the 7 binary
 *
 * which looks exactly like somebody typed the two values into the wrong slots.
 * Uncrossing them is a one-line "cleanup" that installs fine, type-checks
 * fine, and breaks ESLint — because TypeScript 7.0 ships NO programmatic API,
 * while typescript-eslint imports one from the package NAME `typescript`.
 * Verified by doing it (2026-08-19): every `pnpm lint` then dies with
 *
 *     typescript-eslint does not support TS 7.0.
 *
 * and a pointer to typescript-eslint#10940, which tracks TS >=7.1 support.
 * That message is clear enough on its own — this guard is not here to explain
 * the failure, it is here to catch the change BEFORE lint runs, and to fail on
 * the reinstall rather than on whichever job happens to lint first.
 *
 * So the invariant is a pair, and only the pair is meaningful:
 *
 *   - the BINARY `tsc` must be TypeScript 7   (fast checks are the whole point)
 *   - the MODULE `typescript` must be 6.x     (or the linter has no API to load)
 *
 * Both halves are checked by RESOLVING them, not by reading the manifest back:
 * a manifest test would restate the spec, and the thing that actually breaks is
 * what the resolver hands to the linter.
 *
 * Delete this file when the split goes away — see AGENTS.md for the trigger
 * (a typescript-eslint release whose peer range admits TypeScript 7).
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);

describe('the toolchain runs TypeScript 7 for checks and TypeScript 6 for the API', () => {
  it('resolves the `typescript` MODULE to a 6.x compiler API', () => {
    // This is the one typescript-eslint loads.
    const ts = require_('typescript') as { version: string; createProgram?: unknown };
    expect(ts.version).toMatch(/^6\./);
  });

  it('gives that module the programmatic API TypeScript 7 does not ship', () => {
    const ts = require_('typescript') as { createProgram?: unknown; createSourceFile?: unknown };
    // The two entry points typescript-estree actually calls. If a future
    // "cleanup" points `typescript` at 7, these are what go undefined.
    expect(typeof ts.createProgram).toBe('function');
    expect(typeof ts.createSourceFile).toBe('function');
  });

  it('runs TypeScript 7 as the `tsc` BINARY', () => {
    const out = execFileSync(join(ROOT, 'node_modules/.bin/tsc'), ['--version'], {
      encoding: 'utf8',
    });
    expect(out).toMatch(/Version 7\./);
  });

  it('keeps `tsc6` available as the second opinion', () => {
    const out = execFileSync(join(ROOT, 'node_modules/.bin/tsc6'), ['--version'], {
      encoding: 'utf8',
    });
    expect(out).toMatch(/Version 6\./);
  });

  it('points `typecheck` at tsc and `typecheck:legacy` at tsc6', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    // Not a restatement of the manifest: it pins WHICH script each binary is
    // wired to, so swapping them (the other easy mistake) fails here rather
    // than silently making CI slow again.
    expect(pkg.scripts.typecheck).toMatch(/(^|\s)tsc\s/);
    expect(pkg.scripts.typecheck).not.toMatch(/tsc6/);
    expect(pkg.scripts['typecheck:legacy']).toMatch(/tsc6/);
  });

  it('lints with a content-hashed cache, the only kind that survives a checkout', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    // `--cache` alone defaults to `metadata`, which keys on mtime.
    // actions/checkout writes every file fresh, so metadata invalidates 100%
    // of its entries in CI and the cache silently buys nothing — a check that
    // does not run reads exactly like a check that passed.
    expect(pkg.scripts.lint).toContain('--cache');
    expect(pkg.scripts.lint).toContain('--cache-strategy content');
  });
});
