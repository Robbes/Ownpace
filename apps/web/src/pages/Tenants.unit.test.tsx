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

const {
  tenantGet,
  tenantUpdate,
  tenantSetNotifications,
  memberList,
  memberInvite,
  memberUpdateRole,
  memberRemove,
  auth,
} =
  vi.hoisted(() => ({
    tenantGet: vi.fn(),
    tenantUpdate: vi.fn(),
    tenantSetNotifications: vi.fn(),
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
  tenantApi: { get: tenantGet, update: tenantUpdate, setNotifications: tenantSetNotifications },
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

import Tenants from './Tenants.tsx';

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
    // This is the owner's OWN row, so the change is armed first (0039 T5) —
    // the server's refusal arrives after the confirm.
    await userEvent.click(screen.getByRole('button', { name: 'Confirm role change' }));

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
    // No role select on any member row — the read-only rule this test is
    // about. (The email-summary card renders its selects DISABLED rather than
    // hiding them: what the organization has chosen is worth seeing even when
    // changing it is not yours to do.)
    expect(screen.queryByRole('combobox', { name: /^Role / })).not.toBeInTheDocument();
    // The role still shows, as text.
    expect(screen.getByText('Member')).toBeInTheDocument();
  });
});

/**
 * The email-summary card (workplan 0030 T4).
 *
 * The point of the card is that the value on screen is the value the morning
 * digest job will act on. So what is pinned is: the stored preference is what
 * shows, a save sends the CLOSED values the job understands, a failed save
 * does not leave a setting nobody has on screen, a viewer cannot change it,
 * and a tenant read that FAILED disables the controls rather than offering a
 * default that would overwrite something unseen.
 */
describe('the email summary preference', () => {
  it('shows what is stored, not the default', async () => {
    tenantGet.mockResolvedValue({
      id: 'acme',
      name: 'Acme BV',
      slug: 'acme-bv',
      settings: { notifications: { digest: 'daily', locale: 'nl' } },
      createdAt: '2026-07-01T10:00:00.000Z',
    });
    renderScreen();
    // Wait for the tenant read, not just for the control: the card renders
    // (disabled) while the query is in flight.
    await screen.findByText('Acme BV');

    expect((screen.getByLabelText('Summary') as HTMLSelectElement).value).toBe('daily');
    expect((screen.getByLabelText('Language') as HTMLSelectElement).value).toBe('nl');
  });

  it('falls back to the shared default when nothing is stored', async () => {
    renderScreen();
    await screen.findByText('Acme BV');
    const cadence = screen.getByLabelText('Summary') as HTMLSelectElement;
    // Weekly, and emphatically not "off": a tenant that never chose still
    // hears from us.
    expect(cadence.value).toBe('weekly');
  });

  it('saves the choice and shows what the server stored', async () => {
    tenantSetNotifications.mockResolvedValue({ digest: 'off', locale: 'en' });
    renderScreen();
    await screen.findByText('collega@acme.nl');

    await userEvent.selectOptions(screen.getByLabelText('Summary'), 'off');

    await waitFor(() =>
      expect(tenantSetNotifications).toHaveBeenCalledWith('acme', {
        digest: 'off',
        locale: 'en',
      }),
    );
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('puts the control back and shows the server’s words when a save fails', async () => {
    tenantSetNotifications.mockRejectedValue({
      response: { data: { message: 'Only an owner or admin may change this' } },
    });
    renderScreen();
    await screen.findByText('collega@acme.nl');

    await userEvent.selectOptions(screen.getByLabelText('Summary'), 'daily');

    // Verbatim (the prose boundary), and the select is back on the stored
    // value — leaving "daily" on screen would show a setting nobody has.
    expect(await screen.findByText('Only an owner or admin may change this')).toBeInTheDocument();
    await waitFor(() =>
      expect((screen.getByLabelText('Summary') as HTMLSelectElement).value).toBe('weekly'),
    );
  });

  it('is read-only for a member', async () => {
    auth.user = { id: 'user-b', email: 'collega@acme.nl', name: 'B', role: 'member' };
    renderScreen();
    await screen.findByText('Acme BV');

    expect(screen.getByLabelText('Summary')).toBeDisabled();
    expect(screen.getByLabelText('Language')).toBeDisabled();
  });

  it('offers no control at all when the tenant read failed', async () => {
    tenantGet.mockRejectedValue(new Error('boom'));
    renderScreen();

    // Not a default that a save would then write over something unseen.
    expect(await screen.findByText(/Could not read the current setting/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Summary')).not.toBeInTheDocument();
  });
});

describe('self-demotion is armed; other rows stay single-click (0039 T5)', () => {
  it('lowering your OWN role takes a confirm; the first selection changes nothing', async () => {
    memberUpdateRole.mockResolvedValue({ id: 'm-1', tenantId: 'acme', role: 'member', updatedAt: 'x' });
    renderScreen();

    await screen.findByText('collega@acme.nl');
    await userEvent.selectOptions(screen.getByLabelText('Role owner@acme.nl'), 'member');

    // Armed, not executed.
    expect(memberUpdateRole).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/lowers your own role/),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Confirm role change' }));
    await waitFor(() =>
      expect(memberUpdateRole).toHaveBeenCalledWith('acme', 'm-1', 'member'),
    );
  });

  it("changing someone ELSE's role stays single-click", async () => {
    memberUpdateRole.mockResolvedValue({ id: 'm-2', tenantId: 'acme', role: 'viewer', updatedAt: 'x' });
    renderScreen();

    await screen.findByText('collega@acme.nl');
    await userEvent.selectOptions(screen.getByLabelText('Role collega@acme.nl'), 'viewer');

    await waitFor(() =>
      expect(memberUpdateRole).toHaveBeenCalledWith('acme', 'm-2', 'viewer'),
    );
    expect(screen.queryByText(/lowers your own role/)).not.toBeInTheDocument();
  });
});

