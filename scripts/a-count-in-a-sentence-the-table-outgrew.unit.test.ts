// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A COUNT IN A SENTENCE IS A COPY OF THE TABLE, AND A COPY ROTS.
 *
 * Six pieces of expired guidance were found by hand on 2026-09-17, and the
 * sweep that found them turned up a seventh class nobody had named: prose that
 * states HOW MANY of something there are. `FAILURE_CATEGORIES` went from six to
 * eight that day, and four sentences went on saying six —
 *
 *   - a test named "documents the six failure categories the column can hold",
 *     whose own comment predicted that "adding a seventh category … fails
 *     here". A seventh was added. An eighth was added. It failed, the spec was
 *     updated, and the sentence promising it was never read;
 *   - a test named "the same six categories and five domains the code has",
 *     asserting correctly against the live array the whole time;
 *   - two comments in the dictionary introducing "the six failure categories",
 *     six lines above the eight of them.
 *
 * **Every one of those files had a working assertion against the real array.**
 * The tables never drifted; only the sentences about them did, and a sentence
 * that is wrong is read far more often than an array that is right — a test
 * name is what a person sees in CI output, and a comment is what they read
 * before changing the code under it.
 *
 * ## What this holds, and what it deliberately does not
 *
 * A number word or digit immediately before a NAMED collection, in the PLURAL —
 * "eight failure categories", "4 editor types" — must equal that collection's
 * live length. Plural-only because a total is plural and a singular is a
 * different sentence: "every fact about one provider account kind" says nothing
 * about how many kinds there are, and matching it would make the first thing
 * this guard did be to report a line that was right.
 * Nothing else. A count needs an unambiguous noun to be checkable: bare
 * "categories" is failure, decision or drift depending on the paragraph, and
 * "four domains" is usually somebody recounting the day the task domain was
 * added. Guessing at those would make this guard noisy, and a noisy guard gets
 * an allowance entry instead of a fix.
 *
 * So this is not a stale-prose detector and cannot become one. It closes ONE
 * mechanically-checkable shape, which is what the six found by hand had in
 * common with nothing except each other.
 *
 * `docs/workplans/` and `docs/adr/` are out of scope on purpose: both are dated
 * records of what was true on a day, and "Six categories classified at
 * `markFail`" under a row marked ✅ Done 2026-08-27 is history rather than a
 * claim about today.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  DECISION_CATEGORIES,
  FAILURE_CATEGORIES,
  FAILURE_SIDES,
  PROVIDER_ACCOUNT_KINDS,
} from '@openmig/shared';
import { NATIVE_EXPORT_TYPES } from '@openmig/connectors';

const ROOT = join(import.meta.dirname, '..');

const WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

/**
 * Each countable collection, with the phrase that names it unambiguously.
 *
 * The phrase must be one nobody writes about anything else. "failure
 * categories" qualifies; "categories" does not. Adding a row here is how a new
 * collection joins — there is no clever inference, on purpose.
 */
const COUNTED: ReadonlyArray<{
  readonly what: string;
  readonly phrase: RegExp;
  readonly actual: number;
}> = [
  {
    what: 'FAILURE_CATEGORIES',
    phrase: /\b(\w+)\s+failure\s+categories\b/gi,
    actual: FAILURE_CATEGORIES.length,
  },
  {
    what: 'DECISION_CATEGORIES',
    phrase: /\b(\w+)\s+decision\s+categories\b/gi,
    actual: DECISION_CATEGORIES.length,
  },
  {
    what: 'FAILURE_SIDES',
    phrase: /\b(\w+)\s+failure\s+sides\b/gi,
    actual: FAILURE_SIDES.length,
  },
  {
    what: 'PROVIDER_ACCOUNT_KINDS',
    phrase: /\b(\w+)\s+provider\s+account\s+kinds\b/gi,
    actual: PROVIDER_ACCOUNT_KINDS.length,
  },
  {
    what: 'NATIVE_EXPORT_TYPES (the export policies)',
    phrase: /\b(\w+)\s+export\s+policies\b/gi,
    actual: Object.keys(NATIVE_EXPORT_TYPES).length,
  },
  {
    what: 'the editor types every policy renders',
    phrase: /\b(\w+)\s+editor\s+(?:types|kinds)\b/gi,
    // Read off the render table rather than a literal: the whole point is that
    // a number in prose must not be the thing that is trusted.
    actual: Object.keys(NATIVE_EXPORT_TYPES['export-pdf']).length,
  },
];

