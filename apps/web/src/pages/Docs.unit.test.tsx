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
 * WHAT WAITS FOR T6 (b). The plan's full guard also says no rendered paragraph
 * begins with `|` or `>`. Today's guides still use GFM tables and
 * blockquotes (86 and 64 lines), and tables, blockquotes, continuation lines
 * and indented fences are the renderer's second half, after the first
 * invitation. Asserting them now would fail on content this build does not
 * claim to render, so they are an `it.todo` below rather than a weakened
 * assertion.
 *
 * ONE THING THE FIRST HALF BROKE, AND WHAT KEEPS IT FIXED. A numbered step is
 * now a list item of its own, and its continuation lines are not joined to it
 * until T6 (b); they render as a paragraph after it. While the steps were one
 * run-on paragraph, a bold span could open on a step's line and close on the
 * next. Split, it shows both `**` as text: `archive-setup.md`'s step 5 did.
 * So the served-guides case checks that a bold span opened on a numbered
 * step's line closes on it, and the guides are wrapped to match.
 *
 * "In both languages" is T4's: today every served guide is English, so the
 * served-guides case runs over the one language there is.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import Docs, { GUIDE_SLUGS, GuideArticle, guideTitle } from './Docs.tsx';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/docs" element={<Docs />} />
        <Route path="/docs/:slug" element={<Docs />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Renders a fixture through the same article the page uses, at `/docs/fixture`. */
function renderFixture(body: string, path = '/docs/fixture') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/docs/:slug" element={<GuideArticle body={body} />} />
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
].join('\n');

describe('the in-app setup guides', () => {
  it('renders the repository\'s own Box guide, not a copy of it', () => {
    renderAt('/docs/box-setup');

    // A sentence that exists only in docs/box-setup.md, and which is the whole
    // reason a Box setup stalls (workplan 0056).
    expect(screen.getByText(/Custom Apps Manager/)).toBeTruthy();
  });

  it('ships a guide for each provider that has one', () => {
    const { container } = renderAt('/docs');

    for (const slug of ['box-setup', 'dropbox-setup', 'google-workspace-setup', 'o365-setup']) {
      expect(
        container.querySelector(`a[href="/docs/${slug}"]`),
        `${slug} is referenced by the UI`,
      ).not.toBeNull();
    }
  });

  it('names what DOES exist when a reference is stale, rather than a bare 404', () => {
    const { container } = renderAt('/docs/no-such-guide');

    expect(screen.getByText(/no guide by that name/)).toBeTruthy();
    expect(container.querySelector('a[href="/docs/box-setup"]')).not.toBeNull();
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

/** Every served guide, read through the same build-time import as the page. */
const SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob('../../../../docs/*-setup.md', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>,
  ).map(([path, body]) => [path.split('/').pop()!.replace(/\.md$/, ''), body]),
);

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
    expect(Object.keys(SOURCES).sort()).toEqual([...GUIDE_SLUGS].sort());
    expect(GUIDE_SLUGS.size).toBeGreaterThan(0);
  });

  for (const slug of [...GUIDE_SLUGS].sort()) {
    it(`${slug}: headings with ids, same-tab # links, numbered steps, links in bold, lang`, () => {
      const source = SOURCES[slug]!;
      const lines = linesOutsideFences(source);
      const { container } = renderAt(`/docs/${slug}`);
      const article = container.querySelector('article')!;

      expect(article.getAttribute('lang')).toBe('en');

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

      // No paragraph begins with a numbered step, and numbered lines make a list.
      for (const p of article.querySelectorAll('p')) {
        expect(p.textContent ?? '').not.toMatch(/^\s*\d+\.\s/);
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

  it('the served guides use each feature at least once, so the cases above are not passing on nothing', () => {
    // Today: ten #section links, two links inside bold, numbered steps in four
    // guides (0148 §1). Counted from the sources, not the render, so this case
    // holds whichever of the cases above is run alone.
    const all = Object.values(SOURCES).map((body) => linesOutsideFences(body));
    const count = (pattern: RegExp) =>
      all.reduce((n, lines) => n + (lines.join('\n').match(pattern) ?? []).length, 0);
    expect(count(/\]\(#[^)]+\)/g)).toBeGreaterThan(0);
    expect(all.reduce((n, lines) => n + boldLinksIn(lines), 0)).toBeGreaterThan(0);
    expect(count(/^\d+\.\s/gm)).toBeGreaterThan(0);
    expect(count(/^ *\d+\. .*\*\*/gm), 'numbered steps that hold bold').toBeGreaterThan(0);
  });

  it('the index shows each guide\'s title, its first heading, not its slug', () => {
    const { container } = renderAt('/docs');

    for (const slug of GUIDE_SLUGS) {
      const first = linesOutsideFences(SOURCES[slug]!).find((line) => /^#{1,4}\s+/.test(line));
      expect(first, `${slug} has a heading`).toBeDefined();
      const title = first!.replace(/^#{1,4}\s+/, '').replace(/\s*\{#[\w-]+\}\s*$/, '');

      const link = container.querySelector(`a[href="/docs/${slug}"]`);
      expect(link?.textContent, slug).toBe(title);
      expect(link?.textContent).not.toBe(slug);
      expect(link?.getAttribute('lang')).toBe('en');
    }
    expect(within(container).queryByText('box-setup')).toBeNull();
  });

  it.todo(
    'no rendered paragraph begins with | or > — waits for T6 (b): today\'s guides still use tables and blockquotes',
  );
});
