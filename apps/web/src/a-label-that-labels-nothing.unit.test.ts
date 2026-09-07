// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A LABEL THAT LABELS NOTHING IS AN UNLABELLED BOX TO A SCREEN READER
 * (workplan 0067 T7 (a), built 2026-09-05).
 *
 * The wizard's first review found ~30 inputs whose `<label>` sat beside them
 * as a sibling with no `htmlFor`: a sighted person reads the label next to
 * the box, a screen reader reads "edit text, blank". The tests found fields
 * the sighted way too, so nothing caught it. Since then most fields render
 * from the credential descriptor with an id, and most pages wrap the control
 * in its label — which associates it without any attribute — but six sites
 * still sat beside their control, and nothing would have stopped a seventh.
 *
 * This reads every screen and component as text and asks one question of
 * every `<label>`: does it label something? Yes if its opening tag carries
 * `htmlFor`, or if a control (`input`, `select`, `textarea`) sits INSIDE it.
 * Anything else is reported by file and line, so the fix is a one-line walk.
 *
 * Read as source, deliberately: rendering every screen with every fixture it
 * needs is how such a guard gets written for three pages and never a fourth.
 * The scanner is itself pinned against three snippets first, so a green tree
 * cannot be a scanner that matches nothing.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = dirname(fileURLToPath(import.meta.url));

/** Every .tsx under src that is not a test. */
function screens(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) screens(path, out);
    else if (name.endsWith('.tsx') && !name.includes('.test.')) out.push(path);
  }
  return out;
}

/** The index just past the opening tag's `>`, skipping the `=>` of inline arrows. */
function endOfOpeningTag(text: string, from: number): number {
  let i = from;
  while (i < text.length) {
    const at = text.indexOf('>', i);
    if (at === -1) return -1;
    if (text[at - 1] !== '=') return at + 1;
    i = at + 1;
  }
  return -1;
}

/** `file:line` of every `<label>` that neither points at a control nor holds one. */
export function labelsThatLabelNothing(text: string, file = 'snippet'): string[] {
  const found: string[] = [];
  const opener = /<label\b/g;
  let m: RegExpExecArray | null;
  while ((m = opener.exec(text)) !== null) {
    const tagEnd = endOfOpeningTag(text, m.index);
    const close = text.indexOf('</label>', tagEnd);
    if (tagEnd === -1 || close === -1) continue;
    const openingTag = text.slice(m.index, tagEnd);
    const body = text.slice(tagEnd, close);
    const labelled = /\bhtmlFor=/.test(openingTag) || /<(input|select|textarea)\b/.test(body);
    if (!labelled) {
      const line = text.slice(0, m.index).split('\n').length;
      found.push(`${file}:${line}`);
    }
  }
  return found;
}

describe('the scanner itself, before it is trusted over the tree', () => {
  it('passes a label that wraps its control, and one that points at it', () => {
    expect(labelsThatLabelNothing('<label>Name <input type="text" /></label>')).toEqual([]);
    expect(
      labelsThatLabelNothing('<label htmlFor={id}>Name</label>\n<input id={id} />'),
    ).toEqual([]);
    // An inline arrow in the opening tag must not end it early.
    expect(
      labelsThatLabelNothing(
        '<label onClick={() => open()} htmlFor="x">Name</label>\n<input id="x" />',
      ),
    ).toEqual([]);
  });

  it('reports a label that sits beside its control with nothing joining them', () => {
    expect(
      labelsThatLabelNothing(
        'const x = 1;\n<label className="a">Name</label>\n<input type="text" />',
        'page.tsx',
      ),
    ).toEqual(['page.tsx:2']);
  });
});

describe('every screen and component', () => {
  it('has no label that labels nothing', () => {
    const offenders = screens(SRC).flatMap((file) =>
      labelsThatLabelNothing(readFileSync(file, 'utf8'), relative(SRC, file)),
    );
    expect(offenders, 'give each of these an htmlFor/id pair, or wrap the control').toEqual([]);
  });
});
