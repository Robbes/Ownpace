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
import type { ConfirmedListQueue, ConfirmedRowView, RunReport } from '@openmig/shared';

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

/**
 * One run as the wire carries it — `kind` included, which is the field that
 * lets this screen find its OWN pass among a mapping's other runs.
 */
const run = (over: Partial<RunReport> = {}): RunReport => ({
  id: 'run-1',
  mappingId: 'mapping-1',
  type: 'full',
  kind: 'confirm',
  status: 'running',
  startedAt: '2026-09-13T19:00:00.000Z',
  finishedAt: null,
  itemsProcessed: 0,
  errors: 0,
  createdAt: '2026-09-13T19:00:00.000Z',
  events: [],
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
    // Before the press there is no pass at all — the worker opens its row a
    // moment after.
    runs.mockResolvedValue({ runs: [] } as never);

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

    runs.mockResolvedValue({ runs: [run()] } as never);

    // While the run is open the expensive walk is NOT re-read.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(runs).toHaveBeenCalled();
    expect(listed).toHaveBeenCalledTimes(1);

    // When it closes, exactly one more read.
    runs.mockResolvedValue({ runs: [run({ status: 'success' })] } as never);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(listed).toHaveBeenCalledTimes(2);
  });

  it('shows how far the pass has got, so a long one is not mistaken for a hung one', async () => {
    // Rob, watching a live pass over 7,468 items on 2026-09-13: *"I just don't
    // see some indicator that it's still running/in progress."* The start time
    // was on screen and never moved, and nothing else did either.
    vi.useFakeTimers();
    listed.mockResolvedValue({
      'mapping-1': queue({ total: 7468, lastPass: { state: 'running', startedAt: '2026-09-13T19:00:00.000Z' } }),
    } as never);
    started.mockResolvedValue({ 'mapping-1': { started: true } } as never);
    runs.mockResolvedValue({ runs: [run({ itemsProcessed: 3500 })] } as never);

    render(
      <MemoryRouter>
        <Confirmed />
      </MemoryRouter>,
    );
    // TWO STAGES, deliberately. The list read has to land before the watch
    // exists, so a single advance spends the five seconds BEFORE there is an
    // interval to fire — and the test would report a missing number that the
    // screen shows perfectly well.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(screen.getByText(/3,500/)).toBeInTheDocument();
    expect(screen.getByText(/checked so far/)).toBeInTheDocument();
  });

  it('picks the watch back up on a page loaded MID-pass, with nothing pressed', async () => {
    // A pass belongs to the server, not to this tab. Somebody who starts one,
    // shuts the laptop and comes back is still owed the sight of it working —
    // and `checking` was client state alone, so a reload showed a still page
    // with an enabled button whose only effect was to join the pass already
    // under way.
    vi.useFakeTimers();
    listed.mockResolvedValue({
      'mapping-1': queue({ total: 7468, lastPass: { state: 'running', startedAt: '2026-09-13T19:00:00.000Z' } }),
    } as never);
    runs.mockResolvedValue({ runs: [run({ itemsProcessed: 500 })] } as never);

    render(
      <MemoryRouter>
        <Confirmed />
      </MemoryRouter>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(started).not.toHaveBeenCalled();
    expect(runs).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Check the destination/i })).toBeDisabled();
  });

  it('is not ended by somebody ELSE\'s run — only the confirm pass decides', async () => {
    // THE REVERSAL. Until 2026-09-13 this watch asked "is ANY run open", which
    // is why it needed a five-minute timer to escape a continuous lane's
    // endless sync runs — and why it gave up with a 7,468-item pass a fifth
    // done. Now the CONFIRM run's own status ends it, so a sync run beside it
    // is neither a reason to stop nor a reason to carry on.
    vi.useFakeTimers();
    listed.mockResolvedValue({ 'mapping-1': queue() } as never);
    started.mockResolvedValue({ 'mapping-1': { started: true } } as never);
    runs.mockResolvedValue({ runs: [] } as never);

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

    // A continuous-lane sync is RUNNING beside the pass, and keeps running.
    const sync = run({ id: 'sync-1', kind: 'incremental', type: 'delta', status: 'running' });
    runs.mockResolvedValue({ runs: [sync, run({ itemsProcessed: 1000 })] } as never);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(listed).toHaveBeenCalledTimes(1);

    // The pass closes. The sync run is STILL OPEN — and under the old rule
    // that alone kept the watch alive, until a timer cut it off five minutes
    // in with the account a fifth checked. The confirm run decides now.
    runs.mockResolvedValue({
      runs: [sync, run({ status: 'success', itemsProcessed: 7468 })],
    } as never);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(listed).toHaveBeenCalledTimes(2);
  });

  it('does not read the PREVIOUS pass as this one, in the gap before the worker opens its row', async () => {
    // The press and the run row are not simultaneous: the worker opens it a
    // moment later. A poll landing in that gap finds the pass that finished
    // last week, and reading its `success` as this one's would declare the new
    // pass done before it had started. The guard is the prior run's ID, read
    // before the press — not a timestamp, so the two clocks never have to
    // agree.
    vi.useFakeTimers();
    listed.mockResolvedValue({ 'mapping-1': queue() } as never);
    started.mockResolvedValue({ 'mapping-1': { started: true } } as never);
    const lastWeek = run({ id: 'run-old', status: 'success', itemsProcessed: 7000 });
    runs.mockResolvedValue({ runs: [lastWeek] } as never);

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
      await vi.advanceTimersByTimeAsync(15_000);
    });

    // Three polls have all seen `run-old` finished. No re-read: this pass has
    // not started, let alone ended.
    expect(listed).toHaveBeenCalledTimes(1);

    // Now the worker opens its own row, and the watch is on it.
    runs.mockResolvedValue({ runs: [run({ id: 'run-new', status: 'success' }), lastWeek] } as never);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(listed).toHaveBeenCalledTimes(2);
  });

  it('stops watching at the cap, so a run row that never closes cannot spin for ever', async () => {
    // THE CAP IS NOW A SAFETY NET, not the mechanism. It used to be the only
    // thing that could end this watch, and at five minutes it expired with a
    // real pass a fifth done. The confirm run's status ends it now; this
    // catches only a row that never closes at all.
    vi.useFakeTimers();
    listed.mockResolvedValue({ 'mapping-1': queue() } as never);
    started.mockResolvedValue({ 'mapping-1': { started: true } } as never);
    runs.mockResolvedValue({ runs: [] } as never);

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
    runs.mockResolvedValue({ runs: [run()] } as never);

    // 720 polls at 5s is an hour, plus one more tick to cross the cap.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(721 * 5_000);
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
    // WAIT FOR THE BUTTON, NOT FOR THE CALL. `listed` having been CALLED says
    // only that the read started; the mapping this press needs comes from the
    // read's RESULT, a microtask or two later. Waiting on the call let the
    // click land in that gap, where `start` found no mapping and returned in
    // silence — an intermittent failure on this assertion, roughly one run in
    // eighteen, and never when the test ran alone.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Check the destination/i })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: /Check the destination/i }));
    expect(await screen.findByText(/already running/i)).toBeInTheDocument();
  });

  it('does not offer a press it would silently drop', async () => {
    // The appliance's screen is flat, so until the list lands there is no
    // mapping to start a pass on. The button used to be live throughout that
    // window: pressing it did nothing, said nothing, and left somebody
    // waiting on a pass that was never asked for.
    let land: (v: unknown) => void = () => {};
    listed.mockReturnValue(
      new Promise((res) => {
        land = res;
      }) as never,
    );

    render(
      <MemoryRouter>
        <Confirmed />
      </MemoryRouter>,
    );
    const button = screen.getByRole('button', { name: /Check the destination/i });
    expect(button).toBeDisabled();

    land({ 'mapping-1': queue() });
    await waitFor(() => expect(button).toBeEnabled());
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
