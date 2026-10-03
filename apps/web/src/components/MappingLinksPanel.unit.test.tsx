// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The owner's links, both lifetimes (workplan 0108 T3, 0122 T5), now that a
 * link is the person's (ADR-0035, amended 2026-09-29; the owner, 2026-10-03:
 * *"yes, replace the per-migration links"*).
 *
 * What is asserted here is what an owner can be misled about: that the link is
 * shown once and said to be, that a refusal arrives in the SERVER's words
 * rather than a generic failure, that revoking takes two clicks, and that a
 * link which expired unused is the one row that stays loud. A link is made in
 * the person's sections (`PersonGrantLinkSection`, `PersonViewLinkSection`); a
 * migration's page makes none, points at the person's page or asks who the
 * migration is for, and lists the links it was given before, revocable.
 *
 * `listMappingLinks` has never filtered by purpose, so every query below is
 * scoped to ONE section: a test that searched the whole panel would pass
 * whichever section the row landed in.
 *
 * Assertions are on the English strings, relying on `useLocale`'s documented
 * un-provided fallback, the same way `RunsPanel.unit.test.tsx` does.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

const {
  listMock,
  revokeMock,
  personIssueMock,
  personRevokeMock,
  selfHostMock,
  serverMessageMock,
  peopleMock,
  createPersonMock,
  addMigrationMock,
} = vi.hoisted(() => ({
  listMock: vi.fn(),
  revokeMock: vi.fn(),
  personIssueMock: vi.fn(),
  personRevokeMock: vi.fn(),
  selfHostMock: vi.fn(() => false),
  serverMessageMock: vi.fn(() => 'a server sentence'),
  peopleMock: vi.fn(),
  createPersonMock: vi.fn(),
  addMigrationMock: vi.fn(),
}));

vi.mock('../services/grant-link-service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/grant-link-service.ts')>();
  return {
    ...actual,
    grantLinkApi: { list: listMock, revoke: revokeMock },
    personLinkApi: { list: vi.fn(), issue: personIssueMock, revoke: personRevokeMock },
  };
});
vi.mock('../services/edition.ts', () => ({ isSelfHost: selfHostMock }));
vi.mock('../services/api.ts', () => ({
  default: {},
  serverMessage: serverMessageMock,
}));
vi.mock('../services/operating-service.ts', () => ({
  fetchPeople: peopleMock,
  createPerson: createPersonMock,
  addMigrationToPerson: addMigrationMock,
}));

import MappingLinksPanel, { PersonGrantLinkSection, PersonViewLinkSection } from './MappingLinksPanel.tsx';

const IN_A_WEEK = new Date(Date.now() + 7 * 86_400_000).toISOString();
const LAST_WEEK = new Date(Date.now() - 7 * 86_400_000).toISOString();

const link = (over: Record<string, unknown> = {}) => ({
  id: 'link-1',
  purpose: 'grant' as const,
  state: 'live' as const,
  createdAt: LAST_WEEK,
  createdBy: 'pat',
  expiresAt: IN_A_WEEK,
  usedAt: null,
  revokedAt: null,
  ...over,
});

const person = (id: string, displayName: string, migrations: string[]) => ({
  id,
  implicit: false,
  displayName,
  email: null,
  createdAt: LAST_WEEK,
  migrations: migrations.map((m) => ({ id: m, status: 'paused' })),
  counts: { paused: migrations.length, active: 0, cutover: 0, done: 0, continuous: 0 },
});

const ANNA = person('p-anna', 'Anna Jansen', ['acme-mail']);

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const renderPanel = () => wrap(<MappingLinksPanel mappingId="acme-mail" />);
const renderPersonLinks = (links: ReturnType<typeof link>[] = []) =>
  wrap(
    <>
      <PersonGrantLinkSection personId="p-anna" links={links} loadFailed={false} />
      <PersonViewLinkSection personId="p-anna" links={links} loadFailed={false} />
    </>,
  );

