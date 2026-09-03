// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The Mappings list against hard rule 9 (0033 T2).
 *
 * Before this test existed, a failed list read fell through
 * `mappings?.length === 0` (undefined ≠ 0) into the table branch and rendered
 * an empty table with headers — "no mappings" said about a list we could not
 * read, on the managed operator's main screen. That masking is what hid the
 * T1 schema break. The pattern pinned here is Confirm.unit.test.tsx's: the
 * failure text renders, the empty-state text does NOT.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import Mappings from './Mappings.tsx';
import { mappingApi, type MappingListItem } from '../services/mapping-service.ts';

vi.mock('../services/mapping-service', () => ({
  mappingApi: { list: vi.fn(), triggerSync: vi.fn(), delete: vi.fn() },
}));

const listMock = vi.mocked(mappingApi.list);
const syncMock = vi.mocked(mappingApi.triggerSync);
const deleteMock = vi.mocked(mappingApi.delete);

const renderMappings = (path = '/mappings') => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Mappings />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

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

/** An axios-shaped rejection carrying a JSON error body, the way the real
 *  apiClient delivers a 500 — err.message is the generic transport wrapper,
 *  the server's sentence lives in response.data.
 *
 *  The body is `{error, reason}` because that is what `serverFault` sends
 *  (workplan 0081): a stable code, and one sentence carrying the reference
 *  that finds the stack in the log. It used to be `{error: 'Internal server
 *  error', message}`, and a fixture left on the old shape would keep passing
 *  while proving nothing about what the API actually answers. */
const axios500 = (reason: string): AxiosError => {
  const err = new AxiosError('Request failed with status code 500');
  err.response = {
    status: 500,
    statusText: 'Internal Server Error',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: { error: 'list_failed', reason },
  };
  return err;
};

describe('Mappings — failed read ≠ empty list (hard rule 9)', () => {
  beforeEach(() => {
    listMock.mockReset();
  });

  it('renders the SERVER message on a failed read, and never the empty state or the table', async () => {
    listMock.mockRejectedValue(
      axios500(
        'Something went wrong listing your migrations — this is a fault on our side, not ' +
          'something your input caused. Reference 1a2b3c4d; quoting it finds the detail in the server log.',
      ),
    );

    renderMappings();

    // The server's own sentence, not axios's wrapper — and the reference with
    // it, which is the only thing connecting this red box to the stack in the log.
    expect(await screen.findByText(/Something went wrong listing your migrations/)).toBeInTheDocument();
    expect(screen.getByText(/Reference 1a2b3c4d/)).toBeInTheDocument();
    expect(screen.getByText('Could not load the migrations list.')).toBeInTheDocument();
    // Mutation check: removing the error branch would fall through to one of
    // these — both must be absent.
    expect(screen.queryByText('No migrations yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Name')).not.toBeInTheDocument();
    expect(screen.queryByText('Request failed with status code 500')).not.toBeInTheDocument();
  });

  it('renders the four real lifecycle states as badges when the read succeeds', async () => {
    listMock.mockResolvedValue([
      sampleMapping({ id: 'a', status: 'active', name: 'A' }),
      sampleMapping({ id: 'b', status: 'paused', name: 'B' }),
      sampleMapping({ id: 'c', status: 'cutover', name: 'C' }),
      sampleMapping({ id: 'd', status: 'done', name: 'D' }),
    ]);

    renderMappings();

    // The canonical translated words (StateChip, 0035 T1) — never the raw enum.
    expect(await screen.findByText('In cutover')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.queryByText('No migrations yet')).not.toBeInTheDocument();
  });

  it('still shows the true empty state when the tenant has no mappings', async () => {
    listMock.mockResolvedValue([]);

    renderMappings();

    expect(await screen.findByText('No migrations yet')).toBeInTheDocument();
    expect(screen.queryByText('Could not load the migrations list.')).not.toBeInTheDocument();
  });
});

