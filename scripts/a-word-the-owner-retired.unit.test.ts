// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A WORD THE OWNER RETIRED: NO FORM OF *VERHUIZEN* WHERE THE PRODUCT SPEAKS
 * DUTCH (workplan 0152 D6, 0153 T6 (b)), AND NO *DRAAGT* FOR WHAT AN ACCOUNT
 * HOLDS (the owner, 2026-10-05).
 *
 * The owner, 2026-09-28: *"Yes, but dutch know 'één migratie en 4 migraties'.
 * So we use 'migratie' in instead of 'verhuizing'."* The site follows it
 * (`site/site.unit.test.ts`), and the web dictionary has its own case
 * (`apps/web/src/i18n/i18n.unit.test.tsx`), which names the key.
 *
 * THE DICTIONARY IS NOT ALL THE DUTCH THERE IS. A mail's Dutch lives in
 * `packages/shared`: the share announcement said *"zijn verhuisd"* to people
 * who only had files shared with them, and the erasure page said *"de
 * verhuizing"*. Neither was in `strings.ts`, so a case on the dictionary alone
 * passed with both. This reads every source file of every app and package,
 * and the human copy of the mails an operator sends
 * (`docs/cutover-communication-templates.md`, which a test holds to the
 * rendered subjects).
 *
 * THE DUTCH GUIDES ARE THE PRODUCT'S TOO. `Docs.tsx` inlines
 * `docs/guides/nl` at build time, and since 2026-10-04 a visitor without an
 * account reads them from the site's Leaving pages (0152). They said a form
 * of the word 29 times, and nothing read them, so every guide in that
 * directory is read now.
 *
 * TEST FILES ARE NOT READ: a fixture may name a town *Verhuisd*
 * (`billing-party.unit.test.ts` does), and a guard's own pattern would find
 * itself. Nothing else is excused.
 *
 * AND *DRAAGT* FOR WHAT AN ACCOUNT HOLDS. The owner, 2026-10-05: *"Change the
 * Dutch "draagt" into "Omvat""*. The sign-in test's line said *Draagt: E-mail
 * · Agenda*, English *Carries:* word for word, and the guides and the setup
 * steps said an account, a card, a token or an API *draagt* what it holds.
 * It is *omvat* now, in the same files. *Afdragen*, paying a tax over, is
 * another verb that says *draagt … af*, and is the one use left.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RETIRED = /verhui[sz]/i;
const SOURCE = /\.(ts|tsx|mts|mjs|js)$/;
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage']);

/** Every source file under `dir`, test files left out. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIPPED_DIRS.has(name)) out.push(...sources(path));
    } else if (SOURCE.test(name) && !name.includes('.test.')) {
      out.push(path);
    }
  }
  return out;
}

/** The `src` of every app and every package. */
function productSources(): string[] {
  const out: string[] = [];
  for (const top of ['apps', 'packages']) {
    for (const name of readdirSync(join(ROOT, top))) {
      const src = join(ROOT, top, name, 'src');
      // A package with no src directory has no sources to read.
      if (existsSync(src) && statSync(src).isDirectory()) out.push(...sources(src));
    }
  }
  return out;
}

/** Every Dutch guide `Docs.tsx` shows, `docs/guides/nl/*.md`. */
function dutchGuides(): string[] {
  const dir = join(ROOT, 'docs', 'guides', 'nl');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(dir, name));
}

/** Every file the product's Dutch lives in. */
function dutchFiles(): string[] {
  return [...productSources(), join(ROOT, 'docs', 'cutover-communication-templates.md'), ...dutchGuides()];
}

/** Each line of the files that matches, as `path:line  text`. */
function linesSaying(files: string[], pattern: RegExp): string[] {
  return files.flatMap((f) =>
    readFileSync(f, 'utf8')
      .split('\n')
      .map((line, i) => ({ line, at: `${relative(ROOT, f)}:${i + 1}` }))
      .filter(({ line }) => pattern.test(line))
      .map(({ at, line }) => `${at}  ${line.trim()}`),
  );
}

describe('no form of verhuizen where the product speaks Dutch (0152 D6)', () => {
  const files = dutchFiles();

  it('reads the files the Dutch lives in, so an empty walk cannot pass', () => {
    const read = files.map((f) => relative(ROOT, f));
    expect(read.length).toBeGreaterThan(500);
    for (const known of [
      'apps/web/src/i18n/strings.ts',
      'packages/shared/src/share-announcement.ts',
      'packages/shared/src/erasure-scope.ts',
      'docs/cutover-communication-templates.md',
      'docs/guides/nl/google.md',
      'docs/guides/nl/archive.md',
    ]) {
      expect(read, `the walk missed ${known}`).toContain(known);
    }
  });

  it('finds none', () => {
    expect(
      linesSaying(files, RETIRED),
      'A form of verhuizen is back. The owner chose migratie (0152 D6): write\n' +
        'migratie, migreren or gemigreerd for the product and what it moved, and\n' +
        '"gaat niet mee" for what does not come along (GLOSSARY.md).',
    ).toEqual([]);
  });
});

describe('no draagt for what an account holds: the owner chose omvat (2026-10-05)', () => {
  const files = dutchFiles();
  // `draagt … af` in one clause is *afdragen*, which pays a tax over.
  const saying = (lines: string[]) => lines.filter((line) => !/\bdraagt\b[^.;:!?]*\baf\b/i.test(line));

  it('reads the line and the guides it was in, and lets afdragen be', () => {
    const read = files.map((f) => relative(ROOT, f));
    for (const known of ['apps/web/src/i18n/strings.ts', 'docs/guides/nl/soverin.md', 'docs/guides/nl/dav.md']) {
      expect(read, `the walk missed ${known}`).toContain(known);
    }
    expect(saying(['uw bedrijf draagt de btw in eigen land af.'])).toEqual([]);
    expect(saying(['Draagt: E-mail · Agenda'])).toHaveLength(1);
  });

  it('finds none', () => {
    expect(
      saying(linesSaying(files, /\bdraagt\b/i)),
      'Draagt is back for what an account, a card, a token or an API holds.\n' +
        'The owner chose omvat (2026-10-05): the sign-in test\'s line is "Omvat:",\n' +
        'and a sentence says what an account omvat (GLOSSARY.md).',
    ).toEqual([]);
  });
});
