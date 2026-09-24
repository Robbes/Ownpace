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
 *
 * A RING COLOUR WITH NO RING WIDTH DRAWS NOTHING EITHER. The request-access,
 * report-a-problem, support-log and sign-in fields said `focus:outline-none
 * focus:ring-blue-500` and meant "a blue ring instead of the outline". But
 * `ring-blue-500` only sets `--tw-ring-color`; the box-shadow that draws a
 * ring comes from a width (`ring-2`), which none of them had. So focus showed
 * only as the 1px border turning blue. The compiler is asked for that premise
 * too, and every class list that takes the focus outline away and names a ring
 * colour must name a ring width for the same variant. A list built as
 * `'a ' + 'b'` is read as one, because that is how the screens write fields.
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

/** A ring colour for `variant` (`focus:ring-blue-500`), not `ring-offset-2` or a width. */
const ringColour = (variant: string) =>
  new RegExp(`(?<![\\w-])${variant}:ring-(?!offset-|inset)(?:[a-z]+-\\d{2,3}|white|black|current|transparent|\\[[^\\]]+\\])(?:/\\d+)?(?![\\w-])`);
/** A ring width for `variant`: `focus:ring`, `focus:ring-2`, `focus:ring-[3px]`. */
const ringWidth = (variant: string) =>
  new RegExp(`(?<![\\w-])${variant}:ring(?:-\\d+|-\\[\\d[^\\]]*\\])?(?![\\w-])`);
const FOCUS_VARIANTS = ['focus', 'focus-visible', 'focus-within'];

/** The quoted string around `at`, joined across `'a ' + 'b'` on either side. */
function classListAround(text: string, at: number): string {
  let start = at;
  while (start > 0 && !`'"\``.includes(text.charAt(start - 1))) start--;
  start--;
  let end = text.indexOf(text.charAt(start), at);
  for (;;) {
    const joined = /(['"`])\s*\+\s*$/.exec(text.slice(Math.max(0, start - 200), start));
    if (!joined) break;
    start = text.lastIndexOf(joined[1]!, start - joined[0].length - 1);
  }
  for (;;) {
    const joined = /^\s*\+\s*(['"`])/.exec(text.slice(end + 1, end + 201));
    if (!joined) break;
    end = text.indexOf(joined[1]!, end + joined[0].length + 1);
  }
  return text.slice(start, end + 1);
}

/** `file:line` of each class list that drops the focus outline for a ring with no width. */
export function ringsWithNoWidth(text: string, file = 'snippet'): string[] {
  const found: string[] = [];
  for (const variant of FOCUS_VARIANTS) {
    for (const m of text.matchAll(new RegExp(ringColour(variant), 'g'))) {
      const list = classListAround(text, m.index);
      if (!new RegExp(`(?<![\\w-])${variant}:outline-none(?![\\w-])`).test(list)) continue;
      if (ringWidth(variant).test(list)) continue;
      found.push(`${file}:${text.slice(0, m.index).split('\n').length} ${m[0]}`);
    }
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

/** The declarations the installed Tailwind emits for `cls`, as text. */
function ruleFor(cls: string): string {
  const selector = '.' + cls.replace(/[:/.[\]]/g, (c) => `\\${c}`);
  const css = build([cls]);
  const at = css.indexOf(selector);
  return at === -1 ? '' : css.slice(at, css.indexOf('}', at));
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

  it('draws a ring from a width and only colours it from a colour', () => {
    expect(ruleFor('focus:ring-blue-500')).toContain('--tw-ring-color');
    expect(ruleFor('focus:ring-blue-500')).not.toContain('box-shadow');
    expect(ruleFor('focus:ring-2')).toContain('box-shadow');
  });

  it('reports a dropped outline with a ring colour and no width, across a joined string', () => {
    expect(
      ringsWithNoWidth(
        [
          "const field =",
          "  'block w-full border ' +",
          "  'focus:outline-none focus:ring-blue-500 focus:border-blue-500';",
          '<input className="focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500" />',
          '<input type="checkbox" className="text-blue-600 focus:ring-blue-500" />',
          '<a className="focus-visible:outline-none focus-visible:ring-white" />',
        ].join('\n'),
        'page.tsx',
      ),
    ).toEqual(['page.tsx:3 focus:ring-blue-500', 'page.tsx:6 focus-visible:ring-white']);
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

  it('draws a ring wherever it takes the focus outline away for one', () => {
    const offenders = screens(SRC).flatMap((file) =>
      ringsWithNoWidth(readFileSync(file, 'utf8'), relative(SRC, file)),
    );
    expect(
      offenders,
      'a ring colour draws nothing without a ring width; add focus:ring-2 next to it',
    ).toEqual([]);
  });
});
