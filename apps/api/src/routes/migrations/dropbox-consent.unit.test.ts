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
  it('carries the App key, offline access, the redirect and the state — and no secret, no scope', () => {
    const url = new URL(dropboxConsentUrl({ clientId: 'app-key', redirectUri: REDIRECT, state: 'id.sig' }));
    expect(url.origin + url.pathname).toBe(DROPBOX_AUTH_ENDPOINT);
    expect(url.searchParams.get('client_id')).toBe('app-key');
    expect(url.searchParams.get('response_type')).toBe('code');
    // Without it Dropbox mints no refresh token — the whole point of the consent.
    expect(url.searchParams.get('token_access_type')).toBe('offline');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('state')).toBe('id.sig');
    expect(url.searchParams.has('client_secret')).toBe(false);
    // The app's own permissions decide; a scope list here could only widen or narrow them.
    expect(url.searchParams.has('scope')).toBe(false);
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
