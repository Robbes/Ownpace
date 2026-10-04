// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The data ceiling on the Billing page (workplan 0109 T6, ADR-0014's
 * amendment of 2026-10-03).
 *
 * What a customer meets: where their data stands against what they agreed to;
 * from 80%, both ways on with their prices and the break-even; and a yes that
 * is sent only after the money is said once more, carrying the offer they saw.
 * During the alpha the card says the same and offers no button.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, type AxiosResponse } from 'axios';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import DataCeiling from './DataCeiling.tsx';
import { billingApi, type Ceiling } from '../services/billing-service.ts';

vi.mock('../services/billing-service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/billing-service.ts')>()),
  billingApi: { getCeiling: vi.fn(), sayYesToCeiling: vi.fn() },
}));

const getCeiling = vi.mocked(billingApi.getCeiling);
const sayYes = vi.mocked(billingApi.sayYesToCeiling);

/** On Small, past 80%: both ways on, and the break-even, on the list of 2026-09-29. */
const NEAR_ON_SMALL: Ceiling = {
  tier: { id: 'small', name: 'Small', paths: 4, monthly: 5 },
  ceilingGb: 750,
  topUps: 0,
  gbMoved: 700,
  gbMovedInTheAlpha: 0,
  share: 700 / 750,
  state: 'near',
  holds: true,
  moveUp: { tierId: 'medium', name: 'Medium', paths: 20, monthlyEur: 12, ceilingGb: 2000 },
  topUp: { tierId: 'small', bandGb: 750, priceEur: 5, ceilingGb: 1500 },
  breakEven: { extraOnceEur: 5, savedMonthlyEur: 7, paysBackInDays: 22 },
};

const UNDER_ON_FREE: Ceiling = {
  tier: { id: 'free', name: 'Free', paths: 1, monthly: 0 },
  ceilingGb: 250,
  topUps: 0,
  gbMoved: 10,
  gbMovedInTheAlpha: 0,
  share: 0.04,
  state: 'under',
  holds: true,
  moveUp: { tierId: 'small', name: 'Small', paths: 4, monthlyEur: 5, ceilingGb: 750 },
  topUp: null,
  breakEven: null,
};

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DataCeiling />
    </QueryClientProvider>,
  );
}

/** A 409 as axios hands it over: the server's code, its sentence, and the offer now. */
function refused(body: Record<string, unknown>): AxiosError {
  return new AxiosError('Request failed with status code 409', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: 409,
    statusText: 'Conflict',
    headers: {},
    config: {},
    data: body,
  } as AxiosResponse);
}

beforeEach(() => {
  getCeiling.mockReset();
  sayYes.mockReset();
});

describe('where the data stands', () => {
  it('says how much has moved against the ceiling, and offers nothing below 80%', async () => {
    getCeiling.mockResolvedValue(UNDER_ON_FREE);
    renderCard();
    expect(await screen.findByText(/10 GB of 250 GB moved, on Free/)).toBeVisible();
    expect(screen.getByText(/From 80% of the ceiling/)).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says the bands bought', async () => {
    getCeiling.mockResolvedValue({ ...NEAR_ON_SMALL, ceilingGb: 1500, topUps: 1, gbMoved: 1300, share: 1300 / 1500 });
    renderCard();
    expect(await screen.findByText(/1\.3 TB of 1\.5 TB moved, on Small\. That includes 1 extra band\(s\) bought/)).toBeVisible();
  });

  it('says what the alpha moved on a line of its own: it never counts (the owner, 2026-10-04)', async () => {
    getCeiling.mockResolvedValue({ ...UNDER_ON_FREE, gbMovedInTheAlpha: 600 });
    renderCard();
    expect(
      await screen.findByText('Another 600 GB was moved during the Alpha, which never counts toward your ceiling.'),
    ).toBeInTheDocument();
  });

  it('says a failed read as one', async () => {
    getCeiling.mockRejectedValue(new Error('ledger unreachable'));
    renderCard();
    expect(await screen.findByText('Your data ceiling could not be read')).toBeVisible();
    expect(screen.getByText('ledger unreachable')).toBeVisible();
  });
});

