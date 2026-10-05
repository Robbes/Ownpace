// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Picking a tier on the Billing page (workplan 0157 T6; ADR-0014, *Amendment
 * 2026-10-04, evening*).
 *
 * What a person meets: every tier above the one this month bills, with its
 * monthly, its room and its pace; a pick sent only after the money is said
 * once more, by the order button terms §6 promises; a lower pick that counts
 * from the next month, said with its day, and the tier picked now offered
 * again to keep it; and during the alpha the tiers with no button.
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, type AxiosResponse } from 'axios';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TierPick from './TierPick.tsx';
import { billingApi, type PickOffer, type PickTier } from '../services/billing-service.ts';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';

vi.mock('../services/billing-service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/billing-service.ts')>()),
  billingApi: { getPick: vi.fn(), pickTier: vi.fn() },
}));

const getPick = vi.mocked(billingApi.getPick);
const pickTier = vi.mocked(billingApi.pickTier);

const FREE: PickTier = { id: 'free', name: 'Free', paths: 6, dataGb: 150, monthlyEur: 0, annualEur: 0 };
const SMALL: PickTier = { id: 'small', name: 'Small', paths: 6, dataGb: 500, monthlyEur: 5, annualEur: 30 };
const MEDIUM: PickTier = { id: 'medium', name: 'Medium', paths: 12, dataGb: 1500, monthlyEur: 12, annualEur: 72 };
const LARGE: PickTier = { id: 'large', name: 'Large', paths: 24, dataGb: 6000, monthlyEur: 40, annualEur: 240 };
const XL: PickTier = { id: 'xl', name: 'Extra large', paths: 50, dataGb: 15000, monthlyEur: 80, annualEur: 480 };

const NEXT_FROM = '2026-11-01T00:00:00.000Z';

/** On Free, nothing picked: every paid tier offered. */
const ON_FREE: PickOffer = {
  holds: true,
  billed: FREE,
  picked: { now: null, next: null, nextFrom: NEXT_FROM },
  raise: [SMALL, MEDIUM, LARGE, XL],
  lower: [],
};

/** Small picked: this month bills Small; Free to lower to. */
const PICKED_SMALL: PickOffer = {
  holds: true,
  billed: SMALL,
  picked: { now: SMALL, next: SMALL, nextFrom: NEXT_FROM },
  raise: [MEDIUM, LARGE, XL],
  lower: [FREE],
};

/** Small picked, then dropped this month: Small offered again, to keep it. */
const DROPPED: PickOffer = {
  holds: true,
  billed: SMALL,
  picked: { now: SMALL, next: null, nextFrom: NEXT_FROM },
  raise: [SMALL, MEDIUM, LARGE, XL],
  lower: [],
};

function renderCard(locale: 'en' | 'nl' = 'en') {
  localStorage.setItem('ownpace.locale', locale);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <TierPick />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

/** A 409 as axios hands it over: the server's code, its sentence, and what is offered now. */
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
  getPick.mockReset();
  pickTier.mockReset();
  localStorage.clear();
});

