// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The failure queue's honesty additions (workplan 0036).
 *
 * T4: what retry actually costs is SAID at the control — the sentence
 * tracks domain-sync.ts's own cursor comment (an operator retry clears the
 * mapping's cursors, forcing the full re-list that makes the item reachable
 * again), so the UI and the engine cannot disagree.
 * T2: accepted items genuinely leave the ledger's failed set — the screen
 * states the asymmetry instead of leaving "why is there no decided section
 * here?" unexplained.
 * T3: each mapping section links to the hub, where the pass that failed can
 * be read (RunsPanel).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FailuresResponse } from '@openmig/shared';

const { fetchFailuresMock, decideFailureGroupMock } = vi.hoisted(() => ({
  fetchFailuresMock: vi.fn(),
  decideFailureGroupMock: vi.fn(),
}));

vi.mock('../services/operating-service', () => ({
  fetchFailures: fetchFailuresMock,
  retryFailure: vi.fn(),
  acceptFailure: vi.fn(),
  // The group press (2026-09-12). Listed here because the panel imports from
  // this same module, and a mock factory that omits an export hands the
  // component `undefined` — which reads as a render crash rather than as a
  // missing mock.
  decideFailureGroup: decideFailureGroupMock,
  DecisionRefusedError: class extends Error {},
}));

import Failures from './Failures.tsx';

const FAILURE = {
  naturalKeyHash: 'h-1',
  domain: 'email' as const,
  collection: 'INBOX/Archive',
  lastError: 'IMAP APPEND failed: 507 over quota',
  attempts: 5,
  needsDecision: true,
};

const GUIDANCE = {
  retry: 'Try the copy again on the next pass.',
  accept: 'Migrate without it.',
  doNothing: 'It stays here and blocks finishing.',
};

function queue(over: Partial<FailuresResponse['x']> = {}): FailuresResponse {
  return {
    'acme-mail': {
      migrationStatus: 'active',
      needsDecision: [FAILURE],
      retrying: [],
      howToResolve: GUIDANCE,
      ...over,
    },
  };
}

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Failures />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('what retry costs (0036 T4)', () => {
  it('says the next pass re-lists and takes longer, before the button is pressed', async () => {
    fetchFailuresMock.mockResolvedValue(queue());
    renderScreen();

    expect(
      await screen.findByText(/re-lists everything to reach this item again/),
    ).toBeInTheDocument();
    // And the button itself carries the sentence for hover/AT.
    expect(screen.getByRole('button', { name: 'Try again' }).getAttribute('title')).toContain(
      're-lists everything',
    );
  });

  it('shows no cost sentence when nothing is waiting', async () => {
    fetchFailuresMock.mockResolvedValue(queue({ needsDecision: [] }));
    renderScreen();

    await screen.findByText('acme-mail');
    expect(screen.queryByText(/re-lists everything/)).not.toBeInTheDocument();
  });
});

describe('the aftermath asymmetry is stated (0036 T2)', () => {
  it('says why this queue has no "Already decided" section', async () => {
    fetchFailuresMock.mockResolvedValue(queue());
    renderScreen();

    expect(
      await screen.findByText(/Accepted items no longer appear here/),
    ).toBeInTheDocument();
  });
});


/**
 * The group press's ONE page-level property (2026-09-12).
 *
 * The panel itself is covered in `FailureGroupPanel.unit.test.tsx`. What only
 * the page can get wrong is WHICH rows it hands over: `needsDecision` and
 * `retrying` are the same `status = 'failed'` rows to the server, so a panel
 * fed the parked half alone would preview three and change four. That is the
 * shape of mistake this repo has paid for before — a digest that said four
 * pointing at a queue that showed three.
 */
describe('the group panel is given every failed row, not just the parked ones', () => {
  const RETRYING = {
    naturalKeyHash: 'h-2',
    domain: 'file' as const,
    collection: '/Documents',
    lastError: 'MKCOL 404 on the parent collection',
    attempts: 1,
    needsDecision: false,
  };

  it('counts the parked and the still-trying together', async () => {
    fetchFailuresMock.mockResolvedValue(queue({ retrying: [RETRYING, RETRYING] }));
    renderScreen();

    await screen.findByText('Decide a whole group at once');
    // 'MKCOL' is the wording of the two STILL-TRYING rows; the parked one says
    // '507 over quota'. So both halves of the number are load-bearing: the
    // total is three only if `retrying` was handed over, and the match is two
    // only if those rows are the ones being matched.
    await userEvent.type(screen.getByLabelText('Error contains'), 'MKCOL');
    expect(screen.getByText('Matches 2 of the 3 here.')).toBeInTheDocument();
    const kinds = [...screen.getByLabelText('Kind').querySelectorAll('option')].map(
      (o) => o.textContent,
    );
    // And the kinds offered come from both sections: email is parked, file is
    // still trying.
    expect(kinds).toEqual(['Any kind', 'Email', 'Files']);
  });

  it('is not offered for a single failure, where the row’s own buttons say it better', async () => {
    fetchFailuresMock.mockResolvedValue(queue());
    renderScreen();

    await screen.findByText('acme-mail');
    expect(screen.queryByText('Decide a whole group at once')).not.toBeInTheDocument();
  });
});
