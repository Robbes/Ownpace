// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Team & organization (0026 T2 — the stub replaced by a real screen).
 *
 * What these tests pin: the role split (owner/admin operate, member/viewer
 * read), the server's refusals rendering VERBATIM (the guards live there —
 * "Cannot demote the last owner" is the server's finding, not ours), removal
 * being a two-step armed action, and the two client-side pre-emptions the
 * screen IS allowed to make (no owner option for an admin, no remove button
 * on your own row).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { tenantGet, tenantUpdate, memberList, memberInvite, memberUpdateRole, memberRemove, auth } =
  vi.hoisted(() => ({
    tenantGet: vi.fn(),
    tenantUpdate: vi.fn(),
    memberList: vi.fn(),
    memberInvite: vi.fn(),
    memberUpdateRole: vi.fn(),
    memberRemove: vi.fn(),
    auth: {
      user: { id: 'user-owner', email: 'owner@acme.nl', name: 'Owner', role: 'owner' },
      tenantId: 'acme',
    },
  }));

vi.mock('../services/mapping-service', () => ({
  tenantApi: { get: tenantGet, update: tenantUpdate },
  memberApi: {
    list: memberList,
    invite: memberInvite,
    updateRole: memberUpdateRole,
    remove: memberRemove,
  },
}));

vi.mock('../stores/auth-store', () => ({
  useAuthStore: () => auth,
}));

import Tenants from './Tenants';

const MEMBERS = [
  {
    id: 'm-1',
    tenantId: 'acme',
    userId: 'user-owner',
    email: 'owner@acme.nl',
    role: 'owner',
    status: 'active',
    invitedAt: null,
    joinedAt: '2026-07-01T10:00:00.000Z',
  },
  {
    id: 'm-2',
    tenantId: 'acme',
    userId: 'user-b',
    email: 'collega@acme.nl',
    role: 'member',
    status: 'invited',
    invitedAt: '2026-08-01T09:00:00.000Z',
    joinedAt: null,
  },
];

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Tenants />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { id: 'user-owner', email: 'owner@acme.nl', name: 'Owner', role: 'owner' };
  auth.tenantId = 'acme';
  tenantGet.mockResolvedValue({ id: 'acme', name: 'Acme BV', slug: 'acme-bv', createdAt: '2026-07-01T10:00:00.000Z' });
  memberList.mockResolvedValue(MEMBERS);
});

describe('the member list', () => {
  it('shows every member with role and status words from the dictionary', async () => {
    renderScreen();

    expect(await screen.findByText('collega@acme.nl')).toBeInTheDocument();
    expect(screen.getByText('Acme BV')).toBeInTheDocument();
    // The owner's row marks itself.
    expect(screen.getByText('(you)')).toBeInTheDocument();
    // Status is the dictionary's word, not the enum value. ("Invited" appears
    // twice: the column header and the badge.)
    expect(screen.getAllByText('Invited')).toHaveLength(2);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('keeps the member list working when the tenant read fails', async () => {
    tenantGet.mockRejectedValue(new Error('boom'));
    renderScreen();

    expect(
      await screen.findByText(/Could not read the organization's details/),
    ).toBeInTheDocument();
    expect(await screen.findByText('collega@acme.nl')).toBeInTheDocument();
  });
});

describe('inviting', () => {
  it('sends email + role and refreshes the list', async () => {
    memberInvite.mockResolvedValue({ ...MEMBERS[1], id: 'm-3', email: 'nieuw@acme.nl' });
    renderScreen();
    await screen.findByText('collega@acme.nl');

    await userEvent.type(screen.getByLabelText('Email address'), 'nieuw@acme.nl');
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'admin');
    await userEvent.click(screen.getByRole('button', { name: /Invite/ }));

    await waitFor(() =>
      expect(memberInvite).toHaveBeenCalledWith('acme', { email: 'nieuw@acme.nl', role: 'admin' }),
    );
    // Invalidation re-reads the list.
    await waitFor(() => expect(memberList).toHaveBeenCalledTimes(2));
  });

  it("renders the server's refusal verbatim when the invite fails", async () => {
    memberInvite.mockRejectedValue({
      response: { data: { error: 'Validation error', message: 'Failed to invite member' } },
    });
    renderScreen();
    await screen.findByText('collega@acme.nl');

    await userEvent.type(screen.getByLabelText('Email address'), 'dubbel@acme.nl');
    await userEvent.click(screen.getByRole('button', { name: /Invite/ }));

    expect(await screen.findByText('Failed to invite member')).toBeInTheDocument();
  });
});

describe('changing a role', () => {
  it("renders the server's guard verbatim — the last-owner rule is the server's finding", async () => {
    memberUpdateRole.mockRejectedValue({
      response: { data: { error: 'Bad Request', message: 'Cannot demote the last owner' } },
    });
    renderScreen();
    await screen.findByText('collega@acme.nl');

    await userEvent.selectOptions(screen.getByLabelText('Role owner@acme.nl'), 'member');

    expect(await screen.findByText('Cannot demote the last owner')).toBeInTheDocument();
    expect(memberUpdateRole).toHaveBeenCalledWith('acme', 'm-1', 'member');
  });

  it('offers an admin no owner option — the one grant the server would refuse anyway', async () => {
    auth.user = { id: 'user-b', email: 'collega@acme.nl', name: 'B', role: 'admin' };
    renderScreen();
    await screen.findByText('collega@acme.nl');

    const select = screen.getByLabelText('Role collega@acme.nl');
    const owner = Array.from(select.querySelectorAll('option')).find(
      (o) => o.value === 'owner',
    ) as HTMLOptionElement;
    expect(owner.disabled).toBe(true);
  });
});

describe('removing', () => {
  it('is a two-step armed action: first click arms, second click acts', async () => {
    memberRemove.mockResolvedValue(undefined);
    renderScreen();
    await screen.findByText('collega@acme.nl');

    const removeButton = screen.getByRole('button', { name: 'Remove' });
    await userEvent.click(removeButton);
    expect(memberRemove).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Confirm remove' }));
    await waitFor(() => expect(memberRemove).toHaveBeenCalledWith('acme', 'm-2'));
  });

  it('offers no remove button on your own row', async () => {
    renderScreen();
    await screen.findByText('collega@acme.nl');

    // Two manageable rows, ONE remove button — the self row has none.
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
  });
});

describe('the read-only roles', () => {
  it('gives a viewer the list without any controls', async () => {
    auth.user = { id: 'user-v', email: 'kijker@acme.nl', name: 'V', role: 'viewer' };
    renderScreen();
    await screen.findByText('collega@acme.nl');

    expect(screen.getByText(/Your role here is read-only/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Invite/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    // The role still shows, as text.
    expect(screen.getByText('Member')).toBeInTheDocument();
  });
});
