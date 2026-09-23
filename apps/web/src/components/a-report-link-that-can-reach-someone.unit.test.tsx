// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * "Report a problem" (workplan 0130) is offered beside Sign out only when the
 * service takes reports, and it carries the page the person is on. A link to a
 * form that can send nowhere is a dead end with a friendly face.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { editionFlag, authState, available } = vi.hoisted(() => ({
  editionFlag: { selfhost: false },
  authState: {
    isAuthenticated: true,
    user: { name: 'Someone', email: 'someone@example.invalid' },
    logout: () => {},
    operator: false,
    tenantCount: 1,
    token: 'a-token',
  },
  available: { value: true },
}));

vi.mock('../services/edition', () => ({
  isSelfHost: () => editionFlag.selfhost,
  operatingBaseUrl: () => '',
}));
vi.mock('../stores/auth-store', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) =>
    selector ? selector(authState) : authState,
}));
vi.mock('../services/mapping-service', () => ({
  mappingApi: { get: vi.fn(() => new Promise<never>(() => {})) },
}));
vi.mock('../services/problem-report-service.ts', () => ({
  fetchReportingAvailable: async () => available.value,
}));

import Layout from './Layout.tsx';

const renderLayout = (path: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route path="*" element={<div>page-body</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  editionFlag.selfhost = false;
  available.value = true;
});

describe('Report a problem, beside Sign out', () => {
  it('is offered when the service takes reports, and carries the page the person is on', async () => {
    renderLayout('/mappings/m-1/failures');

    const link = await screen.findByRole('link', { name: 'Report a problem' });
    expect(link.getAttribute('href')).toBe('/report?from=%2Fmappings%2Fm-1%2Ffailures');
  });

  it('is not offered when the service takes none', async () => {
    available.value = false;
    renderLayout('/dashboard');

    await screen.findByText('page-body');
    // Give the question its answer before asserting the absence.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('link', { name: 'Report a problem' })).toBeNull();
  });

  it('is not offered on the appliance, which has nowhere to send one yet', async () => {
    editionFlag.selfhost = true;
    renderLayout('/confirm');

    await screen.findByText('page-body');
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('link', { name: 'Report a problem' })).toBeNull();
  });
});
