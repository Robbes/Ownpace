// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * START A MIGRATION, ITS FIRST SCREENS (workplan 0153 T4, T7): who it is for,
 * which accounts are left, and what moves. Each screen starts with focus on
 * its heading, a Next that cannot be pressed says why under it, a tile or a
 * data type that has not met a real account says so, and a data type a
 * provider cannot give is said to be the provider's limit.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DISCOVERY_DOMAINS, lifecycleCounts, type Person } from '@openmig/shared';
import StartMigration from './StartMigration.tsx';
import { fetchPeople } from '../services/operating-service.ts';
import { providerAccountsApi } from '../services/mapping-service.ts';

vi.mock('../services/operating-service', () => ({ fetchPeople: vi.fn() }));
vi.mock('../services/mapping-service', () => ({ providerAccountsApi: { get: vi.fn() } }));

const peopleMock = vi.mocked(fetchPeople);
const factsMock = vi.mocked(providerAccountsApi.get);

const ANNA: Person = {
  id: 'p-anna',
  implicit: false,
  displayName: 'Anna Jansen',
  email: null,
  createdAt: '2026-09-28T10:00:00.000Z',
  migrations: [],
  counts: lifecycleCounts([]),
};

/** What a deployment without Google's restricted scopes answers, which is the default. */
const NARROW = {
  google: { domains: ['calendar', 'contact', 'task'] as const, client: 'deployment' as const },
  microsoft: { domains: [...DISCOVERY_DOMAINS] as const },
};

const renderAt = (path = '/start') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/start" element={<StartMigration />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const next = () => screen.getByRole('button', { name: 'Next' });

/** Walk to *What moves?* with these tiles ticked. */
async function toWhatMoves(user: ReturnType<typeof userEvent.setup>, tiles: string[]) {
  await user.type(await screen.findByLabelText('Name'), 'Anna Jansen');
  await user.click(next());
  for (const tile of tiles) await user.click(screen.getByRole('checkbox', { name: new RegExp(`^${tile}`) }));
  await user.click(next());
  await screen.findByRole('heading', { level: 2, name: 'What moves?' });
}

beforeEach(() => {
  vi.resetAllMocks();
  peopleMock.mockResolvedValue({ people: [], unassigned: [] });
  factsMock.mockResolvedValue(NARROW as never);
});

