// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * CLAIMS YOU CAN CHECK (workplan 0152 T8 (a), (b)).
 *
 * The site asks a stranger to believe three things: the software is open
 * source, it has no way to delete from a source, and whatever cannot be moved
 * is reported. The repository is public, and each claim is held by something
 * in it, so each claim links what holds it (`site/proof.mjs`). This keeps the
 * links honest:
 *
 * 1. **A link into the repository names a file that is in this tree.** A guard
 *    renamed or deleted is a claim that outlived its proof, and this fails on it.
 * 2. **Each claim links its own proof, in both languages:** the footer's *Open
 *    source* the repository and *Run it yourself* the self-host quickstart;
 *    the hero's fact *Nothing is deleted at the source* and *the software has
 *    no way to delete from a source* the guard that counts
 *    every source connector's methods; *Whatever cannot be moved* the scope
 *    manifest; the open-source sentence the repository.
 * 3. **The repository is the one the README clones,** so the site cannot point
 *    at a fork or an old name.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A site module, by address: `site/` is plain JavaScript the root project does not type. */
const site = async <T>(file: string): Promise<T> =>
  (await import(pathToFileURL(join(REPO_ROOT, 'site', file)).href)) as T;

interface Proof {
  REPOSITORY_URL: string;
  PROOF: Record<string, string>;
  PROOF_LINKS: Record<string, string>;
}

const rendered = async () => {
  process.env.OWNPACE_APP_URL ??= 'https://app.ota.ownpace.eu';
  return (await site<{ rendered: Array<{ file: string; locale: string; key: string; html: string }> }>('build.mjs'))
    .rendered;
};

/** Every link on a page, with the words it is on. */
const linksOf = (html: string) =>
  [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: m[1]!,
    text: m[2]!.replace(/<[^>]+>/g, ''),
  }));

describe('the site links each claim to what holds it (0152 T8)', () => {
  it('links into the repository only files that are in this tree', async () => {
    const { REPOSITORY_URL, PROOF } = await site<Proof>('proof.mjs');
    for (const [name, path] of Object.entries(PROOF)) {
      expect(existsSync(join(REPO_ROOT, path)), `${name}: ${path} is not in the tree`).toBe(true);
    }
    let seen = 0;
    for (const page of await rendered()) {
      // A file, by its path on main. The repository's other pages (its security
      // advisories, which the privacy policy links) are not files.
      for (const { href } of linksOf(page.html).filter((l) => l.href.startsWith(`${REPOSITORY_URL}/blob/`))) {
        const path = /\/blob\/main\/(.+)$/.exec(href)?.[1];
        expect(path, `${page.file}: ${href} is not a file on main`).toBeDefined();
        expect(existsSync(join(REPO_ROOT, decodeURIComponent(path!))), `${page.file}: ${path} is not in the tree`).toBe(true);
        seen++;
      }
    }
    // The vacuity check: a site that linked nothing would pass the loop above.
    expect(seen).toBeGreaterThan(0);
  });

  it('links each claim to its own proof, in both languages, on every page’s footer and the home page', async () => {
    const { PROOF_LINKS } = await site<Proof>('proof.mjs');
    const pages = await rendered();
    const expectations: Record<'en' | 'nl', Array<[string, string]>> = {
      en: [
        ['Nothing is deleted at the source.', PROOF_LINKS.readsOnly!],
        ['the software has no way to delete from a source', PROOF_LINKS.readsOnly!],
        ['Whatever cannot be moved', PROOF_LINKS.cannotMove!],
        ['open source', PROOF_LINKS.repository!],
      ],
      nl: [
        ['Bij de bron wordt niets verwijderd.', PROOF_LINKS.readsOnly!],
        ['de software heeft simpelweg geen manier om iets bij een bron te verwijderen', PROOF_LINKS.readsOnly!],
        ['Wat niet mee kan', PROOF_LINKS.cannotMove!],
        ['open source', PROOF_LINKS.repository!],
      ],
    };
    const footer: Record<'en' | 'nl', Array<[string, string]>> = {
      en: [
        ['Open source', PROOF_LINKS.repository!],
        ['Run it yourself', PROOF_LINKS.selfHost!],
      ],
      nl: [
        ['Open source', PROOF_LINKS.repository!],
        ['Draai het zelf', PROOF_LINKS.selfHost!],
      ],
    };
    for (const locale of ['en', 'nl'] as const) {
      const home = pages.find((p) => p.locale === locale && p.key === 'home' && !p.file.endsWith('404.html'))!;
      const body = linksOf(home.html.slice(home.html.indexOf('<main'), home.html.indexOf('</main>')));
      for (const [text, href] of expectations[locale]) {
        expect(body, `${home.file}: "${text}" does not link its proof`).toContainEqual({ href, text });
      }
      for (const page of pages.filter((p) => p.locale === locale)) {
        const foot = linksOf(page.html.slice(page.html.indexOf('<footer')));
        for (const [text, href] of footer[locale]) {
          expect(foot, `${page.file}: the footer's "${text}" does not link its proof`).toContainEqual({ href, text });
        }
      }
    }
  });

  it('points at the repository the README clones', async () => {
    const { REPOSITORY_URL } = await site<Proof>('proof.mjs');
    const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
    expect(readme, 'README.md clones another repository than the site links').toContain(`git clone ${REPOSITORY_URL}.git`);
  });
});
