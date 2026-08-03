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

const { fetchDecisions, resolveDecision, dismissDecision, fetchPresets, setPreset, auth } =
  vi.hoisted(() => ({
    fetchDecisions: vi.fn(),
    resolveDecision: vi.fn(),
    dismissDecision: vi.fn(),
    fetchPresets: vi.fn(),
    setPreset: vi.fn(),
    auth: { user: { id: 'u', email: 'owner@acme.nl', name: 'Owner', role: 'owner' } },
  }));

vi.mock('../services/operating-service', () => ({
  fetchDriftDecisions: fetchDecisions,
  resolveDriftDecision: resolveDecision,
  dismissDriftDecision: dismissDecision,
  fetchDecisionPresets: fetchPresets,
  setDecisionPreset: setPreset,
}));

vi.mock('../stores/auth-store', () => ({ useAuthStore: () => auth }));

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
  auth.user = { id: 'u', email: 'owner@acme.nl', name: 'Owner', role: 'owner' };
  // No preset expressed: the default, and what most tenants will have.
  fetchPresets.mockResolvedValue({ presets: [], defaultAction: 'ask' });
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

/**
 * Standing answers (workplan 0028 T5).
 *
 * The control is on THIS screen rather than in settings on purpose: the
 * question "why is this queue quiet?" and the answer "because you told it to
 * answer that category itself" belong in the same place.
 */
describe('the standing-answer control', () => {
  it('shows ASK when the tenant has expressed no preference', async () => {
    fetchDecisions.mockResolvedValue({ decisions: [] });
    renderScreen();

    const select = (await screen.findByLabelText(/When a mailbox appears/)) as HTMLSelectElement;
    // A tenant that never chose must be asked, not quietly auto-answered.
    await waitFor(() => expect(select.value).toBe('ask'));
  });

  it('shows what the tenant actually set', async () => {
    fetchDecisions.mockResolvedValue({ decisions: [] });
    fetchPresets.mockResolvedValue({
      presets: [{ category: 'new_mailbox', action: 'auto' }],
      defaultAction: 'ask',
    });
    renderScreen();

    const select = (await screen.findByLabelText(/When a mailbox appears/)) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('auto'));
  });

  it('saves the choice', async () => {
    fetchDecisions.mockResolvedValue({ decisions: [] });
    setPreset.mockResolvedValue({ category: 'new_mailbox', action: 'auto' });
    renderScreen();

    // The control stays disabled until the CURRENT preference is known — you
    // should not be able to change a setting you cannot yet see.
    const select = await screen.findByLabelText(/When a mailbox appears/);
    await waitFor(() => expect(select).toBeEnabled());
    await userEvent.selectOptions(select, 'auto');

    await waitFor(() => expect(setPreset).toHaveBeenCalledWith('new_mailbox', 'auto'));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('puts the control back when the save fails', async () => {
    fetchDecisions.mockResolvedValue({ decisions: [] });
    setPreset.mockRejectedValue(new Error('nope'));
    renderScreen();

    const select = await screen.findByLabelText(/When a mailbox appears/);
    await waitFor(() => expect(select).toBeEnabled());
    await userEvent.selectOptions(select, 'auto');

    // Leaving 'auto' on screen would show a standing answer nobody has — and
    // this one governs whether a whole category interrupts anybody.
    await waitFor(() =>
      expect((screen.getByLabelText(/When a mailbox appears/) as HTMLSelectElement).value).toBe('ask'),
    );
  });

  it('is read-only for a member, and says who can change it', async () => {
    auth.user = { id: 'u2', email: 'lid@acme.nl', name: 'Lid', role: 'member' };
    fetchDecisions.mockResolvedValue({ decisions: [] });
    renderScreen();

    expect(await screen.findByLabelText(/When a mailbox appears/)).toBeDisabled();
    expect(screen.getByText('An owner or admin sets these.')).toBeInTheDocument();
  });

  it('SAYS SO when the presets could not be read', async () => {
    // A queue that answers some categories without showing which is exactly
    // the unexplained silence this feature exists to prevent (rule 9).
    fetchDecisions.mockResolvedValue({ decisions: [] });
    fetchPresets.mockRejectedValue(new Error('boom'));
    renderScreen();

    expect(await screen.findByText(/may be answering some categories/)).toBeInTheDocument();
  });

  it('does not hide the queue when the presets fail', async () => {
    fetchDecisions.mockResolvedValue({ decisions: [PENDING] });
    fetchPresets.mockRejectedValue(new Error('boom'));
    renderScreen();

    // Two independent reads: losing the preferences must not lose the
    // decisions themselves.
    expect(await screen.findByText(new RegExp(PENDING.summary.slice(0, 30)))).toBeInTheDocument();
  });
});
