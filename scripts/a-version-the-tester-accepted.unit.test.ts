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
 * ## How a draft line compares
 *
 * By its number. `**Version:** 1.2 (draft — not yet published)` is version
 * 1.2: the draft words say whether the site may publish the text, which is the
 * site build's refusal (`DRAFT_WORDS` in `site/build.mjs`), not a different
 * version. The constant is the number alone, in the shape the table's CHECK
 * holds (`1`, `1.2`, `1.2.3`), and never carries the draft words.
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

/** The number on a version line: the first word after `**Version:**` / `**Versie:**`. */
const numberOf = (line: string | null | undefined): string | undefined =>
  /^\*\*[^*]+:\*\*\s*(\S+)/.exec(line ?? '')?.[1];

interface Read {
  readonly lines: Record<string, string | null> | null;
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

  it('every accepted text is a page the site build renders, from that file, in both languages', () => {
    const { sources } = read();
    expect(sources, 'site/build.mjs no longer exports SOURCE').not.toBeNull();
    for (const [document, [en, nl]] of Object.entries(FILES)) {
      expect(sources?.en?.[document], `the site renders no English "${document}" page`).toBe(`legal/${en}`);
      expect(sources?.nl?.[document], `the site renders no Dutch "${document}" page`).toBe(`legal/${nl}`);
    }
  });
});
