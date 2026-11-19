// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE PERSON ADDING A MIGRATION IS CHOSEN FIRST (the owner, 2026-11-19: "At
 * adding a migration I am asked to pick for whom. Default should be selected
 * my own name."; ADR-0050, amended 2026-11-19).
 *
 * *Who is it for?* chooses the person the server says is `you`: the signed-in
 * member's own, linked by that member. It stays a choice; it chooses nobody
 * where the member is not one of the people; a `?person=` from a person's
 * page wins; and a choice made on the screen wins whenever it was made. The
 * screens after it take the default as they take a choice: the migrations
 * are made for that person, and nobody new is.
 *
 * The people and their accounts are invented.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DISCOVERY_DOMAINS, lifecycleCounts, type PeopleResponse, type Person } from '@openmig/shared';
import StartMigration from './StartMigration.tsx';
import { addMigrationToPerson, createPerson, fetchPeople } from '../services/operating-service.ts';
import {
  connectionsApi,
  mappingApi,
  providerAccountsApi,
  providerClientsApi,
  scopeManifestApi,
  type ConnectionSummary,
  type Mapping,
} from '../services/mapping-service.ts';

vi.mock('../services/grant-link-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/grant-link-service.ts')>()),
  personLinkApi: { list: vi.fn(), issue: vi.fn(), revoke: vi.fn() },
}));
vi.mock('../services/operating-service', () => ({
  fetchPeople: vi.fn(),
  createPerson: vi.fn(),
  addMigrationToPerson: vi.fn(),
}));
vi.mock('../services/mapping-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/mapping-service.ts')>()),
  providerAccountsApi: { get: vi.fn() },
  providerClientsApi: { get: vi.fn() },
  connectionsApi: { list: vi.fn(), add: vi.fn(), remove: vi.fn(), folders: vi.fn() },
  mappingApi: { create: vi.fn(), start: vi.fn(), discover: vi.fn(), getDiscovery: vi.fn(), get: vi.fn() },
  scopeManifestApi: { get: vi.fn() },
}));

const peopleMock = vi.mocked(fetchPeople);
const createPersonMock = vi.mocked(createPerson);
const addToPersonMock = vi.mocked(addMigrationToPerson);
const createMock = vi.mocked(mappingApi.create);

const someone = (id: string, displayName: string, you: boolean): Person => ({
  id,
  implicit: false,
  displayName,
  email: null,
  createdAt: '2026-09-28T10:00:00.000Z',
  you,
  migrations: [],
  counts: lifecycleCounts([]),
});

/** The member signed in, as the server marks them. */
const ANNA = someone('p-anna', 'Anna Jansen', true);
/** Somebody else they migrate for. */
const BRAM = someone('p-bram', 'Bram Bakker', false);

const account = (over: Partial<ConnectionSummary>): ConnectionSummary => ({
  id: 'c-1',
  role: 'source',
  kind: 'imap',
  displayName: 'Anna mail',
  status: 'connected',
  createdAt: '2026-09-20T10:00:00.000Z',
  usedByMigrations: 0,
  ...over,
});

/** Mail from another provider to Soverin, both accounts saved. */
const SAVED = [
  account({ id: 'c-mail', knownValues: { username: 'anna@example.com' } }),
  account({ id: 'c-soverin', role: 'target', kind: 'soverin', displayName: 'Anna Soverin', knownValues: { username: 'anna.new@example.com' } }),
];

const renderAt = (path = '/start') => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/start" element={<StartMigration />} />
          <Route path="/people/:personId" element={<p>The person’s page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
};

const next = () => screen.getByRole('button', { name: 'Next' });
const radio = (name: string) => screen.getByRole('radio', { name });

beforeEach(() => {
  vi.resetAllMocks();
  peopleMock.mockResolvedValue({ people: [BRAM, ANNA], unassigned: [] });
  vi.mocked(providerAccountsApi.get).mockResolvedValue({
    google: { domains: ['calendar', 'contact', 'task'], client: 'deployment' },
    microsoft: { domains: [...DISCOVERY_DOMAINS] },
  } as never);
  vi.mocked(providerClientsApi.get).mockResolvedValue({
    google: 'deployment',
    dropbox: 'deployment',
    microsoft: 'deployment',
  });
  vi.mocked(connectionsApi.list).mockResolvedValue([]);
});

