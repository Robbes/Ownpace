// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The finish checklist (ADR-0026).
 *
 * The property under test is ORDER, not the button. Finishing stops the shadow
 * sync, so doing it before mail delivery has moved means everything arriving on
 * the old system afterwards is never copied — and the appliance has stopped
 * watching, so nothing reports it. That is silent data loss caused by pressing
 * the right button at the wrong time, and it is the whole reason this screen is
 * a checklist.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { StatusReport } from '@openmig/shared';

const {
  fetchStatus,
  fetchFailures,
  fetchMoves,
  fetchDeletions,
  finishMigration,
  requestFinalPass,
  FinishRefusedError,
} = vi.hoisted(() => {
  class FinishRefusedError extends Error {
    constructor(
      readonly refusal: { error: string; hint?: string },
      readonly httpStatus: number,
    ) {
      super(refusal.error);
      this.name = 'FinishRefusedError';
    }
  }
  return {
    fetchStatus: vi.fn(),
    fetchFailures: vi.fn(),
    fetchMoves: vi.fn(),
    fetchDeletions: vi.fn(),
    finishMigration: vi.fn(),
    requestFinalPass: vi.fn(),
    FinishRefusedError,
  };
});

vi.mock('../services/operating-service', () => ({
  fetchStatus,
  fetchFailures,
  fetchMoves,
  fetchDeletions,
  finishMigration,
  requestFinalPass,
  FinishRefusedError,
}));

import Finish from './Finish';

function statusReport(migrationStatus: StatusReport['mappings'][number]['migrationStatus'], needingDecision = 0): StatusReport {
  return {
    status: 'ok',
    mappings: [
      {
        mappingId: 'acme-mail',
        migrationStatus,
        domains: [
          {
            domain: 'email',
            state: 'completed',
            itemsSynced: 100,
            itemsFailed: needingDecision,
            bytesTransferred: 1000,
            itemsRetrying: 0,
            itemsNeedingDecision: needingDecision,
          },
        ],
      },
    ],
  };
}

const emptyQueue = {
  'acme-mail': {
    migrationStatus: 'active' as const,
    confirmed: [],
    watching: [],
    acknowledged: [],
    open: [],
    needsDecision: [],
    retrying: [],
    whatThisMeans: '',
    howToResolve: {},
  },
};

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Finish />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchFailures.mockResolvedValue(emptyQueue);
  fetchMoves.mockResolvedValue(emptyQueue);
  fetchDeletions.mockResolvedValue(emptyQueue);
});

describe('the cutover order', () => {
  it('will not finish until delivery has been confirmed moved', async () => {
    // The gate. Everything else on this screen the appliance can check itself;
    // this one is MX/DNS, outside the tool, and finishing without it is the
    // silent-loss case.
    fetchStatus.mockResolvedValue(statusReport('active'));
    renderScreen();

    const button = await screen.findByRole('button', { name: /Finish this migration/ });
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(finishMigration).not.toHaveBeenCalled();
  });

  it('spells out what happens if you finish first, rather than assuming it is understood', async () => {
    fetchStatus.mockResolvedValue(statusReport('active'));
    renderScreen();

    expect(
      await screen.findByText(/will not be copied, and nothing will report it/),
    ).toBeInTheDocument();
  });

  it('finishes once delivery is confirmed', async () => {
    fetchStatus.mockResolvedValue(statusReport('active'));
    finishMigration.mockResolvedValue({
      status: 'ok',
      action: 'finish',
      mappingId: 'acme-mail',
      effect: 'The migration is finished.',
    });
    renderScreen();

    fireEvent.click(await screen.findByLabelText(/Delivery now goes to the new system/));
    const button = screen.getByRole('button', { name: /Finish this migration/ });
    expect(button).toBeEnabled();

    fireEvent.click(button);
    await waitFor(() => expect(finishMigration).toHaveBeenCalledWith('acme-mail', false));
    expect(await screen.findByText('The migration is finished.')).toBeInTheDocument();
  });

  it('says plainly that nothing is added or removed, because "finish" reads destructive', async () => {
    // An operator who thinks this might delete something never presses it, and
    // leaves the appliance syncing a dead source forever.
    fetchStatus.mockResolvedValue(statusReport('active'));
    renderScreen();
    expect(
      await screen.findByText(/Nothing is added to or removed from either system/),
    ).toBeInTheDocument();
  });
});

