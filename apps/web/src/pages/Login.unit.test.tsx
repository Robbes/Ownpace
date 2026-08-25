// Copyright 2026 The Ownpace authors (Apache-2.0)

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Login, { decodeTokenClaims } from './Login.tsx';
import { useAuthStore } from '../stores/auth-store.ts';
import { beginSignIn, oidcConfig } from '../services/oidc.ts';
import { fetchMe } from '../services/session.ts';

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
// The paste path now ASKS THE API whether the token is any good, rather than
// trusting its own decode. That call is what these cases steer.
vi.mock('../services/session.ts', () => ({ fetchMe: vi.fn() }));
const fetchMeMock = vi.mocked(fetchMe);

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
    // The paste path now ASKS THE API rather than trusting its own decode, so
    // every case here needs an answer. This is the accepting one; the refusals
    // live in their own describe below.
    fetchMeMock.mockReset();
    fetchMeMock.mockResolvedValue({
      userId: 'u1',
      email: 'owner-a@demo.test',
      tenantId: 'tenant-a',
      role: 'owner',
      tenants: [{ tenantId: 'tenant-a', role: 'owner' }],
    });
    useAuthStore.getState().logout();
    localStorage.clear();
  });

  it('signs in with a valid token: stores auth context and navigates', async () => {
    const user = userEvent.setup();
    const token = makeToken({ sub: 'u1', email: 'owner-a@demo.test', tenantId: 'tenant-a', role: 'owner' });

    renderLogin();
    await user.type(screen.getByLabelText(/access token/i), token);
    await user.click(screen.getByRole('button', { name: /use this token/i }));

    await vi.waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/dashboard'));
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.tenantId).toBe('tenant-a');
    expect(state.user?.email).toBe('owner-a@demo.test');
    expect(state.token).toBe(token);
    expect(localStorage.getItem('auth_token')).toBe(token);
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

/**
 * A PASTED TOKEN THAT THE API WILL NEVER ACCEPT.
 *
 * Reported from the live test host on 2026-08-25: "when login with a valid
 * seed, i see it fast flashing and back at the login". The seed's tokens are
 * signed with `JWT_SECRET`, and any stack that has run the identity setup has
 * `JWT_ISSUER` set — which puts the API in managed mode, where verification
 * goes to the provider's JWKS and never falls back to the secret. That is
 * deliberate (a lingering secret must not silently downgrade verification), and
 * it makes those tokens well-formed, unexpired, and unusable.
 *
 * The page could not see that, because it decided on its own decode: it logged
 * in, navigated to the dashboard, and the first real request answered 401 —
 * which the global handler turns into a redirect back to this page, carrying
 * nothing. The person is returned to the screen they started on with no
 * sentence anywhere.
 */
describe('a pasted token is checked with the API, not just decoded', () => {
  beforeEach(() => {
    oidcConfigMock.mockReturnValue({ issuer: 'https://idp.example', clientId: 'web' });
    fetchMeMock.mockReset();
    navigateMock.mockReset();
    useAuthStore.getState().logout();
  });

  const paste = async (token: string) => {
    const user = userEvent.setup();
    renderLogin();
    // The box is folded away behind a disclosure once a provider is configured.
    await user.click(screen.getByText(/token instead/i));
    await user.type(screen.getByLabelText(/access token/i), token);
    await user.click(screen.getByRole('button', { name: /use this token/i }));
  };

  const good = makeToken({ sub: 'u1', email: 'a@b.io', tenantId: 't1', role: 'owner' });

  it("shows the API's own sentence instead of bouncing", async () => {
    const rejected = Object.assign(new Error('Request failed with status code 401'), {
      isAxiosError: true,
      response: { status: 401, data: { error: 'Unauthorized', message: 'Invalid token' } },
    });
    fetchMeMock.mockRejectedValue(rejected);

    await paste(good);

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid token');
    expect(
      navigateMock,
      'It navigated to the dashboard on the strength of its own decode. The ' +
        'first request there answers 401 and the global handler returns the ' +
        'browser to this page with nothing written on it — the reported flash.',
    ).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('does not declare a session before the API has agreed', async () => {
    let settle: (v: unknown) => void = () => {};
    fetchMeMock.mockReturnValue(new Promise((r) => { settle = r; }) as never);

    await paste(good);

    // Mid-flight: nothing stored, nowhere navigated.
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(localStorage.getItem('auth_token')).toBeNull();
    settle({ userId: 'u1', email: 'a@b.io', tenantId: 't1', role: 'owner', tenants: [{ tenantId: 't1', role: 'owner' }] });
  });

  it('signs in when the API accepts it, with the identity the API reported', async () => {
    // ADR-0042: who somebody is comes from /api/me, never from claims this
    // page decoded. Reading tenantId and role off the token was the design the
    // OIDC path replaced, and this path was still doing it.
    fetchMeMock.mockResolvedValue({
      userId: 'zitadel-sub-9',
      email: 'real@b.io',
      tenantId: 'tenant-from-the-database',
      role: 'member',
      tenants: [{ tenantId: 'tenant-from-the-database', role: 'member' }],
    });

    await paste(good);

    await vi.waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/dashboard'));
    const s = useAuthStore.getState();
    expect(s.tenantId).toBe('tenant-from-the-database');
    expect(s.user?.id).toBe('zitadel-sub-9');
    expect(s.user?.role).toBe('member');
  });
});
