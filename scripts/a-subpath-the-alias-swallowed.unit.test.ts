// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A BARE ALIAS SWALLOWS ITS OWN SUBPATHS.
 *
 * `vitest.aliases.ts` maps every `@openmig/*` package to its source, and its
 * own header states the rule: a bare `'@openmig/core'` entry is a PREFIX match,
 * so `'@openmig/core/archive-reader'` becomes
 * `<root>/packages/core/src/index.ts/archive-reader` unless the subpath has a
 * pin of its own, listed BEFORE the bare entry. The header also says why the
 * pins exist at all: without one, whether a subpath resolves depends on the
 * runtime's fallback resolver, which differs between Node versions.
 *
 * The rule held for the four subpaths that existed when it was written and
 * for nothing added since. `@openmig/core/archive-reader` was declared in
 * 0116 and imported by the connectors' takeout reader; under vitest 4 on
 * Node 24 the fallback resolver quietly found it, so CI stayed green. On
 * 2026-09-06 a vitest 5 trial on Node 22 lost the fallback and every test
 * that loads the connectors index died at collection:
 *
 *     Error: Cannot find package '@openmig/core/archive-reader'
 *       imported from packages/connectors/src/takeout-archive-reader.ts
 *
 * Thirteen more declared subpaths — the connectors' DAV and Graph sources,
 * the engines' DAV writers — had no pin either. Nothing imports them across
 * a package boundary yet, which is the only reason they were not the same
 * failure. They are pinned now, and this reads `packages/<pkg>/package.json`
 * so that the next `exports` entry cannot arrive without its pin, a pin
 * cannot point at a file the export does not, and a removed export takes
 * its pin with it. `vitest.config.ts` and every per-app config import the
 * same map, so one file is the whole surface.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aliases } from '../vitest.aliases.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Insertion order is the match order Vite uses — the first prefix that fits wins. */
const ORDER: string[] = Object.keys(aliases);
const bare = ORDER.filter((k) => k.split('/').length === 2);
const pinned = ORDER.filter((k) => k.split('/').length > 2);

type Exports = Record<string, string>;
const exportsOf = (pkg: string): Exports => {
  const raw = readFileSync(join(REPO, 'packages', pkg, 'package.json'), 'utf-8');
  const parsed = JSON.parse(raw) as { exports?: Exports };
  return parsed.exports ?? {};
};

/** Every declared, non-wildcard subpath export of every package with a bare alias. */
const declared = bare.flatMap((b) => {
  const pkg = b.slice('@openmig/'.length);
  return Object.entries(exportsOf(pkg))
    .filter(([k]) => k !== '.' && !k.includes('*'))
    .map(([k, v]) => ({
      specifier: `${b}${k.slice(1)}`,
      bare: b,
      file: resolve(REPO, 'packages', pkg, v),
    }));
});

describe('the alias map cannot check nothing', () => {
  it('has bare entries and declared subpaths to hold to the rule', () => {
    expect(bare.length).toBeGreaterThanOrEqual(3);
    expect(declared.length).toBeGreaterThanOrEqual(5);
  });
});

describe('every subpath a bare alias could swallow', () => {
  it.each(declared)('$specifier has a pin', ({ specifier }) => {
    expect(
      ORDER,
      `${specifier} is exported but not pinned — the bare alias will prefix-match it to .../index.ts/...`,
    ).toContain(specifier);
  });

  it.each(declared)('$specifier is pinned before its bare entry', ({ specifier, bare: b }) => {
    const at = ORDER.indexOf(specifier);
    if (at === -1) return; // reported by the case above
    expect(at, `${specifier} sits after ${b}, which will match first`).toBeLessThan(ORDER.indexOf(b));
  });

  it.each(declared)('$specifier is pinned to the file its export names', ({ specifier, file }) => {
    const pin = aliases[specifier as keyof typeof aliases] as string | undefined;
    if (pin === undefined) return; // reported above
    expect(resolve(pin)).toBe(file);
    expect(existsSync(pin), `${pin} does not exist`).toBe(true);
  });
});

describe('no pin outlives its export', () => {
  it.each(pinned)('%s is still declared by its package', (specifier) => {
    expect(
      declared.map((d) => d.specifier),
      `${specifier} is pinned but its package no longer exports it`,
    ).toContain(specifier);
  });
});
