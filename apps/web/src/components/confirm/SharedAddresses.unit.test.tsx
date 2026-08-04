// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The shared addresses panel on Review & confirm (workplan 0027 T4).
 *
 * Every test here is one of the three ways this panel could lie: an empty
 * list read as "your organisation has none", a missing pattern rendered as
 * a pattern, and an UNREAD member list rendered as an empty group.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const { fetchGroupRunbook } = vi.hoisted(() => ({ fetchGroupRunbook: vi.fn() }));
vi.mock('../../services/operating-service', () => ({ fetchGroupRunbook }));

import SharedAddresses from './SharedAddresses';
import type { SharedAddressRow } from '../../services/operating-service';

beforeEach(() => {
  vi.clearAllMocks();
  fetchGroupRunbook.mockResolvedValue('# Recreating your distribution lists');
});

const row = (overrides: Partial<SharedAddressRow> = {}): SharedAddressRow => ({
  id: 'g1',
  address: 'sales@acme.nl',
  members: ['rob@acme.nl', 'jan@acme.nl'],
  membersKnown: true,
  status: 'pending',
  ...overrides,
});

function renderPanel(addresses: SharedAddressRow[], unreadable = false) {
  return render(
    <MemoryRouter>
      <SharedAddresses addresses={addresses} unreadable={unreadable} />
    </MemoryRouter>,
  );
}

describe('an address that was classified', () => {
  it('says what will happen to a shared mailbox', () => {
    renderPanel([row({ pattern: 'shared_s', displayName: 'Sales' })]);

    expect(screen.getByText(/the store is copied/)).toBeInTheDocument();
    expect(screen.getByText('Sales (sales@acme.nl)')).toBeInTheDocument();
  });

  it('says what will happen to a distribution list', () => {
    renderPanel([row({ pattern: 'distribution_d' })]);
    expect(screen.getByText(/the members are recreated/)).toBeInTheDocument();
  });

  it('names the bare address when there is no display name', () => {
    renderPanel([row({ pattern: 'shared_s' })]);
    expect(screen.getByText('sales@acme.nl')).toBeInTheDocument();
  });
});

describe('an address nobody has classified yet', () => {
  it('says the question is waiting, and links to where it is answered', () => {
    renderPanel([row()]);

    const link = screen.getByRole('link', { name: /Which kind\?/ });
    // Not styled or worded as a pattern: picking one for the owner is the
    // guess this whole feature refuses to make.
    expect(link).toHaveAttribute('href', '/decisions');
    expect(screen.queryByText(/the store is copied/)).not.toBeInTheDocument();
  });
});

describe('the member list', () => {
  it('counts the members it read', () => {
    renderPanel([row()]);
    expect(screen.getByText(/2/)).toBeInTheDocument();
    expect(screen.getByText(/members/)).toBeInTheDocument();
  });

  it('shows an empty group as empty', () => {
    renderPanel([row({ members: [] })]);
    expect(screen.getByText(/0/)).toBeInTheDocument();
  });

  it('does NOT show an unread list as zero members', () => {
    renderPanel([row({ members: [], membersKnown: false })]);

    // "0 members" would have the owner approve recreating an empty group on
    // the target — the failure hard rule 9 exists to prevent.
    expect(screen.getByText(/could not be read/)).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});

describe('the manual runbook (workplan 0027 T2)', () => {
  it('offers the steps, and says plainly that nobody does it for you', () => {
    renderPanel([row({ pattern: 'distribution_d' })]);

    expect(screen.getByText(/recreated on the target by hand/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /step-by-step/i })).toBeInTheDocument();
  });

  it('does not offer it when there is no list to recreate', () => {
    // An offer of manual steps for work that does not exist is noise, and it
    // would imply a shared mailbox needs them too.
    renderPanel([row({ pattern: 'shared_s' })]);
    expect(screen.queryByRole('button', { name: /step-by-step/i })).not.toBeInTheDocument();
  });

  it('says so when the steps could not be fetched', async () => {
    fetchGroupRunbook.mockRejectedValue(new Error('502'));
    renderPanel([row({ pattern: 'distribution_d' })]);

    await userEvent.click(screen.getByRole('button', { name: /step-by-step/i }));

    // A silent no-op would look like an empty runbook, and the reader would
    // conclude there is nothing to do.
    await waitFor(() => expect(screen.getByText(/could not be fetched/)).toBeInTheDocument());
  });
});

describe('nothing found', () => {
  it('refuses to claim the organisation has none', () => {
    renderPanel([]);

    expect(screen.getByText(/not "your organisation has none"/)).toBeInTheDocument();
    // The two reasons an owner can act on.
    expect(screen.getByText(/IMAP source cannot list groups/)).toBeInTheDocument();
    expect(screen.getByText(/application permissions/)).toBeInTheDocument();
  });

  it('says "could not read" differently from "found nothing"', () => {
    renderPanel([], true);

    expect(screen.getByText(/Could not read/)).toBeInTheDocument();
    // The empty-state sentence must not also appear: one means we could not
    // look, the other is a claim about what is there.
    expect(screen.queryByText(/your organisation has none/)).not.toBeInTheDocument();
  });
});
