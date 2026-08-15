// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Google's refresh-token flow, against a fake token endpoint (workplan 0042 T5).
 *
 * What these hold, in order of what they would cost:
 *  1. The grant is the REFRESH one, posted to Google's endpoint — not Microsoft's.
 *  2. The credentials never reach an error message somebody will log.
 *  3. A token is minted once and reused, and once when N callers ask at once.
 *  4. A near-expiry token is replaced BEFORE it fails a request.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  GoogleTokenProvider,
  DRIVE_READONLY_SCOPE,
  type TokenFetch,
} from './google-token-provider';

const CREDS = {
  clientId: 'client-1.apps.googleusercontent.com',
  clientSecret: 'GOCSPX-super-secret',
  refreshToken: '1//refresh-token-value',
};

const ENDPOINT = 'https://oauth.test/token';

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly body: string;
}

/** A token endpoint that answers from a queue, and records what was asked. */
function fakeEndpoint(
  answers: Array<{ ok: boolean; status: number; body: string }>,
): { fetchImpl: TokenFetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const queue = [...answers];
  const fetchImpl: TokenFetch = async (url, init) => {
    sent.push({ url, method: init.method, body: init.body });
    const answer = queue.length > 1 ? queue.shift()! : queue[0]!;
    return { ok: answer.ok, status: answer.status, text: async () => answer.body };
  };
  return { fetchImpl, sent };
}

function granted(accessToken: string, expiresIn = 3600) {
  return {
    ok: true,
    status: 200,
    body: JSON.stringify({
      access_token: accessToken,
      expires_in: expiresIn,
      token_type: 'Bearer',
      scope: DRIVE_READONLY_SCOPE,
    }),
  };
}

describe('construction', () => {
  it('refuses an empty credential, NAMING which one', () => {
    // Google answers `invalid_client` for both an empty client id and a deleted
    // one, and an operator cannot tell those apart from the error.
    expect(() => new GoogleTokenProvider({ ...CREDS, refreshToken: '' })).toThrow(/refreshToken/);
    expect(() => new GoogleTokenProvider({ ...CREDS, clientSecret: '' })).toThrow(/clientSecret/);
  });
});

describe('minting', () => {
  it('posts the REFRESH grant, with read-only Drive scope', async () => {
    const { fetchImpl, sent } = fakeEndpoint([granted('at-1')]);
    const provider = new GoogleTokenProvider(CREDS, { tokenEndpoint: ENDPOINT, fetchImpl });

    const token = await provider.getToken();

    expect(token.accessToken).toBe('at-1');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(ENDPOINT);
    expect(sent[0]!.method).toBe('POST');

    const form = new URLSearchParams(sent[0]!.body);
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe(CREDS.refreshToken);
    expect(form.get('client_id')).toBe(CREDS.clientId);
    // A migration reads. A token that cannot write is the cheapest guarantee
    // this product never modifies the source.
    expect(form.get('scope')).toBe('https://www.googleapis.com/auth/drive.readonly');
  });

  it('reuses the token rather than minting per request', async () => {
    const { fetchImpl, sent } = fakeEndpoint([granted('at-1')]);
    const provider = new GoogleTokenProvider(CREDS, { tokenEndpoint: ENDPOINT, fetchImpl });

    await provider.getToken();
    await provider.getToken();
    await provider.getToken();

    expect(sent, 'a mint per request would rate-limit a real pass').toHaveLength(1);
  });

  it('re-mints a token that is about to expire, before it fails a request', async () => {
    // 60 seconds left is inside the five-minute buffer. A pass processes items
    // for minutes; handing out a token that dies mid-folder fails items that
    // have nothing wrong with them.
    const { fetchImpl, sent } = fakeEndpoint([granted('at-old', 60), granted('at-new')]);
    const provider = new GoogleTokenProvider(CREDS, { tokenEndpoint: ENDPOINT, fetchImpl });

    expect((await provider.getToken()).accessToken).toBe('at-old');
    expect((await provider.getToken()).accessToken).toBe('at-new');
    expect(sent).toHaveLength(2);
  });

  it('mints ONCE when many callers ask at the same time', async () => {
    // The files pass runs items concurrently. Without single-flight, a token
    // expiring mid-pass produces one token request per in-flight item.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[] = [];
    const fetchImpl: TokenFetch = async (url) => {
      calls.push(url);
      await gate;
      return { ok: true, status: 200, text: async () => granted('at-1').body };
    };

    const provider = new GoogleTokenProvider(CREDS, { tokenEndpoint: ENDPOINT, fetchImpl });
    const all = Promise.all([provider.getToken(), provider.getToken(), provider.getToken()]);
    release();
    const tokens = await all;

    expect(calls).toHaveLength(1);
    expect(tokens.map((t) => t.accessToken)).toEqual(['at-1', 'at-1', 'at-1']);
  });

  it('refresh() replaces a cached token instead of returning it', async () => {
    const { fetchImpl, sent } = fakeEndpoint([granted('at-1'), granted('at-2')]);
    const provider = new GoogleTokenProvider(CREDS, { tokenEndpoint: ENDPOINT, fetchImpl });

    await provider.getToken();
    expect((await provider.refresh()).accessToken).toBe('at-2');
    expect(sent).toHaveLength(2);
  });
});

