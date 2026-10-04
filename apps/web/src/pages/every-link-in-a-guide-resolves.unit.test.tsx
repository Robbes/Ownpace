// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * EVERY LINK IN A GUIDE RESOLVES (workplan 0148 T7, its first half).
 *
 * Since 2026-10-04 a visitor without an account reads the guides too, from the
 * site's Leaving pages (0152, *the guides are public*), so a link that goes
 * nowhere is now in front of a stranger. This renders every served guide, in
 * every language the app speaks, with the page's own renderer (`GuideArticle`,
 * the one `/docs` draws), and follows each link it drew:
 *
 * - a link to another guide, or to a section of one (`archive.md#apple-privacy`
 *   in the Markdown, `/docs/archive#apple-privacy` on the page), names a guide
 *   that is served in the SAME language, and a section that guide has;
 * - a link to a section of the same page (`#fields`) names an id on it;
 * - everything else leaves the app over `https:`. A relative link that is
 *   neither, such as one to a file under `docs/` that is not served, fails.
 *
 * The ids are the rendered page's, not a second reading of the Markdown, so a
 * heading the renderer numbers (`-1`) or a `{#id}` it keeps is read as the
 * reader's browser will see it.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { LOCALES, type Locale } from '../i18n/strings.ts';
import { GuideArticle } from './Docs.tsx';

/** Every served guide, `docs/guides/<locale>/<slug>.md`, as `Docs.tsx` inlines them. */
const GUIDES = import.meta.glob('../../../../docs/guides/*/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const slugOf = (path: string) => path.split('/').pop()!.replace(/\.md$/, '');
const langOf = (path: string) => path.split('/').slice(-2)[0]!;

/** The guides of one language, by slug. */
const guidesIn = (locale: Locale): Map<string, string> =>
  new Map(
    Object.entries(GUIDES)
      .filter(([path]) => langOf(path) === locale)
      .map(([path, body]) => [slugOf(path), body]),
  );

/** A guide as `/docs/<slug>` draws it: the ids on the page and the links it drew. */
type Page = { ids: Set<string>; hrefs: string[] };

/** Draw one guide with the page's own renderer, at its own address. */
function drawn(slug: string, body: string, locale: Locale): Page {
  const { container, unmount } = render(
    <MemoryRouter initialEntries={[`/docs/${slug}`]}>
      <GuideArticle body={body} lang={locale} />
    </MemoryRouter>,
  );
  const ids = new Set([...container.querySelectorAll('[id]')].map((el) => el.id));
  const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
  unmount();
  return { ids, hrefs };
}

/** Every link on these pages a reader cannot follow, and how many stay in the app. */
function brokenLinks(pages: ReadonlyMap<string, Page>, locale: Locale): { broken: string[]; internal: number } {
  let internal = 0;
  const broken: string[] = [];
  for (const [slug, page] of pages) {
    for (const href of page.hrefs) {
      const where = `docs/guides/${locale}/${slug}.md links "${href}"`;
      // Docs.tsx draws `x.md`, `x.md#s`, `docs/x` and `#s` as /docs/<slug>[#s].
      const inApp = /^\/docs\/([a-z0-9-]+)(?:#(.+))?$/.exec(href);
      if (inApp) {
        internal++;
        const [, target, section] = inApp;
        const there = pages.get(target!);
        if (!there) broken.push(`${where}: no ${locale} guide "${target}" is served`);
        else if (section && !there.ids.has(decodeURIComponent(section)))
          broken.push(`${where}: ${target} has no section "${section}"`);
      } else if (!href.startsWith('https://')) {
        broken.push(`${where}: neither a served guide nor an https address`);
      }
    }
  }
  return { broken, internal };
}

const drawnIn = (locale: Locale): Map<string, Page> =>
  new Map([...guidesIn(locale)].map(([slug, body]) => [slug, drawn(slug, body, locale)]));

describe('every link in a guide resolves (0148 T7)', () => {
  for (const locale of LOCALES) {
    it(`${locale}: each link names a served guide and a section it has, or leaves over https`, () => {
      const pages = drawnIn(locale);
      // The vacuity checks: a glob that found nothing, or guides that link
      // nothing, would pass the assertion below.
      expect(pages.size, `no ${locale} guide is served`).toBeGreaterThan(5);
      const { broken, internal } = brokenLinks(pages, locale);
      expect(internal, `no ${locale} guide links another, so this read nothing`).toBeGreaterThan(5);
      expect(broken, 'A guide links somewhere a reader cannot follow it.').toEqual([]);
    });
  }

  it('finds the two kinds the plan names: a section that is not there, and a file the app does not serve', () => {
    const pages = drawnIn('en');
    pages.set(
      'probe',
      drawn(
        'probe',
        '# Probe\n\nSee [nothing](archive.md#no-such-section), [operators](../grant-links.md), ' +
          '[a section](#probe) and [a site](https://www.ownpace.eu/).',
        'en',
      ),
    );
    expect(brokenLinks(pages, 'en').broken).toEqual([
      'docs/guides/en/probe.md links "/docs/archive#no-such-section": archive has no section "no-such-section"',
      'docs/guides/en/probe.md links "/docs/grant-links": no en guide "grant-links" is served',
    ]);
  });
});
