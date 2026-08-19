// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The Verify screen on the start + poll pair (workplan 0017 T5).
 *
 * The behaviours worth pinning are the ones a passing typecheck cannot see:
 * nothing fires on mount (the scan is behind the button — the UI-smoke e2e
 * proves it for the built artefact, this proves it for the component), the
 * poll LOOP stops on every terminal state rather than spinning forever, and
 * `failed` renders as "not a result" with the reason — never as a clean page.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
const { editionFlag } = vi.hoisted(() => ({ editionFlag: { selfhost: false } }));
vi.mock('../services/edition', () => ({
  isSelfHost: () => editionFlag.selfhost,
}));

import Verify from './Verify.tsx';
import * as service from '../services/operating-service.ts';
import type { VerificationResult } from '@openmig/shared';

vi.mock('../services/operating-service', () => ({
  startVerification: vi.fn(),
  fetchVerifyReport: vi.fn(),
}));

const started = vi.mocked(service.startVerification);
const fetched = vi.mocked(service.fetchVerifyReport);

const domain = {
  status: 'PASS',
  sourceCount: 1,
  targetCount: 1,
  checksumSampled: 0,
  checksumMismatches: 0,
  totalBytesSource: 0,
  totalBytesTarget: null,
  issues: [],
} as never;

const RESULT: VerificationResult = {
  tenantId: 't' as never,
  mappingId: 'm' as never,
  timestamp: '2026-07-31T12:00:00Z',
  overallStatus: 'PASS',
  score: 1,
  mail: domain,
  calendar: domain,
  contacts: domain,
  files: domain,
  totalItemsSource: 1,
  totalItemsTarget: 1,
  totalDiscrepancies: 0,
  totalBytesTransferred: 0,
  canProceedToCutover: true,
  recommendations: [],
};

