// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The in-app setup guides (workplan 0063), and the renderer that keeps a
 * guide's shape (workplan 0148 T6 (a)).
 *
 * The point is that a reference like "docs/box-setup.md" becomes something a
 * managed customer in a browser can actually open, and that the text they read
 * is the repository's own — shipped with the code that implements it, so it
 * cannot drift from the connector. These tests read the REAL guides through
 * the same build-time import the page uses, so a renamed or deleted document
 * fails here rather than 404ing for a customer.
 *
 * WHAT THE RENDERER GOT WRONG (0148 §1, "The renderer"). A heading was a `<p>`
 * with no id, so nothing could link to a section. A `#section` link was
 * treated as external and opened the same page again in a new tab. A numbered
 * step joined the paragraph around it, so eight steps read as one run-on
 * sentence. Text inside bold was not parsed again, so a link there showed as
 * `[text](href)`. The article had no `lang`, so a Dutch page read an English
 * guide under `lang="nl"`. The index listed file slugs. Each of those has a
 * fixture case below, and the served-guides case checks the same properties
 * on every guide the build ships.
 *
 * WHAT WAITED FOR THE SPLIT. The plan's full guard also says no rendered
 * paragraph begins with `|` or `>`. The operator documents that were served
 * until 0148 T1 used GFM tables and blockquotes (86 and 64 lines), which the
 * renderer's second half (T6 (b)) takes up. The customer guides in
 * `docs/guides/` are written without them, as T6 says a guide is until then,
 * so the assertion runs over every served guide now instead of waiting.
 *
 * ONE THING THE FIRST HALF BROKE, AND WHAT KEEPS IT FIXED. A numbered step is
 * now a list item of its own, and its continuation lines are not joined to it
 * until T6 (b); they render as a paragraph after it. While the steps were one
 * run-on paragraph, a bold span could open on a step's line and close on the
 * next. Split, it shows both `**` as text: `archive-setup.md`'s step 5 did.
 * So the served-guides case checks that a bold span opened on a numbered
 * step's line closes on it, and the guides are wrapped to match.
 *
 * WHAT 0148 T1 ADDED. The page serves `docs/guides/<locale>/<slug>.md` instead
 * of `docs/*-setup.md`, in the reader's language, and falls back to the other
 * language under one line in the reader's own, with `lang` on the article
 * (T4's "Which language"). A guide's `{#own-app}` section folds into a closed
 * `<details>` where `/api/provider-clients` says the deployment carries that
 * provider's app, read through the wizard's own query key (T2 (c)). On the
 * appliance the index ends with one line pointing to the operator documents
 * (D9). The served-guides case runs over every guide in every language it is
 * written in; while `docs/guides/nl/` is empty that is English only, and a
 * Dutch reader meets the fallback, which the language case checks.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GRANT_PROVIDERS } from '@openmig/shared';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS, type Locale } from '../i18n/strings.ts';
import { SOURCE_CARDS } from '../components/front-door-cards.ts';
import Docs, { GUIDE_SLUGS, GuideArticle, guideTitle, pickGuide } from './Docs.tsx';

/**
 * The deployment facts the page reads for the own-app fold, and the edition
 * the index reads for its appliance line. `VITE_EDITION` is baked at build
 * time, so the edition module is mocked (the 0034 guardrail's seam).
 */
const { providerClientsGet, edition } = vi.hoisted(() => ({
  providerClientsGet: vi.fn(),
  edition: { selfhost: false },
}));

vi.mock('../services/mapping-service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/mapping-service.ts')>()),
  providerClientsApi: { get: providerClientsGet },
}));

vi.mock('../services/edition.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/edition.ts')>()),
  isSelfHost: () => edition.selfhost,
}));

beforeEach(() => {
  providerClientsGet
    .mockReset()
    .mockResolvedValue({ google: 'connection', dropbox: 'connection', microsoft: 'connection' });
  edition.selfhost = false;
  window.localStorage.setItem('ownpace.locale', 'en');
});