describe('failures', () => {
  it("carries Google's status and body verbatim, and names what invalid_grant means", async () => {
    const { fetchImpl } = fakeEndpoint([
      { ok: false, status: 400, body: '{"error":"invalid_grant","error_description":"Bad Request"}' },
    ]);
    const provider = new GoogleTokenProvider(CREDS, { tokenEndpoint: ENDPOINT, fetchImpl });

    // The single most common real failure — a revoked or six-months-unused
    // refresh token — and Google's body says nothing about why (rule 9).
    await expect(provider.getToken()).rejects.toThrow(/400/);
    await expect(provider.getToken()).rejects.toThrow(/invalid_grant/);
    await expect(provider.getToken()).rejects.toThrow(/revoked|expired/i);
  });

  it('NEVER puts the client secret or refresh token in the error', async () => {
    // Errors reach logs and the owner's failures queue. Including the request
    // body would put a live credential in both.
    const { fetchImpl } = fakeEndpoint([{ ok: false, status: 401, body: 'Unauthorized' }]);
    const provider = new GoogleTokenProvider(CREDS, { tokenEndpoint: ENDPOINT, fetchImpl });

    const error = await provider.getToken().catch((e: Error) => e);

    expect(String(error)).not.toContain(CREDS.clientSecret);
    expect(String(error)).not.toContain(CREDS.refreshToken);
  });

  it('parses a REAL-LENGTH token response, not just a short fake one', async () => {
    // A `ya29.` access token runs to hundreds of characters. The first version
    // of this file read the body through a 500-character cap meant for error
    // messages, so every fake in this suite fitted and a real Google response
    // would have failed to parse — the exact shape of bug a unit suite full of
    // tidy fixtures cannot see.
    const long = `ya29.${'a'.repeat(900)}`;
    const { fetchImpl } = fakeEndpoint([
      {
        ok: true,
        status: 200,
        body: JSON.stringify({
          access_token: long,
          expires_in: 3599,
          token_type: 'Bearer',
          scope: DRIVE_READONLY_SCOPE,
        }),
      },
    ]);
    const provider = new GoogleTokenProvider(CREDS, { tokenEndpoint: ENDPOINT, fetchImpl });

    expect((await provider.getToken()).accessToken).toBe(long);
  });

  it('refuses a 200 that carries no access_token', async () => {
    // A proxy or a captive portal answering 200 with HTML would otherwise
    // become a Bearer header reading "undefined" and a 401 far from the cause.
    const { fetchImpl } = fakeEndpoint([{ ok: true, status: 200, body: '{"scope":"..."}' }]);
    const provider = new GoogleTokenProvider(CREDS, { tokenEndpoint: ENDPOINT, fetchImpl });

    await expect(provider.getToken()).rejects.toThrow(/no access_token/);
  });

  it('does not cache a failure — the next call tries again', async () => {
    const answers = [
      { ok: false, status: 503, body: 'backend error' },
      granted('at-1'),
    ];
    const queue = [...answers];
    const fetchImpl: TokenFetch = async () => {
      const a = queue.shift()!;
      return { ok: a.ok, status: a.status, text: async () => a.body };
    };
    const provider = new GoogleTokenProvider(CREDS, { tokenEndpoint: ENDPOINT, fetchImpl });

    await expect(provider.getToken()).rejects.toThrow(/503/);
    expect((await provider.getToken()).accessToken).toBe('at-1');
  });
});

describe('status reporting', () => {
  it('reports invalid before anything is minted, and valid after', async () => {
    const { fetchImpl } = fakeEndpoint([granted('at-1')]);
    const provider = new GoogleTokenProvider(CREDS, { tokenEndpoint: ENDPOINT, fetchImpl });

    expect(provider.isTokenValid()).toBe(false);
    expect(provider.getTokenStatus()).toEqual({ isValid: false, timeUntilExpiry: 0 });

    await provider.getToken();

    expect(provider.isTokenValid()).toBe(true);
    const status = provider.getTokenStatus();
    expect(status.isValid).toBe(true);
    expect(status.scope).toBe(DRIVE_READONLY_SCOPE);
    expect(status.timeUntilExpiry).toBeGreaterThan(3000);
  });

  it('reports a near-expiry token as INVALID rather than merely short', async () => {
    const { fetchImpl } = fakeEndpoint([granted('at-1', 60)]);
    const provider = new GoogleTokenProvider(CREDS, { tokenEndpoint: ENDPOINT, fetchImpl });

    await provider.getToken();

    expect(provider.isTokenValid()).toBe(false);
    expect(provider.getTokenStatus().isValid).toBe(false);
  });
});

describe('the default fetch', () => {
  it('posts a form-encoded body, because that is what Google accepts', async () => {
    // The default path is the one production uses and the one no other test
    // touches: every case above supplies its own `fetchImpl`. A JSON body here
    // returns `invalid_request` from Google and nothing local would catch it.
    const spy = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => granted('at-1').body,
    }));
    vi.stubGlobal('fetch', spy);
    try {
      await new GoogleTokenProvider(CREDS, { tokenEndpoint: ENDPOINT }).getToken();
    } finally {
      vi.unstubAllGlobals();
    }

    expect(spy).toHaveBeenCalledTimes(1);
    const [, init] = spy.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string; method: string }];
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(new URLSearchParams(init.body).get('grant_type')).toBe('refresh_token');
  });
});
