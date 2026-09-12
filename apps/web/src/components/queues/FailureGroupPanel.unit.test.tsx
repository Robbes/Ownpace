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
import { render, screen, waitFor } from '@testing-library/react';
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

import { FailureGroupPanel, matchingFailures } from './FailureGroupPanel.tsx';

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
