// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REFRESH TOKEN SELECTS THE DELEGATED FLOW, AND THE FLOW IS ONE POST THAT
 * REPORTS IN ENTRA'S WORDS.
 *
 * `MsalTokenProvider` chose its flow by asking "is there a client secret?"
 * first. That was right for the two shapes it was written for — an app
 * registration with a secret (application permissions, `.default`) or a
 * refresh token from a public client (delegated, no secret) — and wrong for
 * the shape Connect with Microsoft produces (workplan 0114): a CONFIDENTIAL
 * client's secret AND the refresh token its consent minted. That shape took
 * the client-credentials branch, asked for delegated scopes under `/common`,
 * and MSAL refused it before a request left the process
 * (`missing_tenant_id_error`, the owner's first live Test, 2026-09-06).
 *
 * The second live Test, the same evening, met the next layer: MSAL's refresh
 * path failed and the provider swallowed WHY — a catch that fell through to a
 * username/password branch with no username, and a generic sentence on every
 * face. Minutes earlier the grant read had exchanged the same refresh token
 * with a plain POST to the same endpoint and succeeded. So the delegated flow
 * is that POST now, and a refusal carries Entra's `error` and
 * `error_description` verbatim.
 *
 * Pinned here, with MSAL replaced by a recorder and the token endpoint by a
 * stub:
 *
 *   - a refresh token selects the delegated flow whatever else is set, and
 *     that flow is a POST to the configured endpoint with exactly the scopes
 *     the source asked for — nothing MSAL would add;
 *   - a confidential client sends its secret with the refresh token; a public
 *     one sends none;
 *   - a refused exchange reaches the caller in Entra's words, never as the
 *     generic sentence;
 *   - the two older shapes keep their branches: a secret alone is still the
 *     application flow through MSAL, a username and password still ROPC
 *     through MSAL's public client.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Call = { app: 'confidential' | 'public'; method: string; auth: Record<string, unknown> };
const calls: Call[] = [];

const msalAnswer = {
  accessToken: 'at',
  expiresOn: new Date(Date.now() + 3_600_000),
  tokenType: 'Bearer',
  scope: 'Mail.Read',
};

vi.mock('@azure/msal-node', () => {
  class Recorder {
    readonly kind: 'confidential' | 'public';
    readonly config: { auth: Record<string, unknown> };
    constructor(kind: 'confidential' | 'public', config: { auth: Record<string, unknown> }) {
      this.kind = kind;
      this.config = config;
    }
    async acquireTokenByClientCredential() {
      calls.push({ app: this.kind, method: 'acquireTokenByClientCredential', auth: this.config.auth });
      return msalAnswer;
    }
    async acquireTokenByRefreshToken() {
      calls.push({ app: this.kind, method: 'acquireTokenByRefreshToken', auth: this.config.auth });
      return msalAnswer;
    }
    async acquireTokenByUsernamePassword() {
      calls.push({ app: this.kind, method: 'acquireTokenByUsernamePassword', auth: this.config.auth });
      return msalAnswer;
    }
  }
  return {
    ConfidentialClientApplication: class extends Recorder {
      constructor(config: { auth: Record<string, unknown> }) {
        super('confidential', config);
      }
    },
    PublicClientApplication: class extends Recorder {
      constructor(config: { auth: Record<string, unknown> }) {
        super('public', config);
      }
    },
  };
});

import { createTokenProvider } from './token-provider.ts';

const BASE = {
  tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  clientId: 'entra-app-id',
  tenantId: 'common',
  scope: 'https://graph.microsoft.com/Mail.Read offline_access',
};

/** A token endpoint that records every POST and answers as told. */
function tokenEndpoint(status = 200, body?: string) {
  const posts: Array<{ url: string; body: URLSearchParams }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { body?: string }) => {
      posts.push({ url: String(url), body: new URLSearchParams(init?.body ?? '') });
      return {
        ok: status === 200,
        status,
        text: async () =>
          body ??
          (status === 200
            ? JSON.stringify({ token_type: 'Bearer', access_token: 'at-from-post', expires_in: 3599, scope: 'Mail.Read' })
            : ''),
      };
    }),
  );
  return posts;
}

