// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * *YOUR NEW ADDRESS: ‹address›. IS THAT RIGHT?* on the grant and progress
 * pages (workplan 0168 §4.4, D6): a proposed row is confirmed by the person
 * by their link, any row can be sent back, and a page whose payload carries
 * no rows says nothing about an address.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { YourNewAddress } from './YourNewAddress.tsx';
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
      <YourNewAddress door={door} link="p.l1.secret" changes={changes} queryKey={['grant', 'p.l1.secret']} />
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(answerAddressChangeByLink).mockResolvedValue(ROW);
});

describe('Your new address, by the person’s link', () => {
  it('asks, and Yes confirms the row by the link', async () => {
    const user = userEvent.setup();
    renderWith([ROW]);
    expect(screen.getByText('Your new address: first@example.org. Is that right?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yes, that is right' }));
    expect(answerAddressChangeByLink).toHaveBeenCalledWith('grant', 'p.l1.secret', 'name@gmail.com', 'confirmed');
    expect(await screen.findByRole('status')).toHaveTextContent('Confirmed: first@example.org.');
  });

  it('sends a row somebody confirmed for them back on Not right?', async () => {
    const user = userEvent.setup();
    renderWith([{ ...ROW, state: 'confirmed' }], 'view');
    expect(screen.queryByRole('button', { name: 'Yes, that is right' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Not right?' }));
    expect(answerAddressChangeByLink).toHaveBeenCalledWith('view', 'p.l1.secret', 'name@gmail.com', 'proposed');
    expect(await screen.findByRole('status')).toHaveTextContent('Sent back. Whoever set it up will change it.');
  });

  it('says nothing where the payload carries no rows', () => {
    const { container } = renderWith(undefined);
    expect(container).toBeEmptyDOMElement();
  });
});
