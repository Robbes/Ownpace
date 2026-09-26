// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE CONTINUOUS LANE FROM THE FINISH PAGE (workplan 0128 D3, D4).
 *
 * Three defects, found together: the lane's line said "End it whenever you
 * like" over nothing to press; *Keep copying* failed on the appliance with
 * nothing but "could not switch it on"; and there it spoke of a tier the
 * appliance does not have. These pin the End, the reason a Keep failed, and
 * the appliance's own words (0128 D4: the same choice, on its own terms).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { AxiosError, AxiosHeaders } from 'axios';
import type { MappingLifecycle, StatusReport } from '@openmig/shared';
import { STRINGS } from '../i18n/strings.ts';

const {
  fetchStatus,
  fetchMappingDomains,
  fetchFailures,
  fetchMoves,
  fetchDeletions,
  finishMigration,
  keepCopyingAfterCutover,
  requestFinalPass,
  FinishRefusedError,
  fetchVerifyReport,
  edition,
} = vi.hoisted(() => {
  class FinishRefusedError extends Error {
    constructor(
      readonly refusal: { error: string; hint?: string; code?: string },
      readonly httpStatus: number,
    ) {
      super(refusal.error);
      this.name = 'FinishRefusedError';
    }
  }
  return {
    fetchStatus: vi.fn(),
    fetchMappingDomains: vi.fn(),
    fetchFailures: vi.fn(),
    fetchMoves: vi.fn(),
    fetchDeletions: vi.fn(),
    fetchVerifyReport: vi.fn(),
    finishMigration: vi.fn(),
    keepCopyingAfterCutover: vi.fn(),
    requestFinalPass: vi.fn(),
    FinishRefusedError,
    edition: { selfhost: false },
  };
});

vi.mock('../services/operating-service', () => ({
  fetchVerifyReport,
  fetchStatus,
  fetchMappingDomains,
  fetchFailures,
  fetchMoves,
  fetchDeletions,
  finishMigration,
  keepCopyingAfterCutover,
  requestFinalPass,
  FinishRefusedError,
}));

// VITE_EDITION is baked in at build time, so the edition is swapped here
// rather than through the environment (edition.unit.test.ts explains why).
vi.mock('../services/edition.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/edition.ts')>();
  return { ...actual, isSelfHost: () => edition.selfhost };
});

import Finish from './Finish.tsx';

const EN = STRINGS.en;

function statusReport(migrationStatus: MappingLifecycle): StatusReport {
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
            itemsFailed: 0,
            bytesTransferred: 1000,
            itemsRetrying: 0,
            itemsNeedingDecision: 0,
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
  edition.selfhost = false;
  fetchFailures.mockResolvedValue(emptyQueue);
  fetchMoves.mockResolvedValue(emptyQueue);
  fetchDeletions.mockResolvedValue(emptyQueue);
  fetchVerifyReport.mockResolvedValue({ state: 'never-run' });
  fetchMappingDomains.mockResolvedValue([]);
});

describe('the lane’s end', () => {
  it('offers End beside "end it whenever you like", and ends it through Finish’s own door', async () => {
    fetchStatus.mockResolvedValue(statusReport('continuous'));
    finishMigration.mockResolvedValue({
      status: 'ok',
      action: 'finish',
      mappingId: 'acme-mail',
      effect: 'The migration is finished.',
    });
    renderScreen();

    expect(await screen.findByText(EN['lane.running'])).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: EN['lane.end'] }));

    expect(finishMigration).toHaveBeenCalledWith('acme-mail', false);
    // The checklist is for a migration that has not finished: none of it here.
    expect(screen.queryByRole('button', { name: EN['finish.button'] })).not.toBeInTheDocument();
  });

  it('shows a refusal over open failures in the server’s words, and force only for that one', async () => {
    fetchStatus.mockResolvedValue(statusReport('continuous'));
    finishMigration.mockRejectedValueOnce(
      new FinishRefusedError(
        {
          error: '2 item(s) could not be migrated and are awaiting a decision',
          hint: 'Resolve them first.',
          code: 'unresolved_failures',
        },
        409,
      ),
    );
    renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: EN['lane.end'] }));

    expect(
      await screen.findByText('2 item(s) could not be migrated and are awaiting a decision'),
    ).toBeInTheDocument();
    expect(screen.getByText('Resolve them first.')).toBeInTheDocument();
    finishMigration.mockResolvedValueOnce({ status: 'ok', action: 'finish', effect: 'Finished.' });
    await userEvent.click(screen.getByRole('button', { name: EN['finish.forceButton'] }));
    expect(finishMigration).toHaveBeenLastCalledWith('acme-mail', true);
  });

  it('offers no End before the cutover: there the checklist ends it', async () => {
    fetchStatus.mockResolvedValue(statusReport('active'));
    renderScreen();
    expect(await screen.findByRole('button', { name: EN['finish.button'] })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: EN['lane.end'] })).not.toBeInTheDocument();
  });
});

describe('keeping copying', () => {
  const axiosError = (status: number, data: unknown): AxiosError => {
    const err = new AxiosError(`Request failed with status code ${status}`);
    err.response = { status, statusText: 'Conflict', headers: {}, config: { headers: new AxiosHeaders() }, data };
    return err;
  };

  it('says why a Keep failed, in the server’s words, not only that it did', async () => {
    fetchStatus.mockResolvedValue(statusReport('done'));
    const reason = "This migration is after its cutover ('done'); …";
    keepCopyingAfterCutover.mockRejectedValue(axiosError(409, { error: 'lifecycle_refused', message: reason }));
    renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: EN['lane.start'] }));
    await userEvent.click(screen.getByRole('button', { name: EN['lane.confirm'] }));

    await waitFor(() => expect(screen.getByText(`${EN['lane.failed']} ${reason}`)).toBeInTheDocument());
  });

  it('on the appliance, says nothing of a tier: it bills nothing', async () => {
    edition.selfhost = true;
    fetchStatus.mockResolvedValue(statusReport('done'));
    keepCopyingAfterCutover.mockResolvedValue(undefined);
    renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: EN['lane.start'] }));
    expect(screen.getByText(EN['lane.selfhost.why'])).toBeInTheDocument();
    expect(screen.queryByText(EN['lane.why'])).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: EN['lane.selfhost.confirm'] }));
    expect(keepCopyingAfterCutover).toHaveBeenCalledWith('acme-mail');
  });

  it('on managed, says what the tier does before the press', async () => {
    fetchStatus.mockResolvedValue(statusReport('cutover'));
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: EN['lane.start'] }));
    expect(screen.getByText(EN['lane.why'])).toBeInTheDocument();
    expect(screen.getByRole('button', { name: EN['lane.confirm'] })).toBeInTheDocument();
  });
});
