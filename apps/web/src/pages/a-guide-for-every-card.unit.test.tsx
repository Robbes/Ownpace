// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GUIDE FOR EVERY CARD (workplan 0148 T4).
 *
 * Seven of the twenty cards the two doors offer had no guide: the IMAP source
 * and every target. The checklist's *Read the full setup guide* link was
 * hidden for them (it had opened *"There is no guide by that name"*), the
 * wizard had no link at all, and nothing said which guide a card belonged to
 * except two copies of a `guideSlug` function, one in `Setup.tsx` and one in
 * the lint, each mapping the Google and Microsoft families by hand.
 *
 * So each card now carries its own `guide`, `<slug>#<section>`, in
 * `front-door-cards.ts`: the one table both doors already read. The checklist,
 * the wizard and the lint read it, and these cases hold what it promises:
 *
 *  - every source and target card names a guide this build serves, and a
 *    section of its own, a heading under `connect`, in every language the
 *    guide is written in, English always (the owner's D8). The Dutch half is
 *    held by `TRANSLATION_PENDING` in `Docs.unit.test.tsx`: a served guide
 *    missing in Dutch fails there unless it is listed, and none of the guides
 *    this case added is;
 *  - both languages of a guide carry the same section ids, in the same order,
 *    so a link to `dav#webdav` lands in either;
 *  - the `/docs` index lists every guide a card names, in both languages;
 *  - the checklist links the card's own section, and so does the wizard, on
 *    the source step and on the target step.
 *
 * Before this, the IMAP source was listed as pending in `Docs.unit.test.tsx`'s
 * card table (`CARD_GUIDE_PENDING`), and that table covered source cards only.
 * The table is gone: it was a third copy of the map, and its subsection case
 * lives here now, for both sides, read from the cards themselves.
 */

import type { ReactElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS, LOCALES, type Locale } from '../i18n/strings.ts';
import {
  SOURCE_CARDS,
  TARGET_CARDS,
  migratableSourceCards,
  type FrontDoorCard,
} from '../components/front-door-cards.ts';

const { setupGet } = vi.hoisted(() => ({ setupGet: vi.fn() }));

vi.mock('../services/mapping-service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/mapping-service.ts')>()),
  setupApi: { get: setupGet, setStep: vi.fn() },
  mappingApi: { create: vi.fn(), testConnection: vi.fn(), googleAuthorize: vi.fn() },
  connectionsApi: { list: vi.fn().mockResolvedValue([]), test: vi.fn(), add: vi.fn(), rotate: vi.fn() },
  providerAccountsApi: { get: vi.fn().mockResolvedValue({}) },
  providerClientsApi: {
    get: vi.fn().mockResolvedValue({ google: 'connection', dropbox: 'connection', microsoft: 'connection' }),
  },
}));

import Docs, { GUIDE_SLUGS } from './Docs.tsx';
import Setup from './Setup.tsx';
import CreateMapping from './CreateMapping.tsx';

/** Every served guide, `<locale>/<slug>`, through the page's own build-time import. */
const SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob('../../../../docs/guides/*/*.md', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>,
  ).map(([path, body]) => [path.split('/').slice(-2).join('/').replace(/\.md$/, ''), body]),
);

type Role = 'source' | 'target';

/** Every card at both doors, with its side: the IMAP card is on both. */
const CARDS: ReadonlyArray<{ role: Role; id: string; card: FrontDoorCard }> = [
  ...SOURCE_CARDS.map((card) => ({ role: 'source' as const, id: card.id, card })),
  ...TARGET_CARDS.map((card) => ({ role: 'target' as const, id: card.id, card })),
];

/** A card's `guide`, split; undefined when it names none, or not in that shape. */
function guideOf(card: FrontDoorCard): { slug: string; section: string } | undefined {
  const guide = (card as { guide?: unknown }).guide;
  if (typeof guide !== 'string') return undefined;
  const match = /^([a-z0-9-]+)#([a-z0-9-]+)$/.exec(guide);
  return match ? { slug: match[1]!, section: match[2]! } : undefined;
}

/** The source's lines outside fences. */
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

