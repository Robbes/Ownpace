// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The connections screen (workplan 0062).
 *
 * The value of this page is the Test button and what it shows: a provider
 * refusal is the ANSWER somebody came for, so it must render as readable text
 * rather than vanish, and it must be the provider's own sentence rather than
 * a rephrasing of it (hard rule 9). The usage count is the other half — it
 * says whether a broken connection matters.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ConnectionSummary } from '../services/mapping-service';

const { list, test: testConnection } = vi.hoisted(() => ({ list: vi.fn(), test: vi.fn() }));

vi.mock('../services/mapping-service', () => ({
  connectionsApi: { list, test: testConnection },
}));

import Connections from './Connections';

const conn = (over: Partial<ConnectionSummary> = {}): ConnectionSummary => ({
  id: 'c1',
  role: 'source',
  kind: 'box',
  displayName: 'Acme migration (source)',
  status: 'connected',
  createdAt: '2026-08-01T10:00:00Z',
  usedByMailboxes: 3,
  ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Connections />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  list.mockReset();
  testConnection.mockReset();
});

describe('the connections screen', () => {
  it('says how many mailboxes depend on a connection — whether it matters', async () => {
    list.mockResolvedValue([conn()]);
    renderPage();

    expect(await screen.findByText('Acme migration (source)')).toBeTruthy();
    expect(screen.getByText(/3 mailbox\(es\) use this/)).toBeTruthy();
  });

  it("shows a refusal VERBATIM — that sentence is what somebody came to find out", async () => {
    list.mockResolvedValue([conn()]);
    testConnection.mockResolvedValue({
      ok: false,
      reason:
        'Box refused the token request (400): unauthorized_client — a Box admin must authorise ' +
        'the app in the Admin Console.',
    });
    renderPage();

    fireEvent.click(await screen.findByText('Test'));

    expect(await screen.findByText(/a Box admin must authorise the app/)).toBeTruthy();
  });

  it('a success is shown too, so "I tested it" has evidence', async () => {
    list.mockResolvedValue([conn()]);
    testConnection.mockResolvedValue({ ok: true, detail: 'Listed 12 folders.' });
    renderPage();

    fireEvent.click(await screen.findByText('Test'));

    expect(await screen.findByText('Listed 12 folders.')).toBeTruthy();
  });

  it('a thrown error still reaches the person rather than disappearing', async () => {
    list.mockResolvedValue([conn()]);
    testConnection.mockRejectedValue(new Error('Network is unreachable'));
    renderPage();

    fireEvent.click(await screen.findByText('Test'));

    expect(await screen.findByText(/Network is unreachable/)).toBeTruthy();
  });

  it('offers the provider setup steps beside each connection', async () => {
    list.mockResolvedValue([conn()]);
    renderPage();

    const link = (await screen.findByText('Setup steps')) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/setup/source/box');
  });

  it('an empty tenant says so instead of rendering nothing', async () => {
    list.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText(/No connections yet/)).toBeTruthy();
  });
});
