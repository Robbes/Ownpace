// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * AN ALPHA SAID OUT LOUD (workplan 0131 T1).
 *
 * Nothing told a tester the service was a test. No string in the app or the
 * mails called it an alpha, a beta, a trial or a test (0131 §1). The owner's
 * answer (0131 D1, D4): free, by invitation, a few weeks, no obligations either
 * side, and called an *alpha*.
 *
 * So, while the deployment says so, a note stands at the top of every signed-in
 * page, and under the title of `/login` and `/request-access`, which a tester
 * sees before there is any session: in English and in Dutch. "Every signed-in
 * page" is `Layout`'s AND `/invitations`, which sits outside `Layout` on
 * purpose (0099): an invited member never passes `/request-access` and never
 * receives the grant mail, so that screen is where they first meet the
 * service. And `/request-access` keeps the note after the request is sent.
 *
 * WHAT IT SAYS IS THE OWNER'S WELCOME (0131 D4's amendment, 2026-10-04): *"Welkom
 * bij de Alpha! Probeer Ownpace rustig aan uit, en help anderen makkelijker over
 * te stappen naar Europese alternatieven."*, and its English translation
 * *"Welcome to the Alpha! Try Ownpace at your own pace, and help others move to
 * European alternatives more easily."* Then its two links, and nothing else (the
 * owner: *"Welcome only"*). Until then the note said what the Alpha means:
 * nothing charged, it can end, no backups apart from one copy, keep the old
 * account. Those facts are no longer in the note. Both mails carry them, word
 * for word, after the same welcome (the owner: *"Welcome, then the facts"*). The
 * Alpha conditions and the tester guide say them too. The last cases below hold
 * that split: the note is exactly the welcome and its links, and both mails
 * open their Alpha paragraph with the note's own words and then give the facts.
 *
 * WITHOUT THE SETTING, NONE OF IT. The OTA stack and every other deployment
 * carry no note. And an APPLIANCE never does, whatever its bundle was built
 * with: an appliance lets nobody in, so there is no alpha for it to be in.
 *
 * AND IT LINKS WHAT A TESTER READS NEXT (0131 T1 (b), 2026-10-04). After its
 * words the note links the Alpha conditions and the tester guide (0144 T1), in
 * the reader's language, each named by its own title, in a new tab, as every
 * other link to the texts is (`LegalLinks`). Shown always, also before the
 * site has them (the owner, 2026-10-03: *"Always shown"*). The addresses are
 * the modules' (`services/legal-links.ts`, `services/tester-guide-link.ts`),
 * wrapped here so their default is the OTA test site: a page that wrote the
 * production address itself would show a link this file does not find.
 *
 * The setting is a build argument, `VITE_OWNPACE_STAGE`, stubbed here the way
 * Vite would bake it (`isAlpha` in `AlphaNote.tsx` reads it directly so this
 * works).
 * The edition is mocked through `services/edition`, the sanctioned seam.
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderEvent } from '@openmig/shared';

const { OTA, editionFlag, authState } = vi.hoisted(() => ({
  /** The OTA stack's test site: the address modules' default for every page here. */
  OTA: { VITE_LEGAL_SITE_URL: 'https://www.ota.ownpace.eu' },
  editionFlag: { selfhost: false },
  authState: {
    isAuthenticated: true,
    user: null as null | { name: string; email: string; role?: string },
    login: () => {},
    logout: () => {},
    operator: false,
    tenantCount: 1,
  },
}));

vi.mock('../services/edition.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/edition.ts')>();
  return { ...actual, isSelfHost: () => editionFlag.selfhost };
});

vi.mock('../services/legal-links.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof LegalLinks>();
  return {
    ...actual,
    legalUrl: (page: LegalLinks.LegalPage, locale: Locale, source: LegalLinks.LegalSiteEnv = OTA) =>
      actual.legalUrl(page, locale, source),
    legalLinks: (locale: Locale, source: LegalLinks.LegalSiteEnv = OTA) => actual.legalLinks(locale, source),
  };
});

