// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONE LOOK FROM THE SITE TO THE APP (workplan 0152 T9).
 *
 * A visitor reads the public site in its teal, presses *Sign in* or *Request
 * access*, and lands in the app. Until this, those two pages were the app's
 * own blue, with a lucide icon where the site has its mark, and no way back
 * but the browser's. The pages are the same front door, so they take the
 * site's look and link back to it.
 *
 * The site and the app are separate builds that import nothing from each
 * other (`site/build.mjs`'s header; `services/legal-links.ts`), so the look is
 * a copy, and this holds each copy to its source:
 *
 * 1. **The palette.** `--color-site-teal` and `--color-site-mint` in the web
 *    app's `index.css` are `TEAL` and `MINT` in `site/build.mjs`, which the
 *    site's own guard holds to the colour `scripts/make-logo.py` draws in.
 * 2. **The mark.** `SiteMark.tsx` draws every shape of `site/brand/logo.svg`,
 *    with the same numbers. A mark redrawn by `make-logo.py` fails here until
 *    the app's copy is redrawn with it.
 * 3. **The two pages** draw the mark and the way back, and none of the app's
 *    blue is left on them.
 * 4. **The way back** is built from the deployment's own site setting, never a
 *    fixed host, and leads to the site's home page in the reader's language,
 *    which the site build writes under `/nl/` for Dutch.
 *
 * NOT held: the rest of the app's colours. They stay until 0153 reviews the
 * palette with its layout (0152 T9 (b)).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8');

const SETTING = 'VITE_LEGAL_SITE_URL';
const PAGES = ['apps/web/src/pages/Login.tsx', 'apps/web/src/pages/RequestAccess.tsx'];

/** The value of a `const NAME = '#…'` in the site build. */
function siteColour(name: string): string {
  const m = new RegExp(`^const ${name} = '(#[0-9A-Fa-f]{6})';`, 'm').exec(read('site/build.mjs'));
  expect(m, `site/build.mjs no longer defines ${name} as a colour`).not.toBeNull();
  return m![1]!.toUpperCase();
}

/** The value of a CSS custom property in the web app's stylesheet. */
function webColour(name: string): string {
  const m = new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6});`).exec(read('apps/web/src/index.css'));
  expect(m, `apps/web/src/index.css does not define ${name}`).not.toBeNull();
  return m![1]!.toUpperCase();
}

/**
 * Every attribute of every shape, by element, in document order. JSX's
 * camelCase is read as the SVG's kebab-case, so the two files compare as one
 * drawing.
 */
function shapes(source: string): Array<{ tag: string; attrs: Record<string, string> }> {
  const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  return [...source.matchAll(/<(rect|path|circle)\b([^>]*?)\/?>/g)].map((m) => ({
    tag: m[1]!,
    attrs: Object.fromEntries(
      [...m[2]!.matchAll(/([A-Za-z-]+)="([^"]*)"/g)].map((a) => [kebab(a[1]!), a[2]!.toUpperCase()]),
    ),
  }));
}

describe('the app’s front door takes the site’s look (0152 T9)', () => {
  it('draws in the site’s teal and mint', () => {
    expect(webColour('--color-site-teal'), 'the app’s teal is not the site’s').toBe(siteColour('TEAL'));
    expect(webColour('--color-site-mint'), 'the app’s mint is not the site’s').toBe(siteColour('MINT'));
  });

  it('draws the site’s mark, shape for shape', () => {
    const site = shapes(read('site/brand/logo.svg'));
    // The vacuity check: a logo this guard could not read would compare as
    // equal to a component it could not read either.
    expect(site.map((s) => s.tag), 'site/brand/logo.svg lost a shape this guard reads').toEqual(['rect', 'path', 'circle']);
    expect(shapes(read('apps/web/src/components/SiteMark.tsx')), 'SiteMark.tsx is not the site’s mark').toEqual(site);
    const viewBox = (s: string) => /viewBox="([^"]+)"/.exec(s)?.[1];
    expect(viewBox(read('apps/web/src/components/SiteMark.tsx'))).toBe(viewBox(read('site/brand/logo.svg')));
  });

  it.each(PAGES)('%s draws the mark and the way back, and none of the app’s blue', (page) => {
    const code = read(page);
    expect(code, `${page} does not draw the site’s mark`).toMatch(/<SiteMark\b/);
    expect(code, `${page} has no way back to the site`).toMatch(/<BackToSite\s*\/>/);
    expect(code.match(/\b[a-z:-]*blue-\d{2,3}\b/g) ?? [], `${page} still draws in the app’s blue`).toEqual([]);
  });
});

describe('the way back is the deployment’s own site, in the reader’s language (0152 T9)', () => {
  const load = () => import('../apps/web/src/services/site-home.ts');

  it('unset is the production site, as the legal links read it', async () => {
    const { siteHomeUrl, siteName } = await load();
    const { DEFAULT_LEGAL_SITE_URL } = await import('../apps/web/src/services/legal-links.ts');
    expect(siteHomeUrl('en', {})).toBe(`${DEFAULT_LEGAL_SITE_URL}/`);
    expect(siteHomeUrl('nl', {})).toBe(`${DEFAULT_LEGAL_SITE_URL}/nl/`);
    expect(siteName({})).toBe(new URL(DEFAULT_LEGAL_SITE_URL).host.replace(/^www\./, ''));
  });

  it('a test stack’s setting leads to its test site, never production’s', async () => {
    const { siteHomeUrl, siteName } = await load();
    const env = { [SETTING]: 'https://www.ota.ownpace.eu/' };
    expect(siteHomeUrl('en', env)).toBe('https://www.ota.ownpace.eu/');
    expect(siteHomeUrl('nl', env)).toBe('https://www.ota.ownpace.eu/nl/');
    expect(siteName(env)).toBe('ota.ownpace.eu');
  });

  it('a value the links cannot use is refused, naming the setting', async () => {
    const { siteHomeUrl } = await load();
    expect(() => siteHomeUrl('en', { [SETTING]: 'www.ownpace.eu' })).toThrow(SETTING);
  });

  it('the Dutch home is where the site build writes it', async () => {
    // By address: `site/` is plain JavaScript the root project does not type.
    const { COPY, localeRoot } = (await import(pathToFileURL(join(REPO_ROOT, 'site/copy.mjs')).href)) as {
      COPY: Record<string, { files: Record<string, string> }>;
      localeRoot: (l: string) => string;
    };
    expect(localeRoot('en')).toBe('');
    expect(localeRoot('nl')).toBe('/nl');
    expect(COPY.nl!.files.home).toBe('index.html');
    expect(COPY.en!.files.home).toBe('index.html');
  });
});
