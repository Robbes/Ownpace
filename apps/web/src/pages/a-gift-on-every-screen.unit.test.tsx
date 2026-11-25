// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * GIFTS ON THE THREE SCREENS (workplan 0172).
 *
 *  - **The door.** *I have a gift code* opens the field; `/redeem` and
 *    `?gift=1` arrive with it open. With a code, the request goes to the gift
 *    route with the code beside the person's own fields; without one, to the
 *    request route as before. A refused code is said in the page's language.
 *  - **Give Ownpace.** Making a gift sends the card's language and nothing
 *    else; the code is shown on the card with the names and message typed on
 *    the page, which are never sent. At the limit there is no button.
 *  - **The operator's Gifts.** The count, the rule, and every gift with its
 *    giver.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import RequestAccess from './RequestAccess.tsx';
import Give from './Give.tsx';
import Gifts from './Gifts.tsx';
import { LocaleProvider } from '../i18n/index.tsx';
import { en as giftsEn, nl as giftsNl } from '../i18n/strings/gifts.ts';

const postMock = vi.fn();
const getMock = vi.fn();
const putMock = vi.fn();
vi.mock('../services/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api.ts')>()),
  default: {
    post: (...args: unknown[]) => postMock(...args),
    get: (...args: unknown[]) => getMock(...args),
    put: (...args: unknown[]) => putMock(...args),
  },
}));

const wrap = (ui: React.ReactElement, path = '/') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <LocaleProvider>
        <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  );

beforeEach(() => {
  postMock.mockReset();
  getMock.mockReset();
  putMock.mockReset();
  window.localStorage.clear();
});

describe('the door', () => {
  it('opens the code field on request, and sends the code to the gift route', async () => {
    const user = userEvent.setup();
    postMock.mockResolvedValue({ data: { received: true } });
    wrap(<RequestAccess />, '/request-access?locale=en');
    expect(screen.queryByLabelText('Gift code')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'I have a gift code' }));
    await user.type(screen.getByLabelText('Gift code'), 'k7qm-3xr2-pa9d-w4hn');
    await user.type(screen.getByLabelText(/email address/i), 'cato@example.test');
    await user.click(screen.getByRole('button', { name: /send request/i }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock.mock.calls[0]![0]).toBe('/gifts/redeem');
    expect(postMock.mock.calls[0]![1]).toEqual({ email: 'cato@example.test', locale: 'en', code: 'k7qm-3xr2-pa9d-w4hn' });
    expect(await screen.findByText('Thank you — we have your request, with your gift.')).toBeInTheDocument();
  });

  it('arrives with the field open at /redeem and from the site’s ?gift=1', () => {
    wrap(<RequestAccess giftDoor />, '/redeem');
    expect(screen.getByLabelText('Gift code')).toBeInTheDocument();
  });

  it('without a code, asks as it always did', async () => {
    const user = userEvent.setup();
    postMock.mockResolvedValue({ data: { received: true } });
    wrap(<RequestAccess />, '/request-access?gift=1&locale=en');
    await user.type(screen.getByLabelText(/email address/i), 'dirk@example.test');
    await user.click(screen.getByRole('button', { name: /send request/i }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock.mock.calls[0]![0]).toBe('/access-requests');
  });

  it('says a refused code in the page’s language', async () => {
    const user = userEvent.setup();
    const refused = new AxiosError('Request failed with status code 410', '410', undefined, undefined, {
      status: 410,
      statusText: 'Gone',
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: { error: 'gift_refused', reason: 'This gift code cannot be used.', reasonNl: 'Deze cadeaucode kan niet worden gebruikt.' },
    });
    postMock.mockRejectedValue(refused);
    wrap(<RequestAccess giftDoor />, '/redeem?locale=nl');
    await user.type(screen.getByLabelText('Cadeaucode'), 'ZZZZ-ZZZZ-ZZZZ-ZZZZ');
    await user.type(screen.getByLabelText(/e-mailadres/i), 'cato@example.test');
    await user.click(screen.getByRole('button', { name: /verstuur|versturen|aanvraag/i }));
    expect(await screen.findByText(/Deze cadeaucode kan niet worden gebruikt\./)).toBeInTheDocument();
  });
});

