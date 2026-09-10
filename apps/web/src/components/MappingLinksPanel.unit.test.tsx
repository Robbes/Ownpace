// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The owner's link panel, both lifetimes (workplan 0108 T3, 0122 T5).
 *
 * What is asserted here is what an owner can be misled about: that the link is
 * shown once and said to be, that a refusal arrives in the SERVER's words
 * rather than a generic failure, that revoking takes two clicks, and that a
 * link which expired unused is the one row that stays loud.
 *
 * Since 0122 there is a second thing to be misled about, and it was latent
 * before the feature existed: `listMappingLinks` has never filtered by purpose,
 * so a progress link would have appeared in the credential list wearing its
 * words. Every query below is scoped to ONE section for that reason — a test
 * that searched the whole panel would pass whichever section the row landed in,
 * which is precisely the defect.
 *
 * Assertions are on the English strings, relying on `useLocale`'s documented
 * un-provided fallback, the same way `RunsPanel.unit.test.tsx` does.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

import MappingLinksPanel from './MappingLinksPanel.tsx';

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
      <MappingLinksPanel mappingId="acme-mail" />
    </QueryClientProvider>,
  );
}

/**
 * One section, by its heading. The panel renders both, so every query has to
 * say which — see the header.
 */
async function section(title: 'Grant links' | 'Progress links') {
  const heading = await screen.findByRole('heading', { name: title });
  return within(heading.closest('section')!);
}

beforeEach(() => {
  vi.clearAllMocks();
  selfHostMock.mockReturnValue(false);
  serverMessageMock.mockReturnValue('a server sentence');
  listMock.mockResolvedValue([]);
});

describe('issuing a credential link', () => {
  it('offers the three lifetimes with seven days pre-filled', async () => {
    renderPanel();
    const grant = await section('Grant links');
    const select = grant.getByLabelText(/The link works for/);
    expect((select as HTMLSelectElement).value).toBe('7');
    expect(grant.getByRole('option', { name: '1 day' })).toBeInTheDocument();
    expect(grant.getByRole('option', { name: '30 days' })).toBeInTheDocument();
    // The progress link's lifetimes are NOT on offer here: seven days is the
    // credential's window and ninety is the page's, and pairing them the wrong
    // way round is the mistake this separation exists to prevent.
    expect(grant.queryByRole('option', { name: '90 days' })).not.toBeInTheDocument();
  });

  it('shows the URL once, says so, and says who sends it', async () => {
    issueMock.mockResolvedValue({
      id: 'link-1',
      purpose: 'grant',
      url: 'https://app.example/grant/link-1.sekrit',
      expiresAt: IN_A_WEEK,
      expiryDays: 7,
      distribution: 'ignored — the screen has its own translated sentence',
    });
    renderPanel();
    const grant = await section('Grant links');
    await userEvent.click(grant.getByRole('button', { name: /Create grant link/ }));

    // The URL is in a real input, not only behind a copy button: a browser that
    // refuses clipboard access must still leave it selectable.
    const field = await grant.findByLabelText('The grant link');
    expect((field as HTMLInputElement).value).toBe('https://app.example/grant/link-1.sekrit');
    expect(grant.getByText(/only time it can be shown/)).toBeInTheDocument();
    // ADR-0035's division of labour, on the screen rather than only in an ADR.
    expect(grant.getByText(/Send it yourself/)).toBeInTheDocument();
  });

  it('passes the purpose and the chosen expiry, not always the default', async () => {
    issueMock.mockResolvedValue({
      id: 'link-1',
      purpose: 'grant',
      url: 'https://app.example/grant/link-1.sekrit',
      expiresAt: IN_A_WEEK,
      expiryDays: 1,
      distribution: '',
    });
    renderPanel();
    const grant = await section('Grant links');
    await userEvent.selectOptions(grant.getByLabelText(/The link works for/), '1');
    await userEvent.click(grant.getByRole('button', { name: /Create grant link/ }));
    await waitFor(() => expect(issueMock).toHaveBeenCalledWith('acme-mail', 'grant', 1));
  });

  it("shows a refusal in the SERVER's words, not a generic failure", async () => {
    // The four refusals each name what to configure. Replacing them with
    // "could not create link" would throw away the only useful half.
    serverMessageMock.mockReturnValue(
      'The consent runs against your own Google client, and this source has no client secret stored.',
    );
    issueMock.mockRejectedValue(new Error('409'));
    renderPanel();
    const grant = await section('Grant links');
    await userEvent.click(grant.getByRole('button', { name: /Create grant link/ }));
    expect(await grant.findByText(/no client secret stored/)).toBeInTheDocument();
    // And nothing that looks like a link was produced.
    expect(grant.queryByLabelText('The grant link')).not.toBeInTheDocument();
  });
});

