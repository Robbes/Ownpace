// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CLASS TAILWIND DRAWS NOTHING FOR.
 *
 * The phone menu's backdrop was `bg-gray-600 bg-opacity-75`: Tailwind v3's way
 * of saying "grey at 75%". This app builds with Tailwind v4 (`index.css` is
 * `@import "tailwindcss"`, and no v3 config is loaded), which dropped the
 * `*-opacity-N` utilities for the `/N` modifier and emits no rule for them at
 * all. No warning either. So the backdrop was solid grey, and in the source a
 * class that compiles to nothing looks exactly like one that works.
 *
 * This finds every such class the screens use and compiles each with the
 * Tailwind this app installs; one that yields no rule is reported by file and
 * line. The compiler decides, not a list typed out here, so a Tailwind that
 * brought the utility back would clear the report by itself. The scanner and
 * the compile check are pinned against snippets first, so a green tree cannot
 * be a scanner that matches nothing or a check that calls everything empty.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { compile } from 'tailwindcss';

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

/** The v3 opacity utilities, with any variants in front (`hover:bg-opacity-50`). */
const V3_OPACITY = /(?<![\w-])(?:[a-z-]+:)*(?:bg|text|border|divide|ring|placeholder)-opacity-\d+\b/g;

/** Each v3 opacity class in `text`, with where it is. */
export function opacityClasses(text: string, file = 'snippet'): { cls: string; at: string }[] {
  const found: { cls: string; at: string }[] = [];
  for (const m of text.matchAll(V3_OPACITY)) {
    const line = text.slice(0, m.index).split('\n').length;
    found.push({ cls: m[0], at: `${file}:${line}` });
  }
  return found;
}

let build: (candidates: string[]) => string;

beforeAll(async () => {
  // Read from disk, not imported with `?raw`: vitest stubs every .css import to
  // an empty string, and an empty stylesheet has no theme, so every colour
  // class would look like it draws nothing.
  const indexCss = createRequire(import.meta.url).resolve('tailwindcss/index.css');
  const content = readFileSync(indexCss, 'utf8');
  const compiler = await compile('@import "tailwindcss";', {
    loadStylesheet: async () => ({ path: indexCss, base: dirname(indexCss), content }),
  });
  build = compiler.build;
});

/** True when the installed Tailwind emits no rule for `cls`. */
function drawsNothing(cls: string): boolean {
  // `build` accumulates candidates across calls, so ask for this class's own
  // selector rather than whether the output grew.
  const selector = '.' + cls.replace(/[:/.[\]]/g, (c) => `\\${c}`);
  return !build([cls]).includes(selector);
}

describe('the scanner and the compile check, before they are trusted over the tree', () => {
  it('finds a v3 opacity class, variants included, and leaves `opacity-50` alone', () => {
    expect(
      opacityClasses(
        'const a = 1;\n<div className="bg-gray-600 bg-opacity-75 hover:text-opacity-50 disabled:opacity-50" />',
        'page.tsx',
      ),
    ).toEqual([
      { cls: 'bg-opacity-75', at: 'page.tsx:2' },
      { cls: 'hover:text-opacity-50', at: 'page.tsx:2' },
    ]);
  });

  it('calls the v3 class empty and its v4 spelling drawn', () => {
    expect(drawsNothing('bg-opacity-75')).toBe(true);
    expect(drawsNothing('bg-gray-600/75')).toBe(false);
    expect(drawsNothing('hover:bg-gray-600')).toBe(false);
  });
});

describe('every screen and component', () => {
  it('uses no opacity class Tailwind draws nothing for', () => {
    const offenders = screens(SRC)
      .flatMap((file) => opacityClasses(readFileSync(file, 'utf8'), relative(SRC, file)))
      .filter(({ cls }) => drawsNothing(cls))
      .map(({ cls, at }) => `${at} ${cls}`);
    expect(
      offenders,
      'Tailwind v4 emits no rule for these; write the opacity as a modifier (bg-gray-600/75)',
    ).toEqual([]);
  });
});
