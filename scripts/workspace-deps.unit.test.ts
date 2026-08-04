// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Every workspace package a file imports must be a DECLARED dependency.
 *
 * This exists because the same failure has now shipped twice, and both times
 * it reached CI green-on-typecheck and red-on-runtime:
 *
 *  - 2026-08-03: `apps/selfhost` imported `@openmig/core` without declaring
 *    it. Seven appliance suites failed to COLLECT.
 *  - 2026-08-04: `apps/api` imported `@openmig/connectors` without declaring
 *    it. The whole api integration job failed with ERR_MODULE_NOT_FOUND.
 *
 * The reason it keeps happening is that the two resolvers disagree, and only
 * one of them runs locally on the fast path. TypeScript resolves
 * `@openmig/connectors` through `tsconfig.base.json`'s path mapping — so
 * `pnpm typecheck` is perfectly green — while Node and pnpm resolve it
 * through `node_modules`, which only has a symlink if the importing package
 * DECLARED the dependency. Nothing on the way to a commit notices.
 *
 * So this test is the thing that notices. It is deliberately a plain
 * source-text scan rather than a resolver: it needs to run in milliseconds
 * and it needs to be obvious enough that a failure points straight at the fix
 * ("add X to Y's package.json").
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every workspace package that has its own package.json. */
function workspacePackages(): Array<{ name: string; dir: string }> {
  const out: Array<{ name: string; dir: string }> = [];
  for (const group of ['apps', 'packages']) {
    const base = join(ROOT, group);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base)) {
      const manifest = join(base, entry, 'package.json');
      if (!existsSync(manifest)) continue;
      const name = (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }).name;
      if (name) out.push({ name, dir: join(base, entry) });
    }
  }
  return out;
}

/** Every TypeScript source file under a directory, tests included. */
function sources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    // `dist` and `node_modules` are outputs and other packages' business.
    if (entry === 'node_modules' || entry === 'dist' || entry === 'build') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

/**
 * Workspace packages imported by a file's source text.
 *
 * Covers `import … from 'x'`, `import 'x'`, `export … from 'x'`, dynamic
 * `import('x')` and `require('x')`, and subpath imports like
 * `@openmig/ledger/schema-pg` — which resolve through the same symlink and
 * fail the same way.
 */
const IMPORT_RE = /(?:from|import|require)\s*\(?\s*['"](@openmig\/[a-z0-9-]+)(?:\/[^'"]*)?['"]/g;

/**
 * Strip comments before scanning.
 *
 * Not fussiness: this file's own first run flagged `@openmig/shared` for
 * importing `@openmig/core`, and the "import" was a worked example inside a
 * doc comment explaining where those types live. Documentation that shows an
 * import statement is good documentation, and a guard that treats it as code
 * would push people to write worse comments to keep a test quiet.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function importedWorkspacePackages(file: string): Set<string> {
  const text = withoutComments(readFileSync(file, 'utf8'));
  const found = new Set<string>();
  for (const match of text.matchAll(IMPORT_RE)) found.add(match[1]!);
  return found;
}

describe('workspace dependencies are declared, not merely path-mapped', () => {
  const packages = workspacePackages();

  it('finds the workspace to check', () => {
    // A scan that silently found nothing would pass forever.
    expect(packages.length).toBeGreaterThan(3);
  });

  for (const pkg of packages) {
    it(`${pkg.name} declares every @openmig package it imports`, () => {
      const manifest = JSON.parse(readFileSync(join(pkg.dir, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      const declared = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
      ]);

      const missing = new Map<string, string>();
      for (const file of sources(pkg.dir)) {
        for (const imported of importedWorkspacePackages(file)) {
          // A package importing itself by name is legal and needs no entry.
          if (imported === pkg.name) continue;
          if (!declared.has(imported)) {
            missing.set(imported, file.replace(`${ROOT}/`, ''));
          }
        }
      }

      // The message IS the fix: typecheck resolves these through
      // tsconfig path mapping and Node does not, so the failure otherwise
      // surfaces as ERR_MODULE_NOT_FOUND in CI, far from its cause.
      expect(
        [...missing].map(([dep, file]) => `${dep} (imported by ${file})`),
        `${pkg.name}/package.json is missing workspace dependencies`,
      ).toEqual([]);
    });
  }
});
