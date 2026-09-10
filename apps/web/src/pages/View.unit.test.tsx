// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The progress page (workplan 0122 T4).
 *
 * The reader has no account, no other screen and nobody to ask but the person
 * who sent them the link, so what is asserted here is what would mislead
 * somebody in that position:
 *
 *  - **zero and nothing-yet are different sentences**, and the page must not
 *    reach for the first when the truth is the second;
 *  - **a completion and a last-touched time are different claims**, and the
 *    weaker one has to be worded as the weaker one;
 *  - **a failure is explained in words this reader can use**, never in the
 *    owner's remedies and never in the provider's prose;
 *  - **a refused link answers with the server's own sentence**, which is the
 *    one written to be forwarded.
 *
 * Assertions are on the English strings, relying on `useLocale`'s documented
 * un-provided fallback, the same way `Grant.unit.test.tsx` does.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';

const { readMock, serverMessageMock } = vi.hoisted(() => ({
  readMock: vi.fn(),
  serverMessageMock: vi.fn(() => 'a server sentence'),
}));

vi.mock('../services/view-service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/view-service.ts')>();
  return { ...actual, viewApi: { read: readMock } };
});
vi.mock('../services/api.ts', () => ({ default: {}, serverMessage: serverMessageMock }));

import View from './View.tsx';

const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString();
const IN_A_MONTH = new Date(Date.now() + 30 * 86_400_000).toISOString();

const row = (over: Record<string, unknown> = {}) => ({
  domain: 'email' as const,
  state: 'in_progress' as const,
  itemsSynced: 4211,
  itemsFailed: 0,
  bytesTransferred: 91_000_000,
  itemsRetrying: 0,
  itemsNeedingDecision: 0,
  ...over,
});

const payload = (over: Record<string, unknown> = {}) => ({
  organisation: 'Berentsen family',
  state: 'active' as const,
  started: true,
  domains: [row()],
  expiresAt: IN_A_MONTH,
  ...over,
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/view/abc.def']}>
        <Routes>
          <Route path="/view/:link" element={<View />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  serverMessageMock.mockReturnValue('a server sentence');
  readMock.mockResolvedValue(payload());
});

describe('what the page says', () => {
  it('names who is doing this, in a sentence rather than a chip', async () => {
    renderPage();
    expect(await screen.findByText(/Berentsen family is moving your account/)).toBeInTheDocument();
    // `active` reads as "Active" everywhere else in the product. Here it is a
    // whole sentence, because the reader is not scanning twenty migrations —
    // they are reading about their own.
    expect(screen.getByText('Your things are being copied across now.')).toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });

  it('counts what has been copied, and says how much has moved', async () => {
    renderPage();
    expect(await screen.findByText('4211 copied')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText(/86.8 MB moved so far/)).toBeInTheDocument();
  });

  it('says nothing has been copied rather than showing zeroes', async () => {
    // The hour after somebody grants: no status rows exist. Five domains
    // reading `0` would say FINISHED, and moved nothing.
    readMock.mockResolvedValue(payload({ started: false, domains: [] }));
    renderPage();
    expect(await screen.findByText('Nothing has been copied yet.')).toBeInTheDocument();
    expect(screen.queryByText(/copied$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/moved so far/)).not.toBeInTheDocument();
  });

  it('separates "up to date as of" from "last worked on"', async () => {
    // A COMPLETION is the only honest source for the strong claim. A domain
    // that has never completed gets the weaker sentence, worded as weaker.
    readMock.mockResolvedValue(payload({ domains: [row({ lastActiveAt: YESTERDAY })] }));
    renderPage();
    expect(await screen.findByText(/Still copying; last worked on/)).toBeInTheDocument();
    expect(screen.queryByText(/Up to date as of/)).not.toBeInTheDocument();
  });

  it('says not started yet when a domain has neither time', async () => {
    // Never `undefined` beside a label, and never a date we do not have.
    readMock.mockResolvedValue(payload({ domains: [row({ itemsSynced: 0 })] }));
    renderPage();
    expect(await screen.findByText('Not started yet.')).toBeInTheDocument();
  });

  it('states its own expiry, for somebody who bookmarked it', async () => {
    renderPage();
    expect(await screen.findByText(/This page works until/)).toBeInTheDocument();
  });
});

describe('when something is wrong', () => {
  it('counts what needs attention and points at the right person', async () => {
    readMock.mockResolvedValue(
      payload({ domains: [row({ itemsFailed: 3, itemsNeedingDecision: 3 })] }),
    );
    renderPage();
    expect(
      await screen.findByText('3 items need someone to look at them.'),
    ).toBeInTheDocument();
  });

  it('explains a failure in THIS reader’s words, not the owner’s remedy', async () => {
    readMock.mockResolvedValue(
      payload({
        domains: [row({ itemsNeedingDecision: 1, lastErrorCategory: 'auth_expired', failedSide: 'source' })],
      }),
    );
    renderPage();
    // The owner's sentence for this category sends somebody to the Connections
    // page. This reader has no account to reach one with, so they are told the
    // fact and who can act on it.
    expect(await screen.findByText(/needs renewing/)).toBeInTheDocument();
    expect(screen.queryByText(/Connections page/)).not.toBeInTheDocument();
    // Their old account, not "the source side".
    expect(screen.getByText(/your old account/)).toBeInTheDocument();
  });

  it('renders a pause as a reason, not as a failure', async () => {
    readMock.mockResolvedValue(
      payload({
        domains: [
          row({
            pausedReason: {
              kind: 'daily-download-ceiling',
              provider: 'imap.gmail.com',
              windowResetsAt: null,
            },
          }),
        ],
      }),
    );
    renderPage();
    expect(await screen.findByRole('note')).toBeInTheDocument();
    expect(screen.getByText(/imap.gmail.com/)).toBeInTheDocument();
  });

  it('ignores a pause reason it does not recognise rather than rendering it raw', async () => {
    // A jsonb column accepts whatever the writer put there, and a row from an
    // older or newer build must not become a half-sentence on the one page
    // whose reader cannot check anything.
    readMock.mockResolvedValue(payload({ domains: [row({ pausedReason: { kind: 'hibernating' } })] }));
    renderPage();
    await screen.findByText('4211 copied');
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it("shows a refused link in the SERVER's words — they are written to be forwarded", async () => {
    serverMessageMock.mockReturnValue('This link cannot be used. Ask them for a fresh link.');
    readMock.mockRejectedValue(new Error('401'));
    renderPage();
    expect(await screen.findByText(/Ask them for a fresh link/)).toBeInTheDocument();
    // And no counts of any kind: a refusal is not a migration with nothing in it.
    expect(screen.queryByText(/copied/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing has been copied yet/)).not.toBeInTheDocument();
  });
});
