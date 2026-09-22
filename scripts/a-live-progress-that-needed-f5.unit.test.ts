// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A LIVE PROGRESS THAT NEEDED F5.
 *
 * Live 2026-09-22, on a running Google migration, under a heading that says
 * "Live progress":
 *
 *     Calendar  [Syncing]  439 synced   last active 1 minute ago
 *
 * and it stayed 439 until the owner reloaded the page.
 *
 * ONE COMPONENT, TWO DATA SOURCES, AND ONLY ONE OF THEM ASKED AGAIN. The strip
 * reads `status` on selfhost and `detail` on managed — the file says so, and
 * says why: both are `DomainStatusReport` rows from the same shared builder,
 * "so the strip cannot mean different things per edition". That promise was
 * kept. The one nobody wrote down was not: `status` carried a
 * `refetchInterval` and `detail` carried none at all, so the managed half
 * rendered whatever the first fetch returned, forever.
 *
 * WHY IT SURVIVED. A strip that is live on the edition you develop against
 * looks finished. Nothing is missing on screen, no request fails, no number is
 * wrong — it is simply the number from a minute ago, and a minute ago is
 * indistinguishable from now until you watch it for two.
 *
 * SO THE RULE IS DERIVED FROM THE PAGE, NOT FROM A LIST OF TWO. This reads
 * which identifiers `progressDomains` actually pulls its rows from and demands
 * an interval from each. Add a third edition tomorrow, or re-point the strip
 * at a different query, and this covers it without anybody remembering to come
 * back here — which is the whole difference between this guard and the comment
 * that was already in the file.
 *
 * WHAT IT DOES NOT CHECK: the RATE. That is `progressRefetchInterval`'s own
 * business and is tested where it lives, beside the component. This guard
 * holds the thing that was actually missing — that there is a rate at all.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 'apps/web/src/pages/MappingDetail.tsx';
const SOURCE = readFileSync(join(REPO_ROOT, PAGE), 'utf8');

/**
 * The query identifiers `progressDomains` reads its rows out of — `status`,
 * `detail`, and whatever a later edition adds beside them.
 */
export function progressSources(source: string): ReadonlyArray<string> {
  const assignment = /const\s+progressDomains\s*=([\s\S]{0,600}?);\n/.exec(source);
  if (!assignment) {
    throw new Error(
      `${PAGE}: no \`progressDomains\` assignment. Renamed? This guard reads the page to find ` +
        'the strip\'s sources; it must be pointed at the new name rather than left passing.',
    );
  }
  return [...new Set([...assignment[1]!.matchAll(/\b([A-Za-z_$][\w$]*)\.data\b/g)].map((m) => m[1]!))];
}

/** The `useQuery({ … })` options object assigned to `name`, brace-matched. */
export function useQueryBody(source: string, name: string): string {
  const open = new RegExp(`const\\s+${name}\\s*=\\s*useQuery\\s*\\(\\s*\\{`).exec(source);
  if (!open) throw new Error(`${PAGE}: \`${name}\` is not assigned from useQuery({ … })`);
  let i = open.index + open[0].length;
  let depth = 1;
  while (i < source.length && depth > 0) {
    const c = source[i++]!;
    if (c === '{') depth++;
    else if (c === '}') depth--;
  }
  if (depth !== 0) throw new Error(`${PAGE}: no closing brace for \`${name}\`'s useQuery options`);
  return source.slice(open.index, i);
}

describe('a live progress that needed F5', () => {
  it('reads the strip\'s sources off the page, and finds more than one', () => {
    // If this ever collapses to one, the two-source shape this guard exists
    // for is gone and the guard should be re-read, not trusted.
    const sources = progressSources(SOURCE);
    expect(sources.length, `expected the strip to read from several queries, got ${sources}`)
      .toBeGreaterThan(1);
  });

  it('demands a refresh interval from every one of them', () => {
    for (const name of progressSources(SOURCE)) {
      expect(
        useQueryBody(SOURCE, name),
        `\`${name}\` feeds the panel headed "Live progress" but has no refetchInterval, so its ` +
          'half of the strip shows the first answer until the page is reloaded.',
      ).toMatch(/refetchInterval/);
    }
  });

  it('recognises a source without an interval, so the rule is not vacuous', () => {
    // Without this, a brace-matcher that returned the whole file would pass
    // the test above by accident and protect nothing.
    const doctored = SOURCE.replace(/refetchInterval/g, 'refetchNever');
    const failures = progressSources(doctored).filter(
      (n) => !/refetchInterval/.test(useQueryBody(doctored, n)),
    );
    expect(failures.length).toBe(progressSources(SOURCE).length);
  });

  it('brace-matches one query rather than swallowing the next', () => {
    const [first] = progressSources(SOURCE);
    const body = useQueryBody(SOURCE, first!);
    expect(body).toContain('useQuery');
    // One options object, not everything to the end of the component.
    expect(body.length).toBeLessThan(900);
  });
});
