// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PASSWORD THE PERSON REMOVES (workplan 0174 §4.3, §5.9).
 *
 * A destination the person connected on their grant link is a section of
 * their progress page, named by its provider and never by its address, with
 * *Remove my password* behind a second press. Removed, the page says §5.9's
 * sentence as the owner read it, *Delete or change this password at
 * {provider} too, if you want to be sure*, in the page's language; on Cirrux it says the Drive connection went
 * with it and where Cirrux lists it. A press on a stale page shows the
 * server's sentence. A payload with no list draws no section.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AxiosError, AxiosHeaders } from 'axios';

const { readMock, withdrawDestinationMock } = vi.hoisted(() => ({
  readMock: vi.fn(),
  withdrawDestinationMock: vi.fn(),
}));

vi.mock('../services/link-report-service.ts', () => ({
  linkReportApi: { available: vi.fn(async () => false), send: vi.fn() },
}));
vi.mock('../services/view-service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/view-service.ts')>();
  return {
    ...actual,
    viewApi: { read: readMock, withdraw: vi.fn(), withdrawAccount: vi.fn(), withdrawDestination: withdrawDestinationMock },
  };
});

import View from './View.tsx';
import { LocaleProvider } from '../i18n/index.tsx';

const SOVERIN = 'c'.repeat(32);
const CIRRUX = 'd'.repeat(32);
const IN_A_MONTH = new Date(Date.now() + 30 * 86_400_000).toISOString();
const NOW = new Date().toISOString();

const person = (destinations?: Array<{ ref: string; provider: string; drive: boolean }>) => ({
  kind: 'person' as const,
  organisation: 'Example family',
  expiresAt: IN_A_MONTH,
  migrations: [{ from: 'apple', to: 'soverin', state: 'active' as const, started: false, domains: [], account: null }],
  accounts: [],
  ...(destinations === undefined ? {} : { destinations }),
});

function renderPage(locale: 'en' | 'nl' = 'en') {
  try {
    window.localStorage.setItem('ownpace.locale', locale);
  } catch {
    // The page falls back to English; a case in Dutch then fails and says so.
  }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <LocaleProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/view/p.abc.def']}>
          <Routes>
            <Route path="/view/:link" element={<View />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('a destination the person connected, on their progress page (0174 §4.3)', () => {
  it('is named by its provider, never its address, and removed only on the second press', async () => {
    readMock.mockResolvedValue(person([{ ref: SOVERIN, provider: 'soverin', drive: false }]));
    withdrawDestinationMock.mockResolvedValue({ withdrawnAt: NOW, provider: 'soverin', drive: false });
    renderPage();
    const section = await screen.findByRole('region', { name: 'Your account at Soverin' });
    expect(within(section).getByText(/You connected this account with your own password/)).toBeInTheDocument();

    fireEvent.click(within(section).getByRole('button', { name: 'Remove my password' }));
    expect(withdrawDestinationMock).not.toHaveBeenCalled();
    fireEvent.click(within(section).getByRole('button', { name: 'Yes, remove it' }));

    expect(await within(section).findByText('Removed here. Delete or change this password at Soverin too, if you want to be sure.')).toBeInTheDocument();
    expect(within(section).getByText(/Nothing more is copied into this account/)).toBeInTheDocument();
    expect(withdrawDestinationMock).toHaveBeenCalledWith('p.abc.def', SOVERIN);
    expect(within(section).queryByText(/Cirrux Drive/)).not.toBeInTheDocument();
  });

  it('says it in Dutch on a Dutch page', async () => {
    readMock.mockResolvedValue(person([{ ref: SOVERIN, provider: 'soverin', drive: false }]));
    withdrawDestinationMock.mockResolvedValue({ withdrawnAt: NOW, provider: 'soverin', drive: false });
    renderPage('nl');
    const section = await screen.findByRole('region', { name: 'Uw account bij Soverin' });
    fireEvent.click(within(section).getByRole('button', { name: 'Mijn wachtwoord verwijderen' }));
    fireEvent.click(within(section).getByRole('button', { name: 'Ja, verwijderen' }));
    expect(
      await within(section).findByText('Hier verwijderd. Verwijder of wijzig dit wachtwoord ook bij Soverin als u het zeker wilt weten.'),
    ).toBeInTheDocument();
  });

  it('on Cirrux, says the Drive connection goes with it, and where Cirrux lists it once removed', async () => {
    readMock.mockResolvedValue(person([{ ref: CIRRUX, provider: 'cirrux', drive: true }]));
    withdrawDestinationMock.mockResolvedValue({ withdrawnAt: NOW, provider: 'cirrux', drive: true });
    renderPage();
    const section = await screen.findByRole('region', { name: 'Your account at Cirrux' });
    expect(within(section).getByText('The Cirrux Drive connection you gave is removed with it.')).toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: 'Remove my password' }));
    fireEvent.click(within(section).getByRole('button', { name: 'Yes, remove it' }));
    expect(await within(section).findByText(/Your Cirrux Drive connection is deleted here too/)).toBeInTheDocument();
  });

  it('shows the server’s sentence when the page was stale, and removes nothing it did not say', async () => {
    readMock.mockResolvedValue(person([{ ref: SOVERIN, provider: 'soverin', drive: false }]));
    const stale = new AxiosError('conflict', 'ERR_BAD_REQUEST', undefined, undefined, {
      status: 409,
      statusText: 'Conflict',
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: { error: 'changed', reason: 'Your permission changed since this page was opened.', reasonNl: 'Uw toestemming is gewijzigd.' },
    });
    withdrawDestinationMock.mockRejectedValue(stale);
    renderPage();
    const section = await screen.findByRole('region', { name: 'Your account at Soverin' });
    fireEvent.click(within(section).getByRole('button', { name: 'Remove my password' }));
    fireEvent.click(within(section).getByRole('button', { name: 'Yes, remove it' }));
    expect(await within(section).findByText('Your permission changed since this page was opened.')).toBeInTheDocument();
    expect(within(section).queryByText(/Removed here/)).not.toBeInTheDocument();
  });

  it('draws no section from a payload with no list', async () => {
    readMock.mockResolvedValue(person());
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'How far is the copying?' });
    expect(screen.queryByRole('button', { name: 'Remove my password' })).not.toBeInTheDocument();
  });
});