vi.mock('../services/tester-guide-link.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof GuideLink>();
  return {
    ...actual,
    testerGuideUrl: (locale: Locale, source: LegalLinks.LegalSiteEnv = OTA) => actual.testerGuideUrl(locale, source),
  };
});

vi.mock('../stores/auth-store.ts', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) =>
    selector ? selector(authState) : authState,
}));

// The layout's header reads a migration's name; nothing here is on one.
vi.mock('../services/mapping-service.ts', () => ({
  mappingApi: { get: () => new Promise<never>(() => {}) },
}));

// The sign-in page asks the API what it accepts before it offers anything. The
// note does not wait for that answer: it is there while the page is checking,
// and it is there when the API cannot be asked at all.
vi.mock('../services/auth-mode.ts', () => ({
  fetchAuthMode: () => new Promise<never>(() => {}),
}));

import Layout from './Layout.tsx';
import Login from '../pages/Login.tsx';
import RequestAccess from '../pages/RequestAccess.tsx';
import Invitations from '../pages/Invitations.tsx';
import apiClient from '../services/api.ts';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';
import type * as LegalLinks from '../services/legal-links.ts';
import type * as GuideLink from '../services/tester-guide-link.ts';

/**
 * The owner's welcome (0131 D4's amendment, 2026-10-04): the owner's Dutch, and
 * its English translation. The whole of what the note says. `lead` is its first
 * sentence, the bold one. "Welkom in bij" in the owner's message is read as
 * "Welkom bij".
 */
const SAID = {
  en: {
    lead: 'Welcome to the Alpha!',
    welcome:
      'Welcome to the Alpha! Try Ownpace at your own pace, and help others move to European ' +
      'alternatives more easily.',
  },
  nl: {
    lead: 'Welkom bij de Alpha!',
    welcome:
      'Welkom bij de Alpha! Probeer Ownpace rustig aan uit, en help anderen makkelijker over te ' +
      'stappen naar Europese alternatieven.',
  },
} as const;

/**
 * The note's second paragraph, as a reader meets it: the two links by the
 * names the owner gave them (*"Voorwaarden voor de Alpha · Handleiding voor de
 * Alpha"*), each with its new tab said. Literals, not the dictionary, so a
 * word slipped into a link's name is not let in unseen.
 */
const LINKS = {
  en: 'Alpha conditions (opens in a new tab) · Guide to the Alpha (opens in a new tab)',
  nl: 'Voorwaarden voor de Alpha (opent in een nieuw tabblad) · Handleiding voor de Alpha (opent in een nieuw tabblad)',
} as const;

/**
 * What the Alpha means, word for word as the note said it until 2026-10-04 and
 * as both mails still say it after the welcome. The copy before an update is
 * the Alpha conditions §6 and privacy §9 (0139 T4, ops-app-sentences (a)).
 */
const FACTS = {
  en: [
    'Nothing is charged, and the Alpha can end.',
    'There are no backups, apart from one copy before each update, kept up to 7 days.',
    'Keep your old account until you have checked what arrived.',
  ],
  nl: [
    'Er wordt niets in rekening gebracht en de Alpha kan stoppen.',
    'Er worden geen back-ups gemaakt, op één kopie vlak voor elke update na, die hoogstens 7 dagen wordt bewaard.',
    'Houd uw oude account tot u hebt gecontroleerd wat er is aangekomen.',
  ],
} as const;

type Locale = keyof typeof SAID;
const LOCALES = Object.keys(SAID) as Locale[];

const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

