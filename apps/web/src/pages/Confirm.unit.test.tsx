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

const {
  fetchStatus,
  fetchAllDiscovery,
  fetchScopeManifest,
  fetchSharedAddresses,
  startMigration,
} = vi.hoisted(() => ({
  fetchStatus: vi.fn(),
  fetchAllDiscovery: vi.fn(),
  fetchScopeManifest: vi.fn(),
  fetchSharedAddresses: vi.fn(),
  startMigration: vi.fn(),
}));

vi.mock('../services/operating-service', () => ({
  fetchStatus,
  fetchAllDiscovery,
  fetchScopeManifest,
  fetchSharedAddresses,
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
  // Nothing discovered by default; the panel's own suite owns the states.
  fetchSharedAddresses.mockResolvedValue({ addresses: [] });
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

function activeStatusWithProgress(): StatusReport {
  return {
    status: 'ok',
    mappings: [
      {
        mappingId: 'acme-mail',
        migrationStatus: 'active',
        domains: [
          {
            domain: 'email',
            state: 'in_progress',
            itemsSynced: 1149,
            itemsFailed: 16,
            bytesTransferred: 8359732,
            itemsRetrying: 16,
            itemsNeedingDecision: 0,
            lastError: 'connect ECONNREFUSED 100.97.25.131:1993',
          },
          {
            domain: 'calendar',
            state: 'skipped',
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

describe('once it is running', () => {
  it('offers no green light, and points at the console instead', async () => {
    // Pressing "start" on a running migration is meaningless; the operator's
    // next question is what needs them.
    fetchStatus.mockResolvedValue(status('active'));
    renderScreen();

    expect(await screen.findByText(/Open the migration console/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start migration/ })).not.toBeInTheDocument();
  });

  it('stops claiming nothing has been copied, and shows the LEDGER speaking', async () => {
    // 2026-08-09, on a real appliance: this page said "Nothing has been
    // copied yet" above a migration that had copied 1149 items, and showed
    // only the pre-start scan's 510 -- the operator compared the two numbers
    // and reasonably asked which was lying. Neither was; the page was showing
    // a snapshot as if it were a gauge.
    fetchStatus.mockResolvedValue(activeStatusWithProgress());
    renderScreen();

    expect(await screen.findByText('Live progress')).toBeInTheDocument();
    // The SAME numbers /status serves -- one source, so this screen and
    // PowerShell cannot disagree.
    expect(screen.getByText(/1,149|1\.149/)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing has been copied yet/)).not.toBeInTheDocument();
    expect(screen.getByText(/Migrations here have started/)).toBeInTheDocument();
    // A skipped domain earns no progress row.
    expect(screen.queryByText('Skipped')).not.toBeInTheDocument();
  });

  it('shows the current failure VERBATIM in the progress row', async () => {
    fetchStatus.mockResolvedValue(activeStatusWithProgress());
    renderScreen();
    expect(await screen.findByText('connect ECONNREFUSED 100.97.25.131:1993')).toBeInTheDocument();
  });

  it('demotes the pre-start scan to a labelled, dated, FOLDED snapshot', async () => {
    fetchStatus.mockResolvedValue(activeStatusWithProgress());
    renderScreen();

    const summary = await screen.findByText(/Pre-start scan \(snapshot\)/);
    // Dated, so "these numbers are old" is visible rather than inferable.
    expect(summary.textContent).toMatch(/2026/);
    // Folded by default: after the start the scan is history, and history
    // must not sit above the live numbers dressed as their equal.
    expect(summary.closest('details')?.hasAttribute('open')).toBe(false);
  });

  it('keeps the scan PROMINENT while the mapping is still paused', async () => {
    // Before the start the scan is the decision input -- folding it there
    // would hide exactly what the green light asks the operator to review.
    fetchStatus.mockResolvedValue(status('paused'));
    renderScreen();

    expect(await screen.findByText('4812')).toBeInTheDocument();
    expect(screen.queryByText(/Pre-start scan/)).not.toBeInTheDocument();
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
