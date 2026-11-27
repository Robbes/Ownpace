// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE SITE SAYS WHAT A PERSON'S PAGE SAYS (workplan 0176 T15, with step A).
 *
 * A member reads the tester guide before they send a family member a link,
 * and the family member then reads the link page. Where the two say different
 * things, the person on the phone between them is told two stories. So:
 *
 * 1. **No sentence the plan took out comes back.** The guide said Google's
 *    warning *is expected during the Alpha* (*Dat hoort zo*), where the link
 *    page says why Google warns and that it is right to (R2). The Google help
 *    guide said *not to sit beside them while they sign in*, where the link
 *    page invites the person to do the Google step together, on the phone or
 *    at the table. The site's sentence under *What you will do* promised *a
 *    page only they see*, which the link page does not claim: it says who
 *    sees what.
 * 2. **The guide has a part for a family member's link**, under *How to
 *    start* / *Zo begint u*, with its own id in each language, and its six
 *    sections stay six.
 * 3. **The sentences the link page takes from the guide are the same
 *    sentence in both places** (D12 (a), §15 *Google 2* and *Google 3*), in
 *    each language: the dictionary's `grant.person.see.warning`,
 *    `grant.person.see.goOn` and `grant.person.see.ticks`. As
 *    `the-alpha-said-to-a-visitor.unit.test.ts` holds the visitor's line, the
 *    site imports nothing, so its words are a copy held here.
 * 4. **The Dutch guide says *familielid*, never *gezinslid*** (the owner,
 *    2026-11-26: *"Use familielid (gezinslid is to limited to one
 *    household)"*), as the home page's block for families does: step A's
 *    part, whose id follows (`familielid-link`), and the guide's two older
 *    sentences on the list of test users too. The legal texts are not step
 *    A's, and keep their word until their own next version (`GLOSSARY.md`).
 * 5. **The guide names acquaintances once** (0176 D19; the owner,
 *    2026-11-26: *"familie en kennissen, with a focus on family"*): one
 *    sentence in a family member's part, with the glossary's phrase
 *    *familie en kennissen* / *family and acquaintances*, and the word
 *    nowhere else in the guide. Family comes first: *familielid* stays the
 *    part's word (point 4).
 *
 * The guides wrap their lines, so whitespace is made single before
 * comparing; each guide's header comment quotes the sentences too, so
 * comments are taken out before anything is looked for.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STRINGS } from '../apps/web/src/i18n/strings.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): string => readFileSync(join(REPO_ROOT, p), 'utf8');

type Locale = 'en' | 'nl';

/** Markdown as a reader meets it: no HTML comments, one space between words. */
const prose = (markdown: string): string => markdown.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\s+/g, ' ');

/** JavaScript as a reader meets its strings: no comments, one space between words. */
const code = (js: string): string =>
  js
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
    .replace(/\s+/g, ' ');

const GUIDE: Readonly<Record<Locale, string>> = {
  en: 'site/pages/en/alpha-guide.md',
  nl: 'site/pages/nl/alpha-handleiding.md',
};
const GOOGLE_HELP: Readonly<Record<Locale, string>> = {
  en: 'docs/guides/en/google.md',
  nl: 'docs/guides/nl/google.md',
};

/** What the plan took out (T15 points 1, 5 and 6), per file, in its language. */
const GONE: ReadonlyArray<readonly [file: string, phrase: string]> = [
  [GUIDE.nl, 'Dat hoort zo'],
  [GUIDE.en, 'That is expected'],
  [GOOGLE_HELP.nl, 'ernaast te zitten'],
  [GOOGLE_HELP.en, 'sit beside them'],
  ['site/copy.mjs', 'a page only they see'],
  ['site/copy.mjs', 'een pagina die alleen die persoon ziet'],
];

describe('the site says nothing the link page took back (0176 T15, points 1, 5, 6)', () => {
  it.each(GONE)('%s does not say “%s”', (file, phrase) => {
    const text = file.endsWith('.mjs') ? code(read(file)) : prose(read(file));
    expect(text.toLowerCase()).not.toContain(phrase.toLowerCase());
  });
});