describe('from 80%, both ways on', () => {
  it('names both prices side by side, and the break-even', async () => {
    getCeiling.mockResolvedValue(NEAR_ON_SMALL);
    renderCard();
    expect(await screen.findByText(/Move up to Medium: €12\.00 a month\. Your ceiling becomes 2 TB/)).toBeVisible();
    // No setup fee since the list of 2026-09-29: a move up costs nothing once.
    expect(screen.queryByText(/once, then/)).toBeNull();
    expect(screen.getByText(/Or buy another 750 GB once, for €5\.00/)).toBeVisible();
    expect(screen.getByText(/costs €5\.00 more once and saves €7\.00 a month, so it pays back in about 22 day/)).toBeVisible();
    expect(screen.getByText(/the better buy when you need more migrations at once: Medium runs 20/)).toBeVisible();
  });

  it('says on Free that the way on is moving up', async () => {
    getCeiling.mockResolvedValue({ ...UNDER_ON_FREE, gbMoved: 250, share: 1, state: 'reached' });
    renderCard();
    expect(await screen.findByText('Free has no top-up: the way on is moving up.')).toBeVisible();
    expect(screen.getByText(/Your data ceiling is reached/)).toBeVisible();
  });
});

describe('the yes', () => {
  it('is not sent by the first press: the money is said once more', async () => {
    getCeiling.mockResolvedValue(NEAR_ON_SMALL);
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Move up to Medium' }));
    expect(screen.getByText('You agree to pay €12.00 a month for Medium.')).toBeVisible();
    expect(sayYes).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByText(/You agree to pay/)).toBeNull();
    expect(sayYes).not.toHaveBeenCalled();
  });

  it('carries the tier and the price the card showed, and the card follows', async () => {
    getCeiling.mockResolvedValue(NEAR_ON_SMALL);
    sayYes.mockResolvedValue({
      ...NEAR_ON_SMALL,
      ceilingGb: 1500,
      topUps: 1,
      share: 700 / 1500,
      state: 'under',
      topUp: { tierId: 'small', bandGb: 750, priceEur: 5, ceilingGb: 2250 },
    });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Buy another 750 GB' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, I agree' }));
    await waitFor(() => expect(sayYes).toHaveBeenCalledWith({ choice: 'top_up', tierId: 'small', priceEur: 5 }));
    expect(await screen.findByText('Done: your data ceiling is now 1.5 TB.')).toBeVisible();
  });

  it('carries a move up at the monthly it showed: there is nothing to pay once', async () => {
    getCeiling.mockResolvedValue(NEAR_ON_SMALL);
    sayYes.mockResolvedValue({ ...NEAR_ON_SMALL, tier: { id: 'medium', name: 'Medium', paths: 20, monthly: 12 } });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Move up to Medium' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, I agree' }));
    await waitFor(() => expect(sayYes).toHaveBeenCalledWith({ choice: 'move_up', tierId: 'medium', priceEur: 12 }));
  });

  it('refused because the offer changed, shows the offer now and says nothing was agreed', async () => {
    getCeiling.mockResolvedValue(NEAR_ON_SMALL);
    const now: Ceiling = {
      ...NEAR_ON_SMALL,
      // The meter passed Medium's ceiling in between: the move up is now to Large.
      gbMoved: 2100,
      moveUp: { tierId: 'large', name: 'Large', paths: 50, monthlyEur: 40, ceilingGb: 7500 },
    };
    sayYes.mockRejectedValue(refused({ error: 'offer_changed', reason: 'What is offered has changed.', ceiling: now }));
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Move up to Medium' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, I agree' }));
    expect(await screen.findByText(/nothing was agreed\. This is the offer now/)).toBeVisible();
    expect(screen.getByText(/Move up to Large: €40\.00 a month/)).toBeVisible();
  });
});

describe('during the alpha', () => {
  it('says where the data stands and what the ways on cost, and offers no button', async () => {
    getCeiling.mockResolvedValue({ ...NEAR_ON_SMALL, gbMoved: 900, share: 1.2, state: 'reached', holds: false });
    renderCard();
    expect(await screen.findByText(/During the Alpha nothing waits at the ceiling/)).toBeVisible();
    expect(screen.getByText(/Move up to Medium: €12\.00 a month/)).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/New items wait/)).toBeNull();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });
});
