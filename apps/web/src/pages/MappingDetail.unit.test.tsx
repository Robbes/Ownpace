// Copyright 2026 The Ownpace authors (Apache-2.0)

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

const { mappingApiGet, fetchStatusMock, editionFlag } = vi.hoisted(() => ({
  mappingApiGet: vi.fn(),
  fetchStatusMock: vi.fn(),
  editionFlag: { selfhost: false },
}));

vi.mock('../services/mapping-service', () => ({
  mappingApi: { get: mappingApiGet },
}));

// VITE_EDITION is baked in by vite `define` (edition.unit.test.ts explains why
// stubbing the env at runtime cannot work), so component-level edition tests
// mock the module — the edition helpers keep their own pure tests.
vi.mock('../services/edition', () => ({
  isSelfHost: () => editionFlag.selfhost,
}));

// The runs panel has its own tests (RunsPanel.unit.test.tsx); here it only
// needs to not fetch over the network while the hub's links are asserted.
vi.mock('../services/operating-service', () => ({
  fetchRuns: vi.fn().mockResolvedValue({ runs: [] }),
  fetchStatus: fetchStatusMock,
}));

import MappingDetail from './MappingDetail.tsx';

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
  editionFlag.selfhost = false;
  mappingApiGet.mockResolvedValue({ name: 'Acme mail', status: 'active' });
  fetchStatusMock.mockResolvedValue({ status: 'ok', mappings: [] });
});

describe('the per-mapping navigation', () => {
  it('links every operating screen for THIS mapping, in the cutover order', async () => {
    renderHub();

    // Numbered since 0034 T4 — the list IS the cutover sequence and says so.
    expect(await screen.findByText('1. Deletions')).toBeInTheDocument();
    expect(screen.getByText(/in the order a cutover runs/)).toBeInTheDocument();
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

/**
 * The live per-domain strip (0033 T5): one component, two data sources —
 * managed from GET /migrations/{id}'s domainStatus, selfhost from the
 * appliance-wide /status filtered to this mapping. Both payloads are
 * DomainStatusReport rows built by the same shared function; the managed
 * test pins the RETRYING count specifically, because raw MigrationStatus
 * rows lacked it and the strip silently rendered nothing there before.
 */
describe('the live progress strip', () => {
  const emailDomain = {
    domain: 'email',
    state: 'in_progress',
    itemsSynced: 42,
    itemsFailed: 3,
    bytesTransferred: 1024,
    itemsRetrying: 2,
    itemsNeedingDecision: 1,
    lastSyncedAt: '2026-08-09T10:00:00.000Z',
    lastError: 'IMAP LIST failed: connection reset',
  };

  it('managed: renders the strip from the detail payload, retrying count included', async () => {
    mappingApiGet.mockResolvedValue({
      name: 'Acme mail',
      status: 'active',
      domainStatus: [emailDomain],
    });
    renderHub();

    expect(await screen.findByText('42 synced')).toBeInTheDocument();
    expect(screen.getByText('3 failed')).toBeInTheDocument();
    expect(screen.getByText('2 retrying')).toBeInTheDocument();
    // The per-domain as-of (0036 T1) — must render from BOTH editions'
    // payloads or the strip becomes a single-edition feature (hard rule 5).
    expect(screen.getByText(/last synced/)).toBeInTheDocument();
    // The error verbatim — the prose boundary.
    expect(screen.getByText('IMAP LIST failed: connection reset')).toBeInTheDocument();
    expect(fetchStatusMock).not.toHaveBeenCalled();
  });

  it('selfhost: renders the strip from /status filtered to THIS mapping', async () => {
    editionFlag.selfhost = true;
    fetchStatusMock.mockResolvedValue({
      status: 'ok',
      mappings: [
        { mappingId: 'other-mapping', migrationStatus: 'active', domains: [{ ...emailDomain, itemsSynced: 999 }] },
        { mappingId: 'acme-mail', migrationStatus: 'active', domains: [emailDomain] },
      ],
    });
    renderHub();

    expect(await screen.findByText('42 synced')).toBeInTheDocument();
    expect(screen.getByText(/last synced/)).toBeInTheDocument();
    // The other mapping's numbers must not leak into this hub.
    expect(screen.queryByText('999 synced')).not.toBeInTheDocument();
    expect(mappingApiGet).not.toHaveBeenCalled();
  });
});
