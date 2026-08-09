// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * The move queue's aftermath section, pinned (0036 T2).
 *
 * Moves has rendered its "Already decided" half since #274 — the 0036 first
 * draft claimed otherwise and the fleet corrected it. This test exists so a
 * screen regressing to a silent success would be visible: each queue either
 * shows decided items or states why not, and this is Moves' proof.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MovesResponse } from '@openmig/shared';

const { fetchMovesMock } = vi.hoisted(() => ({ fetchMovesMock: vi.fn() }));

vi.mock('../services/operating-service', () => ({
  fetchMoves: fetchMovesMock,
  keepMove: vi.fn(),
  DecisionRefusedError: class extends Error {},
}));

import Moves from './Moves';

const MOVE = {
  naturalKeyHash: 'h-m1',
  domain: 'email' as const,
  from: 'INBOX/Projects',
  to: 'Archive/2026',
};

const GUIDANCE = {
  keep: 'Leave the copy where it is.',
  byHand: 'Move it yourself on the new system.',
  doNothing: 'It stays listed here.',
};

function queue(over: Partial<MovesResponse['x']> = {}): MovesResponse {
  return {
    'acme-mail': {
      migrationStatus: 'active',
      open: [],
      acknowledged: [],
      whatThisMeans: 'The old system reorganised these after we copied them.',
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
        <Moves />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the aftermath section (0036 T2 pin)', () => {
  it('renders "Already decided" with the acknowledged items', async () => {
    fetchMovesMock.mockResolvedValue(
      queue({
        acknowledged: [{ ...MOVE, acknowledgedAt: '2026-08-01T00:00:00Z' }],
      }),
    );
    renderScreen();

    expect(
      await screen.findByRole('heading', { name: /Already decided\s*\(1\)/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('INBOX/Projects')).toBeInTheDocument();
  });

  it('states the empty aftermath instead of hiding the section', async () => {
    fetchMovesMock.mockResolvedValue(queue());
    renderScreen();

    expect(await screen.findByText('Nothing has been decided yet.')).toBeInTheDocument();
  });
});
