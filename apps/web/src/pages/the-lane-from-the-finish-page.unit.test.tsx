// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE CONTINUOUS LANE FROM THE FINISH PAGE, PER DATA TYPE (workplan 0128 D3,
 * D4; T5 slice 7b).
 *
 * Three defects, found together: the lane's line said "End it whenever you
 * like" over nothing to press; *Keep copying* failed on the appliance with
 * nothing but "could not switch it on"; and there it spoke of a tier the
 * appliance does not have. Since slice 7b each data type is ended or kept on
 * its own, past the cutover too. These pin the End of a data type kept in the
 * lane, the Keep of one ended, the reason a press failed, and the appliance's
 * own words (0128 D4: the same choice, on its own terms).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { AxiosError, AxiosHeaders } from 'axios';
import type { MappingLifecycle, PathEndingChoice, StatusReport } from '@openmig/shared';
import { STRINGS } from '../i18n/strings.ts';

const {
  fetchStatus,
  fetchMappingDataTypes,
  fetchFailures,
  fetchMoves,
  fetchDeletions,
  endOrKeepDataType,
  requestFinalPass,
  PathEndingRefusedError,
  fetchVerifyReport,
  edition,
} = vi.hoisted(() => {
  class PathEndingRefusedError extends Error {
    constructor(
      readonly refusal: { error: string; refused: string; message: string; forceable?: true; count?: number },
    ) {
      super(refusal.message);
      this.name = 'PathEndingRefusedError';
    }
  }
  return {
    fetchStatus: vi.fn(),
    fetchMappingDataTypes: vi.fn(),
    fetchFailures: vi.fn(),
    fetchMoves: vi.fn(),
    fetchDeletions: vi.fn(),
    fetchVerifyReport: vi.fn(),
    endOrKeepDataType: vi.fn(),
    requestFinalPass: vi.fn(),
    PathEndingRefusedError,
    edition: { selfhost: false },
  };
});

vi.mock('../services/operating-service', () => ({
  fetchVerifyReport,
  fetchStatus,
  fetchMappingDataTypes,
  fetchFailures,
  fetchMoves,
  fetchDeletions,
  endOrKeepDataType,
  requestFinalPass,
  PathEndingRefusedError,
}));

// VITE_EDITION is baked in at build time, so the edition is swapped here
// rather than through the environment (edition.unit.test.ts explains why).
vi.mock('../services/edition.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/edition.ts')>();
  return { ...actual, isSelfHost: () => edition.selfhost };
});

import Finish from './Finish.tsx';

const EN = STRINGS.en;

/** Mail ended and files kept copying: a migration in the lane. */
const LANE: PathEndingChoice[] = [
  { domain: 'email', phase: 'done', stopped: false, offers: ['keep'] },
  { domain: 'file', phase: 'continuous', stopped: false, offers: ['end'] },
];

function statusReport(migrationStatus: MappingLifecycle, endings: PathEndingChoice[] = LANE): StatusReport {
  return {
    status: 'ok',
    mappings: [
      {
        mappingId: 'acme-mail',
        migrationStatus,
        endings,
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
  fetchMappingDataTypes.mockResolvedValue({ domains: [] });
});

describe('a data type kept copying, ended', () => {
  it('offers End beside each one kept, and ends it through its own door', async () => {
    fetchStatus.mockResolvedValue(statusReport('continuous'));
    endOrKeepDataType.mockResolvedValue({ changed: true, migration: { from: 'continuous', to: 'done' } });
    renderScreen();

    expect(await screen.findByText(EN['finish.each.title'])).toBeInTheDocument();
    expect(screen.getByText(EN['finish.ending.phase.continuous'])).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'End Files' }));

    expect(endOrKeepDataType).toHaveBeenCalledWith('acme-mail', 'file', 'end', false);
    // The checklist is for a migration before its cutover: none of it here.
    expect(screen.queryByText(EN['finish.step1.title'], { exact: false })).not.toBeInTheDocument();
    // The one already ended offers no End.
    expect(screen.queryByRole('button', { name: 'End Email' })).not.toBeInTheDocument();
  });

  it('shows a refusal over open failures in the server’s words, and force only for that one', async () => {
    fetchStatus.mockResolvedValue(statusReport('continuous'));
    endOrKeepDataType.mockRejectedValueOnce(
      new PathEndingRefusedError({
        error: 'end_refused',
        refused: 'unresolved_failures',
        count: 2,
        message: '2 item(s) of file could not be migrated and are awaiting a decision.',
        forceable: true,
      }),
    );
    renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: 'End Files' }));

    expect(
      await screen.findByText('2 item(s) of file could not be migrated and are awaiting a decision.'),
    ).toBeInTheDocument();
    endOrKeepDataType.mockResolvedValueOnce({ changed: true });
    await userEvent.click(screen.getByRole('button', { name: 'End Files anyway, leaving them behind' }));
    expect(endOrKeepDataType).toHaveBeenLastCalledWith('acme-mail', 'file', 'end', true);
  });

  it('offers no list past the cutover before it: there the checklist’s last step is the list', async () => {
    fetchStatus.mockResolvedValue(
      statusReport('active', [{ domain: 'file', phase: 'active', stopped: false, offers: ['end', 'keep'] }]),
    );
    renderScreen();
    expect(await screen.findByRole('button', { name: 'End Files' })).toBeInTheDocument();
    expect(screen.queryByText(EN['finish.each.title'])).not.toBeInTheDocument();
  });
});

describe('a data type ended, kept copying again', () => {
  const axiosError = (status: number, data: unknown): AxiosError => {
    const err = new AxiosError(`Request failed with status code ${status}`);
    err.response = { status, statusText: 'Conflict', headers: {}, config: { headers: new AxiosHeaders() }, data };
    return err;
  };

  it('says why a Keep failed, in the server’s words, not only that it did', async () => {
    fetchStatus.mockResolvedValue(statusReport('done', [{ domain: 'email', phase: 'done', stopped: false, offers: ['keep'] }]));
    const reason = 'Mapping not found';
    endOrKeepDataType.mockRejectedValue(axiosError(404, { error: 'Not found', message: reason }));
    renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: 'Keep copying Email' }));
    await userEvent.click(screen.getByRole('button', { name: EN['lane.confirm'] }));

    await waitFor(() => expect(screen.getByText(`${EN['finish.ending.failed']} ${reason}`)).toBeInTheDocument());
  });

  it('on the appliance, says nothing of a tier: it bills nothing', async () => {
    edition.selfhost = true;
    fetchStatus.mockResolvedValue(statusReport('continuous'));
    endOrKeepDataType.mockResolvedValue({ changed: true });
    renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: 'Keep copying Email' }));
    expect(screen.getByText(EN['lane.selfhost.why'])).toBeInTheDocument();
    expect(screen.queryByText(EN['lane.why'])).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: EN['lane.selfhost.confirm'] }));
    expect(endOrKeepDataType).toHaveBeenCalledWith('acme-mail', 'email', 'keep', false);
  });

  it('on managed, says what the tier does before the press, and Not now takes it back', async () => {
    fetchStatus.mockResolvedValue(statusReport('continuous'));
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: 'Keep copying Email' }));
    expect(screen.getByText(EN['lane.why'])).toBeInTheDocument();
    expect(screen.getByRole('button', { name: EN['lane.confirm'] })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: EN['lane.cancel'] }));
    expect(screen.queryByRole('button', { name: EN['lane.confirm'] })).not.toBeInTheDocument();
    expect(endOrKeepDataType).not.toHaveBeenCalled();
  });
});
