// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The owner's grant-link panel (workplan 0108 T3).
 *
 * What is asserted here is what an owner can be misled about: that the link is
 * shown once and said to be, that a refusal arrives in the SERVER's words
 * rather than a generic failure, that revoking takes two clicks, and that a
 * link which expired unused is the one row that stays loud.
 *
 * Assertions are on the English strings, relying on `useLocale`'s documented
 * un-provided fallback, the same way `RunsPanel.unit.test.tsx` does.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { listMock, issueMock, revokeMock, selfHostMock, serverMessageMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  issueMock: vi.fn(),
  revokeMock: vi.fn(),
  selfHostMock: vi.fn(() => false),
  serverMessageMock: vi.fn(() => 'a server sentence'),
}));

vi.mock('../services/grant-link-service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/grant-link-service.ts')>();
  return {
    ...actual,
    grantLinkApi: { list: listMock, issue: issueMock, revoke: revokeMock },
  };
});
vi.mock('../services/edition.ts', () => ({ isSelfHost: selfHostMock }));
vi.mock('../services/api.ts', () => ({
  default: {},
  serverMessage: serverMessageMock,
}));

import GrantLinksPanel from './GrantLinksPanel.tsx';

const IN_A_WEEK = new Date(Date.now() + 7 * 86_400_000).toISOString();
const LAST_WEEK = new Date(Date.now() - 7 * 86_400_000).toISOString();

const link = (over: Record<string, unknown> = {}) => ({
  id: 'link-1',
  purpose: 'grant' as const,
  state: 'live' as const,
  createdAt: LAST_WEEK,
  createdBy: 'rob',
  expiresAt: IN_A_WEEK,
  usedAt: null,
  revokedAt: null,
  ...over,
});

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GrantLinksPanel mappingId="acme-mail" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  selfHostMock.mockReturnValue(false);
  serverMessageMock.mockReturnValue('a server sentence');
  listMock.mockResolvedValue([]);
});

describe('issuing', () => {
  it('offers the three lifetimes with seven days pre-filled', async () => {
    renderPanel();
    const select = await screen.findByLabelText(/The link works for/);
    expect((select as HTMLSelectElement).value).toBe('7');
    expect(screen.getByRole('option', { name: '1 day' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '30 days' })).toBeInTheDocument();
  });

  it('shows the URL once, says so, and says who sends it', async () => {
    issueMock.mockResolvedValue({
      id: 'link-1',
      url: 'https://app.example/grant/link-1.sekrit',
      expiresAt: IN_A_WEEK,
      expiryDays: 7,
      distribution: 'ignored — the screen has its own translated sentence',
    });
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: /Create grant link/ }));

    // The URL is in a real input, not only behind a copy button: a browser that
    // refuses clipboard access must still leave it selectable.
    const field = await screen.findByLabelText('The grant link');
    expect((field as HTMLInputElement).value).toBe('https://app.example/grant/link-1.sekrit');
    expect(screen.getByText(/only time it can be shown/)).toBeInTheDocument();
    // ADR-0035's division of labour, on the screen rather than only in an ADR.
    expect(screen.getByText(/Send it yourself/)).toBeInTheDocument();
  });

  it('passes the chosen expiry rather than always the default', async () => {
    issueMock.mockResolvedValue({
      id: 'link-1',
      url: 'https://app.example/grant/link-1.sekrit',
      expiresAt: IN_A_WEEK,
      expiryDays: 1,
      distribution: '',
    });
    renderPanel();
    await userEvent.selectOptions(await screen.findByLabelText(/The link works for/), '1');
    await userEvent.click(screen.getByRole('button', { name: /Create grant link/ }));
    await waitFor(() => expect(issueMock).toHaveBeenCalledWith('acme-mail', 1));
  });

  it("shows a refusal in the SERVER's words, not a generic failure", async () => {
    // The four refusals each name what to configure. Replacing them with
    // "could not create link" would throw away the only useful half.
    serverMessageMock.mockReturnValue(
      'The consent runs against your own Google client, and this source has no client secret stored.',
    );
    issueMock.mockRejectedValue(new Error('409'));
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: /Create grant link/ }));
    expect(await screen.findByText(/no client secret stored/)).toBeInTheDocument();
    // And nothing that looks like a link was produced.
    expect(screen.queryByLabelText('The grant link')).not.toBeInTheDocument();
  });
});

describe('the list', () => {
  it('says when there is nothing rather than showing an empty box', async () => {
    renderPanel();
    expect(await screen.findByText(/No links yet/)).toBeInTheDocument();
  });

  it('reports a failed READ as a failed read, never as no links', async () => {
    listMock.mockRejectedValue(new Error('boom'));
    renderPanel();
    expect(await screen.findByText(/Could not read the links/)).toBeInTheDocument();
    expect(screen.queryByText(/No links yet/)).not.toBeInTheDocument();
  });

  it('keeps a link that expired UNUSED loud, with the next move beside it', async () => {
    listMock.mockResolvedValue([link({ state: 'expired', expiresAt: LAST_WEEK })]);
    renderPanel();
    expect(await screen.findByText('Expired unused')).toBeInTheDocument();
    expect(screen.getByText(/Nobody got as far as granting access/)).toBeInTheDocument();
  });

  it('does not offer to revoke a link that is already spent, revoked or expired', async () => {
    listMock.mockResolvedValue([
      link({ id: 'a', state: 'used', usedAt: LAST_WEEK }),
      link({ id: 'b', state: 'revoked', revokedAt: LAST_WEEK }),
      link({ id: 'c', state: 'expired', expiresAt: LAST_WEEK }),
    ]);
    renderPanel();
    await screen.findByText('Granted');
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });
});

describe('revoking', () => {
  it('takes two clicks — the first only arms it', async () => {
    listMock.mockResolvedValue([link()]);
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    expect(revokeMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    await waitFor(() => expect(revokeMock).toHaveBeenCalledWith('acme-mail', 'link-1'));
  });

  it("shows a failed revoke on the row, because the door may still be open", async () => {
    listMock.mockResolvedValue([link()]);
    serverMessageMock.mockReturnValue('the revoke did not land');
    revokeMock.mockRejectedValue(new Error('500'));
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    expect(await screen.findByText('the revoke did not land')).toBeInTheDocument();
  });
});

describe('the appliance', () => {
  it('renders nothing, and asks the API nothing', async () => {
    // The routes are the managed API's; the appliance's half is unbuilt. A
    // button that 404s would be worse than no button.
    selfHostMock.mockReturnValue(true);
    const { container } = renderPanel();
    expect(container).toBeEmptyDOMElement();
    await waitFor(() => expect(listMock).not.toHaveBeenCalled());
  });
});
