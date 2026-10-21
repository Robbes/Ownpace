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
 * `LEGAL_VERSIONS`, and pin the new words under the new number. The one other
 * case is the owner's word, before the first tester, that nobody has accepted
 * any version: then the text stays 1.0 and is edited in place, as
 * alpha-version-number (a) says (the owner, 2026-10-14 and 2026-10-21; the
 * comment beside the pins records each).
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
 * some text is still a draft, or on the owner's word that nobody has accepted
 * any version (the header says why).
 */
const ACCEPTED_WORDS: Readonly<Record<string, string>> = {
  // The Last updated line is part of the words, in all six files: moving it to the merge day means
  // pinning all six again, in the owner's final-text pull request (0139), before it merges.
  //
  // Re-pinned under 1.0 on 2026-09-29 (the Dutch says migratie, 0152 D6) and again on 2026-10-05,
  // in that pull request: §8's "change or remove an owner or an invitation as owner" and §10's
  // closing said as the code does it. Both times privacy and terms were still drafts, so the API
  // asked nobody and nobody can have accepted 1.0.
  //
  // Pinned a third time on 2026-10-07, in this pull request, the day it merges: the Last updated
  // line moved to the merge day (the files' own briefing), and merging main's #1537 — billing in
  // advance, §7 and §8 — changed the terms' words under 1.3. All six are pinned together, as the
  // header's note requires. No tester has accepted any of these numbers: privacy and terms carried
  // their draft markers until this pull request, and the API asks nobody while any text is a draft.
  //
  // RESTARTED AT 1.0 on 2026-10-14 (the owner: "go on the 1.0 reset"). Privacy had been final as
  // 1.2 to 1.5 and the terms as 1.3 to 1.6, and their pins stood here, but no tester had accepted
  // any of them: the Alpha had not opened, and only the owner's own accounts and test accounts
  // hold acceptances. No acceptance anywhere records privacy 1.0 or terms 1.0 (the screen began at
  // 1.2 and 1.3, managed 0032), and the app compares the number for equality, so every older
  // acceptance is simply asked again. A restart is made only before any tester has accepted
  // (the header says so). The older pins are in git, with the texts.
  //
  // RE-PINNED UNDER 1.0 on 2026-10-21 (the owner: "no-one accepted the terms so far, so keep them
  // on version 1.0"): the words the owner approved on 2026-10-19 (#1639, alpha §6 and §8, terms
  // §2, privacy §3 to §10), which #1639 pinned under 1.1. Nobody had accepted any version, so the
  // number goes back to 1.0, edited in place, as alpha-version-number (a) says until the first
  // tester accepts, and the 1.1 pins go. An acceptance of 1.1 asks again; one of 1.0 recorded
  // before these words reached a stack counts for them, and only the owner's own and test
  // accounts can hold one.
  // From the first tester's acceptance on, a change of words takes a new number (1.1); the pins of
  // earlier words are in git, with the texts.
  'alpha.md@1.0': 'acc56aaf5e570d53687793a4e6951ae5732c5ce7273328a5ac5ed4201785018c',
  'alpha.nl.md@1.0': 'bf9a41a1679f8ee912c8e611b52eb4daf93f0e4042f8c708c476dea99cfd4bfb',
  'privacy.md@1.0': 'e18bfc5249c4077d7ba56f24c22adfa51b9e66f8339533c3f28dd78d864194ed',
  'privacy.nl.md@1.0': 'c177e80f1ac4880ccc054aa78c006dc7409df15dd8d3a422a6f2fc3664add3e0',
  'terms.md@1.0': 'b743e1286302fcbc0ab0570f0e3b5afd7bc86a82de3d2d55233e9517ccc90633',
  'terms.nl.md@1.0': '7024556d073d4f12216250c1c0183223304721d2631f244707e46d523f1cc47a',
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
