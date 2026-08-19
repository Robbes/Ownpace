// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The bearer transport, and what it does when Google says 401 (workplan 0042 T5).
 *
 * The connector's own tests deliberately know nothing about tokens — its seam is
 * a bare function. This is where that seam is filled in, so the two things that
 * can only go wrong here are pinned: the header, and the single retry.
 */

import { describe, it, expect } from 'vitest';
import type { OAuth2Token, TokenProvider } from '@openmig/shared';
import { googleDriveTransport, type DriveFetch } from './google-drive-transport.ts';

function tokenProvider(tokens: string[]): TokenProvider & { minted: number } {
  const queue = [...tokens];
  let current = queue.shift()!;
  const provider = {
    minted: 1,
    async getToken(): Promise<OAuth2Token> {
      return { accessToken: current, expiresAt: Date.now() + 3_600_000, tokenType: 'Bearer' };
    },
    async refresh(): Promise<OAuth2Token> {
      current = queue.shift() ?? current;
      provider.minted += 1;
      return provider.getToken();
    },
    isTokenValid: () => true,
    getTokenStatus: () => ({ isValid: true, timeUntilExpiry: 3600 }),
  };
  return provider;
}

interface Attempt {
  readonly url: string;
  readonly headers: Record<string, string>;
}

function fakeNetwork(statuses: number[]): { fetchImpl: DriveFetch; attempts: Attempt[] } {
  const attempts: Attempt[] = [];
  const queue = [...statuses];
  const fetchImpl: DriveFetch = async (url, init) => {
    attempts.push({ url, headers: { ...init.headers } });
    const status = queue.length > 1 ? queue.shift()! : queue[0]!;
    return {
      ok: status < 400,
      status,
      json: async () => ({ status }),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => String(status),
    };
  };
  return { fetchImpl, attempts };
}

describe('googleDriveTransport', () => {
  it('attaches the access token as a Bearer header', async () => {
    const { fetchImpl, attempts } = fakeNetwork([200]);
    const transport = googleDriveTransport(tokenProvider(['at-1']), fetchImpl);

    await transport('https://drive.test/v3/files');

    expect(attempts[0]!.headers.Authorization).toBe('Bearer at-1');
  });

  it("passes the caller's own headers through", async () => {
    const { fetchImpl, attempts } = fakeNetwork([200]);
    const transport = googleDriveTransport(tokenProvider(['at-1']), fetchImpl);

    await transport('https://drive.test/v3/files', { headers: { 'X-Trace': 'abc' } });

    expect(attempts[0]!.headers['X-Trace']).toBe('abc');
  });

  it('cannot have its Authorization header overridden by a caller', async () => {
    // The header is applied AFTER the caller's, deliberately: a transport whose
    // authentication a caller can replace by passing a header is not one.
    const { fetchImpl, attempts } = fakeNetwork([200]);
    const transport = googleDriveTransport(tokenProvider(['at-1']), fetchImpl);

    await transport('https://drive.test/v3/files', { headers: { Authorization: 'Bearer nope' } });

    expect(attempts[0]!.headers.Authorization).toBe('Bearer at-1');
  });

  it('mints a NEW token on 401 and retries once, transparently', async () => {
    // A pass can outlive an access token — a password change on the source
    // account revokes it mid-folder. Without this, every remaining item in the
    // pass fails and the owner is told their files are broken.
    const { fetchImpl, attempts } = fakeNetwork([401, 200]);
    const tokens = tokenProvider(['at-old', 'at-new']);
    const transport = googleDriveTransport(tokens, fetchImpl);

    const response = await transport('https://drive.test/v3/files');

    expect(response.status).toBe(200);
    expect(attempts.map((a) => a.headers.Authorization)).toEqual([
      'Bearer at-old',
      'Bearer at-new',
    ]);
    expect(tokens.minted).toBe(2);
  });

  it('retries EXACTLY once — a second 401 is returned, not looped', async () => {
    // A freshly minted token that is still refused is not a stale token: it is a
    // revoked grant, a scope the consent never included, or a file this account
    // cannot see. Looping turns one clear failure into a rate-limit ban.
    const { fetchImpl, attempts } = fakeNetwork([401]);
    const transport = googleDriveTransport(tokenProvider(['at-old', 'at-new']), fetchImpl);

    const response = await transport('https://drive.test/v3/files');

    expect(response.status).toBe(401);
    expect(attempts).toHaveLength(2);
  });

  it('does not mint a second token for a 403', async () => {
    // 403 is "this account may not", which a new token does not change. The
    // connector surfaces it verbatim instead.
    const { fetchImpl, attempts } = fakeNetwork([403]);
    const tokens = tokenProvider(['at-1']);

    const response = await googleDriveTransport(tokens, fetchImpl)('https://drive.test/v3/files');

    expect(response.status).toBe(403);
    expect(attempts).toHaveLength(1);
    expect(tokens.minted).toBe(1);
  });
});