/**
 * A line that may keep a number this guard would otherwise call wrong.
 *
 * `"<file>:<line text fragment>": "<why>"`. Keep this SHORT: a count that is
 * deliberately historical and outside the two dated directories is rare, and
 * the cheap fix is almost always to name the collection instead of counting it.
 */
const ALLOWED: Readonly<Record<string, string>> = {};

/** Every file this sweeps, from git so nothing untracked or ignored is read. */
function trackedFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
  return out
    .split('\0')
    .filter(Boolean)
    .filter((f) => /\.(ts|tsx|mjs|md)$/.test(f))
    .filter((f) => !f.startsWith('docs/workplans/') && !f.startsWith('docs/adr/'))
    .filter((f) => !f.includes('/dist/') && !f.includes('node_modules'))
    // This file quotes the wrong numbers on purpose, in the story above.
    .filter((f) => !f.endsWith('a-count-in-a-sentence-the-table-outgrew.unit.test.ts'));
}

interface Wrong {
  readonly file: string;
  readonly line: number;
  readonly said: number;
  readonly actual: number;
  readonly what: string;
  readonly text: string;
}

export function countsThatDisagree(files: readonly string[]): Wrong[] {
  const wrong: Wrong[] = [];
  for (const file of files) {
    const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
    lines.forEach((text, i) => {
      for (const { what, phrase, actual } of COUNTED) {
        // `lastIndex` survives between calls on a /g/ regex, so reset it: a
        // shared regex that silently skips half the file is exactly the kind of
        // guard that proves nothing.
        phrase.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = phrase.exec(text)) !== null) {
          const token = m[1]!.toLowerCase();
          const said = WORDS[token] ?? (/^\d+$/.test(token) ? Number(token) : undefined);
          if (said === undefined || said === actual) continue;
          const key = `${file}:${m[0]}`;
          if (ALLOWED[key]) continue;
          wrong.push({ file, line: i + 1, said, actual, what, text: text.trim() });
        }
      }
    });
  }
  return wrong;
}

describe('the counter itself', () => {
  it('reads a word and a digit, and only before a named collection', () => {
    // Proving the instrument before trusting its silence — a guard that matched
    // nothing would pass the suite below on an empty repository.
    const sample = COUNTED.find((c) => c.what === 'FAILURE_CATEGORIES')!;
    sample.phrase.lastIndex = 0;
    expect(sample.phrase.exec('the six failure categories')?.[1]).toBe('six');
    sample.phrase.lastIndex = 0;
    expect(sample.phrase.exec('all 6 failure categories')?.[1]).toBe('6');
    sample.phrase.lastIndex = 0;
    // A bare noun is NOT matched, which is what keeps this quiet enough to keep.
    expect(sample.phrase.exec('the six categories')).toBeNull();
    const kinds = COUNTED.find((c) => c.what === 'PROVIDER_ACCOUNT_KINDS')!;
    kinds.phrase.lastIndex = 0;
    // Nor is a singular: "one provider account kind" is not a total.
    expect(kinds.phrase.exec('about one provider account kind, in ONE answer')).toBeNull();
    kinds.phrase.lastIndex = 0;
    expect(kinds.phrase.exec('the four provider account kinds')?.[1]).toBe('four');
  });

  it('actually reads files, and every collection it names is non-empty', () => {
    expect(trackedFiles().length).toBeGreaterThan(200);
    for (const { what, actual } of COUNTED) expect(actual, what).toBeGreaterThan(1);
  });
});

describe('no sentence states a total its table has outgrown', () => {
  it('holds every tracked source and guide', () => {
    const wrong = countsThatDisagree(trackedFiles());
    expect(
      wrong.map((w) => `${w.file}:${w.line} says ${w.said}, ${w.what} has ${w.actual} — ${w.text}`),
    ).toEqual([]);
  });

  it('names only real files in the allowance, so a fixed line takes its excuse with it', () => {
    const tracked = new Set(trackedFiles());
    for (const key of Object.keys(ALLOWED)) {
      expect(tracked.has(key.split(':')[0]!), key).toBe(true);
    }
  });
});
