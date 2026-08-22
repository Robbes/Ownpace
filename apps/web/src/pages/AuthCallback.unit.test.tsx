// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The redirect target (ADR-0042).
 *
 * Two of these are the reason this file exists rather than being covered by
 * `oidc.unit.test.ts`:
 *
 *  - **The exchange must happen ONCE.** An authorization code is single-use, so
 *    a second attempt gets `invalid_grant` from the issuer — which would draw a
 *    failure over a sign-in that actually worked. React 18's StrictMode mounts
 *    every effect twice in development, so this is the ordinary case, not an
 *    edge one.
 *  - **A token is not a session.** `GET /api/me` is what says which
 *    organisation somebody may act on, and if it fails there must be no
 *    half-session left behind holding a token and no tenant.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AuthCallback from './AuthCallback.tsx';
import { useAuthStore } from '../stores/auth-store.ts';
import { completeSignIn } from '../services/oidc.ts';
import { fetchMe } from '../services/session.ts';

const navigateMock = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../services/oidc.ts', () => ({ completeSignIn: vi.fn() }));
vi.mock('../services/session.ts', () => ({ fetchMe: vi.fn() }));

const completeSignInMock = vi.mocked(completeSignIn);
const fetchMeMock = vi.mocked(fetchMe);

/** Rendered bare by default; the StrictMode case passes StrictMode as `Wrapper`. */
const Passthrough: React.FC<{ children: React.ReactNode }> = ({ children }) => <>{children}</>;

const renderCallback = (
  Wrapper: React.ComponentType<{ children: React.ReactNode }> = Passthrough,
) =>
  render(
    <Wrapper>
      <MemoryRouter>
        <AuthCallback />
      </MemoryRouter>
    </Wrapper>,
  );

beforeEach(() => {
  navigateMock.mockReset();
  completeSignInMock.mockReset();
  fetchMeMock.mockReset();
  useAuthStore.getState().logout();
  localStorage.clear();
});

describe('AuthCallback', () => {
  it('exchanges the code, asks who this is, and only then has a session', async () => {
    completeSignInMock.mockResolvedValue('the-token');
    fetchMeMock.mockResolvedValue({
      userId: 'sub-1',
      email: 'owner@demo.test',
      tenantId: 'tenant-a',
      role: 'owner',
      tenants: [{ tenantId: 'tenant-a', role: 'owner' }],
    });

    renderCallback();

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/dashboard', { replace: true }));
    // The tenant and role come from /api/me, NOT from the token — ADR-0042
    // narrowed the claims to sub and email precisely so they could not.
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.token).toBe('the-token');
    expect(state.tenantId).toBe('tenant-a');
    expect(state.user).toMatchObject({ id: 'sub-1', email: 'owner@demo.test', role: 'owner' });
    // The header shows the local part, the same way the paste-box path does.
    expect(state.user?.name).toBe('owner');
    expect(fetchMeMock).toHaveBeenCalledWith('the-token');
  });

  it('exchanges the code ONCE under StrictMode — a code is single-use', async () => {
    completeSignInMock.mockResolvedValue('the-token');
    fetchMeMock.mockResolvedValue({
      userId: 'sub-1',
      tenantId: 'tenant-a',
      role: 'owner',
      tenants: [{ tenantId: 'tenant-a', role: 'owner' }],
    });

    renderCallback(StrictMode);

    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
    expect(completeSignInMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the subject when the issuer asserts no email', async () => {
    completeSignInMock.mockResolvedValue('the-token');
    fetchMeMock.mockResolvedValue({
      userId: 'sub-1',
      tenantId: 'tenant-a',
      role: 'owner',
      tenants: [{ tenantId: 'tenant-a', role: 'owner' }],
    });

    renderCallback();

    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
    expect(useAuthStore.getState().user?.email).toBe('sub-1');
  });

  it('takes a platform operator to the queue, not to a dashboard that would 403', async () => {
    // An operator belongs to no organisation by design (workplan 0093 T6), so
    // the dashboard's first request would be refused. The queue is what they
    // signed in for.
    completeSignInMock.mockResolvedValue('the-token');
    fetchMeMock.mockResolvedValue({ userId: 'op-1', tenants: [], operator: true });

    renderCallback();

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith('/access-requests', { replace: true }),
    );
    expect(useAuthStore.getState().operator).toBe(true);
  });

  it('SAYS SO when somebody belongs to nothing, rather than dashboarding them', async () => {
    // Waiting on a grant, or holding an invitation that did not bind because
    // the issuer never verified their address. Either way a dashboard that
    // cannot load is the version of this that becomes a support ticket.
    completeSignInMock.mockResolvedValue('the-token');
    fetchMeMock.mockResolvedValue({ userId: 'nobody-1', tenants: [], operator: false });

    renderCallback();

    expect(await screen.findByRole('alert')).toHaveTextContent(/not part of an organisation yet/i);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("shows the service's own sentence, and creates no session", async () => {
    completeSignInMock.mockRejectedValue(
      new Error('This sign-in did not start in this browser tab. Start again from the sign-in page.'),
    );

    renderCallback();

    expect(await screen.findByRole('alert')).toHaveTextContent(/did not start in this browser tab/);
    // Not "sign-in failed" — the sentence names what to do next.
    expect(navigateMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(localStorage.getItem('auth_token')).toBeNull();
  });

  it('leaves no half-session when the exchange works but /api/me does not', async () => {
    completeSignInMock.mockResolvedValue('the-token');
    fetchMeMock.mockRejectedValue(new Error('No active membership for this tenant'));

    renderCallback();

    expect(await screen.findByRole('alert')).toHaveTextContent(/No active membership/);
    // A token without a tenant is not a session, and storing one would put
    // somebody on a dashboard that 403s on its first request.
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().token).toBeNull();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
