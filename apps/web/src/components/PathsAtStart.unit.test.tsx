// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The question at Start (workplan 0109 T6, the path axis; the owner,
 * 2026-10-04: one agreed tier for both axes, both ways side by side, enforced
 * by the server).
 *
 * What the owner meets before the press when starting would run more at the
 * same time than their tier runs: the numbers, and beside each other, moving
 * up at the monthly said (and starting everything) or starting what fits now.
 * A press of *Move up* asks once more with the money said; only "Yes, I agree"
 * sends the tier and the price shown. Nothing at all where it does not apply:
 * within the tier, for a member, and on the appliance; during the alpha, a
 * note with nothing to press.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PathsAtStart } from './PathsAtStart.tsx';
import { billingApi, type PathsAtStart as Forecast } from '../services/billing-service.ts';

const { editionFlag, authState } = vi.hoisted(() => ({
  editionFlag: { selfhost: false },
  authState: { user: { role: 'owner' } as null | { role: string } },
}));

vi.mock('../services/edition.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/edition.ts')>()),
  isSelfHost: () => editionFlag.selfhost,
}));

vi.mock('../stores/auth-store.ts', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) => (selector ? selector(authState) : authState),
}));

vi.mock('../services/billing-service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/billing-service.ts')>()),
  billingApi: { getPathsAtStart: vi.fn(), sayYesToPaths: vi.fn() },
}));

const getPathsAtStart = vi.mocked(billingApi.getPathsAtStart);
const sayYesToPaths = vi.mocked(billingApi.sayYesToPaths);

/** On Small, three running, two to start: m1 takes one slot, m2 three. */
const PAST: Forecast = {
  holds: true,
  tier: { id: 'small', name: 'Small', paths: 4, monthlyEur: 5 },
  held: 3,
  after: 7,
  past: true,
  needs: { id: 'medium', name: 'Medium', paths: 20, monthlyEur: 12 },
  reason: 'Starting this would make 7 migrations at the same time …',
  fits: ['m1'],
};

function renderQuestion(props: { disabled?: boolean } = {}) {
  const onAsking = vi.fn();
  const onStart = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PathsAtStart mappingIds={['m1', 'm2']} disabled={props.disabled ?? false} onAsking={onAsking} onStart={onStart} />
    </QueryClientProvider>,
  );
  return { onAsking, onStart };
}

beforeEach(() => {
  editionFlag.selfhost = false;
  authState.user = { role: 'owner' };
  getPathsAtStart.mockReset();
  sayYesToPaths.mockReset();
  getPathsAtStart.mockResolvedValue(PAST);
  sayYesToPaths.mockResolvedValue(undefined);
});

describe('past the tier', () => {
  it('says the numbers, and both ways on side by side, with the price', async () => {
    const { onAsking } = renderQuestion();
    expect(await screen.findByText(/makes 7 migrations run at the same time/)).toBeInTheDocument();
    expect(screen.getByText(/your tier, Small, runs 4/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Move up to Medium' })).toBeInTheDocument();
    expect(screen.getByText(/20 at the same time, for €\s?12(\.00)? a month/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Start what fits now' })).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 start now, on Small/)).toBeInTheDocument();
    expect(getPathsAtStart).toHaveBeenCalledWith(['m1', 'm2']);
    // The plain Start gives way to the two.
    await waitFor(() => expect(onAsking).toHaveBeenLastCalledWith(true));
  });

  it('asks once more with the money said, and only the yes sends the tier and price shown, then starts everything', async () => {
    const { onStart } = renderQuestion();
    await userEvent.click(await screen.findByRole('button', { name: 'Move up to Medium and start' }));
    expect(sayYesToPaths).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog').textContent).toMatch(/You agree to pay €\s?12(\.00)? a month for Medium/);
    await userEvent.click(screen.getByRole('button', { name: 'Yes, I agree' }));
    await waitFor(() => expect(onStart).toHaveBeenCalledWith());
    expect(sayYesToPaths).toHaveBeenCalledWith({ tierId: 'medium', priceEur: 12 });
  });

  it('takes nothing on "Not now"', async () => {
    const { onStart } = renderQuestion();
    await userEvent.click(await screen.findByRole('button', { name: 'Move up to Medium and start' }));
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(sayYesToPaths).not.toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('starts only what fits, beside it', async () => {
    const { onStart } = renderQuestion();
    await userEvent.click(await screen.findByRole('button', { name: 'Start 1 of 2' }));
    expect(onStart).toHaveBeenCalledWith(['m1']);
    expect(sayYesToPaths).not.toHaveBeenCalled();
  });

  it('says when nothing fits beside what runs now, and that a paused migration keeps its place', async () => {
    getPathsAtStart.mockResolvedValue({ ...PAST, fits: [] });
    renderQuestion();
    expect(await screen.findByText(/None of these fits beside what runs now/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Start \d/ })).toBeNull();
  });

  it('past Extra large, says talk to us instead of a tier', async () => {
    getPathsAtStart.mockResolvedValue({ ...PAST, needs: null });
    renderQuestion();
    expect(await screen.findByText(/No tier runs that many at the same time. Talk to us/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Move up/ })).toBeNull();
  });

  it('says a refused yes beside the question, and starts nothing', async () => {
    sayYesToPaths.mockRejectedValue(new Error('The price has changed since the page was shown.'));
    const { onStart } = renderQuestion();
    await userEvent.click(await screen.findByRole('button', { name: 'Move up to Medium and start' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, I agree' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your yes was not recorded:');
    expect(onStart).not.toHaveBeenCalled();
  });

  it('waits while Start may not be pressed', async () => {
    renderQuestion({ disabled: true });
    expect(await screen.findByRole('button', { name: 'Move up to Medium and start' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start 1 of 2' })).toBeDisabled();
  });
});

describe('where it does not ask', () => {
  it('during the alpha, says the numbers and that everything starts, with nothing to press', async () => {
    getPathsAtStart.mockResolvedValue({ ...PAST, holds: false });
    const { onAsking } = renderQuestion();
    const note = await screen.findByRole('note');
    expect(note.textContent).toContain('During the Alpha nothing waits for a yes and nothing is charged');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(onAsking).not.toHaveBeenCalledWith(true);
  });

  it('within the tier, shows nothing', async () => {
    getPathsAtStart.mockResolvedValue({ ...PAST, past: false, needs: null, reason: null, fits: ['m1', 'm2'] });
    const { onAsking } = renderQuestion();
    await waitFor(() => expect(getPathsAtStart).toHaveBeenCalled());
    expect(screen.queryByText(/at the same time/)).toBeNull();
    expect(onAsking).not.toHaveBeenCalledWith(true);
  });

  it('for a member, never asks: the server refuses the start and says why', () => {
    authState.user = { role: 'member' };
    renderQuestion();
    expect(getPathsAtStart).not.toHaveBeenCalled();
  });

  it('on the appliance, never asks', () => {
    editionFlag.selfhost = true;
    renderQuestion();
    expect(getPathsAtStart).not.toHaveBeenCalled();
  });
});
