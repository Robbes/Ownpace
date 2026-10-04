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
import { DISCOVERY_DOMAINS, lifecycleCounts, sourceFaceIsExperimental, type Person } from '@openmig/shared';
import StartMigration, { CheckStep } from './StartMigration.tsx';
import type { PlannedMigration } from '../services/start-plan.ts';
import { STRINGS } from '../i18n/strings.ts';
import { personLinkApi } from '../services/grant-link-service.ts';
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

  it('has no export line, and its fold names IMAP alone, ticks Another mail provider, and leads to no wizard', async () => {
    // 0153 open question 5: every export has a provider (item 2), and the one
    // source protocol is IMAP, which is a tile. CalDAV, CardDAV, WebDAV and
    // JMAP are destinations, and the fold no longer names them as ways in.
    const user = userEvent.setup();
    peopleMock.mockResolvedValue({ people: [ANNA], unassigned: [] });
    renderAt('/start?person=p-anna');
    await screen.findByRole('radio', { name: 'Anna Jansen' });
    await user.click(next());
    expect(screen.queryByText(/export archive/i)).not.toBeInTheDocument();
    await user.click(screen.getByText('Other ways to connect (IMAP)'));
    expect(screen.getByText(/Any mail server is read over IMAP/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add one migration by hand' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Choose Another mail provider' }));
    expect(screen.getByRole('checkbox', { name: 'Another mail provider' })).toBeChecked();
    expect(screen.queryByRole('button', { name: 'Choose Another mail provider' })).not.toBeInTheDocument();
  });
});

