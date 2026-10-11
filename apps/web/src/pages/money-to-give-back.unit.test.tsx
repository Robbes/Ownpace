// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * MONEY TO GIVE BACK, ON THE SUPPORT SCREEN (workplan 0111; the owner,
 * 2026-10-11: "yes, build the support list and the email too").
 *
 * The page lists what the hourly invoice push asks the operator to pay back by
 * hand, and what it asks them to watch, and lets them mark one paid back:
 *
 *  - what is owed comes first, with its amount and what happened, and what was
 *    marked comes after, with when and by whom;
 *  - marking takes two presses, because a mark is written once and never taken
 *    back;
 *  - a late refund takes no mark, and says it leaves by itself;
 *  - a failed refund booked in the books says its payment must come off.
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupportMoneyToGiveBack } from './Support.tsx';
import { listMoneyToGiveBack, markMoneyGivenBack, type MoneyToGiveBack } from '../services/support.ts';
import { OPERATOR_STRINGS as O } from '../i18n/operator-strings.ts';

vi.mock('../services/support.ts', () => ({
  listMoneyToGiveBack: vi.fn(),
  markMoneyGivenBack: vi.fn(),
}));

const listMock = vi.mocked(listMoneyToGiveBack);
const markMock = vi.mocked(markMoneyGivenBack);

const item = (over: Partial<MoneyToGiveBack>): MoneyToGiveBack => ({
  creditNoteId: 'c-1',
  tenantId: 't-1',
  organisation: 'Mutsaers BV',
  creditNoteNumber: '2026-0010',
  invoiceNumber: '2026-0009',
  reason: 'by_hand',
  cents: 400,
  currency: 'EUR',
  refundId: null,
  refundStatus: null,
  refundInTheBooks: false,
  saidAt: '2026-10-10T09:41:00.000Z',
  givenBackAt: null,
  givenBackBy: null,
  ...over,
});

const BY_HAND = item({});
const FAILED_BOOKED = item({
  creditNoteId: 'c-2',
  creditNoteNumber: '2026-0012',
  reason: 'refund_failed',
  cents: 300,
  refundId: 're_failed',
  refundStatus: 'failed',
  refundInTheBooks: true,
});
const LATE = item({ creditNoteId: 'c-3', creditNoteNumber: '2026-0014', reason: 'refund_late', refundId: 're_late', refundStatus: 'queued' });
const DONE = item({
  creditNoteId: 'c-4',
  creditNoteNumber: '2026-0016',
  givenBackAt: '2026-10-11T08:00:00.000Z',
  givenBackBy: 'operator@ownpace.eu',
});

const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SupportMoneyToGiveBack />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const section = (heading: string) => screen.getByRole('heading', { name: heading }).closest('section')!;

beforeEach(() => {
  listMock.mockReset();
  markMock.mockReset();
  listMock.mockResolvedValue([BY_HAND, FAILED_BOOKED, LATE, DONE]);
  markMock.mockResolvedValue();
});

describe('money to give back', () => {
  it('lists what is owed first, with its amount and what happened, and what was marked after', async () => {
    mount();
    await screen.findByText('2026-0010');
    const open = within(section(O['support.money.open.heading']));
    expect(open.getByText('2026-0010')).toBeInTheDocument();
    expect(open.getByText('2026-0012')).toBeInTheDocument();
    expect(open.getByText('2026-0014')).toBeInTheDocument();
    expect(open.queryByText('2026-0016')).not.toBeInTheDocument();
    expect(open.getAllByText('Mutsaers BV')[0]!.closest('a')).toHaveAttribute('href', '/support/tenants/t-1');
    const byHandRow = within(open.getByText('2026-0010').closest('tr')!);
    expect(byHandRow.getByText(/4\.00/)).toBeInTheDocument();
    expect(open.getByText(O['support.money.reason.by_hand'])).toBeInTheDocument();

    const done = within(section(O['support.money.done.heading']));
    expect(done.getByText('2026-0016')).toBeInTheDocument();
    expect(done.getByText(/by operator@ownpace\.eu/)).toBeInTheDocument();
  });

  it('says a failed refund booked in the books must come off the credit note', async () => {
    mount();
    expect(await screen.findByText(/Mollie’s refund re_failed failed: pay back by bank transfer\./)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(O['support.money.reason.inTheBooks']))).toBeInTheDocument();
  });

  it('gives a late refund no mark, and says it leaves by itself', async () => {
    mount();
    const row = (await screen.findByText('2026-0014')).closest('tr')!;
    expect(within(row).getByText(O['support.money.watching'])).toBeInTheDocument();
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
  });

  it('marks one paid back on the second press, and reads the list again', async () => {
    mount();
    const row = (await screen.findByText('2026-0010')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: O['support.money.mark'] }));
    expect(markMock).not.toHaveBeenCalled();
    expect(within(row).getByText(O['support.money.mark.confirm'])).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: O['support.money.mark.yes'] }));
    await waitFor(() => expect(markMock).toHaveBeenCalledWith('c-1'));
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
  });

  it('says plainly when nothing is owed', async () => {
    listMock.mockResolvedValue([]);
    mount();
    expect(await screen.findByText(O['support.money.open.none'])).toBeInTheDocument();
    expect(screen.getByText(O['support.money.done.none'])).toBeInTheDocument();
  });
});
