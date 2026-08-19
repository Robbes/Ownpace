// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The one revocation we can actually perform (workplan 0085 T4a).
 *
 * `token-revocation.ts` in `@openmig/shared` decides WHICH kinds are revocable
 * and why; this tests what happens on the wire for the one that is, and — just
 * as important — that the others never reach the wire at all. A POST to a
 * provider that has no revocation endpoint would either 404 quietly or, worse,
 * hit something unrelated.
 */

import { describe, it, expect } from 'vitest';
import { HttpTokenRevoker, GOOGLE_REVOKE_ENDPOINT } from './token-revoker.ts';
import type { TokenFetch } from './google-token-provider.ts';

/** Records what was sent, so the assertions can be about the request. */
function recordingFetch(
  response: { ok: boolean; status: number; body?: string } | Error,
): { fetchImpl: TokenFetch; calls: Array<{ url: string; body: string }> } {
  const calls: Array<{ url: string; body: string }> = [];
  const fetchImpl: TokenFetch = async (url, init) => {
    calls.push({ url, body: init.body });
    if (response instanceof Error) throw response;
    return {
      ok: response.ok,
      status: response.status,
      text: async () => response.body ?? '',
    };
  };
  return { fetchImpl, calls };
}

const GOOGLE_CREDS = {
  clientId: 'client-123.apps.googleusercontent.com',
  clientSecret: 'not-a-real-secret',
  refreshToken: '1//0gREFRESHTOKENnotreal',
};

describe('HttpTokenRevoker — Google', () => {
  it('posts the REFRESH token, because that is what mints the others', async () => {
    // Revoking an access token alone would leave the thing that issues more of
    // them untouched — which is the failure this whole task is about.
    const { fetchImpl, calls } = recordingFetch({ ok: true, status: 200 });
    const outcome = await new HttpTokenRevoker({ fetchImpl }).revoke({
      kind: 'gmail',
      credentials: GOOGLE_CREDS,
    });

    expect(outcome).toEqual({ kind: 'gmail', status: 'revoked' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(GOOGLE_REVOKE_ENDPOINT);
    expect(new URLSearchParams(calls[0]!.body).get('token')).toBe(GOOGLE_CREDS.refreshToken);
    // The client secret is not part of a revocation and must not be sent.
    expect(calls[0]!.body).not.toContain(GOOGLE_CREDS.clientSecret);
  });

  it('accepts snake_case credentials too', async () => {
    const { fetchImpl, calls } = recordingFetch({ ok: true, status: 200 });
    await new HttpTokenRevoker({ fetchImpl }).revoke({
      kind: 'google_drive',
      credentials: { refresh_token: 'stored-under-the-other-spelling' },
    });
    expect(new URLSearchParams(calls[0]!.body).get('token')).toBe('stored-under-the-other-spelling');
  });

  it('treats an already-invalid token as revoked, and says why', async () => {
    // The customer may have withdrawn it before asking us to erase them.
    // Reporting that as a failure would send somebody hunting for an
    // authorization that is not there.
    const { fetchImpl } = recordingFetch({
      ok: false,
      status: 400,
      body: '{"error":"invalid_token"}',
    });
    const outcome = await new HttpTokenRevoker({ fetchImpl }).revoke({
      kind: 'gmail',
      credentials: GOOGLE_CREDS,
    });

    expect(outcome.status).toBe('revoked');
    expect(outcome.reason).toMatch(/already invalid/i);
  });

  it('a refused revocation is failed, with the status in the reason', async () => {
    const { fetchImpl } = recordingFetch({ ok: false, status: 503, body: 'upstream unavailable' });
    const outcome = await new HttpTokenRevoker({ fetchImpl }).revoke({
      kind: 'gmail',
      credentials: GOOGLE_CREDS,
    });

    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toContain('503');
  });

  it('a provider that cannot be reached is failed, not thrown', async () => {
    // A throw here would abort the purge — refusing to forget somebody because
    // Google was unreachable, which is exactly the wrong way round.
    const { fetchImpl } = recordingFetch(new Error('ECONNREFUSED'));
    const outcome = await new HttpTokenRevoker({ fetchImpl }).revoke({
      kind: 'gmail',
      credentials: GOOGLE_CREDS,
    });

    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toContain('ECONNREFUSED');
  });

  it('no refresh token stored is no_credential, not a failure', async () => {
    const { fetchImpl, calls } = recordingFetch({ ok: true, status: 200 });
    const outcome = await new HttpTokenRevoker({ fetchImpl }).revoke({
      kind: 'gmail',
      credentials: { clientId: 'x' },
    });

    expect(outcome.status).toBe('no_credential');
    // Nothing was sent — there was nothing to send.
    expect(calls).toHaveLength(0);
  });

  it('truncates the provider body rather than pasting it into a customer record', async () => {
    const { fetchImpl } = recordingFetch({ ok: false, status: 500, body: 'x'.repeat(500) });
    const outcome = await new HttpTokenRevoker({ fetchImpl }).revoke({
      kind: 'gmail',
      credentials: GOOGLE_CREDS,
    });
    expect(outcome.reason!.length).toBeLessThan(200);
  });
});

describe('HttpTokenRevoker — everything else', () => {
  it.each(['o365', 'dropbox', 'box', 'imap', 'caldav', 'some_future_provider'])(
    '%s never reaches the network, and reports the reason',
    async (kind) => {
      // A POST to a provider with no revocation endpoint either 404s quietly or
      // hits something unrelated. Neither is a thing to do on a customer's
      // behalf, and the capability table already knows the answer.
      const { fetchImpl, calls } = recordingFetch({ ok: true, status: 200 });
      const outcome = await new HttpTokenRevoker({ fetchImpl }).revoke({
        kind,
        credentials: { refreshToken: 'whatever' },
      });

      expect(outcome.status).toBe('unsupported');
      expect(outcome.reason!.length).toBeGreaterThan(20);
      expect(calls).toHaveLength(0);
    },
  );
});