/** One section, by its heading: every query says which, see the header. */
async function section(title: string) {
  const heading = await screen.findByRole('heading', { name: title });
  return within(heading.closest('section')!);
}

beforeEach(() => {
  vi.clearAllMocks();
  selfHostMock.mockReturnValue(false);
  serverMessageMock.mockReturnValue('a server sentence');
  listMock.mockResolvedValue([]);
  peopleMock.mockResolvedValue({ people: [ANNA], unassigned: [] });
});

describe("issuing a person's grant link", () => {
  it('offers the three lifetimes with seven days pre-filled', async () => {
    renderPersonLinks();
    const grant = await section('One grant link for everything');
    const select = grant.getByLabelText(/The link works for/);
    expect((select as HTMLSelectElement).value).toBe('7');
    expect(grant.getByRole('option', { name: '1 day' })).toBeInTheDocument();
    expect(grant.getByRole('option', { name: '30 days' })).toBeInTheDocument();
    // The progress link's lifetimes are NOT on offer here: seven days is the
    // credential's window and ninety is the page's.
    expect(grant.queryByRole('option', { name: '90 days' })).not.toBeInTheDocument();
  });

  it('shows the URL once, says so, and says who sends it', async () => {
    personIssueMock.mockResolvedValue({
      id: 'link-1',
      purpose: 'grant',
      url: 'https://app.example/grant/p.link-1.sekrit',
      expiresAt: IN_A_WEEK,
      expiryDays: 7,
      distribution: 'ignored — the screen has its own translated sentence',
    });
    renderPersonLinks();
    const grant = await section('One grant link for everything');
    await userEvent.click(grant.getByRole('button', { name: /Create grant link/ }));

    // The URL is in a real input, not only behind a copy button: a browser that
    // refuses clipboard access must still leave it selectable.
    const field = await grant.findByLabelText('The grant link');
    expect((field as HTMLInputElement).value).toBe('https://app.example/grant/p.link-1.sekrit');
    expect(grant.getByText(/only time it can be shown/)).toBeInTheDocument();
    // ADR-0035's division of labour, on the screen rather than only in an ADR.
    expect(grant.getByText(/Send it yourself/)).toBeInTheDocument();
  });

  it('passes the purpose and the chosen expiry, not always the default', async () => {
    personIssueMock.mockResolvedValue({
      id: 'link-1',
      purpose: 'grant',
      url: 'https://app.example/grant/p.link-1.sekrit',
      expiresAt: IN_A_WEEK,
      expiryDays: 1,
      distribution: '',
    });
    renderPersonLinks();
    const grant = await section('One grant link for everything');
    await userEvent.selectOptions(grant.getByLabelText(/The link works for/), '1');
    await userEvent.click(grant.getByRole('button', { name: /Create grant link/ }));
    await waitFor(() => expect(personIssueMock).toHaveBeenCalledWith('p-anna', 'grant', 1));
  });

  it("shows a refusal in the SERVER's words, not a generic failure", async () => {
    serverMessageMock.mockReturnValue(
      "None of Anna Jansen's migrations can be granted through a link. This migration reads no Google account.",
    );
    personIssueMock.mockRejectedValue(new Error('409'));
    renderPersonLinks();
    const grant = await section('One grant link for everything');
    await userEvent.click(grant.getByRole('button', { name: /Create grant link/ }));
    expect(await grant.findByText(/can be granted through a link/)).toBeInTheDocument();
    // And nothing that looks like a link was produced.
    expect(grant.queryByLabelText('The grant link')).not.toBeInTheDocument();
  });

  it('says when there is nothing rather than showing an empty box', async () => {
    renderPersonLinks();
    expect((await section('One grant link for everything')).getByText('No link yet for this person.')).toBeInTheDocument();
    expect(
      (await section('One progress link for everything')).getByText('No progress link yet for this person.'),
    ).toBeInTheDocument();
  });
});

