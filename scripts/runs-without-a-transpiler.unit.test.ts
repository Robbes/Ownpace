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
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Source trees whose files are loaded by Node at runtime. */
const RUNTIME_TREES = ['packages', 'apps'];

const HAS_EXTENSION = /\.(ts|tsx|js|jsx|mjs|cjs|json|css|svg|png|jpg|wasm)$/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'dist-selfhost') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
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
 * Read off the AST rather than matched with a regex. The first version of this
 * used `/(?:import|export)[\s\S]*?from\s*['"](\.[^'"]*)['"]/`, whose lazy
 * `[\s\S]*?` happily spans lines — so a prose comment containing the word
 * "from" between two quoted fragments parsed as an import of `'. The source now
 * lists it under '`. One false positive is enough to teach the lesson: the
 * thing being checked is syntax, so ask the parser.
 */
function relativeSpecifiers(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const take = (node: ts.Node | undefined) => {
    if (node && ts.isStringLiteral(node) && node.text.startsWith('.')) out.push(node.text);
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) take(node.moduleSpecifier);
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      take(node.arguments[0]);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      take(node.argument.literal);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe('the runtime needs no transpiler', () => {
  const files = everySourceFile();

  it('finds the source to check', () => {
    // Guards the guard: a scan over nothing passes silently.
    expect(files.length).toBeGreaterThan(400);
  });

  it('gives every relative import an explicit file extension', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const spec of relativeSpecifiers(file, readFileSync(file, 'utf8'))) {
        if (!HAS_EXTENSION.test(spec)) {
          offenders.push(`${file.slice(ROOT.length + 1)} -> '${spec}'`);
        }
      }
    }
    expect(offenders, `Node cannot resolve these; add the extension (usually '.ts' or '/index.ts')`).toEqual([]);
  });

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