describe('Mappings — a refused sync says so at the row (0033 T3)', () => {
  beforeEach(() => {
    listMock.mockReset();
    syncMock.mockReset();
  });

  it("renders the server's refusal verbatim under the row; the old code console.error'd it away", async () => {
    // A cutover-state row: its Play still posts a sync the server may refuse.
    // (The PAUSED row no longer has a Play at all — see the 0037 T2 test.)
    listMock.mockResolvedValue([sampleMapping({ id: 'c1', status: 'cutover', name: 'Cutting over' })]);
    const err = new AxiosError('Request failed with status code 409');
    err.response = {
      status: 409,
      statusText: 'Conflict',
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: {
        error: 'Conflict',
        message: 'Mapping is in cutover — the final sync is managed by the cutover task.',
      },
    };
    syncMock.mockRejectedValue(err);

    renderMappings();

    fireEvent.click(await screen.findByTitle('Start sync'));

    expect(
      await screen.findByText(/Mapping is in cutover — the final sync/),
    ).toBeInTheDocument();
    expect(screen.getByText('The sync request did not complete.')).toBeInTheDocument();
    expect(screen.queryByText('Request failed with status code 409')).not.toBeInTheDocument();
  });
});

describe('Mappings — a paused row leads to the confirm screen, not to a 409 (0037 T2)', () => {
  beforeEach(() => {
    listMock.mockReset();
    syncMock.mockReset();
  });

  it('renders "Review and start" linking to /mappings/:id/confirm and no Play button', async () => {
    listMock.mockResolvedValue([sampleMapping({ id: 'p1', status: 'paused', name: 'Paused one' })]);

    renderMappings();

    const link = await screen.findByRole('link', { name: 'Review and start' });
    expect(link).toHaveAttribute('href', '/mappings/p1/confirm');
    // The 409-destined Play is gone from paused rows.
    expect(screen.queryByTitle('Start sync')).not.toBeInTheDocument();
    expect(syncMock).not.toHaveBeenCalled();
  });
});

