// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Hard rule 5 guard (workplan 0010, T2/T3 "no managed leakage").
 *
 * The self-host appliance must never load managed-only code — no Trigger.dev,
 * no billing/Mollie, no RLS app-user path. This test walks the *actual*
 * transitive `@openmig`/relative import graph starting from the selfhost
 * entrypoint and fails if any reachable module imports a forbidden specifier.
 *
 * It is a real graph walk (not a grep of one file), so it catches transitive
 * regressions — e.g. importing `@openmig/scheduler` (the package index, which
 * re-exports the Trigger.dev client) instead of `@openmig/scheduler/in-process`.
 * It resolves only `@openmig/*` and relative imports (the code we own); bare
 * third-party specifiers are checked against the forbidden list but not walked.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// apps/selfhost/src -> repo root
const ROOT = resolve(HERE, '..', '..', '..');
const ENTRY = join(ROOT, 'apps/selfhost/src/index.ts');

const PKG_DIRS: Record<string, string> = {
  '@openmig/shared': 'packages/shared/src',
  '@openmig/ledger': 'packages/ledger/src',
  '@openmig/core': 'packages/core/src',
  '@openmig/connectors': 'packages/connectors/src',
  '@openmig/engines': 'packages/engines/src',
  '@openmig/scheduler': 'packages/scheduler/src',
  '@openmig/orchestration': 'packages/orchestration/src',
};

/** A specifier that must never be reachable from the self-host graph. */
function forbiddenReason(spec: string): string | null {
  if (/^@trigger\.dev(\/|$)/.test(spec)) return 'Trigger.dev SDK (managed orchestration)';
  if (/^@mollie(\/|$)/.test(spec) || /mollie/i.test(spec)) return 'Mollie billing client';
  if (/(^|\/)billing(\/|$)/.test(spec)) return 'billing module';
  // The scheduler index re-exports the Trigger.dev client — self-host must use
  // the trigger-free `/in-process` subpath instead.
  if (spec === '@openmig/scheduler' || spec === '@openmig/scheduler/index') {
    return 'scheduler package index (use @openmig/scheduler/in-process)';
  }
  return null;
}

/** Resolve an `@openmig/*` or relative specifier to an on-disk .ts file, or null. */
function resolveToFile(spec: string, fromFile: string): string | null {
  if (spec === '@openmig/scheduler/in-process') {
    return join(ROOT, 'packages/scheduler/src/scheduler.ts');
  }
  let base: string | null = null;
  if (spec.startsWith('.')) {
    base = resolve(dirname(fromFile), spec);
  } else {
    const m = /^(@openmig\/[a-z]+)(?:\/(.+))?$/.exec(spec);
    if (m) {
      const dir = PKG_DIRS[m[1]!];
      if (!dir) return null;
      base = join(ROOT, dir, m[2] ?? 'index');
    }
  }
  if (!base) return null;

  for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && candidate.endsWith('.ts')) return candidate;
  }
  return null;
}

const IMPORT_RE = /(?:from|import)\s*['"]([^'"]+)['"]/g;
const DYNAMIC_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

function specifiersOf(source: string): string[] {
  const specs = new Set<string>();
  for (const re of [IMPORT_RE, DYNAMIC_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) specs.add(m[1]!);
  }
  return [...specs];
}

interface Violation {
  file: string;
  spec: string;
  reason: string;
}

function walk(entry: string): { visited: Set<string>; violations: Violation[] } {
  const visited = new Set<string>();
  const violations: Violation[] = [];
  const queue: string[] = [entry];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);

    const source = readFileSync(file, 'utf-8');
    for (const spec of specifiersOf(source)) {
      const reason = forbiddenReason(spec);
      if (reason) {
        violations.push({ file: file.slice(ROOT.length + 1), spec, reason });
      }
      const next = resolveToFile(spec, file);
      if (next && !visited.has(next)) queue.push(next);
    }
  }
  return { visited, violations };
}

describe('self-host has no managed-only leakage (hard rule 5)', () => {
  const { visited, violations } = walk(ENTRY);

  it('walks a non-trivial module graph (guards against a broken resolver)', () => {
    // The entrypoint reaches shared/ledger/scheduler/worker-orchestration and
    // their local deps — if this collapses to a couple of files the walk is
    // broken and the leakage check below would pass vacuously.
    expect(visited.size).toBeGreaterThan(8);
  });

  it('maps every package to a directory that exists', () => {
    // `visited.size > 8` above is far too loose to catch the realistic failure.
    // A one-character typo in ONE PKG_DIRS value — `src` -> `srcs` — makes that
    // package unresolvable, so the walk silently skips it AND everything only
    // reachable through it: measured at 19 files dropped, 137 -> 118. Still
    // comfortably over 8, so the guard above passes and the leakage check runs
    // against a graph with a whole package missing from it.
    //
    // Found on 2026-08-14 by mutating this file and watching it stay green.
    const missing = Object.entries(PKG_DIRS)
      .filter(([, dir]) => !existsSync(join(ROOT, dir)))
      .map(([pkg, dir]) => `${pkg} -> ${dir}`);

    expect(
      missing,
      'these PKG_DIRS entries point at directories that do not exist, so those ' +
        'packages resolve to nothing and drop out of the leakage walk silently:\n' +
        missing.map((m) => `  - ${m}`).join('\n'),
    ).toEqual([]);
  });

  it('actually reaches the packages the appliance is built from', () => {
    // The complement to the check above: a directory can exist and still go
    // unwalked if the resolver or an import path changes. `@openmig/orchestration`
    // is named explicitly because `build-deps.ts` — the SELF-HOST dependency
    // builder — lives there. If the appliance's own builder is not in the graph,
    // this test is not checking the thing its name claims to check.
    const reachedPackages = new Set(
      [...visited]
        .map((f) => /packages\/([a-z]+)\/src\//.exec(f)?.[1])
        .filter((p): p is string => Boolean(p)),
    );

    for (const pkg of ['shared', 'ledger', 'core', 'orchestration']) {
      expect(
        reachedPackages.has(pkg),
        `no file from packages/${pkg}/src is reachable from the self-host ` +
          'entrypoint, so nothing in it is covered by the leakage check below',
      ).toBe(true);
    }
  });

  it('imports no Trigger.dev / billing / Mollie anywhere in its reachable graph', () => {
    expect(violations).toEqual([]);
  });
});
