// Copyright 2026 The Ownpace authors (Apache-2.0)

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Login, { decodeTokenClaims } from './Login.tsx';
import { useAuthStore } from '../stores/auth-store.ts';
import { beginSignIn, oidcConfig } from '../services/oidc.ts';

const navigateMock = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => navigateMock };
});

// `oidcConfig()` reads `import.meta.env`, which vitest gives each module its
// OWN copy of — a test cannot set the one `oidc.ts` sees. So the module is
// mocked here, which is also what decides which of the two sign-in paths this
// page renders.
vi.mock('../services/oidc.ts', () => ({ oidcConfig: vi.fn(), beginSignIn: vi.fn() }));

// The page mounts BuildStamp, which asks the server what IT is running. That
// question belongs to build-identity's own tests; what this file has to show
// is that the sign-in page MOUNTS it at all — the gap reported from the Spark
// was a stamp that existed everywhere except the page you can see without an
// account.
vi.mock('../services/build-identity.ts', () => ({
  uiBuild: () => ({ version: '0.1.0-rc.1', commit: '72a78d4' }),
  fetchServerBuild: () => Promise.resolve(null),
  describeBuild: () => 'v0.1.0-rc.1 · 72a78d4',
  shortCommit: (c: string) => c.slice(0, 7),
}));
const oidcConfigMock = vi.mocked(oidcConfig);
const beginSignInMock = vi.mocked(beginSignIn);

// Build a JWT with the given payload (header/signature are cosmetic — the app
// only decodes the payload; the API verifies the real signature).
function makeToken(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

const renderLogin = () =>
  render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>
  );

describe('decodeTokenClaims', () => {
  it('returns claims for a well-formed token', () => {
    const token = makeToken({ sub: 'u1', email: 'a@b.c', tenantId: 't1', role: 'owner' });
    expect(decodeTokenClaims(token)).toEqual({
      sub: 'u1',
      email: 'a@b.c',
      tenantId: 't1',
      role: 'owner',
    });
  });

  it('rejects tokens missing required claims', () => {
    expect(decodeTokenClaims(makeToken({ sub: 'u1' }))).toBeNull();
    expect(decodeTokenClaims('not-a-jwt')).toBeNull();
  });
});

describe('Login', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    beginSignInMock.mockReset();
    // No issuer by default: that is the deployment that has not run the
    // identity setup script yet, and the reason the paste box still exists.
    oidcConfigMock.mockReturnValue(null);
    useAuthStore.getState().logout();
    localStorage.clear();
  });

  it('signs in with a valid token: stores auth context and navigates', async () => {
    const user = userEvent.setup();
    const token = makeToken({ sub: 'u1', email: 'owner-a@demo.test', tenantId: 'tenant-a', role: 'owner' });

    renderLogin();
    await user.type(screen.getByLabelText(/access token/i), token);
    await user.click(screen.getByRole('button', { name: /use this token/i }));

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.tenantId).toBe('tenant-a');
    expect(state.user?.email).toBe('owner-a@demo.test');
    expect(state.token).toBe(token);
    expect(localStorage.getItem('auth_token')).toBe(token);
    expect(navigateMock).toHaveBeenCalledWith('/dashboard');
  });

  it('rejects an invalid token and does not sign in', async () => {
    const user = userEvent.setup();

    renderLogin();
    await user.type(screen.getByLabelText(/access token/i), 'garbage');
    await user.click(screen.getByRole('button', { name: /use this token/i }));

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('offers the paste box plainly when there is no provider to offer instead', () => {
    renderLogin();
    // Not folded away: it is the only way in, and hiding it behind a disclosure
    // would strand a deployment mid-rollout.
    expect(screen.getByLabelText(/access token/i)).toBeVisible();
    expect(screen.queryByText(/sign in with a token instead/i)).not.toBeInTheDocument();
  });
});

describe('what build this is, before anybody has signed in', () => {
  it('the sign-in page carries its own stamp, having no sidebar to inherit one from', () => {
    // `Layout` renders BuildStamp in the sidebar and mounts only under
    // ProtectedRoute, so every route outside it — this one, /request-access,
    // /invitations — had no version on screen at all. The route-level rule is
    // in scripts/a-version-you-can-see-before-you-sign-in.unit.test.ts.
    oidcConfigMock.mockReturnValue(null);
    renderLogin();
    expect(screen.getByText('v0.1.0-rc.1 · 72a78d4')).toBeVisible();
  });
});

describe('Login with an issuer configured (ADR-0042)', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    beginSignInMock.mockReset();
    oidcConfigMock.mockReturnValue({ issuer: 'https://id.example.test', clientId: 'c1' });
    useAuthStore.getState().logout();
    localStorage.clear();
  });

  it('starts the real flow, and folds the token box away behind its own label', async () => {
    const user = userEvent.setup();
    beginSignInMock.mockResolvedValue(undefined);

    renderLogin();
    // Exactly one button reads "Sign in". The paste box's own button says
    // something else, or the two are a coin toss rather than a choice.
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(beginSignInMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/sign in with a token instead/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /use this token/i })).toBeInTheDocument();
  });

  it("shows the service's own sentence when the provider cannot be reached", async () => {
    const user = userEvent.setup();
    beginSignInMock.mockRejectedValue(new Error('The sign-in service did not answer at ... (503).'));

    renderLogin();
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    // One alert, not two: the token form has its own error and must stay quiet.
    expect(await screen.findByRole('alert')).toHaveTextContent(/did not answer/);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});
