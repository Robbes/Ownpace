// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The API image runs `node apps/api/src/index.ts`. No transpiler.
 *
 * Node does not compile TypeScript — it ERASES it, one file at a time, without
 * resolving a single symbol. Three source-level invariants make that work, and
 * all three are the kind that a normal-looking edit breaks:
 *
 *   1. every relative import carries its file extension — Node's resolver does
 *      not guess, so `./routes/tenants/index` is simply not a module;
 *   2. `erasableSyntaxOnly` — nothing that needs EMITTING rather than deleting
 *      (parameter properties, enums, namespaces);
 *   3. `verbatimModuleSyntax` — every type-only import marked as such, because
 *      an eraser cannot infer which names are types.
 *
 * 2 and 3 are compiler options, so `pnpm typecheck` already fails on them and
 * this file only pins them in place. **1 is not checked by anything else**, and
 * that is why this test exists: tsc resolves `./x` to `./x.ts` happily, so a
 * missing extension type-checks clean, lints clean, passes every test — vitest
 * and Vite both guess too — and then fails at container start with
 * ERR_MODULE_NOT_FOUND. The gap between "the whole suite is green" and "the
 * image boots" is exactly this scan.
 *
 * Deliberately a parse-and-scan and not a resolver: it has to be fast enough to
 * live in the unit tier (~80ms over 450+ files), and a failure should name the
 * file and the specifier so the fix is obvious.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Source trees whose files are loaded by Node at runtime. */
const RUNTIME_TREES = ['packages', 'apps'];

const HAS_EXTENSION = /\.(ts|tsx|js|jsx|mjs|cjs|json|css|svg|png|jpg|wasm)$/;

/**
 * Every file under the runtime trees, and the .ts/.tsx subset of them.
 *
 * Both come out of ONE walk. The alternative — `existsSync` per specifier —
 * is a syscall per import, and with ~1100 of them it is most of this test's
 * cost. A Set membership test is not.
 */
const allFiles = new Set<string>();

function sourceFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-selfhost') {
      continue;
    }
    const p = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(p, out);
    else {
      allFiles.add(p);
      if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
    }
  }
  return out;
}

function everySourceFile(): string[] {
  const out: string[] = [];
  for (const tree of RUNTIME_TREES) {
    const base = join(ROOT, tree);
    if (!existsSync(base)) continue;
    for (const pkg of readdirSync(base)) sourceFiles(join(base, pkg, 'src'), out);
  }
  return out;
}

/**
 * Relative module specifiers, from `import`, `export … from` and `import()`.
 *
 * `preProcessFile` is the scanner tsserver uses for exactly this: it finds
 * module references without building an AST. It replaced `createSourceFile`
 * here because parsing 450+ files put this test at 2.1s locally and over
 * vitest's default 5s budget on a loaded CI runner.
 *
 * It replaced a REGEX before that, and the regex is the more instructive
 * failure: `/(?:import|export)[\s\S]*?from\s*['"](\.[^'"]*)['"]/` has a lazy
 * `[\s\S]*?` that spans lines, so a prose comment containing the word "from"
 * between two quoted fragments parsed as an import of `'. The source now lists
 * it under '`. The thing being checked is syntax — ask a scanner, not a
 * pattern.
 */
function relativeSpecifiers(text: string): string[] {
  const info = ts.preProcessFile(text, /* readImportFiles */ true, /* detectJavaScriptImports */ true);
  return info.importedFiles.map((f) => f.fileName).filter((n) => n.startsWith('.'));
}

describe('the runtime needs no transpiler', () => {
  const files = everySourceFile();

  it('finds the source to check', () => {
    // Guards the guard: a scan over nothing passes silently.
    expect(files.length).toBeGreaterThan(400);
  });

  it('gives every relative import an extension that names a file on disk', () => {
    // Two failures, one check, because they are the same failure: Node opens
    // the path it is given and nothing else.
    //
    //   './routes/index'      -> no extension at all
    //   './seed-membership.js' -> an extension pointing at a file that is .ts
    //
    // The second is the one an "add the extension" rule misses, and there were
    // 25 of them — the TypeScript convention of writing `.js` for a `.ts`
    // file, which every bundler rewrites and Node does not. Resolving the
    // target catches both without needing to know which mistake was made.
    const offenders: string[] = [];
    for (const file of files) {
      for (const spec of relativeSpecifiers(readFileSync(file, 'utf8'))) {
        if (!HAS_EXTENSION.test(spec)) {
          offenders.push(`${file.slice(ROOT.length + 1)} -> '${spec}' (no extension)`);
        } else if (!allFiles.has(resolve(dirname(file), spec))) {
          offenders.push(`${file.slice(ROOT.length + 1)} -> '${spec}' (no such file)`);
        }
      }
    }
    expect(offenders, 'Node resolves these literally; point them at the real file').toEqual([]);
    // The `unit` project declares no testTimeout, and an inline vitest project
    // does NOT inherit the root's — the same gap `integration` and `e2e` call
    // out in vitest.config.ts. So this whole-repo scan gets vitest's built-in
    // 5s unless it says otherwise, and it once did not.
  }, 60_000);

  it('keeps the two compiler options the eraser depends on', () => {
    const base = readFileSync(join(ROOT, 'tsconfig.base.json'), 'utf8');
    expect(base).toMatch(/"erasableSyntaxOnly":\s*true/);
    expect(base).toMatch(/"verbatimModuleSyntax":\s*true/);
  });

  it('starts the api image with node, not a transpiler', () => {
    const dockerfile = readFileSync(join(ROOT, 'apps/api/Dockerfile'), 'utf8');
    const cmd = dockerfile.split('\n').filter((l) => l.startsWith('CMD ')).at(-1);
    expect(cmd).toBeDefined();
    expect(cmd).toContain('node');
    expect(cmd).not.toContain('tsx');
  });
});