describe('the tester guide has a part for a family member’s link (T15 point 2)', () => {
  const PART: Readonly<Record<Locale, { readonly under: string; readonly id: string }>> = {
    en: { under: '## How to start {#how-to-start}', id: '{#family-link}' },
    nl: { under: '## Zo begint u {#zo-begint-u}', id: '{#familielid-link}' },
  };

  it.each(['en', 'nl'] as const)('%s: under How to start, with its own id, and six sections still', (locale) => {
    const text = prose(read(GUIDE[locale]));
    const under = text.indexOf(PART[locale].under);
    const part = text.indexOf(PART[locale].id);
    expect(under, 'the section it stands under').toBeGreaterThanOrEqual(0);
    expect(part, 'its own id').toBeGreaterThan(under);
    // Under it: before the next section of the guide.
    const next = text.indexOf(' ## ', under + PART[locale].under.length);
    expect(next === -1 || part < next).toBe(true);
    expect(read(GUIDE[locale]).match(/^## /gm)).toHaveLength(6);
  });
});

describe('the Dutch guide says familielid, never gezinslid (the owner, 2026-11-26; point 4)', () => {
  const text = prose(read(GUIDE.nl));
  const start = text.indexOf('### Als een familielid een link krijgt {#familielid-link}');
  const part = start === -1 ? '' : text.slice(start, text.indexOf(' ### ', start + 1));

  it('step A’s part: its heading, and its sentences', () => {
    expect(start, 'the part, under its heading').toBeGreaterThanOrEqual(0);
    expect(part).toContain('Is het account van een familielid?');
    expect(part).toContain('Daar kan uw familielid het ook stoppen.');
  });

  it('the sentence step A gave Als Google opnieuw vraagt, and the two older ones', () => {
    expect(text).toContain('Is het het account van een familielid?');
    expect(text, 'under Voordat u begint').toContain('ook dat van een familielid.');
    expect(text, 'under Wat wij wissen').toContain('Uw Google-adres, en dat van een familielid, halen wij');
  });

  it('and nowhere in the guide gezinslid', () => {
    expect(text.toLowerCase()).not.toContain('gezinslid');
  });
});

describe('the guide names acquaintances once, in a family member’s part (0176 D19; point 5)', () => {
  const D19: Readonly<Record<Locale, { readonly heading: string; readonly sentence: string; readonly word: RegExp }>> = {
    en: {
      heading: '### When a family member gets a link {#family-link}',
      sentence: 'This is how it works for family and acquaintances you help.',
      word: /\bacquaintances?\b/gi,
    },
    nl: {
      heading: '### Als een familielid een link krijgt {#familielid-link}',
      sentence: 'Zo werkt het voor familie en kennissen die u helpt.',
      word: /\bkennis(sen)?\b/gi,
    },
  };

  it.each(['en', 'nl'] as const)('%s: the part says it, and the guide names acquaintances nowhere else', (locale) => {
    const text = prose(read(GUIDE[locale]));
    const start = text.indexOf(D19[locale].heading);
    expect(start, 'the part, under its heading').toBeGreaterThanOrEqual(0);
    const part = text.slice(start, text.indexOf(' ### ', start + 1));
    expect(part).toContain(D19[locale].sentence);
    expect(text.match(D19[locale].word) ?? [], 'acquaintances, named once').toHaveLength(1);
  });
});

describe('a sentence the link page takes from the guide is one sentence in both places (T15 point 4, D12 (a))', () => {
  const KEYS = ['grant.person.see.warning', 'grant.person.see.goOn', 'grant.person.see.ticks'] as const;

  for (const locale of ['en', 'nl'] as const) {
    it.each(KEYS)(`${locale}: the guide says %s word for word`, (key) => {
      const sentence = (STRINGS[locale] as Record<string, string>)[key];
      expect(sentence, `${locale} has no ${key}`).toBeTruthy();
      expect(prose(read(GUIDE[locale]))).toContain(sentence!.replace(/\s+/g, ' '));
    });
  }
});
