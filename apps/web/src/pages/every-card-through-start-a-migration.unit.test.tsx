// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * EVERY CARD THROUGH *START A MIGRATION* (workplan 0153 D5 and open question
 * 5; the owner, 2026-10-04: *"go with the recommendations"*).
 *
 * The wizard retires once the flow reaches every card a migration can be made
 * from. `CreateMapping.reachability.unit.test.tsx` walked each of them through
 * the wizard; this walks each through `/start` instead, as far as the screen
 * that asks for its account. There its row is, named for the card, with the
 * form a person fills, and *Next* waits for it in words that name no field. An
 * export needs no sign-in, and that screen says so; it is reached through its
 * provider's tick box, and set up with the archive card.
 *
 * Every destination card is offered on *Where does it go?*, as *Add …* under a
 * data type it takes.
 *
 * A source card added without a row in `WALKS`, or a destination the flow
 * cannot offer, fails here by name. That omission is what the table exists to
 * make loud, as the wizard's did.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DISCOVERY_DOMAINS, providerDisplayName } from '@openmig/shared';
import StartMigration from './StartMigration.tsx';
import { fetchPeople } from '../services/operating-service.ts';
import { migratableSourceCards, TARGET_CARDS, type MigratableSourceCard } from '../components/front-door-cards.ts';
import {
  connectionsApi,
  providerAccountsApi,
  providerClientsApi,
  type ConnectionSummary,
} from '../services/mapping-service.ts';

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

/** Where Google's restricted scopes are not declared, the default: mail and files through cards of their own. */
const NARROW = {
  google: { domains: ['calendar', 'contact', 'task'] as const, client: 'deployment' as const },
  microsoft: { domains: [...DISCOVERY_DOMAINS] as const },
};
/** Where they are: the Google account carries all five. */
const WIDE = {
  google: { domains: [...DISCOVERY_DOMAINS] as const, client: 'deployment' as const },
  microsoft: { domains: [...DISCOVERY_DOMAINS] as const },
};

type User = ReturnType<typeof userEvent.setup>;

/** How a card is reached: the tiles ticked on screen 2, the deployment, and what is chosen on *What moves?*. */
interface Walk {
  readonly tiles: ReadonlyArray<string>;
  readonly served?: typeof NARROW | typeof WIDE;
  readonly onWhat?: (user: User) => Promise<void>;
}

const group = (name: RegExp) => screen.getByRole('group', { name });

/** Under a provider's tile on *What moves?*, untick these data types. */
const untick = async (user: User, provider: RegExp, types: ReadonlyArray<string>) => {
  for (const type of types) {
    await user.click(within(group(provider)).getByRole('checkbox', { name: new RegExp(`^${type}`) }));
  }
};

/** Microsoft's mail through the company's own app, behind the company question (0153 open question 5). */
const companyApp = (through: RegExp) => async (user: User) => {
  await untick(user, /^From Microsoft/, ['Calendar', 'Contacts', 'Files', 'Tasks']);
  await user.click(within(group(/^From Microsoft/)).getByRole('radio', { name: 'Yes' }));
  await user.click(within(group(/^From Microsoft/)).getByRole('radio', { name: through }));
};

/** Every card a migration can be made from, and the way to it through `/start`. */
const WALKS: Readonly<Record<MigratableSourceCard['id'], Walk>> = {
  imap: { tiles: ['Another mail provider'] },
  microsoft: { tiles: ['Microsoft 365'] },
  oauth2: { tiles: ['Microsoft 365'], onWhat: companyApp(/^Through our own app, with IMAP/) },
  graph: { tiles: ['Microsoft 365'], onWhat: companyApp(/^Through our own app, with Microsoft Graph/) },
  google: { tiles: ['Google'], served: WIDE },
  'google-drive': {
    tiles: ['Google'],
    onWhat: (user) => untick(user, /^From Google/, ['Email', 'Calendar', 'Contacts', 'Tasks']),
  },
  gmail: {
    tiles: ['Google'],
    onWhat: (user) => untick(user, /^From Google/, ['Calendar', 'Contacts', 'Files', 'Tasks']),
  },
  dropbox: { tiles: ['Dropbox'] },
  box: { tiles: ['Box'] },
  apple: { tiles: ['Apple iCloud'] },
  // Google's photos, from a Takeout export (0153 open question 5, item 2).
  archive: {
    tiles: ['Google'],
    onWhat: async (user) => {
      await untick(user, /^From Google/, ['Email', 'Calendar', 'Contacts', 'Files', 'Tasks']);
      await user.click(within(group(/^From Google/)).getByRole('checkbox', { name: /^Photos: from a Takeout export/ }));
    },
  },
};

