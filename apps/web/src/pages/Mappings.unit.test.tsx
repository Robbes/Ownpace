// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * MIGRATIONS, ONE CARD PER PERSON (workplan 0153 T3; ADR-0050, amended by the
 * owner on 2026-09-28), and what the list has always held:
 *
 *  - a failed read is never an empty list (hard rule 9, 0033 T2), of the
 *    migrations or of the people;
 *  - a person's card: their name, one stage (the least advanced, the owner's
 *    *"One stage per person"*), where from and where to, what needs them, and
 *    a line per data type with its stage in words (0154 T1);
 *  - a migration with nobody can be added to a person in one press, and a
 *    person can be added;
 *  - every migration keeps its controls: a refused sync says so at the
 *    migration (0033 T3), a draft leads to its green light (0037 T2), Delete
 *    takes two presses (0037 T5), a pause tells the migration's own page
 *    (2026-09-17);
 *  - `?status=` filters, and says so (0074).
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import { lifecycleCounts, type MappingAttention, type Person, type PersonMigration } from '@openmig/shared';
import Mappings from './Mappings.tsx';
import { mappingApi, type MappingListItem } from '../services/mapping-service.ts';
import {
  addMigrationToPerson,
  createPerson,
  fetchAttention,
  fetchPeople,
} from '../services/operating-service.ts';

vi.mock('../services/mapping-service', () => ({
  mappingApi: { list: vi.fn(), triggerSync: vi.fn(), delete: vi.fn(), pause: vi.fn() },
}));
vi.mock('../services/operating-service', () => ({
  fetchPeople: vi.fn(),
  fetchAttention: vi.fn(),
  createPerson: vi.fn(),
  addMigrationToPerson: vi.fn(),
}));

const listMock = vi.mocked(mappingApi.list);
const syncMock = vi.mocked(mappingApi.triggerSync);
const deleteMock = vi.mocked(mappingApi.delete);
const pauseMock = vi.mocked(mappingApi.pause);
const peopleMock = vi.mocked(fetchPeople);
const attentionMock = vi.mocked(fetchAttention);
const createPersonMock = vi.mocked(createPerson);
const addMock = vi.mocked(addMigrationToPerson);

const renderMappings = (path = '/mappings', queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})) => ({
  queryClient,
  ...render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Mappings />
      </MemoryRouter>
    </QueryClientProvider>
  ),
});

const sampleMapping = (over: Partial<MappingListItem> = {}): MappingListItem => ({
  id: 'm1',
  tenantId: 't1',
  name: 'Inbox',
  sourceType: 'o365',
  targetType: 'jmap',
  status: 'active',
  mode: 'mirror',
  domains: ['email'],
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
  ...over,
});

const person = (id: string, displayName: string | null, migrations: PersonMigration[], implicit = false): Person => ({
  id,
  implicit,
  displayName,
  email: null,
  createdAt: implicit ? null : '2026-09-28T10:00:00.000Z',
  migrations,
  counts: lifecycleCounts(migrations),
});

const quiet = (mappingId: string, over: Partial<MappingAttention> = {}): MappingAttention => ({
  mappingId,
  pendingDecisions: 0,
  deletionsWaiting: 0,
  movesWaiting: 0,
  failuresWaiting: 0,
  readyForCutover: false,
  autoApplied: 0,
  sharingOpen: 0,
  ...over,
});

/** An axios-shaped rejection carrying the JSON body `serverFault` sends (0081). */
const axiosError = (status: number, data: Record<string, string>): AxiosError => {
  const err = new AxiosError(`Request failed with status code ${status}`);
  err.response = {
    status,
    statusText: 'Error',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data,
  };
  return err;
};
const axios500 = (reason: string) => axiosError(500, { error: 'list_failed', reason });

beforeEach(() => {
  vi.resetAllMocks();
  peopleMock.mockResolvedValue({ people: [], unassigned: [] });
  attentionMock.mockResolvedValue({ mappings: [] });
});

