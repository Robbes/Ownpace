// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Regression test for the 401 handler: it must clear ALL auth state (the raw
 * `auth_token` key AND the zustand-persisted store), so `isAuthenticated` never
 * stays stale after an unauthorized response.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { z as zm } from 'zod/mini';
import apiClient, { onUnauthorized, serverMessage, unreadableAnswer } from './api.ts';
import { publishLocale } from '../i18n/active-locale.ts';
import type { AxiosAdapter } from 'axios';
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

/**
 * AN ANSWER THE PAGE'S SCHEMA REFUSED (reported 2026-09-29).
 *
 * A zod error's message is the JSON of its issues, and every screen showing
 * `serverMessage(err)` under a failed read of a parsed answer showed that
 * JSON. It is ours to word, in the reader's language, with the first issue's
 * code and path kept for support. The page-level cases, on the reported
 * Migrations list, are in `pages/an-answer-the-page-could-not-read.unit.test.tsx`.
 */
describe('serverMessage — an answer the page could not read', () => {
  const refusal = (schema: z.ZodType, value: unknown): unknown => {
    const result = schema.safeParse(value);
    if (result.success) throw new Error('the schema accepted the value');
    return result.error;
  };
  const DOMAINS = z.object({ domains: z.array(z.enum(['email', 'calendar', 'contact'])) }).array();
  const reported = () => refusal(DOMAINS, [{ domains: ['email'] }, { domains: ['email', 'contacts'] }]);

  afterEach(() => publishLocale('en'));

  it('says a sentence and the path in English, and no JSON', () => {
    const said = serverMessage(reported());
    expect(said).toBe(
      'The server answered in a form this page does not know. Reload the page; if it stays like this, ' +
        'report it to support, and mention: invalid_value at 1.domains.1.',
    );
    expect(said).not.toContain('"code":');
    expect(said).not.toContain('[');
  });

  it('says it in Dutch when the screen is in Dutch', () => {
    publishLocale('nl');
    const said = serverMessage(reported());
    expect(said).toBe(
      'De server antwoordde in een vorm die deze pagina niet kent. Laad de pagina opnieuw; blijft het zo, ' +
        'meld het en geef daarbij het volgende door: invalid_value bij 1.domains.1.',
    );
    expect(said).not.toContain('"code":');
  });

  it('says so when the whole answer was the wrong shape, with no path to give', () => {
    // A proxy's HTML page answered with a 200 is refused at the root.
    expect(serverMessage(refusal(DOMAINS, '<html>502</html>'))).toBe(
      'The server answered in a form this page does not know. Reload the page; if it stays like this, ' +
        'report it to support, and mention: invalid_type, in the whole answer.',
    );
  });

  it('recognises a zod error from the core and mini builds too', () => {
    const mini = zm.object({ n: zm.number() }).safeParse({ n: 'one' });
    expect(mini.success).toBe(false);
    expect(unreadableAnswer(mini.error)).toEqual({ code: 'invalid_type', path: 'n' });
  });

  it('is not an unreadable answer when the server refused with its own words', () => {
    // The Axios refusal keeps the server's sentence; the case above this
    // block holds that for every shape it reads.
    const axiosRefusal = Object.assign(new Error('Request failed with status code 400'), {
      isAxiosError: true,
      response: { data: { error: 'Validation error', details: [{ message: 'Name is required.' }] } },
    });
    expect(unreadableAnswer(axiosRefusal)).toBeNull();
    expect(serverMessage(axiosRefusal)).toBe('Name is required.');
    expect(unreadableAnswer(new Error('plain'))).toBeNull();
    expect(serverMessage(new Error('plain'))).toBe('plain');
  });
});

