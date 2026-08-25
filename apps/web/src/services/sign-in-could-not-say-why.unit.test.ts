// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE SIGN-IN THAT COULD NOT SAY WHY.
 *
 * Reported from the live test host on 2026-08-25, signing in at
 * `https://app.ota.ownpace.eu/login`: "i see it fast flashing and back at the
 * login". No message. Nothing to act on.
 *
 * `AuthCallback` is written to explain exactly this. Its catch block says so:
 * "The service's own sentence, verbatim where there is one. 'Sign-in failed'
 * tells somebody nothing they can act on". It sets an error and renders it.
 *
 * IT NEVER GETS THE CHANCE. `api.ts` installs a response interceptor that, on
 * ANY 401, calls `onUnauthorized()` — which clears the session and sets
 * `location.href = '/login'`. Axios runs response interceptors BEFORE the
 * caller's catch, so the browser is already navigating away by the time
 * `AuthCallback` sets the error. The one screen built to explain a failed
 * sign-in cannot explain the commonest way sign-in fails.
 *
 * That is not a cosmetic loss. A 401 here has several causes an operator can
 * fix — an `iss` that no longer matches `JWT_ISSUER` after the issuer moved, a
 * wrong audience, an expired token — and they are distinguishable ONLY by the
 * sentence the API sent. Swallowing it turns every one of them into the same
 * flash, which is how a bring-up loses an afternoon.
 *
 * THE REDIRECT IS RIGHT EVERYWHERE ELSE, and this does not weaken it. A 401 on
 * an ordinary screen means the session died under somebody who was using it,
 * and sending them to the login page is the correct answer — the third case
 * below pins that, because a fix that quietly disabled the dead-session
 * handling would be a worse bug than the one it fixed.
 *
 * AND THE TOKEN IT SENDS. `fetchMe` is handed the token that was just
 * exchanged, and passes it explicitly. The request interceptor then overwrites
 * `Authorization` with whatever `localStorage.auth_token` holds — which during
 * a callback is the PREVIOUS session's token, if there is one. So the one
 * request whose whole job is to validate the NEW token could be sent with the
 * OLD one, and answer 401 about a token nobody is trying to use.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import apiClient, { signInClient } from './api.ts';
import { fetchMe } from './session.ts';
import { useAuthStore } from '../stores/auth-store.ts';

/**
 * Answer every request with `status`, recording what was actually sent.
 *
 * BOTH clients are stubbed by default, and that is not belt-and-braces. Stubbing
 * only the one `fetchMe` is supposed to use makes this file pass when somebody
 * routes it through the other: the request would leave for a real network,
 * fail differently, and the redirect assertion would read clean. Measured — the
 * first version of this had that hole, and the proof-by-breaking run caught it
 * by failing two cases instead of three.
 */
function respondWith(status: number, data: unknown, clients = [signInClient, apiClient]) {
  const seen: AxiosRequestConfig[] = [];
  const adapter = async (config: AxiosRequestConfig) => {
    seen.push(config);
    const response = { data, status, statusText: '', headers: {}, config };
    if (status >= 400) {
      const err = new Error(`Request failed with status code ${status}`) as Error & {
        response: typeof response;
        isAxiosError: boolean;
      };
      err.isAxiosError = true;
      err.response = response;
      throw err;
    }
    return response as never;
  };
  for (const client of clients) client.defaults.adapter = adapter as never;
  return seen;
}

/** The stub installed in `beforeEach`, typed — `globalThis.location` is not. */
function locationStub(): { href: string; pathname: string } {
  return (globalThis as unknown as { location: { href: string; pathname: string } }).location;
}

describe('a sign-in that fails can say why', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.getState().logout();
    Object.defineProperty(globalThis, 'location', {
      value: { href: '', pathname: '/auth/callback' },
      writable: true,
      configurable: true,
    });
  });

  it('does not navigate away while the callback is still exchanging', async () => {
    respondWith(401, { error: 'Unauthorized', message: 'Token verification failed' });

    await expect(fetchMe('a-freshly-exchanged-token')).rejects.toThrow();

    expect(
      locationStub().href,
      'The 401 handler navigated to /login during the sign-in exchange, so\n' +
        "AuthCallback's error state was set on a page that was already leaving.\n" +
        'That is the flash with no message reported on 2026-08-25.',
    ).toBe('');
  });

  it('leaves the reason reachable, rather than clearing it on the way out', async () => {
    respondWith(401, { error: 'Unauthorized', message: 'Token verification failed' });

    // The rejection must still carry the API's own sentence — that is the whole
    // value of not redirecting.
    await fetchMe('a-freshly-exchanged-token').then(
      () => expect.unreachable('a 401 must reject'),
      (err: { response?: { data?: { message?: string } } }) => {
        expect(err.response?.data?.message).toBe('Token verification failed');
      },
    );
  });

  it('sends the token it was given, not one left over from last time', async () => {
    // The state during a real callback: a previous session's token is still in
    // localStorage, because nothing has cleared it yet.
    localStorage.setItem('auth_token', 'a-stale-token-from-the-last-issuer');
    const seen = respondWith(200, { userId: 'u1', tenants: [] });

    await fetchMe('a-freshly-exchanged-token');

    expect(
      seen[0]?.headers?.Authorization,
      'The request interceptor overwrote the explicitly-passed token with the\n' +
        'stale one from localStorage. The request that exists to validate the NEW\n' +
        'token was sent with the OLD one.',
    ).toBe('Bearer a-freshly-exchanged-token');
  });

  it('never lets the stored token override one a caller passed explicitly', async () => {
    // `fetchMe` no longer goes through `apiClient`, but `answerInvitation` does
    // and passes its token the same way. Benign today — the two values agree
    // once somebody is signed in — and exactly the trap that cost a morning
    // when they did not. A rule per fix, or the fix is only a habit.
    locationStub().pathname = '/invitations';
    localStorage.setItem('auth_token', 'a-stale-token');
    const seen = respondWith(200, {}, [apiClient]);

    await apiClient.post('/invitations/t1/accept', {}, {
      headers: { Authorization: 'Bearer the-one-the-caller-meant' },
    });

    expect(seen[0]?.headers?.Authorization).toBe('Bearer the-one-the-caller-meant');
  });

  it('STILL bounces a dead session on an ordinary screen', async () => {
    // The behaviour above must not become a licence to stay on a screen whose
    // session is gone. A 401 on a normal request is a dead session, and the
    // login page is the right answer.
    locationStub().pathname = '/dashboard';
    useAuthStore
      .getState()
      .login('t', { id: 'u1', email: 'u@x.io', name: 'U', role: 'owner' }, 'tenant-1');
    respondWith(401, { error: 'Unauthorized', message: 'Token expired' }, [apiClient]);

    await expect(apiClient.get('/mappings')).rejects.toThrow();

    expect(
      locationStub().href,
      'A 401 on an ordinary request no longer sends the operator to the login\n' +
        'page. The UI would sit there rendering a wall of red reads — the exact\n' +
        'state the dead-membership handling was added to end.',
    ).toBe('/login');
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});
