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
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ConnectionSummary } from '../services/mapping-service';

const { list, test: testConnection, rotate, remove } = vi.hoisted(() => ({
  list: vi.fn(),
  test: vi.fn(),
  rotate: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('../services/mapping-service', () => ({
  connectionsApi: { list, test: testConnection, rotate, remove },
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
  rotate.mockReset();
  remove.mockReset();
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

describe('replacing credentials', () => {
  it('asks only for the SECRETS, never for where the migration is rooted', async () => {
    // Rotation replaces a credential, not a root folder — re-presenting the
    // latter invites somebody to change it while fixing a login (0065).
    list.mockResolvedValue([conn({ kind: 'box' })]);
    renderPage();

    fireEvent.click(await screen.findByText('Replace credentials'));

    expect(screen.getByText(/Source client secret/)).toBeTruthy();
    expect(screen.queryByText(/Root folder id/), 'config is not re-asked').toBeNull();
  });

  it('keeps the OLD credentials when the new ones do not work', async () => {
    list.mockResolvedValue([conn()]);
    rotate.mockResolvedValue({
      ok: false,
      rotated: false,
      reason: 'Box refused the token request (400): invalid_client.',
    });
    renderPage();

    fireEvent.click(await screen.findByText('Replace credentials'));
    fireEvent.click(screen.getByText('Check and replace'));

    // The provider's words, and nothing silently swapped underneath.
    expect(await screen.findByText(/invalid_client/)).toBeTruthy();
    expect(screen.getByText('Check and replace'), 'the form stays open to retry').toBeTruthy();
  });

  it('closes and refreshes once the new credentials prove out', async () => {
    list.mockResolvedValue([conn()]);
    rotate.mockResolvedValue({ ok: true, rotated: true, detail: 'Listed 12 folders.' });
    renderPage();

    fireEvent.click(await screen.findByText('Replace credentials'));
    fireEvent.click(screen.getByText('Check and replace'));

    await waitFor(() => expect(screen.queryByText('Check and replace')).toBeNull());
  });
});

describe('deleting a connection', () => {
  it("refuses while anything uses it, and names what — not a flat no", async () => {
    // The cascade is the reason: mailbox.connection_id cascades and item hangs
    // off the mailboxes, so deleting one in use would take the migration
    // ledger with it silently (workplan 0066).
    list.mockResolvedValue([conn({ usedByMailboxes: 3 })]);
    remove.mockRejectedValue(
      new Error('3 mailbox(es) still use this connection (Acme mail). Deleting it would take their migration history with it, so remove those migrations first.'),
    );
    renderPage();

    fireEvent.click(await screen.findByText('Delete'));

    expect(await screen.findByText(/Acme mail/)).toBeTruthy();
    expect(screen.getByText(/migration history/)).toBeTruthy();
  });

  it('deletes one nothing depends on, and refreshes', async () => {
    list.mockResolvedValue([conn({ usedByMailboxes: 0 })]);
    remove.mockResolvedValue(undefined);
    renderPage();

    fireEvent.click(await screen.findByText('Delete'));

    await waitFor(() => expect(remove).toHaveBeenCalledWith('c1'));
  });
});