describe('Give Ownpace', () => {
  const MINE = { gifts: [], limit: 1, held: 0, redeemAt: 'https://app.example.test/redeem' };

  it('sends only the card’s language, and shows the code on the card with what was typed on the page', async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({ data: MINE });
    postMock.mockResolvedValue({
      data: { id: 'g-1', code: 'K7QM-3XR2-PA9D-W4HN', expiresAt: '2028-12-24T18:00:00.000Z', redeemAt: MINE.redeemAt },
    });
    wrap(<Give />);
    await user.selectOptions(await screen.findByLabelText(/language of the card/i), 'nl');
    await user.click(screen.getByRole('button', { name: /make my gift/i }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock.mock.calls[0]).toEqual(['/gifts', { locale: 'nl' }]);

    expect(await screen.findByTestId('gift-code')).toHaveTextContent('K7QM-3XR2-PA9D-W4HN');
    expect(screen.getByText('app.example.test/redeem')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/the recipient’s first name/i), 'Cato');
    await user.type(screen.getByLabelText(/a message/i), 'Fijne feestdagen');
    const card = within(screen.getByTestId('gift-code').closest('section')!);
    expect(card.getByText('Voor Cato: een plaats in Ownpace')).toBeInTheDocument();
    expect(card.getByText('Fijne feestdagen')).toBeInTheDocument();
    expect(card.getByText('Geldig tot 24 december 2028')).toBeInTheDocument();
    // Still the one call: typing on the card sends nothing.
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(putMock).not.toHaveBeenCalled();
  });

  it('offers no button at the limit', async () => {
    getMock.mockResolvedValue({
      data: {
        ...MINE,
        held: 1,
        gifts: [
          { id: 'g-1', locale: 'en', createdAt: '2026-12-01T10:00:00Z', expiresAt: '2028-12-01T10:00:00Z', redeemedAt: null, revokedAt: null, state: 'unused' },
        ],
      },
    });
    wrap(<Give />);
    expect(await screen.findByText(/you have given your gift already/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /make my gift/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
  });
});

describe('the operator’s Gifts', () => {
  it('shows the count, says there is no cap, and lists each gift with its giver', async () => {
    getMock.mockResolvedValue({
      data: {
        gifts: [
          {
            id: 'g-1',
            locale: 'nl',
            createdAt: '2026-12-01T10:00:00Z',
            expiresAt: '2028-12-01T10:00:00Z',
            redeemedAt: '2026-12-25T10:00:00Z',
            revokedAt: null,
            state: 'redeemed',
            giverEmail: 'anna@example.test',
            organisation: 'De Vries',
            request: { id: 'r-1', state: 'open', email: 'cato@example.test' },
          },
        ],
        giftsPerPerson: 1,
        allowances: [],
        alpha: { granted: 12, open: 3, openFromGifts: 1, unusedGifts: 4 },
      },
    });
    wrap(<Gifts />);
    expect(await screen.findByText('12')).toBeInTheDocument();
    expect(screen.getByText(/nothing refuses a grant past a number/i)).toBeInTheDocument();
    expect(screen.getByText(/From anna@example\.test/)).toBeInTheDocument();
    expect(screen.getByText('Became the request from cato@example.test: open')).toBeInTheDocument();
  });
});

describe("the owner's words (2026-11-25, workplan 0172 T8)", () => {
  it('are the ones on the giver’s page and the card, Dutch first', () => {
    expect(giftsNl['give.intro']).toBe('Geef iemand die u dierbaar is een plaats in de Alpha, op een kaart.');
    expect(giftsEn['give.intro']).toBe('Give someone dear to you a place in the Alpha, on a card.');
    expect(giftsNl['give.how']).toContain('dus een cadeau is een persoonlijke aanbeveling, geen sleutel.');
    expect(giftsEn['give.how']).toContain('so a gift is a personal recommendation rather than a key.');
    expect(giftsNl['give.privacy']).toMatch(/een vingerafdruk van de code en de datums\.$/);
    expect(giftsNl['give.recipient']).toBe('Voornaam van de ontvanger');
    expect(giftsEn['give.recipient']).toBe('The recipient’s first name');
    expect(Object.values(giftsNl).some((v) => v.startsWith('Ownpace zit in een gratis Alpha, en we laten mensen zelf toe.'))).toBe(true);
    for (const words of [...Object.values(giftsNl), ...Object.values(giftsEn)]) {
      expect(words).not.toMatch(/om wie u geeft|warme introductie|warm introduction|Hun voornaam|Ownpace is in een gratis/);
    }
  });
});