describe('Migrations — a failed read is never an empty list (hard rule 9)', () => {
  it('renders the SERVER message when the migrations cannot be read, and no card or empty state', async () => {
    listMock.mockRejectedValue(
      axios500(
        'Something went wrong listing your migrations — this is a fault on our side, not ' +
          'something your input caused. Reference 1a2b3c4d; quoting it finds the detail in the server log.',
      ),
    );

    renderMappings();

    expect(await screen.findByText(/Something went wrong listing your migrations/)).toBeInTheDocument();
    expect(screen.getByText(/Reference 1a2b3c4d/)).toBeInTheDocument();
    expect(screen.getByText('Could not load the migrations list.')).toBeInTheDocument();
    expect(screen.queryByText('No migrations yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Not with a person yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Name')).not.toBeInTheDocument();
    expect(screen.queryByText('Request failed with status code 500')).not.toBeInTheDocument();
  });

  it('says so when the people cannot be read, rather than showing everybody as nobody', async () => {
    listMock.mockResolvedValue([sampleMapping({ id: 'm1', name: 'Inbox' })]);
    peopleMock.mockRejectedValue(axios500('Something went wrong listing the people you are moving. Reference 9f8e7d6c.'));

    renderMappings();

    expect(await screen.findByText('Could not load who each migration is for.')).toBeInTheDocument();
    expect(screen.getByText(/Reference 9f8e7d6c/)).toBeInTheDocument();
    expect(screen.queryByText('Not with a person yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Inbox')).not.toBeInTheDocument();
  });

  it('still shows the true empty state when there is nobody and nothing, with Start a migration', async () => {
    listMock.mockResolvedValue([]);

    renderMappings();

    expect(await screen.findByText('No migrations yet')).toBeInTheDocument();
    expect(screen.getByText('Start one: who it is for, where from, what, and where to.')).toBeInTheDocument();
    for (const link of screen.getAllByRole('link', { name: 'Start a migration' })) {
      expect(link).toHaveAttribute('href', '/mappings/new');
    }
    expect(screen.queryByText('Could not load the migrations list.')).not.toBeInTheDocument();
  });
});

