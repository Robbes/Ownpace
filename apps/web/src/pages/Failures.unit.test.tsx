// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
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
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FailuresResponse } from '@openmig/shared';

const { fetchFailuresMock } = vi.hoisted(() => ({ fetchFailuresMock: vi.fn() }));

vi.mock('../services/operating-service', () => ({
  fetchFailures: fetchFailuresMock,
  retryFailure: vi.fn(),
  acceptFailure: vi.fn(),
  DecisionRefusedError: class extends Error {},
}));

import Failures from './Failures';

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
      await screen.findByText(/next pass re-lists everything to reach this item again/),
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

