// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE ADDRESS CHANGES, AFTERWARDS (workplan 0168 §6.3, D6).
 *
 * The person's page lists their rows, confirmed (and by whom) or waiting for
 * them, with *Change*, *Delete* and *Not right?*; the team screen lists every
 * row with its person and who set it, and adds one. The appliance's file door
 * is read-only and names the file, and a failed read is said, never an empty
 * table.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import { AddressChanges, type AddressChangesScope } from './AddressChanges.tsx';
import {
  createAddressChange,
  deleteAddressChange,
  fetchAddressChanges,
  updateAddressChange,
  type AddressChange,
} from '../services/address-change-service.ts';

vi.mock('../services/address-change-service', () => ({
  fetchAddressChanges: vi.fn(),
  createAddressChange: vi.fn(),
  updateAddressChange: vi.fn(),
  deleteAddressChange: vi.fn(),
}));

const row = (over: Partial<AddressChange>): AddressChange => ({
  oldAddress: 'name@gmail.com',
  oldKey: 'name@gmail.com',
  newAddress: 'first@example.org',
  state: 'confirmed',
  setBy: 'admin@example.org',
  setByYou: false,
  confirmedBy: 'admin@example.org',
  confirmedByYou: false,
  createdAt: '2026-11-22T10:00:00.000Z',
  confirmedAt: '2026-11-22T10:00:00.000Z',
  person: { id: 'p-child', displayName: 'Child' },
  ...over,
});

const CHILD: AddressChangesScope = { kind: 'person', personId: 'p-child', personName: 'Child', you: false };
const ME: AddressChangesScope = { kind: 'person', personId: 'p-me', personName: 'Me', you: true };

const renderWith = (scope: AddressChangesScope, canWrite = true) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AddressChanges scope={scope} canWrite={canWrite} headingId="addresses" />
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(updateAddressChange).mockResolvedValue(row({}));
  vi.mocked(deleteAddressChange).mockResolvedValue(row({}));
  vi.mocked(createAddressChange).mockResolvedValue(row({}));
});

describe("the person's page: Addresses", () => {
  it('lists only their rows, confirmed by somebody else for them, and sends one back on Not right?', async () => {
    vi.mocked(fetchAddressChanges).mockResolvedValue({
      rows: [row({}), row({ oldAddress: 'other@gmail.com', oldKey: 'other@gmail.com', person: null })],
      door: 'api',
      file: null,
    });
    const user = userEvent.setup();
    renderWith(CHILD);
    expect(screen.getByRole('heading', { name: 'Addresses' })).toBeInTheDocument();
    expect(await screen.findByText('name@gmail.com → first@example.org')).toBeInTheDocument();
    expect(screen.queryByText(/other@gmail\.com/)).not.toBeInTheDocument();
    expect(screen.getByText('Confirmed by admin@example.org for Child')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Not right?' }));
    expect(updateAddressChange).toHaveBeenCalledWith('name@gmail.com', { state: 'proposed' });
  });

  it('says whom a proposed row waits for, and confirms it', async () => {
    vi.mocked(fetchAddressChanges).mockResolvedValue({
      rows: [row({ state: 'proposed', confirmedBy: null, confirmedAt: null })],
      door: 'api',
      file: null,
    });
    const user = userEvent.setup();
    renderWith(CHILD);
    expect(await screen.findByText('Waiting for Child')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Not right?' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(updateAddressChange).toHaveBeenCalledWith('name@gmail.com', { state: 'confirmed' });
  });

  it('on their own page, a change of the new address is their confirmation; Delete deletes', async () => {
    vi.mocked(fetchAddressChanges).mockResolvedValue({
      rows: [row({ person: { id: 'p-me', displayName: 'Me' }, confirmedByYou: true })],
      door: 'api',
      file: null,
    });
    const user = userEvent.setup();
    renderWith(ME);
    expect(await screen.findByText('Confirmed')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change' }));
    const box = within(screen.getByText('name@gmail.com → first@example.org').closest('li')!).getByLabelText('New address');
    await user.clear(box);
    await user.type(box, 'me@example.org');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(updateAddressChange).toHaveBeenCalledWith('name@gmail.com', { newAddress: 'me@example.org', state: 'confirmed' });
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(deleteAddressChange).toHaveBeenCalledWith('name@gmail.com');
  });

  it("says the server's refusal in its own words, beside the row", async () => {
    vi.mocked(fetchAddressChanges).mockResolvedValue({ rows: [row({})], door: 'api', file: null });
    vi.mocked(updateAddressChange).mockRejectedValue(
      new AxiosError('409', 'ERR_BAD_REQUEST', undefined, undefined, {
        status: 409,
        statusText: 'Conflict',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: { error: 'chained', message: 'That address is changed in another row.', messageNl: 'x' },
      }),
    );
    const user = userEvent.setup();
    renderWith(CHILD);
    await user.click(await screen.findByRole('button', { name: 'Not right?' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not saved: That address is changed in another row.');
  });

  it('adds a row for them, proposed unless it is their own page', async () => {
    vi.mocked(fetchAddressChanges).mockResolvedValue({ rows: [], door: 'api', file: null });
    const user = userEvent.setup();
    renderWith(CHILD);
    expect(await screen.findByText('No address changes.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Old address'), 'child@gmail.com');
    await user.type(screen.getByLabelText('New address'), 'child@example.org');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(createAddressChange).toHaveBeenCalledWith({
      oldAddress: 'child@gmail.com',
      newAddress: 'child@example.org',
      personId: 'p-child',
    });
  });
});

describe('the team screen: Address changes', () => {
  it('lists every row with its person and who set it; a reader who is not an owner or admin gets no controls', async () => {
    vi.mocked(fetchAddressChanges).mockResolvedValue({
      rows: [row({}), row({ oldAddress: 'other@gmail.com', oldKey: 'other@gmail.com', person: null })],
      door: 'api',
      file: null,
    });
    renderWith({ kind: 'organisation' }, false);
    expect(screen.getByRole('heading', { name: 'Address changes' })).toBeInTheDocument();
    const other = (await screen.findByText('other@gmail.com → first@example.org')).closest('li')!;
    expect(within(other).getByText(/Person: Nobody/)).toBeInTheDocument();
    expect(within(other).getByText(/Set by: admin@example\.org/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it("is read-only on the appliance's file door, and names the file", async () => {
    vi.mocked(fetchAddressChanges).mockResolvedValue({
      rows: [row({ person: null, setBy: 'address-changes.json' })],
      door: 'file',
      file: 'address-changes.json',
    });
    renderWith({ kind: 'organisation' }, true);
    expect(await screen.findByText('These come from address-changes.json, and are changed in that file.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('says a failed read, never an empty table', async () => {
    vi.mocked(fetchAddressChanges).mockRejectedValue(new Error('down'));
    renderWith({ kind: 'organisation' }, true);
    expect(await screen.findByRole('alert')).toHaveTextContent('The address changes could not be read.');
    expect(screen.queryByText('No address changes.')).not.toBeInTheDocument();
  });
});
