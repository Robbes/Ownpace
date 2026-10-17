// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * AN INVITATION YOU CAN PUT OFF (the UX sweep, 2026-10-17).
 *
 * *Not now* on the invitation screen used to send a signed-in person to
 * `/login`. The session was still in the store, so the sign-in page offered
 * them a sign-in they did not need, and pressing it went through the provider,
 * which was still signed in, back to `/auth/callback`. That page sends anybody
 * with an open invitation to `/invitations`: a loop, and a member of another
 * organisation had no way to their migrations. A decline that left nothing
 * landed on `/login` in the same way.
 *
 * What this holds:
 *
 *  - *Not now* for somebody who belongs somewhere (or an operator) goes to the
 *    landing page, `/`, which knows where each of them goes; for somebody who
 *    belongs nowhere it signs them out, of the sign-in service too;
 *  - a decline that leaves an organisation goes to the migrations, one that
 *    leaves an operator goes to the queue, and one that leaves nothing signs
 *    out; none of them shows the sign-in page while still signed in;
 *  - the role reads as the app names it, in the reader's language;
 *  - joining stores the name from the address, as the two sign-in doors do;
 *  - the page says which address signed in, and offers *Sign out*.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import { LocaleProvider } from '../i18n/index.tsx';

const { fetchMeMock, answerMock, signOutUrlMock, leaveMock } = vi.hoisted(() => ({
  fetchMeMock: vi.fn(),
  answerMock: vi.fn(),
  signOutUrlMock: vi.fn(),
  leaveMock: vi.fn(),
}));

vi.mock('../services/session.ts', () => ({ fetchMe: fetchMeMock, answerInvitation: answerMock }));
// The sign-in service's end-session address, and leaving for it.
vi.mock('../services/oidc.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/oidc.ts')>();
  return { ...actual, signOutUrl: signOutUrlMock, leaveForIssuer: leaveMock };
});
// The build stamp asks the server what it runs; not this file's subject.
vi.mock('../components/BuildStamp.tsx', () => ({ default: () => null }));

import Invitations from './Invitations.tsx';
import { useAuthStore } from '../stores/auth-store.ts';

const END = 'https://id.example.invalid/oidc/v1/end_session?id_token_hint=token';

const INVITATION = { tenantId: 'tenant-b', name: 'Jansen & Partners', role: 'admin', invitedAt: null };

const me = (over: Record<string, unknown> = {}) => ({
  userId: 'sub-1',
  email: 'marieke@jansen-partners.nl',
  tenants: [],
  invitations: [INVITATION],
  operator: false,
  ...over,
});

/** The store as a sign-in leaves it, belonging to `tenantCount` organisations. */
function signedIn(tenantCount: number, operator = false): void {
  useAuthStore
    .getState()
    .login(
      'token',
      { id: 'sub-1', email: 'marieke@jansen-partners.nl', name: 'marieke', role: '' },
      tenantCount > 0 ? 'tenant-a' : '',
      operator,
      tenantCount,
    );
}

function renderPage(locale: 'en' | 'nl' = 'en') {
  window.localStorage.setItem('ownpace.locale', locale);
  return render(
    <LocaleProvider>
      <MemoryRouter initialEntries={['/invitations']}>
        <Routes>
          <Route path="/invitations" element={<Invitations />} />
          <Route path="/" element={<div>screen:landing</div>} />
          <Route path="/login" element={<div>screen:login</div>} />
          <Route path="/mappings" element={<div>screen:mappings</div>} />
          <Route path="/access-requests" element={<div>screen:queue</div>} />
        </Routes>
      </MemoryRouter>
    </LocaleProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  signOutUrlMock.mockResolvedValue(END);
  fetchMeMock.mockResolvedValue(me());
  answerMock.mockResolvedValue({ tenantId: INVITATION.tenantId, outcome: 'declined' });
});

afterEach(() => {
  useAuthStore.getState().logout();
  window.localStorage.clear();
});

