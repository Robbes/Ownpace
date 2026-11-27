// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A run of characters at either end of a text, read in one pass.
 *
 * `withoutTrailing`, `withoutLeading` and `withoutEither` answer exactly what
 * `replace(/X+$/, '')`, `replace(/^X+/, '')` and `replace(/^X+|X+$/g, '')`
 * answer, for a single character or a class of them, and in time that grows
 * with the text: a pattern ending `X+$` tries every start in a long run of X
 * that is not at the end, which is quadratic in the run.
 */

import { describe, it, expect } from 'vitest';
import { withoutEither, withoutLeading, withoutTrailing, withoutTrailingOnEachLine } from './runs-at-the-ends.ts';

/** A random text over a small alphabet, so runs of the characters tested are common. */
function randomText(alphabet: string, length: number, seed: { n: number }): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    seed.n = (seed.n * 1103515245 + 12345) % 2147483648;
    out += alphabet[seed.n % alphabet.length];
  }
  return out;
}

const ms = (f: () => unknown): number => {
  const start = performance.now();
  f();
  return performance.now() - start;
};

describe('the same answers as the patterns they replace', () => {
  const seed = { n: 7 };
  const cases: Array<[string, string, RegExp, RegExp, RegExp]> = [
    ['/', 'a/b ', /\/+$/, /^\/+/, /^\/+|\/+$/g],
    ['=', 'a=b', /=+$/, /^=+/, /^=+|=+$/g],
    ['-', 'a-b', /-+$/, /^-+/, /^-+|-+$/g],
  ];
  for (const [chars, alphabet, trailing, leading, either] of cases) {
    it(`for ${JSON.stringify(chars)}, over 20,000 random texts`, () => {
      for (let i = 0; i < 20_000; i++) {
        const text = randomText(alphabet, i % 17, seed);
        expect(withoutTrailing(text, chars), JSON.stringify(text)).toBe(text.replace(trailing, ''));
        expect(withoutLeading(text, chars), JSON.stringify(text)).toBe(text.replace(leading, ''));
        expect(withoutEither(text, chars), JSON.stringify(text)).toBe(text.replace(either, ''));
      }
    });
  }

  it('for a class given as a test, `[\\s:—-]` included', () => {
    const cls = (c: string) => /[\s:—-]/.test(c);
    for (let i = 0; i < 20_000; i++) {
      const text = randomText('a \t\n:—- ', i % 17, seed);
      expect(withoutTrailing(text, cls), JSON.stringify(text)).toBe(text.replace(/[\s:—-]+$/, ''));
    }
  });
});

describe('on each line, as a multiline pattern reads it', () => {
  it('answers what replace(/[ \\t]+$/gm) answers, every line terminator included', () => {
    const seed = { n: 11 };
    for (let i = 0; i < 20_000; i++) {
      const text = randomText('a \t\n\r\u2028\u2029', i % 19, seed);
      expect(withoutTrailingOnEachLine(text, ' \t'), JSON.stringify(text)).toBe(text.replace(/[ \t]+$/gm, ''));
    }
  });
});

describe('in time that grows with the text', () => {
  // 50,000 characters: the patterns take about a second here, quadratic in
  // the run; these take well under a millisecond.
  const run = 50_000;
  it('a long run of the character that is not at the end', () => {
    expect(ms(() => withoutTrailing(`${'/'.repeat(run)}a`, '/'))).toBeLessThan(50);
    expect(ms(() => withoutEither(`a${'/'.repeat(run)}a`, '/'))).toBeLessThan(50);
    expect(ms(() => withoutTrailing(`x${' '.repeat(run)}x`, (c) => /\s/.test(c)))).toBeLessThan(50);
    expect(ms(() => withoutTrailingOnEachLine(`x${' '.repeat(run)}x\n`, ' \t'))).toBeLessThan(50);
  });
});
