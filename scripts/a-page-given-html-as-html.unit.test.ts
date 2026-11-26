// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PAGE GIVEN HTML AS HTML: nothing in `apps/`, `packages/` or `site/` puts
 * text into a page as markup, outside a named list (workplan 0178 §5.1, G1;
 * the owner's D2 of 2026-11-26).
 *
 * WHY. React escapes what it renders, the site's build escapes what it writes
 * (`site/build.mjs`), and the API's few pages put their values in through a
 * JSON encoder under a hash-based CSP (`apps/api/src/routes/migrations/google-consent.ts`).
 * Each of those holds only while nobody reaches past it. `dangerouslySetInnerHTML`,
 * an assignment to `innerHTML` or `outerHTML`, `insertAdjacentHTML`,
 * `createContextualFragment` and `document.write` are the five ways past, and on
 * 2026-11-26 the shipped code used none of them. Semgrep's `react-href-var` and
 * `unknown-value-with-script-tag` report other shapes of the same class and
 * block nothing (`.github/workflows/semgrep.yml`); a count of zero kept by
 * nobody is a count that rises unseen.
 *
 * THE RULE. Every tracked `.ts`, `.tsx`, `.mjs` and `.js` file under those three
 * folders is parsed (`scripts/sast-guard-source.ts`, so a comment or a string
 * that only names one is not a spot), test files included: a test that builds
 * a page from markup is listed with its reason too, so the list is the whole
 * truth. A spot in a file not in PLACES, or more spots in a file than PLACES
 * gives it, fails; so does an entry with fewer spots than it says, so the list
 * shrinks when the code does. There is no inline way to excuse a line.
 */

import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rawHtmlSpots, readSource, trackedSources } from './sast-guard-source.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The files allowed a spot, how many, and why. Nothing that ships is here. */
const PLACES: Record<string, { spots: number; reason: string }> = {
  'apps/api/src/routes/migrations/a-progress-link-you-can-copy.unit.test.ts': {
    spots: 1,
    reason: 'A test: it loads the page the route rendered into a DOM to click the copy button. The markup is the route’s own answer.',
  },
  'apps/web/src/pages/a-bill-nobody-will-send.unit.test.tsx': {
    spots: 1,
    reason: 'A test: it puts the static markup React rendered for an icon into a holder, to read the icon’s SVG.',
  },
};

function spotsOnTheTree(): Map<string, Array<{ line: number; text: string }>> {
  const found = new Map<string, Array<{ line: number; text: string }>>();
  for (const file of trackedSources(ROOT, ['apps', 'packages', 'site'], /\.(ts|tsx|mjs|js)$/)) {
    const spots = rawHtmlSpots(file, readSource(ROOT, file));
    if (spots.length > 0) found.set(file, spots);
  }
  return found;
}

describe('a page given HTML as HTML (0178 G1)', () => {
  it('refuses each way past the escaping, and nothing that only names one', () => {
    const bad = [
      'export const A = ({ h }: { h: string }) => <div dangerouslySetInnerHTML={{ __html: h }} />;',
      'el.innerHTML = name;',
      'el.innerHTML += name;',
      "el['outerHTML'] = name;",
      "el.insertAdjacentHTML('beforeend', name);",
      'document.createRange().createContextualFragment(name);',
      'document.write(name);',
      'document.writeln(name);',
    ];
    for (const source of bad) expect(rawHtmlSpots('fixture.tsx', source), source).toHaveLength(1);
    const fine = [
      '// el.innerHTML = name; is what we never do',
      "const s = 'dangerouslySetInnerHTML';",
      'const t = el.innerHTML;',
      'el.textContent = name;',
      'log.write(name);',
      'export const B = ({ h }: { h: string }) => <div title={h}>{h}</div>;',
    ];
    for (const source of fine) expect(rawHtmlSpots('fixture.tsx', source), source).toHaveLength(0);
  });

  it('finds HTML put in as HTML only where PLACES says, as often as it says', () => {
    const found = spotsOnTheTree();
    const problems: string[] = [];
    for (const [file, spots] of found) {
      const place = PLACES[file];
      if (!place) problems.push(...spots.map((s) => `${file}:${s.line}: ${s.text} (not in PLACES: render it as text, or name the file with a reason)`));
      else if (spots.length !== place.spots) problems.push(`${file}: ${spots.length} spots, PLACES says ${place.spots}`);
    }
    for (const file of Object.keys(PLACES)) if (!found.has(file)) problems.push(`${file}: in PLACES, and has no spot any more: take it out`);
    expect(problems).toEqual([]);
  });

  it('allows nothing that ships', () => {
    for (const file of Object.keys(PLACES)) expect(file, file).toMatch(/\.unit\.test\.tsx?$/);
  });
});