/**
 * THE 403 THAT THREW AWAY A SESSION THAT WAS FINE.
 *
 * A dead membership is a dead session (release-readiness, 2026-08-10): a valid
 * token whose subject has no active `tenant_member` row 403s on every route
 * forever, and the UI used to stay "logged in" rendering a wall of red reads.
 * So the interceptor reads that one sentence as "sign out".
 *
 * It was written before anybody belonged to no organisation ON PURPOSE. A
 * platform operator does (0093 T6/T7) — `/api/me` runs on
 * `authenticateSubject` precisely so the one person who lets the others in can
 * hold a session without a tenant — and that sentence is what EVERY
 * tenant-scoped route answers them. Reported from the OTA instance on
 * 2026-08-31, by the operator who had just appointed himself:
 *
 *     "I see the full menu, and if I click on any menu items, I switch back
 *      to login and eventually back to the message on me lacking being part
 *      of an organisation."
 *
 * Two defects, one symptom. `Layout` no longer OFFERS those screens (its own
 * test covers that); this is the other half — reaching one by typed URL must
 * cost a sentence, not the session.
 */
describe('the membership 403, and who it is really about', () => {
  /** An adapter that answers whatever the API would have. */
  const answering = (status: number, data: unknown): AxiosAdapter =>
    (config) =>
      Promise.reject(
        Object.assign(new Error('refused'), {
          isAxiosError: true,
          config,
          response: { status, data, config, headers: {}, statusText: '' },
        }),
      );

  const MEMBERSHIP_403 = { status: 403, body: { message: 'No active membership for this tenant' } };

  let original: AxiosAdapter | undefined;

  beforeEach(() => {
    localStorage.clear();
    useAuthStore.getState().logout();
    original = apiClient.defaults.adapter as AxiosAdapter | undefined;
    Object.defineProperty(globalThis, 'location', {
      value: { href: '' },
      writable: true,
      configurable: true,
    });
  });

  const signedInAs = (operator: boolean) =>
    useAuthStore
      .getState()
      .login('jwt', { id: 'u1', email: 'u@x.io', name: 'U', role: 'member' }, '', operator, 0);

  const ask = async (status: number, body: unknown) => {
    apiClient.defaults.adapter = answering(status, body);
    try {
      await apiClient.get('/anything');
    } catch {
      /* the refusal is the point */
    } finally {
      apiClient.defaults.adapter = original;
    }
    return useAuthStore.getState();
  };

  it('signs out an ordinary member whose membership is gone', () => {
    // The behaviour that must NOT be lost: this is what the rule is for.
    signedInAs(false);
    return ask(MEMBERSHIP_403.status, MEMBERSHIP_403.body).then((state) => {
      expect(state.isAuthenticated).toBe(false);
      expect(localStorage.getItem('auth_token')).toBeNull();
    });
  });

  it('leaves a platform operator signed in — their session was never the problem', async () => {
    signedInAs(true);
    const state = await ask(MEMBERSHIP_403.status, MEMBERSHIP_403.body);
    expect(
      state.isAuthenticated,
      'a platform operator was signed out by opening a tenant-scoped screen.\n\n' +
        'They belong to no organisation BY DESIGN, so that 403 is what every\n' +
        'such route answers them — it means "that screen is not yours", never\n' +
        '"your session died". Signing them out makes the one person who can\n' +
        'answer the access queue unable to stay anywhere in the product.',
    ).toBe(true);
    expect(localStorage.getItem('auth_token')).toBe('jwt');
  });

  it('still signs anybody out on a 401, operator or not', async () => {
    // The revoked-operator case: `operator` here is a hint from the last
    // /api/me and grants nothing, so what actually ends their session is the
    // token being refused — which is a 401, and untouched by any of this.
    signedInAs(true);
    const state = await ask(401, { message: 'Unauthorized' });
    expect(state.isAuthenticated).toBe(false);
  });

  it('leaves a role refusal to the screen that knows how to say it', async () => {
    // A different 403 — a member opening Billing — never signed anybody out
    // and still must not, for either kind of caller.
    signedInAs(false);
    const state = await ask(403, { message: 'Owner or admin only' });
    expect(state.isAuthenticated).toBe(true);
  });
});
