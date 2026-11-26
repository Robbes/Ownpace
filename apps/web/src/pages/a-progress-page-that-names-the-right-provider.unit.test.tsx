// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A PROGRESS PAGE THAT NAMES THE RIGHT PROVIDER (workplan 0176 T2.4, §3.2).
 *
 * Since 0171 a link connects Microsoft and Dropbox accounts as well as
 * Google's, and a person's progress page groups each of them under its own
 * heading. The page headed every group *Your Google account*, said Google
 * read it, and said Google would take the permission back: about a Microsoft
 * account, all three untrue. The link page had each provider's words; this page
 * had Google's alone.
 *
 * Each provider is named by its own name here: in the account's heading, in
 * what reads it, and in its stop. The page carries no address, so an account
 * is named by its provider, read from its migrations (`from`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { LocaleProvider } from '../i18n/index.tsx';

const { readMock, withdrawAccountMock, reportAvailableMock } = vi.hoisted(() => ({
  readMock: vi.fn(),
  withdrawAccountMock: vi.fn(),
  reportAvailableMock: vi.fn(async () => false),
}));

vi.mock('../services/link-report-service.ts', () => ({
  linkReportApi: { available: reportAvailableMock, send: vi.fn() },
}));
vi.mock('../services/view-service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/view-service.ts')>()),
  viewApi: { read: readMock, withdraw: vi.fn(), withdrawAccount: withdrawAccountMock, withdrawDestination: vi.fn() },
}));
vi.mock('../services/api.ts', () => ({ default: {}, serverMessage: () => 'a server sentence' }));

import View from './View.tsx';

const IN_A_MONTH = new Date(Date.now() + 30 * 86_400_000).toISOString();

const row = (over: Record<string, unknown> = {}) => ({
  domain: 'email' as const,
  state: 'in_progress' as const,
  itemsSynced: 4211,
  itemsFailed: 0,
  bytesTransferred: 91_000_000,
  itemsRetrying: 0,
  itemsNeedingDecision: 0,
  itemsFound: 5000,
  stage: 'copying',
  ...over,
});

/** A person's page with one account of `from`'s provider, copying into Soverin. */
const personWith = (from: string, over: Record<string, unknown> = {}) => ({
  kind: 'person' as const,
  organisation: 'Example family',
  expiresAt: IN_A_MONTH,
  accounts: [{ ref: 'acct-1', grant: { state: 'granted' as const } }],
  migrations: [{ from, to: 'soverin', state: 'active' as const, started: true, domains: [row()], account: 'acct-1' }],
  destinations: [],
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a person’s progress page names each account by its own provider', () => {
  it('heads a Microsoft account Microsoft, and says Google nowhere', async () => {
    readMock.mockResolvedValue(personWith('microsoft'));
    renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: 'Your Microsoft 365 account' })).toBeInTheDocument();
    // The permission's line says who reads which account, in Microsoft's name.
    expect(screen.getByText(/reads this Microsoft 365 account/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Google/);
  });

  it('says it in Dutch too', async () => {
    readMock.mockResolvedValue(personWith('microsoft'));
    renderPage('nl');
    expect(await screen.findByRole('heading', { level: 2, name: 'Uw Microsoft 365-account' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Google/);
  });

  it('heads a Dropbox account Dropbox', async () => {
    readMock.mockResolvedValue(personWith('dropbox'));
    renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: 'Your Dropbox account' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Google/);
  });

  it('numbers two accounts of one provider, each by that provider’s name', async () => {
    readMock.mockResolvedValue(
      personWith('microsoft', {
        accounts: [
          { ref: 'acct-1', grant: { state: 'granted' } },
          { ref: 'acct-2', grant: { state: 'granted' } },
        ],
        migrations: [
          { from: 'microsoft', to: 'soverin', state: 'active', started: true, domains: [row()], account: 'acct-1' },
          { from: 'microsoft', to: 'nextcloud', state: 'active', started: true, domains: [row()], account: 'acct-2' },
        ],
      }),
    );
    renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: 'Microsoft 365 account 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Microsoft 365 account 2' })).toBeInTheDocument();
  });

  it('keeps Google’s name for a Google account', async () => {
    readMock.mockResolvedValue(personWith('gmail'));
    renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: 'Your Google account' })).toBeInTheDocument();
  });
});

describe('a Microsoft account’s stop names Microsoft (T5.2)', () => {
  it('in its question, in what the provider answered, and in where to finish it', async () => {
    readMock.mockResolvedValue(personWith('microsoft'));
    withdrawAccountMock.mockResolvedValue({ withdrawnAt: new Date().toISOString(), atGoogle: 'not_confirmed' });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Stop copying' }));
    const question = await screen.findByRole('heading', { level: 1, name: 'Stop copying from your Microsoft 365 account?' });
    expect(question).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Google/);
    await userEvent.click(screen.getByRole('button', { name: 'Yes, stop' }));
    const answer = await screen.findByText(/Microsoft 365 did not confirm\./);
    // Where to finish it by hand, on a line of its own: Microsoft's list, not Google's.
    const where = screen.getByRole('link', { name: 'myaccount.microsoft.com' });
    expect(where).toHaveAttribute('href', 'https://myaccount.microsoft.com/');
    expect(answer).toBeInTheDocument();
    expect(within(document.body).queryByRole('link', { name: /google/i })).not.toBeInTheDocument();
  });
});