describe('issuing a progress link', () => {
  it('offers its own longer lifetimes with ninety days pre-filled', async () => {
    renderPanel();
    const view = await section('Progress links');
    const select = view.getByLabelText(/The link works for/);
    expect((select as HTMLSelectElement).value).toBe('90');
    expect(view.getByRole('option', { name: '180 days' })).toBeInTheDocument();
    // A single-use credential's one-day window means nothing to a page meant
    // to be opened for months, and the reverse is the dangerous direction.
    expect(view.queryByRole('option', { name: '1 day' })).not.toBeInTheDocument();
  });

  it('asks for the view purpose, so the API mints the right lifetime', async () => {
    issueMock.mockResolvedValue({
      id: 'link-2',
      purpose: 'view',
      url: 'https://app.example/view/link-2.sekrit',
      expiresAt: IN_A_WEEK,
      expiryDays: 90,
      distribution: '',
    });
    renderPanel();
    const view = await section('Progress links');
    await userEvent.click(view.getByRole('button', { name: /Create progress link/ }));
    await waitFor(() => expect(issueMock).toHaveBeenCalledWith('acme-mail', 'view', 90));

    const field = await view.findByLabelText('The progress link');
    expect((field as HTMLInputElement).value).toBe('https://app.example/view/link-2.sekrit');
  });
});

describe('the list', () => {
  it('says when there is nothing rather than showing an empty box', async () => {
    renderPanel();
    const grant = await section('Grant links');
    const view = await section('Progress links');
    expect(grant.getByText(/No links yet/)).toBeInTheDocument();
    expect(view.getByText(/No progress links yet/)).toBeInTheDocument();
  });

  it('reports a failed READ as a failed read, never as no links', async () => {
    listMock.mockRejectedValue(new Error('boom'));
    renderPanel();
    const grant = await section('Grant links');
    expect(await grant.findByText(/Could not read the links/)).toBeInTheDocument();
    expect(grant.queryByText(/No links yet/)).not.toBeInTheDocument();
  });

  it('puts each link under its own purpose, and never under the other', async () => {
    // The defect this whole split exists for: one list, two purposes, and a
    // panel that rendered neither. A progress link shown under "Grant links"
    // would be described as spent, granted and single-use — none of which is
    // true of it.
    listMock.mockResolvedValue([
      link({ id: 'a', purpose: 'grant' }),
      link({ id: 'b', purpose: 'view', createdBy: 'anna' }),
    ]);
    renderPanel();
    const grant = await section('Grant links');
    const view = await section('Progress links');
    expect(grant.getByText(/by rob/)).toBeInTheDocument();
    expect(grant.queryByText(/by anna/)).not.toBeInTheDocument();
    expect(view.getByText(/by anna/)).toBeInTheDocument();
    expect(view.queryByText(/by rob/)).not.toBeInTheDocument();
  });

  it('keeps a link that expired UNUSED loud, with the next move beside it', async () => {
    listMock.mockResolvedValue([link({ state: 'expired', expiresAt: LAST_WEEK })]);
    renderPanel();
    const grant = await section('Grant links');
    expect(await grant.findByText('Expired unused')).toBeInTheDocument();
    expect(grant.getByText(/Nobody got as far as granting access/)).toBeInTheDocument();
  });

  it('says something different when a PROGRESS link expires — nobody failed', async () => {
    // "Nobody got as far as granting access" is a reproach, and there is
    // nothing to reproach: their page simply stopped working.
    listMock.mockResolvedValue([
      link({ id: 'b', purpose: 'view', state: 'expired', expiresAt: LAST_WEEK }),
    ]);
    renderPanel();
    const view = await section('Progress links');
    expect(await view.findByText(/Their page has stopped working/)).toBeInTheDocument();
    expect(view.queryByText(/granting access/)).not.toBeInTheDocument();
  });

  it('does not offer to revoke a link that is already spent, revoked or expired', async () => {
    listMock.mockResolvedValue([
      link({ id: 'a', state: 'used', usedAt: LAST_WEEK }),
      link({ id: 'b', state: 'revoked', revokedAt: LAST_WEEK }),
      link({ id: 'c', state: 'expired', expiresAt: LAST_WEEK }),
    ]);
    renderPanel();
    const grant = await section('Grant links');
    await grant.findByText('Granted');
    expect(grant.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });
});

describe('revoking', () => {
  it('takes two clicks — the first only arms it', async () => {
    listMock.mockResolvedValue([link()]);
    renderPanel();
    const grant = await section('Grant links');
    await userEvent.click(await grant.findByRole('button', { name: 'Revoke' }));
    expect(revokeMock).not.toHaveBeenCalled();

    await userEvent.click(grant.getByRole('button', { name: 'Confirm revoke' }));
    await waitFor(() => expect(revokeMock).toHaveBeenCalledWith('acme-mail', 'link-1'));
  });

  it('is the same one action for a progress link — one door, one kill switch', async () => {
    listMock.mockResolvedValue([link({ id: 'b', purpose: 'view' })]);
    renderPanel();
    const view = await section('Progress links');
    await userEvent.click(await view.findByRole('button', { name: 'Revoke' }));
    await userEvent.click(view.getByRole('button', { name: 'Confirm revoke' }));
    await waitFor(() => expect(revokeMock).toHaveBeenCalledWith('acme-mail', 'b'));
  });

  it('shows a failed revoke on the row, because the door may still be open', async () => {
    listMock.mockResolvedValue([link()]);
    serverMessageMock.mockReturnValue('the revoke did not land');
    revokeMock.mockRejectedValue(new Error('500'));
    renderPanel();
    const grant = await section('Grant links');
    await userEvent.click(await grant.findByRole('button', { name: 'Revoke' }));
    await userEvent.click(grant.getByRole('button', { name: 'Confirm revoke' }));
    expect(await grant.findByText('the revoke did not land')).toBeInTheDocument();
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
