// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The drift decision queue's screen skeleton (workplan 0028 T1).
 *
 * The load-bearing pin is the EMPTY state: no detector exists yet, so the
 * screen must say "not watched yet", never "no changes" (rule 9). The rest:
 * a pending decision renders the server's summary VERBATIM with the
 * detector's proposed default as the button, resolve/dismiss hit the API,
 * and a refusal renders the server's words.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { fetchDecisions, resolveDecision, dismissDecision } = vi.hoisted(() => ({
  fetchDecisions: vi.fn(),
  resolveDecision: vi.fn(),
  dismissDecision: vi.fn(),
}));

vi.mock('../services/operating-service', () => ({
  fetchDriftDecisions: fetchDecisions,
  resolveDriftDecision: resolveDecision,
  dismissDriftDecision: dismissDecision,
}));

import Decisions from './Decisions';

const PENDING = {
  id: 'dec-1',
  tenantId: 'acme',
  category: 'new_mailbox',
  summary: 'A mailbox appeared on the source that no mapping covers: nieuw@acme.nl',
  detail: { address: 'nieuw@acme.nl' },
  proposedDefault: 'create a mapping',
  subjectKey: 'nieuw@acme.nl',
  status: 'pending',
  createdAt: '2026-08-03T08:00:00.000Z',
};

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Decisions />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the honest empty state', () => {
  it('says "not watched yet", never "no changes" — no detector exists', async () => {
    fetchDecisions.mockResolvedValue({ decisions: [] });
    renderScreen();

    expect(
      await screen.findByText(/nothing can raise a decision yet/),
    ).toBeInTheDocument();
    expect(screen.getByText(/not watched yet/)).toBeInTheDocument();
  });
});

describe('a pending decision', () => {
  it("renders the server's summary verbatim, with the proposed default as the button", async () => {
    fetchDecisions.mockResolvedValue({ decisions: [PENDING] });
    renderScreen();

    expect(
      await screen.findByText(
        'A mailbox appeared on the source that no mapping covers: nieuw@acme.nl',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('New mailbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'create a mapping' })).toBeInTheDocument();
  });

  it('accepting the default resolves and refreshes', async () => {
    fetchDecisions.mockResolvedValue({ decisions: [PENDING] });
    resolveDecision.mockResolvedValue({ ...PENDING, status: 'resolved' });
    renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: 'create a mapping' }));

    await waitFor(() =>
      expect(resolveDecision).toHaveBeenCalledWith('dec-1', {
        action: 'accept_default',
        proposedDefault: 'create a mapping',
      }),
    );
    await waitFor(() => expect(fetchDecisions).toHaveBeenCalledTimes(2));
  });

  it("a refusal renders the server's words verbatim", async () => {
    fetchDecisions.mockResolvedValue({ decisions: [PENDING] });
    dismissDecision.mockRejectedValue({
      response: {
        data: { message: 'This decision does not exist or has already been answered.' },
      },
    });
    renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));

    expect(
      await screen.findByText('This decision does not exist or has already been answered.'),
    ).toBeInTheDocument();
  });
});

describe('the answered section', () => {
  it('shows resolved decisions with the localized status word', async () => {
    fetchDecisions.mockResolvedValue({
      decisions: [
        {
          ...PENDING,
          id: 'dec-2',
          status: 'resolved',
          resolvedAt: '2026-08-03T09:00:00.000Z',
          resolvedBy: 'user-owner',
        },
      ],
    });
    renderScreen();

    expect(await screen.findByText('Decided')).toBeInTheDocument();
    // With everything answered, the pending section still tells the truth
    // about the missing detectors.
    expect(screen.getByText(/nothing can raise a decision yet/)).toBeInTheDocument();
  });
});
