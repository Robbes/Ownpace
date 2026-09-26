// Copyright 2026 The Ownpace authors (Apache-2.0)

import { describe, it, expect, vi } from 'vitest';
import {
  DROPBOX_AUTH_ENDPOINT,
  DROPBOX_TOKEN_ENDPOINT,
  dropboxConsentUrl,
  exchangeDropboxCode,
  missingDropboxScopes,
} from './dropbox-consent.ts';

const REDIRECT = 'https://app.example.nl/api/migrations/dropbox/callback';

describe('the Dropbox consent URL: what must never be forgotten', () => {
  /**
   * REVERSED ON PURPOSE (workplan 0140 T7 (b)). This case pinned "no scope":
   * the app's own permissions decided, and a list here "could only widen or
   * narrow them". But those permissions live in a console the product cannot
   * read, the deployment's app and a tester's own alike, while the guides call
   * read-only an enforced guarantee. So the URL now asks for the read scopes
   * the product calls with and nothing else. As Dropbox documents the
   * parameter, it asks for a subset of what the app carries and cannot widen
   * it; if it ever could, the refusal at the exchange (below) still holds the
   * line.
   *
   * THREE, NOT TWO. §3 of the plan named the two file reads, and the first
   * build asked for exactly those, reading `account_info.read` as something
   * Dropbox answers beside them. Dropbox documents the opposite: without
   * `include_granted_scopes` it returns only the scopes the URL asked for. The
   * Test's Measured line calls `users/get_space_usage`, whose scope is
   * `account_info.read` (dropbox-api-spec, `users.stone`), so every token the
   * button minted would have lost the figure it has today. Dropbox keeps that
   * scope on every user-linked app, so asking for it can never be refused.
   */
  it('carries the App key, offline access, the redirect, the state and exactly the read scopes it calls with — and no secret', () => {
    const url = new URL(dropboxConsentUrl({ clientId: 'app-key', redirectUri: REDIRECT, state: 'id.sig' }));
    expect(url.origin + url.pathname).toBe(DROPBOX_AUTH_ENDPOINT);
    expect(url.searchParams.get('client_id')).toBe('app-key');
    expect(url.searchParams.get('response_type')).toBe('code');
    // Without it Dropbox mints no refresh token — the whole point of the consent.
    expect(url.searchParams.get('token_access_type')).toBe('offline');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('state')).toBe('id.sig');
    expect(url.searchParams.has('client_secret')).toBe(false);
    // Space-separated, as Dropbox reads it: the two a migration needs, the one
    // the Measured line's space usage needs, and not `sharing.read` (0140 T7
    // (b); whether to ask for it is open question 5).
    expect(url.searchParams.getAll('scope')).toHaveLength(1);
    const asked = (url.searchParams.get('scope') ?? '').split(' ');
    expect(
      asked,
      'users/get_space_usage needs account_info.read, and Dropbox grants only what the URL asks for',
    ).toContain('account_info.read');
    expect(asked.sort()).toEqual(['account_info.read', 'files.content.read', 'files.metadata.read']);
  });
});

describe('the exchange: granted is read, never assumed', () => {
  const exchange = (json: unknown, status = 200) => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: { body?: string }) => new Response(JSON.stringify(json), { status }),
    );
    return {
      result: exchangeDropboxCode(
        { code: 'the-code', clientId: 'app-key', clientSecret: 'app-secret', redirectUri: REDIRECT },
        fetchMock as unknown as typeof fetch,
      ),
      fetchMock,
    };
  };

  it('hands back the refresh token when both read scopes came back, posting the pair to the token endpoint', async () => {
    const { result, fetchMock } = exchange({
      refresh_token: 'rt-dbx',
      scope: 'account_info.read files.content.read files.metadata.read',
    });
    expect(await result).toEqual({
      ok: true,
      refreshToken: 'rt-dbx',
      grantedScopes: ['account_info.read', 'files.content.read', 'files.metadata.read'],
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(DROPBOX_TOKEN_ENDPOINT);
    const sent = String(fetchMock.mock.calls[0]?.[1]?.body ?? '');
    expect(sent).toContain('grant_type=authorization_code');
    expect(sent).toContain('client_id=app-key');
    expect(sent).toContain('client_secret=app-secret');
    expect(sent).toContain(`redirect_uri=${encodeURIComponent(REDIRECT)}`);
  });

  it('a grant missing a read scope is refused with the missing one named and the remedy at the app', async () => {
    const { result } = exchange({ refresh_token: 'rt', scope: 'files.metadata.read' });
    const r = await result;
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toContain('missing files.content.read');
    expect((r as { reason: string }).reason).toContain('Permissions');
    expect(missingDropboxScopes(['files.metadata.read'])).toEqual(['files.content.read']);
    expect(missingDropboxScopes(['files.metadata.read', 'files.content.read'])).toEqual([]);
  });

  it('a grant carrying a scope that writes is refused, naming it, with the remedy at the app (0140 T7 (b))', async () => {
    // The URL asks for the read scopes only, and Dropbox's documentation says
    // that narrows. What came back is still read, never assumed: a token that
    // could write is never stored, whatever the app or the URL did.
    const { result } = exchange({
      refresh_token: 'rt-writes',
      scope: 'account_info.read files.content.read files.content.write files.metadata.read',
    });
    const r = await result;
    expect(r.ok).toBe(false);
    const reason = (r as { reason: string }).reason;
    expect(reason).toContain('files.content.write');
    expect(reason, 'the refusal says to take it off the app').toMatch(/remove it from the app/i);
    expect(reason).toContain('Permissions');
    expect(reason, 'the token is never echoed').not.toContain('rt-writes');
    // What a migration or the shared-folder browse reads is still accepted.
    const readOnly = exchange({
      refresh_token: 'rt-reads',
      scope: 'account_info.read files.content.read files.metadata.read sharing.read',
    });
    expect((await readOnly.result).ok).toBe(true);
  });

  it('an answer without a refresh token is a refusal naming offline access', async () => {
    const { result } = exchange({ scope: 'files.metadata.read files.content.read' });
    const r = await result;
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toContain('token_access_type=offline');
  });

  it("a refused exchange carries Dropbox's status and words, and never the secret", async () => {
    const { result } = exchange({ error: 'invalid_grant', error_description: 'code has expired' }, 400);
    const r = await result;
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toContain('400');
    expect((r as { reason: string }).reason).toContain('code has expired');
    expect((r as { reason: string }).reason).not.toContain('app-secret');
  });
});