/** Each page as the app mounts it: inside the real LocaleProvider, on its own route. */
const PAGES = {
  layout: () =>
    render(
      <QueryClientProvider client={client()}>
        <LocaleProvider>
          <MemoryRouter initialEntries={['/dashboard']}>
            <Routes>
              <Route path="/" element={<Layout />}>
                <Route path="*" element={<div>page-body</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </LocaleProvider>
      </QueryClientProvider>,
    ),
  login: () =>
    render(
      <QueryClientProvider client={client()}>
        <LocaleProvider>
          <MemoryRouter initialEntries={['/login']}>
            <Login />
          </MemoryRouter>
        </LocaleProvider>
      </QueryClientProvider>,
    ),
  requestAccess: () =>
    render(
      <QueryClientProvider client={client()}>
        <LocaleProvider>
          <MemoryRouter initialEntries={['/request-access']}>
            <RequestAccess />
          </MemoryRouter>
        </LocaleProvider>
      </QueryClientProvider>,
    ),
  /** The same page once the request has gone: the form is replaced by a confirmation. */
  requestAccessSent: async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { received: true } });
    render(
      <QueryClientProvider client={client()}>
        <LocaleProvider>
          <MemoryRouter initialEntries={['/request-access?email=tester%40example.test']}>
            <RequestAccess />
          </MemoryRouter>
        </LocaleProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(document.querySelector('form button[type="submit"]') as HTMLElement);
    await waitFor(() => expect(document.querySelector('form')).toBeNull());
  },
  /** Signed in, outside `Layout` (0099). No token in the store, so it asks nothing. */
  invitations: () =>
    render(
      <QueryClientProvider client={client()}>
        <LocaleProvider>
          <MemoryRouter initialEntries={['/invitations']}>
            <Invitations />
          </MemoryRouter>
        </LocaleProvider>
      </QueryClientProvider>,
    ),
} as const;

type Page = keyof typeof PAGES;
const PAGE_NAMES = Object.keys(PAGES) as Page[];

const inLocale = (locale: Locale) => window.localStorage.setItem('ownpace.locale', locale);

/** Text as a reader meets it: every run of white space one space. */
const flat = (text: string | null): string => (text ?? '').replace(/\s+/g, ' ').trim();

/** The note, found by its first sentence and returned as the element that carries the role. */
function theNote(locale: Locale): HTMLElement {
  const lead = screen.getByText(SAID[locale].lead);
  const note = lead.closest('[role="note"]');
  expect(note, 'the alpha sentence is on the page but not inside a role="note"').not.toBeNull();
  return note as HTMLElement;
}

/** Nothing on the page names an alpha, in either language, or links its texts. */
function noAlphaAnywhere(): void {
  for (const locale of LOCALES) {
    expect(screen.queryByText(SAID[locale].lead)).toBeNull();
  }
  expect(document.body.textContent ?? '').not.toMatch(/\balpha\b|\balfa\b/i);
  const alphaLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
    .map((a) => a.href)
    .filter((href) => /(?:alpha\.html|alpha-guide\.html|al(?:ph|f)a-handleiding\.html)$/.test(href));
  expect(alphaLinks, 'a page outside the alpha links the Alpha conditions or the guide').toEqual([]);
}

/**
 * Where the note's two links go, in a language, on the site the pages were
 * given: the real modules, asked with the OTA site.
 */
async function addresses(locale: Locale): Promise<{ conditions: string; guide: string }> {
  const legal = await vi.importActual<typeof LegalLinks>('../services/legal-links.ts');
  const guide = await vi.importActual<typeof GuideLink>('../services/tester-guide-link.ts');
  return { conditions: legal.legalUrl('alpha', locale, OTA), guide: guide.testerGuideUrl(locale, OTA) };
}

