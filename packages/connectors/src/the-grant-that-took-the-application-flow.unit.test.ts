// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REFRESH TOKEN AND A CLIENT SECRET TOGETHER ARE THE DELEGATED FLOW.
 *
 * `MsalTokenProvider` chose its flow by asking "is there a client secret?"
 * first. That was right for the two shapes it was written for — an app
 * registration with a secret (application permissions, `.default`) or a
 * refresh token from a public client (delegated, no secret) — and wrong for
 * the shape Connect with Microsoft produces (workplan 0114): a CONFIDENTIAL
 * client's secret AND the refresh token its consent minted. That shape took
 * the client-credentials branch, asked for delegated scopes under `/common`,
 * and MSAL refused it before a request left the process:
 * `missing_tenant_id_error`, which the owner read on 2026-09-06 as the first
 * live answer of the account kind's Test.
 *
 * Two facts, pinned here with MSAL replaced by a recorder:
 *
 *   - a refresh token selects the delegated flow, whatever else is set, which
 *     is what `graph-domain-source-factory` has promised since 0114 T4;
 *   - a confidential client redeems that token through
 *     `ConfidentialClientApplication`, because MSAL's public application never
 *     sends the secret and Entra refuses a Web-platform registration's token
 *     request without it (AADSTS7000218).
 *
 * The two older shapes keep their branches, and are pinned beside the new
 * one so a fix for the third cannot quietly re-aim the first two.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

type Call = { app: 'confidential' | 'public'; method: string; auth: Record<string, unknown> };
const calls: Call[] = [];

const answer = {
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
      return answer;
    }
    async acquireTokenByRefreshToken() {
      calls.push({ app: this.kind, method: 'acquireTokenByRefreshToken', auth: this.config.auth });
      return answer;
    }
    async acquireTokenByUsernamePassword() {
      calls.push({ app: this.kind, method: 'acquireTokenByUsernamePassword', auth: this.config.auth });
      return answer;
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
  scope: 'Mail.Read offline_access',
};

beforeEach(() => {
  calls.length = 0;
});

describe('which flow a stored credential shape selects', () => {
  it('a secret AND a refresh token: the delegated flow, through a confidential client', async () => {
    // The Connect with Microsoft shape after the deployment's fill.
    await createTokenProvider({ ...BASE, clientSecret: 'entra-secret', refreshToken: 'the-token' }).getToken();
    expect(calls).toEqual([
      {
        app: 'confidential',
        method: 'acquireTokenByRefreshToken',
        auth: expect.objectContaining({ clientSecret: 'entra-secret' }),
      },
    ]);
  });

  it('a refresh token alone: the delegated flow, through a public client', async () => {
    await createTokenProvider({ ...BASE, refreshToken: 'the-token' }).getToken();
    expect(calls.map((c) => [c.app, c.method])).toEqual([['public', 'acquireTokenByRefreshToken']]);
    expect(calls[0]!.auth).not.toHaveProperty('clientSecret');
  });

  it('a secret alone: the application flow, as before', async () => {
    await createTokenProvider({
      ...BASE,
      tenantId: 'contoso.onmicrosoft.com',
      scope: 'https://graph.microsoft.com/.default',
      clientSecret: 'entra-secret',
    }).getToken();
    expect(calls.map((c) => [c.app, c.method])).toEqual([['confidential', 'acquireTokenByClientCredential']]);
  });

  it('nothing to sign in with is refused in one sentence, before any application is built', async () => {
    await expect(createTokenProvider({ ...BASE }).getToken()).rejects.toThrow(/client credentials|user credentials/);
    expect(calls).toEqual([]);
  });
});
