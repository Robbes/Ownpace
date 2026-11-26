// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A RUN AT THE END OF A TEXT, READ BY A PATTERN THAT BACKTRACKS.
 *
 * `text.replace(/\/+$/, '')` reads plainly, and it is quadratic: on a long
 * run of slashes that is not at the end of the text, the engine tries the run
 * from every one of its starts, and each try walks the rest of it. A path or
 * a reply of 100,000 characters took three seconds. The same shape is
 * `/=+$/`, `/^\/+|\/+$/g` and a class, `/[\s:—-]+$/`. The code read paths,
 * base64 and messages this way in fifteen places, some of them handed over by
 * a remote server or a request.
 *
 * `withoutTrailing`, `withoutLeading` and `withoutEither` in
 * `@openmig/shared` read such a run in one pass, with the same answers. So
 * this holds the shipped code to them: no source under `apps/` or
 * `packages/`, tests aside, removes a run at an end of a text with a pattern
 * that ends in `+$`.
 *
 * A pattern that only TESTS a text (`/\/$/.test(…)`, one character) is not
 * this shape, nor is one that matches a run anchored at the start alone
 * (`/^\/+/`), which the engine tries from one place only.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/**
 * Whether a pattern's last alternative is a bare run at the end: one atom, a
 * character, an escape or a class, then `+$`, with no `^` and nothing before
 * it. `/^[a-z]+$/` is tried from one place, and `/\.[^.]+$/` from each dot over
 * its own segment, so neither is this.
 */
export function endsInABareRun(body: string): boolean {
  let depth = 0;
  let inClass = false;
  let last = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') inClass = true;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === '|' && depth === 0) last = i + 1;
  }
  return /^(?:\\.|\[(?:[^\]\\]|\\.)*\]|[^\\^$|()[\]*+?{}.])\+\$$/.test(body.slice(last));
}

/** Each regular expression literal in a source that has the shape, with its line. */
export function trailingRuns(source: string, fileName = 'x.ts'): Array<{ readonly line: number; readonly pattern: string }> {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found: Array<{ line: number; pattern: string }> = [];
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      const text = node.getText(file);
      const body = text.slice(1, text.lastIndexOf('/'));
      if (endsInABareRun(body)) found.push({ line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, pattern: text });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** Shipped sources: TypeScript and JavaScript under apps/ and packages/, tests and test helpers aside. */
function shipped(): string[] {
  const files = execFileSync('git', ['ls-files', '-z', '--', 'apps', 'packages'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((f) => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(f));
  return files.filter((f) => !/\.test\.[cm]?[jt]sx?$|\/testing\/|\/test-|-fake\.|\.d\.ts$/.test(f));
}

describe('a run at the end of a text, read by a pattern that backtracks', () => {
  it('knows the shape, and nothing else', () => {
    for (const bad of ["s.replace(/\\/+$/, '')", "s.replace(/=+$/, '')", "s.replace(/^\\/+|\\/+$/g, '')", "s.replace(/[\\s:—-]+$/, '')", "s.replace(/-+$/g, '')"]) {
      expect(trailingRuns(bad), bad).toHaveLength(1);
    }
    expect(trailingRuns("const base = (env ?? `${proto}://${host}`).replace(/\\/+$/, '');")).toHaveLength(1);
    for (const fine of ["/\\/$/.test(s)", "s.replace(/^\\/+/, '')", "s.replace(/\\/$/, '')", "/^[a-z]+$/.test(s)", "/^[A-Za-z0-9+/]+$/.test(s)", "s.replace(/\\.[^.]+$/, '')", "a / b + c / d", "s.split('/') // x+$/"]) {
      expect(trailingRuns(fine), fine).toEqual([]);
    }
  });

  it('is nowhere in the shipped code', () => {
    const files = shipped();
    expect(files.length).toBeGreaterThan(500);
    const found: string[] = [];
    for (const file of files) {
      for (const { line, pattern } of trailingRuns(readFileSync(`${ROOT}${file}`, 'utf8'), file)) found.push(`${file}:${line}: ${pattern}`);
    }
    expect(found, `read with withoutTrailing / withoutLeading / withoutEither from @openmig/shared:\n${found.join('\n')}`).toEqual([]);
  });
});
