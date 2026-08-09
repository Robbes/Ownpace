// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The runs panel (workplan 0026 T3 row 23).
 *
 * The scenario every assertion here descends from is real: on 2026-08-09 a
 * pass whose email domain failed outright logged `pass complete (0 created)`,
 * and the operator diagnosed it from PowerShell log tails while the run rows
 * held the failure verbatim. So the tests pin the three properties that make
 * this panel the fix rather than another surface:
 *
 *   1. a failed run's log is OPEN, its error text verbatim — not folded, not
 *      paraphrased;
 *   2. an empty history says so in words — silence reading as "no runs" is
 *      the exact confusion the empty-state discipline exists for;
 *   3. a failed READ is reported as a failed read, never as an empty history.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RunReport } from '@openmig/shared';

const { fetchRunsMock } = vi.hoisted(() => ({ fetchRunsMock: vi.fn() }));

vi.mock('../services/operating-service', () => ({
  fetchRuns: fetchRunsMock,
}));

import RunsPanel from './RunsPanel';

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RunsPanel mappingId="acme-mail" />
    </QueryClientProvider>,
  );
}

function run(overrides: Partial<RunReport> = {}): RunReport {
  return {
    id: 'run-1',
    mappingId: 'acme-mail',
    type: 'delta',
    status: 'success',
    startedAt: '2026-08-09T00:05:00.000Z',
    finishedAt: '2026-08-09T00:05:03.000Z',
    itemsProcessed: 510,
    errors: 0,
    createdAt: '2026-08-09T00:05:00.000Z',
    events: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the runs panel', () => {
  it('shows a failed run with its error text VERBATIM, log open by default', async () => {
    // The 2026-08-09 line, exactly as the worker wrote it. If this ever
    // renders paraphrased, the operator is debugging a translation.
    const message =
      'email sync failed: JMAP target password/token not found in environment: check TARGET_JMAP_PASSWORD';
    fetchRunsMock.mockResolvedValue({
      runs: [
        run({
          id: 'run-bad',
          status: 'failed',
          errors: 1,
          itemsProcessed: 0,
          events: [{ level: 'error', message, at: '2026-08-09T00:05:01.000Z' }],
        }),
      ],
    });

    renderPanel();

    expect(await screen.findByText('Failed')).toBeInTheDocument();
    const line = screen.getByText(message);
    expect(line).toBeInTheDocument();
    // Open by default: the <details> around a failed run's log must carry the
    // open attribute, or the panel's whole reason to exist is behind a click.
    expect(line.closest('details')?.hasAttribute('open')).toBe(true);
  });

  it('folds a clean run’s log closed, so green lines cannot bury a red one', async () => {
    fetchRunsMock.mockResolvedValue({
      runs: [
        run({
          events: [{ level: 'info', message: 'email: 510 created, 0 skipped', at: '2026-08-09T00:05:02.000Z' }],
        }),
      ],
    });

    renderPanel();

    expect(await screen.findByText('Succeeded')).toBeInTheDocument();
    const line = screen.getByText('email: 510 created, 0 skipped');
    expect(line.closest('details')?.hasAttribute('open')).toBe(false);
  });

  it('says in words when no passes have run — an empty list is not a blank', async () => {
    fetchRunsMock.mockResolvedValue({ runs: [] });
    renderPanel();
    expect(
      await screen.findByText('No passes have run yet. History appears after the first sync.'),
    ).toBeInTheDocument();
  });

  it('reports a failed READ as a failed read, never as an empty history', async () => {
    // "Could not look" and "there is nothing there" are different findings
    // (hard rule 9) — conflating them here sends an operator away reassured.
    fetchRunsMock.mockRejectedValue(new Error('boom'));
    renderPanel();
    expect(
      await screen.findByText("Could not read this migration's run history."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No passes have run yet/)).not.toBeInTheDocument();
  });
});

describe('bounds honesty (0036 T3)', () => {
  it('labels the list only when the server SAYS it truncated', async () => {
    fetchRunsMock.mockResolvedValue({ runs: [run()], truncated: true });
    renderPanel();

    expect(
      await screen.findByText(/Showing the newest passes only/),
    ).toBeInTheDocument();
  });

  it('shows no label on a complete history — even one at the cap', async () => {
    fetchRunsMock.mockResolvedValue({ runs: [run()], truncated: false });
    renderPanel();

    await screen.findByText(/Run history/);
    expect(screen.queryByText(/Showing the newest passes only/)).not.toBeInTheDocument();
  });

  it('marks a run whose log was capped', async () => {
    fetchRunsMock.mockResolvedValue({
      runs: [run({ eventsTruncated: true, events: [{ level: 'error', message: 'boom', at: '2026-08-09T10:00:00Z' }] })],
      truncated: false,
    });
    renderPanel();

    expect(await screen.findByText(/Newest log entries only/)).toBeInTheDocument();
  });
});

