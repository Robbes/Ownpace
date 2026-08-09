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
  it('never lets a source it could not read count as "no changes"', async () => {
    fetchDecisions.mockResolvedValue({ decisions: [] });
    renderScreen();

    // The wording changed when the detectors were built (0027 T1 / 0028 T2,
    // T3) — "nothing can raise a decision yet" became false the day they
    // shipped. What must survive every rewrite is rule 9's distinction:
    // "nothing to ask about" and "could not look" are different sentences.
    expect(await screen.findByText(/run once a day/)).toBeInTheDocument();
    expect(screen.getByText(/blind spot/)).toBeInTheDocument();
    expect(screen.queryByText(/^Nothing has changed/)).not.toBeInTheDocument();
  });
});

describe('the shared-address question (workplan 0028 T3)', () => {
  const AMBIGUOUS = {
    ...PENDING,
    id: 'dec-2',
    category: 'shared_address_pattern',
    summary:
      'Do recipients jointly handle one shared mailbox at Sales (sales@acme.nl), or should it ' +
      'work as a distribution list where each recipient receives the mail?',
    subjectKey: 'sales@acme.nl',
    // No proposed default — not knowing which it is is why it was asked.
    proposedDefault: undefined,
  };

  it('offers §14.1’s two named answers instead of an accept button', async () => {
    fetchDecisions.mockResolvedValue({ decisions: [AMBIGUOUS] });
    renderScreen();

    expect(await screen.findByRole('button', { name: 'One shared mailbox' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'A distribution list' })).toBeInTheDocument();
    // A decision with no proposed default must not render an empty button.
    expect(screen.getByText(/Do recipients jointly handle/)).toBeInTheDocument();
  });

  it('sends the chosen pattern, which is what writes it back to the group', async () => {
    fetchDecisions.mockResolvedValue({ decisions: [AMBIGUOUS] });
    resolveDecision.mockResolvedValue({ ...AMBIGUOUS, status: 'resolved' });
    renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: 'A distribution list' }));

    await waitFor(() =>
      expect(resolveDecision).toHaveBeenCalledWith('dec-2', {
        action: 'set_shared_address_pattern',
        pattern: 'distribution_d',
      }),
    );
  });

  it('does not offer the pattern buttons on other categories', async () => {
    // They would be meaningless on a `new_mailbox` decision, and a button
    // that answers the wrong question is worse than no button.
    fetchDecisions.mockResolvedValue({ decisions: [PENDING] });
    renderScreen();

    await screen.findByRole('button', { name: 'create a mapping' });
    expect(screen.queryByRole('button', { name: 'One shared mailbox' })).not.toBeInTheDocument();
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
    // With everything answered, the pending section still states what an
    // empty queue does and does not mean.
    expect(screen.getByText(/blind spot/)).toBeInTheDocument();
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

describe('the effect of a completed action renders (0036 T2)', () => {
  it("shows the server's dismiss effect under the answered row, verbatim", async () => {
    fetchDecisions.mockResolvedValue({ decisions: [PENDING] });
    dismissDecision.mockImplementation(async () => {
      // The refetch after the action sees the row answered.
      fetchDecisions.mockResolvedValue({
        decisions: [{ ...PENDING, status: 'dismissed', resolvedAt: '2026-08-09T12:00:00Z' }],
      });
      return {
        ...PENDING,
        status: 'dismissed',
        effect:
          'Closed without acting; the detector may raise it again if the situation persists.',
      };
    });

    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /Terzijde|Dismiss/ }));

    // The row sits in "Already decided" with the effect sentence beneath it —
    // Decisions was the one surface whose answers vanished silently (both
    // editions' responses now carry the sentence).
    expect(
      await screen.findByText(/Closed without acting; the detector may raise it again/),
    ).toBeInTheDocument();
  });
});