/** The page as the app mounts it: a query client, the real locale provider, a router. */
function renderAt(
  path: string,
  locale: Locale = 'en',
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  window.localStorage.setItem('ownpace.locale', locale);
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/docs" element={<Docs />} />
            <Route path="/docs/:slug" element={<Docs />} />
          </Routes>
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

/** Renders a fixture through the same article the page uses, at `/docs/fixture`. */
function renderFixture(body: string, path = '/docs/fixture', ownAppFolded = false) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/docs/:slug"
          element={<GuideArticle body={body} lang="en" ownAppFolded={ownAppFolded} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * jsdom has no layout, so it has no `scrollIntoView`. Record which element
 * was asked to scroll instead; the property is removed again after each test.
 */
function recordScrolls(): Element[] {
  const scrolled: Element[] = [];
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value(this: Element) {
      scrolled.push(this);
    },
  });
  return scrolled;
}

afterEach(() => {
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

const FIXTURE = [
  '# A guide to a fixture',
  '',
  'Read [the part that matters](#connect) first, or [somewhere else](https://example.org/elsewhere).',
  '',
  '## Koppelen {#connect}',
  '',
  'Steps:',
  '1. Open the wizard.',
  '2. Press **Next**.',
  '   - a point under the second step',
  '3. Press **[the button](#before-you-start)** when it appears.',
  '',
  '## Before you start',
  '',
  'Sign in at [`account.example.org`](https://account.example.org), then',
  '**read [the provider](https://example.org/provider) first**.',
  '',
  '### The `code` part — twice',
  '',
  '### The `code` part — twice',
  '',
  '#### Deepest',
  '',
  '```',
  '# a comment in a fence, not a heading',
  '1. nor a list',
  '```',
  '',
  '## With your own app {#own-app}',
  '',
  'Create the app first.',
  '',
  '### The redirect address {#own-app-redirect}',
  '',
  'Register the address the wizard shows.',
  '',
  '## Stopping {#leaving}',
  '',
  'Revoke it at the provider.',
].join('\n');

describe('the in-app setup guides', () => {
  it('renders the repository\'s own Box guide, not a copy of it', () => {
    renderAt('/docs/box');

    // A sentence that exists only in the Box guide, and which is the whole
    // reason a Box setup stalls (workplan 0056).
    expect(screen.getAllByText(/Custom Apps Manager/).length).toBeGreaterThan(0);
  });

  it('ships a guide for each provider that has one', () => {
    const { container } = renderAt('/docs');

    for (const slug of ['apple', 'archive', 'box', 'dropbox', 'google', 'microsoft']) {
      expect(
        container.querySelector(`a[href="/docs/${slug}"]`),
        `${slug} is referenced by the UI`,
      ).not.toBeNull();
    }
  });

  it('serves no operator document: the *-setup.md files stay in docs/', () => {
    const { container } = renderAt('/docs');

    expect([...GUIDE_SLUGS].filter((slug) => slug.endsWith('-setup'))).toEqual([]);
    expect(container.querySelector('a[href$="-setup"]')).toBeNull();
    renderAt('/docs/box-setup');
    expect(screen.getByText(/no guide by that name/)).toBeTruthy();
  });

  it('names what DOES exist when a reference is stale, rather than a bare 404', () => {
    const { container } = renderAt('/docs/no-such-guide');

    expect(screen.getByText(/no guide by that name/)).toBeTruthy();
    expect(container.querySelector('a[href="/docs/box"]')).not.toBeNull();
  });
});

describe('a renderer that keeps a guide\'s shape (0148 T6 (a)), on fixtures', () => {
  it('renders headings as h2–h4 with an id from {#id}, or else a slug of the heading', () => {
    const { container } = renderFixture(FIXTURE);
    const headings = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')];

    expect(headings.map((h) => [h.tagName, h.id, h.textContent])).toEqual([
      ['H2', 'a-guide-to-a-fixture', 'A guide to a fixture'],
      // The brace is the id, and it leaves the text.
      ['H3', 'connect', 'Koppelen'],
      ['H3', 'before-you-start', 'Before you start'],
      // GitHub's slug: punctuation dropped, each space a hyphen, so the dash
      // leaves two. A repeated heading gets a suffix rather than a duplicate id.
      ['H4', 'the-code-part--twice', 'The code part — twice'],
      ['H4', 'the-code-part--twice-1', 'The code part — twice'],
      // `####` is the deepest level the renderer takes, and stays an h4.
      ['H4', 'deepest', 'Deepest'],
      ['H3', 'own-app', 'With your own app'],
      ['H4', 'own-app-redirect', 'The redirect address'],
      ['H3', 'leaving', 'Stopping'],
    ]);
    // Inline markdown inside a heading still renders.
    expect(headings[3]!.querySelector('code')?.textContent).toBe('code');
    // A `#` inside a fence is code, not a heading.
    expect(container.querySelector('pre')?.textContent).toContain('# a comment in a fence');
  });

  it('keeps a #section link in the tab, and scrolls to its heading', () => {
    const scrolled = recordScrolls();
    renderFixture(FIXTURE);

    const link = screen.getByRole('link', { name: 'the part that matters' });
    expect(link.getAttribute('target')).toBeNull();
    expect(link.getAttribute('href')).toBe('/docs/fixture#connect');

    fireEvent.click(link);
    expect(scrolled.map((el) => el.id)).toEqual(['connect']);
    // A second press of the same link, after the reader scrolled away, scrolls again.
    fireEvent.click(link);
    expect(scrolled.map((el) => el.id)).toEqual(['connect', 'connect']);

    // An address outside the guide still opens a tab of its own.
    const outside = screen.getByRole('link', { name: 'somewhere else' });
    expect(outside.getAttribute('target')).toBe('_blank');
  });

  it('scrolls to the section named in the address it was opened at', () => {
    const scrolled = recordScrolls();
    renderFixture(FIXTURE, '/docs/fixture#before-you-start');

    expect(scrolled.map((el) => el.id)).toEqual(['before-you-start']);
  });

  it('renders numbered steps as an ordered list, and keeps the count across a sub-list', () => {
    const { container } = renderFixture(FIXTURE);
    const lists = [...container.querySelectorAll('ol')];

    expect(lists.map((ol) => [ol.getAttribute('start'), ol.querySelectorAll('li').length])).toEqual([
      [null, 2],
      // The bullet under step 2 ends the first list; the next resumes at 3.
      ['3', 1],
    ]);
    expect(lists[0]!.textContent).toBe('Open the wizard.Press Next.');
    // A numbered line ends the paragraph above it rather than joining it.
    const paragraphs = [...container.querySelectorAll('p')].map((p) => p.textContent);
    expect(paragraphs).toContain('Steps:');
    expect(paragraphs.filter((text) => /^\s*\d+\.\s/.test(text ?? ''))).toEqual([]);
  });

  it('renders a link inside bold as a link', () => {
    const scrolled = recordScrolls();
    const { container } = renderFixture(FIXTURE);
    const inBold = [...container.querySelectorAll('strong a')];

    expect(inBold.map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('target')])).toEqual([
      ['the button', '/docs/fixture#before-you-start', null],
      ['the provider', 'https://example.org/provider', '_blank'],
    ]);
    for (const strong of container.querySelectorAll('strong')) {
      expect(strong.textContent).not.toMatch(/\[[^\]]+\]\([^)]+\)/);
    }

    fireEvent.click(inBold[0]!);
    expect(scrolled.map((el) => el.id)).toEqual(['before-you-start']);
  });

  it('links another guide by its file name, in the tab, with the section it names', () => {
    // The Apple guide sends its export section to `archive.md#apple-privacy`
    // (0148 T1): the slug alone lost the section.
    renderFixture('See [the archive guide](archive.md#apple-privacy), or [the whole of it](archive.md).');

    const section = screen.getByRole('link', { name: 'the archive guide' });
    expect(section.getAttribute('href')).toBe('/docs/archive#apple-privacy');
    expect(section.getAttribute('target')).toBeNull();
    expect(screen.getByRole('link', { name: 'the whole of it' }).getAttribute('href')).toBe('/docs/archive');
  });

  it('renders code inside a link\'s text as code, not as backticks', () => {
    renderFixture(FIXTURE);

    const link = screen.getByRole('link', { name: 'account.example.org' });
    expect(link.querySelector('code')?.textContent).toBe('account.example.org');
  });

  it('sets lang on the article, since the guide may not be in the page\'s language', () => {
    const { container } = renderFixture(FIXTURE);
    expect(container.querySelector('article')?.getAttribute('lang')).toBe('en');
  });

  it('takes a guide\'s title from its first heading', () => {
    expect(guideTitle('# Box setup — the app\n\n## 1. Create the app\n', 'box-setup')).toBe(
      'Box setup — the app',
    );
    expect(guideTitle('## Koppelen met `Google` {#connect}\n', 'google')).toBe('Koppelen met Google');
    expect(guideTitle('# See **[the thing](#x)**\n', 'x')).toBe('See the thing');
    expect(guideTitle('```\n# a comment\n```\n\n# Real title\n', 'x')).toBe('Real title');
    // A guide with no heading falls back to its slug rather than to nothing.
    expect(guideTitle('No heading here.\n', 'fallback-slug')).toBe('fallback-slug');
  });
});

