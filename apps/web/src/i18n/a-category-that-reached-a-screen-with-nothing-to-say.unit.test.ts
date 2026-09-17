// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A CATEGORY THAT REACHED A SCREEN WITH NOTHING TO SAY (2026-09-17).
 *
 * Three maps translate a `FailureCategory` into a sentence, for three readers:
 * the customer and the operator they phone share `FAILURE_KEY`, and the person
 * holding a progress link gets `VIEW_FAILURE_KEY`. Each is
 * `Record<FailureCategory, StringKey>`, so the COMPILER catches a category
 * with no key — that half has always worked, and it fired on both maps the
 * moment `source_refused` and `format_refused` were added.
 *
 * What the compiler cannot catch is a key with no STRING behind it, or one in
 * `en` and not `nl`. `FAILURE_KEY` had a test for that in
 * `LiveProgress.unit.test.tsx` — which hand-copied the map as a literal of six,
 * so it was checking the six it happened to know about rather than the ones the
 * product has. `VIEW_FAILURE_KEY` had no such test at all.
 *
 * Both are covered here, off the maps themselves, so a ninth category cannot
 * reach any of the three screens as a blank or as English on a Dutch page.
 */
import { describe, it, expect } from 'vitest';
import { FAILURE_CATEGORIES, FAILURE_SIDES } from '@openmig/shared';
import { STRINGS, LOCALES } from './strings.ts';
import { FAILURE_KEY, FAILURE_SIDE_KEY } from './failure-key.ts';
import { VIEW_FAILURE_KEY, VIEW_SIDE_KEY } from './view-failure-key.ts';

/**
 * The sentence a locale has for a key, or a failure naming what is missing.
 *
 * Both lookups are dynamic — the whole job here is to walk maps rather than
 * name their members — so both come back `string | undefined`. Throwing with
 * the key in the message beats a `!`: the assertion that follows would say
 * "expected undefined to be truthy" and leave somebody grepping for which of
 * eight categories it was.
 */
function sentenceFor(locale: (typeof LOCALES)[number], stringKey: string, where: string): string {
  const sentence = (STRINGS[locale] as Record<string, string | undefined>)[stringKey];
  if (sentence === undefined) throw new Error(`${where} has no ${locale} string for "${stringKey}"`);
  return sentence;
}

/** The key a map holds for one of its members, or a failure naming the hole. */
function keyFor(map: Readonly<Record<string, string>>, member: string, where: string): string {
  const stringKey = (map as Record<string, string | undefined>)[member];
  if (stringKey === undefined) throw new Error(`${where} has no key for ${member}`);
  return stringKey;
}

const MAPS = [
  { name: 'FAILURE_KEY', map: FAILURE_KEY, keys: FAILURE_CATEGORIES },
  { name: 'VIEW_FAILURE_KEY', map: VIEW_FAILURE_KEY, keys: FAILURE_CATEGORIES },
  { name: 'FAILURE_SIDE_KEY', map: FAILURE_SIDE_KEY, keys: FAILURE_SIDES },
  { name: 'VIEW_SIDE_KEY', map: VIEW_SIDE_KEY, keys: FAILURE_SIDES },
] as const;

describe('every category has something to say, on every screen, in every language', () => {
  it.each(MAPS)('$name answers for all of them', ({ name, map, keys }) => {
    for (const key of keys) {
      const stringKey = keyFor(map, key, name);
      for (const locale of LOCALES) {
        const sentence = sentenceFor(locale, stringKey, `${name}.${key}`);
        expect(sentence.trim().length, `${name}.${key} is blank in ${locale}`).toBeGreaterThan(0);
      }
    }
  });

  it('never leaves a Dutch screen reading the English sentence', () => {
    // The failure this catches is a key added to `en` and pasted unchanged
    // into `nl`, which is the quiet half of a missed translation: the page
    // renders, nothing is blank, and a Dutch reader gets English.
    for (const { name, map, keys } of MAPS) {
      for (const key of keys) {
        const stringKey = keyFor(map, key, name);
        const en = sentenceFor('en', stringKey, `${name}.${key}`);
        const nl = sentenceFor('nl', stringKey, `${name}.${key}`);
        expect(nl, `${name}.${key} is the English sentence in nl`).not.toBe(en);
      }
    }
  });

  it('never shows the customer a raw category token instead of a sentence', () => {
    for (const category of FAILURE_CATEGORIES) {
      for (const locale of LOCALES) {
        for (const map of [FAILURE_KEY, VIEW_FAILURE_KEY]) {
          const sentence = sentenceFor(locale, keyFor(map, category, 'a map'), category);
          expect(sentence).not.toBe(category);
          expect(sentence, `${category} in ${locale} leaks its token`).not.toContain(category);
        }
      }
    }
  });
});

describe('the two refusals say different things, which is the whole point', () => {
  it('the source remedy does not send anybody to check the destination', () => {
    // The defect this category exists for: a Drive refusal read as
    // `target_refused` told a customer to go and audit an account that had
    // never seen the file.
    for (const locale of LOCALES) {
      const source = sentenceFor(locale, FAILURE_KEY.source_refused, 'source_refused');
      const target = sentenceFor(locale, FAILURE_KEY.target_refused, 'target_refused');
      expect(source).not.toBe(target);
      expect(source.toLowerCase(), `the ${locale} source remedy still blames a full mailbox`).not.toMatch(
        locale === 'nl' ? /volle mailbox/ : /full mailbox/,
      );
    }
  });

  it('the format remedy is about the file, not about the account', () => {
    for (const locale of LOCALES) {
      const format = sentenceFor(locale, FAILURE_KEY.format_refused, 'format_refused');
      const target = sentenceFor(locale, FAILURE_KEY.target_refused, 'target_refused');
      expect(format).not.toBe(target);
      expect(format.toLowerCase()).toMatch(locale === 'nl' ? /indeling|naam/ : /format|name/);
    }
  });

  it('a remedy is a sentence, not a label — on the two screens that can act', () => {
    // The product is the remedy. `view.*` is deliberately shorter (that reader
    // cannot act), so the length floor applies to `FAILURE_KEY` only.
    for (const category of FAILURE_CATEGORIES) {
      for (const locale of LOCALES) {
        const sentence = sentenceFor(locale, FAILURE_KEY[category], category);
        expect(
          sentence.length,
          `${category} in ${locale} is too short to be a remedy`,
        ).toBeGreaterThan(30);
      }
    }
  });
});
