// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The withdrawal function on the Billing page (workplan 0111 T7, slice 7c;
 * 0152 T6 (f); terms §7; article 11a of the Consumer Rights Directive).
 *
 * What a consumer meets while they may withdraw: the last day, and a button in
 * the directive's words; then a second step, with the focus on it, where they
 * confirm their name, see the contract, and confirm where the confirmation
 * goes, and a button *Confirm withdrawal*; then when it was withdrawn, that
 * the organisation is on Free, and where the confirmation went. Outside the
 * window the card is not there. A refusal is said in the server's words.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, type AxiosResponse } from 'axios';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Withdrawal from './Withdrawal.tsx';
import { billingApi, type WithdrawalState } from '../services/billing-service.ts';
import { LocaleProvider } from '../i18n/index.tsx';

vi.mock('../services/billing-service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/billing-service.ts')>()),
  billingApi: { getWithdrawal: vi.fn(), withdraw: vi.fn() },
}));

const getWithdrawal = vi.mocked(billingApi.getWithdrawal);
const withdraw = vi.mocked(billingApi.withdraw);

/** Small since 1 October; too late from the start of 16 October, UTC. */
const OPEN: WithdrawalState = {
  open: true,
  since: '2026-10-01T09:30:00.000Z',
  until: '2026-10-16T00:00:00.000Z',
  tier: { id: 'small', name: 'Small' },
  name: 'Sam de Vries',
  confirmTo: 'sam@example.invalid',
  yesAsksToBegin: true,
};

function renderCard(locale: 'en' | 'nl' = 'en') {
  localStorage.setItem('ownpace.locale', locale);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { client, ...render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <Withdrawal />
      </LocaleProvider>
    </QueryClientProvider>,
  ) };
}

beforeEach(() => {
  getWithdrawal.mockReset();
  withdraw.mockReset();
  localStorage.clear();
});

describe('the withdrawal function', () => {
  it('says the last day, and offers the button in the directive’s words', async () => {
    getWithdrawal.mockResolvedValue(OPEN);
    renderCard();

    expect(await screen.findByText(/withdraw from your contract for Ownpace Small until the end of October 15, 2026/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Withdraw from contract here' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm withdrawal' })).toBeNull();
  });

  it('asks for the name, says the contract, and asks where the confirmation goes, with the focus on it', async () => {
    getWithdrawal.mockResolvedValue(OPEN);
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw from contract here' }));

    const form = screen.getByRole('form', { name: 'Withdraw from your contract' });
    await waitFor(() => expect(document.activeElement).toBe(form));
    expect((screen.getByLabelText('Your name') as HTMLInputElement).value).toBe('Sam de Vries');
    expect(screen.getByText('Ownpace Small, concluded on October 1, 2026')).toBeTruthy();
    expect((screen.getByLabelText('Confirmation to') as HTMLInputElement).value).toBe('sam@example.invalid');
    expect(withdraw).not.toHaveBeenCalled();
  });

  it('sends what was confirmed, and says when, that it is Free, and where the confirmation went', async () => {
    getWithdrawal.mockResolvedValue(OPEN);
    withdraw.mockResolvedValue({
      withdrawnAt: '2026-10-03T10:04:00.000Z',
      since: OPEN.since!,
      tier: { id: 'small', name: 'Small' },
      credits: 1,
      beganOnRequest: false,
      confirmation: 'sent',
    });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw from contract here' }));
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: '  Sam de Vries ' } });
    fireEvent.change(screen.getByLabelText('Confirmation to'), { target: { value: 'other@example.invalid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm withdrawal' }));

    await waitFor(() => expect(withdraw).toHaveBeenCalledWith({ name: 'Sam de Vries', confirmTo: 'other@example.invalid' }));
    expect(
      await screen.findByText(
        'Withdrawn on October 3, 2026. Your organisation is on Free. A confirmation is on its way to other@example.invalid.',
      ),
    ).toBeTruthy();
  });

  it('says so when the confirmation could not be sent, in Dutch too', async () => {
    getWithdrawal.mockResolvedValue(OPEN);
    withdraw.mockResolvedValue({
      withdrawnAt: '2026-10-03T10:04:00.000Z',
      since: OPEN.since!,
      tier: { id: 'small', name: 'Small' },
      credits: 1,
      beganOnRequest: false,
      confirmation: 'failed',
    });
    renderCard('nl');
    expect(await screen.findByText(/tot en met 15 oktober 2026 herroepen/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hier de overeenkomst herroepen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Herroeping bevestigen' }));

    expect(
      await screen.findByText(
        'Herroepen op 3 oktober 2026. Uw organisatie staat op Free. De bevestiging kon nu niet worden verstuurd: we sturen die zelf naar sam@example.invalid.',
      ),
    ).toBeTruthy();
  });

  it('says a refusal in the server’s words, and keeps the form', async () => {
    getWithdrawal.mockResolvedValue(OPEN);
    withdraw.mockRejectedValue(
      new AxiosError('409', '409', undefined, undefined, {
        status: 409,
        data: { error: 'withdrawal_closed', message: 'The fourteen days to withdraw are over (terms §7).' },
      } as AxiosResponse),
    );
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw from contract here' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm withdrawal' }));

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('The fourteen days to withdraw are over'));
    expect(screen.getByRole('button', { name: 'Confirm withdrawal' })).toBeTruthy();
  });

  it('is not there on Free, for a business, or after the fourteen days', async () => {
    for (const reason of ['nothing_paid', 'business', 'past'] as const) {
      // `open` decides, whatever else the answer carries.
      getWithdrawal.mockResolvedValue({ ...OPEN, open: false, reason });
      const { client, container, unmount } = renderCard();
      // Once the read has answered, not before: an empty card while loading proves nothing.
      await waitFor(() => expect(client.getQueryState(['billing-withdrawal'])?.status).toBe('success'));
      expect(container.textContent).toBe('');
      unmount();
      getWithdrawal.mockReset();
    }
  });
});
