// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The drift decision queue's screen skeleton (workplan 0028 T1).
 *
 * The load-bearing pin is the EMPTY state: no detector exists yet, so the
 * screen must say "not watched yet", never "no changes" (rule 9). The rest:
 * a pending decision says its question in the reader's language, built in
 * shared from its category and detail (the owner, 2026-10-18), with the
 * stored summary as served where it cannot be built; a new mailbox's button
 * says it records; resolve/dismiss hit the API, and a refusal renders the
 * server's words.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

const {
  fetchDecisions,
  resolveDecision,
  dismissDecision,
  fetchPresets,
  setPreset,
  fetchAttentionMock,
  auth,
} =
  vi.hoisted(() => ({
    fetchDecisions: vi.fn(),
    fetchAttentionMock: vi.fn(),
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
  fetchAttention: fetchAttentionMock,
}));

vi.mock('../stores/auth-store', () => ({ useAuthStore: () => auth }));

const { editionFlag } = vi.hoisted(() => ({ editionFlag: { selfhost: false } }));
vi.mock('../services/edition', () => ({
  isSelfHost: () => editionFlag.selfhost,
  // The summary above the queue links OUT to each queue's screen, and the
  // edition decides those URLs. Mocked to the managed shape, which is the
  // shape this file's other assertions already assume.
  queueScreenPath: (queue: string, mappingId: string) => `/mappings/${mappingId}/${queue}`,
}));

import Decisions from './Decisions.tsx';
import { LocaleProvider } from '../i18n/index.tsx';

/** What the page says about PENDING, in each language (the owner's words, 2026-10-18). */
const NEW_MAILBOX_EN =
  'nieuw@acme.nl is on the old system, and no migration covers it. Nothing is copied from it.';
const NEW_MAILBOX_NL =
  'nieuw@acme.nl staat op het oude systeem, en geen migratie omvat het. Er wordt niets van gemigreerd.';

const PENDING = {
  id: 'dec-1',
  tenantId: 'acme',
  category: 'new_mailbox',
  // An old row's stored English: the page builds its sentence from the
  // detail instead, so this is only what a fallback would show.
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
      {/* A Router, since the summary above the queue LINKS to each queue's
          screen. Without one `<Link>` throws and the whole page fails to
          render — which is a real property of this screen now, not a testing
          detail: it is mounted inside the app's router in every real use. */}
      <MemoryRouter>
        <Decisions />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  editionFlag.selfhost = false;
  vi.clearAllMocks();
  auth.user = { id: 'u', email: 'owner@acme.nl', name: 'Owner', role: 'owner' };
  // No preset expressed: the default, and what most tenants will have.
  fetchPresets.mockResolvedValue({ presets: [], defaultAction: 'ask' });
  // Nothing waiting anywhere, so the summary above the queue stays out of
  // the way of this file's assertions. The one test that cares overrides it.
  fetchAttentionMock.mockResolvedValue({ mappings: [] });
});

describe('the tab is called Attention and now answers to it', () => {
  it('shows what is waiting in EVERY queue, above the drift queue it used to be', async () => {
    // The defect this screen shipped with: it rendered `/api/decisions` and
    // nothing else, so an owner whose digest said "34 items that could not be
    // copied" opened the tab it pointed at and found it empty (owner report,
    // 2026-09-14).
    fetchDecisions.mockResolvedValue({ decisions: [] });
    fetchAttentionMock.mockResolvedValue({
      mappings: [
        {
          mappingId: '0cc9a844-4075-4d65-a562-374df8299b77',
          name: 'Gmail to Nextcloud',
          pendingDecisions: 0,
          deletionsWaiting: 0,
          movesWaiting: 0,
          failuresWaiting: 34,
          readyForCutover: false,
          autoApplied: 0,
          sharingOpen: 0,
        },
      ],
    });
    renderScreen();

    expect(await screen.findByText('Gmail to Nextcloud')).toBeVisible();
    expect(screen.getByText('34')).toBeVisible();
    expect(screen.getByText(/items that could not be copied/).closest('a')).toHaveAttribute(
      'href',
      '/mappings/0cc9a844-4075-4d65-a562-374df8299b77/failures',
    );
  });

  it("keeps the drift queue readable when the summary read fails", async () => {
    // Two reads, separately: the drift queue being answerable says nothing
    // about the 34 files that are not, and neither must empty the other.
    fetchDecisions.mockResolvedValue({ decisions: [] });
    fetchAttentionMock.mockRejectedValue(new Error('connection terminated'));
    renderScreen();

    expect(await screen.findByText(/could not be loaded/)).toBeVisible();
    // The standing-answers control below it still rendered.
    expect(screen.getByText(/When a mailbox appears/)).toBeInTheDocument();
  });
});

