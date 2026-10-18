// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * CONNECTING GOOGLE DURING THE ALPHA (the owner, 2026-10-18; the UX sweep's
 * journey-google-alpha-hurdles, its lighter option).
 *
 * While Ownpace's app at Google is in Google's test phase, a Google address
 * that is not on the list of test users ends on Google's *Access blocked*
 * page, and Google first warns that it has not checked the app. The tester
 * guide says both; the app said neither. The owner chose one line, not the
 * guide's sentences repeated: *"Connecting Google during the Alpha? Read this
 * first: When you connect Google"*, the last words a link to that section of
 * the guide, in the reader's language.
 *
 * Pinned here:
 *  - the line, in English and Dutch, with its link to the guide's section:
 *    `#google-connect` on the English guide, `#google-koppelen` on the Dutch
 *    one, and named by that section's own heading, read from the guide's
 *    source (`site/pages/`), so a renamed or removed section fails here and
 *    not on a tester's screen;
 *  - a new tab, said, as every link to the site's pages is (`LegalLinks`);
 *  - only while the deployment runs the Alpha, and never on the appliance;
 *  - where it stands: above the first Google card on *Connect your accounts*
 *    (and nowhere on that screen without one), and above the Google button on
 *    the grant page, for a migration's link and for a person's; on a person's
 *    link, above the first account that still has a button (after any card
 *    already connected), and nowhere when no account has one.
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DISCOVERY_DOMAINS } from '@openmig/shared';

const { edition, readMock } = vi.hoisted(() => ({ edition: { selfhost: false }, readMock: vi.fn() }));

vi.mock('../services/edition.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/edition.ts')>();
  return { ...actual, isSelfHost: () => edition.selfhost };
});
vi.mock('../services/grant-service.ts', () => ({
  grantApi: { read: readMock, authorize: vi.fn() },
}));
vi.mock('../services/link-report-service.ts', () => ({
  linkReportApi: { available: vi.fn().mockResolvedValue(false), send: vi.fn() },
}));
vi.mock('../services/grant-link-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/grant-link-service.ts')>()),
  personLinkApi: { list: vi.fn(), issue: vi.fn(), revoke: vi.fn() },
}));
vi.mock('../services/operating-service', () => ({
  fetchPeople: vi.fn(),
  createPerson: vi.fn(),
  addMigrationToPerson: vi.fn(),
}));
vi.mock('../services/mapping-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/mapping-service.ts')>()),
  providerAccountsApi: { get: vi.fn() },
  providerClientsApi: { get: vi.fn() },
  connectionsApi: { list: vi.fn(), add: vi.fn(), remove: vi.fn(), folders: vi.fn() },
  mappingApi: { create: vi.fn(), start: vi.fn(), discover: vi.fn(), getDiscovery: vi.fn(), get: vi.fn() },
  scopeManifestApi: { get: vi.fn() },
}));

import { AlphaGoogleLine } from './AlphaGoogleLine.tsx';
import Grant from '../pages/Grant.tsx';
import StartMigration from '../pages/StartMigration.tsx';
import { LocaleProvider } from '../i18n/index.tsx';
import { fetchPeople } from '../services/operating-service.ts';
import { connectionsApi, providerAccountsApi, providerClientsApi } from '../services/mapping-service.ts';
import { TESTER_GUIDE_FILES } from '../services/tester-guide-link.ts';

type Locale = 'en' | 'nl';
const LOCALES: ReadonlyArray<Locale> = ['en', 'nl'];

/** The line as a reader meets it, the link's new tab included. Literals, so a word slipped in is seen. */
const SAID: Readonly<Record<Locale, string>> = {
  en: 'Connecting Google during the Alpha? Read this first: When you connect Google (opens in a new tab)',
  nl: 'Koppelt u Google tijdens de Alpha? Lees eerst: Als u Google koppelt (opent in een nieuw tabblad)',
};

/** The guide's section, in the reader's language, on the production site (no `VITE_LEGAL_SITE_URL` here). */
const TARGET: Readonly<Record<Locale, string>> = {
  en: 'https://www.ownpace.eu/alpha-guide.html#google-connect',
  nl: 'https://www.ownpace.eu/nl/alpha-handleiding.html#google-koppelen',
};

const REPO = join(import.meta.dirname, '..', '..', '..', '..');

