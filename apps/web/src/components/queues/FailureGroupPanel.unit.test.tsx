// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The group press, on screen (2026-09-12).
 *
 * PR #927 gave both editions `POST /:mappingId/failures`, and until this panel
 * the only way to press it was `curl`. What is worth pinning here is not that a
 * button calls a function — it is the three things that make the button
 * trustworthy:
 *
 *  1. **The previewed count is the count the server will change.** The queue is
 *     already in the browser, so the panel can say how many rows a match
 *     reaches before anybody presses. If that preview disagreed with the
 *     server, the screen would be lying at exactly the moment somebody decides
 *     — and the repo has been here before, with a digest that said four
 *     pointing at a queue showing three.
 *  2. **The filter is the server's filter.** Literal substring, `===` on the
 *     domain. `%` is a percent sign on both sides, because PgLedger escapes it.
 *  3. **It will not press with nothing selected.** The server refuses that with
 *     a 400; the panel refuses to send it for the same reason rather than a
 *     different one, and shows the server's sentence if it ever gets through.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ItemFailure } from '@openmig/shared';

interface Refusal {
  readonly error: string;
  readonly hint?: string;
  readonly reason?: string;
}

// Hoisted with the mock, because `vi.mock`'s factory runs before the module
// body — a class declared below it is still uninitialised when the factory
// reads it, which fails as "Cannot access 'FakeRefused' before initialization".
const { decideFailureGroupMock, FakeRefused } = vi.hoisted(() => {
  class FakeRefused extends Error {
    readonly refusal: { error: string; hint?: string; reason?: string };
    readonly httpStatus = 400;
    constructor(refusal: { error: string; hint?: string; reason?: string }) {
      super(refusal.error);
      this.refusal = refusal;
    }
  }
  return { decideFailureGroupMock: vi.fn(), FakeRefused };
});

vi.mock('../../services/operating-service', () => ({
  decideFailureGroup: decideFailureGroupMock,
  DecisionRefusedError: FakeRefused,
}));

import { FailureGroupPanel, failureGroups, matchingFailures } from './FailureGroupPanel.tsx';

function failure(over: Partial<ItemFailure> = {}): ItemFailure {
  return {
    naturalKeyHash: 'h1',
    domain: 'file',
    collection: '/Documents/Sub',
    lastError: 'MKCOL 404 on the parent collection',
    attempts: 5,
    needsDecision: true,
    ...over,
  } as ItemFailure;
}

/** The live shape: files behind one MKCOL, plus unrelated failures. */
const QUEUE: readonly ItemFailure[] = [
  failure({ naturalKeyHash: 'f1' }),
  failure({ naturalKeyHash: 'f2' }),
  failure({ naturalKeyHash: 'f3', lastError: 'MKCOL 404 on /Documents/Sub/(50%).pdf' }),
  failure({ naturalKeyHash: 'c1', domain: 'calendar', lastError: 'the server said: 552 too large' }),
];

function renderPanel(failures: readonly ItemFailure[] = QUEUE) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FailureGroupPanel mappingId="m-1" failures={failures} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  decideFailureGroupMock.mockResolvedValue({
    status: 'ok',
    action: 'retry',
    matched: 3,
    match: { errorContains: 'MKCOL' },
    effect: 'Attempts reset on 3 item(s) and cursors cleared; the next scheduled pass will try them again.',
  });
});

