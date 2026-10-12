// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A year paid ahead, on the Billing page (workplan 0111 T11, slice Y2; ADR-0014,
 * *Amendment 2026-10-04*; terms §8).
 *
 * What a person meets: the tiers a year may be bought for, each at its year's
 * price and its half price a month, and when it would start; an order sent only
 * after the money is said once more, by the order button terms §6 promises, with
 * what it sent being what the card showed; a year above the month's tier said to
 * be a pick of it too; once a year is bought, the credit left and the months at
 * half price; a refusal showing the year as it is now; and during the alpha the
 * years with no button. In Dutch as well.
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, type AxiosResponse } from 'axios';
import { MemoryRouter } from 'react-router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import YearAhead from './YearAhead.tsx';
import { billingApi, type YearOffer } from '../services/billing-service.ts';
import { LocaleProvider } from '../i18n/index.tsx';

vi.mock('../services/billing-service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/billing-service.ts')>()),
  billingApi: { getYear: vi.fn(), orderYear: vi.fn(), getWithdrawal: vi.fn() },
}));

const getYear = vi.mocked(billingApi.getYear);
const orderYear = vi.mocked(billingApi.orderYear);
const getWithdrawal = vi.mocked(billingApi.getWithdrawal);
const WINDOW = {
  open: false,
  reason: 'nothing_paid' as const,
  since: null,
  until: null,
  tier: null,
  name: null,
  confirmTo: null,
  yesAsksToBegin: false,
};

const tierOf = (id: 'small' | 'medium' | 'large' | 'xl', name: string, monthlyCents: number) => ({
  id,
  name,
  monthlyCents,
  yearCents: monthlyCents * 6,
  priceFrom: 'list' as const,
});

/** On Small, no year: Small or higher, from November. */
const ON_SMALL: YearOffer = {
  holds: true,
  billed: { id: 'small', name: 'Small' },
  tiers: [tierOf('small', 'Small', 500), tierOf('medium', 'Medium', 1200), tierOf('large', 'Large', 4000), tierOf('xl', 'Extra large', 8000)],
  placement: { creditFrom: '2026-11', halfFrom: '2026-11', halfTo: '2027-10' },
  credit: { leftCents: 0, yearMonth: false },
  heldCents: 0,
  years: [],
  yearsBefore: 0,
};

/** A year of Medium bought, this month one of it. */
const WITH_YEAR: YearOffer = {
  ...ON_SMALL,
  billed: { id: 'medium', name: 'Medium' },
  tiers: ON_SMALL.tiers.slice(1),
  placement: { creditFrom: '2026-12', halfFrom: '2027-11', halfTo: '2028-10' },
  credit: { leftCents: 6600, yearMonth: true },
  heldCents: 6600,
  years: [{ tierId: 'medium', cents: 7200, creditFrom: '2026-11', halfFrom: '2026-11', halfTo: '2027-10' }],
  yearsBefore: 1,
};

/** A year of Medium bought in October, which was billed: its credit pays from November. */
const BOUGHT_FOR_NEXT_MONTH: YearOffer = {
  ...WITH_YEAR,
  placement: { creditFrom: '2026-11', halfFrom: '2027-11', halfTo: '2028-10' },
  credit: { leftCents: 0, yearMonth: false },
  heldCents: 7200,
};

function renderCard(locale: 'en' | 'nl' = 'en') {
  localStorage.setItem('ownpace.locale', locale);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/billing']}>
        <LocaleProvider>
          <YearAhead />
        </LocaleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

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
  getYear.mockReset();
  orderYear.mockReset();
  getWithdrawal.mockReset();
  getWithdrawal.mockResolvedValue(WINDOW);
  localStorage.clear();
});