describe('What moves? (screen 3)', () => {
  it('ticks everything a provider can give, and tags the faces that have not met a real account', async () => {
    const user = userEvent.setup();
    renderAt();
    await toWhatMoves(user, ['Google']);
    const google = screen.getByRole('group', { name: 'From Google' });
    const ticks = within(google).getAllByRole('checkbox');
    // The five data types, and its photos from a Takeout export, unticked
    // (0153 open question 5, item 2): that one costs the person a request.
    expect(ticks.map((c) => (c as HTMLInputElement).checked)).toEqual([true, true, true, true, true, false]);
    // Mail goes through the gmail card here, which has run against a real
    // account; Tasks through the account, whose tasks face has not.
    expect(within(google).getByRole('checkbox', { name: 'Email' })).toBeInTheDocument();
    expect(within(google).getByRole('checkbox', { name: 'Tasks Experimental' })).toBeInTheDocument();
  });

  it('tags every face of the Microsoft 365 account that has not met a real account, as the wizard did', async () => {
    // The wizard's data-type step held this until it retired (0153 D5): the
    // tag is part of the box's name, which a screen reader reads (0145 T2).
    const user = userEvent.setup();
    renderAt();
    await toWhatMoves(user, ['Microsoft 365']);
    const microsoft = screen.getByRole('group', { name: /^From Microsoft/ });
    for (const face of ['calendar', 'contact', 'file', 'task'] as const) {
      expect(sourceFaceIsExperimental('microsoft', face), face).toBe(true);
    }
    for (const name of ['Calendar Experimental', 'Contacts Experimental', 'Files Experimental', 'Tasks Experimental']) {
      expect(within(microsoft).getByRole('checkbox', { name })).toBeInTheDocument();
    }
  });

  it('offers Google’s photos from a Takeout export, unticked and tagged, and says to ask now once ticked', async () => {
    // 0153 open question 5, item 2; the tag is the archive card's verdict (0148 D10).
    const user = userEvent.setup();
    renderAt();
    await toWhatMoves(user, ['Google']);
    const google = screen.getByRole('group', { name: 'From Google' });
    const photos = within(google).getByRole('checkbox', { name: 'Photos: from a Takeout export Experimental' });
    expect(photos).not.toBeChecked();
    expect(
      within(google).getByText('You ask Google for the export yourself, and put it in your new files when it arrives.'),
    ).toBeInTheDocument();
    expect(within(google).queryByRole('link', { name: 'Google Takeout' })).not.toBeInTheDocument();
    await user.click(photos);
    expect(within(google).getByText('It can take a few days to prepare, so ask for it now:')).toBeInTheDocument();
    expect(within(google).getByRole('link', { name: 'Google Takeout' })).toHaveAttribute(
      'href',
      'https://takeout.google.com',
    );
  });

  it('says under Apple that its export cannot be read yet, To be tested, with nothing to tick (0148 D7)', async () => {
    const user = userEvent.setup();
    renderAt();
    await toWhatMoves(user, ['Apple iCloud']);
    const apple = screen.getByRole('group', { name: 'From Apple iCloud' });
    expect(within(apple).getByText("iCloud Drive and photos: from Apple's export")).toBeInTheDocument();
    expect(within(apple).getByText('To be tested')).toBeInTheDocument();
    expect(
      within(apple).getByText('We cannot read an Apple export yet. Request one only for your own records.'),
    ).toBeInTheDocument();
    expect(within(apple).queryByRole('checkbox', { name: /iCloud Drive/ })).not.toBeInTheDocument();
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

  /** A saved Soverin whose last test found it takes no mail: the measured no (0106 T3a). */
  const NO_MAIL_SOVERIN = account({
    id: 'c-soverin',
    role: 'target',
    kind: 'soverin',
    displayName: 'Anna Soverin',
    qualification: {
      domains: {
        mail: { answer: 'no', detail: 'No mail server answered at imap.soverin.net.' },
        calendar: { answer: 'yes', detail: '1 calendar' },
      },
    },
  });

  it('marks a saved destination whose last test found it does not take a type, suggests another, and says why (the owner: "4. C, without D")', async () => {
    listMock.mockResolvedValue([...SAVED_SOURCES, NO_MAIL_SOVERIN]);
    const user = userEvent.setup();
    renderAt();
    await toWhereTo(user);
    const mail = screen.getByRole('combobox', { name: 'Where email goes' });
    // Never suggested: a new Soverin is, as with none saved.
    expect(mail).toHaveDisplayValue('Add Soverin');
    const marked = within(mail).getByRole('option', { name: /^Anna Soverin/ }) as HTMLOptionElement;
    expect(marked.disabled).toBe(true);
    expect(marked.textContent).toContain('— does not take email');
    expect(screen.getByText('Its last test found that Anna Soverin does not take email.')).toBeInTheDocument();
    // Its own evidence, in a fold.
    const fold = screen.getByText('What the test found').closest('details')!;
    expect(fold).not.toHaveAttribute('open');
    expect(within(fold).getByText('No mail server answered at imap.soverin.net.')).toBeInTheDocument();
    // Files go elsewhere, so mail can be left out in one press.
    await user.click(screen.getByRole('button', { name: 'Leave email out' }));
    expect(screen.queryByRole('combobox', { name: 'Where email goes' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Where files goes' })).toBeInTheDocument();
  });

  it('says it in Dutch too, with the same names in each sentence', () => {
    const KEYS = [
      'start.to.cannotTake.option',
      'start.to.cannotTake',
      'start.to.cannotTake.why',
      'start.to.cannotTake.retest',
      'start.to.leaveOut',
      'start.to.cannotTakeChosen',
    ] as const;
    const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of KEYS) expect(names(STRINGS.nl[key]), key).toEqual(names(STRINGS.en[key]));
    const said = STRINGS.nl['start.to.cannotTake']
      .replace('{account}', 'Anna Soverin')
      .replace('{type}', 'e-mail');
    expect(said).toBe('Bij de laatste test bleek dat Anna Soverin geen e-mail aanneemt.');
  });

  it('keeps Next from going on while the destination chosen does not take its type', async () => {
    // Files have a saved Nextcloud, so mail is all that waits.
    const cloud = account({ id: 'c-cloud', role: 'target', kind: 'nextcloud', displayName: 'Anna Nextcloud' });
    listMock.mockResolvedValue([...SAVED_SOURCES, cloud]);
    addMock.mockResolvedValue({ ok: true, id: 'c-soverin' });
    const user = userEvent.setup();
    renderAt();
    await toWhereTo(user);
    // A new Soverin, added here, whose first test finds it takes no mail.
    const soverin = screen.getByRole('heading', { level: 3, name: 'Add Soverin' }).closest('section')!;
    await user.type(within(soverin).getByRole('textbox', { name: /^Username/ }), 'anna@example.nl');
    await user.type(within(soverin).getByLabelText(/^Password/), 'secret');
    listMock.mockResolvedValue([...SAVED_SOURCES, cloud, NO_MAIL_SOVERIN]);
    await user.click(within(soverin).getByRole('button', { name: 'Check the sign-in' }));
    await screen.findByText('Its last test found that Anna Soverin does not take email.');
    expect(screen.getByRole('combobox', { name: 'Where email goes' })).toHaveValue('c-soverin');
    expect(next()).toHaveAccessibleDescription('Choose a destination that takes email.');
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
    // No form for a new account: its heading names the one to add.
    expect(screen.queryByRole('heading', { level: 3, name: /^Add / })).not.toBeInTheDocument();
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
  const linksMock = vi.mocked(personLinkApi.list);
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
    // ONE link for the person (ADR-0035, amended 2026-09-29), not one per
    // migration: the migration waits on it by name.
    expect(screen.getAllByRole('button', { name: /Create grant link/ })).toHaveLength(1);
    expect(screen.getByText('Its count appears here once Anna Jansen has connected through the link above.')).toBeInTheDocument();
    expect(linksMock).toHaveBeenCalledWith(expect.any(String));
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    // Nothing of theirs is counted, so nothing could be started yet, and a
    // grant starts nothing of a move that does not run (start when granted,
    // the owner's answer of 2026-10-03): the sentence says where to start.
    expect(screen.getByText('You can start once Anna Jansen has connected and a count is in.')).toBeInTheDocument();
    expect(
      screen.getByText(/Anna Jansen's page keeps these migrations: once they have connected, start each one from its Details/),
    ).toBeInTheDocument();
  });

  const USED = {
    id: 'l1',
    purpose: 'grant' as const,
    state: 'used' as const,
    createdAt: '2026-09-29T08:00:00Z',
    createdBy: 'owner',
    expiresAt: '2026-10-06T08:00:00Z',
    usedAt: '2026-09-29T08:10:00Z',
    revokedAt: null,
  };

  it('shows the count once their link was used, and Start goes', async () => {
    linksMock.mockResolvedValue([]);
    vi.mocked(personLinkApi.issue).mockResolvedValue({
      id: 'l1',
      purpose: 'grant',
      url: 'https://ownpace.test/grant/p.l1.secret',
      expiresAt: USED.expiresAt,
      expiryDays: 7,
      distribution: 'Send this link to the person yourself.',
    });
    const user = userEvent.setup();
    renderAt();
    await toCheckByLink(user);
    // The link is made here, and the next read finds it used.
    linksMock.mockResolvedValue([USED]);
    await user.click(await screen.findByRole('button', { name: /Create grant link/ }));
    await screen.findByText('2000');
    expect(screen.queryByText(/Waiting for Anna Jansen to connect/)).not.toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled());
  });

  it('does not take a link used before this screen for these migrations’ grant', async () => {
    // A person chosen from the list may have used a link before these
    // migrations were theirs; it granted none of them.
    linksMock.mockResolvedValue([USED]);
    const user = userEvent.setup();
    renderAt();
    await toCheckByLink(user);
    expect(await screen.findByText(/Waiting for Anna Jansen to connect/)).toBeInTheDocument();
    expect(screen.getByText('Its count appears here once Anna Jansen has connected through the link above.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });
});

/**
 * START WHEN GRANTED, PER PERSON (ADR-0035's amendment; the owner,
 * 2026-10-03: *"After preflight the start needs to be given at least once, the
 * grant may arrive later"*). With one migration counted and one waiting for
 * the person's link, *Start* goes: it starts the counted one, and the waiting
 * one starts by itself once they connect (`start-when-granted.ts`).
 */
describe('Start once one count is in, and the rest when they connect', () => {
  const plan = (sourceConnectionId: string, provider: PlannedMigration['provider']): PlannedMigration => ({
    provider,
    sourceCard: provider === 'google' ? 'google' : 'imap',
    sourceConnectionId,
    sourceUsername: 'anna@example.org',
    targetCard: 'soverin',
    targetConnectionId: 'c-soverin',
    types: ['calendar'],
  });
  const MAIL = plan('c-imap', 'imap');
  const GOOGLE = plan('c-google', 'google');
  const key = (m: PlannedMigration) => `${m.sourceConnectionId}→${m.targetConnectionId}`;

  beforeEach(() => {
    vi.mocked(mappingApi.start).mockReset().mockResolvedValue({} as never);
    vi.mocked(mappingApi.discover).mockResolvedValue({} as never);
    vi.mocked(mappingApi.get).mockResolvedValue({
      id: 'm-mail', tenantId: 't1', name: 'm-mail', sourceType: 'imap', targetType: 'soverin', status: 'paused',
      mode: 'mirror', syncConfig: { domains: ['calendar'] }, sourceConfig: {}, targetConfig: {},
      domainStatus: [], createdAt: '2026-10-03T08:00:00Z', updatedAt: '2026-10-03T08:00:00Z',
    } as never);
    vi.mocked(mappingApi.getDiscovery).mockResolvedValue({
      mappingId: 'm-mail',
      discovered: true,
      domains: [{ domain: 'calendar', collections: 1, items: 40, discoveredAt: '2026-10-03T08:05:00Z' }],
    } as never);
    vi.mocked(scopeManifestApi.get).mockResolvedValue({ version: 'v1', migrates: [], partial: [], doesNotMigrate: [] });
    vi.mocked(personLinkApi.list).mockResolvedValue([]);
  });

  const renderCheck = (planned: PlannedMigration[], onStarted = vi.fn()) =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <CheckStep
            planned={planned}
            made={{
              personId: 'p-anna',
              migrations: { [key(MAIL)]: { id: 'm-mail' }, [key(GOOGLE)]: { id: 'm-google' } },
            }}
            titles={{ [key(MAIL)]: 'Old mail to Soverin', [key(GOOGLE)]: 'Google to Soverin' }}
            onStarted={onStarted}
            personName="Anna Jansen"
            awaitsGrant={(m) => m.provider === 'google'}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it('starts the counted one, and says the one waiting for the link starts by itself', async () => {
    const onStarted = vi.fn();
    const user = userEvent.setup();
    renderCheck([MAIL, GOOGLE], onStarted);

    expect(await screen.findByText('Once you have started the others, it starts by itself when Anna Jansen connects.')).toBeInTheDocument();
    const start = screen.getByRole('button', { name: 'Start' });
    await vi.waitFor(() => expect(start).toBeEnabled());
    await user.click(start);

    await vi.waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(vi.mocked(mappingApi.start).mock.calls).toEqual([['m-mail']]);
  });

  it('waits for a count when everything waits for the link', async () => {
    renderCheck([GOOGLE]);
    expect(await screen.findByText('You can start once Anna Jansen has connected and a count is in.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    expect(screen.queryByText(/starts by itself/)).not.toBeInTheDocument();
  });
});

/**
 * MAIL THROUGH A COMPANY'S OWN MICROSOFT APP (0153 open question 5; the owner,
 * 2026-10-04: *"go with the recommendations"*). Behind the company question
 * under Microsoft's mail, as Google's domain-wide key is in the account form:
 * an administrator's own Entra app, with application permissions, reads the
 * mail, through Graph or IMAP. The account's sign-in still carries the rest,
 * and a No changes nothing.
 */
describe('mail through a company’s own Microsoft app (0153 open question 5)', () => {
  const createMock = vi.mocked(mappingApi.create);
  const ORG = account({ id: 'c-org', kind: 'o365', displayName: 'Contoso mail app', knownValues: { username: 'info@contoso.example' } });
  const SOVERIN = account({ id: 'c-soverin', role: 'target', kind: 'soverin', displayName: 'Contoso Soverin', knownValues: { username: 'info@contoso.eu' } });

  /** *What moves?*'s Microsoft section, by its legend. */
  const microsoftSection = () => screen.getByRole('group', { name: /^From Microsoft 365/ });

  it('asks the company question under Microsoft’s mail, and a No changes nothing', async () => {
    const user = userEvent.setup();
    renderAt();
    await toWhatMoves(user, ['Microsoft 365']);
    const section = microsoftSection();
    const question = within(section).getByRole('group', { name: 'Is this a company account with an administrator?' });
    expect(within(question).getByRole('radio', { name: 'No' })).toBeChecked();
    expect(within(section).queryByRole('radio', { name: /Through our own app/ })).not.toBeInTheDocument();

    await user.click(within(question).getByRole('radio', { name: 'Yes' }));
    expect(within(section).getByRole('radio', { name: 'With the Microsoft sign-in' })).toBeChecked();
    expect(within(section).getByRole('radio', { name: /^Through our own app, with Microsoft Graph/ })).toBeInTheDocument();
    expect(within(section).getByRole('radio', { name: /^Through our own app, with IMAP/ })).toBeInTheDocument();
    expect(within(section).getByText(/That is also how a shared mailbox is read/)).toBeInTheDocument();

    // Chosen, and taken back with a No: still the one sign-in.
    await user.click(within(section).getByRole('radio', { name: /^Through our own app, with Microsoft Graph/ }));
    await user.click(within(question).getByRole('radio', { name: 'No' }));
    await onTo(user, 'Connect your accounts');
    expect(await screen.findByText('Microsoft 365 account')).toBeInTheDocument();
    expect(screen.queryByText('Microsoft 365 (Graph API)')).not.toBeInTheDocument();
  });

  it('asks the organisation’s app for the mail, with its tenant in view, and the account for the rest', async () => {
    const user = userEvent.setup();
    renderAt();
    await toWhatMoves(user, ['Microsoft 365']);
    const section = microsoftSection();
    await user.click(within(section).getByRole('radio', { name: 'Yes' }));
    await user.click(within(section).getByRole('radio', { name: /^Through our own app, with Microsoft Graph/ }));
    await onTo(user, 'Connect your accounts');

    const rows = screen.getAllByRole('listitem');
    const org = rows.find((r) => within(r).queryByText('Microsoft 365 (Graph API)'))!;
    expect(org).toBeDefined();
    expect(within(org).getByText('One sign-in: email')).toBeInTheDocument();
    // The organisation's app IS the company's answer: its fields are shown, not asked about again.
    expect(within(org).getByRole('textbox', { name: /^Tenant ID/ })).toBeInTheDocument();
    expect(within(org).getByRole('textbox', { name: /^Client ID/ })).toBeInTheDocument();
    expect(within(org).getByLabelText(/^Client secret/)).toBeInTheDocument();
    expect(within(org).queryByRole('group', { name: 'Is this a company account with an administrator?' })).not.toBeInTheDocument();
    const account365 = rows.find((r) => within(r).queryByText('Microsoft 365 account'))!;
    expect(within(account365).getByText('One sign-in: calendar, contacts, files, and tasks')).toBeInTheDocument();
  });

  it('takes the saved organisation app as the mail’s account, and sets the mail up through it', async () => {
    listMock.mockResolvedValue([ORG, SOVERIN]);
    vi.mocked(createPerson).mockResolvedValue({ ...ANNA, id: 'p-new' });
    vi.mocked(addMigrationToPerson).mockResolvedValue({ ...ANNA, id: 'p-new' });
    createMock.mockResolvedValue({ id: 'm-mail' } as never);
    vi.mocked(mappingApi.discover).mockResolvedValue({} as never);
    vi.mocked(scopeManifestApi.get).mockResolvedValue({ version: 'v1', migrates: [], partial: [], doesNotMigrate: [] });
    const user = userEvent.setup();
    renderAt();
    await toWhatMoves(user, ['Microsoft 365']);
    const section = microsoftSection();
    // Mail alone, through the company's own app with IMAP.
    for (const type of ['Calendar', 'Contacts', 'Files', 'Tasks']) {
      await user.click(within(section).getByRole('checkbox', { name: new RegExp(`^${type}`) }));
    }
    await user.click(within(section).getByRole('radio', { name: 'Yes' }));
    await user.click(within(section).getByRole('radio', { name: /^Through our own app, with IMAP/ }));
    await onTo(user, 'Connect your accounts');
    // One kind whichever way its mail is read: the saved app is offered, and the one is the default.
    expect(await screen.findByRole('radio', { name: 'Contoso mail app (info@contoso.example)' })).toBeChecked();
    await onTo(user, 'Where does it go?');
    await user.click(next());
    await screen.findByRole('heading', { level: 2, name: 'Check, then start' });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: 'oauth2',
        sourceConnectionId: 'c-org',
        targetConnectionId: 'c-soverin',
        sourceConfig: { username: 'info@contoso.example' },
        syncConfig: { domains: ['email'], schedule: '0 2 * * *' },
      }),
    );
  });
});

describe('Google’s photos from a Takeout export (0153 open question 5, item 2)', () => {
  /** Files from Dropbox, and two destinations, every account saved. */
  const SAVED = [
    account({ id: 'c-dropbox', kind: 'dropbox', displayName: 'Anna Dropbox', knownValues: { username: 'anna@example.nl' } }),
    account({ id: 'c-soverin', role: 'target', kind: 'soverin', displayName: 'Anna Soverin', knownValues: { username: 'anna@soverin.net' } }),
    account({ id: 'c-cloud', role: 'target', kind: 'nextcloud', displayName: 'Anna Nextcloud', knownValues: { username: 'anna' } }),
  ];
  const createMock = vi.mocked(mappingApi.create);
  const startMock = vi.mocked(mappingApi.start);
  const discoverMock = vi.mocked(mappingApi.discover);

  beforeEach(() => {
    listMock.mockResolvedValue(SAVED);
    vi.mocked(createPerson).mockResolvedValue({ ...ANNA, id: 'p-new' });
    vi.mocked(addMigrationToPerson).mockResolvedValue({ ...ANNA, id: 'p-new' });
    createMock.mockImplementation(async (input) => ({ id: input.sourceType === 'archive' ? 'm-photos' : 'm-files' }) as never);
    discoverMock.mockResolvedValue({} as never);
    vi.mocked(mappingApi.get).mockImplementation(
      async (id: string) =>
        ({
          id,
          tenantId: 't1',
          name: id,
          sourceType: 'dropbox',
          targetType: 'nextcloud',
          status: 'paused',
          mode: 'mirror',
          syncConfig: { domains: ['file'] },
          sourceConfig: {},
          targetConfig: {},
          domainStatus: [],
          createdAt: '2026-09-29T08:00:00Z',
          updatedAt: '2026-09-29T08:00:00Z',
        }) as unknown as Mapping,
    );
    vi.mocked(mappingApi.getDiscovery).mockImplementation(async (id: string) => ({
      mappingId: id,
      discovered: true,
      domains: [{ domain: 'file', collections: 1, items: 10, bytes: 1024, discoveredAt: '2026-09-29T08:05:00Z' }],
    }) as never);
    vi.mocked(scopeManifestApi.get).mockResolvedValue({ version: 'v1', migrates: [], partial: [], doesNotMigrate: [] });
    startMock.mockResolvedValue({ id: 'm', status: 'active' } as never);
  });

  /** Google's photos and nothing else of Google's. */
  async function onlyPhotosFromGoogle(user: ReturnType<typeof userEvent.setup>) {
    const google = screen.getByRole('group', { name: 'From Google' });
    for (const type of ['Email', 'Calendar', 'Contacts', 'Files', 'Tasks Experimental']) {
      await user.click(within(google).getByRole('checkbox', { name: type }));
    }
    await user.click(within(google).getByRole('checkbox', { name: 'Photos: from a Takeout export Experimental' }));
  }

  it('asks no sign-in for them, and reads them from a destination whose files can serve the export', async () => {
    const user = userEvent.setup();
    renderAt();
    await toWhatMoves(user, ['Google', 'Dropbox']);
    await onlyPhotosFromGoogle(user);
    await onTo(user, 'Connect your accounts');
    expect(screen.getByText('Photos need no sign-in: they come from the Takeout export.')).toBeInTheDocument();
    await screen.findAllByText('Connected as anna@example.nl');
    await onTo(user, 'Where does it go?');
    const photos = screen.getByRole('combobox', { name: 'Where photos goes' });
    // The files go to a Nextcloud, which serves an export, so the photos follow them.
    expect(photos).toHaveValue('c-cloud');
    expect(within(photos).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Anna Nextcloud (anna)',
      'Add WebDAV',
      'Add Nextcloud',
    ]);
    expect(
      screen.getByText('Read from the folder Takeout in these files, once the export is put there.'),
    ).toBeInTheDocument();
  });

  it('sets them up as an export in the destination’s files, waiting for it, and Start leaves them', async () => {
    const user = userEvent.setup();
    renderAt();
    await toWhatMoves(user, ['Google', 'Dropbox']);
    await onlyPhotosFromGoogle(user);
    await onTo(user, 'Connect your accounts');
    await screen.findAllByText('Connected as anna@example.nl');
    await onTo(user, 'Where does it go?');
    await user.click(next());
    await screen.findByRole('heading', { level: 2, name: 'Check, then start' });
    expect(createMock).toHaveBeenCalledWith({
      name: 'Anna Jansen — Google Takeout to Nextcloud',
      sourceType: 'archive',
      targetType: 'nextcloud',
      targetConnectionId: 'c-cloud',
      sourceConfig: { username: '', provider: 'google-takeout', path: 'Takeout', where: 'target' },
      targetConfig: { username: 'anna', password: '' },
      syncConfig: { domains: ['file'], schedule: '0 2 * * *' },
      // The Dropbox files go to the same Nextcloud, so each gets a folder of
      // its own (0153 open question 5, item 4).
      targetFolderPrefix: 'Google Takeout',
    });
    expect(vi.mocked(addMigrationToPerson)).toHaveBeenCalledWith('p-new', 'm-photos');
    const waits = screen.getByRole('heading', { level: 3, name: 'Photos: Google Takeout → Nextcloud' }).parentElement!;
    expect(within(waits).getByText('Set up, and waiting for the Takeout export:')).toBeInTheDocument();
    expect(
      within(waits).getByText(
        'When it arrives, put its .zip files, as Google sends them, in the folder Takeout of Nextcloud.',
      ),
    ).toBeInTheDocument();
    expect(within(waits).getByRole('link', { name: 'Google Takeout' })).toHaveAttribute('href', 'https://takeout.google.com');
    const start = screen.getByRole('button', { name: 'Start' });
    await vi.waitFor(() => expect(start).toBeEnabled());
    // There is nothing to count until the export is there, so no count is asked for.
    expect(discoverMock.mock.calls.map(([id]) => id)).not.toContain('m-photos');
    await user.click(start);
    expect(startMock).toHaveBeenCalledWith('m-files');
    expect(startMock).not.toHaveBeenCalledWith('m-photos');
    expect(await screen.findByText('The person’s page')).toBeInTheDocument();
  });

  it('ends with Done where the photos are all that moves, and Next waits for the tick alone', async () => {
    const user = userEvent.setup();
    renderAt();
    await toWhatMoves(user, ['Google']);
    const google = screen.getByRole('group', { name: 'From Google' });
    for (const type of ['Email', 'Calendar', 'Contacts', 'Files', 'Tasks Experimental']) {
      await user.click(within(google).getByRole('checkbox', { name: type }));
    }
    expect(next()).toBeDisabled();
    await user.click(within(google).getByRole('checkbox', { name: 'Photos: from a Takeout export Experimental' }));
    expect(next()).toBeEnabled();
    await onTo(user, 'Connect your accounts');
    expect(next()).toBeEnabled();
    await onTo(user, 'Where does it go?');
    await user.click(next());
    await screen.findByRole('heading', { level: 2, name: 'Check, then start' });
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByText('The person’s page')).toBeInTheDocument();
    expect(startMock).not.toHaveBeenCalled();
  });
});

describe('a saved Google Calendar or Contacts account, on the Google tile (0153 open question 5, item 3)', () => {
  /** Their cards are retired for new migrations; an account saved with one keeps working. */
  const SAVED = [
    account({ id: 'c-gcal', kind: 'google_calendar', displayName: 'Anna Calendar', knownValues: { username: 'anna@gmail.com' } }),
    account({ id: 'c-soverin', role: 'target', kind: 'soverin', displayName: 'Anna Soverin', knownValues: { username: 'anna@soverin.net' } }),
  ];
  const createMock = vi.mocked(mappingApi.create);

  beforeEach(() => {
    listMock.mockResolvedValue(SAVED);
    vi.mocked(createPerson).mockResolvedValue({ ...ANNA, id: 'p-new' });
    vi.mocked(addMigrationToPerson).mockResolvedValue({ ...ANNA, id: 'p-new' });
    createMock.mockResolvedValue({ id: 'm-cal' } as never);
    vi.mocked(mappingApi.discover).mockResolvedValue({} as never);
    vi.mocked(scopeManifestApi.get).mockResolvedValue({ version: 'v1', migrates: [], partial: [], doesNotMigrate: [] });
  });

  /** Google, with only these of its data types left ticked. */
  async function googleWith(user: ReturnType<typeof userEvent.setup>, keep: string[]) {
    await toWhatMoves(user, ['Google']);
    const google = screen.getByRole('group', { name: 'From Google' });
    for (const type of ['Email', 'Calendar', 'Contacts', 'Files', 'Tasks Experimental']) {
      if (!keep.includes(type)) await user.click(within(google).getByRole('checkbox', { name: type }));
    }
  }

  it('is offered where only Calendar is ticked, and the migration is made through it', async () => {
    const user = userEvent.setup();
    renderAt();
    await googleWith(user, ['Calendar']);
    await onTo(user, 'Connect your accounts');
    // The one saved account that carries what was ticked is the default.
    expect(await screen.findByRole('radio', { name: 'Anna Calendar (anna@gmail.com)' })).toBeChecked();
    await onTo(user, 'Where does it go?');
    await user.click(next());
    await screen.findByRole('heading', { level: 2, name: 'Check, then start' });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: 'google-calendar',
        sourceConnectionId: 'c-gcal',
        targetConnectionId: 'c-soverin',
        syncConfig: { domains: ['calendar'], schedule: '0 2 * * *' },
      }),
    );
  });

  it('is not offered where more is ticked than it carries', async () => {
    const user = userEvent.setup();
    renderAt();
    await googleWith(user, ['Calendar', 'Contacts']);
    await onTo(user, 'Connect your accounts');
    await screen.findAllByRole('radio');
    expect(screen.queryByRole('radio', { name: /Anna Calendar/ })).not.toBeInTheDocument();
  });
});

describe('where the copies land (0153 open question 5, item 4)', () => {
  /** Mail from Gmail and from another provider, both into one Soverin: every account saved. */
  const SAVED = [
    account({ id: 'c-gmail', kind: 'gmail', displayName: 'Anna Gmail', knownValues: { username: 'anna@gmail.com' } }),
    account({ id: 'c-mail', knownValues: { username: 'anna@example.nl' } }),
    account({ id: 'c-soverin', role: 'target', kind: 'soverin', displayName: 'Anna Soverin', knownValues: { username: 'anna@soverin.net' } }),
  ];
  const createMock = vi.mocked(mappingApi.create);

  beforeEach(() => {
    listMock.mockResolvedValue(SAVED);
    vi.mocked(createPerson).mockResolvedValue({ ...ANNA, id: 'p-new' });
    vi.mocked(addMigrationToPerson).mockResolvedValue({ ...ANNA, id: 'p-new' });
    createMock.mockImplementation(async (input) => ({ id: `m-${input.sourceConnectionId}` }) as never);
    vi.mocked(mappingApi.discover).mockResolvedValue({} as never);
    vi.mocked(scopeManifestApi.get).mockResolvedValue({ version: 'v1', migrates: [], partial: [], doesNotMigrate: [] });
  });

  /** Gmail's mail alone from Google, and another provider's mail, to *Where does it go?*. */
  async function twoMailboxesIntoOne(user: ReturnType<typeof userEvent.setup>) {
    await toWhatMoves(user, ['Google', 'Another mail provider']);
    const google = screen.getByRole('group', { name: 'From Google' });
    for (const type of ['Calendar', 'Contacts', 'Files', 'Tasks Experimental']) {
      await user.click(within(google).getByRole('checkbox', { name: type }));
    }
    await onTo(user, 'Connect your accounts');
    await screen.findAllByText(/^Connected as/);
    return onTo(user, 'Where does it go?');
  }

  it('gives each a folder of its own where two accounts’ mail goes into one mailbox, and says why', async () => {
    const user = userEvent.setup();
    renderAt();
    await twoMailboxesIntoOne(user);
    const folders = screen.getAllByLabelText('Folder');
    expect(folders.map((f) => (f as HTMLInputElement).value).sort()).toEqual(['anna@example.nl', 'anna@gmail.com']);
    expect(
      screen.getAllByText('Another migration sends the same kind of data here, so each gets a folder of its own.'),
    ).toHaveLength(2);
    // What is typed is what is sent.
    const gmail = folders.find((f) => (f as HTMLInputElement).value === 'anna@gmail.com')!;
    await user.clear(gmail);
    await user.type(gmail, 'Gmail');
    await user.click(next());
    await screen.findByRole('heading', { level: 2, name: 'Check, then start' });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ sourceConnectionId: 'c-gmail', targetFolderPrefix: 'Gmail' }),
    );
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ sourceConnectionId: 'c-mail', targetFolderPrefix: 'anna@example.nl' }),
    );
  });

  it('sends no folder where nothing else goes to the same place, and keeps the fold closed', async () => {
    listMock.mockResolvedValue([SAVED[1]!, SAVED[2]!]);
    const user = userEvent.setup();
    renderAt();
    await toWhatMoves(user, ['Another mail provider']);
    await onTo(user, 'Connect your accounts');
    await screen.findAllByText(/^Connected as/);
    await onTo(user, 'Where does it go?');
    expect(screen.getByText('Put it in a folder of its own').closest('details')).not.toHaveAttribute('open');
    await user.click(next());
    await screen.findByRole('heading', { level: 2, name: 'Check, then start' });
    expect(createMock.mock.calls[0]![0]).not.toHaveProperty('targetFolderPrefix');
  });
});