describe("issuing a person's progress link", () => {
  it('offers its own longer lifetimes with ninety days pre-filled', async () => {
    renderPersonLinks();
    const view = await section('One progress link for everything');
    const select = view.getByLabelText(/The link works for/);
    expect((select as HTMLSelectElement).value).toBe('90');
    expect(view.getByRole('option', { name: '180 days' })).toBeInTheDocument();
    expect(view.queryByRole('option', { name: '1 day' })).not.toBeInTheDocument();
  });

  it('asks for the view purpose, so the API mints the right lifetime', async () => {
    personIssueMock.mockResolvedValue({
      id: 'link-2',
      purpose: 'view',
      url: 'https://app.example/view/p.link-2.sekrit',
      expiresAt: IN_A_WEEK,
      expiryDays: 90,
      distribution: '',
    });
    renderPersonLinks();
    const view = await section('One progress link for everything');
    await userEvent.click(view.getByRole('button', { name: /Create progress link/ }));
    await waitFor(() => expect(personIssueMock).toHaveBeenCalledWith('p-anna', 'view', 90));
    const field = await view.findByLabelText('The progress link');
    expect((field as HTMLInputElement).value).toBe('https://app.example/view/p.link-2.sekrit');
  });
});

describe("a migration's page, since a link is the person's", () => {
  it("points to the person's page, and makes no link of its own", async () => {
    renderPanel();
    const links = await section('Links');
    expect(
      await links.findByText(/Grant and progress links are made per person: one for all of Anna Jansen’s migrations\./),
    ).toBeInTheDocument();
    expect(links.getByRole('link', { name: 'Open Anna Jansen’s page' })).toHaveAttribute('href', '/people/p-anna');
    expect(screen.queryByRole('button', { name: /Create grant link/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Create progress link/ })).not.toBeInTheDocument();
  });

  it('asks who it is for when it belongs to nobody, and adds it to the one chosen', async () => {
    peopleMock.mockResolvedValue({ people: [person('p-anna', 'Anna Jansen', ['other'])], unassigned: [] });
    addMigrationMock.mockResolvedValue(ANNA);
    renderPanel();
    const links = await section('Links');
    expect(await links.findByText('Links are made per person, so first say who this migration is for.')).toBeInTheDocument();
    expect((links.getByLabelText('Who is this for?') as HTMLSelectElement).value).toBe('p-anna');

    await userEvent.click(links.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(addMigrationMock).toHaveBeenCalledWith('p-anna', 'acme-mail'));
    expect(createPersonMock).not.toHaveBeenCalled();
  });

  it('adds it to somebody new, named here', async () => {
    peopleMock.mockResolvedValue({ people: [], unassigned: [] });
    createPersonMock.mockResolvedValue(person('p-bram', 'Bram', []));
    addMigrationMock.mockResolvedValue(person('p-bram', 'Bram', ['acme-mail']));
    renderPanel();
    const links = await section('Links');
    expect((await links.findByLabelText('Who is this for?') as HTMLSelectElement).value).toBe('new');
    const save = links.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();

    await userEvent.type(links.getByLabelText('Name'), 'Bram');
    await userEvent.click(save);

    await waitFor(() => expect(addMigrationMock).toHaveBeenCalledWith('p-bram', 'acme-mail'));
    expect(createPersonMock).toHaveBeenCalledWith({ displayName: 'Bram', email: null });
  });

  it('says a failed read of who it is for as a failed read, and offers no form on a guess', async () => {
    peopleMock.mockRejectedValue(new Error('boom'));
    renderPanel();
    const links = await section('Links');
    expect(await links.findByText('Could not read who this migration is for.')).toBeInTheDocument();
    expect(links.queryByLabelText('Who is this for?')).not.toBeInTheDocument();
  });
});

