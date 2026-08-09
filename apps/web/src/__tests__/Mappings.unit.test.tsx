// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
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
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import Mappings from '../pages/Mappings';
import { mappingApi, type MappingListItem } from '../services/mapping-service';

vi.mock('../services/mapping-service', () => ({
  mappingApi: { list: vi.fn(), triggerSync: vi.fn() },
}));

const listMock = vi.mocked(mappingApi.list);

const renderMappings = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
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
 *  the server's sentence lives in response.data. */
const axios500 = (message: string): AxiosError => {
  const err = new AxiosError('Request failed with status code 500');
  err.response = {
    status: 500,
    statusText: 'Internal Server Error',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: { error: 'Internal server error', message },
  };
  return err;
};

describe('Mappings — failed read ≠ empty list (hard rule 9)', () => {
  beforeEach(() => {
    listMock.mockReset();
  });

  it('renders the SERVER message on a failed read, and never the empty state or the table', async () => {
    listMock.mockRejectedValue(axios500('Failed to list mappings'));

    renderMappings();

    // The server's own sentence, not axios's wrapper.
    expect(await screen.findByText('Failed to list mappings')).toBeInTheDocument();
    expect(screen.getByText('Could not load the migrations list.')).toBeInTheDocument();
    // Mutation check: removing the error branch would fall through to one of
    // these — both must be absent.
    expect(screen.queryByText('No mappings yet')).not.toBeInTheDocument();
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

    expect(await screen.findByText('cutover')).toBeInTheDocument();
    expect(screen.getByText('done')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('paused')).toBeInTheDocument();
    expect(screen.queryByText('No mappings yet')).not.toBeInTheDocument();
  });

  it('still shows the true empty state when the tenant has no mappings', async () => {
    listMock.mockResolvedValue([]);

    renderMappings();

    expect(await screen.findByText('No mappings yet')).toBeInTheDocument();
    expect(screen.queryByText('Could not load the migrations list.')).not.toBeInTheDocument();
  });
});