describe('Who is it for? (screen 1)', () => {
  it('asks for a name, and says why Next waits until there is one', async () => {
    const user = userEvent.setup();
    renderAt();
    expect(screen.getByRole('heading', { level: 1, name: 'Start a migration' })).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Who is it for?' })).toBeInTheDocument();
    expect(next()).toBeDisabled();
    expect(next()).toHaveAccessibleDescription('Type a name first.');

    await user.type(await screen.findByLabelText('Name'), 'Anna Jansen');
    expect(next()).toBeEnabled();
    await user.click(next());
    // A new screen starts with focus on its heading (0145 T3 (a)).
    expect(screen.getByRole('heading', { level: 2, name: 'Which account are you leaving?' })).toHaveFocus();
    expect(screen.getByText('Step 2 of 6')).toBeInTheDocument();
  });

  it('offers the people already on Migrations, and a person’s page chooses its person', async () => {
    peopleMock.mockResolvedValue({ people: [ANNA], unassigned: [] });
    renderAt('/start?person=p-anna');
    expect(await screen.findByRole('radio', { name: 'Anna Jansen' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Someone new' })).not.toBeChecked();
    // No name to type for somebody who has one.
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    expect(next()).toBeEnabled();
  });

  it('still takes a new name when the people could not be read, and says so', async () => {
    peopleMock.mockRejectedValue(new Error('down'));
    renderAt();
    expect(await screen.findByRole('alert')).toHaveTextContent('The people you migrate for could not be read.');
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
  });
});

describe('Which account are you leaving? (screen 2)', () => {
  it('draws six tiles with none ticked, and waits for one', async () => {
    const user = userEvent.setup();
    renderAt();
    await user.type(await screen.findByLabelText('Name'), 'Anna Jansen');
    await user.click(next());
    const tiles = screen.getAllByRole('checkbox');
    expect(tiles.map((c) => c.getAttribute('aria-checked') ?? String((c as HTMLInputElement).checked))).toEqual(
      Array(6).fill('false'),
    );
    expect(next()).toHaveAccessibleDescription('Tick at least one account.');
    await user.click(screen.getByRole('checkbox', { name: /^Google/ }));
    await user.click(screen.getByRole('checkbox', { name: /^Dropbox/ }));
    expect(next()).toBeEnabled();
  });

  it('tags a tile that has not met a real account, and only such a tile (0131 D6)', async () => {
    const user = userEvent.setup();
    renderAt();
    await user.type(await screen.findByLabelText('Name'), 'Anna Jansen');
    await user.click(next());
    for (const tagged of ['Microsoft 365', 'Apple iCloud', 'Dropbox', 'Box']) {
      expect(screen.getByRole('checkbox', { name: `${tagged} Experimental` })).toBeInTheDocument();
    }
    expect(screen.getByRole('checkbox', { name: 'Google' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Another mail provider' })).toBeInTheDocument();
  });

  it('sends an export archive and a server by its protocol to the wizard, with the person', async () => {
    const user = userEvent.setup();
    peopleMock.mockResolvedValue({ people: [ANNA], unassigned: [] });
    renderAt('/start?person=p-anna');
    await screen.findByRole('radio', { name: 'Anna Jansen' });
    await user.click(next());
    const archive = screen.getByRole('link', { name: /An export archive \(Takeout, Apple\)/ });
    expect(archive).toHaveAttribute('href', '/mappings/new?person=p-anna');
  });
});

describe('What moves? (screen 3)', () => {
  it('ticks everything a provider can give, and tags the faces that have not met a real account', async () => {
    const user = userEvent.setup();
    renderAt();
    await toWhatMoves(user, ['Google']);
    const google = screen.getByRole('group', { name: 'From Google' });
    const ticks = within(google).getAllByRole('checkbox');
    expect(ticks.map((c) => (c as HTMLInputElement).checked)).toEqual([true, true, true, true, true]);
    // Mail goes through the gmail card here, which has run against a real
    // account; Tasks through the account, whose tasks face has not.
    expect(within(google).getByRole('checkbox', { name: 'Email' })).toBeInTheDocument();
    expect(within(google).getByRole('checkbox', { name: 'Tasks Experimental' })).toBeInTheDocument();
  });

  it('says how photos come, and ticks nothing for them', async () => {
    const user = userEvent.setup();
    renderAt();
    await toWhatMoves(user, ['Google']);
    const google = screen.getByRole('group', { name: 'From Google' });
    expect(within(google).getByText('Photos')).toBeInTheDocument();
    expect(within(google).getByRole('link', { name: 'Ask for it at Google Takeout' })).toHaveAttribute(
      'href',
      'https://takeout.google.com',
    );
    expect(within(google).queryByRole('checkbox', { name: /Photos/ })).not.toBeInTheDocument();
  });

  it('asks what Google Docs become under Files, and only while Files is ticked', async () => {
    const user = userEvent.setup();
    renderAt();
    await toWhatMoves(user, ['Google']);
    const google = screen.getByRole('group', { name: 'From Google' });
    expect(within(google).getAllByRole('combobox')).toHaveLength(4);
    await user.click(within(google).getByRole('checkbox', { name: 'Files' }));
    expect(within(google).queryAllByRole('combobox')).toHaveLength(0);
  });

  it('blames a missing data type on the provider, never on the destination (T7 (e))', async () => {
    const user = userEvent.setup();
    renderAt();
    await toWhatMoves(user, ['Apple iCloud', 'Dropbox']);
    expect(screen.getByText('Not from Apple iCloud: files.')).toBeInTheDocument();
    expect(screen.getByText('Not from Dropbox: email, calendar, contacts, and tasks.')).toBeInTheDocument();
    // Dropbox's Paper docs have no file either: their format is asked here.
    const dropbox = screen.getByRole('group', { name: 'From Dropbox' });
    expect(within(dropbox).getByRole('combobox')).toBeInTheDocument();
  });

  it('waits while nothing is ticked, and says why', async () => {
    const user = userEvent.setup();
    renderAt();
    await toWhatMoves(user, ['Another mail provider']);
    await user.click(screen.getByRole('checkbox', { name: 'Email' }));
    expect(next()).toBeDisabled();
    expect(next()).toHaveAccessibleDescription('Tick at least one thing to move.');
  });
});

describe('Connect your accounts (screen 4, what it will ask)', () => {
  it('says before the first sign-in that Google takes three here, and why', async () => {
    const user = userEvent.setup();
    renderAt();
    await toWhatMoves(user, ['Google']);
    await user.click(next());
    expect(screen.getByRole('heading', { level: 2, name: 'Connect your accounts' })).toHaveFocus();
    expect(
      screen.getByText('Google asks for mail and files apart on this service, so this takes 3 sign-ins.'),
    ).toBeInTheDocument();
  });

  it('asks Google once where the deployment declares the restricted scopes', async () => {
    factsMock.mockResolvedValue({
      google: { domains: [...DISCOVERY_DOMAINS], client: 'deployment' },
    } as never);
    const user = userEvent.setup();
    renderAt();
    await toWhatMoves(user, ['Google']);
    await user.click(next());
    expect(screen.queryByText(/Google asks for mail and files apart/)).not.toBeInTheDocument();
    expect(screen.getByText('One sign-in: email, calendar, contacts, files, and tasks')).toBeInTheDocument();
  });
});