describe('links sent before, on a migration’s page', () => {
  it('lists nothing, and offers to make nothing, when none was sent', async () => {
    renderPanel();
    await section('Links');
    await waitFor(() => expect(listMock).toHaveBeenCalledWith('acme-mail'));
    expect(screen.queryByRole('heading', { name: 'Grant links sent before' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Progress links sent before' })).not.toBeInTheDocument();
  });

  it('reports a failed READ as a failed read, never as no links', async () => {
    listMock.mockRejectedValue(new Error('boom'));
    renderPanel();
    expect(await (await section('Links')).findByText(/Could not read the links/)).toBeInTheDocument();
  });

  it('puts each link under its own purpose, and never under the other, with no form to make another', async () => {
    listMock.mockResolvedValue([link({ id: 'a', purpose: 'grant' }), link({ id: 'b', purpose: 'view', createdBy: 'anna' })]);
    renderPanel();
    const grant = await section('Grant links sent before');
    const view = await section('Progress links sent before');
    expect(grant.getByText(/by pat/)).toBeInTheDocument();
    expect(grant.queryByText(/by anna/)).not.toBeInTheDocument();
    expect(view.getByText(/by anna/)).toBeInTheDocument();
    expect(view.queryByText(/by pat/)).not.toBeInTheDocument();
    expect(grant.getByText('They work until they expire. Revoke one here if it should stop sooner.')).toBeInTheDocument();
    expect(grant.queryByLabelText(/The link works for/)).not.toBeInTheDocument();
    expect(view.queryByLabelText(/The link works for/)).not.toBeInTheDocument();
  });

  it('does not invent a colleague for a link the grant ending minted', async () => {
    listMock.mockResolvedValue([link({ id: 'b', purpose: 'view', createdBy: 'granted-by-link' })]);
    renderPanel();
    const view = await section('Progress links sent before');
    expect(await view.findByText(/when they gave access/)).toBeInTheDocument();
    expect(view.queryByText(/granted-by-link/)).not.toBeInTheDocument();
  });

  it('keeps a link that expired UNUSED loud, with the next move beside it', async () => {
    listMock.mockResolvedValue([link({ state: 'expired', expiresAt: LAST_WEEK })]);
    renderPanel();
    const grant = await section('Grant links sent before');
    expect(await grant.findByText('Expired unused')).toBeInTheDocument();
    expect(grant.getByText(/Nobody got as far as granting access/)).toBeInTheDocument();
  });

  it('says something different when a PROGRESS link expires — nobody failed', async () => {
    listMock.mockResolvedValue([link({ id: 'b', purpose: 'view', state: 'expired', expiresAt: LAST_WEEK })]);
    renderPanel();
    const view = await section('Progress links sent before');
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
    const grant = await section('Grant links sent before');
    await grant.findByText('Granted');
    expect(grant.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });
});

describe('revoking a link sent before', () => {
  it('takes two clicks — the first only arms it', async () => {
    listMock.mockResolvedValue([link()]);
    renderPanel();
    const grant = await section('Grant links sent before');
    await userEvent.click(await grant.findByRole('button', { name: 'Revoke' }));
    expect(revokeMock).not.toHaveBeenCalled();

    await userEvent.click(grant.getByRole('button', { name: 'Confirm revoke' }));
    await waitFor(() => expect(revokeMock).toHaveBeenCalledWith('acme-mail', 'link-1'));
  });

  it('is the same one action for a progress link — one door, one kill switch', async () => {
    listMock.mockResolvedValue([link({ id: 'b', purpose: 'view' })]);
    renderPanel();
    const view = await section('Progress links sent before');
    await userEvent.click(await view.findByRole('button', { name: 'Revoke' }));
    await userEvent.click(view.getByRole('button', { name: 'Confirm revoke' }));
    await waitFor(() => expect(revokeMock).toHaveBeenCalledWith('acme-mail', 'b'));
  });

  it('shows a failed revoke on the row, because the door may still be open', async () => {
    listMock.mockResolvedValue([link()]);
    serverMessageMock.mockReturnValue('the revoke did not land');
    revokeMock.mockRejectedValue(new Error('500'));
    renderPanel();
    const grant = await section('Grant links sent before');
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
    expect(peopleMock).not.toHaveBeenCalled();
  });
});
