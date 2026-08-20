// Copyright 2026 The Ownpace authors (Apache-2.0)

import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Dashboard from './Dashboard.tsx';
import { mappingApi, type MappingListItem } from '../services/mapping-service.ts';
import { fetchRuns } from '../services/operating-service.ts';

// The Dashboard loads data through the real service layer (mappingApi -> apiClient
// -> /api). We mock the service so the test drives loading / data / error states
// without a backend, proving the component is wired to the API contract.
vi.mock('../services/mapping-service', () => ({
  mappingApi: { list: vi.fn() },
}));
vi.mock('../services/operating-service', () => ({
  fetchRuns: vi.fn(),
  // Added when the Dashboard grew a NotificationChannelBanner (0043 T3). The
  // banner reads /status; a payload with no `notifications` field renders
  // nothing, so these assertions are unaffected — the mock exists because the
  // component tree gained a dependency, not because behaviour changed.
  fetchStatus: vi.fn().mockResolvedValue({ status: 'ok', mappings: [] }),
}));

const listMock = vi.mocked(mappingApi.list);
const runsMock = vi.mocked(fetchRuns);

const renderDashboard = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

// The LIST shape (0033 T1): no configs — the list route never served them,
// and the old fixture's configs let the test pass while production threw.
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

describe('Dashboard', () => {
  beforeEach(() => {
    listMock.mockReset();
    runsMock.mockReset();
    // Default: no run history — individual tests override.
    runsMock.mockResolvedValue({ runs: [] });
  });

  it('renders one tile per real lifecycle state and counts them', async () => {
    listMock.mockResolvedValue([
      sampleMapping({ id: 'a', status: 'active' }),
      sampleMapping({ id: 'b', status: 'paused' }),
      sampleMapping({ id: 'c', status: 'cutover' }),
      sampleMapping({ id: 'd', status: 'done' }),
      sampleMapping({ id: 'e', status: 'done' }),
    ]);

    renderDashboard();

    expect(await screen.findByText('Total Migrations')).toBeInTheDocument();
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));

    // Mutation check (0033 T1 acceptance): the Done tile counts mappings in
    // 'done' — the lifecycle's real happy ending. Reintroducing a filter for
    // 'completed' (a word the DB CHECK forbids) makes this 2 a 0.
    const doneTile = screen.getByText('Done').closest('div')!;
    expect(doneTile.textContent).toContain('2');
    const cutoverTile = screen.getByText('In cutover').closest('div')!;
    expect(cutoverTile.textContent).toContain('1');
    expect(screen.getByText('5')).toBeInTheDocument(); // total
  });

  /**
   * A count is a question, and the tile has to answer it (workplan 0074).
   *
   * The five tiles counted the lifecycle states and were plain `<div>`s. The
   * owner asked the obvious thing — *I can't click those, why not?* — because
   * the only interesting follow-up to "3 paused" is "which three", and the
   * screen had no way to say. Each tile is now the filtered list it counts.
   */
  it('each tile leads to the list it is counting (0074)', async () => {
    listMock.mockResolvedValue([
      sampleMapping({ id: 'a', status: 'active' }),
      sampleMapping({ id: 'b', status: 'paused' }),
    ]);

    renderDashboard();

    const href = (label: string) =>
      screen.getByText(label).closest('a')!.getAttribute('href');

    expect(await screen.findByText('Total Migrations')).toBeInTheDocument();
    // Total goes to the unfiltered list — every other tile is a subset of it.
    expect(href('Total Migrations')).toBe('/mappings');
    expect(href('Active')).toBe('/mappings?status=active');
    expect(href('Paused')).toBe('/mappings?status=paused');
    expect(href('In cutover')).toBe('/mappings?status=cutover');
    expect(href('Done')).toBe('/mappings?status=done');
  });

  it('Recent Activity is REAL run history: a failed run in the ledger is visibly failed (0033 T4)', async () => {
    listMock.mockResolvedValue([
      sampleMapping({ id: 'a', name: 'Acme mail', lastSyncAt: '2026-08-09T10:00:00Z' }),
    ]);
    runsMock.mockResolvedValue({
      runs: [
        {
          id: 'run-1',
          mappingId: 'a',
          type: 'delta',
          status: 'failed',
          startedAt: '2026-08-09T10:00:00Z',
          finishedAt: '2026-08-09T10:05:00Z',
          itemsProcessed: 12,
          errors: 3,
          createdAt: '2026-08-09T10:00:00Z',
          events: [],
        },
      ],
    });

    renderDashboard();

    // The run's own outcome word (RunsPanel's vocabulary), not the mapping's
    // lifecycle — the old section showed mappings-by-lastSyncAt dressed as
    // activity, on which a failed run was invisible.
    expect(await screen.findByText('Failed')).toBeInTheDocument();
    expect(screen.getByText(/3 errors/)).toBeInTheDocument();
    expect(runsMock).toHaveBeenCalledWith('a');
  });

  it('a failed run-history read says so instead of rendering as "no runs" (hard rule 9)', async () => {
    listMock.mockResolvedValue([
      sampleMapping({ id: 'a', name: 'Acme mail', lastSyncAt: '2026-08-09T10:00:00Z' }),
    ]);
    runsMock.mockRejectedValue(new Error('runs table unreachable'));

    renderDashboard();

    expect(await screen.findByText(/Could not read the run history/)).toBeInTheDocument();
    expect(screen.getByText(/runs table unreachable/)).toBeInTheDocument();
    expect(screen.queryByText('No passes yet')).not.toBeInTheDocument();
  });

  it('surfaces API errors verbatim (SAD §11.2)', async () => {
    listMock.mockRejectedValue(new Error('connector auth failed: 401'));

    renderDashboard();

    // The exact error message must be shown to the user, not masked.
    expect(
      await screen.findByText('connector auth failed: 401')
    ).toBeInTheDocument();
  });
});