describe('the filter is the server’s filter', () => {
  it('matches the error substring literally — a % is a percent sign', () => {
    // PgLedger escapes `%` and declares ESCAPE, precisely so a needle out of a
    // real filename means what it looks like. A preview that treated it as a
    // wildcard would promise more rows than the server changes.
    const rows = [
      failure({ naturalKeyHash: 'literal', lastError: 'PUT refused for (50%).pdf' }),
      failure({ naturalKeyHash: 'decoy', lastError: 'PUT refused for 500-page-report.pdf' }),
    ];
    expect(matchingFailures(rows, { errorContains: '50%' }).map((f) => f.naturalKeyHash)).toEqual([
      'literal',
    ]);
  });

  it('narrows on the domain alone, and on both together', () => {
    expect(matchingFailures(QUEUE, { domain: 'calendar' }).map((f) => f.naturalKeyHash)).toEqual([
      'c1',
    ]);
    expect(
      matchingFailures(QUEUE, { domain: 'file', errorContains: 'MKCOL' }).map(
        (f) => f.naturalKeyHash,
      ),
    ).toEqual(['f1', 'f2', 'f3']);
  });

  it('an absent or empty substring narrows nothing, exactly as the SQL clause does', () => {
    // Both sides drop the clause entirely rather than matching the empty
    // string differently. The route is what refuses this shape; the filter
    // must not quietly mean something else in the meantime.
    expect(matchingFailures(QUEUE, {})).toHaveLength(QUEUE.length);
    expect(matchingFailures(QUEUE, { errorContains: '' })).toHaveLength(QUEUE.length);
  });
});

describe('the count is shown before the press', () => {
  it('counts the matching rows out of everything it was given', async () => {
    renderPanel();
    await userEvent.type(screen.getByLabelText('Error contains'), 'MKCOL');

    expect(screen.getByText('Matches 3 of the 4 here.')).toBeInTheDocument();
  });

  it('says to narrow first, and will not send an unnarrowed press', async () => {
    renderPanel();

    expect(screen.getByText('Pick a kind, or type part of the error, first.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try all of these again' }));
    // The server would refuse this with a 400; not sending it is the same
    // decision, made one step earlier.
    expect(decideFailureGroupMock).not.toHaveBeenCalled();
  });

  it('offers only the kinds that are actually in the queue', () => {
    renderPanel([failure({ naturalKeyHash: 'f1' }), failure({ naturalKeyHash: 'f2' })]);
    const options = [...screen.getByLabelText('Kind').querySelectorAll('option')].map(
      (o) => o.textContent,
    );
    // A select naming a domain with no rows would answer "nothing matched" and
    // read as a broken screen.
    expect(options).toEqual(['Any kind', 'Files']);
  });

  it('will not press when the wording matches nothing', async () => {
    renderPanel();
    await userEvent.type(screen.getByLabelText('Error contains'), 'a wording nothing used');

    expect(screen.getByText('Matches 0 of the 4 here.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try all of these again' }));
    expect(decideFailureGroupMock).not.toHaveBeenCalled();
  });
});

describe('the press', () => {
  it('sends the match it previewed, and shows the server’s own effect', async () => {
    renderPanel();
    await userEvent.selectOptions(screen.getByLabelText('Kind'), 'file');
    await userEvent.type(screen.getByLabelText('Error contains'), 'MKCOL');
    await userEvent.click(screen.getByRole('button', { name: 'Try all of these again' }));

    expect(decideFailureGroupMock).toHaveBeenCalledWith('m-1', 'retry', {
      domain: 'file',
      errorContains: 'MKCOL',
    });
    expect(await screen.findByText(/cursors cleared/)).toBeInTheDocument();
  });

  it('accepts a group through the same match', async () => {
    decideFailureGroupMock.mockResolvedValue({
      status: 'ok',
      action: 'accept',
      matched: 2,
      match: { errorContains: 'Google-native' },
      effect: 'Left behind for good: 2 item(s) will not be retried.',
    });
    renderPanel();
    await userEvent.type(screen.getByLabelText('Error contains'), 'MKCOL');
    await userEvent.click(screen.getByRole('button', { name: 'Migrate without all of these' }));

    expect(decideFailureGroupMock).toHaveBeenCalledWith('m-1', 'accept', {
      errorContains: 'MKCOL',
    });
    expect(await screen.findByText(/Left behind for good/)).toBeInTheDocument();
  });

  it('trims the wording, so a stray space is not part of the needle', async () => {
    renderPanel();
    await userEvent.type(screen.getByLabelText('Error contains'), '  MKCOL  ');
    await userEvent.click(screen.getByRole('button', { name: 'Try all of these again' }));

    expect(decideFailureGroupMock).toHaveBeenCalledWith('m-1', 'retry', {
      errorContains: 'MKCOL',
    });
  });

  it('shows a refusal in the server’s words, not its own', async () => {
    decideFailureGroupMock.mockRejectedValue(
      new FakeRefused({
        error: 'a group decision has to say WHICH failures it is for',
        hint: 'Send a domain, an errorContains substring, or both.',
      } satisfies Refusal),
    );
    renderPanel();
    await userEvent.type(screen.getByLabelText('Error contains'), 'MKCOL');
    await userEvent.click(screen.getByRole('button', { name: 'Try all of these again' }));

    await waitFor(() => {
      expect(screen.getByText(/Send a domain, an errorContains substring/)).toBeInTheDocument();
    });
  });
});

