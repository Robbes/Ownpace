// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The confirmed list's screen (workplan 0117 T2, D10).
 *
 * The behaviours worth pinning are the ones a passing typecheck cannot see,
 * and on this page they are all about the same reader: somebody deciding
 * whether it is safe to empty their old account.
 *
 *  - The headline claims only `verified`, with the total beside it.
 *  - A blank identifier says it was never RECORDED, not that the item has no
 *    name — the distinction `natural_key` being `''` on every historical row
 *    made real.
 *  - `unchecked` and `missing` render as different words. They are different
 *    facts, and a list that blurs them is one somebody empties a folder on.
 *  - Truncation is stated, because silent truncation reads as "covered
 *    everything".
 *  - A pass that FAILED does not date the page with "checked at".
 *  - Pressing check polls the cheap `/runs` route, not the walk.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const { editionFlag } = vi.hoisted(() => ({ editionFlag: { selfhost: false } }));
vi.mock('../services/edition', () => ({
  isSelfHost: () => editionFlag.selfhost,
}));

import Confirmed from './Confirmed.tsx';
import * as service from '../services/operating-service.ts';
import type { ConfirmedListQueue, ConfirmedRowView } from '@openmig/shared';

vi.mock('../services/operating-service', () => ({
  fetchConfirmedList: vi.fn(),
  fetchConfirmedListExport: vi.fn(),
  startConfirmation: vi.fn(),
  fetchRuns: vi.fn(),
}));

const listed = vi.mocked(service.fetchConfirmedList);
const started = vi.mocked(service.startConfirmation);
const runs = vi.mocked(service.fetchRuns);

const row = (over: Partial<ConfirmedRowView> = {}): ConfirmedRowView => ({
  domain: 'file',
  collection: '/Documents',
  naturalKey: '/Documents/tax-2025.pdf',
  state: 'unchecked',
  claim: 'none',
  confirmedAt: null,
  ...over,
});

const queue = (over: Partial<ConfirmedListQueue> = {}): ConfirmedListQueue => ({
  migrationStatus: 'active',
  verified: 0,
  total: 0,
  rows: [],
  lastPass: { state: 'never-run' },
  ...over,
});

const show = (q: ConfirmedListQueue) => {
  listed.mockResolvedValue({ 'mapping-1': q } as never);
  return render(
    <MemoryRouter>
      <Confirmed />
    </MemoryRouter>,
  );
};

