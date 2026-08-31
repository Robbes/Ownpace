// Copyright 2026 The Ownpace authors (Apache-2.0)

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Login, { decodeTokenClaims } from './Login.tsx';
import { useAuthStore } from '../stores/auth-store.ts';
import { beginSignIn, oidcConfig } from '../services/oidc.ts';
import { fetchMe } from '../services/session.ts';
import { fetchAuthMode } from '../services/auth-mode.ts';

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

// WHAT THE API WILL ACCEPT, which is now what decides whether the paste box is
// rendered at all (0102 T1). Mocked rather than stubbed through the http layer
// because this file is about what the page DOES with the answer; `auth-mode.ts`
// has its own test for how it asks.
vi.mock('../services/auth-mode.ts', () => ({ fetchAuthMode: vi.fn() }));
const fetchAuthModeMock = vi.mocked(fetchAuthMode);

const oidcConfigMock = vi.mocked(oidcConfig);
const beginSignInMock = vi.mocked(beginSignIn);

// Build a JWT with the given payload (header/signature are cosmetic — the app
// only decodes the payload; the API verifies the real signature).
function makeToken(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

/**
 * Render AND let the mode answer land.
 *
 * The page asks the API what it accepts before offering anything, and renders
 * only a "checking" line until that resolves — deliberately, because a box that
 * appears and then vanishes has offered a way in that was never there. Every
 * case therefore has to wait, or it asserts against that intermediate state.
 */
const renderLogin = async () => {
  const utils = render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>
  );
  await vi.waitFor(() =>
    expect(screen.queryByText(/checking how this deployment/i)).toBeNull()
  );
  return utils;
};

