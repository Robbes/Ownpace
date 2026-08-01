// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * One migration's hub (workplan 0019 T4).
 *
 * The links ARE the deliverable: before this page, every per-mapping operating
 * screen was reachable only by typing an address. So these tests pin the five
 * destinations — and that the links survive the detail read failing, because
 * navigation degrading to a dead end would recreate the problem.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';

const { mappingApiGet } = vi.hoisted(() => ({ mappingApiGet: vi.fn() }));

vi.mock('../services/mapping-service', () => ({
  mappingApi: { get: mappingApiGet },
}));

import MappingDetail from './MappingDetail';

function renderHub(id = 'acme-mail') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/mappings/${id}`]}>
        <Routes>
          <Route path="/mappings/:id" element={<MappingDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mappingApiGet.mockResolvedValue({ name: 'Acme mail', status: 'active' });
});

describe('the per-mapping navigation', () => {
  it('links every operating screen for THIS mapping, in the cutover order', async () => {
    renderHub();

    expect(await screen.findByText('Deletions')).toBeInTheDocument();
    const expected: Record<string, string> = {
      Deletions: '/mappings/acme-mail/deletions',
      Moves: '/mappings/acme-mail/moves',
      Failures: '/mappings/acme-mail/failures',
      Check: '/mappings/acme-mail/verify',
      Finish: '/mappings/acme-mail/finish',
    };
    for (const [name, href] of Object.entries(expected)) {
      const link = screen.getByRole('link', { name: new RegExp(name) });
      expect(link.getAttribute('href')).toBe(href);
    }
  });

  it('shows the mapping name when the detail read succeeds', async () => {
    renderHub();
    expect(await screen.findByRole('heading', { name: 'Acme mail' })).toBeInTheDocument();
  });

  it('keeps every link working when the detail read fails — navigation never dead-ends', async () => {
    mappingApiGet.mockRejectedValue(new Error('boom'));
    renderHub();

    expect(
      await screen.findByText(/Could not read this migration's details/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Finish/ }).getAttribute('href')).toBe(
      '/mappings/acme-mail/finish',
    );
  });
});
