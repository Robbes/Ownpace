// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * *YOUR NEW ADDRESS: ‹address›. IS THAT RIGHT?* on the grant and progress
 * pages (workplan 0168 §4.4, D6): a proposed row is confirmed by the person
 * by their link, a confirmed row can be sent back, the buttons follow the row
 * after a press, and a page whose payload carries no rows says nothing about
 * an address.
 *
 * *Not right?* is offered on a confirmed row only. On a proposed one there is
 * nothing to send back: the press changed nothing and the line then said
 * *Sent back*, and the line it said promised a notice nobody sends.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, AxiosHeaders } from 'axios';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { YourNewAddress } from './YourNewAddress.tsx';
import { LocaleProvider } from '../i18n/index.tsx';
import { answerAddressChangeByLink, type LinkAddressChange } from '../services/link-address-service.ts';

vi.mock('../services/link-address-service', () => ({ answerAddressChangeByLink: vi.fn() }));

const ROW: LinkAddressChange = {
  oldKey: 'name@gmail.com',
  oldAddress: 'name@gmail.com',
  newAddress: 'first@example.org',
  state: 'proposed',
};

const renderWith = (changes: ReadonlyArray<LinkAddressChange> | undefined, door: 'grant' | 'view' = 'grant') =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LocaleProvider>
        <YourNewAddress door={door} link="p.l1.secret" changes={changes} queryKey={['grant', 'p.l1.secret']} />
      </LocaleProvider>
    </QueryClientProvider>,
  );

/** What the server answers for a press: the row in its new state. */
const answersWith = () =>
  vi
    .mocked(answerAddressChangeByLink)
    .mockImplementation(async (_door, _link, _key, state) => ({ ...ROW, state }));

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.setItem('ownpace.locale', 'en');
  answersWith();
});

afterEach(() => {
  window.localStorage.removeItem('ownpace.locale');
});

describe('Your new address, by the person’s link', () => {
  it('asks, and Yes confirms the row by the link, after which Not right? can take it back', async () => {
    const user = userEvent.setup();
    renderWith([ROW]);
    expect(screen.getByText('Your new address: first@example.org. Is that right?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yes, that is right' }));
    expect(answerAddressChangeByLink).toHaveBeenCalledWith('grant', 'p.l1.secret', 'name@gmail.com', 'confirmed');
    expect(await screen.findByRole('status')).toHaveTextContent('Confirmed: first@example.org.');
    expect(screen.queryByRole('button', { name: 'Yes, that is right' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Not right?' })).toBeInTheDocument();
  });

  it('sends a row somebody confirmed for them back on Not right?, and says what that does', async () => {
    const user = userEvent.setup();
    renderWith([{ ...ROW, state: 'confirmed' }], 'view');
    expect(screen.queryByRole('button', { name: 'Yes, that is right' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Not right?' }));
    expect(answerAddressChangeByLink).toHaveBeenCalledWith('view', 'p.l1.secret', 'name@gmail.com', 'proposed');
    // The truth, not a notice nobody sends.
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Sent back. It changes nothing until it is confirmed again, and whoever set it up sees it waiting on their pages.',
    );
    expect(screen.queryByText(/will change it/)).toBeNull();
    // And a press made by mistake can be taken back at once.
    expect(screen.getByRole('button', { name: 'Yes, that is right' })).toBeInTheDocument();
  });

  it('offers no Not right? on a row nobody confirmed, and says it changes nothing until it is', () => {
    renderWith([ROW]);
    expect(screen.getByRole('button', { name: 'Yes, that is right' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Not right?' })).toBeNull();
    expect(
      screen.getByText(
        'Not right? Then leave it: it changes nothing until it is confirmed, and whoever set it up sees it waiting on their pages.',
      ),
    ).toBeInTheDocument();
  });

  it('names the line each button answers, so two rows are not two identical buttons', () => {
    renderWith([ROW, { ...ROW, oldKey: 'name@hotmail.com', oldAddress: 'name@hotmail.com', state: 'confirmed' }]);
    expect(screen.getByRole('button', { name: 'Yes, that is right' })).toHaveAccessibleDescription(
      'Your new address: first@example.org. Is that right?',
    );
    expect(screen.getByRole('button', { name: 'Not right?' })).toHaveAccessibleDescription(
      'Your new address: first@example.org. Is that right?',
    );
  });

  it('says a refusal beside the row, in the server’s words in the page’s language', async () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    vi.mocked(answerAddressChangeByLink).mockRejectedValue(
      new AxiosError('Request failed with status code 404', 'ERR_BAD_REQUEST', undefined, undefined, {
        status: 404,
        statusText: 'Not Found',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: {
          error: 'address_change_not_found',
          message: 'There is no address change for name@gmail.com. It may have been deleted already.',
          messageNl: 'Er is geen adreswijziging voor name@gmail.com. Misschien is die al verwijderd.',
        },
      }),
    );
    const user = userEvent.setup();
    renderWith([ROW]);
    await user.click(screen.getByRole('button', { name: 'Ja, dat klopt' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Niet opgeslagen: Er is geen adreswijziging voor name@gmail.com. Misschien is die al verwijderd.',
    );
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says it all in Dutch for a Dutch reader', async () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    const user = userEvent.setup();
    renderWith([ROW]);
    expect(screen.getByText('Uw nieuwe adres: first@example.org. Klopt dat?')).toBeInTheDocument();
    expect(
      screen.getByText(
        "Klopt het niet? Laat het dan zo: het verandert niets tot het is bevestigd, en wie het heeft ingesteld, ziet op de eigen pagina's dat het wacht.",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ja, dat klopt' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Bevestigd: first@example.org.');
    await user.click(screen.getByRole('button', { name: 'Klopt het niet?' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      "Teruggestuurd. Het verandert niets tot het opnieuw is bevestigd, en wie het heeft ingesteld, ziet op de eigen pagina's dat het wacht.",
    );
  });

  it('says nothing where the payload carries no rows', () => {
    const { container } = renderWith(undefined);
    expect(container).toBeEmptyDOMElement();
    const empty = renderWith([]);
    expect(empty.container).toBeEmptyDOMElement();
  });
});