describe('the own-app section folds where the service has its own app (0148 T2 (c)), on fixtures', () => {
  it('is an open <details> after its heading where the service carries no app', () => {
    const { container } = renderFixture(FIXTURE);
    const fold = container.querySelector('details')!;

    expect(fold, 'the own-app section is a <details>').not.toBeNull();
    expect(fold.open).toBe(true);
    // The heading stays outside, so the section can still be linked and read
    // as a heading; everything under it, to the next heading of its level, folds.
    expect(fold.previousElementSibling?.id).toBe('own-app');
    expect(fold.querySelector('summary')?.textContent).toBe('Only if you want to use your own app');
    expect(fold.textContent).toContain('Create the app first.');
    expect(fold.querySelector('#own-app-redirect')).not.toBeNull();
    expect(fold.textContent).not.toContain('Revoke it at the provider.');
    // Only the own-app section folds.
    expect(container.querySelectorAll('details').length).toBe(1);
  });

  it('is closed where the service carries the app, and opens when a link names what is inside', () => {
    const scrolled = recordScrolls();
    const { container } = renderFixture(FIXTURE, '/docs/fixture#own-app-redirect', true);
    const fold = container.querySelector('details')!;

    expect(fold.open, 'a link to a heading inside the fold opens it').toBe(true);
    expect(scrolled.map((el) => el.id)).toEqual(['own-app-redirect']);
  });

  it('stays closed when nothing names it', () => {
    const { container } = renderFixture(FIXTURE, '/docs/fixture', true);
    expect(container.querySelector('details')!.open).toBe(false);
  });

  it('opens when a link names its heading', () => {
    const scrolled = recordScrolls();
    const { container } = renderFixture(FIXTURE, '/docs/fixture#own-app', true);

    expect(container.querySelector('details')!.open).toBe(true);
    expect(scrolled.map((el) => el.id)).toEqual(['own-app']);
  });
});

