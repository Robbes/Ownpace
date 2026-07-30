// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The appliance's review & confirm screen (ADR-0026).
 *
 * Replaces `apps/selfhost/src/confirm-page.ts`, and inherits what that page's
 * tests were protecting: that "nothing has been copied yet" is said plainly,
 * that the green light appears only for a mapping that has not started, and
 * that a failure to read is not dressed up as "nothing to do".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { StatusReport } from '@openmig/shared';

const { fetchStatus, fetchAllDiscovery, fetchScopeManifest, startMigration } = vi.hoisted(() => ({
  fetchStatus: vi.fn(),
  fetchAllDiscovery: vi.fn(),
  fetchScopeManifest: vi.fn(),
  startMigration: vi.fn(),
}));

vi.mock('../services/operating-service', () => ({
  fetchStatus,
  fetchAllDiscovery,
  fetchScopeManifest,
  startMigration,
}));

import Confirm from './Confirm';

function status(migrationStatus: StatusReport['mappings'][number]['migrationStatus']): StatusReport {
  return {
    status: 'ok',
    mappings: [
      {
        mappingId: 'acme-mail',
        migrationStatus,
        domains: [
          {
            domain: 'email',
            state: 'pending',
            itemsSynced: 0,
            itemsFailed: 0,
            bytesTransferred: 0,
            itemsRetrying: 0,
            itemsNeedingDecision: 0,
          },
        ],
      },
    ],
  };
}

const discovery = {
  'acme-mail': [
    {
      domain: 'email' as const,
      collections: 4,
      items: 4812,
      bytes: 1024 * 1024,
      discoveredAt: '2026-07-30T00:00:00Z',
    },
  ],
};

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Confirm />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchAllDiscovery.mockResolvedValue(discovery);
  fetchScopeManifest.mockResolvedValue({
    version: 'v1',
    migrates: [{ item: 'Mail', detail: 'folders and flags' }],
    partial: [{ item: 'Permissions', detail: 'guided' }],
    doesNotMigrate: [{ item: 'Teams chat', detail: 'not migrated' }],
  });
});

describe('before anything has started', () => {
  it('says nothing has been copied, and offers the green light', async () => {
    fetchStatus.mockResolvedValue(status('paused'));
    renderScreen();

    expect(await screen.findByText(/Nothing has been copied yet/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Start migration/ })).toBeInTheDocument();
    // The counts it is asking them to review.
    expect(await screen.findByText('4812')).toBeInTheDocument();
  });

  it('shows the scope manifest, so "what am I getting" is answered before the click', async () => {
    fetchStatus.mockResolvedValue(status('paused'));
    renderScreen();

    expect(await screen.findByText('Teams chat')).toBeInTheDocument();
    expect(screen.getByText('Does not migrate')).toBeInTheDocument();
  });

  it('starts the migration and reports it', async () => {
    fetchStatus.mockResolvedValue(status('paused'));
    startMigration.mockResolvedValue({ status: 'ok', action: 'start', activated: true });
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: /Start migration/ }));
    await waitFor(() => expect(startMigration).toHaveBeenCalledWith('acme-mail'));
  });
});

describe('once it is running', () => {
  it('offers no green light, and points at the console instead', async () => {
    // Pressing "start" on a running migration is meaningless; the operator's
    // next question is what needs them.
    fetchStatus.mockResolvedValue(status('active'));
    renderScreen();

    expect(await screen.findByText(/Open the migration console/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start migration/ })).not.toBeInTheDocument();
  });

  it('says a finished migration is finished', async () => {
    fetchStatus.mockResolvedValue(status('done'));
    renderScreen();

    expect(await screen.findByText(/no longer syncs/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start migration/ })).not.toBeInTheDocument();
  });
});

describe('when the appliance cannot be read', () => {
  it('says so instead of "no mappings configured"', async () => {
    // Those are different claims. "No mappings" reads as "nothing to do", which
    // is the wrong thing to show when we could not ask (hard rule 9).
    fetchStatus.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8081'));
    renderScreen();

    expect(await screen.findByText('Could not read the migrations.')).toBeInTheDocument();
    expect(screen.getByText(/ECONNREFUSED/)).toBeInTheDocument();
    expect(screen.queryByText(/No mappings configured/)).not.toBeInTheDocument();
  });
});
