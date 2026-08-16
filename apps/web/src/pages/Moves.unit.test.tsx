// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * The move queue's aftermath section, pinned (0036 T2).
 *
 * Moves has rendered its "Already decided" half since #274 — the 0036 first
 * draft claimed otherwise and the fleet corrected it. This test exists so a
 * screen regressing to a silent success would be visible: each queue either
 * shows decided items or states why not, and this is Moves' proof.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MovesResponse } from '@openmig/shared';

const { fetchMovesMock, applyMoveMock, fetchMoveApplyReceiptMock, isSelfHostMock } = vi.hoisted(
  () => ({
    fetchMovesMock: vi.fn(),
    applyMoveMock: vi.fn(),
    fetchMoveApplyReceiptMock: vi.fn(),
    isSelfHostMock: vi.fn(() => true),
  }),
);

vi.mock('../services/operating-service', () => ({
  fetchMoves: fetchMovesMock,
  keepMove: vi.fn(),
  applyMove: applyMoveMock,
  fetchMoveApplyReceipt: fetchMoveApplyReceiptMock,
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
        <Moves receiptPollMs={10} />
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

  it('is offered in the managed edition too, where the outcome arrives on a RECEIPT', async () => {
    // The queued job (`run-apply-relocation`) exists now, so the button does
    // too — and the row must track the receipt to its terminal state rather
    // than pretend the 202 was an outcome. The removal has not happened when
    // the response arrives; saying "removed" then would be a false report
    // about the one thing this product destroys.
    isSelfHostMock.mockReturnValue(false);
    fetchMovesMock.mockResolvedValue(queue({ open: [RELOCATION] }));
    applyMoveMock.mockResolvedValue({
      mode: 'queued',
      receipt: { state: 'queued', requestedAt: '2026-08-16T08:00:00Z' },
    });
    // DETERMINISTIC, not fast: the poll's answer is held until the queued
    // state has been asserted. A resolved mock raced testing-library's own
    // 50ms polling on a slow runner — the 10ms queued window slipped between
    // its ticks and the assertion found only the terminal state (CI-only
    // flake, first seen on this test's first CI run).
    let releaseReceipt!: (r: unknown) => void;
    fetchMoveApplyReceiptMock.mockImplementation(
      () => new Promise((resolve) => { releaseReceipt = resolve as (r: unknown) => void; }),
    );
    renderScreen();

    const button = await screen.findByRole('button', { name: /Remove the old copy/ });
    fireEvent.click(button);
    fireEvent.click(await screen.findByRole('button', { name: /Confirm removal/ }));

    // Queued first — the honest state, held visible until asserted. The badge
    // renders from the 202 itself; the first POLL only fires after the seam's
    // 10ms, so wait for it before releasing its answer.
    expect(await screen.findByText(/[Qq]ueued/)).toBeInTheDocument();
    await waitFor(() => expect(fetchMoveApplyReceiptMock).toHaveBeenCalled());
    releaseReceipt({
      state: 'applied',
      kind: 'deleted',
      requestedAt: '2026-08-16T08:00:00Z',
      finishedAt: '2026-08-16T08:00:02Z',
    });
    expect(await screen.findByText(/[Rr]emoved/)).toBeInTheDocument();
    expect(fetchMoveApplyReceiptMock).toHaveBeenCalledWith('acme-mail', 'Docs/report.pdf');
  });

  it('a refused receipt reaches the row in the gate\'s own words', async () => {
    // The refusals only the worker can produce (the target cannot confirm the
    // arrival; the owner edited our copy) land on the receipt — and the row
    // must show the sentence, not a generic failure.
    isSelfHostMock.mockReturnValue(false);
    fetchMovesMock.mockResolvedValue(queue({ open: [RELOCATION] }));
    applyMoveMock.mockResolvedValue({
      mode: 'queued',
      receipt: { state: 'queued', requestedAt: '2026-08-16T08:00:00Z' },
    });
    fetchMoveApplyReceiptMock.mockResolvedValue({
      state: 'refused',
      code: 'relocation_unconfirmed',
      reason: 'The target does not have the relocated copy, whatever the ledger says.',
      requestedAt: '2026-08-16T08:00:00Z',
      finishedAt: '2026-08-16T08:00:02Z',
    });
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: /Remove the old copy/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Confirm removal/ }));

    expect(
      await screen.findByText(/does not have the relocated copy/),
    ).toBeInTheDocument();
  });

  it('ARMS before it acts — one click never removes anything', async () => {
    // The server's own words come back on the decision and are shown verbatim,
    // so the mock resolves the real shape rather than `undefined`: a mock that
    // does not answer what the caller awaits proves the wrong thing, and here
    // it threw inside the click handler while the assertions still passed.
    applyMoveMock.mockResolvedValue({
      mode: 'immediate',
      result: {
        status: 'ok',
        action: 'apply',
        naturalKeyHash: 'Docs/report.pdf',
        effect: 'The old copy has been removed from the target.',
      },
    });
    fetchMovesMock.mockResolvedValue(queue({ open: [RELOCATION] }));
    renderScreen();

    const button = await screen.findByRole('button', { name: /Remove the old copy/ });
    fireEvent.click(button);

    expect(applyMoveMock, 'the first click only arms it').not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: /Confirm removal/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Confirm removal/ }));
    expect(applyMoveMock).toHaveBeenCalledWith('acme-mail', 'Docs/report.pdf');
    // And the outcome reaches the screen — the row stops offering the action
    // and says what happened, in the server's words.
    expect(
      await screen.findByText('The old copy has been removed from the target.'),
    ).toBeInTheDocument();
  });

  it('says a rename is a rename, instead of printing a SHA-256 at the operator', async () => {
    // "Docs → Docs" says nothing about what changed, so this row used to render
    // `toNaturalKeyHash` in the destination's place. That is a sha256 of the new
    // path — `fileNaturalKeyHash` — not the new path, so the row read
    // `Docs → 9f2c…` and named nothing anybody could recognise.
    //
    // The old test could not see it, because its fixture put `Docs/summary.pdf`
    // in that field: a hash-shaped hole filled with a path-shaped string, which
    // made a row that prints a hex digest look like one that prints a filename.
    // This one uses what the field actually carries.
    const HASH = '9f2c1b6a4e7d0c3f8a5b2e9d6c1f4a7b0e3d6c9f2a5b8e1d4c7f0a3b6e9d2c5f';
    fetchMovesMock.mockResolvedValue(
      queue({ open: [{ ...RELOCATION, toNaturalKeyHash: HASH }] }),
    );
    renderScreen();

    expect(await screen.findByText('renamed')).toBeInTheDocument();
    expect(screen.queryByText(HASH), 'never the digest').not.toBeInTheDocument();
    expect(screen.queryByText(HASH.slice(0, 12), { exact: false })).not.toBeInTheDocument();
  });

  it('still shows the destination folder for a move that changed one', async () => {
    // The other half: a real move has somewhere to point at, and hiding it
    // would make the queue unusable for the case it was built for.
    fetchMovesMock.mockResolvedValue(
      queue({ open: [{ ...RELOCATION, to: 'Archive/2026', toNaturalKeyHash: 'h-new' }] }),
    );
    renderScreen();

    expect(await screen.findByText('Archive/2026')).toBeInTheDocument();
    expect(screen.queryByText('renamed')).not.toBeInTheDocument();
  });
});