describe('Who is it for? chooses the member’s own person', () => {
  it('has them chosen: their name is checked, no name is asked for, and Next can be pressed', async () => {
    renderAt();

    expect(await screen.findByRole('radio', { name: 'Anna Jansen' })).toBeChecked();
    expect(radio('Bram Bakker')).not.toBeChecked();
    expect(radio('Someone new')).not.toBeChecked();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    expect(next()).toBeEnabled();
  });

  it('stays a choice: another person, or somebody new, and the default does not come back', async () => {
    const user = userEvent.setup();
    const client = renderAt();
    await screen.findByRole('radio', { name: 'Anna Jansen' });

    await user.click(radio('Bram Bakker'));
    expect(radio('Bram Bakker')).toBeChecked();
    expect(radio('Anna Jansen')).not.toBeChecked();

    await user.click(radio('Someone new'));
    expect(radio('Someone new')).toBeChecked();
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(next()).toHaveAccessibleDescription('Type a name first.');

    // The people read again (another tab, a refetch): the choice holds.
    await client.invalidateQueries({ queryKey: ['people'] });
    await vi.waitFor(() => expect(peopleMock).toHaveBeenCalledTimes(2));
    expect(radio('Someone new')).toBeChecked();
    expect(radio('Anna Jansen')).not.toBeChecked();
  });

  it('keeps a choice made on the screen when the flow comes back to it', async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(await screen.findByRole('radio', { name: 'Bram Bakker' }));
    await user.click(next());
    await screen.findByRole('heading', { level: 2, name: 'Which account are you leaving or moving?' });

    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(await screen.findByRole('radio', { name: 'Bram Bakker' })).toBeChecked();
    expect(radio('Anna Jansen')).not.toBeChecked();
  });

  it('keeps the person it went on with when the people are read again on a later screen', async () => {
    const user = userEvent.setup();
    const client = renderAt();
    await screen.findByRole('radio', { name: 'Anna Jansen' });
    await user.click(next());
    await screen.findByRole('heading', { level: 2, name: 'Which account are you leaving or moving?' });

    // Meanwhile, in another tab, the member said Bram is them.
    peopleMock.mockResolvedValue({ people: [{ ...BRAM, you: true }, { ...ANNA, you: false }], unassigned: [] });
    await client.invalidateQueries({ queryKey: ['people'] });
    await vi.waitFor(() => expect(peopleMock).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(await screen.findByRole('radio', { name: 'Anna Jansen' })).toBeChecked();
    expect(radio('Bram Bakker')).not.toBeChecked();
  });

  it('chooses nobody when the member is not one of the people', async () => {
    peopleMock.mockResolvedValue({ people: [BRAM, { ...ANNA, you: false }], unassigned: [] });
    renderAt();

    expect(await screen.findByRole('radio', { name: 'Someone new' })).toBeChecked();
    expect(radio('Anna Jansen')).not.toBeChecked();
    expect(radio('Bram Bakker')).not.toBeChecked();
    expect(next()).toHaveAccessibleDescription('Type a name first.');
  });

  it('lets a person’s page choose its person instead', async () => {
    renderAt('/start?person=p-bram');

    expect(await screen.findByRole('radio', { name: 'Bram Bakker' })).toBeChecked();
    expect(radio('Anna Jansen')).not.toBeChecked();
  });

  it('does not stand in for a ?person= that names nobody: the screen asks for a name', async () => {
    renderAt('/start?person=p-gone');

    expect(await screen.findByRole('radio', { name: 'Someone new' })).toBeChecked();
    expect(radio('Anna Jansen')).not.toBeChecked();
    expect(next()).toHaveAccessibleDescription('Type a name first.');
  });

  it('gives way to a name typed before the people were read', async () => {
    let answer: (people: PeopleResponse) => void = () => {};
    peopleMock.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const user = userEvent.setup();
    renderAt();

    await user.type(await screen.findByLabelText('Name'), 'Carla');
    answer({ people: [BRAM, ANNA], unassigned: [] });

    expect(await screen.findByRole('radio', { name: 'Someone new' })).toBeChecked();
    expect(radio('Anna Jansen')).not.toBeChecked();
    expect(screen.getByLabelText('Name')).toHaveValue('Carla');
  });

  it('arrives with the people when nothing was chosen before they were read', async () => {
    let answer: (people: PeopleResponse) => void = () => {};
    peopleMock.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    renderAt();
    await screen.findByLabelText('Name');

    answer({ people: [BRAM, ANNA], unassigned: [] });

    expect(await screen.findByRole('radio', { name: 'Anna Jansen' })).toBeChecked();
    expect(next()).toBeEnabled();
  });
});

describe('the screens after it take the default as a choice', () => {
  beforeEach(() => {
    vi.mocked(connectionsApi.list).mockResolvedValue(SAVED);
    createMock.mockResolvedValue({ id: 'm-mail' } as never);
    addToPersonMock.mockResolvedValue({ ...ANNA, migrations: [{ id: 'm-mail', status: 'paused' }] });
    vi.mocked(mappingApi.discover).mockResolvedValue({} as never);
    vi.mocked(mappingApi.get).mockResolvedValue({
      id: 'm-mail', tenantId: 't1', name: 'm-mail', sourceType: 'imap', targetType: 'soverin', status: 'paused',
      mode: 'mirror', syncConfig: { domains: ['email'] }, sourceConfig: {}, targetConfig: {},
      domainStatus: [], createdAt: '2026-11-19T08:00:00Z', updatedAt: '2026-11-19T08:00:00Z',
    } as unknown as Mapping);
    vi.mocked(mappingApi.getDiscovery).mockResolvedValue({
      mappingId: 'm-mail', discovered: true,
      domains: [{ domain: 'email', collections: 1, items: 10, bytes: 1024, discoveredAt: '2026-11-19T08:05:00Z' }],
    } as never);
    vi.mocked(scopeManifestApi.get).mockResolvedValue({ version: 'v1', migrates: [], partial: [], doesNotMigrate: [] });
  });

  it('sets the migration up for that person, under their name, and makes nobody new', async () => {
    const user = userEvent.setup();
    renderAt();
    await screen.findByRole('radio', { name: 'Anna Jansen' });

    // Screen 1 is passed without a click on it.
    await user.click(next());
    await user.click(screen.getByRole('checkbox', { name: /^Another mail provider/ }));
    await user.click(next());
    await screen.findByRole('heading', { level: 2, name: 'What moves?' });
    await user.click(next());
    await screen.findByRole('heading', { level: 2, name: 'Connect your accounts' });
    await screen.findByText('Connected as anna@example.com');
    await user.click(next());
    await screen.findByRole('heading', { level: 2, name: 'Where does it go?' });
    await user.click(screen.getByRole('button', { name: 'Set up' }));

    expect(await screen.findByRole('heading', { level: 2, name: 'Check, then start' })).toBeInTheDocument();
    expect(createPersonMock).not.toHaveBeenCalled();
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'Anna Jansen — example.com to Soverin' }));
    expect(addToPersonMock).toHaveBeenCalledWith('p-anna', 'm-mail');
  });
});
