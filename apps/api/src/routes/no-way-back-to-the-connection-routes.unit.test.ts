// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * NO IMPORT FROM THE CONNECTION ROUTES LEADS BACK TO THEM (workplan 0006 §N,
 * CQ-06). `connections.ts` imports `migrations/index.ts` for its shape
 * builders; that mounts `migrations/cirrux-oauth-routes.ts`, and the Cirrux
 * Drive consent there reached back into `connections.ts` with a lazy
 * `await import('../connections.ts')` for `requalifyStoredConnection`, lazy
 * only because of the cycle. The family moved to `qualify-and-remember.ts`,
 * which reaches neither, and both now import it statically.
 *
 * This walks the relative imports reachable from `connections.ts`, static and
 * dynamic, within `apps/api/src`, and fails on any path that comes back to it.
 * One claim and no more: it is not a survey of the other cycles in the tree.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(SRC, 'routes', 'connections.ts');

/**
 * Every relative specifier a file imports: `import … from`, `export … from`,
 * a bare `import '…'` and `import('…')` with a literal. Comments are blanked
 * first, so a specifier quoted in prose (as the header above does) is not an
 * import. Type-only imports count: a cycle through one is still the shape.
 */
function relativeImports(text: string): string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
  const found: string[] = [];
  const patterns = [
    /\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/g,
    /\bimport\s*['"](\.{1,2}\/[^'"]+)['"]/g,
    /\bimport\s*\(\s*['"`](\.{1,2}\/[^'"`]+)['"`]\s*\)/g,
  ];
  for (const pattern of patterns) for (const m of code.matchAll(pattern)) found.push(m[1]!);
  return found;
}

/** A path from `connections.ts` back to itself, or null. Depth-first, each file once. */
function pathBack(): string[] | null {
  const seen = new Set<string>();
  const walk = (file: string, trail: string[]): string[] | null => {
    for (const spec of relativeImports(readFileSync(file, 'utf8'))) {
      const next = resolve(dirname(file), spec);
      if (!next.startsWith(SRC + '/') || !existsSync(next)) continue;
      if (next === ROOT) return [...trail, next];
      if (seen.has(next)) continue;
      seen.add(next);
      const found = walk(next, [...trail, next]);
      if (found) return found;
    }
    return null;
  };
  return walk(ROOT, [ROOT]);
}

describe('the connection routes import nothing that imports them back', () => {
  it('reads every shape of relative import, and none in a comment', () => {
    const text = [
      "import { a } from './a.ts';",
      "import type { B } from '../b.ts';",
      "export { c } from './c.ts';",
      "import './d.ts';",
      "const { e } = await import('../e.ts');",
      "// const { f } = await import('./f.ts');",
      "/* import { g } from './g.ts'; */",
      "import { h } from '@openmig/shared';",
    ].join('\n');
    expect(relativeImports(text).sort()).toEqual(['../b.ts', '../e.ts', './a.ts', './c.ts', './d.ts']);
  });

  it('reaches the Cirrux consent, so the walk covers the file the cycle went through', () => {
    // If the walk stopped short of the consent, the next test would pass for nothing.
    const seen = new Set<string>();
    const stack = [ROOT];
    while (stack.length) {
      const file = stack.pop()!;
      for (const spec of relativeImports(readFileSync(file, 'utf8'))) {
        const next = resolve(dirname(file), spec);
        if (!next.startsWith(SRC + '/') || !existsSync(next) || seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    expect(seen.has(join(SRC, 'routes', 'migrations', 'cirrux-oauth-routes.ts'))).toBe(true);
    expect(seen.has(join(SRC, 'routes', 'qualify-and-remember.ts'))).toBe(true);
  });

  it('no import path from connections.ts leads back to it', () => {
    const back = pathBack();
    expect(back?.map((f) => relative(SRC, f)).join(' -> ') ?? null).toBeNull();
  });
});
