// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Regression test for the 401 handler: it must clear ALL auth state (the raw
 * `auth_token` key AND the zustand-persisted store), so `isAuthenticated` never
 * stays stale after an unauthorized response.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { onUnauthorized, serverMessage } from './api.ts';
import { useAuthStore } from '../stores/auth-store.ts';

describe('onUnauthorized (401 handler)', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.getState().logout();
    // Replace jsdom's location with a plain stub so the redirect just sets a
    // property (jsdom otherwise logs "Not implemented: navigation").
    Object.defineProperty(globalThis, 'location', {
      value: { href: '' },
      writable: true,
      configurable: true,
    });
  });

  it('clears both the raw token and the persisted auth store', () => {
    // Simulate a logged-in session (login writes auth_token + persists state).
    useAuthStore.getState().login('jwt-token', { id: 'u1', email: 'u@x.io', name: 'U', role: 'admin' }, 't1');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(localStorage.getItem('auth_token')).toBe('jwt-token');

    onUnauthorized();

    // Raw token key cleared…
    expect(localStorage.getItem('auth_token')).toBeNull();
    // …AND the store reset (no stale isAuthenticated/token).
    const s = useAuthStore.getState();
    expect(s.isAuthenticated).toBe(false);
    expect(s.token).toBeNull();
    expect(s.user).toBeNull();
    expect(s.tenantId).toBeNull();
  });
});

/**
 * `serverMessage` has to read BOTH body shapes this API answers with
 * (workplan 0068).
 *
 * The routes are split roughly 44/24 between `{error, message}` and
 * `{error, reason}`, and every connections route is in the second group. The
 * helper only knew the first, so it fell through to `error` — and the
 * delete-in-use refusal, whose whole job is to name the migrations blocking the
 * delete, rendered as the bare code `in_use`. The owner met it on a phone as
 * "Request failed with status code 409", which is the OTHER half of the same
 * bug: the screen was reading `err.message` and never calling this at all.
 */
describe('serverMessage', () => {
  const axiosErr = (data: unknown) =>
    Object.assign(new Error('Request failed with status code 409'), {
      isAxiosError: true,
      response: { data },
    });

  it('prefers `message` when the route answers that shape', () => {
    expect(serverMessage(axiosErr({ error: 'x', message: 'The named sentence.' }))).toBe(
      'The named sentence.',
    );
  });

  it('reads `reason`, which the connections routes use', () => {
    expect(
      serverMessage(axiosErr({ error: 'in_use', reason: 'Still used by “Acme mail”.' })),
    ).toBe('Still used by “Acme mail”.');
  });

  it('never renders the bare error CODE while a sentence is present', () => {
    // The regression in one line: `in_use` is a label for us, not an answer
    // for the person who just pressed Delete.
    expect(serverMessage(axiosErr({ error: 'in_use', reason: 'Because X.' }))).not.toBe('in_use');
  });

  it('falls back to the code only when there is no sentence at all', () => {
    expect(serverMessage(axiosErr({ error: 'in_use' }))).toBe('in_use');
  });

  it('falls back to the transport message when there is no body', () => {
    expect(serverMessage(axiosErr(undefined))).toBe('Request failed with status code 409');
  });
});
