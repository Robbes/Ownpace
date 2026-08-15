// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * The move queue's aftermath section, pinned (0036 T2).
 *
 * Moves has rendered its "Already decided" half since #274 — the 0036 first
 * draft claimed otherwise and the fleet corrected it. This test exists so a
 * screen regressing to a silent success would be visible: each queue either
 * shows decided items or states why not, and this is Moves' proof.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MovesResponse } from '@openmig/shared';

const { fetchMovesMock, applyMoveMock, isSelfHostMock } = vi.hoisted(() => ({
  fetchMovesMock: vi.fn(),
  applyMoveMock: vi.fn(),
  isSelfHostMock: vi.fn(() => true),
}));

vi.mock('../services/operating-service', () => ({
  fetchMoves: fetchMovesMock,
  keepMove: vi.fn(),
  applyMove: applyMoveMock,
  DecisionRefusedError: class extends Error {},
}));
vi.mock('../services/edition', () => ({ isSelfHost: isSelfHostMock }));

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
  isSelfHostMock.mockReturnValue(true);
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

/**
 * The destructive action, and — mostly — its absence (ADR-0030).
 *
 * `apply` removes the target's OLD copy, and it is admissible only for a
 * RELOCATION: a move that changed the item's natural key, so the same bytes are
 * already on the target under the new one. Every other move must not offer it
 * at all, because for those there is nothing to point at and removing the copy
 * would simply destroy it.
 */
describe('the relocation apply button', () => {
  const RELOCATION = {
    naturalKeyHash: 'Docs/report.pdf',
    domain: 'file' as const,
    from: 'Docs',
    to: 'Docs',
    toNaturalKeyHash: 'Docs/summary.pdf',
  };

  it('is offered for a relocation', async () => {
    fetchMovesMock.mockResolvedValue(queue({ open: [RELOCATION] }));
    renderScreen();

    expect(await screen.findByRole('button', { name: /Remove the old copy/ })).toBeInTheDocument();
  });

  it('is NOT offered for a move that kept its key — there is nothing to point at', async () => {
    // Every mail and calendar move. Removing the target copy on the strength of
    // one of these would destroy the only copy under our control.
    fetchMovesMock.mockResolvedValue(queue({ open: [MOVE] }));
    renderScreen();

    expect(await screen.findByRole('button', { name: /Leave it where it is/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove the old copy/ })).not.toBeInTheDocument();
  });

  it('is NOT offered in the managed edition, where the action does not exist yet', async () => {
    // Its destructive path runs through a queued job and a receipt, and there
    // is no such job for this action. A button that 404s is worse than none.
    isSelfHostMock.mockReturnValue(false);
    fetchMovesMock.mockResolvedValue(queue({ open: [RELOCATION] }));
    renderScreen();

    expect(await screen.findByRole('button', { name: /Leave it where it is/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove the old copy/ })).not.toBeInTheDocument();
  });

  it('ARMS before it acts — one click never removes anything', async () => {
    fetchMovesMock.mockResolvedValue(queue({ open: [RELOCATION] }));
    renderScreen();

    const button = await screen.findByRole('button', { name: /Remove the old copy/ });
    fireEvent.click(button);

    expect(applyMoveMock, 'the first click only arms it').not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: /Confirm removal/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Confirm removal/ }));
    expect(applyMoveMock).toHaveBeenCalledWith('acme-mail', 'Docs/report.pdf');
  });

  it('shows the NEW KEY for a rename, where both folders read the same', async () => {
    // "Docs → Docs" says nothing about what changed.
    fetchMovesMock.mockResolvedValue(queue({ open: [RELOCATION] }));
    renderScreen();

    expect(await screen.findByText('Docs/summary.pdf')).toBeInTheDocument();
  });
});
