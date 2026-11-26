// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TAG READ BY A PATTERN THAT BACKTRACKS.
 *
 * The DAV readers pulled elements out of a server's reply with patterns of
 * the shape `<p:name[^>]*>([\s\S]*?)</p:name>`. On a reply that opens an
 * element many times and never closes it, or opens a tag and never ends it,
 * the engine starts at every opening and scans to the end of the reply for
 * the rest: time quadratic in the reply, a second at a few hundred kilobytes
 * and minutes at a few megabytes, and nothing caps the reply a server sends.
 * Workplan 0163 moved six of them to `elementsIn` (`packages/shared/src/xml-elements.ts`);
 * the rest, forty-odd in seven files, moved to `davElement` and the readers
 * beside it, which read a reply a tag at a time.
 *
 * So no source under `apps/` or `packages/`, tests aside, holds `[^>]*` or
 * `[^>]+` in a pattern or a string a pattern is built from: the shape that
 * reads the inside of a tag by scanning for its end.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/**
 * Files that hold the shape for a reason of their own, each with it. One today:
 * `remote-refusal.ts`, whose root-tag pattern another change of alpha.21
 * rewrites (it reads only the start of a reply, anchored with `^`); that change
 * owns the file, and this entry goes when it lands.
 */
export const HELD_ELSEWHERE: Readonly<Record<string, string>> = {
  'packages/shared/src/remote-refusal.ts': 'its root-tag pattern is rewritten by its own change in alpha.21',
};

const SHAPE = /\[\^>\][*+]/;

/** Each literal in a source that holds the shape: a pattern, a string or a template's text. */
export function tagsReadByBacktracking(source: string, fileName = 'x.ts'): Array<{ readonly line: number; readonly text: string }> {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found: Array<{ line: number; text: string }> = [];
  const kinds = new Set([
    ts.SyntaxKind.RegularExpressionLiteral,
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.TemplateHead,
    ts.SyntaxKind.TemplateMiddle,
    ts.SyntaxKind.TemplateTail,
  ]);
  const visit = (node: ts.Node): void => {
    if (kinds.has(node.kind) && SHAPE.test(node.getText(file))) {
      found.push({ line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, text: node.getText(file) });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function shipped(): string[] {
  return execFileSync('git', ['ls-files', '-z', '--', 'apps', 'packages'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((f) => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(f))
    .filter((f) => !/\.test\.[cm]?[jt]sx?$|\/testing\/|\/test-|-fake\.|\.d\.ts$/.test(f));
}

describe('a tag read by a pattern that backtracks', () => {
  it('knows the shape, in a pattern, a string and a template, and not in a comment', () => {
    expect(tagsReadByBacktracking("s.match(/<d:href[^>]*>([^<]+)<\\/d:href>/i);")).toHaveLength(1);
    expect(tagsReadByBacktracking("new RegExp('<' + name + '[^>]*>');")).toHaveLength(1);
    expect(tagsReadByBacktracking('new RegExp(`<(?:p:)?${name}(?:\\\\s[^>]*)?>`);')).toHaveLength(1);
    expect(tagsReadByBacktracking('// a comment naming `<p:name[^>]*>`\nconst x = 1;')).toEqual([]);
    expect(tagsReadByBacktracking("s.match(/<d:href>([^<]+)<\\/d:href>/i);")).toEqual([]);
  });

  it('is nowhere in the shipped code but where a reason holds it', () => {
    const files = shipped();
    expect(files.length).toBeGreaterThan(500);
    const found: string[] = [];
    for (const file of files) {
      if (file in HELD_ELSEWHERE) continue;
      for (const { line, text } of tagsReadByBacktracking(readFileSync(`${ROOT}${file}`, 'utf8'), file)) {
        found.push(`${file}:${line}: ${text.slice(0, 120)}`);
      }
    }
    expect(found, `read a tag at a time with davElement and the readers beside it (@openmig/shared xml-elements):\n${found.join('\n')}`).toEqual([]);
  });

  it('holds no file elsewhere that no longer needs it', () => {
    for (const [file, reason] of Object.entries(HELD_ELSEWHERE)) {
      expect(reason.length).toBeGreaterThan(20);
      expect(tagsReadByBacktracking(readFileSync(`${ROOT}${file}`, 'utf8'), file).length, `${file} no longer holds the shape: take it out of HELD_ELSEWHERE`).toBeGreaterThan(0);
    }
  });
});
