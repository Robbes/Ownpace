// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A PROGRESS PAGE THAT SAYS WHAT TO DO (workplan 0176 T6, first half; §10;
 * R10: *progress says three things*).
 *
 * The person who opens their page wants three things, in this order: whether
 * they have to do anything, how far it is, and how long it takes. The page
 * opened with a state sentence in the member's words, showed a price where the
 * data ceiling held a migration, and did not refresh.
 *
 * - **The first line, by rule.** A connection that needs renewing comes
 *   first, and says who can send a new link. Else, when every migration is
 *   held by a stop, that it stopped. Else: *You do not have to do anything
 *   now. You may close this page.*, which is true while a migration waits
 *   for the member's Start too.
 * - **No price on a person's page.** A pause at the data ceiling says that
 *   copying waits for a choice by whoever sent the link, and that nothing is
 *   lost: no package, no amount, no Billing page, none of which the reader can
 *   open (§3.2).
 * - **The numbers refresh by themselves,** once a minute while something on the
 *   page can still change. The focus stays where it was and nothing is read
 *   out. A refresh that fails keeps what the page showed and says when that
 *   was; a link refused meanwhile shows its refusal. Once every migration is
 *   done or held, nothing is read again.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AxiosError, AxiosHeaders } from 'axios';
import { LocaleProvider } from '../i18n/index.tsx';

const { readMock, reportAvailableMock } = vi.hoisted(() => ({
  readMock: vi.fn(),
  reportAvailableMock: vi.fn(async () => false),
}));

vi.mock('../services/link-report-service.ts', () => ({
  linkReportApi: { available: reportAvailableMock, send: vi.fn() },
}));
vi.mock('../services/view-service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/view-service.ts')>()),
  viewApi: { read: readMock, withdraw: vi.fn(), withdrawAccount: vi.fn(), withdrawDestination: vi.fn() },
}));
vi.mock('../services/api.ts', () => ({ default: {}, serverMessage: () => 'a server sentence' }));

import View from './View.tsx';

const IN_A_MONTH = new Date(Date.now() + 30 * 86_400_000).toISOString();
const TODAY = new Date().toISOString();

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

const migration = (over: Record<string, unknown> = {}) => ({
  from: 'gmail',
  to: 'soverin',
  state: 'active' as const,
  started: true,
  domains: [row()],
  account: 'acct-1',
  ...over,
});

const person = (over: Record<string, unknown> = {}) => ({
  kind: 'person' as const,
  organisation: 'Example family',
  expiresAt: IN_A_MONTH,
  accounts: [{ ref: 'acct-1', grant: { state: 'granted' as const } }],
  migrations: [migration()],
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

/** The first thing the page says under its title. */
function firstLine(): string {
  const h1 = screen.getByRole('heading', { level: 1 });
  return (h1.nextElementSibling?.textContent ?? '').trim();
}

beforeEach(() => {
  vi.clearAllMocks();
  readMock.mockResolvedValue(person());
});

describe('the first line says whether anything is needed (§10)', () => {
  it('says the title in D1’s words', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'How far is the copying?' })).toBeInTheDocument();
  });

  it('while copying runs: nothing to do, and the page may be closed', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1 });
    await screen.findByText(/Example family copies your email, calendar and files/);
    expect(firstLine()).toBe('You do not have to do anything now. You may close this page.');
  });

  it('and while a migration waits for the member’s Start, the same', async () => {
    readMock.mockResolvedValue(person({ migrations: [migration({ state: 'paused', started: false, domains: [] })] }));
    renderPage();
    await screen.findByText(/Example family copies your email, calendar and files/);
    expect(firstLine()).toBe('You do not have to do anything now. You may close this page.');
  });

  it('a connection that needs renewing comes first, with who can send a new link', async () => {
    readMock.mockResolvedValue(
      person({ migrations: [migration({ domains: [row({ lastErrorCategory: 'auth_expired', failedSide: 'source' })] })] }),
    );
    renderPage();
    await screen.findByText(/Example family copies your email, calendar and files/);
    expect(firstLine()).toBe('The connection to your Google account has stopped. Example family can send you a new link.');
    expect(document.body.textContent).not.toMatch(/You do not have to do anything now/);
  });

  it('every migration held by a stop: that copying stopped', async () => {
    readMock.mockResolvedValue(
      person({
        accounts: [{ ref: 'acct-1', grant: { state: 'withdrawn', withdrawnAt: TODAY } }],
        migrations: [migration({ stopped: { at: TODAY, what: 'source' } })],
      }),
    );
    renderPage();
    await screen.findByText(/Example family copies your email, calendar and files/);
    expect(firstLine()).toBe('Copying has stopped.');
  });

  it('in Dutch, in D1’s words', async () => {
    renderPage('nl');
    expect(await screen.findByRole('heading', { level: 1, name: 'Hoe ver is het kopiëren?' })).toBeInTheDocument();
    await screen.findByText(/Example family kopieert uw e-mail, agenda en bestanden/);
    expect(firstLine()).toBe('U hoeft nu niets te doen. U mag deze pagina sluiten.');
  });
});

