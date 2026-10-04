// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A ROLE THAT PROMISES LESS THAN IT ALLOWS (workplan 0137 T7, the web half).
 *
 * The Team page offered *Kijker* (viewer), called a member's or a viewer's
 * role read-only, and defaulted an invitation to *Lid* (member). The API let
 * either of them delete a migration or repoint its target (0137 §1, §4). A
 * tester who picked "viewer" for a family member believed they gave less than
 * they did. The owner chose on 2026-09-28 (0137 T0, *"b"*) that until every
 * write names its roles, the product offers owner and admin only.
 *
 * What this holds:
 *
 * - the invite select offers owner and admin, no member and no viewer, and
 *   admin is the default;
 * - one line says what an admin can do, in the reader's language;
 * - a row that already holds member or viewer shows that role, and changing it
 *   offers owner and admin only;
 * - the server's refusal of a role below admin (`owner_or_admin_only`) reads
 *   in the reader's language, not in the server's English;
 * - an admin is offered no role select and no Remove on an owner's row, since
 *   only an owner can change or remove an owner (0137 T3 (c), 2026-10-04).
 *   That one is T3, not T7: it stays when T2's PR undoes T7.
 *
 * The API half is `apps/api/src/routes/tenants/a-role-that-promises-less-than-it-allows.unit.test.ts`.
 * T2's PR, which gates every write, undoes the T7 cases above and replaces
 * them with T5's and T6's tests; the owner's-row block (0137 T3 (c)) stays.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, AxiosHeaders } from 'axios';
import { STRINGS } from '../i18n/strings.ts';
import { LocaleProvider } from '../i18n/index.tsx';
import { ownerOrAdminOnly } from '../services/api.ts';

const { memberList, memberInvite, memberUpdateRole, auth } = vi.hoisted(() => ({
  memberList: vi.fn(),
  memberInvite: vi.fn(),
  memberUpdateRole: vi.fn(),
  auth: {
    user: { id: 'user-owner', email: 'owner@acme.nl', name: 'Owner', role: 'owner' },
    tenantId: 'acme',
  },
}));

vi.mock('../services/mapping-service', () => ({
  tenantApi: {
    get: vi.fn().mockResolvedValue({ id: 'acme', name: 'Acme BV', slug: 'acme-bv', createdAt: '2026-07-01T10:00:00.000Z' }),
    update: vi.fn(),
    setNotifications: vi.fn(),
    setContact: vi.fn(),
  },
  memberApi: {
    list: memberList,
    invite: memberInvite,
    updateRole: memberUpdateRole,
    remove: vi.fn(),
  },
}));

vi.mock('../stores/auth-store', () => ({
  useAuthStore: () => auth,
}));

import Tenants from './Tenants.tsx';

const member = (id: string, email: string, role: string) => ({
  id,
  tenantId: 'acme',
  userId: `user-${id}`,
  email,
  role,
  status: 'active',
  invitedAt: null,
  joinedAt: '2026-07-01T10:00:00.000Z',
});

const MEMBERS = [
  { ...member('m-1', 'owner@acme.nl', 'owner'), userId: 'user-owner' },
  member('m-2', 'beheerder@acme.nl', 'admin'),
  member('m-3', 'lid@acme.nl', 'member'),
  member('m-4', 'kijker@acme.nl', 'viewer'),
];

/** The refusal as the API sends it: the code, and the English beside it. */
const refusal = (): AxiosError => {
  const err = new AxiosError('Request failed with status code 400');
  err.response = {
    status: 400,
    statusText: 'Bad Request',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: {
      error: 'owner_or_admin_only',
      message: 'During the Alpha, a person can only be an owner or an admin.',
    },
  };
  return err;
};

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <Tenants />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const optionsOf = (select: HTMLElement) =>
  Array.from(select.querySelectorAll('option')) as HTMLOptionElement[];
const choosable = (select: HTMLElement) =>
  optionsOf(select)
    .filter((o) => !o.disabled)
    .map((o) => o.value);

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { id: 'user-owner', email: 'owner@acme.nl', name: 'Owner', role: 'owner' };
  memberList.mockResolvedValue(MEMBERS);
});

afterEach(() => window.localStorage.removeItem('ownpace.locale'));

describe('the invite select', () => {
  it('offers owner and admin, no member and no viewer, and admin is the default', async () => {
    renderScreen();
    await screen.findByText('lid@acme.nl');

    const select = screen.getByLabelText('Role') as HTMLSelectElement;
    expect(
      optionsOf(select).map((o) => o.value),
      'the Team page offers a role below admin again (Tenants.tsx ROLES)',
    ).toEqual(['owner', 'admin']);
    expect(select.value, 'an invitation defaults to admin').toBe('admin');
  });

  it('invites as admin when nothing is chosen', async () => {
    memberInvite.mockResolvedValue(member('m-5', 'nieuw@acme.nl', 'admin'));
    renderScreen();
    await screen.findByText('lid@acme.nl');

    await userEvent.type(screen.getByLabelText('Email address'), 'nieuw@acme.nl');
    await userEvent.click(screen.getByRole('button', { name: /Invite/ }));

    await waitFor(() =>
      expect(memberInvite).toHaveBeenCalledWith('acme', { email: 'nieuw@acme.nl', role: 'admin' }),
    );
  });

  it('as an admin, offers admin alone, since owner is the owner’s to grant', async () => {
    auth.user = { id: 'user-m-2', email: 'beheerder@acme.nl', name: 'B', role: 'admin' };
    renderScreen();
    await screen.findByText('lid@acme.nl');

    const select = screen.getByLabelText('Role') as HTMLSelectElement;
    expect(choosable(select)).toEqual(['admin']);
    expect(select.value).toBe('admin');
  });
});