describe('the tiers offered', () => {
  it('lists every tier above the one this month bills, with its monthly and its room, and the pace once', async () => {
    getPick.mockResolvedValue(ON_FREE);
    renderCard();
    expect(await screen.findByRole('heading', { name: 'Pick a tier' })).toBeVisible();
    expect(screen.getByText(/Your tier follows what you use/)).toBeVisible();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(4);
    const small = within(items[0]!);
    expect(small.getByText('Small')).toBeVisible();
    expect(small.getByText(/€5\.00 a month/)).toBeVisible();
    expect(small.getByText('6 migrations at the same time, up to 500 GB.')).toBeVisible();
    expect(within(items[3]!).getByText('50 migrations at the same time, up to 15 TB.')).toBeVisible();
    // Every paid tier runs at the same pace: said once, above the list.
    expect(screen.getAllByText(/Every tier here copies pass after pass until the first copy is done/)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Pick Small' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Lower to|Drop the pick/ })).toBeNull();
  });

  it('says the highest tier when there is none above it', async () => {
    getPick.mockResolvedValue({ ...ON_FREE, billed: XL, raise: [] });
    renderCard();
    expect(await screen.findByText('Extra large is the highest tier. For more, talk to us.')).toBeVisible();
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('offers no button during the alpha, and says why', async () => {
    getPick.mockResolvedValue({ ...ON_FREE, holds: false });
    renderCard();
    expect(await screen.findByText(/During the Alpha every tier is free/)).toBeVisible();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('a pick', () => {
  it('asks once more with the money said, under the tier pressed, and sends it only by the order button', async () => {
    getPick.mockResolvedValue(ON_FREE);
    pickTier.mockResolvedValue({ ...PICKED_SMALL, from: 'now' });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Pick Small' }));
    const dialog = screen.getByRole('alertdialog');
    // Where the press was, with the focus on the question, never on the order button.
    expect(screen.getAllByRole('listitem')[0]).toContainElement(dialog);
    expect(dialog).toHaveFocus();
    expect(
      within(dialog).getByText(
        'From today each month bills at least Small, €5.00 a month, until you lower it. Lowering counts from the next month.',
      ),
    ).toBeVisible();
    expect(pickTier).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Order with obligation to pay' }));
    await waitFor(() => expect(pickTier).toHaveBeenCalledWith({ tierId: 'small', priceEur: 5 }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      "Done: Small's pace and room are yours now, and each month bills at least Small.",
    );
    expect(screen.getByText('You picked Small. Each month bills at least Small, until you lower it.')).toBeVisible();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('sends nothing on Not now', async () => {
    getPick.mockResolvedValue(ON_FREE);
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Pick Medium' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(pickTier).not.toHaveBeenCalled();
  });

  it('shows what is offered now when the offer changed in between', async () => {
    getPick.mockResolvedValue(ON_FREE);
    pickTier.mockRejectedValue(refused({ error: 'offer_changed', message: 'changed', pick: PICKED_SMALL }));
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Pick Small' }));
    fireEvent.click(screen.getByRole('button', { name: 'Order with obligation to pay' }));
    expect(await screen.findByText(/What may be picked has changed since this page was shown/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Pick Small' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pick Medium' })).toBeVisible();
  });
});

describe('lowering the pick', () => {
  it('counts from the next month, said with its day, and orders nothing', async () => {
    getPick.mockResolvedValue(PICKED_SMALL);
    pickTier.mockResolvedValue({ ...DROPPED, from: 'next_month' });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Drop the pick' }));
    const dialog = screen.getByRole('alertdialog');
    expect(
      within(dialog).getByText(
        'From November 1, 2026, what you use decides your tier again. Until then, each month bills at least Small.',
      ),
    ).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Order with obligation to pay' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lower the pick' }));
    await waitFor(() => expect(pickTier).toHaveBeenCalledWith({ tierId: 'free', priceEur: 0 }));
    expect(await screen.findByRole('status')).toHaveTextContent('Done: your pick changes on November 1, 2026.');
    expect(screen.getByText('From November 1, 2026, what you use decides your tier again.')).toBeVisible();
  });

  it('offers the tier picked now again while a lower pick waits, to keep it, by the order button', async () => {
    getPick.mockResolvedValue(DROPPED);
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Keep Small' }));
    const dialog = screen.getByRole('alertdialog');
    expect(
      within(dialog).getByText('Each month keeps billing at least Small, €5.00 a month, until you lower it.'),
    ).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Order with obligation to pay' })).toBeVisible();
  });

  it('names a lower paid tier by name', async () => {
    getPick.mockResolvedValue({
      ...PICKED_SMALL,
      billed: LARGE,
      picked: { now: LARGE, next: LARGE, nextFrom: NEXT_FROM },
      raise: [XL],
      lower: [FREE, SMALL, MEDIUM],
    });
    renderCard();
    const buttons = (await screen.findAllByRole('button', { name: /Lower to|Drop the pick/ })).map((b) => b.textContent);
    expect(buttons).toEqual(['Lower to Medium', 'Lower to Small', 'Drop the pick']);
  });
});

describe('in Dutch', () => {
  it('says the card, the price, the order button and the day in Dutch', async () => {
    getPick.mockResolvedValue(PICKED_SMALL);
    renderCard('nl');
    expect(await screen.findByRole('heading', { name: STRINGS.nl['billing.pick.title'] })).toBeVisible();
    expect(screen.getByText('U koos Small. U betaalt elke maand minstens Small, tot u het verlaagt.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Kies Medium' }));
    expect(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Bestelling met betalingsverplichting' }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Nu niet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keuze laten vervallen' }));
    expect(within(screen.getByRole('alertdialog')).getByText(/^Vanaf 1 november 2026 bepaalt wat u gebruikt/)).toBeVisible();
  });
});