describe('Mappings — Delete arms with the mapping name and works (0037 T5)', () => {
  beforeEach(() => {
    listMock.mockReset();
    syncMock.mockReset();
    deleteMock.mockReset();
  });

  /**
   * The Delete button has to be REACHABLE, not merely present (workplan 0073).
   *
   * The table wrapper was `overflow-hidden` around five nowrap columns wider
   * than a phone, so the actions column was clipped with no way to scroll to
   * it: on Android the owner could not delete a migration at all, and every
   * test below passed the whole time because jsdom renders the button
   * regardless of whether a human could touch it.
   *
   * jsdom has no layout, so a scroll cannot be simulated — asserting the
   * container permits horizontal overflow is the most this tier can say. It is
   * a weak test for a real defect, and it is here because the alternative is
   * nothing: the same defect already shipped once as 0068 T9.
   */
  it('lets a narrow screen reach the actions column (0073)', async () => {
    listMock.mockResolvedValue([sampleMapping({ id: 'm1', name: 'Inbox' })]);
    renderMappings();

    const table = (await screen.findByRole('table')).parentElement!;
    expect(
      table.className,
      'the actions column is clipped off-screen on a phone, Delete included',
    ).toContain('overflow-x-auto');
    expect(table.className).not.toContain('overflow-hidden');
  });

  /**
   * ASKING TWICE, NOT ASKING FOR DICTATION (owner, 2026-09-03).
   *
   * This test used to type the migration's name into a box, because the
   * confirm button compared the typed text to `mapping.name` byte for byte.
   * The owner met the failure that gate makes possible: *"i think i typed it
   * over, but it was not recognized, so i cant delete my migration"* — a
   * name carrying a character a placeholder cannot show (a trailing space is
   * enough) locks the button with no sentence saying why, and a confirmation
   * that can refuse a correct answer is not a safety measure.
   *
   * The weight was misplaced as well as brittle. Typing a name belongs to
   * things that cannot be got back; this deletes rows in OUR database, and
   * every FK to `mailbox_mapping` cascades to more of ours. Nothing reaches
   * the source or the target — this product writes to a provider inside a
   * sync or a gated apply, never from a screen. So: two presses, and the
   * sentence between them says exactly that.
   */
  it('arms on the first press and deletes on the second — no name to type', async () => {
    listMock.mockResolvedValue([sampleMapping({ id: 'm1', name: 'Inbox' })]);
    deleteMock.mockResolvedValue(undefined);

    renderMappings();

    // One press arms; nothing has been asked of the server yet.
    fireEvent.click(await screen.findByTitle('Delete'));
    expect(deleteMock).not.toHaveBeenCalled();

    // The sentence names what goes AND what is not touched, because that is
    // what makes one press enough.
    expect(screen.getByText(/the record of what it has already copied/)).toBeInTheDocument();
    expect(
      screen.getByText(/Nothing at your source or your destination is touched/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Type the migration name/)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Inbox')).not.toBeInTheDocument();

    const confirmButton = screen.getByRole('button', { name: 'Delete migration' });
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('m1'));
    // The arming row closes after a successful delete.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Delete migration' })).not.toBeInTheDocument(),
    );
  });

  it('a name no placeholder could show still deletes — the owner\u2019s own wall', async () => {
    // A trailing space is invisible in a text box and was, until today,
    // enough to make a migration undeletable through the product.
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

  it('a refused delete renders the server words and keeps the row', async () => {
    listMock.mockResolvedValue([sampleMapping({ id: 'm1', name: 'Inbox' })]);
    const err = new AxiosError('Request failed with status code 500');
    err.response = {
      status: 500,
      statusText: 'Internal Server Error',
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: {
        error: 'delete_failed',
        reason:
          'Something went wrong deleting this migration — this is a fault on our side, not ' +
          'something your input caused. Reference 1a2b3c4d; quoting it finds the detail in the server log.',
      },
    };
    deleteMock.mockRejectedValue(err);

    renderMappings();

    fireEvent.click(await screen.findByTitle('Delete'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete migration' }));

    expect(await screen.findByText('The migration was not deleted.')).toBeInTheDocument();
    expect(screen.getByText(/Something went wrong deleting this migration/)).toBeInTheDocument();
    expect(screen.getByText(/Reference 1a2b3c4d/)).toBeInTheDocument();
    // The mapping is still listed — nothing pretended to succeed.
    expect(screen.getByText('Inbox')).toBeInTheDocument();
  });
});


/**
 * `?status=` — where the dashboard's counts land (workplan 0074).
 *
 * The five tiles counted the lifecycle states and were plain `<div>`s. The
 * obvious question a count raises is *which ones?*, and clicking it did
 * nothing at all, which is the whole of the owner's report.
 *
 * The filter is a URL rather than component state so it survives a refresh and
 * can be shared — and it is VISIBLE, because a list quietly showing a subset
 * is how somebody comes to report a missing migration.
 */
describe('Mappings — filtering by lifecycle state (0074)', () => {
  beforeEach(() => {
    listMock.mockReset();
    syncMock.mockReset();
    deleteMock.mockReset();
  });

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
    // Visible and named — otherwise the next person reports a missing row.
    expect(screen.getByText(/Showing only:/)).toBeInTheDocument();
  });

  it('can be cleared back to the whole list', async () => {
    listMock.mockResolvedValue(three());
    renderMappings('/mappings?status=paused');

    fireEvent.click(await screen.findByText('Show all migrations'));

    expect(await screen.findByText('Active one')).toBeInTheDocument();
    expect(screen.queryByText(/Showing only:/)).toBeNull();
  });

  it('filters to NOTHING for a status nothing has, rather than showing everything', async () => {
    // An empty list under a banner naming the filter is an answer. A full list
    // under a filter that silently did not apply is a lie.
    listMock.mockResolvedValue(three());
    renderMappings('/mappings?status=cutover');

    expect(await screen.findByText(/Showing only:/)).toBeInTheDocument();
    expect(screen.queryByText('Active one')).toBeNull();
    expect(screen.queryByText('Paused one')).toBeNull();
  });
});