/**
 * THE GROUPS, OFFERED RATHER THAN TYPED (the owner, 2026-09-17: *"why now
 * detail groups that share sumilarities and offer those to pick from to do
 * bulk actions?"*).
 *
 * Typing a substring is how somebody describes a group they have already
 * worked out. These are the ones the queue announces about itself, and the
 * press has to send exactly the group it drew.
 */
describe('the groups are read off the rows', () => {
  /** The owner's own queue: two refused contacts, a refused file, one nameless. */
  const MIXED: readonly ItemFailure[] = [
    failure({ naturalKeyHash: 'c1', domain: 'contact', category: 'target_refused' }),
    failure({ naturalKeyHash: 'c2', domain: 'contact', category: 'target_refused' }),
    failure({ naturalKeyHash: 'f1', domain: 'file', category: 'source_refused' }),
    // No category: written before migration 0049 stored one.
    failure({ naturalKeyHash: 'c3', domain: 'contact' }),
  ];

  it('crosses the kind with the category, biggest group first', () => {
    expect(failureGroups(MIXED)).toEqual([
      { domain: 'contact', category: 'target_refused', count: 2, retrying: 0, pressable: true },
      { domain: 'contact', count: 1, retrying: 0, pressable: false },
      { domain: 'file', category: 'source_refused', count: 1, retrying: 0, pressable: true },
    ]);
  });

  it('says how much of a group is already queued to try again', () => {
    // The owner's screen, 2026-09-22: nine rows retried one by one, a refresh,
    // and "20 items" / "13 items" exactly as before — while "Waiting on you"
    // had gone from 33 to 24. The total is right to include them; the buttons
    // reach them. What was missing was any sign that the presses had worked.
    const [group] = failureGroups([
      failure({ naturalKeyHash: 'a', domain: 'file', category: 'policy_refused', needsDecision: true }),
      failure({ naturalKeyHash: 'b', domain: 'file', category: 'policy_refused', needsDecision: false }),
      failure({ naturalKeyHash: 'c', domain: 'file', category: 'policy_refused', needsDecision: false }),
    ]);
    expect(group).toMatchObject({ count: 3, retrying: 2 });
  });

  it('shows the queued share beside the total, in the words of the section that lists them', () => {
    renderPanel([
      failure({ naturalKeyHash: 'a', domain: 'file', category: 'policy_refused', needsDecision: true }),
      failure({ naturalKeyHash: 'b', domain: 'file', category: 'policy_refused', needsDecision: false }),
    ]);
    expect(screen.getByText(/1 still trying/)).toBeInTheDocument();
  });

  it('says nothing extra when nothing in a group is queued', () => {
    renderPanel([
      failure({ naturalKeyHash: 'a', domain: 'file', category: 'policy_refused', needsDecision: true }),
      failure({ naturalKeyHash: 'b', domain: 'file', category: 'policy_refused', needsDecision: true }),
    ]);
    expect(screen.queryByText(/still trying/)).not.toBeInTheDocument();
  });

  it('marks a group with NO category unpressable', () => {
    // Its only description to the server would be its domain, which reaches
    // every other category in that domain too — so the count beside a button
    // would be a promise the press does not keep.
    const nameless = failureGroups(MIXED).find((g) => g.category === undefined);
    expect(nameless?.pressable).toBe(false);
  });

  it('accounts for every row exactly once', () => {
    // A grouping that dropped or double-counted rows would put a number on
    // screen that no press can reproduce.
    const total = failureGroups(MIXED).reduce((n, g) => n + g.count, 0);
    expect(total).toBe(MIXED.length);
  });

  it('matches a category exactly, and never reaches an uncategorised row', () => {
    // The client's mirror of the SQL: `=` does not match NULL there, and
    // `undefined` must not match here either, or the previewed count and the
    // changed count come apart.
    expect(matchingFailures(MIXED, { category: 'target_refused' }).map((f) => f.naturalKeyHash)).toEqual([
      'c1',
      'c2',
    ]);
    expect(matchingFailures(MIXED, { category: 'source_refused' })).toHaveLength(1);
  });

  it('shows each group with its count and its own sentence', async () => {
    renderPanel(MIXED);
    expect(await screen.findByText('Groups in this queue')).toBeInTheDocument();
    expect(screen.getByText('2 items')).toBeInTheDocument();
    // The same remedy sentence the row above the panel prints, from the same
    // map: the group and its members have to be called one thing.
    expect(screen.getAllByText(/The destination refused to accept this/).length).toBeGreaterThan(0);
  });

  it('presses the group it drew, kind and category together', async () => {
    renderPanel(MIXED);
    const list = within(await screen.findByRole('list'));
    const retries = list.getAllByRole('button', { name: 'Try all of these again' });
    // The first group is the biggest: the two refused contacts.
    await userEvent.click(retries[0]!);
    await waitFor(() =>
      expect(decideFailureGroupMock).toHaveBeenCalledWith('m-1', 'retry', {
        domain: 'contact',
        category: 'target_refused',
      }),
    );
  });

  it('offers no button for the group that has no category', async () => {
    // Scoped to the GROUP LIST. The folded match below keeps its own pair, and
    // they are in the document whether the fold is open or not — counting the
    // whole panel would pass on a list that had grown a third button.
    renderPanel(MIXED);
    const list = within(await screen.findByRole('list'));
    expect(list.getAllByRole('button', { name: 'Try all of these again' })).toHaveLength(2);
    expect(list.getAllByRole('button', { name: 'Migrate without all of these' })).toHaveLength(2);
    // Three groups, two of them pressable.
    expect(list.getAllByRole('listitem')).toHaveLength(3);
  });

  it('puts the outcome on the group that was pressed, not on all of them', async () => {
    // One outcome shared across several buttons would report "3 items" under
    // whichever group the reader looked at next, on a surface that decides
    // what happens to somebody's data.
    renderPanel(MIXED);
    const list = within(await screen.findByRole('list'));
    const accepts = list.getAllByRole('button', { name: 'Migrate without all of these' });
    await userEvent.click(accepts[1]!);
    await waitFor(() =>
      expect(decideFailureGroupMock).toHaveBeenCalledWith('m-1', 'accept', {
        domain: 'file',
        category: 'source_refused',
      }),
    );
    const shown = await screen.findAllByText(/Attempts reset on 3 item/);
    expect(shown).toHaveLength(1);
  });

  it('folds the typed match away, keeping it for what the categories cannot split', async () => {
    // One connector defect inside one category is the case this panel was
    // built for. It stays; it is just no longer the first thing offered.
    renderPanel(MIXED);
    const fold = await screen.findByText('Match on the error text instead');
    expect(fold.closest('details')?.open).toBe(false);
  });
});
