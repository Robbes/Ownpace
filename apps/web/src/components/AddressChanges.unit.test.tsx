// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE ADDRESS CHANGES, AFTERWARDS (workplan 0168 §6.3, D6).
 *
 * The person's page lists their rows, confirmed (and by whom) or waiting for
 * them, with *Change*, *Delete* and *Not right?*; the team screen lists every
 * row with its person and who set it, adds one, and gives a row to a person.
 * The appliance's file door is read-only and names the file, its page door
 * offers neither a person nor *Not right?*, and a failed read is said, never
 * an empty table. Each row's buttons say which row they are for.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import { lifecycleCounts, type Person } from '@openmig/shared';
import { AddressChanges, type AddressChangesScope } from './AddressChanges.tsx';
import {
  createAddressChange,
  deleteAddressChange,
  fetchAddressChanges,
  updateAddressChange,
  type AddressChange,
} from '../services/address-change-service.ts';
import { fetchPeople } from '../services/operating-service.ts';

vi.mock('../services/address-change-service', () => ({
  fetchAddressChanges: vi.fn(),
  createAddressChange: vi.fn(),
  updateAddressChange: vi.fn(),
  deleteAddressChange: vi.fn(),
}));
vi.mock('../services/operating-service', () => ({ fetchPeople: vi.fn() }));

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