describe('a guide in the reader\'s language, or the other one under a notice (0148 T4)', () => {
  const library = {
    en: new Map([
      ['both', '# Both, in English'],
      ['english-only', '# English only'],
    ]),
    nl: new Map([
      ['both', '# Beide, in het Nederlands'],
      ['dutch-only', '# Alleen Nederlands'],
    ]),
  };

  it('picks the reader\'s language where the guide is written in it', () => {
    expect(pickGuide(library, 'both', 'nl')).toEqual({
      body: '# Beide, in het Nederlands',
      lang: 'nl',
      otherLanguage: false,
    });
    expect(pickGuide(library, 'both', 'en')).toMatchObject({ lang: 'en', otherLanguage: false });
  });

  it('falls back to the other language, and says so, in both directions', () => {
    expect(pickGuide(library, 'english-only', 'nl')).toEqual({
      body: '# English only',
      lang: 'en',
      otherLanguage: true,
    });
    expect(pickGuide(library, 'dutch-only', 'en')).toEqual({
      body: '# Alleen Nederlands',
      lang: 'nl',
      otherLanguage: true,
    });
  });

  it('finds nothing for a slug neither language has, including an object\'s own property names', () => {
    expect(pickGuide(library, 'no-such-guide', 'en')).toBeUndefined();
    expect(pickGuide(library, 'constructor', 'nl')).toBeUndefined();
  });

  for (const locale of ['en', 'nl'] as const) {
    it(`every served guide, read in ${locale}: its own language, or the notice and the other one`, () => {
      for (const slug of [...GUIDE_SLUGS].sort()) {
        const own = SOURCES[`${locale}/${slug}`];
        const { container, unmount } = renderAt(`/docs/${slug}`, locale);
        const article = container.querySelector('article')!;
        const notice = within(container).queryByText(STRINGS[locale]['docs.otherLanguage']);

        if (own !== undefined) {
          expect(article.getAttribute('lang'), `${slug} in ${locale}`).toBe(locale);
          expect(notice, `${slug} in ${locale} needs no notice`).toBeNull();
        } else {
          const other = locale === 'en' ? 'nl' : 'en';
          expect(SOURCES[`${other}/${slug}`], `${slug} exists in some language`).toBeDefined();
          expect(article.getAttribute('lang'), `${slug}, the ${other} version`).toBe(other);
          expect(notice, `${slug} in ${locale} says it is the ${other} version`).not.toBeNull();
          // The notice is in the reader's language, not the guide's.
          expect(notice!.getAttribute('lang')).toBe(locale);
        }
        unmount();
      }
    });
  }

  it('words the notice as the plan gives it, in both languages', () => {
    expect(STRINGS.nl['docs.otherLanguage']).toBe(
      'Deze handleiding is er nog niet in het Nederlands; hieronder staat de Engelse versie.',
    );
    expect(STRINGS.en['docs.otherLanguage']).toBe(
      'This guide is not yet available in English; the Dutch version follows.',
    );
  });
});