describe('Migrations — one card per person (0153 T3)', () => {
  const MAIL = sampleMapping({
    id: 'm-mail',
    name: 'Anna — Gmail to Soverin',
    sourceType: 'gmail',
    targetType: 'soverin',
    domains: ['email'],
    lastSyncAt: new Date(Date.now() - 120_000).toISOString(),
  });
  const FILES = sampleMapping({
    id: 'm-files',
    name: 'Anna — Dropbox to Nextcloud',
    sourceType: 'dropbox',
    targetType: 'nextcloud',
    domains: ['file'],
  });
  const ANNA = person('p-anna', 'Anna', [
    { id: 'm-mail', status: 'active' },
    { id: 'm-files', status: 'active' },
  ]);

  it("shows the person's name, one stage (the least advanced), and where from and where to", async () => {
    listMock.mockResolvedValue([MAIL, FILES]);
    peopleMock.mockResolvedValue({ people: [ANNA], unassigned: [] });

    renderMappings();

    const card = await screen.findByRole('region', { name: 'Anna' });
    expect(within(card).getByText('From Google and Dropbox to Soverin and Nextcloud')).toBeInTheDocument();
    // Mail is kept in step, Files is copying: the card says what holds them back.
    const heading = within(card).getByRole('heading', { name: 'Anna' }).parentElement!;
    expect(within(heading).getByText('Copying')).toBeInTheDocument();
    // A line per data type, each with its own stage.
    expect(within(card).getByText('Email')).toBeInTheDocument();
    expect(within(card).getByText('Files')).toBeInTheDocument();
    expect(within(card).getByText('Kept in step')).toBeInTheDocument();
    expect(within(card).getAllByText('Copying')).toHaveLength(2);
  });

  it('counts what needs the person and leads to it, and the top line counts people', async () => {
    listMock.mockResolvedValue([MAIL, FILES]);
    peopleMock.mockResolvedValue({ people: [ANNA], unassigned: [] });
    attentionMock.mockResolvedValue({
      mappings: [quiet('m-mail', { failuresWaiting: 2 }), quiet('m-files', { deletionsWaiting: 1 })],
    });

    renderMappings();

    const count = await screen.findByRole('link', { name: 'Needs you: 3 →' });
    expect(count).toHaveAttribute('href', '/decisions');
    expect(screen.getByText(/1 person/)).toBeInTheDocument();
    expect(screen.getByText(/1 needs you/)).toBeInTheDocument();
  });

  it('says it could not count, never zero, when what needs the person cannot be read', async () => {
    listMock.mockResolvedValue([MAIL, FILES]);
    peopleMock.mockResolvedValue({ people: [ANNA], unassigned: [] });
    attentionMock.mockRejectedValue(axios500('Something went wrong. Reference 11112222.'));

    renderMappings();

    expect(await screen.findByText('Could not count what needs you.')).toBeInTheDocument();
    expect(screen.queryByText(/Needs you:/)).not.toBeInTheDocument();
  });

  it("offers Add a migration for the person, which the wizard adds to them", async () => {
    listMock.mockResolvedValue([MAIL]);
    peopleMock.mockResolvedValue({ people: [person('p-anna', 'Anna', [{ id: 'm-mail', status: 'active' }])], unassigned: [] });

    renderMappings();

    const add = await screen.findByRole('link', { name: 'Add a migration' });
    expect(add).toHaveAttribute('href', '/mappings/new?person=p-anna');
  });

  it('says what a person with no migrations has: nothing yet', async () => {
    listMock.mockResolvedValue([]);
    peopleMock.mockResolvedValue({ people: [person('p-bram', 'Bram', [])], unassigned: [] });

    renderMappings();

    const card = await screen.findByRole('region', { name: 'Bram' });
    expect(within(card).getByText('Nothing for this person yet.')).toBeInTheDocument();
    expect(screen.queryByText('No migrations yet')).not.toBeInTheDocument();
  });

  it("names the appliance's one person, and offers no person to add or create", async () => {
    listMock.mockResolvedValue([MAIL]);
    peopleMock.mockResolvedValue({
      people: [person('implicit', null, [{ id: 'm-mail', status: 'active' }], true)],
      unassigned: [],
    });

    renderMappings();

    expect(await screen.findByRole('region', { name: 'Your migrations' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add a migration' })).not.toBeInTheDocument();
    expect(screen.queryByText('Add a person')).not.toBeInTheDocument();
  });

  it('shows stages in words, never the raw lifecycle', async () => {
    listMock.mockResolvedValue([
      sampleMapping({ id: 'a', status: 'active', name: 'A' }),
      sampleMapping({ id: 'b', status: 'paused', name: 'B' }),
      sampleMapping({ id: 'c', status: 'cutover', name: 'C' }),
      sampleMapping({ id: 'd', status: 'done', name: 'D' }),
    ]);

    renderMappings();

    expect(await screen.findByText('Copying')).toBeInTheDocument();
    expect(screen.getByText('Not started')).toBeInTheDocument();
    expect(screen.getByText('Switching')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.queryByText('active')).not.toBeInTheDocument();
  });
});

describe('Migrations — a migration with nobody, and a new person (ADR-0050 rule 2)', () => {
  it('lists it under Not with a person yet, and adds it to a person in one press', async () => {
    listMock.mockResolvedValue([sampleMapping({ id: 'm2', name: 'Old one' })]);
    peopleMock.mockResolvedValue({
      people: [person('p-anna', 'Anna', [])],
      unassigned: [{ id: 'm2', status: 'active' }],
    });
    addMock.mockResolvedValue(person('p-anna', 'Anna', [{ id: 'm2', status: 'active' }]));

    renderMappings();

    const section = await screen.findByRole('region', { name: 'Not with a person yet' });
    expect(within(section).getByText('Old one')).toBeInTheDocument();
    expect(within(section).getByLabelText('Add to')).toHaveValue('p-anna');
    fireEvent.click(within(section).getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(addMock).toHaveBeenCalledWith('p-anna', 'm2'));
  });

  it("renders the server's refusal when adding fails, and keeps the migration where it was", async () => {
    listMock.mockResolvedValue([sampleMapping({ id: 'm2', name: 'Old one' })]);
    peopleMock.mockResolvedValue({ people: [person('p-anna', 'Anna', [])], unassigned: [{ id: 'm2', status: 'active' }] });
    addMock.mockRejectedValue(
      axiosError(409, {
        error: 'with_another_person',
        message: 'This migration is already somebody else’s. A migration belongs to one person at most.',
      }),
    );

    renderMappings();

    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));

    expect(await screen.findByText('The migration was not added.')).toBeInTheDocument();
    expect(screen.getByText(/belongs to one person at most/)).toBeInTheDocument();
    expect(screen.getByText('Old one')).toBeInTheDocument();
  });

  it('adds a person with a name, and no address when none is typed', async () => {
    listMock.mockResolvedValue([sampleMapping({ id: 'm2', name: 'Old one' })]);
    createPersonMock.mockResolvedValue(person('p-bram', 'Bram', []));

    renderMappings();

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Bram' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }));

    await waitFor(() => expect(createPersonMock).toHaveBeenCalledWith({ displayName: 'Bram', email: null }));
  });

  it("renders the server's refusal when a person cannot be added", async () => {
    listMock.mockResolvedValue([]);
    peopleMock.mockResolvedValue({ people: [person('p-anna', 'Anna', [])], unassigned: [] });
    createPersonMock.mockRejectedValue(
      axiosError(400, { error: 'Validation error', message: 'That is not an email address.' }),
    );

    renderMappings();

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Bram' } });
    fireEvent.change(screen.getByLabelText('Email address, for a grant link (optional)'), {
      target: { value: 'bram@example.org' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }));

    expect(await screen.findByText('The person was not added.')).toBeInTheDocument();
    expect(screen.getByText('That is not an email address.')).toBeInTheDocument();
  });
});

describe('Migrations — every migration keeps its controls', () => {
  it("renders the server's refusal of a sync under the migration (0033 T3)", async () => {
    listMock.mockResolvedValue([sampleMapping({ id: 'c1', status: 'cutover', name: 'Cutting over' })]);
    syncMock.mockRejectedValue(
      axiosError(409, {
        error: 'Conflict',
        message: 'Mapping is in cutover — the final sync is managed by the cutover task.',
      }),
    );

    renderMappings();

    fireEvent.click(await screen.findByTitle('Start sync'));

    expect(await screen.findByText(/Mapping is in cutover — the final sync/)).toBeInTheDocument();
    expect(screen.getByText('The sync request did not complete.')).toBeInTheDocument();
    expect(screen.queryByText('Request failed with status code 409')).not.toBeInTheDocument();
  });

  it('leads a draft to Review and start, and offers no sync that would be refused (0037 T2)', async () => {
    listMock.mockResolvedValue([sampleMapping({ id: 'p1', status: 'paused', name: 'Paused one' })]);

    renderMappings();

    const link = await screen.findByRole('link', { name: 'Review and start' });
    expect(link).toHaveAttribute('href', '/mappings/p1/confirm');
    expect(screen.queryByTitle('Start sync')).not.toBeInTheDocument();
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('opens the migration from anywhere on it, and a control never doubles as the way in (2026-08-11)', async () => {
    listMock.mockResolvedValue([sampleMapping({ id: 'm1', status: 'active', name: 'Inbox' })]);
    pauseMock.mockResolvedValue(undefined as never);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/mappings']}>
          <Routes>
            <Route path="/mappings" element={<Mappings />} />
            <Route path="/mappings/:id" element={<p>the migration page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByTitle('Pause'));
    await waitFor(() => expect(pauseMock).toHaveBeenCalledWith('m1'));
    expect(screen.queryByText('the migration page')).not.toBeInTheDocument();

    // Its stage: inside the migration, outside every button and link, where
    // the owner clicked a row and nothing happened.
    fireEvent.click(screen.getByText('Copying'));
    expect(await screen.findByText('the migration page')).toBeInTheDocument();
  });

  it('names the pencil that opens a migration, which a screen reader otherwise calls "link"', async () => {
    listMock.mockResolvedValue([sampleMapping({ id: 'm1', name: 'Inbox' })]);
    renderMappings();

    const open = await screen.findByRole('link', { name: 'Open' });
    expect(open).toHaveAttribute('href', '/mappings/m1');
  });

  it('keeps the actions reachable on a phone: they wrap, and nothing clips them (0073)', async () => {
    listMock.mockResolvedValue([sampleMapping({ id: 'm1', name: 'Inbox' })]);
    renderMappings();

    let el: HTMLElement | null = (await screen.findByTitle('Delete')).parentElement;
    expect(el!.className, 'the actions do not wrap onto a line of their own').toContain('flex-wrap');
    for (; el; el = el.parentElement) {
      expect(el.className ?? '', 'an ancestor clips the actions off-screen').not.toContain('overflow-hidden');
    }
  });

  it('pauses, and marks the migration’s own cached page for re-reading (2026-09-17)', async () => {
    listMock.mockResolvedValue([sampleMapping({ id: 'm1', status: 'active', name: 'Inbox' })]);
    pauseMock.mockResolvedValue(undefined as never);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['mapping', 'm1'], { id: 'm1', status: 'active' });

    renderMappings('/mappings', queryClient);
    fireEvent.click(await screen.findByTitle('Pause'));

    await waitFor(() => expect(pauseMock).toHaveBeenCalledWith('m1'));
    await waitFor(() => expect(queryClient.getQueryState(['mapping', 'm1'])?.isInvalidated).toBe(true));
  });
});

describe('Migrations — Delete takes two presses, and says what it does (0037 T5)', () => {
  it('arms on the first press and deletes on the second — no name to type', async () => {
    listMock.mockResolvedValue([sampleMapping({ id: 'm1', name: 'Inbox' })]);
    deleteMock.mockResolvedValue(undefined);

    renderMappings();

    fireEvent.click(await screen.findByTitle('Delete'));
    expect(deleteMock).not.toHaveBeenCalled();
    expect(screen.getByText(/settings and record/)).toBeInTheDocument();
    expect(screen.getByText(/nothing at your source or destination is touched/)).toBeInTheDocument();
    expect(screen.queryByText(/Type the migration name/)).not.toBeInTheDocument();

    const confirmButton = screen.getByRole('button', { name: 'Delete migration' });
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('m1'));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Delete migration' })).not.toBeInTheDocument(),
    );
  });

  it('says what setting the same migration up again does, and what pausing keeps (2026-09-23)', async () => {
    listMock.mockResolvedValue([sampleMapping({ id: 'm1', name: 'Inbox' })]);
    renderMappings();

    fireEvent.click(await screen.findByTitle('Delete'));

    expect(screen.getByText(/copies only what is new/)).toBeInTheDocument();
    expect(screen.getByText(/no longer updated when it changes at the source/)).toBeInTheDocument();
    expect(screen.getByText(/deleted or moved on the new side comes back/)).toBeInTheDocument();
    expect(screen.getByText(/pause the migration instead/)).toBeInTheDocument();
  });

  it('a name no placeholder could show still deletes — the owner’s own wall', async () => {
    listMock.mockResolvedValue([sampleMapping({ id: 'm1', name: 'Inbox ' })]);
    deleteMock.mockResolvedValue(undefined);

    renderMappings();
    fireEvent.click(await screen.findByTitle('Delete'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete migration' }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('m1'));
  });

  it('the first press can be taken back without deleting anything', async () => {
    listMock.mockResolvedValue([sampleMapping({ id: 'm1', name: 'Inbox' })]);
    renderMappings();

    fireEvent.click(await screen.findByTitle('Delete'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('button', { name: 'Delete migration' })).not.toBeInTheDocument();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('a refused delete renders the server words and keeps the migration', async () => {
    listMock.mockResolvedValue([sampleMapping({ id: 'm1', name: 'Inbox' })]);
    deleteMock.mockRejectedValue(
      axiosError(500, {
        error: 'delete_failed',
        reason:
          'Something went wrong deleting this migration — this is a fault on our side, not ' +
          'something your input caused. Reference 1a2b3c4d; quoting it finds the detail in the server log.',
      }),
    );

    renderMappings();

    fireEvent.click(await screen.findByTitle('Delete'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete migration' }));

    expect(await screen.findByText('The migration was not deleted.')).toBeInTheDocument();
    expect(screen.getByText(/Something went wrong deleting this migration/)).toBeInTheDocument();
    expect(screen.getByText('Inbox')).toBeInTheDocument();
  });
});

/**
 * `?status=` — where the dashboard's counts land (workplan 0074). A URL, so it
 * survives a refresh; VISIBLE, because a list quietly showing a subset is how
 * somebody comes to report a missing migration.
 */
describe('Migrations — filtering by lifecycle state (0074)', () => {
  const three = () => [
    sampleMapping({ id: 'a', status: 'active', name: 'Active one' }),
    sampleMapping({ id: 'b', status: 'paused', name: 'Paused one' }),
    sampleMapping({ id: 'c', status: 'done', name: 'Finished one' }),
  ];

  it('shows every migration when nothing is filtered', async () => {
    listMock.mockResolvedValue(three());
    renderMappings();

    expect(await screen.findByText('Active one')).toBeInTheDocument();
    expect(screen.getByText('Paused one')).toBeInTheDocument();
    expect(screen.getByText('Finished one')).toBeInTheDocument();
  });

  it('shows only the asked-for state, and SAYS that it is filtering', async () => {
    listMock.mockResolvedValue(three());
    renderMappings('/mappings?status=paused');

    expect(await screen.findByText('Paused one')).toBeInTheDocument();
    expect(screen.queryByText('Active one')).toBeNull();
    expect(screen.queryByText('Finished one')).toBeNull();
    expect(screen.getByText(/Showing only:/)).toBeInTheDocument();
  });

  it('filters inside a card, and hides a card with nothing left', async () => {
    listMock.mockResolvedValue(three());
    peopleMock.mockResolvedValue({
      people: [
        person('p-anna', 'Anna', [{ id: 'a', status: 'active' }, { id: 'b', status: 'paused' }]),
        person('p-bram', 'Bram', [{ id: 'c', status: 'done' }]),
      ],
      unassigned: [],
    });
    renderMappings('/mappings?status=paused');

    const card = await screen.findByRole('region', { name: 'Anna' });
    expect(within(card).getByText('Paused one')).toBeInTheDocument();
    expect(within(card).queryByText('Active one')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Bram' })).toBeNull();
  });

  it('can be cleared back to the whole list', async () => {
    listMock.mockResolvedValue(three());
    renderMappings('/mappings?status=paused');

    fireEvent.click(await screen.findByText('Show all migrations'));

    expect(await screen.findByText('Active one')).toBeInTheDocument();
    expect(screen.queryByText(/Showing only:/)).toBeNull();
  });

  it('filters to NOTHING for a status nothing has, rather than showing everything', async () => {
    listMock.mockResolvedValue(three());
    renderMappings('/mappings?status=cutover');

    expect(await screen.findByText(/Showing only:/)).toBeInTheDocument();
    expect(screen.queryByText('Active one')).toBeNull();
    expect(screen.queryByText('Paused one')).toBeNull();
  });
});
