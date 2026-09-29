// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A VERSION THE TESTER ACCEPTED (workplan 0139 T3).
 *
 * When somebody creates their account, the app shows the Alpha conditions, the
 * privacy policy and the terms, each with its version number, and records which
 * version of each they accepted (terms §1, Alpha conditions §2, privacy §4.4).
 * The number the app asks for is a constant, `LEGAL_VERSIONS` in
 * `packages/managed/src/legal-versions.ts`, because nothing in `apps/` or
 * `packages/` may import `site/legal/` (its README). So two places say which
 * version is current: the text's own *Version* line, and the constant.
 *
 * If a text's number changes and the constant does not, the screen goes on
 * asking for the old number, the record says the tester accepted a version
 * they never read, and nobody is asked again, which is the one thing the
 * record exists to show. This guard fails until the two agree.
 *
 * ## How a draft line compares, and why a draft is asked for by nobody
 *
 * By its number: `**Version:** 1.2 (draft — not yet published)` is version
 * 1.2. The constant is the number alone, in the shape the table's CHECK holds
 * (`1`, `1.2`, `1.2.3`), and never carries the draft words. But the draft
 * words are not nothing (review of 2026-09-29). The owner's final-text pull
 * request drops them and keeps the number (the legal README, *What a final
 * Version line looks like*), and the text may change before then. A tester
 * who accepted draft 1.2 would be recorded as having accepted final 1.2, a
 * text they never read, and never be asked again. So `LEGAL_DRAFTS` says which
 * texts are drafts, this guard holds it to the *Version* lines as the site
 * build reads them (`DRAFT_WORDS`), and while any text is a draft the API asks
 * nobody and records nothing (`acceptanceAsked` in
 * `apps/api/src/conditions-not-accepted.ts`).
 *
 * ## The words a tester accepted, pinned to their number
 *
 * Once no text is a draft, the app asks, and from the first acceptance on a
 * text that changes must get a new number, or the record says somebody
 * accepted words they never saw. The owner's rule for the Alpha conditions
 * says the same (alpha-version-number (a): *"every change after that gets a
 * new number"*). So every final text is pinned: `ACCEPTED_WORDS` holds a
 * digest of its words under its number, outside the HTML comments (the
 * lawyer's briefings may change freely) and with runs of white space counted
 * as one. A final text whose words change under the same number fails here.
 * The pin is changed without a new number only while nobody can have accepted
 * that number: while some text in `LEGAL_DRAFTS` is still a draft, since the
 * API then asks nobody. Otherwise give the text a new number, change
 * `LEGAL_VERSIONS`, and pin the new words under the new number.
 *
 * ## What it reads
 *
 * Each document's English and Dutch file, through the site build's own
 * `versionLineOf` (outside HTML comments, where the lawyer's briefings quote
 * old lines on purpose), in a child process because the build refuses to load
 * without `OWNPACE_APP_URL`. And the build's `SOURCE`, so every accepted text
 * is a page the site writes, under the key the app links it by
 * (`apps/web/src/services/legal-links.ts`).
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEGAL = join(REPO_ROOT, 'site', 'legal');

/** Each accepted document's files, English first. The Dutch one is read too. */
const FILES = {
  alpha: ['alpha.md', 'alpha.nl.md'],
  privacy: ['privacy.md', 'privacy.nl.md'],
  terms: ['terms.md', 'terms.nl.md'],
} as const;

/**
 * The words of each final text, as a tester accepts them under its number: a
 * sha256 of the file outside its HTML comments, white space collapsed
 * (`wordsOf`). A draft needs none. Changed without a new number only while
 * some text is still a draft (the header says why).
 */
const ACCEPTED_WORDS: Readonly<Record<string, string>> = {
  'alpha.md@1.0': '63c2f0b986aa6bf7fbe9d8539d558207c41d71332d1c9e49fe63a25263acac2a',
  'alpha.nl.md@1.0': 'b909d25866d56b23b2e09a2efb821d5d73dab9c9bc261773f5dde04caeddea52',
};

/** The digest `ACCEPTED_WORDS` pins: the text outside HTML comments, white space collapsed. */
function wordsOf(file: string): string {
  const text = readFileSync(join(LEGAL, file), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha256').update(text).digest('hex');
}

/** The number on a version line: the first word after `**Version:**` / `**Versie:**`. */
const numberOf = (line: string | null | undefined): string | undefined =>
  /^\*\*[^*]+:\*\*\s*(\S+)/.exec(line ?? '')?.[1];

interface Read {
  readonly lines: Record<string, string | null> | null;
  /** Whether each file's version line holds the site build's `DRAFT_WORDS`. */
  readonly drafts: Record<string, boolean> | null;
  readonly sources: Record<string, Record<string, string>> | null;
}

let cached: Read | null = null;
/** The version lines and `SOURCE`, as `site/build.mjs` reads them, in a child process. */
function read(): Read {
  if (cached) return cached;
  const build = pathToFileURL(join(REPO_ROOT, 'site', 'build.mjs')).href;
  const files = Object.values(FILES).flat();
  const out = execFileSync(
    'node',
    [
      '-e',
      `Promise.all([import(${JSON.stringify(build)}), import('node:fs'), import('node:path')])
         .then(([m, fs, path]) => process.stdout.write(JSON.stringify({
           lines: typeof m.versionLineOf !== 'function' ? null : Object.fromEntries(
             ${JSON.stringify(files)}.map((f) => [f,
               m.versionLineOf(fs.readFileSync(path.join(${JSON.stringify(LEGAL)}, f), 'utf8')) ?? null])),
           drafts: !(m.DRAFT_WORDS instanceof RegExp) || typeof m.versionLineOf !== 'function' ? null : Object.fromEntries(
             ${JSON.stringify(files)}.map((f) => [f,
               m.DRAFT_WORDS.test(m.versionLineOf(fs.readFileSync(path.join(${JSON.stringify(LEGAL)}, f), 'utf8')) ?? '')])),
           sources: m.SOURCE ?? null,
         })))
         .catch((e) => { process.stderr.write(String(e && e.message)); process.exit(1); });`,
    ],
    {
      env: { ...process.env, OWNPACE_APP_URL: 'https://app.ota.ownpace.eu' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'] as const,
    },
  );
  cached = JSON.parse(out) as Read;
  return cached;
}

/** Loaded inside the tests, so a missing module fails each case by name. */
const loadVersions = () => import('../packages/managed/src/legal-versions.ts');

describe('the versions the app asks a tester to accept', () => {
  it('names the three texts a tester accepts, and no other', async () => {
    const { LEGAL_DOCUMENTS, LEGAL_VERSIONS } = await loadVersions();
    expect([...LEGAL_DOCUMENTS].sort()).toEqual(Object.keys(FILES).sort());
    expect(Object.keys(LEGAL_VERSIONS).sort()).toEqual(Object.keys(FILES).sort());
  });

  it('holds each as a bare number, never a draft word', async () => {
    const { LEGAL_VERSIONS, VERSION_SHAPE } = await loadVersions();
    for (const [document, version] of Object.entries(LEGAL_VERSIONS)) {
      expect(version, `${document}'s constant`).toMatch(/^[0-9]+(\.[0-9]+)*$/);
      expect(VERSION_SHAPE.test(version), `${document}'s constant, by the module's own shape`).toBe(true);
    }
  });

  it('reads a version line in every file, so the comparison below compares something', () => {
    const { lines } = read();
    expect(lines, 'site/build.mjs no longer exports versionLineOf').not.toBeNull();
    for (const file of Object.values(FILES).flat()) {
      expect(numberOf(lines?.[file]), `site/legal/${file} has no **Version:** / **Versie:** line`).toBeTruthy();
    }
  });

  it.each(Object.entries(FILES).flatMap(([document, files]) => files.map((file) => [document, file] as const)))(
    '%s: the constant is the number on site/legal/%s',
    async (document, file) => {
      const { LEGAL_VERSIONS } = await loadVersions();
      const line = read().lines?.[file];
      expect(
        LEGAL_VERSIONS[document as keyof typeof LEGAL_VERSIONS],
        `site/legal/${file} says "${line}", and LEGAL_VERSIONS.${document} in ` +
          'packages/managed/src/legal-versions.ts says otherwise. A text with a new number is a text ' +
          'every tester is asked to accept again: change the constant in the same commit.',
      ).toBe(numberOf(line));
    },
  );

  it.each(Object.entries(FILES).flatMap(([document, files]) => files.map((file) => [document, file] as const)))(
    '%s: the constant says it is a draft exactly when site/legal/%s says so',
    async (document, file) => {
      const { LEGAL_DRAFTS } = await loadVersions();
      const { drafts, lines } = read();
      expect(drafts, 'site/build.mjs no longer exports DRAFT_WORDS').not.toBeNull();
      expect(
        LEGAL_DRAFTS?.[document as keyof typeof LEGAL_DRAFTS],
        `site/legal/${file} says "${lines?.[file]}", and LEGAL_DRAFTS.${document} in ` +
          'packages/managed/src/legal-versions.ts says otherwise. While a text is a draft nobody is asked to ' +
          'accept it, because its number is the one the final text will carry: change the constant in the ' +
          'same commit as the Version line.',
      ).toBe(drafts?.[file]);
    },
  );

  it('while any text is a draft, the API asks nobody: the rule reads the drafts, not only the stage', async () => {
    const { LEGAL_DOCUMENTS, draftTexts } = await loadVersions();
    expect(typeof draftTexts, 'legal-versions.ts no longer exports draftTexts').toBe('function');
    const none = Object.fromEntries(LEGAL_DOCUMENTS.map((d) => [d, false])) as Record<(typeof LEGAL_DOCUMENTS)[number], boolean>;
    expect(draftTexts(none)).toEqual([]);
    expect(draftTexts({ ...none, terms: true })).toEqual(['terms']);
  });

  it.each(Object.values(FILES).flat())(
    'site/legal/%s, once final, keeps the words a tester accepted under its number',
    (file) => {
      const line = read().lines?.[file];
      const draft = read().drafts?.[file];
      expect(draft, 'the draft reading above failed').not.toBeUndefined();
      if (draft) return; // A draft is accepted by nobody, so its words may change under its number.
      const key = `${file}@${numberOf(line)}`;
      expect(
        ACCEPTED_WORDS[key],
        `site/legal/${file} is final ("${line}") and ACCEPTED_WORDS pins no words for ${key}. Pin ` +
          `'${wordsOf(file)}' under that key, in the commit that drops the draft words.`,
      ).toBeDefined();
      expect(
        wordsOf(file),
        `site/legal/${file} changed under ${numberOf(line)}. A tester who accepted ${numberOf(line)} accepted ` +
          'the words pinned in ACCEPTED_WORDS, and would be recorded as having accepted these. Give the text a ' +
          'new number (both languages, and LEGAL_VERSIONS), and pin the new words under it. Change the pin ' +
          'under the same number only while some text in LEGAL_DRAFTS is still a draft: the API then asks ' +
          'nobody, so nobody has accepted it.',
      ).toBe(ACCEPTED_WORDS[key]);
    },
  );

  it('every accepted text is a page the site build renders, from that file, in both languages', () => {
    const { sources } = read();
    expect(sources, 'site/build.mjs no longer exports SOURCE').not.toBeNull();
    for (const [document, [en, nl]] of Object.entries(FILES)) {
      expect(sources?.en?.[document], `the site renders no English "${document}" page`).toBe(`legal/${en}`);
      expect(sources?.nl?.[document], `the site renders no Dutch "${document}" page`).toBe(`legal/${nl}`);
    }
  });
});