describe('the own-app section follows what this deployment carries (0148 T2 (c))', () => {
  /** The guides whose provider a deployment can carry an app for: slug and provider are one name. */
  const grantGuides = [...GUIDE_SLUGS].filter((slug) => (GRANT_PROVIDERS as readonly string[]).includes(slug));

  it('has an own-app section in exactly the Google, Dropbox and Microsoft guides', () => {
    const withSection = Object.entries(SOURCES)
      .filter(([, body]) => /^#{1,4} .*\{#own-app\}\s*$/m.test(body))
      .map(([key]) => key.split('/')[1]!);
    expect([...new Set(withSection)].sort()).toEqual(['dropbox', 'google', 'microsoft']);
    expect(grantGuides.sort()).toEqual(['dropbox', 'google', 'microsoft']);
  });

  for (const provider of ['google', 'dropbox', 'microsoft'] as const) {
    it(`${provider}: closed where /api/provider-clients says deployment, open where it says connection`, async () => {
      providerClientsGet.mockResolvedValue({
        google: 'connection',
        dropbox: 'connection',
        microsoft: 'connection',
        [provider]: 'deployment',
      });
      const folded = renderAt(`/docs/${provider}`);
      const fold = () => folded.container.querySelector('details')!;
      expect(fold(), `${provider} has an own-app fold`).not.toBeNull();
      await waitFor(() => expect(fold().open).toBe(false));
      expect(fold().previousElementSibling?.id).toBe('own-app');
      expect(providerClientsGet).toHaveBeenCalled();
      folded.unmount();

      // The fold is open while the answer is loading, whatever it will be, so
      // the check waits for the answer to arrive before reading the fold.
      providerClientsGet.mockResolvedValue({ google: 'connection', dropbox: 'connection', microsoft: 'connection' });
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const open = renderAt(`/docs/${provider}`, 'en', client);
      await waitFor(() => expect(client.getQueryState(['provider-clients'])?.status).toBe('success'));
      expect(open.container.querySelector('details')!.open).toBe(true);
      open.unmount();
    });
  }

  it('stays open where the answer never comes, as on the appliance, which serves no such route', async () => {
    providerClientsGet.mockRejectedValue(new Error('404'));
    const { container } = renderAt('/docs/google');

    await waitFor(() => expect(providerClientsGet).toHaveBeenCalled());
    expect(container.querySelector('details')!.open).toBe(true);
  });

  it('reads the fact the wizard reads, under the same query key', async () => {
    // One cache entry for the whole app: the wizard and the consent panel ask
    // `['provider-clients']`, and a second key would be a second answer.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['provider-clients'], { google: 'deployment', dropbox: 'connection', microsoft: 'connection' });
    const { container } = render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/docs/google']}>
          <Routes>
            <Route path="/docs/:slug" element={<Docs />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(container.querySelector('details')!.open).toBe(false);
    expect(providerClientsGet).not.toHaveBeenCalled();
  });

  it('the Box guide has no fold: Box has no deployment app', () => {
    const { container } = renderAt('/docs/box');
    expect(container.querySelector('details')).toBeNull();
    expect(providerClientsGet).not.toHaveBeenCalled();
  });
});

describe('the appliance\'s /docs points to the operator documents (0148 D9)', () => {
  for (const locale of ['en', 'nl'] as const) {
    it(`${locale}: the line ends the index on the appliance, and is absent on managed`, () => {
      const line = STRINGS[locale]['docs.operatorDocs'];

      edition.selfhost = true;
      const appliance = renderAt('/docs', locale);
      const link = within(appliance.container).getByRole('link', { name: line });
      expect(link.getAttribute('href')).toBe('https://github.com/Robbes/Ownpace/tree/main/docs');
      // The last thing on the index, after the guides.
      const items = [...appliance.container.querySelectorAll('a')];
      expect(items[items.length - 1]).toBe(link);
      appliance.unmount();

      edition.selfhost = false;
      const managed = renderAt('/docs', locale);
      expect(within(managed.container).queryByText(line)).toBeNull();
      managed.unmount();
    });
  }

  it('words the line as the plan gives it, in both languages', () => {
    // D9's wording, less its first article, so it fits the fifteen words a
    // line on screen gets (workplan 0118's copy budget).
    expect(STRINGS.en['docs.operatorDocs']).toBe(
      'Running your own appliance? Settings and commands are in the operator documents in the repository.',
    );
    expect(STRINGS.nl['docs.operatorDocs']).toBe(
      'Draait u een eigen appliance? Instellingen en commando\'s staan in de beheerdersdocumenten in de repository.',
    );
  });
});

/**
 * Every served guide, read through the same build-time import as the page,
 * keyed `<locale>/<slug>`.
 */
const SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob('../../../../docs/guides/*/*.md', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>,
  ).map(([path, body]) => [path.split('/').slice(-2).join('/').replace(/\.md$/, ''), body]),
);

/** The `<locale>/<slug>` keys, sorted: every guide in every language it is written in. */
const SERVED = Object.keys(SOURCES).sort();

/** The source's lines that are not inside a fence at the start of a line. */
function linesOutsideFences(body: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of body.split('\n')) {
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) out.push(line);
  }
  return out;
}