const person = (id: string, displayName: string, you = false): Person => ({
  id,
  implicit: false,
  displayName,
  email: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  you,
  migrations: [],
  counts: lifecycleCounts([]),
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
  vi.mocked(fetchPeople).mockResolvedValue({
    people: [person('p-me', 'Me', true), person('p-child', 'Child'), person('p-gran', 'Grandma')],
    unassigned: [],
  });
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
    // Used in tasks too (0168 T4, the review's S9).
    expect(screen.getByText('Used in contacts, calendars, tasks and shares. Mail is never changed.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Not right? name@gmail.com' }));
    expect(updateAddressChange).toHaveBeenCalledWith('name@gmail.com', { state: 'proposed' });
  });

  it('says the person’s own confirmation through their link as theirs, never as for themselves', async () => {
    vi.mocked(fetchAddressChanges).mockResolvedValue({
      rows: [row({ confirmedBy: 'Child' })],
      door: 'api',
      file: null,
    });
    renderWith(CHILD);
    expect(await screen.findByText('Confirmed by Child')).toBeInTheDocument();
    expect(screen.queryByText('Confirmed by Child for Child')).not.toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: /Not right\?/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm name@gmail.com' }));
    expect(updateAddressChange).toHaveBeenCalledWith('name@gmail.com', { state: 'confirmed' });
  });

  it('says a row the reader confirmed for somebody else as confirmed by them for that person (D6)', async () => {
    vi.mocked(fetchAddressChanges).mockResolvedValue({
      rows: [row({ confirmedByYou: true })],
      door: 'api',
      file: null,
    });
    renderWith(CHILD);
    expect(await screen.findByText('Confirmed by you for Child')).toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: 'Change name@gmail.com' }));
    const box = within(screen.getByText('name@gmail.com → first@example.org').closest('li')!).getByLabelText('New address');
    // The form takes the focus, in its box (N10).
    expect(box).toHaveFocus();
    // No person to choose on a person's page: the row is theirs.
    expect(screen.queryByLabelText('Person')).not.toBeInTheDocument();
    await user.clear(box);
    await user.type(box, 'me@example.org');
    await user.click(screen.getByRole('button', { name: 'Save name@gmail.com' }));
    expect(updateAddressChange).toHaveBeenCalledWith('name@gmail.com', { newAddress: 'me@example.org', state: 'confirmed' });
    // The form gave the focus back to the button that opened it.
    expect(await screen.findByRole('button', { name: 'Change name@gmail.com' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Delete name@gmail.com' }));
    expect(deleteAddressChange).toHaveBeenCalledWith('name@gmail.com');
    // The pressed button goes with its row: the focus is on the section's heading.
    expect(screen.getByRole('heading', { name: 'Addresses' })).toHaveFocus();
  });

  it("says the server's refusal in its own words, beside the row, tied to the box it is about", async () => {
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
    await user.click(await screen.findByRole('button', { name: 'Not right? name@gmail.com' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not saved: That address is changed in another row.');

    await user.click(screen.getByRole('button', { name: 'Change name@gmail.com' }));
    await user.click(screen.getByRole('button', { name: 'Save name@gmail.com' }));
    const item = screen.getByText('name@gmail.com → first@example.org').closest('li')!;
    const box = within(item).getByLabelText('New address');
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveAccessibleDescription('Not saved: That address is changed in another row.');
  });

  it('says why Save cannot be pressed while the new address is not one (N10)', async () => {
    vi.mocked(fetchAddressChanges).mockResolvedValue({ rows: [row({})], door: 'api', file: null });
    const user = userEvent.setup();
    renderWith(CHILD);
    await user.click(await screen.findByRole('button', { name: 'Change name@gmail.com' }));
    const item = screen.getByText('name@gmail.com → first@example.org').closest('li')!;
    const box = within(item).getByLabelText('New address');
    await user.clear(box);
    await user.type(box, 'not an address');
    const save = screen.getByRole('button', { name: 'Save name@gmail.com' });
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription('Type the new address, like name@example.org.');
    await user.click(screen.getByRole('button', { name: 'Cancel name@gmail.com' }));
    expect(screen.getByRole('button', { name: 'Change name@gmail.com' })).toHaveFocus();
  });

  it('adds a row for them, proposed unless it is their own page', async () => {
    vi.mocked(fetchAddressChanges).mockResolvedValue({ rows: [], door: 'api', file: null });
    const user = userEvent.setup();
    renderWith(CHILD);
    expect(await screen.findByText('No address changes.')).toBeInTheDocument();
    const add = screen.getByRole('button', { name: 'Add' });
    // Why it cannot be pressed yet, said (N10).
    expect(add).toBeDisabled();
    expect(add).toHaveAccessibleDescription('Type the old and the new address, each like name@example.org.');
    await user.type(screen.getByLabelText('Old address'), 'child@gmail.com');
    await user.type(screen.getByLabelText('New address'), 'child@example.org');
    expect(add).toBeEnabled();
    await user.click(add);
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
    expect(screen.queryByLabelText('Person')).not.toBeInTheDocument();
  });

  it('names each button by its row (N10)', async () => {
    vi.mocked(fetchAddressChanges).mockResolvedValue({
      rows: [row({}), row({ oldAddress: 'other@gmail.com', oldKey: 'other@gmail.com', state: 'proposed', confirmedBy: null })],
      door: 'api',
      file: null,
    });
    renderWith({ kind: 'organisation' }, true);
    await screen.findByText('other@gmail.com → first@example.org');
    for (const name of [
      'Change name@gmail.com',
      'Delete name@gmail.com',
      'Not right? name@gmail.com',
      'Confirm other@gmail.com',
      'Change other@gmail.com',
      'Delete other@gmail.com',
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('adds a row for a person chosen on Add, and gives a row to a person on Change (S6)', async () => {
    vi.mocked(fetchAddressChanges).mockResolvedValue({
      rows: [row({ oldAddress: 'other@gmail.com', oldKey: 'other@gmail.com', person: null })],
      door: 'api',
      file: null,
    });
    const user = userEvent.setup();
    renderWith({ kind: 'organisation' }, true);
    await screen.findByText('other@gmail.com → first@example.org');
    // Add: the old and the new address, and whose it is.
    const form = screen.getByRole('button', { name: 'Add' }).closest('form')!;
    await user.type(within(form).getByLabelText('Old address'), 'gran@gmail.com');
    await user.type(within(form).getByLabelText('New address'), 'gran@example.org');
    const picker = await within(form).findByRole('combobox', { name: 'Person' });
    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['Nobody', 'Me', 'Child', 'Grandma']);
    await user.selectOptions(picker, 'Grandma');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(createAddressChange).toHaveBeenCalledWith({
      oldAddress: 'gran@gmail.com',
      newAddress: 'gran@example.org',
      personId: 'p-gran',
    });

    // Change: the row reads *Person: Nobody* until it is given to somebody.
    await user.click(screen.getByRole('button', { name: 'Change other@gmail.com' }));
    const item = screen.getByText('other@gmail.com → first@example.org').closest('li')!;
    await user.selectOptions(within(item).getByRole('combobox', { name: 'Person' }), 'Child');
    await user.click(within(item).getByRole('button', { name: 'Save other@gmail.com' }));
    expect(updateAddressChange).toHaveBeenCalledWith('other@gmail.com', {
      newAddress: 'first@example.org',
      personId: 'p-child',
    });
  });

  it('sends no person on a Change that did not change whose it is', async () => {
    vi.mocked(fetchAddressChanges).mockResolvedValue({ rows: [row({})], door: 'api', file: null });
    const user = userEvent.setup();
    renderWith({ kind: 'organisation' }, true);
    await user.click(await screen.findByRole('button', { name: 'Change name@gmail.com' }));
    const item = screen.getByText('name@gmail.com → first@example.org').closest('li')!;
    expect(await within(item).findByRole('combobox', { name: 'Person' })).toHaveValue('p-child');
    const box = within(item).getByLabelText('New address');
    await user.clear(box);
    await user.type(box, 'child@example.org');
    await user.click(within(item).getByRole('button', { name: 'Save name@gmail.com' }));
    expect(updateAddressChange).toHaveBeenCalledWith('name@gmail.com', { newAddress: 'child@example.org' });
  });

  it('says it when the people could not be read, and still adds a row for nobody', async () => {
    vi.mocked(fetchAddressChanges).mockResolvedValue({ rows: [], door: 'api', file: null });
    vi.mocked(fetchPeople).mockRejectedValue(new Error('down'));
    renderWith({ kind: 'organisation' }, true);
    expect(
      await screen.findByText(/The people could not be read, so an address change cannot be linked to a person yet\./),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Person')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
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

describe("the appliance's page door (0168 §7; the review's S7, N13)", () => {
  /** A row made on the appliance's page: confirmed by its owner, for its one person. */
  const OPERATOR_ROW = row({ setBy: 'operator', confirmedBy: 'operator', person: null });

  it('offers no Not right?, which the appliance refuses, and no Person, which it has none of', async () => {
    vi.mocked(fetchAddressChanges).mockResolvedValue({ rows: [OPERATOR_ROW], door: 'page', file: null });
    renderWith({ kind: 'organisation' }, true);
    expect(await screen.findByText('name@gmail.com → first@example.org')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Not right\?/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Person:/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Person')).not.toBeInTheDocument();
    // Delete is the way to take a row back there.
    expect(screen.getByRole('button', { name: 'Delete name@gmail.com' })).toBeInTheDocument();
    expect(fetchPeople).not.toHaveBeenCalled();
  });

  it('heads its one person’s page Addresses, as every person’s page is, over the whole table', async () => {
    vi.mocked(fetchAddressChanges).mockResolvedValue({
      rows: [OPERATOR_ROW, row({ oldAddress: 'b@gmail.com', oldKey: 'b@gmail.com', setBy: 'operator', confirmedBy: 'operator', person: null })],
      door: 'page',
      file: null,
    });
    const user = userEvent.setup();
    renderWith({ kind: 'implicit' }, true);
    expect(screen.getByRole('heading', { name: 'Addresses' })).toBeInTheDocument();
    expect(await screen.findByText('b@gmail.com → first@example.org')).toBeInTheDocument();
    expect(screen.getByText('name@gmail.com → first@example.org')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Not right\?/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Person:/)).not.toBeInTheDocument();
    // Its Add names no person: the appliance refuses one (NO_PERSON_HERE).
    await user.type(screen.getByLabelText('Old address'), 'c@gmail.com');
    await user.type(screen.getByLabelText('New address'), 'c@example.org');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(createAddressChange).toHaveBeenCalledWith({ oldAddress: 'c@gmail.com', newAddress: 'c@example.org' });
  });
});
