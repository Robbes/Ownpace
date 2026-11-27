// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A run of characters at either end of a text, read in one pass.
 *
 * `text.replace(/\/+$/, '')` reads plainly and is quadratic: on a long run of
 * the character that is not at the end, the engine tries the run from each of
 * its starts, and every try walks the rest of it. These answer what the
 * patterns answer (`runs-at-the-ends.unit.test.ts` compares them on random
 * texts), in time that grows with the text.
 * `scripts/a-run-at-the-end-read-by-backtracking.unit.test.ts` holds the
 * shipped code to them.
 *
 * `chars` is the characters of the run, as a string (`'/'`, `' \t'`), or a
 * test of one character, for a class such as `\s`.
 */

export type RunOf = string | ((char: string) => boolean);

const testOf = (chars: RunOf): ((char: string) => boolean) =>
  typeof chars === 'string' ? (char) => chars.includes(char) : chars;

/** `text` without the run of `chars` at its end: `replace(/X+$/, '')`. */
export function withoutTrailing(text: string, chars: RunOf): string {
  const inRun = testOf(chars);
  let end = text.length;
  while (end > 0 && inRun(text[end - 1]!)) end--;
  return end === text.length ? text : text.slice(0, end);
}

/** `text` without the run of `chars` at its start: `replace(/^X+/, '')`. */
export function withoutLeading(text: string, chars: RunOf): string {
  const inRun = testOf(chars);
  let start = 0;
  while (start < text.length && inRun(text[start]!)) start++;
  return start === 0 ? text : text.slice(start);
}

/** `text` without the runs of `chars` at both ends: `replace(/^X+|X+$/g, '')`. */
export function withoutEither(text: string, chars: RunOf): string {
  return withoutLeading(withoutTrailing(text, chars), chars);
}

/** The characters at which a multiline `$` matches: before each of them, and at the end. */
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;

/** Every line of `text` without its trailing run of `chars`: `replace(/X+$/gm, '')`. */
export function withoutTrailingOnEachLine(text: string, chars: RunOf): string {
  let out = '';
  let line = '';
  for (const char of text) {
    if (LINE_TERMINATOR.test(char)) {
      out += withoutTrailing(line, chars) + char;
      line = '';
    } else {
      line += char;
    }
  }
  return out + withoutTrailing(line, chars);
}