const renderStart = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/start']}>
        <Routes>
          <Route path="/start" element={<StartMigration />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const next = () => screen.getByRole('button', { name: 'Next' });

/** Who, then the tiles, then *What moves?* as the walk says, then on to *Connect your accounts*. */
async function walkTo(user: User, walk: Walk) {
  await user.type(await screen.findByLabelText('Name'), 'Anna Jansen');
  await user.click(next());
  for (const tile of walk.tiles) await user.click(screen.getByRole('checkbox', { name: new RegExp(`^${tile}`) }));
  await user.click(next());
  await screen.findByRole('heading', { level: 2, name: 'What moves?' });
  await walk.onWhat?.(user);
  await user.click(next());
  await screen.findByRole('heading', { level: 2, name: 'Connect your accounts' });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchPeople).mockResolvedValue({ people: [], unassigned: [] });
  vi.mocked(providerClientsApi.get).mockResolvedValue({
    google: 'deployment',
    dropbox: 'deployment',
    microsoft: 'deployment',
  });
  vi.mocked(connectionsApi.list).mockResolvedValue([]);
});

describe('every card a migration is made from is reached through Start a migration', () => {
  it('has a walk for every one of them, and none for a card that is not', () => {
    expect(Object.keys(WALKS).sort()).toEqual(migratableSourceCards().map((c) => c.id).sort());
  });

  it.each(Object.entries(WALKS).filter(([card]) => card !== 'archive'))(
    '%s: its row asks for its account, and Next waits for it in words that name no field',
    async (card, walk) => {
      vi.mocked(providerAccountsApi.get).mockResolvedValue((walk.served ?? NARROW) as never);
      const user = userEvent.setup();
      renderStart();
      await walkTo(user, walk);
      // Another mail provider is the IMAP card, named for what a person has.
      const name = card === 'imap' ? 'Another mail provider' : providerDisplayName(card);
      const row = (await screen.findAllByRole('listitem')).find((r) => within(r).queryByText(name) !== null);
      expect(row, `no row for ${card} (${name})`).toBeDefined();
      // The form a person fills: its address at the least.
      expect(within(row!).getAllByRole('textbox').length).toBeGreaterThan(0);
      expect(next()).toBeDisabled();
      expect(next()).toHaveAccessibleDescription('Connect each account first.');
    },
  );

  it('archive: Google’s photos from a Takeout export need no sign-in, and say so', async () => {
    vi.mocked(providerAccountsApi.get).mockResolvedValue(NARROW as never);
    const user = userEvent.setup();
    renderStart();
    await walkTo(user, WALKS.archive);
    expect(screen.getByText('Photos need no sign-in: they come from the Takeout export.')).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});

describe('every destination card is offered on Where does it go?', () => {
  it('as Add …, under a data type it takes', async () => {
    vi.mocked(providerAccountsApi.get).mockResolvedValue(WIDE as never);
    // A saved Google account, so the walk reaches the destinations with all five data types.
    vi.mocked(connectionsApi.list).mockResolvedValue([
      {
        id: 'c-google',
        role: 'source',
        kind: 'google',
        displayName: 'Anna Google',
        status: 'connected',
        createdAt: '2026-10-04T08:00:00.000Z',
        usedByMigrations: 0,
        knownValues: { username: 'anna@gmail.com' },
      } satisfies ConnectionSummary,
    ]);
    const user = userEvent.setup();
    renderStart();
    await walkTo(user, { tiles: ['Google'] });
    await screen.findByText('Connected as anna@gmail.com');
    await user.click(next());
    await screen.findByRole('heading', { level: 2, name: 'Where does it go?' });
    const offered = new Set(
      screen.getAllByRole('combobox').flatMap((select) => within(select).getAllByRole('option').map((o) => o.textContent)),
    );
    const missing = TARGET_CARDS.filter((card) => !offered.has(`Add ${providerDisplayName(card.id)}`)).map((c) => c.id);
    expect(missing, `offered: ${[...offered].join(', ')}`).toEqual([]);
  });
});