describe('the honest empty state', () => {
  it('never lets a source it could not read count as "no changes"', async () => {
    fetchDecisions.mockResolvedValue({ decisions: [] });
    renderScreen();

    // The wording changed when the detectors were built (0027 T1 / 0028 T2,
    // T3) — "nothing can raise a decision yet" became false the day they
    // shipped. What must survive every rewrite is rule 9's distinction:
    // "nothing to ask about" and "could not look" are different sentences.
    expect(await screen.findByText(/once a day/)).toBeInTheDocument();
    expect(screen.getByText(/could not look/)).toBeInTheDocument();
    // Plain words: nothing about watchers or blind spots (UX sweep, 2026-10-17).
    expect(screen.queryByText(/watcher|blind spot/)).not.toBeInTheDocument();
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
    // A row stored before reasons were kept: asked without one.
    detail: { address: 'sales@acme.nl', displayName: 'Sales' },
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
    expect(
      screen.getByText(
        'Do the people who get mail at Sales (sales@acme.nl) read it together in one shared mailbox, ' +
          'or should each of them get their own copy (a distribution list)? We could not tell from the old system.',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(3 + 1); // two answers, Dismiss, and the as-of Refresh
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

    await screen.findByRole('button', { name: 'Noted, I will handle it' });
    expect(screen.queryByRole('button', { name: 'One shared mailbox' })).not.toBeInTheDocument();
  });
});

describe('a pending decision', () => {
  it('says a new mailbox in the owner’s sentence, with a button that records, never one that promises a mapping', async () => {
    fetchDecisions.mockResolvedValue({ decisions: [PENDING] });
    renderScreen();

    expect(await screen.findByText(NEW_MAILBOX_EN)).toBeInTheDocument();
    expect(screen.getByText('New mailbox')).toBeInTheDocument();
    // The row stored "create a mapping"; pressing it only ever recorded the
    // answer, so the button says what pressing does (the owner, 2026-10-18).
    expect(screen.getByRole('button', { name: 'Noted, I will handle it' })).toBeInTheDocument();
    expect(screen.queryByText(/mapping/i)).not.toBeInTheDocument();
  });

  it('accepting the default resolves and refreshes', async () => {
    fetchDecisions.mockResolvedValue({ decisions: [PENDING] });
    resolveDecision.mockResolvedValue({ ...PENDING, status: 'resolved' });
    renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: 'Noted, I will handle it' }));

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
    expect(screen.getByText(/could not look/)).toBeInTheDocument();
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

    expect(await screen.findByText(/some categories may be answered/)).toBeInTheDocument();
  });

  it('does not hide the queue when the presets fail', async () => {
    fetchDecisions.mockResolvedValue({ decisions: [PENDING] });
    fetchPresets.mockRejectedValue(new Error('boom'));
    renderScreen();

    // Two independent reads: losing the preferences must not lose the
    // decisions themselves.
    expect(await screen.findByText(NEW_MAILBOX_EN)).toBeInTheDocument();
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

describe('the as-of label (0036 T1)', () => {
  it('states when the stalest decision surface was read', async () => {
    fetchDecisions.mockResolvedValue({ decisions: [] });
    renderScreen();

    expect(await screen.findByText(/^Updated/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Refresh/ })).toBeInTheDocument();
  });
});

describe('the appliance operator is not locked out (0038 T4)', () => {
  it('selfhost: the preset select is ENABLED with no role caption — one operator, no roles', async () => {
    editionFlag.selfhost = true;
    auth.user = null as never; // the appliance has no accounts
    fetchDecisions.mockResolvedValue({ decisions: [] });
    fetchPresets.mockResolvedValue({ presets: [], defaultAction: 'ask' });

    renderScreen();

    const select = await screen.findByRole('combobox');
    // Enabled once the presets query resolves — the role gate is gone.
    await waitFor(() => expect(select).toBeEnabled());
    expect(screen.queryByText('An owner or admin sets these.')).not.toBeInTheDocument();
  });

  it('a failed preset save reverts to the stored value AND says why', async () => {
    fetchDecisions.mockResolvedValue({ decisions: [] });
    fetchPresets.mockResolvedValue({ presets: [], defaultAction: 'ask' });
    setPreset.mockRejectedValue({
      response: { data: { message: 'Only the owner can change standing answers.' } },
    });

    renderScreen();

    const select = await screen.findByRole('combobox');
    await waitFor(() => expect(select).toBeEnabled());
    await userEvent.selectOptions(select, 'auto');

    // The silent snap-back now names its reason (server words, verbatim)...
    expect(
      await screen.findByText('Only the owner can change standing answers.'),
    ).toBeInTheDocument();
    // ...and the dropdown shows what is actually stored.
    expect((select as HTMLSelectElement).value).toBe('ask');
  });
});

describe('answered rows tell their whole story (0038 T5)', () => {
  it('an auto-resolved row lets its chip say it, with the address behind a disclosure', async () => {
    // The chip already says "Decided by preset"; an answer line under it
    // printed the preset's JSON and its internal name (UX sweep, 2026-10-17).
    fetchDecisions.mockResolvedValue({
      decisions: [
        {
          ...PENDING,
          status: 'auto_resolved',
          resolvedAt: '2026-08-09T08:00:00Z',
          resolution: {
            closedBy: 'policy_preset',
            preset: { category: 'new_mailbox', action: 'auto' },
            subject: 'nieuw@acme.nl',
          },
          resolvedBy: 'preset:new_mailbox',
        },
      ],
    });

    renderScreen();

    expect(await screen.findByText('Decided by preset')).toBeInTheDocument();
    expect(screen.queryByText(/Answer:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/preset:new_mailbox|policy_preset|\{/)).not.toBeInTheDocument();
    // The facts behind a per-row disclosure, in words: the address, labelled.
    expect(screen.getByText('Details')).toBeInTheDocument();
    expect(screen.getByText('Address')).toBeInTheDocument();
    expect(screen.getByText('nieuw@acme.nl')).toBeInTheDocument();
  });

  it('dismissed is NOT green — set-aside wears a neutral chip', async () => {
    fetchDecisions.mockResolvedValue({
      decisions: [
        { ...PENDING, status: 'dismissed', resolvedAt: '2026-08-09T08:00:00Z' },
      ],
    });

    renderScreen();

    const chip = await screen.findByText('Dismissed');
    expect(chip.className).not.toContain('green');
    expect(chip.className).toContain('bg-gray-100');
  });
});


describe('the organisation reaches the page, not just the endpoint', () => {
  it('renders what is waiting on the tenant when no migration reports', async () => {
    // A tenant whose every migration is `done` is the one nobody is watching,
    // and its decisions used to reach the digest and never this screen.
    fetchAttentionMock.mockResolvedValue({ mappings: [], tenant: { pendingDecisions: 2 } });
    renderScreen();
    expect(await screen.findByText('Your organisation')).toBeVisible();
    expect(screen.getByText('2')).toBeVisible();
  });

  it('passes no tenant along when the server sent none', async () => {
    fetchAttentionMock.mockResolvedValue({ mappings: [] });
    renderScreen();
    expect(await screen.findByText(/Nothing is waiting/)).toBeVisible();
    expect(screen.queryByText('Your organisation')).not.toBeInTheDocument();
  });
});

/**
 * THE ANSWER IN WORDS (UX sweep, 2026-10-17). "Already decided" printed the
 * recorded answer as JSON in a code font (`{"action":"accept_default",…}`),
 * the detail fold listed internal keys, and "by" named an identity-provider
 * id. The answer is now said through the dictionary, the fold holds the
 * address and the name only, and "by" names a person only when it is an
 * address somebody can read.
 */
describe('the answer, in words', () => {
  const ANSWERED = {
    ...PENDING,
    id: 'dec-9',
    status: 'resolved',
    resolvedAt: '2026-08-09T08:00:00Z',
  };

  it('an accepted proposal reads "Answer: Accepted the proposal", never JSON', async () => {
    fetchDecisions.mockResolvedValue({
      decisions: [
        {
          ...ANSWERED,
          resolution: { action: 'accept_default', proposedDefault: 'create a mapping' },
          resolvedBy: 'marieke@acme.nl',
        },
      ],
    });
    renderScreen();

    const line = (await screen.findByText(/Answer:/)).closest('p')!;
    expect(line).toHaveTextContent('Answer: Accepted the proposal by marieke@acme.nl');
    expect(line.textContent).not.toMatch(/[{}"]|accept_default/);
    expect(line.querySelector('.font-mono')).toBeNull();
  });

  it('in Dutch it reads "Voorstel aangenomen"', async () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    try {
      fetchDecisions.mockResolvedValue({
        decisions: [{ ...ANSWERED, resolution: { action: 'accept_default' }, resolvedBy: 'marieke@acme.nl' }],
      });
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <LocaleProvider>
          <QueryClientProvider client={qc}>
            <MemoryRouter>
              <Decisions />
            </MemoryRouter>
          </QueryClientProvider>
        </LocaleProvider>,
      );
      const line = (await screen.findByText(/Antwoord:/)).closest('p')!;
      expect(line).toHaveTextContent('Antwoord: Voorstel aangenomen door marieke@acme.nl');
    } finally {
      window.localStorage.removeItem('ownpace.locale');
    }
  });

  it('a shared-address answer names the pattern in words', async () => {
    fetchDecisions.mockResolvedValue({
      decisions: [
        {
          ...ANSWERED,
          category: 'shared_address_pattern',
          resolution: { action: 'set_shared_address_pattern', pattern: 'shared_s' },
        },
      ],
    });
    renderScreen();

    expect((await screen.findByText(/Answer:/)).closest('p')).toHaveTextContent('Answer: One shared mailbox');
  });

  it('a preset answer names the standing answer, as the panel above does', async () => {
    fetchDecisions.mockResolvedValue({
      decisions: [{ ...ANSWERED, resolution: { preset: { category: 'new_mailbox', action: 'auto' } } }],
    });
    renderScreen();

    expect((await screen.findByText(/Answer:/)).closest('p')).toHaveTextContent(
      'Answer: Your standing answer',
    );
  });

  it('in Dutch a preset answer is "Uw vaste antwoord"', async () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    try {
      fetchDecisions.mockResolvedValue({
        decisions: [{ ...ANSWERED, resolution: { preset: { category: 'new_mailbox', action: 'auto' } } }],
      });
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <LocaleProvider>
          <QueryClientProvider client={qc}>
            <MemoryRouter>
              <Decisions />
            </MemoryRouter>
          </QueryClientProvider>
        </LocaleProvider>,
      );
      expect((await screen.findByText(/Antwoord:/)).closest('p')).toHaveTextContent(
        'Antwoord: Uw vaste antwoord',
      );
    } finally {
      window.localStorage.removeItem('ownpace.locale');
    }
  });

  it('an answer of any other shape gets no line, rather than its JSON, but still says who', async () => {
    fetchDecisions.mockResolvedValue({
      decisions: [{ ...ANSWERED, resolution: { action: 'acknowledged' }, resolvedBy: 'marieke@acme.nl' }],
    });
    renderScreen();

    await screen.findByText('Decided');
    expect(screen.queryByText(/Answer:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/acknowledged/)).not.toBeInTheDocument();
    // Who gave it is still part of the whole story (0038 T5).
    expect(screen.getByText('Decided by marieke@acme.nl')).toBeInTheDocument();
  });

  it('in Dutch the one who decided reads "Besloten door …"', async () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    try {
      fetchDecisions.mockResolvedValue({
        decisions: [{ ...ANSWERED, resolution: { action: 'acknowledged' }, resolvedBy: 'marieke@acme.nl' }],
      });
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <LocaleProvider>
          <QueryClientProvider client={qc}>
            <MemoryRouter>
              <Decisions />
            </MemoryRouter>
          </QueryClientProvider>
        </LocaleProvider>,
      );
      expect(await screen.findByText('Besloten door marieke@acme.nl')).toBeInTheDocument();
    } finally {
      window.localStorage.removeItem('ownpace.locale');
    }
  });

  it('with no answer in words and no address, there is no "Decided by" line', async () => {
    fetchDecisions.mockResolvedValue({
      decisions: [{ ...ANSWERED, resolution: { action: 'acknowledged' }, resolvedBy: '312987465012938475' }],
    });
    renderScreen();

    await screen.findByText('Decided');
    expect(screen.queryByText(/Decided by|312987465012938475/)).not.toBeInTheDocument();
  });

  it('an answer in words carries "by" on its own line, not a second "Decided by"', async () => {
    fetchDecisions.mockResolvedValue({
      decisions: [{ ...ANSWERED, resolution: { action: 'accept_default' }, resolvedBy: 'marieke@acme.nl' }],
    });
    renderScreen();

    await screen.findByText(/Answer:/);
    expect(screen.queryByText(/Decided by/)).not.toBeInTheDocument();
  });

  it('"by" names nobody when the server holds an id rather than an address', async () => {
    fetchDecisions.mockResolvedValue({
      decisions: [{ ...ANSWERED, resolution: { action: 'accept_default' }, resolvedBy: '312987465012938475' }],
    });
    renderScreen();

    const line = (await screen.findByText(/Answer:/)).closest('p')!;
    expect(line).toHaveTextContent('Answer: Accepted the proposal');
    expect(line.textContent).not.toMatch(/ by |312987465012938475/);
  });

  it('the fold holds the address and the name, labelled, and nothing internal', async () => {
    fetchDecisions.mockResolvedValue({
      decisions: [
        {
          ...ANSWERED,
          detail: {
            address: 'sales@acme.nl',
            displayName: 'Sales',
            sourceGroupId: 'g-123',
            sourceConnectionId: 'c-456',
          },
        },
      ],
    });
    renderScreen();

    await screen.findByText('Details');
    expect(screen.getByText('Address')).toBeInTheDocument();
    expect(screen.getByText('sales@acme.nl')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Sales')).toBeInTheDocument();
    expect(screen.queryByText(/sourceGroupId|g-123|c-456/)).not.toBeInTheDocument();
  });

  it('no fold at all when neither the address nor the name is there', async () => {
    fetchDecisions.mockResolvedValue({
      decisions: [{ ...ANSWERED, detail: { count: 4 } }],
    });
    renderScreen();

    await screen.findByText('Decided');
    expect(screen.queryByText('Details')).not.toBeInTheDocument();
  });
});