beforeEach(() => {
  editionFlag.selfhost = false;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the confirmed list screen', () => {
  it('claims only VERIFIED in the headline, with the total beside it', async () => {
    // `yours` and `present` are not in `verified`, by D10 — and the total is
    // what stops the number reading as the whole account.
    show(queue({ verified: 6079, total: 7468, rows: [row()] }));
    expect(await screen.findByText('6,079')).toBeInTheDocument();
    expect(screen.getByText(/7,468/)).toBeInTheDocument();
    expect(screen.getByText(/verified by hash/i)).toBeInTheDocument();
  });

  it('reads the list on mount but starts NO pass', async () => {
    show(queue());
    await waitFor(() => expect(listed).toHaveBeenCalledTimes(1));
    expect(started).not.toHaveBeenCalled();
    // And says what pressing it costs, before it is pressed.
    expect(screen.getByText(/takes minutes/i)).toBeInTheDocument();
  });

  it('says an identifier was NOT RECORDED rather than rendering an empty cell', async () => {
    // `item.natural_key` was `''` on every row written before 2026-09-12, and
    // those rows cannot be backfilled. A blank cell on THIS page would read as
    // "this item has no name", which is a frightening thing to read here.
    show(queue({ verified: 0, total: 1, rows: [row({ naturalKey: '' })] }));
    expect(await screen.findByText(/name not recorded/i)).toBeInTheDocument();
  });

  it('renders unchecked and missing as DIFFERENT words', async () => {
    // The whole argument of `confirmed-list.ts`: "we did not check" and "we
    // checked and it is gone" are different facts, and a list that renders
    // them alike is a list somebody empties the wrong folder on.
    show(
      queue({
        verified: 0,
        total: 2,
        rows: [
          row({ state: 'unchecked', naturalKey: '/a.pdf' }),
          row({ state: 'missing', naturalKey: '/b.pdf', confirmedAt: '2026-09-13T09:00:00Z' }),
        ],
      }),
    );
    expect(await screen.findByText('Not checked')).toBeInTheDocument();
    expect(screen.getByText('Missing')).toBeInTheDocument();
  });

  it('names what was compared without scoring it', async () => {
    // A claim is a QUESTION that was answered, never a confidence level: a
    // calendar row compared by fingerprint is not a worse `byte-hash`.
    show(
      queue({
        verified: 0,
        total: 2,
        rows: [
          row({ domain: 'calendar', claim: 'fingerprint', state: 'present' }),
          row({ domain: 'file', claim: 'byte-hash', state: 'differs' }),
        ],
      }),
    );
    expect(await screen.findByText('by fingerprint')).toBeInTheDocument();
    expect(screen.getByText('by hash')).toBeInTheDocument();
  });

  it('states truncation, because silent truncation reads as "covered everything"', async () => {
    show(queue({ verified: 3, total: 90_000, rows: [row(), row()], truncated: true }));
    expect(await screen.findByText(/Showing the first/)).toBeInTheDocument();
    expect(screen.getByText(/The download has every one of them/)).toBeInTheDocument();
  });

  it('does NOT date the page with "checked at" when the pass failed', async () => {
    // A failed pass is not a result. Dating the document by the moment it
    // stopped being trustworthy would be the worst kind of almost-honest.
    show(
      queue({
        verified: 0,
        total: 5,
        lastPass: {
          state: 'failed',
          startedAt: '2026-09-13T09:00:00Z',
          finishedAt: '2026-09-13T09:04:00Z',
          error: 'the target refused',
        },
      }),
    );
    expect(await screen.findByText(/The check stopped at/)).toBeInTheDocument();
    expect(screen.queryByText(/^Checked/)).not.toBeInTheDocument();
    expect(screen.getByText(/the target refused/)).toBeInTheDocument();
  });

  it('says WHY only part of the account was checked, when a pass was paused', async () => {
    // Without it, "12 of 50 000" reads as a bad result rather than as a day's
    // budget spent — §7c's own warning about misleading by omission.
    show(
      queue({
        verified: 12,
        total: 50_000,
        rows: [row()],
        pausedAt: { kind: 'daily-download-ceiling' } as never,
      }),
    );
    expect(await screen.findByText(/Only part of the account was checked/)).toBeInTheDocument();
  });

  it('polls the cheap RUNS route while a pass runs, and re-reads the walk once', async () => {
    vi.useFakeTimers();
    listed.mockResolvedValue({ 'mapping-1': queue() } as never);
    started.mockResolvedValue({ 'mapping-1': { started: true } } as never);
    runs.mockResolvedValue({ runs: [{ status: 'running' }] } as never);

    render(
      <MemoryRouter>
        <Confirmed />
      </MemoryRouter>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(listed).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Check the destination/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(started).toHaveBeenCalledTimes(1);

    // While the run is open the expensive walk is NOT re-read.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(runs).toHaveBeenCalled();
    expect(listed).toHaveBeenCalledTimes(1);

    // When it closes, exactly one more read.
    runs.mockResolvedValue({ runs: [{ status: 'success' }] } as never);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(listed).toHaveBeenCalledTimes(2);
  });

  it('stops watching after the cap, so a continuous lane cannot spin for ever', async () => {
    // A mapping in the continuous lane keeps opening sync runs, so "no run is
    // open" may never arrive. The watch is bounded and re-reads anyway.
    vi.useFakeTimers();
    listed.mockResolvedValue({ 'mapping-1': queue() } as never);
    started.mockResolvedValue({ 'mapping-1': { started: true } } as never);
    runs.mockResolvedValue({ runs: [{ status: 'running' }] } as never);

    render(
      <MemoryRouter>
        <Confirmed />
      </MemoryRouter>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByRole('button', { name: /Check the destination/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // 60 polls at 5s, plus one more tick to cross the cap.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61 * 5_000);
    });
    expect(listed).toHaveBeenCalledTimes(2);

    // THE BOUND IS THE ASSERTION, and it is advanced rather than waited for.
    // A guard that looped until the watch stopped would HANG on the very bug
    // it exists to catch — 0117 slice 8 met exactly that shape and recorded
    // it: a test that cannot finish reports nothing and holds a runner.
    const pollsAtCap = runs.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 5_000);
    });
    expect(runs.mock.calls.length).toBe(pollsAtCap);
  });

  it('says a pass it JOINED was already running, rather than claiming it started one', async () => {
    listed.mockResolvedValue({ 'mapping-1': queue() } as never);
    started.mockResolvedValue({ 'mapping-1': { started: false } } as never);
    runs.mockResolvedValue({ runs: [] } as never);

    render(
      <MemoryRouter>
        <Confirmed />
      </MemoryRouter>,
    );
    await waitFor(() => expect(listed).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Check the destination/i }));
    expect(await screen.findByText(/already running/i)).toBeInTheDocument();
  });

  it('shows the read failure rather than an empty, reassuring page', async () => {
    listed.mockRejectedValue(new Error('the database is not reachable'));
    render(
      <MemoryRouter>
        <Confirmed />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/The list could not be read/)).toBeInTheDocument();
    expect(screen.getByText(/not reachable/)).toBeInTheDocument();
  });

  it('distinguishes an empty account from a fully verified one', async () => {
    const { unmount } = show(queue({ verified: 0, total: 0 }));
    expect(await screen.findByText(/no items yet/i)).toBeInTheDocument();
    unmount();

    show(queue({ verified: 40, total: 40 }));
    expect(await screen.findByText(/Every item was re-read and matched/)).toBeInTheDocument();
  });
});
