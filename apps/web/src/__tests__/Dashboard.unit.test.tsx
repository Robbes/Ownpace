// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Dashboard from '../pages/Dashboard';
import { mappingApi, type MappingListItem } from '../services/mapping-service';

// The Dashboard loads data through the real service layer (mappingApi -> apiClient
// -> /api). We mock the service so the test drives loading / data / error states
// without a backend, proving the component is wired to the API contract.
vi.mock('../services/mapping-service', () => ({
  mappingApi: { list: vi.fn() },
}));

const listMock = vi.mocked(mappingApi.list);

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

    expect(await screen.findByText('Total Mappings')).toBeInTheDocument();
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));

    // Mutation check (0033 T1 acceptance): the Done tile counts mappings in
    // 'done' — the lifecycle's real happy ending. Reintroducing a filter for
    // 'completed' (a word the DB CHECK forbids) makes this 2 a 0.
    const doneTile = screen.getByText('Done').closest('div')!;
    expect(doneTile.textContent).toContain('2');
    const cutoverTile = screen.getByText('Cutover').closest('div')!;
    expect(cutoverTile.textContent).toContain('1');
    expect(screen.getByText('5')).toBeInTheDocument(); // total
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