/** Bold spans, line by line, whose text holds a markdown link. */
function boldLinksIn(lines: string[]): number {
  let n = 0;
  for (const line of lines) {
    for (const bold of line.matchAll(/\*\*([^*]+)\*\*/g)) {
      if (/\[[^\]]+\]\([^)]+\)/.test(bold[1]!)) n += 1;
    }
  }
  return n;
}

describe('every served guide keeps its shape (0148 T6 (a))', () => {
  it('reads the same guides the page serves', () => {
    expect([...new Set(SERVED.map((key) => key.split('/')[1]!))].sort()).toEqual([...GUIDE_SLUGS].sort());
    expect(GUIDE_SLUGS.size).toBeGreaterThan(0);
  });

  for (const key of SERVED) {
    const [locale, slug] = key.split('/') as [Locale, string];
    it(`${key}: headings with ids, same-tab # links, numbered steps, links in bold, lang, no | or >`, () => {
      const source = SOURCES[key]!;
      const lines = linesOutsideFences(source);
      const { container } = renderAt(`/docs/${slug}`, locale);
      const article = container.querySelector('article')!;

      expect(article.getAttribute('lang')).toBe(locale);

      // Every heading line is a heading element, h2–h4, with an id of its own.
      const headings = [...article.querySelectorAll('h1, h2, h3, h4, h5, h6')];
      const headingLines = lines.filter((line) => /^#{1,4}\s+/.test(line));
      expect(headings.length).toBe(headingLines.length);
      for (const h of headings) {
        expect(['H2', 'H3', 'H4'], h.textContent ?? '').toContain(h.tagName);
        expect(h.id, h.textContent ?? '').not.toBe('');
      }
      const ids = headings.map((h) => h.id);
      expect(new Set(ids).size, 'heading ids are unique').toBe(ids.length);

      // Every #section link stays in the tab and names an id on this page.
      const sameTab = [...article.querySelectorAll('a')].filter((a) =>
        (a.getAttribute('href') ?? '').startsWith(`/docs/${slug}#`),
      );
      const written = lines.join('\n').match(/\]\(#[^)]+\)/g) ?? [];
      expect(sameTab.length).toBe(written.length);
      for (const a of sameTab) {
        expect(a.getAttribute('target'), a.textContent ?? '').toBeNull();
        const id = a.getAttribute('href')!.split('#')[1]!;
        expect(article.querySelector(`[id="${id}"]`), `#${id} is on the page`).not.toBeNull();
      }

      // No paragraph begins with a numbered step, a table row or a quote: the
      // renderer has none of the last two until T6 (b), so a guide uses none.
      for (const p of article.querySelectorAll('p')) {
        expect(p.textContent ?? '').not.toMatch(/^\s*(\d+\.\s|\||>)/);
      }
      const numbered = lines.filter((line) => /^\s*\d+\.\s/.test(line) && !/^ {4}/.test(line));
      if (numbered.length > 0) expect(article.querySelectorAll('ol').length).toBeGreaterThan(0);

      // A bold span that opens on a numbered step's line closes on it (see the
      // header: continuation lines wait for T6 (b)).
      for (const line of numbered) {
        const markers = line.replace(/`[^`]*`/g, '').match(/\*\*/g) ?? [];
        expect(markers.length % 2, `bold closes on its step's line: ${line.trim()}`).toBe(0);
      }

      // A link written inside bold is a link, not its markdown.
      expect(article.querySelectorAll('strong a').length).toBeGreaterThanOrEqual(boldLinksIn(lines));
      for (const strong of article.querySelectorAll('strong')) {
        expect(strong.textContent ?? '').not.toMatch(/\[[^\]]+\]\([^)]+\)/);
      }
    });
  }

  /**
   * T4's one outline, the same ids in every guide and both languages, so a
   * link from the checklist or a refusal can name a section without knowing
   * which guide it is in. Top-level sections only; a card's own subsection
   * (`{#gmail}`) sits under `connect`.
   */
  it.each(SERVED)('%s: the outline, in order, with its ids', (key) => {
    const ids = linesOutsideFences(SOURCES[key]!)
      .map((line) => /^## .*\{#([\w-]+)\}\s*$/.exec(line)?.[1])
      .filter((id): id is string => id !== undefined);
    const outline = ['before', 'connect', 'what-moves', 'when-test-says', 'leaving', 'own-app'];

    expect(ids.filter((id) => outline.includes(id)), key).toEqual(
      outline.filter((id) => id !== 'own-app' || ids.includes('own-app')),
    );
  });

  /**
   * Each source card a served guide covers has a subsection of its own under
   * `connect`, whose id is the card's id, so T4's per-card `guide` field and
   * the checklist can link `google#google-contacts` rather than the family.
   * The IMAP card's guide arrives with T4 and is listed here as pending.
   */
  const CARD_GUIDE: Record<string, string> = {
    microsoft: 'microsoft',
    oauth2: 'microsoft',
    graph: 'microsoft',
    google: 'google',
    'google-drive': 'google',
    gmail: 'google',
    'google-calendar': 'google',
    'google-contacts': 'google',
    dropbox: 'dropbox',
    box: 'box',
    apple: 'apple',
    archive: 'archive',
  };
  const CARD_GUIDE_PENDING = ['imap'];

  it('every source card is either given its guide or listed as pending', () => {
    expect(SOURCE_CARDS.map((card) => card.id).filter((id) => !CARD_GUIDE_PENDING.includes(id)).sort()).toEqual(
      Object.keys(CARD_GUIDE).sort(),
    );
  });

  it.each(SERVED)('%s: each card it covers has its own subsection under connect', (key) => {
    const slug = key.split('/')[1]!.replace(/\.md$/, '');
    const lines = linesOutsideFences(SOURCES[key]!);
    const start = lines.findIndex((line) => /^## .*\{#connect\}\s*$/.test(line));
    const end = lines.findIndex((line, i) => i > start && /^## /.test(line));
    const ids = lines
      .slice(start, end === -1 ? undefined : end)
      .map((line) => /^#{3,4} .*\{#([\w-]+)\}\s*$/.exec(line)?.[1])
      .filter((id): id is string => id !== undefined);
    const cards = Object.entries(CARD_GUIDE)
      .filter(([, guide]) => guide === slug)
      .map(([card]) => card);

    expect(start, `${key} has a connect section`).toBeGreaterThanOrEqual(0);
    for (const card of cards) expect(ids, `${key} has {#${card}} under connect`).toContain(card);
  });

  /**
   * `docs/i18n-prose-boundary.md` class 5: a guide is written in both
   * languages, or the missing one is listed here. The Dutch guides are 0148
   * T4's; the list shrinks as each lands, and a listed guide that exists fails,
   * so the list cannot outlive the gap it names.
   */
  const TRANSLATION_PENDING: Record<Locale, readonly string[]> = {
    nl: ['apple', 'archive', 'box', 'dropbox', 'google', 'microsoft'],
    en: [],
  };

  it.each(['en', 'nl'] as const)('every guide is written in %s, or listed as pending', (locale) => {
    const missing = [...GUIDE_SLUGS].filter((slug) => SOURCES[`${locale}/${slug}`] === undefined).sort();
    expect(missing).toEqual([...TRANSLATION_PENDING[locale]].sort());
  });

  it('the served guides use each feature at least once, so the cases above are not passing on nothing', () => {
    // Counted from the sources, not the render, so this case holds whichever
    // of the cases above is run alone.
    const all = Object.values(SOURCES).map((body) => linesOutsideFences(body));
    const count = (pattern: RegExp) =>
      all.reduce((n, lines) => n + (lines.join('\n').match(pattern) ?? []).length, 0);
    expect(count(/\]\(#[^)]+\)/g)).toBeGreaterThan(0);
    expect(all.reduce((n, lines) => n + boldLinksIn(lines), 0)).toBeGreaterThan(0);
    expect(count(/^\d+\.\s/gm)).toBeGreaterThan(0);
    expect(count(/^ *\d+\. .*\*\*/gm), 'numbered steps that hold bold').toBeGreaterThan(0);
  });

  for (const locale of ['en', 'nl'] as const) {
    it(`the index shows each guide's title, its first heading, in ${locale} or the language it falls back to`, () => {
      const { container } = renderAt('/docs', locale);

      for (const slug of GUIDE_SLUGS) {
        const lang = SOURCES[`${locale}/${slug}`] !== undefined ? locale : locale === 'en' ? 'nl' : 'en';
        const first = linesOutsideFences(SOURCES[`${lang}/${slug}`]!).find((line) => /^#{1,4}\s+/.test(line));
        expect(first, `${lang}/${slug} has a heading`).toBeDefined();
        const title = first!.replace(/^#{1,4}\s+/, '').replace(/\s*\{#[\w-]+\}\s*$/, '');

        const link = container.querySelector(`a[href="/docs/${slug}"]`);
        expect(link?.textContent, slug).toBe(title);
        expect(link?.textContent).not.toBe(slug);
        expect(link?.getAttribute('lang')).toBe(lang);
      }
      expect(within(container).queryByText('box')).toBeNull();
    });
  }
});
