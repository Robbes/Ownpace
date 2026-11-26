// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A PAGE IN THE VOICE CHOSEN FOR THEM (workplan 0176 §11, T7; D8 (a); the
 * owner, 2026-11-26: *"Yes"* to *je* or *u* as the member chooses, per
 * person).
 *
 * The member chooses where a link is made how the person's pages speak to
 * them: Dutch with *u*, Dutch with *je*, or English. Both pages' answers say
 * it as a `language` and a `register`, and the pages read by them:
 *
 *  - **the register:** in Dutch with *je*, every sentence the page says is
 *    the informal layer's twin where it has one, and the Dutch where it needs
 *    none: no *u* or *uw* is left on the page. With *u*, the page is as it was;
 *    English has one *you*;
 *  - **the language:** the page opens in the language chosen for the person,
 *    until the reader picks another with the switch, which then wins, as it
 *    always has. A pick made before, in this browser, wins too. The choice is
 *    never kept for the member's own screens;
 *  - **what the page words outside React** (`tActive`) says *je* while a
 *    person's page says *je*, and *u* again once it is gone.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, RouterProvider, Route, Routes, createMemoryRouter } from 'react-router';
import { InTheirVoice, LocaleProvider } from '../i18n/index.tsx';
import { tActive } from '../i18n/active-locale.ts';
import { STRINGS } from '../i18n/strings.ts';
import { NL_JE } from '../i18n/informal.ts';

const { grantReadMock, viewReadMock } = vi.hoisted(() => ({ grantReadMock: vi.fn(), viewReadMock: vi.fn() }));

vi.mock('../services/grant-service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/grant-service.ts')>()),
  grantApi: { read: grantReadMock, authorize: vi.fn(), authorizeDrive: vi.fn(), password: vi.fn() },
}));
vi.mock('../services/view-service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/view-service.ts')>()),
  viewApi: { read: viewReadMock, withdraw: vi.fn(), withdrawAccount: vi.fn(), withdrawDestination: vi.fn() },
}));
vi.mock('../services/link-report-service.ts', () => ({
  linkReportApi: { available: vi.fn(async () => false), send: vi.fn() },
}));
vi.mock('../services/api.ts', () => ({ default: {}, serverMessage: () => 'a server sentence' }));

import Grant from './Grant.tsx';
import View from './View.tsx';

const LINK = 'p.a1b2c3.the-secret-part';
const IN_A_WEEK = new Date(Date.now() + 7 * 86_400_000).toISOString();

const GMAIL = {
  ref: 'ref-gmail',
  role: 'source',
  way: 'sign-in',
  provider: 'google',
  account: 'anna@work.example',
  granted: false,
  again: false,
  domains: ['email'],
  scope: 'https://mail.google.com/ openid',
  readOnlyAtProvider: false,
  notReady: null,
  migrations: [
    { domains: ['email'], to: { provider: 'soverin', host: null, account: 'anna@soverin.net' }, granted: false, theOrganisationOpensIt: true },
  ],
};

const linkPage = (over: Record<string, unknown> = {}) => ({
  kind: 'person',
  organisation: 'Acme Families',
  checkedCompany: null,
  askedBy: 'owner@example.org',
  sender: { name: 'Pat', relation: 'daughter', phone: '+31 6 1234 5678' },
  organisationPhone: '+31 20 123 4567',
  accounts: [GMAIL],
  expiresAt: IN_A_WEEK,
  addressChanges: [],
  ...over,
});

const progressPage = (over: Record<string, unknown> = {}) => ({
  kind: 'person',
  organisation: 'Acme Families',
  expiresAt: IN_A_WEEK,
  accounts: [{ ref: 'acct-1', grant: { state: 'granted' } }],
  migrations: [
    {
      from: 'gmail',
      to: 'soverin',
      state: 'active',
      started: true,
      account: 'acct-1',
      theOrganisationOpensIt: true,
      domains: [
        {
          domain: 'email',
          state: 'in_progress',
          itemsSynced: 4211,
          itemsFailed: 0,
          bytesTransferred: 91_000_000,
          itemsRetrying: 0,
          itemsNeedingDecision: 0,
          itemsFound: 5000,
          stage: 'copying',
        },
      ],
    },
  ],
  destinations: [],
  sender: { name: 'Pat', relation: 'daughter', phone: '+31 6 1234 5678' },
  organisationPhone: '+31 20 123 4567',
  addressChanges: [],
  ...over,
});

/** The reader's pick with the switch, kept in this browser, or none. */
function picked(locale: 'en' | 'nl' | null) {
  if (locale === null) window.localStorage.removeItem('ownpace.locale');
  else window.localStorage.setItem('ownpace.locale', locale);
}

function renderLinkPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/grant/:link', element: <Grant /> }], { initialEntries: [`/grant/${LINK}`] });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <RouterProvider router={router} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

function renderProgressPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <MemoryRouter initialEntries={['/view/p.abc.def']}>
          <Routes>
            <Route path="/view/:link" element={<View />} />
          </Routes>
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

/** *U* or *uw* as a word: the page speaking to its reader formally. */
const FORMAL = /(?<![\p{L}\p{N}])(u|uw)(?![\p{L}\p{N}])/iu;
const words = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

beforeEach(() => {
  vi.clearAllMocks();
  picked(null);
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-GB');
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  window.sessionStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  picked(null);
});

describe('the register: je where the member chose it, and u where not (T7)', () => {
  it('the link page says je, and no u, to a person whose pages say je', async () => {
    picked('nl');
    grantReadMock.mockResolvedValue(linkPage({ language: 'nl', register: 'informal' }));
    renderLinkPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Pat vraagt je toestemming' })).toBeInTheDocument();
    expect(screen.getByText('Pat, je dochter')).toBeInTheDocument();
    expect(words()).not.toMatch(FORMAL);
  });

  it('and u, as before, where the member chose u, or chose nothing', async () => {
    picked('nl');
    for (const voice of [{ language: 'nl', register: 'formal' }, {}]) {
      grantReadMock.mockResolvedValue(linkPage(voice));
      const page = renderLinkPage();
      expect(await screen.findByRole('heading', { level: 1, name: 'Pat vraagt uw toestemming' })).toBeInTheDocument();
      page.unmount();
    }
  });

  it('the progress page says je too, from its first line to the sender at its foot', async () => {
    picked('nl');
    viewReadMock.mockResolvedValue(progressPage({ language: 'nl', register: 'informal' }));
    renderProgressPage();
    expect(
      await screen.findByText('Pat kopieert je e-mail, agenda en bestanden naar een nieuwe aanbieder. Op deze pagina zie je hoe ver dat is.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Pat, je dochter')).toBeInTheDocument();
    expect(words()).not.toMatch(FORMAL);
  });

  it('English has one you: the register changes nothing', async () => {
    picked('en');
    grantReadMock.mockResolvedValue(linkPage({ language: 'en', register: 'informal' }));
    renderLinkPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Pat asks for your permission' })).toBeInTheDocument();
  });
});

describe('the language: the one chosen for them, until the reader picks another (T7, §11)', () => {
  it('a browser in English opens a page chosen in Dutch in Dutch', async () => {
    grantReadMock.mockResolvedValue(linkPage({ language: 'nl', register: 'informal' }));
    renderLinkPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Pat vraagt je toestemming' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('nl');
    // Offered, never kept: the member's own screens start from the browser's language again.
    expect(window.localStorage.getItem('ownpace.locale')).toBeNull();
  });

  it('the switch wins, and stays won', async () => {
    grantReadMock.mockResolvedValue(linkPage({ language: 'nl', register: 'informal' }));
    renderLinkPage();
    await screen.findByRole('heading', { level: 1, name: 'Pat vraagt je toestemming' });
    await userEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Pat asks for your permission' })).toBeInTheDocument();
    expect(window.localStorage.getItem('ownpace.locale')).toBe('en');
  });

  it('and a pick made before, in this browser, wins over the choice', async () => {
    picked('en');
    grantReadMock.mockResolvedValue(linkPage({ language: 'nl', register: 'informal' }));
    renderLinkPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Pat asks for your permission' })).toBeInTheDocument();
  });

  it('with no language chosen, the browser’s, as before', async () => {
    grantReadMock.mockResolvedValue(linkPage({ language: null, register: 'formal' }));
    renderLinkPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Pat asks for your permission' })).toBeInTheDocument();
  });
});

/** A part that words a sentence outside `t`, as `serverMessage` does, as it renders. */
const WordedOutside: React.FC = () => <p>{tActive('answer.unreachable')}</p>;

describe('what a page words outside React (T7)', () => {
  it('says je while a person’s page says je, and u again once it is gone', () => {
    picked('nl');
    const formal = STRINGS.nl['answer.unreachable'];
    const twin = NL_JE['answer.unreachable'];
    expect(twin).toBeDefined();
    const page = render(
      <LocaleProvider>
        <InTheirVoice language="nl" register="informal">
          <WordedOutside />
        </InTheirVoice>
      </LocaleProvider>,
    );
    expect(screen.getByText(twin!)).toBeInTheDocument();
    page.unmount();
    render(
      <LocaleProvider>
        <WordedOutside />
      </LocaleProvider>,
    );
    expect(screen.getByText(formal)).toBeInTheDocument();
  });
});