describe('each row in a person’s own words (D14)', () => {
  it('says its stage and its count against the total, as today, with Wordt gekopieerd', async () => {
    renderPage('nl');
    const email = await screen.findByText('Wordt gekopieerd');
    const line = email.closest('[data-domain]');
    expect(line?.textContent).toContain('4.211 van ~5.000');
    expect(document.body.textContent).not.toMatch(/migr/i);
  });
});

describe('no price on a person’s page (T6.3)', () => {
  const AT_THE_CEILING = row({
    stage: 'paused',
    pausedReason: {
      kind: 'data-ceiling',
      ceilingGb: 100,
      held: 1200,
      moveUp: { name: 'Medium', monthlyEur: 12 },
      topUp: { bandGb: 50, priceEur: 5 },
    },
  });

  it('a pause at the data ceiling says copying waits for a choice by whoever sent the link, with no amount in it', async () => {
    readMock.mockResolvedValue(person({ migrations: [migration({ domains: [AT_THE_CEILING] })] }));
    renderPage();
    expect(await screen.findByText('Copying waits for a choice by Example family. Nothing is lost.')).toBeInTheDocument();
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/€/);
    expect(text).not.toMatch(/Medium/);
    expect(text).not.toMatch(/Billing/);
  });

  it('nor in Dutch', async () => {
    readMock.mockResolvedValue(person({ migrations: [migration({ domains: [AT_THE_CEILING] })] }));
    renderPage('nl');
    expect(await screen.findByText('Het kopiëren wacht op een keuze van Example family. Er gaat niets verloren.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/€|Facturering|Medium/);
  });
});

/**
 * A refusal as the link client delivers one: the server's sentence in the
 * body, with a response. A dropped connection has no response.
 */
function refused(status: number, data: unknown): AxiosError {
  const err = new AxiosError(`Request failed with status code ${status}`);
  err.response = { status, statusText: '', headers: {}, config: { headers: new AxiosHeaders() }, data };
  return err;
}
const unreachable = (): AxiosError => new AxiosError('Network Error', 'ERR_NETWORK');

describe('the numbers refresh by themselves (T6.4)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the page again after a minute, and the focus stays where it was', async () => {
    readMock
      .mockResolvedValueOnce(person())
      .mockResolvedValue(person({ migrations: [migration({ domains: [row({ itemsSynced: 4300 })] })] }));
    renderPage();
    const stop = await screen.findByRole('button', { name: 'Stop copying' });
    stop.focus();
    expect(screen.getByText(/Last updated at .*\. This page refreshes by itself\./)).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(readMock).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/4,300 of ~5,000/)).toBeInTheDocument();
    expect(document.activeElement).toBe(stop);
    // Nothing is read out again: the numbers are in no live region.
    expect(screen.getByText(/4,300 of ~5,000/).closest('[aria-live], [role="status"], [role="alert"]')).toBeNull();
  });

  it('keeps the numbers when a refresh cannot reach the server, and says when they are from', async () => {
    readMock.mockResolvedValueOnce(person()).mockRejectedValue(unreachable());
    renderPage();
    await screen.findByText(/4,211 of ~5,000/);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(readMock).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/Last updated at .*\. Refreshing did not work just now\./)).toBeInTheDocument();
    expect(screen.getByText(/4,211 of ~5,000/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the refusal of a link that was refused meanwhile', async () => {
    readMock.mockResolvedValueOnce(person()).mockRejectedValue(refused(401, { message: 'This link cannot be used.' }));
    renderPage();
    await screen.findByText(/4,211 of ~5,000/);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('This link cannot be used.');
  });

  it('reads nothing again once every migration is done or held', async () => {
    readMock.mockResolvedValue(
      person({
        accounts: [
          { ref: 'acct-1', grant: { state: 'granted' } },
          { ref: 'acct-2', grant: { state: 'withdrawn', withdrawnAt: TODAY } },
        ],
        migrations: [
          migration({ state: 'done', domains: [row({ stage: 'done', state: 'completed' })] }),
          migration({ account: 'acct-2', stopped: { at: TODAY, what: 'source' } }),
        ],
      }),
    );
    renderPage();
    await screen.findByRole('heading', { level: 1 });
    await screen.findByText(/Example family copies your email, calendar and files/);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 60_000);
    });
    expect(readMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/This page refreshes by itself/)).not.toBeInTheDocument();
  });
});