beforeEach(() => {
  editionFlag.selfhost = false;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the Verify screen', () => {
  it('STARTS nothing on mount — but reads the stored report once (0038 T6)', async () => {
    fetched.mockResolvedValue({ state: 'never-run' });
    render(<MemoryRouter><Verify /></MemoryRouter>);
    // The behind-a-button rationale applies to the SCAN, not to the safe
    // status read: navigation must not cost a re-scan, so mount reads the
    // report endpoint once (it starts nothing) and renders what is stored.
    expect(started).not.toHaveBeenCalled();
    await waitFor(() => expect(fetched).toHaveBeenCalledTimes(1));
    // And says what pressing it costs, before it is pressed.
    expect(screen.getByText(/takes minutes/i)).toBeInTheDocument();
  });

  it('renders a STORED done report on mount, labelled with its as-of', async () => {
    fetched.mockResolvedValue({
      state: 'done',
      startedAt: '2026-07-31T12:00:00Z',
      finishedAt: '2026-07-31T12:03:00Z',
      report: { 'mapping-1': RESULT },
    });
    render(<MemoryRouter><Verify /></MemoryRouter>);

    // The operator who ran the minutes-long check, visited Deletions, and
    // came back used to find it GONE though both servers retain it.
    expect(await screen.findByRole('link', { name: 'mapping-1' })).toBeInTheDocument();
    expect(started).not.toHaveBeenCalled();
    expect(screen.getByText(/^Checked/)).toBeInTheDocument();
  });

  it('starts on click, polls to done, renders the report, and STOPS polling', async () => {
    vi.useFakeTimers();
    started.mockResolvedValue({
      started: true,
      report: { state: 'running', startedAt: '2026-07-31T12:00:00Z' },
    });
    fetched
      .mockResolvedValueOnce({ state: 'running', startedAt: '2026-07-31T12:00:00Z' })
      .mockResolvedValue({
        state: 'done',
        startedAt: '2026-07-31T12:00:00Z',
        finishedAt: '2026-07-31T12:03:00Z',
        report: { 'mapping-1': RESULT },
      });

    render(<MemoryRouter><Verify /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /run the check/i }));
    // Let the start promise settle and arm the interval, then run it once.
    await act(async () => {});
    expect(started).toHaveBeenCalledTimes(1);

    // First (immediate) poll says running; the interval's next says done.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect(screen.getByRole('link', { name: 'mapping-1' }).getAttribute('href')).toBe(
      '/mappings/mapping-1',
    );
    // The report says WHEN it was generated (0036 T1) — finishedAt was
    // served all along and discarded; a stale report read as current.
    expect(screen.getByText(/^Checked/)).toBeInTheDocument();

    // The loop is DEAD after a terminal state: minutes later, no more reads.
    const callsAtDone = fetched.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetched.mock.calls.length).toBe(callsAtDone);
  });

  it('renders failed as NOT-a-result, with the reason, and stops polling', async () => {
    vi.useFakeTimers();
    started.mockResolvedValue({
      started: true,
      report: { state: 'running', startedAt: '2026-07-31T12:00:00Z' },
    });
    fetched.mockResolvedValue({
      state: 'failed',
      startedAt: '2026-07-31T12:00:00Z',
      error: 'the scan fell over',
    });

    render(<MemoryRouter><Verify /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /run the check/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(screen.getByText(/the scan fell over/)).toBeInTheDocument();
    // The sentence that stops a red box being misread as a verdict.
    expect(screen.getByText(/not a result/i)).toBeInTheDocument();

    const callsAtFailure = fetched.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetched.mock.calls.length).toBe(callsAtFailure);
  });

  it('a mid-run appliance restart is said out loud, not polled against forever', async () => {
    vi.useFakeTimers();
    started.mockResolvedValue({
      started: true,
      report: { state: 'running', startedAt: '2026-07-31T12:00:00Z' },
    });
    // The appliance restarted and honestly forgot the run (its report lives in
    // memory — the contract documents this instead of hiding it).
    fetched.mockResolvedValue({ state: 'never-run' });

    render(<MemoryRouter><Verify /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /run the check/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(screen.getByText(/restarted while the check ran/i)).toBeInTheDocument();
  });

  it('a missed poll keeps polling — the run state is authoritative, not the network', async () => {
    vi.useFakeTimers();
    started.mockResolvedValue({
      started: true,
      report: { state: 'running', startedAt: '2026-07-31T12:00:00Z' },
    });
    fetched
      .mockRejectedValueOnce(new Error('laptop lid closed'))
      .mockResolvedValue({
        state: 'done',
        startedAt: '2026-07-31T12:00:00Z',
        finishedAt: '2026-07-31T12:03:00Z',
        report: { 'mapping-1': RESULT },
      });

    render(<MemoryRouter><Verify /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /run the check/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });

    // The rejected first poll did not kill the loop or the run.
    expect(screen.getByRole('link', { name: 'mapping-1' }).getAttribute('href')).toBe(
      '/mappings/mapping-1',
    );
  });

  it('hands the route mappingId to BOTH service calls on the managed per-mapping route', async () => {
    // The bare renders above have no router, so `useParams` yields nothing and
    // the service sees `undefined` — the appliance's flat shape. This is the
    // managed shape: the id in the URL must reach start AND report, or the
    // screen would start one mapping's scan and poll another's.
    vi.useFakeTimers();
    started.mockResolvedValue({
      started: true,
      report: { state: 'running', startedAt: '2026-07-31T12:00:00Z' },
    });
    fetched.mockResolvedValue({
      state: 'failed',
      startedAt: '2026-07-31T12:00:00Z',
      error: 'stopped here, deliberately — one poll is enough for this test',
    });

    render(
      <MemoryRouter initialEntries={['/mappings/m-42/verify']}>
        <Routes>
          <Route path="mappings/:mappingId/verify" element={<Verify />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /run the check/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(started).toHaveBeenCalledWith('m-42');
    expect(fetched).toHaveBeenCalledWith('m-42');
  });
});

describe('the appliance-wide scope is stated (0038 T6)', () => {
  it('selfhost says the check covers every configured migration', async () => {
    editionFlag.selfhost = true;
    fetched.mockResolvedValue({ state: 'never-run' });
    render(<MemoryRouter><Verify /></MemoryRouter>);

    expect(
      await screen.findByText(/covers every configured migration/),
    ).toBeInTheDocument();
  });

  it('managed says no such thing — its check IS per-mapping', async () => {
    fetched.mockResolvedValue({ state: 'never-run' });
    render(<MemoryRouter><Verify /></MemoryRouter>);

    await screen.findByText(/takes minutes/i);
    expect(screen.queryByText(/covers every configured migration/)).not.toBeInTheDocument();
  });
});