/** The heading of the guide's section with this id, as the guide's own source writes it. */
function sectionHeading(locale: Locale, id: string): string | undefined {
  const source = join(REPO, 'site', 'pages', locale, `${basename(TESTER_GUIDE_FILES[locale], '.html')}.md`);
  const line = readFileSync(source, 'utf8')
    .split('\n')
    .find((l) => l.trimEnd().endsWith(`{#${id}}`));
  return line?.replace(/^#+\s+/, '').replace(/\s*\{#[a-z0-9-]+\}\s*$/, '');
}

const inAlpha = () => vi.stubEnv('VITE_OWNPACE_STAGE', 'alpha');

beforeEach(() => {
  vi.clearAllMocks();
  edition.selfhost = false;
  globalThis.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  globalThis.localStorage.clear();
});

function inLocale(locale: Locale, node: React.ReactNode) {
  globalThis.localStorage.setItem('ownpace.locale', locale);
  return render(<LocaleProvider>{node}</LocaleProvider>);
}

/** True when `a` comes before `b` in the document. */
const before = (a: Node, b: Node): boolean =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe('the line, while the Alpha runs', () => {
  for (const locale of LOCALES) {
    it(`${locale}: says to read the guide's Google section first, and links it in a new tab`, () => {
      inAlpha();
      inLocale(locale, <AlphaGoogleLine />);
      const note = screen.getByRole('note');
      expect(note.textContent).toBe(SAID[locale]);
      const link = within(note).getByRole('link');
      expect(link).toHaveAttribute('href', TARGET[locale]);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link.getAttribute('rel')).toMatch(/noopener/);
    });

    it(`${locale}: the link is named by the guide's own heading for that section, which exists`, () => {
      inAlpha();
      inLocale(locale, <AlphaGoogleLine />);
      const id = new URL(TARGET[locale]).hash.slice(1);
      const heading = sectionHeading(locale, id);
      expect(heading, `the ${locale} guide has no section {#${id}}`).toBeTruthy();
      expect(screen.getByRole('link').firstChild?.textContent).toBe(heading);
    });
  }

  it('says nothing on a deployment that does not run the Alpha', () => {
    const { container } = inLocale('en', <AlphaGoogleLine />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says nothing on the appliance, whatever its bundle was built with', () => {
    inAlpha();
    edition.selfhost = true;
    const { container } = inLocale('nl', <AlphaGoogleLine />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('on Connect your accounts (Start a migration, step 4)', () => {
  const renderStart = () =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/start']}>
          <Routes>
            <Route path="/start" element={<StartMigration />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

  beforeEach(() => {
    vi.mocked(fetchPeople).mockResolvedValue({ people: [], unassigned: [] });
    vi.mocked(providerAccountsApi.get).mockResolvedValue({
      google: { domains: [...DISCOVERY_DOMAINS], client: 'deployment' },
      microsoft: { domains: [...DISCOVERY_DOMAINS] },
    } as never);
    vi.mocked(providerClientsApi.get).mockResolvedValue({
      google: 'deployment',
      dropbox: 'deployment',
      microsoft: 'deployment',
    });
    vi.mocked(connectionsApi.list).mockResolvedValue([]);
  });

  /** Walk to *Connect your accounts* with these tiles ticked, and what moves left as it is. */
  async function toConnect(tiles: string[]) {
    const user = userEvent.setup();
    renderStart();
    await user.type(await screen.findByLabelText('Name'), 'Anna Jansen');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    for (const tile of tiles) await user.click(screen.getByRole('checkbox', { name: new RegExp(`^${tile}`) }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { level: 2, name: 'What moves?' });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { level: 2, name: 'Connect your accounts' });
  }

  it('stands above the first Google card while the Alpha runs', async () => {
    inAlpha();
    await toConnect(['Google', 'Another mail provider']);
    const note = screen.getByRole('note');
    expect(note.textContent).toBe(SAID.en);
    const cards = screen.getAllByRole('listitem');
    const google = cards.find((c) => within(c).queryAllByText(/^Google/).length > 0);
    expect(google, 'no Google card on the screen').toBeDefined();
    expect(before(note, google!)).toBe(true);
    // The line stands above the list, and Google's cards come first in it
    // (the tiles' order), so it is above the first Google card and no other.
    expect(cards[0]).toBe(google);
    expect(cards.some((c) => before(c, note))).toBe(false);
  });

  it('is not there without a Google card', async () => {
    inAlpha();
    await toConnect(['Another mail provider']);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('is not there outside the Alpha', async () => {
    await toConnect(['Google']);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});

describe('on the grant page', () => {
  const SUBJECT = {
    organisation: 'Acme Legal',
    checkedCompany: null,
    askedBy: 'owner@example.org',
    organisationPhone: null,
    domains: ['calendar'],
    scope: 'https://www.googleapis.com/auth/calendar.readonly openid https://www.googleapis.com/auth/userinfo.email',
    readOnlyAtProvider: false,
    from: 'someone@example.invalid',
    to: { provider: 'nextcloud', host: 'cloud.example.org', account: 'dest@example.org' },
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  };

  const PERSON = {
    kind: 'person',
    organisation: 'Acme Legal',
    checkedCompany: null,
    askedBy: 'owner@example.org',
    organisationPhone: null,
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    accounts: [
      {
        account: 'anna@gmail.com',
        granted: false,
        domains: ['calendar'],
        scope: 'https://www.googleapis.com/auth/calendar',
        readOnlyAtProvider: false,
        notReady: null,
        migrations: [
          { domains: ['calendar'], to: { provider: 'nextcloud', host: 'cloud.example.org', account: 'anna' }, granted: false },
        ],
      },
    ],
  };

  function renderGrant(locale: Locale) {
    globalThis.localStorage.setItem('ownpace.locale', locale);
    return render(
      <LocaleProvider>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter initialEntries={['/grant/abc.def']}>
            <Routes>
              <Route path="/grant/:link" element={<Grant />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </LocaleProvider>,
    );
  }

  const BUTTON: Readonly<Record<Locale, RegExp>> = { en: /^Continue with Google/, nl: /^Doorgaan met Google/ };

  for (const locale of LOCALES) {
    it(`${locale}: a migration's link has the line above the Google button while the Alpha runs`, async () => {
      inAlpha();
      readMock.mockResolvedValue(SUBJECT);
      renderGrant(locale);
      const button = await screen.findByRole('button', { name: BUTTON[locale] });
      const note = screen.getByRole('note');
      expect(note.textContent).toBe(SAID[locale]);
      expect(within(note).getByRole('link')).toHaveAttribute('href', TARGET[locale]);
      expect(before(note, button)).toBe(true);
    });

    it(`${locale}: a person's link has it above the first Google button`, async () => {
      inAlpha();
      readMock.mockResolvedValue(PERSON);
      renderGrant(locale);
      const button = await screen.findByRole('button', { name: BUTTON[locale] });
      expect(before(screen.getByRole('note'), button)).toBe(true);
      expect(screen.getByRole('note').textContent).toBe(SAID[locale]);
    });

    it(`${locale}: a person's link whose first account is connected has it after that card, above the button`, async () => {
      inAlpha();
      readMock.mockResolvedValue({
        ...PERSON,
        accounts: [
          { ...PERSON.accounts[0], granted: true },
          { ...PERSON.accounts[0], account: 'anna.work@gmail.com' },
        ],
      });
      renderGrant(locale);
      const button = await screen.findByRole('button', { name: BUTTON[locale] });
      const connected = screen.getByRole('region', { name: 'anna@gmail.com' });
      const waiting = screen.getByRole('region', { name: 'anna.work@gmail.com' });
      const note = screen.getByRole('note');
      expect(note.textContent).toBe(SAID[locale]);
      expect(within(connected).queryByRole('button')).not.toBeInTheDocument();
      expect(waiting).toContainElement(button);
      // Between the connected card and the card with the button: right above
      // the button a reader presses, not above a card that needs nothing.
      expect(before(connected, note)).toBe(true);
      expect(before(note, waiting)).toBe(true);
    });
  }

  const CONNECTED: Readonly<Record<Locale, RegExp>> = { en: /^Connected\./, nl: /^Verbonden\./ };

  for (const locale of LOCALES) {
    it(`${locale}: a person's link with every account connected has no line`, async () => {
      inAlpha();
      readMock.mockResolvedValue({ ...PERSON, accounts: [{ ...PERSON.accounts[0], granted: true }] });
      renderGrant(locale);
      await screen.findByText(CONNECTED[locale]);
      expect(screen.queryByRole('button', { name: BUTTON[locale] })).not.toBeInTheDocument();
      expect(screen.queryByRole('note')).not.toBeInTheDocument();
    });
  }

  it("a person's link with no account ready to connect has no line", async () => {
    inAlpha();
    readMock.mockResolvedValue({
      ...PERSON,
      accounts: [
        { ...PERSON.accounts[0], granted: true },
        {
          ...PERSON.accounts[0],
          account: 'anna.work@gmail.com',
          notReady: { reason: 'Not ready yet.', reasonNl: 'Nog niet klaar.' },
        },
      ],
    });
    renderGrant('en');
    await screen.findByText('Not ready yet.');
    expect(screen.queryByRole('button', { name: BUTTON.en })).not.toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('has no line outside the Alpha', async () => {
    readMock.mockResolvedValue(SUBJECT);
    renderGrant('en');
    await screen.findByRole('button', { name: BUTTON.en });
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});