describe('what an admin can do, said once', () => {
  it.each(['en', 'nl'] as const)('in %s', async (locale) => {
    window.localStorage.setItem('ownpace.locale', locale);
    renderScreen();
    expect(await screen.findByText(STRINGS[locale]['tenants.invite.adminCan'])).toBeInTheDocument();
  });

  it('names what only an owner can do', () => {
    // Checked against the API's owner-only routes on 2026-09-28: close and
    // reopen (routes/tenants/index.ts), the applying-deletions and
    // auto-applying-relocations flags, owner-only to turn on AND off
    // (routes/migrations/operating-routes.ts), and granting owner (members.ts).
    // Changing or removing an owner joined them on 2026-10-04 (0137 T3 (c)).
    // The API half pins that set of routes, so a new owner-only act, or one
    // opened to admins, fails there and sends the reader back to this line.
    expect(STRINGS.en['tenants.invite.adminCan']).toBe(
      "An admin can do everything an owner can, except close or reopen the organisation, turn deleting by hand or the automatic removal of moved files' old copies on or off, make somebody an owner, and change or remove an owner.",
    );
    expect(STRINGS.nl['tenants.invite.adminCan']).toBe(
      'Een beheerder kan alles wat een eigenaar kan, behalve de organisatie sluiten of heropenen, handmatig verwijderen of het automatisch verwijderen van oude kopieën van verplaatste bestanden aan- of uitzetten, iemand eigenaar maken en een eigenaar een andere rol geven of verwijderen.',
    );
    // The product's own words for the two flags, so the line names what the
    // Deletions panel names (`applyFlag.on`, `autoApply.on`; renamed in 0156
    // T6, when "Applying deletions is ON" was read as deletions happening).
    expect(STRINGS.en['applyFlag.on']).toContain('Deleting by hand');
    expect(STRINGS.en['autoApply.on']).toContain("Automatic removal of moved files' old copies");
    expect(STRINGS.nl['applyFlag.on']).toContain('Handmatig verwijderen');
    expect(STRINGS.nl['autoApply.on']).toContain(
      'Automatisch verwijderen van oude kopieën van verplaatste bestanden',
    );
  });
});

describe('a row that already holds a role below admin', () => {
  it.each([
    ['lid@acme.nl', 'member', 'Member'],
    ['kijker@acme.nl', 'viewer', 'Viewer'],
  ])('%s still shows %s, and changing it offers owner and admin only', async (email, role, word) => {
    renderScreen();
    await screen.findByText('lid@acme.nl');

    const select = screen.getByLabelText(`Role ${email}`) as HTMLSelectElement;
    expect(select.value, 'the row shows the role it holds').toBe(role);
    expect(select.selectedOptions[0]?.textContent).toBe(word);
    expect(choosable(select)).toEqual(['owner', 'admin']);
  });

  it('can be moved up to admin', async () => {
    memberUpdateRole.mockResolvedValue({ id: 'm-3', tenantId: 'acme', role: 'admin', updatedAt: 'x' });
    renderScreen();
    await screen.findByText('lid@acme.nl');

    await userEvent.selectOptions(screen.getByLabelText('Role lid@acme.nl'), 'admin');
    await waitFor(() => expect(memberUpdateRole).toHaveBeenCalledWith('acme', 'm-3', 'admin'));
  });

  it('a row that holds owner or admin is offered nothing below admin', async () => {
    renderScreen();
    await screen.findByText('lid@acme.nl');

    for (const email of ['owner@acme.nl', 'beheerder@acme.nl']) {
      const values = optionsOf(screen.getByLabelText(`Role ${email}`)).map((o) => o.value);
      expect(values, email).toEqual(['owner', 'admin']);
    }
  });
});

