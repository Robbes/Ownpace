// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * START A MIGRATION (workplan 0153 T4, T7): who it is for, which accounts are
 * left, what moves, connecting them, and where each thing goes. Each screen
 * starts with focus on its heading, a Next that cannot be pressed says why
 * under it, a tile or a data type that has not met a real account says so,
 * and a limit is blamed on the side that has it. The account you already have
 * is the default; a new one shows only what a person must type, and is kept
 * only once its check passes.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DISCOVERY_DOMAINS, lifecycleCounts, type Person } from '@openmig/shared';
import StartMigration from './StartMigration.tsx';
import { grantLinkApi } from '../services/grant-link-service.ts';
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
  grantLinkApi: { list: vi.fn(), issue: vi.fn(), revoke: vi.fn() },
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
  connectionsApi: { list: vi.fn(), add: vi.fn(), remove: vi.fn() },
  mappingApi: { create: vi.fn(), start: vi.fn(), discover: vi.fn(), getDiscovery: vi.fn(), get: vi.fn() },
  scopeManifestApi: { get: vi.fn() },
}));

const peopleMock = vi.mocked(fetchPeople);
const factsMock = vi.mocked(providerAccountsApi.get);
const clientsMock = vi.mocked(providerClientsApi.get);
const listMock = vi.mocked(connectionsApi.list);
const addMock = vi.mocked(connectionsApi.add);
const removeMock = vi.mocked(connectionsApi.remove);

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
          <Route path="/people/:personId" element={<p>The person’s page</p>} />
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
  clientsMock.mockResolvedValue({ google: 'deployment', dropbox: 'deployment', microsoft: 'deployment' });
  listMock.mockResolvedValue([]);
});