/**
 * THE QUESTION IN THE READER'S LANGUAGE (the owner's answer of 2026-10-18 on
 * `queues-decisions-server-english`). *Wacht op u* showed Dutch chips above
 * the detectors' English sentences, with an English *Create a mapping…*
 * button. The sentence is built in shared from the category and the detail,
 * in both languages; the stored English shows, marked as English, only where
 * it cannot be built.
 */
describe('the question in the reader’s language', () => {
  function renderIn(locale: 'en' | 'nl') {
    window.localStorage.setItem('ownpace.locale', locale);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <LocaleProvider>
        <QueryClientProvider client={qc}>
          <MemoryRouter>
            <Decisions />
          </MemoryRouter>
        </QueryClientProvider>
      </LocaleProvider>,
    );
  }

  afterEach(() => window.localStorage.removeItem('ownpace.locale'));

  it('a Dutch reader reads a new mailbox in Dutch, with the Dutch button', async () => {
    fetchDecisions.mockResolvedValue({ decisions: [PENDING] });
    renderIn('nl');

    const sentence = await screen.findByText(NEW_MAILBOX_NL);
    expect(sentence).not.toHaveAttribute('lang');
    expect(screen.getByRole('button', { name: 'Genoteerd, ik regel het zelf' })).toBeInTheDocument();
    expect(screen.queryByText(/is on the old system|mapping/i)).not.toBeInTheDocument();
  });

  it('a Dutch reader reads the shared-address question in Dutch, with its Dutch reason', async () => {
    fetchDecisions.mockResolvedValue({
      decisions: [
        {
          ...PENDING,
          id: 'dec-2',
          category: 'shared_address_pattern',
          summary: 'Do the people who get mail at info@acme.nl read it together …',
          detail: {
            address: 'info@acme.nl',
            reason: 'the source did not say',
            reasonNl: 'de bron gaf het niet aan',
          },
          proposedDefault: undefined,
        },
      ],
    });
    renderIn('nl');

    expect(
      await screen.findByText(
        'Lezen de mensen die mail krijgen op info@acme.nl die samen in één gedeeld postvak, ' +
          'of moet ieder een eigen kopie krijgen (een distributielijst)? ' +
          'Dat konden we niet zien op het oude systeem: de bron gaf het niet aan.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eén gedeeld postvak' })).toBeInTheDocument();
    expect(screen.queryByText(/the source did not say/)).not.toBeInTheDocument();
  });

  it('a category nothing can say shows its stored English, marked as English', async () => {
    fetchDecisions.mockResolvedValue({
      decisions: [
        {
          ...PENDING,
          id: 'dec-3',
          category: 'quota',
          summary: 'The mailbox for sophie@acme.nl is 98% full',
          detail: { usedGb: 49 },
          proposedDefault: 'raise the quota',
        },
      ],
    });
    renderIn('nl');

    expect(await screen.findByText('The mailbox for sophie@acme.nl is 98% full')).toHaveAttribute('lang', 'en');
    expect(screen.getByRole('button', { name: 'raise the quota' })).toHaveAttribute('lang', 'en');
  });

  it('a new mailbox whose detail has no address falls back to the stored English', async () => {
    fetchDecisions.mockResolvedValue({ decisions: [{ ...PENDING, detail: {} }] });
    renderIn('nl');

    expect(await screen.findByText(PENDING.summary)).toHaveAttribute('lang', 'en');
    // The button is the category's, not the row's stored words.
    expect(screen.getByRole('button', { name: 'Genoteerd, ik regel het zelf' })).toBeInTheDocument();
  });

  it('an answered row says its question in the reader’s language too', async () => {
    fetchDecisions.mockResolvedValue({
      decisions: [{ ...PENDING, status: 'dismissed', resolvedAt: '2026-08-09T08:00:00Z' }],
    });
    renderIn('nl');

    expect(await screen.findByText(NEW_MAILBOX_NL)).toBeInTheDocument();
  });

  it('an English reader reads the English, not marked', async () => {
    fetchDecisions.mockResolvedValue({ decisions: [PENDING] });
    renderIn('en');

    expect(await screen.findByText(NEW_MAILBOX_EN)).not.toHaveAttribute('lang');
    expect(screen.getByRole('button', { name: 'Noted, I will handle it' })).not.toHaveAttribute('lang');
  });
});