describe('Only one folder (0153 open question 5, item 4)', () => {
  const foldersMock = vi.mocked(connectionsApi.folders);
  const createMock = vi.mocked(mappingApi.create);

  beforeEach(() => {
    listMock.mockResolvedValue([
      account({ id: 'c-drive', kind: 'google_drive', displayName: 'Anna Drive', knownValues: { username: 'anna@gmail.com' } }),
      account({ id: 'c-dropbox', kind: 'dropbox', displayName: 'Anna Dropbox', knownValues: { username: 'anna@example.nl' } }),
      account({ id: 'c-cloud', role: 'target', kind: 'nextcloud', displayName: 'Anna Nextcloud', knownValues: { username: 'anna' } }),
    ]);
    vi.mocked(createPerson).mockResolvedValue({ ...ANNA, id: 'p-new' });
    // These cases read the create's body; they stop at it.
    createMock.mockRejectedValue(new Error('not made here'));
  });

  /** Google's files, and nothing else of Google's. */
  async function onlyFilesFromGoogle(user: ReturnType<typeof userEvent.setup>) {
    const google = screen.getByRole('group', { name: 'From Google' });
    for (const type of ['Email', 'Calendar', 'Contacts', 'Tasks Experimental']) {
      await user.click(within(google).getByRole('checkbox', { name: type }));
    }
    return google;
  }

  it('offers all of the account or one folder under Files, and not where the files have no folder to start from', async () => {
    const user = userEvent.setup();
    renderAt();
    await toWhatMoves(user, ['Google', 'Microsoft 365']);
    const google = screen.getByRole('group', { name: 'From Google' });
    expect(within(google).getByRole('radio', { name: 'All of My Drive' })).toBeChecked();
    await user.click(within(google).getByRole('radio', { name: 'Only one folder' }));
    expect(within(google).getByRole('radio', { name: 'Only one folder' })).toHaveAccessibleDescription(
      'You choose it once the account is connected.',
    );
    // Microsoft's files have no folder to start from yet.
    const microsoft = screen.getByRole('group', { name: /^From Microsoft/ });
    expect(within(microsoft).queryByRole('radio', { name: 'Only one folder' })).toBeNull();
  });

  it('asks for the folder once the account is chosen, lists what is shared with it, and sends the one picked', async () => {
    foldersMock.mockResolvedValue({
      ok: true,
      key: 'rootFolderId',
      folders: [
        { value: 'd-1', name: 'Family', kind: 'shared-drive' },
        { value: 'f-1', name: 'Holiday photos', kind: 'shared-folder', owner: 'sam@example.test' },
      ],
    });
    const user = userEvent.setup();
    renderAt();
    await toWhatMoves(user, ['Google']);
    const google = await onlyFilesFromGoogle(user);
    await user.click(within(google).getByRole('radio', { name: 'Only one folder' }));
    await onTo(user, 'Connect your accounts');
    await screen.findByText('Connected as anna@gmail.com');
    const box = screen.getByLabelText('Which folder: its link or ID');
    expect(box).toHaveAccessibleDescription('Open the folder in Google Drive and copy its address.');
    expect(next()).toBeDisabled();
    expect(next()).toHaveAccessibleDescription('Say which folder, where only one folder moves.');

    await user.click(screen.getByRole('button', { name: 'Show shared drives and shared folders' }));
    expect(foldersMock).toHaveBeenCalledWith('c-drive');
    expect(await screen.findByRole('radio', { name: 'Family shared drive' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Holiday photos from sam@example.test' }));
    expect(box).toHaveValue('f-1');
    expect(next()).toBeEnabled();

    await onTo(user, 'Where does it go?');
    await user.click(next());
    await vi.waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: 'google-drive',
        sourceConnectionId: 'c-drive',
        sourceConfig: expect.objectContaining({ username: 'anna@gmail.com', rootFolderId: 'f-1' }),
      }),
    );
  });

  it('takes a Dropbox path as typed, from the top, and says when the list cannot be read', async () => {
    foldersMock.mockResolvedValue({ ok: false, reason: 'Token has been revoked.' });
    const user = userEvent.setup();
    renderAt();
    await toWhatMoves(user, ['Dropbox']);
    const dropbox = screen.getByRole('group', { name: 'From Dropbox' });
    expect(within(dropbox).getByRole('radio', { name: 'All of Dropbox' })).toBeChecked();
    await user.click(within(dropbox).getByRole('radio', { name: 'Only one folder' }));
    await onTo(user, 'Connect your accounts');
    await screen.findByText('Connected as anna@example.nl');
    await user.click(screen.getByRole('button', { name: 'Show shared folders' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The list could not be read: Token has been revoked.');
    await user.type(screen.getByLabelText('Which folder: its path'), 'Holiday/2019/');

    await onTo(user, 'Where does it go?');
    await user.click(next());
    await vi.waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: 'dropbox',
        sourceConfig: { username: 'anna@example.nl', rootPath: '/Holiday/2019', nativeFilePolicies: { paper: 'markdown' } },
      }),
    );
  });

  it('draws no folder on a new account’s form, since the folder is the migration’s and asked after', async () => {
    listMock.mockResolvedValue([]);
    const user = userEvent.setup();
    renderAt();
    await toWhatMoves(user, ['Dropbox']);
    await onTo(user, 'Connect your accounts');
    expect(screen.queryByText('More options')).toBeNull();
    expect(screen.queryByLabelText('Root folder path')).toBeNull();
  });
});