beforeEach(() => {
  calls.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('which flow a stored credential shape selects', () => {
  it('a secret AND a refresh token: one POST to the endpoint, with the secret, with exactly the scopes asked', async () => {
    // The Connect with Microsoft shape after the deployment's fill.
    const posts = tokenEndpoint();
    const token = await createTokenProvider({ ...BASE, clientSecret: 'entra-secret', refreshToken: 'the-token' }).getToken();
    expect(calls, 'MSAL was asked for a delegated token').toEqual([]);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe(BASE.tokenEndpoint);
    const sent = posts[0]!.body;
    expect(sent.get('grant_type')).toBe('refresh_token');
    expect(sent.get('client_id')).toBe('entra-app-id');
    expect(sent.get('client_secret')).toBe('entra-secret');
    expect(sent.get('refresh_token')).toBe('the-token');
    // Not `openid profile`, which MSAL appends and the consent never asked for.
    expect(sent.get('scope')).toBe(BASE.scope);
    expect(token.accessToken).toBe('at-from-post');
    expect(token.expiresAt).toBeGreaterThan(Date.now() + 3_000_000);
  });

  it('a refresh token alone: the same POST, without a secret', async () => {
    const posts = tokenEndpoint();
    await createTokenProvider({ ...BASE, refreshToken: 'the-token' }).getToken();
    expect(calls).toEqual([]);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body.has('client_secret')).toBe(false);
  });

  it("a refused exchange reaches the caller in Entra's words — never the generic sentence", async () => {
    tokenEndpoint(
      400,
      JSON.stringify({
        error: 'invalid_grant',
        error_description:
          'AADSTS65001: The user or administrator has not consented to use the application with ID ' +
          "'entra-app-id'. Trace ID: … Correlation ID: … Timestamp: 2026-09-06 17:40:00Z",
      }),
    );
    const provider = createTokenProvider({ ...BASE, clientSecret: 'entra-secret', refreshToken: 'the-token' });
    await expect(provider.getToken()).rejects.toThrow(/Microsoft refused the refresh-token exchange \(400\): invalid_grant: AADSTS65001/);
    await expect(provider.getToken()).rejects.not.toThrow(/Failed to acquire token with refresh token/);
  });

  it('a refusal that is not JSON is quoted as it came, and the request is never echoed', async () => {
    tokenEndpoint(502, '<html>Bad Gateway</html>');
    const provider = createTokenProvider({ ...BASE, clientSecret: 'entra-secret', refreshToken: 'the-token' });
    const failure = await provider.getToken().catch((err: unknown) => (err instanceof Error ? err.message : String(err)));
    expect(failure).toContain('(502): <html>Bad Gateway</html>');
    expect(failure).not.toContain('the-token');
    expect(failure).not.toContain('entra-secret');
  });

  it('a secret alone: the application flow through MSAL, as before', async () => {
    const posts = tokenEndpoint();
    await createTokenProvider({
      ...BASE,
      tenantId: 'contoso.onmicrosoft.com',
      scope: 'https://graph.microsoft.com/.default',
      clientSecret: 'entra-secret',
    }).getToken();
    expect(calls.map((c) => [c.app, c.method])).toEqual([['confidential', 'acquireTokenByClientCredential']]);
    expect(posts).toEqual([]);
  });

  it("a username and password: ROPC through MSAL's public client, as before", async () => {
    const posts = tokenEndpoint();
    await createTokenProvider({ ...BASE, username: 'someone@contoso.example', password: 'pw' }).getToken();
    expect(calls.map((c) => [c.app, c.method])).toEqual([['public', 'acquireTokenByUsernamePassword']]);
    expect(posts).toEqual([]);
  });

  it('nothing to sign in with is refused in one sentence, before any request is made', async () => {
    const posts = tokenEndpoint();
    await expect(createTokenProvider({ ...BASE }).getToken()).rejects.toThrow(/client credentials|user credentials/);
    expect(calls).toEqual([]);
    expect(posts).toEqual([]);
  });
});
