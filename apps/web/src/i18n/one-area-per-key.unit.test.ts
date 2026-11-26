// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONE AREA PER KEY (the owner, 2026-10-11: the dictionary split by area).
 *
 * `strings.ts` was one file of 5,600 lines, its Dutch 3,000 lines below its
 * English and in another order, and half the pull requests edited it. It is
 * now composed from `strings/`, one file per area of the app, the Dutch under
 * the English in the same order. Two things the type system does not see are
 * pinned here:
 *
 * - **a key defined in two areas.** The composer spreads them, so the later
 *   one would silently win and the earlier one would be text nobody sees;
 * - **an area the composer does not read.** Its words would type-check where
 *   they are and reach no screen.
 *
 * And one reader's promise: in each area the Dutch keys come in the English
 * order, so the same key is at the same place in both tables.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { STRINGS } from './strings.ts';

const DIR = join(import.meta.dirname, 'strings');
const AREAS = readdirSync(DIR).filter((f) => f.endsWith('.ts'));
const areas = await Promise.all(
  AREAS.map(async (file) => ({
    file,
    words: (await import(`./strings/${file}`)) as { en: Record<string, string>; nl: Record<string, string> },
  })),
);

describe('the dictionary, by area', () => {
  it('has its areas', () => {
    expect(AREAS.length).toBeGreaterThan(10);
  });

  it('defines each key in one area', () => {
    const seen = new Map<string, string>();
    const twice: string[] = [];
    for (const { file, words } of areas) {
      for (const key of Object.keys(words.en)) {
        const before = seen.get(key);
        if (before) twice.push(`${key}: ${before} and ${file}`);
        seen.set(key, file);
      }
    }
    expect(twice).toEqual([]);
    expect(seen.size).toBe(Object.keys(STRINGS.en).length);
  });

  it('reads every area into the dictionary', () => {
    const composer = readFileSync(join(import.meta.dirname, 'strings.ts'), 'utf8');
    const read = AREAS.filter((file) => composer.includes(`from './strings/${file}'`));
    expect(read).toEqual(AREAS);
  });

  it('keeps each area’s Dutch in its English order', () => {
    for (const { file, words } of areas) {
      expect(Object.keys(words.nl), file).toEqual(Object.keys(words.en));
    }
  });
});