/** Every explicit `{#id}` a guide's headings carry, in order. */
function explicitIds(body: string): string[] {
  return linesOutsideFences(body)
    .map((line) => /^#{1,4} .*\{#([\w-]+)\}\s*$/.exec(line)?.[1])
    .filter((id): id is string => id !== undefined);
}

/** The `{#id}`s of the headings below `## … {#connect}`, to the next `##`. */
function idsUnderConnect(body: string): string[] {
  const lines = linesOutsideFences(body);
  const start = lines.findIndex((line) => /^## .*\{#connect\}\s*$/.test(line));
  if (start === -1) return [];
  const end = lines.findIndex((line, i) => i > start && /^## /.test(line));
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .map((line) => /^#{3,4} .*\{#([\w-]+)\}\s*$/.exec(line)?.[1])
    .filter((id): id is string => id !== undefined);
}

/** The languages a guide is written in. */
const languagesOf = (slug: string): Locale[] => LOCALES.filter((locale) => SOURCES[`${locale}/${slug}`] !== undefined);

beforeEach(() => {
  setupGet.mockReset();
  globalThis.sessionStorage.clear();
  window.localStorage.setItem('ownpace.locale', 'en');
});

describe('every card names its guide section (0148 T4)', () => {
  it('reads twenty cards, and the IMAP card on both sides', () => {
    // Guards the cases below: a card list that came back empty would pass them all.
    expect(CARDS.length).toBe(SOURCE_CARDS.length + TARGET_CARDS.length);
    expect(CARDS.filter((c) => c.id === 'imap').map((c) => c.role)).toEqual(['source', 'target']);
  });

  it.each(CARDS)('$role $id names a guide this build serves, as <slug>#<section>', ({ role, id, card }) => {
    const guide = guideOf(card);
    expect(guide, `the ${role} card '${id}' names no guide as <slug>#<section>`).toBeDefined();
    expect(
      GUIDE_SLUGS.has(guide!.slug),
      `the ${role} card '${id}' names '${guide!.slug}', which docs/guides/ does not serve`,
    ).toBe(true);
  });

  it.each(CARDS)(
    '$role $id: its section is a heading under connect, in every language its guide is written in',
    ({ role, id, card }) => {
      const guide = guideOf(card);
      expect(guide, `the ${role} card '${id}' names no guide`).toBeDefined();
      const languages = languagesOf(guide!.slug);
      // English always (D8); Dutch is held by TRANSLATION_PENDING (see the header).
      expect(languages, `${guide!.slug} is written in English`).toContain('en');
      for (const locale of languages) {
        expect(
          idsUnderConnect(SOURCES[`${locale}/${guide!.slug}`]!),
          `${locale}/${guide!.slug}.md has no {#${guide!.section}} under {#connect} for the ${role} card '${id}'`,
        ).toContain(guide!.section);
      }
    },
  );

  it('gives each card a section of its own, across both sides', () => {
    // Otherwise the three DAV cards could all point at `dav#connect`, and the
    // link would open the family rather than the card somebody picked.
    const guides = CARDS.map(({ card }) => (card as { guide?: string }).guide);
    expect(guides.filter((g) => g === undefined), 'a card names no guide').toEqual([]);
    expect(new Set(guides).size).toBe(guides.length);
  });
});

describe('both languages of a guide carry the same section ids (0148 T4)', () => {
  // One case over every guide written in both languages. Before this change
  // there was none, so it held vacuously; the five guides it came with are
  // written in both from the start.
  it('in the same order, so a link to a section lands in either language', () => {
    const [first, ...rest] = LOCALES;
    for (const slug of [...GUIDE_SLUGS].sort()) {
      if (languagesOf(slug).length !== LOCALES.length) continue;
      for (const locale of rest) {
        expect(explicitIds(SOURCES[`${locale}/${slug}`]!), `${locale}/${slug}.md against ${first}/${slug}.md`).toEqual(
          explicitIds(SOURCES[`${first}/${slug}`]!),
        );
      }
    }
  });
});

/** The page as the app mounts it. */
function renderAt(path: string, element: ReactElement, pattern: string, locale: Locale = 'en') {
  window.localStorage.setItem('ownpace.locale', locale);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={pattern} element={element} />
          </Routes>
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

describe('the /docs index lists every guide a card names (0148 T4)', () => {
  it.each(['en', 'nl'] as const)('%s', (locale) => {
    const { container } = renderAt('/docs', <Docs />, '/docs', locale);
    const named = [...new Set(CARDS.map(({ card }) => guideOf(card)?.slug ?? `(${card.id} names none)`))].sort();
    const missing = named.filter((slug) => container.querySelector(`a[href="/docs/${slug}"]`) === null);
    expect(missing, 'the index does not list these guides').toEqual([]);
  });
});

describe('the checklist links the card’s own section (0148 T4)', () => {
  it.each(CARDS)('$role $id', async ({ role, id, card }) => {
    setupGet.mockResolvedValue({
      side: role,
      provider: id,
      steps: [],
      progress: { total: 0, done: 0, skipped: 0, open: 0, blockedOnOthers: 0, complete: false },
    });
    renderAt(`/setup/${role}/${id}`, <Setup />, '/setup/:side/:provider');

    const link = await screen.findByText(STRINGS.en['setup.fullGuide']);
    const guide = guideOf(card);
    expect(link.getAttribute('href')).toBe(`/docs/${guide?.slug}#${guide?.section}`);
  });
});

describe('the wizard links the picked card’s section (0148 T4)', () => {
  const wizard = () => renderAt('/mappings/new', <CreateMapping />, '/mappings/new');
  const guideLink = () => screen.getByText(STRINGS.en['setup.fullGuide']);
  const nameOf = (card: FrontDoorCard) => card.name ?? STRINGS.en[card.nameKey!];
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pick = (card: FrontDoorCard) =>
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${escape(nameOf(card))}`) }));
  const hrefFor = (card: FrontDoorCard) => {
    const guide = guideOf(card);
    return `/docs/${guide?.slug}#${guide?.section}`;
  };

  it.each(migratableSourceCards().map((card) => ({ id: card.id, card })))('source $id', ({ card }) => {
    wizard();
    pick(card);
    expect(guideLink().getAttribute('href')).toBe(hrefFor(card));
  });

  it('target: every card, on the target step', async () => {
    wizard();
    // The IMAP source is the wizard's default; filling it opens the target step.
    const fieldFor = (label: RegExp) =>
      screen.getByText(label, { selector: 'label' }).parentElement!.querySelector('input')!;
    fireEvent.change(fieldFor(/^Username/), { target: { value: 'anna@example.org' } });
    fireEvent.change(fieldFor(/^Host$/), { target: { value: 'mail.example.org' } });
    fireEvent.change(fieldFor(/^Password/), { target: { value: 'not-a-real-password' } });
    const next = screen.getByRole('button', { name: /^Next$/ });
    await waitFor(() => expect(next).toBeEnabled());
    fireEvent.click(next);
    await screen.findByText(STRINGS.en['wizard.selectTarget']);

    for (const card of TARGET_CARDS) {
      pick(card);
      expect(within(document.body).getByText(STRINGS.en['setup.fullGuide']).getAttribute('href'), card.id).toBe(
        hrefFor(card),
      );
    }
  });
});
