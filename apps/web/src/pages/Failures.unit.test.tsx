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

/**
 * THE REMEDY, ON THE ROW THAT NEEDS IT.
 *
 * A domain-level failure has said what to do, in the reader's language, since
 * workplan 0110 T3. An ITEM-level one said whatever the provider said, in
 * English, with no remedy — and the item level is the common case and the whole
 * reason this queue exists. Migration 0049 gave the row a category; this is the
 * half that puts it on the screen, from the same map the domain strip and the
 * operator's support screen already share.
 */
describe('a failed item says what to do about it', () => {
  it('shows the remedy for its category, above the provider prose', async () => {
    fetchFailuresMock.mockResolvedValue(
      queue({ needsDecision: [{ ...FAILURE, category: 'quota_exceeded' as const }] }),
    );
    renderScreen();

    // The remedy the customer can act on…
    expect(await screen.findByText(/reached what its provider allows/i)).toBeVisible();
    // …and the provider's own words, still there and still verbatim: the
    // category is coarse, this is what says whether Retry has a chance.
    expect(screen.getByText('IMAP APPEND failed: 507 over quota')).toBeVisible();
  });

  it('tells a source refusal from a target one, which is the point of the column', async () => {
    // The two remedies point at DIFFERENT accounts. Getting this wrong sends
    // somebody to audit a destination that was never sent the file — the live
    // defect migration 0048 was written about, one level up.
    fetchFailuresMock.mockResolvedValue(
      queue({
        needsDecision: [
          { ...FAILURE, naturalKeyHash: 'h-src', category: 'source_refused' as const },
        ],
      }),
    );
    renderScreen();

    await screen.findByText('acme-mail');
    // Names the SOURCE and says explicitly that the destination is not where
    // to look — the sentence that exists because the wrong one sent people to
    // the wrong account.
    expect(screen.getByText(/would not hand this over/i)).toBeVisible();
    expect(screen.getByText(/nothing to check there/i)).toBeVisible();
  });

  it('shows the prose alone when the row has no category', async () => {
    // Every row written before migration 0049, and any the classifier could not
    // reach. The screen behaves exactly as it did rather than inventing one.
    fetchFailuresMock.mockResolvedValue(queue());
    renderScreen();

    expect(await screen.findByText('IMAP APPEND failed: 507 over quota')).toBeVisible();
    expect(screen.queryByText(/reached what its provider allows/i)).not.toBeInTheDocument();
  });
});

/**
 * The queue whose whole purpose is being acted on could not say what it was
 * asking about.
 *
 * The owner, 2026-09-13: two contacts refused five times each, and this screen
 * identified them by a hash. Four days later, handed the UIDs instead: *"I can
 * not find these contacts, or atleast i do no know how."*
 */
describe('a failure says whose card it is', () => {
  const NAMED = {
    naturalKeyHash: 'h-card',
    domain: 'contact' as const,
    collection: 'Contacts',
    displayName: 'Jan Jansen',
    lastError: 'PUT failed with status 500: TypeError',
    attempts: 5,
    needsDecision: true,
  };

  it('leads with the name when the row has one', async () => {
    fetchFailuresMock.mockResolvedValue(queue({ needsDecision: [NAMED] }));
    renderScreen();

    expect(await screen.findByText('Jan Jansen')).toBeInTheDocument();
  });

  it('keeps the collection beside it, so the row is no taller', async () => {
    // Both on one line: the name says which item, the folder says where. A
    // second line per row is what the owner asked us to compress out of this
    // product the same afternoon.
    fetchFailuresMock.mockResolvedValue(queue({ needsDecision: [NAMED] }));
    renderScreen();

    const name = await screen.findByText('Jan Jansen');
    expect(name).toHaveTextContent('Contacts');
  });

  it('falls back to the collection alone for a row with no name', async () => {
    // A file, a mail message, and every row written before names were
    // recorded. Exactly what this screen showed before.
    fetchFailuresMock.mockResolvedValue(queue());
    renderScreen();

    expect(await screen.findByText('INBOX/Archive')).toBeInTheDocument();
  });
});