describe('the years offered', () => {
  it("lists the tier the month bills and the higher ones, each at its year's price, and when it would start", async () => {
    getYear.mockResolvedValue(ON_SMALL);
    renderCard();
    expect(await screen.findByRole('heading', { name: 'A year ahead' })).toBeVisible();
    expect(screen.getByText(/Pay a year ahead at six months' price/)).toBeVisible();
    expect(screen.getByText('It would start in November 2026, at half price to October 2027.')).toBeVisible();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(within(items[1]!).getByText(/€72\.00 for the year \(€6\.00 a month, half the monthly price\)/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'A year of Medium' })).toBeVisible();
    expect(screen.queryByText(/Credit left/)).toBeNull();
  });

  it('offers no button during the alpha, and says why', async () => {
    getYear.mockResolvedValue({ ...ON_SMALL, holds: false });
    renderCard();
    expect(await screen.findByText(/During the Alpha nothing is charged/)).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says the credit left and the months at half price once a year is bought, and where another would fall', async () => {
    getYear.mockResolvedValue(WITH_YEAR);
    renderCard();
    expect(await screen.findByText('Credit left: €66.00.')).toBeVisible();
    expect(screen.getByText('Half price from November 2026 to October 2027.')).toBeVisible();
    expect(screen.getByText("This month is one of your year's: half price, from your credit.")).toBeVisible();
    expect(
      screen.getByText(
        'Its credit would pay from December 2026; its twelve months at half price follow your current year, November 2027 to October 2028.',
      ),
    ).toBeVisible();
  });

  it('says the credit held before its first month has come, and not that this month is one of it', async () => {
    getYear.mockResolvedValue(BOUGHT_FOR_NEXT_MONTH);
    renderCard();
    expect(await screen.findByText('Credit left: €72.00.')).toBeVisible();
    expect(screen.getByText('Half price from November 2026 to October 2027.')).toBeVisible();
    expect(screen.queryByText(/This month is one of your year's/)).toBeNull();
  });

  it('says it all in Dutch', async () => {
    getYear.mockResolvedValue(WITH_YEAR);
    renderCard('nl');
    expect(await screen.findByRole('heading', { name: 'Een jaar vooruit' })).toBeVisible();
    expect(screen.getByText('Tegoed over: € 66,00.')).toBeVisible();
    expect(screen.getByText('Halve prijs van november 2026 tot en met oktober 2027.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Een jaar Medium' })).toBeVisible();
  });
});

describe('an order', () => {
  it('asks once more with the money said, and sends what the card showed only by the order button', async () => {
    getYear.mockResolvedValue(ON_SMALL);
    orderYear.mockResolvedValue({ ...WITH_YEAR, ordered: { tierId: 'small', cents: 3000, ...ON_SMALL.placement } });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'A year of Small' }));
    const question = screen.getByRole('alertdialog');
    expect(
      within(question).getByText(
        'A year of Small for €30.00, invoiced now. It is credit: each month takes its own tier at half its monthly price, and it is not refunded.',
      ),
    ).toBeVisible();
    expect(orderYear).not.toHaveBeenCalled();
    fireEvent.click(within(question).getByRole('button', { name: 'Order with obligation to pay' }));
    await waitFor(() => expect(orderYear).toHaveBeenCalledWith({ tierId: 'small', yearCents: 3000, yearsBefore: 0 }));
    expect(
      await screen.findByText('Ordered: a year of Small, from November 2026. Its invoice follows within the hour, under Invoices.'),
    ).toBeVisible();
  });

  it('says a year above the tier the month bills is a pick of it too', async () => {
    getYear.mockResolvedValue(ON_SMALL);
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'A year of Large' }));
    expect(
      within(screen.getByRole('alertdialog')).getByText(/From today each month bills at least Large, until you lower it\./),
    ).toBeVisible();
  });

  it('shows the year as it is now when the server refuses the offer it was sent', async () => {
    getYear.mockResolvedValue(ON_SMALL);
    orderYear.mockRejectedValue(refused({ error: 'offer_changed', year: WITH_YEAR }));
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'A year of Small' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Order with obligation to pay' }));
    expect(await screen.findByText(/What a year would be has changed since this page was shown/)).toBeVisible();
    expect(screen.getByText('Credit left: €66.00.')).toBeVisible();
  });
});