describe('decodeTokenClaims', () => {
  it('returns claims for a well-formed token', async () => {
    const token = makeToken({ sub: 'u1', email: 'a@b.c', tenantId: 't1', role: 'owner' });
    expect(decodeTokenClaims(token)).toEqual({
      sub: 'u1',
      email: 'a@b.c',
      tenantId: 't1',
      role: 'owner',
    });
  });

  it('rejects tokens missing required claims', async () => {
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
    // No issuer on the API either, by default — the same deployment the
    // `oidcConfig` default above describes, seen from the other side. The
    // managed case is set explicitly where it is the subject.
    fetchAuthModeMock.mockReset();
    fetchAuthModeMock.mockResolvedValue({ mode: 'local', acceptsSeedToken: true });
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

    await renderLogin();
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

  /**
   * THE SECOND DOOR INTO THE SAME TRAP.
   *
   * A platform operator belongs to no organisation by design (0093 T6/T7), and
   * this path's refusal only covered a NON-operator with none —
   * `tenants.length === 0 && operator !== true`. So an operator pasting a token
   * fell through to `navigate('/dashboard')`, whose first request answers 403
   * "No active membership for this tenant", which signs them out. The one
   * person who can answer the access queue reached it by being thrown out of a
   * screen that was never theirs. `AuthCallback` had chosen the right landing
   * since 0093 T7; this door had not been told.
   */
  it('lands a platform operator on the queue, not a dashboard that 403s', async () => {
    fetchMeMock.mockResolvedValue({
      userId: 'op1',
      email: 'operator@example.test',
      role: 'member',
      tenants: [],
      operator: true,
    });
    const user = userEvent.setup();
    // The token CARRIES a tenantId — `decodeTokenClaims` requires one, and a
    // seed token always has it. What has changed is the answer from the
    // server: this subject's membership is gone (or never was), and
    // `/api/me` is what the page trusts. That is the reachable shape of "an
    // operator with no organisation arrives through this door".
    const token = makeToken({
      sub: 'op1',
      email: 'operator@example.test',
      tenantId: 'tenant-gone',
      role: 'member',
    });

    await renderLogin();
    await user.type(screen.getByLabelText(/access token/i), token);
    await user.click(screen.getByRole('button', { name: /use this token/i }));

    await vi.waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/access-requests'));
    expect(navigateMock).not.toHaveBeenCalledWith('/dashboard');
    // And the store learns they are in no organisation, which is what stops
    // the nav offering them six screens that cannot open.
    expect(useAuthStore.getState().tenantCount).toBe(0);
    expect(useAuthStore.getState().operator).toBe(true);
  });

  it('still lands an ordinary member on the dashboard', async () => {
    // The other half: the default fixture belongs to one organisation, so the
    // landing above must not have become unconditional.
    const user = userEvent.setup();
    const token = makeToken({ sub: 'u1', email: 'owner-a@demo.test', tenantId: 'tenant-a', role: 'owner' });

    await renderLogin();
    await user.type(screen.getByLabelText(/access token/i), token);
    await user.click(screen.getByRole('button', { name: /use this token/i }));

    await vi.waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/dashboard'));
    expect(useAuthStore.getState().tenantCount).toBe(1);
  });

  it('rejects an invalid token and does not sign in', async () => {
    const user = userEvent.setup();

    await renderLogin();
    await user.type(screen.getByLabelText(/access token/i), 'garbage');
    await user.click(screen.getByRole('button', { name: /use this token/i }));

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('offers the paste box plainly when there is no provider to offer instead', async () => {
    await renderLogin();
    // Not folded away: it is the only way in, and hiding it behind a disclosure
    // would strand a deployment mid-rollout.
    expect(screen.getByLabelText(/access token/i)).toBeVisible();
    expect(screen.queryByText(/sign in with a token instead/i)).not.toBeInTheDocument();
  });
});

describe('what build this is, before anybody has signed in', () => {
  it('the sign-in page carries its own stamp, having no sidebar to inherit one from', async () => {
    // `Layout` renders BuildStamp in the sidebar and mounts only under
    // ProtectedRoute, so every route outside it — this one, /request-access,
    // /invitations — had no version on screen at all. The route-level rule is
    // in scripts/a-version-you-can-see-before-you-sign-in.unit.test.ts.
    oidcConfigMock.mockReturnValue(null);
    await renderLogin();
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

    await renderLogin();
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

    await renderLogin();
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
    await renderLogin();
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

/**
 * WHAT THE API WILL ACCEPT DECIDES WHAT IS OFFERED (workplan 0102 T1).
 *
 * The page used to decide from `VITE_OIDC_ISSUER`, a build-time value. The
 * authority is `selectAuthMode(JWT_ISSUER, JWT_SECRET)` in the API at request
 * time, and on a stack where the two disagreed the box took a token, signed
 * somebody in, and bounced them back here.
 */
describe('the paste box follows the API, not the bundle', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    beginSignInMock.mockReset();
    fetchAuthModeMock.mockReset();
    fetchMeMock.mockReset();
    useAuthStore.getState().logout();
    localStorage.clear();
  });

  it('offers no paste box at all when the API is in managed mode', async () => {
    oidcConfigMock.mockReturnValue({ issuer: 'https://id.example.com', clientId: 'web' });
    fetchAuthModeMock.mockResolvedValue({ mode: 'managed', acceptsSeedToken: false });

    await renderLogin();

    // Not folded away — GONE. Managed mode verifies against the provider's
    // JWKS and never falls back to the secret a seed token is signed with, so
    // a disclosure holding that box is a drawer with nothing usable in it.
    expect(screen.queryByLabelText(/access token/i)).toBeNull();
    expect(screen.queryByText(/token instead/i)).toBeNull();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeVisible();
  });

  it('names the misconfiguration when the API is managed and the build knows no issuer', async () => {
    // The state #562 left behind. Neither credential is on offer, and saying
    // nothing would leave an empty screen under a heading.
    oidcConfigMock.mockReturnValue(null);
    fetchAuthModeMock.mockResolvedValue({ mode: 'managed', acceptsSeedToken: false });

    await renderLogin();

    expect(screen.queryByLabelText(/access token/i)).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(/identity provider/i);
    expect(screen.getByRole('alert')).toHaveTextContent(/VITE_OIDC_ISSUER/);
  });

  it('offers neither when it could not ask, rather than falling back to the box', async () => {
    // A FAILURE IS NOT A FALLBACK. On a managed stack the box is refused
    // anyway, so offering it here would invent a way in; and an API that
    // cannot answer this cannot verify a token either.
    oidcConfigMock.mockReturnValue(null);
    fetchAuthModeMock.mockRejectedValue(new Error('Network Error'));

    await renderLogin();

    expect(screen.queryByLabelText(/access token/i)).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(/could not ask this deployment/i);
  });

  it('shows nothing to sign in with while the answer is outstanding', async () => {
    // The flicker this task is about, from the other direction: a box that
    // appears and is then taken away has offered a way in that was never there.
    oidcConfigMock.mockReturnValue(null);
    let settle: (mode: { mode: 'local'; acceptsSeedToken: boolean }) => void = () => {};
    fetchAuthModeMock.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      })
    );

    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );

    expect(screen.queryByLabelText(/access token/i)).toBeNull();
    expect(screen.getByText(/checking how this deployment/i)).toBeVisible();

    settle({ mode: 'local', acceptsSeedToken: true });
    expect(await screen.findByLabelText(/access token/i)).toBeVisible();
  });
});