/** Walk on from *What moves?* to the screen with this heading. */
async function onTo(user: ReturnType<typeof userEvent.setup>, heading: string) {
  await user.click(next());
  return screen.findByRole('heading', { level: 2, name: heading });
}

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

  it('chooses nobody for a ?person= that names nobody, and asks for a name', async () => {
    peopleMock.mockResolvedValue({ people: [ANNA], unassigned: [] });
    renderAt('/start?person=p-gone');
    expect(await screen.findByRole('radio', { name: 'Someone new' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Anna Jansen' })).not.toBeChecked();
    expect(next()).toHaveAccessibleDescription('Type a name first.');
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

  it('folds the why inside its own tile, and opening it does not tick the tile', async () => {
    const user = userEvent.setup();
    renderAt();
    await user.type(await screen.findByLabelText('Name'), 'Anna Jansen');
    await user.click(next());
    const box = screen.getByRole('checkbox', { name: 'Box Experimental' });
    const tile = box.closest('label')!.parentElement!;
    const why = within(tile).getByText('Why?');
    // The border drawn around the tile is the box that holds the fold too.
    expect(tile.className).toContain('border-2');
    await user.click(why);
    expect(box).not.toBeChecked();
    expect(why.closest('label')).toBeNull();
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

describe('Connect your accounts (screen 4)', () => {
  it('takes the one saved account as the default, and draws no form for it', async () => {
    listMock.mockResolvedValue([
      account({ knownValues: { host: 'imap.example.nl', port: '993', username: 'anna@example.nl' } }),
    ]);
    const user = userEvent.setup();
    renderAt();
    await toWhatMoves(user, ['Another mail provider']);
    await onTo(user, 'Connect your accounts');
    expect(await screen.findByRole('radio', { name: 'Anna mail (anna@example.nl)' })).toBeChecked();
    expect(screen.getByText('Connected as anna@example.nl')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check the sign-in' })).not.toBeInTheDocument();
    expect(next()).toBeEnabled();
  });

  it('asks a new account for what its card asks, names it itself, and keeps it once its check passes', async () => {
    addMock.mockResolvedValue({ ok: true, id: 'c-new' });
    const user = userEvent.setup();
    renderAt();
    await toWhatMoves(user, ['Another mail provider']);
    await onTo(user, 'Connect your accounts');
    await screen.findByRole('button', { name: 'Check the sign-in' });
    // The flow names the account: no box asks for a name.
    expect(screen.queryByLabelText('Name for this account')).not.toBeInTheDocument();
    expect(next()).toHaveAccessibleDescription('Connect each account first.');

    await user.type(screen.getByRole('textbox', { name: /^Host/ }), 'imap.example.nl');
    await user.type(screen.getByRole('spinbutton', { name: /^Port/ }), '993');
    await user.type(screen.getByRole('textbox', { name: /^Username/ }), 'anna@example.nl');
    await user.type(screen.getByLabelText(/^Password/), 'secret');
    listMock.mockResolvedValue([
      account({ id: 'c-new', displayName: 'Anna Jansen · IMAP', knownValues: { username: 'anna@example.nl' } }),
    ]);
    await user.click(screen.getByRole('button', { name: 'Check the sign-in' }));

    expect(addMock).toHaveBeenCalledWith({
      role: 'source',
      type: 'imap',
      displayName: 'Anna Jansen · IMAP',
      values: { host: 'imap.example.nl', port: '993', username: 'anna@example.nl', password: 'secret' },
    });
    expect(await screen.findByText('Connected as anna@example.nl')).toBeInTheDocument();
    expect(next()).toBeEnabled();
  });

  it('offers Try again after a failed check, takes back the account it left, and keeps what was typed', async () => {
    addMock.mockResolvedValue({ ok: false, id: 'c-bad', reason: 'Login failed' });
    removeMock.mockResolvedValue(null);
    const user = userEvent.setup();
    renderAt();
    await toWhatMoves(user, ['Another mail provider']);
    await onTo(user, 'Connect your accounts');
    await user.type(await screen.findByRole('textbox', { name: /^Username/ }), 'anna@example.nl');
    await user.click(screen.getByRole('button', { name: 'Check the sign-in' }));

    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(removeMock).toHaveBeenCalledWith('c-bad');
    expect(screen.getByRole('button', { name: 'Check the sign-in' })).toBeEnabled();
    expect(screen.getByRole('textbox', { name: /^Username/ })).toHaveValue('anna@example.nl');
    expect(next()).toBeDisabled();
  });

  it('says the saved accounts could not be read, and still offers a new one', async () => {
    listMock.mockRejectedValue(new Error('down'));
    const user = userEvent.setup();
    renderAt();
    await toWhatMoves(user, ['Another mail provider']);
    await onTo(user, 'Connect your accounts');
    expect(await screen.findByRole('alert')).toHaveTextContent('Your saved accounts could not be read.');
    expect(screen.getByRole('button', { name: 'Check the sign-in' })).toBeInTheDocument();
  });

  it('asks Google’s account for the ticked faces with no ticks of its own, and Gmail and Drive apart', async () => {
    const user = userEvent.setup();
    renderAt();
    await toWhatMoves(user, ['Google']);
    await onTo(user, 'Connect your accounts');
    expect(await screen.findAllByRole('button', { name: 'Connect with Google' })).toHaveLength(3);
    // The faces were decided on *What moves?*: the consent draws none to tick.
    expect(screen.queryByText('What this account will serve')).not.toBeInTheDocument();
    expect(screen.getByText('One sign-in: calendar, contacts, and tasks')).toBeInTheDocument();
    expect(screen.getByText('One sign-in: email')).toBeInTheDocument();
    expect(screen.getByText('One sign-in: files')).toBeInTheDocument();
  });
});

describe('one way in first, the others folded under it (the owner, 2026-09-29)', () => {
  it('draws the address and Connect with Google, with the app password and one’s own client folded below', async () => {
    const user = userEvent.setup();
    renderAt();
    await toWhatMoves(user, ['Google']);
    const google = screen.getByRole('group', { name: 'From Google' });
    for (const face of ['Calendar', 'Contacts', 'Files', 'Tasks Experimental']) {
      await user.click(within(google).getByRole('checkbox', { name: face }));
    }
    await onTo(user, 'Connect your accounts');
    const connect = await screen.findByRole('button', { name: 'Connect with Google' });
    const address = screen.getByRole('textbox', { name: /^Username/ });
    // The address comes first, then the one button.
    expect(address.compareDocumentPosition(connect) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check the sign-in' })).not.toBeInTheDocument();

    const appPassword = screen.getByText('Use an app password instead').closest('details')!;
    expect(appPassword).not.toHaveAttribute('open');
    expect(connect.compareDocumentPosition(appPassword) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const ownClient = screen.getByText('Use your own Google client').closest('details')!;
    expect(ownClient).not.toHaveAttribute('open');

    // Typing an app password is using that way: its button appears.
    await user.click(screen.getByText('Use an app password instead'));
    await user.type(within(appPassword).getByLabelText(/^App password/), 'abcd efgh ijkl mnop');
    expect(screen.getByRole('button', { name: 'Check the sign-in' })).toBeInTheDocument();
  });
});

describe('Where does it go? (screen 5)', () => {
  /** Mail from another provider and files from Dropbox, both saved, so screen 4 is already done. */
  const SAVED_SOURCES = [
    account({ id: 'c-mail', knownValues: { username: 'anna@example.nl' } }),
    account({ id: 'c-dropbox', kind: 'dropbox', displayName: 'Anna Dropbox', knownValues: { username: 'anna@example.nl' } }),
  ];

  async function toWhereTo(user: ReturnType<typeof userEvent.setup>) {
    await toWhatMoves(user, ['Dropbox', 'Another mail provider']);
    await onTo(user, 'Connect your accounts');
    await screen.findAllByText('Connected as anna@example.nl');
    return onTo(user, 'Where does it go?');
  }

  it('suggests Soverin for mail and Nextcloud for files, and blames each limit on its side (T7 (e))', async () => {
    listMock.mockResolvedValue(SAVED_SOURCES);
    const user = userEvent.setup();
    renderAt();
    await toWhereTo(user);
    expect(screen.getByRole('combobox', { name: 'Where email goes' })).toHaveDisplayValue('Add Soverin');
    expect(screen.getByRole('combobox', { name: 'Where files goes' })).toHaveDisplayValue('Add Nextcloud');
    expect(screen.getByText('Soverin does not take files.')).toBeInTheDocument();
    expect(screen.getByText('Nextcloud does not take email.')).toBeInTheDocument();
    expect(next()).toHaveAccessibleDescription('Add each new account first.');
  });

  it('asks Soverin for two fields, its servers filled in and folded (T7 (b))', async () => {
    listMock.mockResolvedValue(SAVED_SOURCES);
    const user = userEvent.setup();
    renderAt();
    await toWhereTo(user);
    const soverin = screen.getByRole('heading', { level: 3, name: 'Add Soverin' }).closest('section')!;
    const fold = within(soverin).getByText('Server settings (filled in for Soverin)').closest('details')!;
    expect(fold).not.toHaveAttribute('open');
    expect(within(fold).getByRole('textbox', { name: /^Host/ })).toHaveValue('caldav.soverin.net');
    // Outside the fold: the two a person must type.
    const shown = within(soverin)
      .getAllByRole('textbox')
      .filter((box) => !fold.contains(box));
    expect(shown.map((box) => box.getAttribute('autocomplete'))).toEqual(['username']);
    expect(within(soverin).getByLabelText(/^Password/)).toBeInTheDocument();
  });

  it('asks a Nextcloud for its address and derives its DAV root (T7 (c))', async () => {
    listMock.mockResolvedValue(SAVED_SOURCES);
    addMock.mockResolvedValue({ ok: true, id: 'c-cloud' });
    const user = userEvent.setup();
    renderAt();
    await toWhereTo(user);
    const nextcloud = screen.getByRole('heading', { level: 3, name: 'Add Nextcloud' }).closest('section')!;
    await user.type(within(nextcloud).getByLabelText(/Your Nextcloud’s address|Your Nextcloud's address/), 'cloud.example.eu');
    await user.type(within(nextcloud).getByRole('textbox', { name: /^Username/ }), 'anna');
    await user.type(within(nextcloud).getByLabelText(/^Password/), 'secret');
    await user.click(within(nextcloud).getByRole('button', { name: 'Check the sign-in' }));
    expect(addMock).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'target',
        type: 'nextcloud',
        values: expect.objectContaining({ url: 'https://cloud.example.eu/remote.php/dav', username: 'anna' }),
      }),
    );
  });

  it('takes a saved destination that can take the data type, and draws no form for it', async () => {
    listMock.mockResolvedValue([
      ...SAVED_SOURCES,
      account({ id: 'c-soverin', role: 'target', kind: 'soverin', displayName: 'Anna Soverin' }),
      account({ id: 'c-cloud', role: 'target', kind: 'nextcloud', displayName: 'Anna Nextcloud' }),
    ]);
    const user = userEvent.setup();
    renderAt();
    await toWhereTo(user);
    expect(screen.getByRole('combobox', { name: 'Where email goes' })).toHaveDisplayValue('Anna Soverin');
    expect(screen.getByRole('combobox', { name: 'Where files goes' })).toHaveDisplayValue('Anna Nextcloud');
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
    expect(next()).toBeEnabled();
  });
});

describe('Check, then start (screen 6)', () => {
  /** Mail from another provider to Soverin and files from Dropbox to Nextcloud, every account saved. */
  const SAVED = [
    account({ id: 'c-mail', knownValues: { username: 'anna@example.nl' } }),
    account({ id: 'c-dropbox', kind: 'dropbox', displayName: 'Anna Dropbox', knownValues: { username: 'anna@example.nl' } }),
    account({ id: 'c-soverin', role: 'target', kind: 'soverin', displayName: 'Anna Soverin', knownValues: { username: 'anna@soverin.net' } }),
    account({ id: 'c-cloud', role: 'target', kind: 'nextcloud', displayName: 'Anna Nextcloud', knownValues: { username: 'anna' } }),
  ];
  const createMock = vi.mocked(mappingApi.create);
  const startMock = vi.mocked(mappingApi.start);
  const personMock = vi.mocked(createPerson);
  const addToPersonMock = vi.mocked(addMigrationToPerson);

  const detail = (id: string, domains: Mapping['syncConfig']['domains']): Mapping =>
    ({
      id,
      tenantId: 't1',
      name: id,
      sourceType: 'imap',
      targetType: 'soverin',
      status: 'paused',
      mode: 'mirror',
      syncConfig: { domains },
      sourceConfig: {},
      targetConfig: {},
      domainStatus: [],
      createdAt: '2026-09-29T08:00:00Z',
      updatedAt: '2026-09-29T08:00:00Z',
    }) as unknown as Mapping;

  beforeEach(() => {
    listMock.mockResolvedValue(SAVED);
    personMock.mockResolvedValue({ ...ANNA, id: 'p-new' });
    addToPersonMock.mockResolvedValue({ ...ANNA, id: 'p-new' });
    createMock.mockImplementation(async (input) => ({ id: input.targetType === 'soverin' ? 'm-mail' : 'm-files' }) as never);
    vi.mocked(mappingApi.discover).mockResolvedValue({} as never);
    vi.mocked(mappingApi.get).mockImplementation(async (id: string) =>
      detail(id, id === 'm-mail' ? ['email'] : ['file']),
    );
    vi.mocked(mappingApi.getDiscovery).mockImplementation(async (id: string) => ({
      mappingId: id,
      discovered: true,
      domains: [
        {
          domain: id === 'm-mail' ? 'email' : 'file',
          collections: 1,
          items: 10,
          bytes: 1024,
          discoveredAt: '2026-09-29T08:05:00Z',
        },
      ],
    }) as never);
    vi.mocked(scopeManifestApi.get).mockResolvedValue({ version: 'v1', migrates: [], partial: [], doesNotMigrate: [] });
    startMock.mockResolvedValue({ id: 'm', status: 'active' } as never);
  });

  async function toCheck(user: ReturnType<typeof userEvent.setup>) {
    await toWhatMoves(user, ['Dropbox', 'Another mail provider']);
    await onTo(user, 'Connect your accounts');
    await screen.findAllByText('Connected as anna@example.nl');
    await onTo(user, 'Where does it go?');
    await user.click(next());
  }

  it('sets up one paused migration per pair of accounts, for the new person, as it leaves Where does it go?', async () => {
    const user = userEvent.setup();
    renderAt();
    await toCheck(user);
    expect(await screen.findByRole('heading', { level: 2, name: 'Check, then start' })).toHaveFocus();
    expect(personMock).toHaveBeenCalledWith({ displayName: 'Anna Jansen', email: null });
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(createMock).toHaveBeenCalledWith({
      name: 'Anna Jansen — example.nl to Soverin',
      sourceType: 'imap',
      targetType: 'soverin',
      sourceConnectionId: 'c-mail',
      targetConnectionId: 'c-soverin',
      sourceConfig: { username: 'anna@example.nl' },
      targetConfig: { username: 'anna@soverin.net', password: '' },
      syncConfig: { domains: ['email'], schedule: '0 2 * * *' },
    });
    // Dropbox's Paper docs in the format chosen on *What moves?*.
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Anna Jansen — Dropbox to Nextcloud',
        sourceType: 'dropbox',
        sourceConfig: { username: 'anna@example.nl', nativeFilePolicies: { paper: 'markdown' } },
        syncConfig: { domains: ['file'], schedule: '0 2 * * *' },
      }),
    );
    expect(addToPersonMock).toHaveBeenCalledWith('p-new', 'm-mail');
    expect(addToPersonMock).toHaveBeenCalledWith('p-new', 'm-files');
    expect(screen.getByText('Set up and paused: nothing is copied before Start.')).toBeInTheDocument();
    // What is made cannot be unmade by going back.
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
  });

  it('starts every migration with one press once each count is in, and lands on the person’s page', async () => {
    const user = userEvent.setup();
    renderAt();
    await toCheck(user);
    await screen.findByRole('heading', { level: 3, name: 'Email: example.nl → Soverin' });
    expect(screen.getByRole('heading', { level: 3, name: 'Files: Dropbox → Nextcloud' })).toBeInTheDocument();
    const start = screen.getByRole('button', { name: 'Start' });
    await vi.waitFor(() => expect(start).toBeEnabled());
    await user.click(start);
    expect(startMock).toHaveBeenCalledWith('m-mail');
    expect(startMock).toHaveBeenCalledWith('m-files');
    expect(await screen.findByText('The person’s page')).toBeInTheDocument();
  });

  it('says a refused set-up under Next, and asks again only for what was not made', async () => {
    createMock.mockImplementation(async (input) => {
      if (input.targetType === 'nextcloud') throw new Error('The Nextcloud said no');
      return { id: 'm-mail' } as never;
    });
    const user = userEvent.setup();
    renderAt();
    await toCheck(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Not set up: Files: Dropbox → Nextcloud.');
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();

    createMock.mockClear();
    createMock.mockResolvedValue({ id: 'm-files' } as never);
    await user.click(next());
    await screen.findByRole('heading', { level: 2, name: 'Check, then start' });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ targetType: 'nextcloud' }));
    // The person was made once.
    expect(personMock).toHaveBeenCalledTimes(1);
  });
});

describe('someone else connects their own accounts, by a link where one reaches (T4, 0108)', () => {
  const createMock = vi.mocked(mappingApi.create);
  const linksMock = vi.mocked(grantLinkApi.list);
  const SOVERIN = account({ id: 'c-soverin', role: 'target', kind: 'soverin', displayName: 'Anna Soverin', knownValues: { username: 'anna@soverin.net' } });

  beforeEach(() => {
    vi.mocked(createPerson).mockResolvedValue({ ...ANNA, id: 'p-new' });
    vi.mocked(addMigrationToPerson).mockResolvedValue({ ...ANNA, id: 'p-new' });
    createMock.mockResolvedValue({ id: 'm-cal' } as never);
    vi.mocked(mappingApi.discover).mockResolvedValue({} as never);
    vi.mocked(mappingApi.get).mockResolvedValue({
      id: 'm-cal', tenantId: 't1', name: 'm-cal', sourceType: 'google', targetType: 'soverin', status: 'paused',
      mode: 'mirror', syncConfig: { domains: ['calendar', 'contact'] }, sourceConfig: {}, targetConfig: {},
      domainStatus: [], createdAt: '2026-09-29T08:00:00Z', updatedAt: '2026-09-29T08:00:00Z',
    } as never);
    vi.mocked(mappingApi.getDiscovery).mockResolvedValue({
      mappingId: 'm-cal', discovered: true,
      domains: [
        { domain: 'calendar', collections: 2, items: 2000, discoveredAt: '2026-09-29T08:05:00Z' },
        { domain: 'contact', collections: 1, items: 612, discoveredAt: '2026-09-29T08:05:00Z' },
      ],
    } as never);
    vi.mocked(scopeManifestApi.get).mockResolvedValue({ version: 'v1', migrates: [], partial: [], doesNotMigrate: [] });
    linksMock.mockResolvedValue([]);
  });

  /** A new person whose accounts they sign in to themselves, leaving the given tiles. */
  async function someoneElse(user: ReturnType<typeof userEvent.setup>, tiles: string[]) {
    await user.type(await screen.findByLabelText('Name'), 'Anna Jansen');
    await user.click(screen.getByRole('radio', { name: 'They do, with a link' }));
    await user.click(next());
    for (const tile of tiles) await user.click(screen.getByRole('checkbox', { name: new RegExp(`^${tile}`) }));
    await user.click(next());
    await screen.findByRole('heading', { level: 2, name: 'What moves?' });
  }

  it('asks who signs in, and says a link reaches Google alone', async () => {
    renderAt();
    expect(await screen.findByRole('radio', { name: 'I do' })).toBeChecked();
    expect(screen.getByText(/They connect a Google account themselves/)).toBeInTheDocument();
  });

  it('asks for their Google address in place of a sign-in, and signs in together where no link reaches', async () => {
    addMock.mockResolvedValue({ ok: false, id: 'c-google', reason: 'No credential yet' });
    const user = userEvent.setup();
    renderAt();
    await someoneElse(user, ['Google']);
    await onTo(user, 'Connect your accounts');
    // Calendars, contacts and tasks by link; mail and files, whose scopes
    // this deployment has not declared, together (the narrow default).
    expect(await screen.findByText('Anna Jansen connects it themselves, with a link you make on the last screen.')).toBeInTheDocument();
    expect(screen.getByText('No link reaches Gmail: sign in together with Anna Jansen.')).toBeInTheDocument();
    expect(screen.getByText('No link reaches Google Drive: sign in together with Anna Jansen.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Connect with Google' })).toHaveLength(2);

    const save = screen.getByRole('button', { name: 'Save the address' });
    expect(save).toHaveAccessibleDescription('Type their address first.');
    await user.type(screen.getByLabelText('Their address at Google'), 'anna@gmail.com');
    await user.click(save);
    expect(addMock).toHaveBeenCalledWith({
      role: 'source',
      type: 'google',
      displayName: 'Anna Jansen · Google account',
      values: { username: 'anna@gmail.com' },
    });
    expect(await screen.findByText('By link: anna@gmail.com')).toBeInTheDocument();
  });

  it('chooses none of the saved accounts for somebody else, since one may be the starter’s own', async () => {
    listMock.mockResolvedValue([account({ knownValues: { username: 'me@example.nl' } })]);
    const user = userEvent.setup();
    renderAt();
    await someoneElse(user, ['Another mail provider']);
    await onTo(user, 'Connect your accounts');
    expect(await screen.findByRole('radio', { name: 'Anna mail (me@example.nl)' })).not.toBeChecked();
    expect(next()).toBeDisabled();
  });

  async function toCheckByLink(user: ReturnType<typeof userEvent.setup>) {
    listMock.mockResolvedValue([SOVERIN]);
    addMock.mockResolvedValue({ ok: false, id: 'c-google', reason: 'No credential yet' });
    await someoneElse(user, ['Google']);
    const google = screen.getByRole('group', { name: 'From Google' });
    for (const face of ['Email', 'Files', 'Tasks Experimental']) {
      await user.click(within(google).getByRole('checkbox', { name: face }));
    }
    await onTo(user, 'Connect your accounts');
    await user.type(await screen.findByLabelText('Their address at Google'), 'anna@gmail.com');
    await user.click(screen.getByRole('button', { name: 'Save the address' }));
    await screen.findByText('By link: anna@gmail.com');
    await onTo(user, 'Where does it go?');
    await user.click(next());
    await screen.findByRole('heading', { level: 2, name: 'Check, then start' });
  }

  it('offers the link to send in place of the count, and Start waits for their grant', async () => {
    const user = userEvent.setup();
    renderAt();
    await toCheckByLink(user);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: 'google', sourceConnectionId: 'c-google', sourceConfig: { username: 'anna@gmail.com' } }),
    );
    expect(await screen.findByText(/Waiting for Anna Jansen to connect/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create grant link/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    // Nothing starts by itself when the grant lands (grant-ending.ts starts
    // nothing), so the sentence says where to start each one.
    expect(
      screen.getByText(/Anna Jansen's page keeps these migrations: once they have connected, start each one from its Details/),
    ).toBeInTheDocument();
  });

  it('shows the count once their link was used, and Start goes', async () => {
    linksMock.mockResolvedValue([
      { id: 'l1', purpose: 'grant', state: 'used', createdAt: '2026-09-29T08:00:00Z', createdBy: 'owner', expiresAt: '2026-10-06T08:00:00Z', usedAt: '2026-09-29T08:10:00Z', revokedAt: null },
    ]);
    const user = userEvent.setup();
    renderAt();
    await toCheckByLink(user);
    await screen.findByText('2000');
    expect(screen.queryByText(/Waiting for Anna Jansen to connect/)).not.toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled());
  });
});