describe('Not now', () => {
  it('takes a member of another organisation to the landing page, never to the sign-in page', async () => {
    signedIn(1);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Not now' }));

    expect(await screen.findByText('screen:landing')).toBeInTheDocument();
    expect(screen.queryByText('screen:login')).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(signOutUrlMock).not.toHaveBeenCalled();
  });

  it('takes an operator with no organisation to the landing page too, which knows the queue', async () => {
    signedIn(0, true);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Not now' }));

    expect(await screen.findByText('screen:landing')).toBeInTheDocument();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('signs out somebody who belongs nowhere yet, of the sign-in service too', async () => {
    signedIn(0);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Not now' }));

    await waitFor(() => expect(leaveMock).toHaveBeenCalledWith(END));
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().token).toBeNull();
    expect(screen.queryByText('screen:login')).toBeNull();
  });
});

describe('a decline', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('that leaves nothing signs out, and never shows the sign-in page while still signed in', async () => {
    signedIn(0);
    fetchMeMock
      .mockResolvedValueOnce(me())
      .mockResolvedValue(me({ invitations: [] }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Decline' }));

    await waitFor(() => expect(leaveMock).toHaveBeenCalledWith(END));
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(screen.queryByText('screen:login')).toBeNull();
  });

  it('that leaves an organisation goes to the migrations', async () => {
    signedIn(1);
    fetchMeMock
      .mockResolvedValueOnce(me())
      .mockResolvedValue(me({ invitations: [], tenants: [{ tenantId: 'tenant-a', role: 'owner' }] }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Decline' }));

    expect(await screen.findByText('screen:mappings')).toBeInTheDocument();
    expect(signOutUrlMock).not.toHaveBeenCalled();
  });

  it('that leaves an operator with no organisation goes to the queue', async () => {
    signedIn(0, true);
    fetchMeMock.mockResolvedValueOnce(me({ operator: true })).mockResolvedValue(me({ invitations: [], operator: true }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Decline' }));

    expect(await screen.findByText('screen:queue')).toBeInTheDocument();
    expect(signOutUrlMock).not.toHaveBeenCalled();
  });
});

describe('joining', () => {
  it('stores the name from the address, as the two sign-in doors do', async () => {
    signedIn(0);
    answerMock.mockResolvedValue({ tenantId: INVITATION.tenantId, outcome: 'accepted' });
    fetchMeMock
      .mockResolvedValueOnce(me())
      .mockResolvedValue(
        me({ invitations: [], tenantId: 'tenant-b', role: 'admin', tenants: [{ tenantId: 'tenant-b', role: 'admin' }] }),
      );
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Join' }));

    expect(await screen.findByText('screen:mappings')).toBeInTheDocument();
    expect(useAuthStore.getState().user).toMatchObject({
      email: 'marieke@jansen-partners.nl',
      name: 'marieke',
    });
  });
});

describe('what the page says', () => {
  it.each([
    ['nl', 'als beheerder'],
    ['en', 'as admin'],
  ] as const)('names the role as the app does, in %s', async (locale, said) => {
    signedIn(0);
    renderPage(locale);
    expect(await screen.findByText(new RegExp(`^${said}$`))).toBeInTheDocument();
  });

  it.each([
    ['owner', 'als eigenaar'],
    ['member', 'als lid'],
    ['viewer', 'als kijker'],
  ] as const)('says %s in Dutch', async (role, said) => {
    signedIn(0);
    fetchMeMock.mockResolvedValue(me({ invitations: [{ ...INVITATION, role }] }));
    renderPage('nl');
    expect(await screen.findByText(new RegExp(`^${said}$`))).toBeInTheDocument();
  });

  it('names the address that signed in, and offers Sign out', async () => {
    signedIn(0);
    renderPage();
    expect(await screen.findByText('You signed in as marieke@jansen-partners.nl.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(leaveMock).toHaveBeenCalledWith(END));
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('is one page: a main landmark under one first-level heading', async () => {
    signedIn(0);
    renderPage();
    expect(await screen.findByRole('main')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