beforeEach(() => {
  editionFlag.selfhost = false;
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('with the alpha setting on', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_OWNPACE_STAGE', 'alpha');
  });

  for (const page of PAGE_NAMES) {
    it.each(LOCALES)(`${page} says the owner's welcome, and then only its two links, in %s`, async (locale) => {
      inLocale(locale);
      await PAGES[page]();
      const note = theNote(locale);
      // Two paragraphs: the welcome, word for word, and the links by their
      // names, each with its new tab said. No text stands outside them, so
      // nothing can come back into the note unseen ("Welcome only").
      const paragraphs = Array.from(note.children);
      expect(paragraphs.map((p) => p.tagName)).toEqual(['P', 'P']);
      const said = paragraphs.map((p) => flat(p.textContent));
      expect(said).toEqual([SAID[locale].welcome, LINKS[locale]]);
      expect(note.textContent).toBe(paragraphs.map((p) => p.textContent).join(''));
      // The first sentence is the bold lead, and nothing else in the note is
      // bold.
      expect(within(note).getByText(SAID[locale].lead)).toHaveClass('font-medium');
      const bold = note.querySelectorAll('.font-medium, .font-semibold, .font-bold, strong, b');
      expect(Array.from(bold, (el) => el.textContent)).toEqual([SAID[locale].lead]);
    });
  }

  it('stands at the top of every signed-in page, above the page itself', () => {
    PAGES.layout();
    const note = theNote('en');
    const body = screen.getByText('page-body');
    expect(note.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // In the page's own column, where the platform hold's banner is, not in
    // the sidebar a phone folds away.
    expect(note.closest('main')).not.toBeNull();
  });

  it.each([
    // What each page shows below its title: the sign-in page's line while it
    // asks the API what it accepts, the request form's first field, the way
    // back to sign-in once the request has gone, and the invitation screen's
    // closing line.
    ['login', 2, () => screen.getByText(/checking how this deployment/i)],
    ['requestAccess', 2, () => screen.getByLabelText(/email address/i)],
    ['requestAccessSent', 2, () => screen.getByRole('link', { name: /sign in/i })],
    ['invitations', 1, () => screen.getByText(/not now changes nothing/i)],
  ] as const)('%s: stands under the title, above the rest of the page', async (page, level, rest) => {
    await PAGES[page]();
    const title = screen.getByRole('heading', { level });
    const note = theNote('en');
    expect(title.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.compareDocumentPosition(rest()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  for (const page of PAGE_NAMES) {
    it.each(LOCALES)(
      `${page}: after its words, links the Alpha conditions and the tester guide, in %s, in a new tab`,
      async (locale) => {
        inLocale(locale);
        await PAGES[page]();
        const note = theNote(locale);
        const links = within(note).getAllByRole('link') as HTMLAnchorElement[];
        const want = await addresses(locale);
        // The conditions first, as the texts that bind; then the guide.
        expect(links.map((a) => a.href)).toEqual([want.conditions, want.guide]);
        const names = [STRINGS[locale]['acceptance.doc.alpha'], STRINGS[locale]['alpha.note.guide']];
        links.forEach((link, i) => {
          // Each named by its own title, and the new tab said out loud.
          const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          expect(link).toHaveAccessibleName(
            new RegExp(`^${escaped(names[i]!)}\\s*${escaped(STRINGS[locale]['acceptance.newTab'])}$`),
          );
          expect(link.target).toBe('_blank');
          expect(link.rel).toMatch(/\bnoopener\b/);
          expect(link.rel).toMatch(/\bnoreferrer\b/);
          // After the words, never in the middle of them.
          const lead = within(note).getByText(SAID[locale].lead);
          expect(lead.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        });
      },
    );
  }

  it('names the guide by its own title, the page the link opens', () => {
    // The site's page title, without " — Ownpace" (site/build.mjs, META.guide).
    expect(STRINGS.en['alpha.note.guide']).toBe('Guide to the Alpha');
    expect(STRINGS.nl['alpha.note.guide']).toBe('Handleiding voor de Alpha');
  });

  it('names the conditions as the owner named them, the new tab said in words', () => {
    // The owner: "Voorwaarden voor de Alpha · Handleiding voor de Alpha".
    expect(STRINGS.en['acceptance.doc.alpha']).toBe('Alpha conditions');
    expect(STRINGS.nl['acceptance.doc.alpha']).toBe('Voorwaarden voor de Alpha');
    expect(STRINGS.en['acceptance.newTab']).toBe('(opens in a new tab)');
    expect(STRINGS.nl['acceptance.newTab']).toBe('(opent in een nieuw tabblad)');
  });

  it('is a note, never an alarm', () => {
    // A standing welcome, not a failure. `role="alert"` would be read out on
    // every page a screen reader opens.
    PAGES.layout();
    expect(theNote('en')).toHaveAttribute('role', 'note');
    expect(theNote('en').closest('[role="alert"]')).toBeNull();
  });
});

describe('without the setting', () => {
  for (const page of PAGE_NAMES) {
    it.each(LOCALES)(`${page} says nothing about an alpha, in %s`, async (locale) => {
      inLocale(locale);
      await PAGES[page]();
      noAlphaAnywhere();
    });
  }

  it('and a value that is not "alpha" is not the alpha', () => {
    vi.stubEnv('VITE_OWNPACE_STAGE', 'beta');
    PAGES.layout();
    noAlphaAnywhere();
  });
});

describe('on an appliance, never', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_OWNPACE_STAGE', 'alpha');
    editionFlag.selfhost = true;
  });

  for (const page of PAGE_NAMES) {
    it.each(LOCALES)(`${page} says nothing about an alpha, in %s, even built with the setting`, async (locale) => {
      inLocale(locale);
      await PAGES[page]();
      noAlphaAnywhere();
    });
  }
});

describe('both Alpha mails open with the note\'s welcome, then say what the note no longer does', () => {
  /**
   * The two mails that carry the Alpha paragraph, as the API builds them during
   * the Alpha (`accessGrantedEvent`, and the invitation route, 0156 T3).
   */
  const MAILS = {
    access_granted: {
      kind: 'access_granted',
      organisation: 'Familie de Vries',
      appUrl: 'https://app.ownpace.eu',
      email: 'stranger@example.test',
      alpha: true,
    },
    member_invited: {
      kind: 'member_invited',
      organisation: 'Familie Berentsen',
      invitedBy: 'rob@example.test',
      appUrl: 'https://app.ownpace.eu',
      email: 'test@ownpace.test',
      privacyPolicy: 'https://www.ownpace.eu/privacy.html',
      alpha: true,
    },
  } as const;

  beforeEach(() => {
    vi.stubEnv('VITE_OWNPACE_STAGE', 'alpha');
  });

  for (const [kind, event] of Object.entries(MAILS)) {
    it.each(LOCALES)(`${kind}, in %s: the note's words, as the page shows them, then the facts word for word`, (locale) => {
      inLocale(locale);
      PAGES.layout();
      // Read from the note itself, so the mail follows what a tester sees.
      const welcome = flat(theNote(locale).querySelector('p')!.textContent);
      expect(welcome).toBe(SAID[locale].welcome);
      const alpha = renderEvent(event, locale)
        .body.split('\n\n')
        .filter((paragraph) => paragraph.startsWith(SAID[locale].lead));
      expect(alpha, 'no paragraph of the mail opens with the welcome, or more than one does').toHaveLength(1);
      // The paragraph's first line; the conditions and the guide follow it
      // when the API hands their addresses (`an-invitation-that-says-who-asked`).
      expect(alpha[0]!.split('\n')[0]).toBe([welcome, ...FACTS[locale]].join(' '));
    });
  }

  it.each(LOCALES)('and the note itself carries none of those facts, in %s', (locale) => {
    inLocale(locale);
    PAGES.layout();
    const note = document.querySelector('[role="note"]');
    expect(note, 'no alpha note with the setting on').not.toBeNull();
    for (const fact of FACTS[locale]) expect(flat(note!.textContent)).not.toContain(fact);
  });
});