describe('the failure queue', () => {
  it('warns about unresolved items before anything is clicked', async () => {
    // The server would refuse anyway, but discovering the count only after a
    // rejected click makes the product look broken rather than careful.
    fetchStatus.mockResolvedValue(statusReport('active', 3));
    renderScreen();

    expect(await screen.findByText(/3 could not be copied/)).toBeInTheDocument();
  });

  it("offers force only AFTER the server has said what it would cost", async () => {
    fetchStatus.mockResolvedValue(statusReport('active', 3));
    finishMigration.mockRejectedValueOnce(
      new FinishRefusedError(
        {
          error: '3 item(s) could not be migrated and are awaiting a decision',
          hint: 'Resolve them at GET /failures, or re-send with ?force=true.',
        },
        409,
      ),
    );
    renderScreen();

    fireEvent.click(await screen.findByLabelText(/Delivery now goes to the new system/));
    // No force option exists yet.
    expect(screen.queryByText(/Finish anyway/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Finish this migration/ }));

    expect(
      await screen.findByText('3 item(s) could not be migrated and are awaiting a decision'),
    ).toBeInTheDocument();
    // Now it does, with the cost stated above it.
    const force = screen.getByRole('button', { name: /Finish anyway/ });
    finishMigration.mockResolvedValue({
      status: 'ok',
      action: 'finish',
      mappingId: 'acme-mail',
      leftUnmigrated: 3,
      effect: 'The migration is finished.',
    });
    fireEvent.click(force);
    await waitFor(() => expect(finishMigration).toHaveBeenLastCalledWith('acme-mail', true));
    expect(await screen.findByText(/3 items left unmigrated/)).toBeInTheDocument();
  });
});

describe('a migration that cannot be finished', () => {
  it('offers nothing for one that was never started', async () => {
    fetchStatus.mockResolvedValue(statusReport('paused'));
    renderScreen();

    expect(await screen.findByText(/Never started, so there is nothing to finish/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Finish this migration/ })).not.toBeInTheDocument();
  });

  it('shows a finished one as finished, with no checklist', async () => {
    fetchStatus.mockResolvedValue(statusReport('done'));
    renderScreen();

    expect(await screen.findByText(/no longer syncs/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Finish this migration/ })).not.toBeInTheDocument();
  });
});

describe('the per-mapping mode (workplan 0019 T5)', () => {
  // Reached as `mappings/:mappingId/finish` in EITHER edition. The lifecycle
  // comes from the queue envelopes themselves — never from `/status`, which
  // the managed edition does not serve — and the checklist's links stay inside
  // the mapping.
  function renderPerMapping(id = 'acme-mail') {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/mappings/${id}/finish`]}>
          <Routes>
            <Route path="/mappings/:mappingId/finish" element={<Finish />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('renders the checklist from the queue envelopes and never asks /status', async () => {
    renderPerMapping();

    expect(await screen.findByRole('heading', { name: 'acme-mail' })).toBeInTheDocument();
    expect(screen.getByText(/Run the check/)).toBeInTheDocument();
    expect(fetchStatus).not.toHaveBeenCalled();
    // The queues were asked about THIS mapping, not everything.
    expect(fetchFailures).toHaveBeenCalledWith('acme-mail');
  });

  it("keeps the checklist's links inside the mapping", async () => {
    renderPerMapping();

    const check = await screen.findByRole('link', { name: /Run the check/ });
    expect(check.getAttribute('href')).toBe('/mappings/acme-mail/verify');
  });

  it('says when no migration with that id answered — not the same as nothing to do', async () => {
    fetchFailures.mockResolvedValue({});
    fetchMoves.mockResolvedValue({});
    fetchDeletions.mockResolvedValue({});
    renderPerMapping('nope');

    expect(await screen.findByText(/No migration with id nope answered/)).toBeInTheDocument();
    expect(screen.queryByText(/Run the check/)).not.toBeInTheDocument();
  });

  it("reports the managed final pass as QUEUED — each edition's temporal shape, said not blurred", async () => {
    requestFinalPass.mockResolvedValue('queued');
    renderPerMapping();

    fireEvent.click(await screen.findByRole('button', { name: /Run a pass now/ }));
    await waitFor(() => expect(requestFinalPass).toHaveBeenCalledWith('acme-mail'));
    expect(await screen.findByText(/Queued\. The pass runs as a job/)).toBeInTheDocument();
  });
});

describe('the mapping id goes somewhere (0034 T1)', () => {
  it('links the per-mapping heading to the hub', async () => {
    fetchStatus.mockResolvedValue(statusReport('active'));
    renderScreen();

    const link = await screen.findByRole('link', { name: 'acme-mail' });
    expect(link.getAttribute('href')).toBe('/mappings/acme-mail');
  });
});
