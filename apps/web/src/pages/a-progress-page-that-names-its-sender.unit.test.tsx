// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A PROGRESS PAGE THAT NAMES ITS SENDER, AND SAYS WHO CAN OPEN THE COPY
 * (workplan 0176 §10, T6 step B; §7, T3).
 *
 * In step A every `{who}` on a person's progress page was the organisation,
 * because the page's answer carried no sender (§3.2), and the page said
 * nothing of who else can open the copy. Now the answer carries both:
 *
 *  - every `{who}` is the name the member gave: *Pat copies your email…*,
 *    *Continuing later needs a new link from Pat.*;
 *  - the page says who sent it, at its foot: *Sender: Pat*, by name only
 *    (D7, reversed by the owner on 2026-11-26), and a number to check, the
 *    member's own, else the organisation's, saying whose (D11). No address:
 *    the page carries none;
 *  - under a migration whose destination is the organisation's: *Pat can open
 *    the copy at Soverin too.* Nothing where the person connected it;
 *  - a page from a server before step B reads as step A did: the
 *    organisation, no box.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { LocaleProvider } from '../i18n/index.tsx';

const { readMock } = vi.hoisted(() => ({ readMock: vi.fn() }));

vi.mock('../services/link-report-service.ts', () => ({
  linkReportApi: { available: vi.fn(async () => false), send: vi.fn() },
}));
vi.mock('../services/view-service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/view-service.ts')>()),
  viewApi: { read: readMock, withdraw: vi.fn(), withdrawAccount: vi.fn(), withdrawDestination: vi.fn() },
}));
vi.mock('../services/api.ts', () => ({ default: {}, serverMessage: () => 'a server sentence' }));

import View from './View.tsx';

const IN_A_MONTH = new Date(Date.now() + 30 * 86_400_000).toISOString();

const row = {
  domain: 'email' as const,
  state: 'in_progress' as const,
  itemsSynced: 4211,
  itemsFailed: 0,
  bytesTransferred: 91_000_000,
  itemsRetrying: 0,
  itemsNeedingDecision: 0,
  itemsFound: 5000,
  stage: 'copying',
};

const migration = (over: Record<string, unknown> = {}) => ({
  from: 'gmail',
  to: 'soverin',
  state: 'active' as const,
  started: true,
  domains: [row],
  account: 'acct-1',
  theOrganisationOpensIt: true,
  ...over,
});

const person = (over: Record<string, unknown> = {}) => ({
  kind: 'person' as const,
  organisation: 'Example family',
  expiresAt: IN_A_MONTH,
  accounts: [{ ref: 'acct-1', grant: { state: 'granted' as const } }],
  migrations: [migration()],
  destinations: [],
  sender: { name: 'Pat', phone: '+31 6 1234 5678' },
  organisationPhone: '+31 20 123 4567',
  ...over,
});

function renderPage(locale: 'en' | 'nl' = 'en') {
  window.localStorage.setItem('ownpace.locale', locale);
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

const textOf = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The page once its answer is read: the title is drawn while it loads. */
const loaded = () => screen.findByText(/copies your email|kopieert uw e-mail/);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

describe('every {who} is the name the member gave', () => {
  it('in the line that says what the page is for', async () => {
    readMock.mockResolvedValue(person());
    renderPage('en');
    expect(
      await screen.findByText('Pat copies your email, calendar and files to a new provider. This page shows how far that is.'),
    ).toBeInTheDocument();
  });

  it('in the stop’s question', async () => {
    readMock.mockResolvedValue(person());
    renderPage('en');
    await userEvent.click(await screen.findByRole('button', { name: 'Stop copying' }));
    expect(await screen.findByText('Continuing later needs a new link from Pat.')).toBeInTheDocument();
  });

  it('and the organisation, as before, from a server before step B', async () => {
    const { sender: _s, organisationPhone: _p, ...before } = person();
    readMock.mockResolvedValue(before);
    renderPage('en');
    expect(await screen.findByText(/^Example family copies your email/)).toBeInTheDocument();
    expect(document.querySelector('[data-sender]')).toBeNull();
  });
});

describe('who the sender is, at the foot of the page', () => {
  it('the name, and nothing of how the reader knows them, and a number to check, in Dutch', async () => {
    readMock.mockResolvedValue(person());
    renderPage('nl');
    await loaded();
    const box = document.querySelector('[data-sender]') as HTMLElement;
    expect(box).not.toBeNull();
    expect(within(box).getByText('Afzender')).toBeInTheDocument();
    expect(within(box).getByText('Pat')).toBeInTheDocument();
    expect(textOf(box)).not.toMatch(/Pat,|dochter/);
    expect(textOf(box.querySelector('[data-number]'))).toBe(
      'Nummer van Pat: +31 6 1234 5678. Of gebruik het nummer dat u al van Pat hebt.',
    );
  });

  it("the organisation's number where the member gave none, saying whose", async () => {
    readMock.mockResolvedValue(person({ sender: { name: 'Pat', phone: null } }));
    renderPage('en');
    await loaded();
    const box = document.querySelector('[data-sender]') as HTMLElement;
    expect(textOf(box.querySelector('[data-number]'))).toBe(
      'The number of Example family: +31 20 123 4567. Or use the number you already have for Pat.',
    );
  });

  it('no address anywhere on the page', async () => {
    readMock.mockResolvedValue(person());
    renderPage('en');
    await loaded();
    expect(document.body.textContent).not.toMatch(/@/);
  });
});

describe('who can open the copy (§10)', () => {
  it('is said under a migration whose destination is the organisation’s, and nowhere else', async () => {
    readMock.mockResolvedValue(
      person({
        migrations: [migration(), migration({ to: 'nextcloud', theOrganisationOpensIt: false })],
      }),
    );
    renderPage('en');
    await loaded();
    expect(screen.getAllByText('Pat can open the copy at Soverin too.')).toHaveLength(1);
    expect(screen.queryByText(/can open the copy at Nextcloud/)).not.toBeInTheDocument();
  });

  it('in Dutch, in the link page’s own sentence', async () => {
    readMock.mockResolvedValue(person());
    renderPage('nl');
    expect(await screen.findByText('Pat kan de kopie bij Soverin ook openen.')).toBeInTheDocument();
  });

  it('says nothing from a server before step B, which did not say', async () => {
    readMock.mockResolvedValue(person({ migrations: [migration({ theOrganisationOpensIt: undefined })] }));
    renderPage('en');
    await loaded();
    expect(screen.queryByText(/can open the copy/)).not.toBeInTheDocument();
  });
});