describe('the server’s refusal of a role below admin', () => {
  it('is recognised by its code and status, and by nothing else', () => {
    expect(ownerOrAdminOnly(refusal())).toBe(true);
    const other = refusal();
    other.response!.data = { error: 'Validation error', message: 'x' };
    expect(ownerOrAdminOnly(other)).toBe(false);
    const status = refusal();
    status.response!.status = 403;
    expect(ownerOrAdminOnly(status)).toBe(false);
    expect(ownerOrAdminOnly(new Error('owner_or_admin_only'))).toBe(false);
  });

  it('reads in Dutch on a Dutch page, not in the server’s English', async () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    memberInvite.mockRejectedValue(refusal());
    renderScreen();
    await screen.findByText('lid@acme.nl');

    await userEvent.type(screen.getByLabelText('E-mailadres'), 'nieuw@acme.nl');
    await userEvent.click(screen.getByRole('button', { name: /Uitnodigen/ }));

    expect(
      await screen.findByText('Tijdens de Alpha kan iemand alleen eigenaar of beheerder zijn.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/During the alpha/i)).toBeNull();
  });

  it('and in English on an English page', async () => {
    memberInvite.mockRejectedValue(refusal());
    renderScreen();
    await screen.findByText('lid@acme.nl');

    await userEvent.type(screen.getByLabelText('Email address'), 'nieuw@acme.nl');
    await userEvent.click(screen.getByRole('button', { name: /Invite/ }));

    expect(
      await screen.findByText('During the Alpha, a person can only be an owner or an admin.'),
    ).toBeInTheDocument();
  });
});

/**
 * An owner's row, as an admin sees it (0137 T3 (c), the web half).
 *
 * Only an owner can change or remove an owner: the API answers an admin's
 * PATCH or DELETE on an owner row with 403, whether that owner is active,
 * invited or declined. The page still offered an admin the role select and
 * Remove on those rows, so both always failed, with the server's English
 * sentence on a Dutch page too. Now the admin sees the role as text, as
 * somebody who manages nothing does, and no Remove. An owner keeps both on
 * another owner's row, an admin keeps both on an admin's row, and Send again
 * on an open invitation is not part of (c).
 *
 * The API half is `members.integration.test.ts` and `member-guards.unit.test.ts`.
 */
describe.each(['en', 'nl'] as const)('an owner’s row, in %s (0137 T3 (c))', (locale) => {
  const words = STRINGS[locale];
  const ADMIN = { id: 'user-m-2', email: 'beheerder@acme.nl', name: 'B', role: 'admin' };
  const TEAM = [
    ...MEMBERS,
    member('m-5', 'tweede-eigenaar@acme.nl', 'owner'),
    {
      ...member('m-6', 'uitgenodigd@acme.nl', 'owner'),
      status: 'invited',
      invitedAt: '2026-10-01T09:00:00.000Z',
      joinedAt: null,
    },
    {
      ...member('m-7', 'afgeslagen@acme.nl', 'owner'),
      status: 'declined',
      invitedAt: '2026-10-01T09:00:00.000Z',
      joinedAt: null,
    },
    member('m-8', 'tweede-beheerder@acme.nl', 'admin'),
  ];

  /** The member table's row for one address. */
  const rowOf = (email: string) => {
    const row = screen.getByText(email).closest('tr');
    expect(row, `no row for ${email}`).not.toBeNull();
    return row as HTMLElement;
  };
  const roleSelect = (row: HTMLElement) => within(row).queryByRole('combobox');
  const removeButton = (row: HTMLElement) =>
    within(row).queryByRole('button', { name: words['tenants.members.remove'] });

  beforeEach(() => {
    window.localStorage.setItem('ownpace.locale', locale);
    memberList.mockResolvedValue(TEAM);
  });

  it.each([
    ['active', 'tweede-eigenaar@acme.nl', false],
    ['invited', 'uitgenodigd@acme.nl', true],
    ['declined', 'afgeslagen@acme.nl', false],
  ] as const)(
    'an admin gets no role select and no Remove on an owner row that is %s',
    async (_status, email, sendAgain) => {
      auth.user = ADMIN;
      renderScreen();
      await screen.findByText(email);
      const row = rowOf(email);

      expect(roleSelect(row), 'an admin is offered a role change the server refuses (403)').toBeNull();
      expect(within(row).getByText(words['role.owner']), 'the role still shows, as text').toBeInTheDocument();
      expect(removeButton(row), 'an admin is offered a removal the server refuses (403)').toBeNull();
      // Sending an open invitation again is not part of (c).
      expect(
        within(row).queryByRole('button', { name: words['tenants.members.resend'] }) !== null,
      ).toBe(sendAgain);
    },
  );

  it('an admin keeps both on another admin’s row', async () => {
    auth.user = ADMIN;
    renderScreen();
    await screen.findByText('tweede-beheerder@acme.nl');
    const row = rowOf('tweede-beheerder@acme.nl');

    expect(roleSelect(row)).not.toBeNull();
    expect(removeButton(row)).not.toBeNull();
  });

  it('an owner keeps both on another owner’s row, active or invited', async () => {
    renderScreen();
    await screen.findByText('tweede-eigenaar@acme.nl');

    for (const email of ['tweede-eigenaar@acme.nl', 'uitgenodigd@acme.nl']) {
      const row = rowOf(email);
      expect(roleSelect(row), email).not.toBeNull();
      expect(removeButton(row), email).not.toBeNull();
    }
    // And still nothing to remove on their own row.
    expect(removeButton(rowOf('owner@acme.nl'))).toBeNull();
  });
});
