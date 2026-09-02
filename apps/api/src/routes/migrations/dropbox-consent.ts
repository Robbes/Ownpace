// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The Dropbox authorization-code flow (2026-09-02: Connect with Dropbox),
 * built the way `google-consent.ts` built Google's and reusing its state
 * store, its refusals and its result page. What differs is Dropbox's:
 *
 *  - **`token_access_type=offline` cannot be forgotten** — without it Dropbox
 *    answers with a short-lived access token and no refresh token; pinned on
 *    the URL by a test.
 *  - **No `scope` on the URL.** A Dropbox app is created with its permissions
 *    (the guide says: the two read scopes, nothing else), and a consent asked
 *    without a scope list is granted exactly those. Least privilege is set
 *    once, at the app, and the token answer's `scope` field says what came
 *    back — read, never assumed, and refused with the missing scope named
 *    when a migration could not run on it.
 *  - The App secret travels only in the authenticated authorize POST and the
 *    token-exchange body. Never in a URL, a redirect or a log.
 */

export const DROPBOX_AUTH_ENDPOINT = 'https://www.dropbox.com/oauth2/authorize';
export const DROPBOX_TOKEN_ENDPOINT = 'https://api.dropboxapi.com/oauth2/token';

/** What a migration reads; a token without both cannot list or fetch. */
export const DROPBOX_REQUIRED_SCOPES: ReadonlyArray<string> = [
  'files.metadata.read',
  'files.content.read',
];

export function dropboxConsentUrl(p: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(DROPBOX_AUTH_ENDPOINT);
  url.searchParams.set('client_id', p.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('token_access_type', 'offline');
  url.searchParams.set('redirect_uri', p.redirectUri);
  url.searchParams.set('state', p.state);
  return url.toString();
}

export type DropboxExchangeResult =
  | { readonly ok: true; readonly refreshToken: string; readonly grantedScopes: ReadonlyArray<string> }
  | { readonly ok: false; readonly reason: string };

/** The scopes a migration needs that the grant does not carry. */
export function missingDropboxScopes(granted: ReadonlyArray<string>): string[] {
  return DROPBOX_REQUIRED_SCOPES.filter((scope) => !granted.includes(scope));
}

export async function exchangeDropboxCode(
  p: { code: string; clientId: string; clientSecret: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): Promise<DropboxExchangeResult> {
  const body = new URLSearchParams({
    code: p.code,
    grant_type: 'authorization_code',
    client_id: p.clientId,
    client_secret: p.clientSecret,
    redirect_uri: p.redirectUri,
  });
  const response = await fetchImpl(DROPBOX_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await response.text();
  if (!response.ok) {
    // Dropbox's words, verbatim and bounded: `{"error": "...", "error_description": "..."}`
    // is what somebody pastes into a search. Never the secret: it was in the
    // request, and the answer does not echo it.
    return { ok: false, reason: `Dropbox refused the code exchange (${response.status}): ${text.slice(0, 300)}` };
  }
  let json: { refresh_token?: string; scope?: string };
  try {
    json = JSON.parse(text) as { refresh_token?: string; scope?: string };
  } catch {
    return { ok: false, reason: `Dropbox answered the code exchange with something that is not JSON: ${text.slice(0, 120)}` };
  }
  const granted = (json.scope ?? '').split(/\s+/).filter(Boolean);
  const missing = missingDropboxScopes(granted);
  if (missing.length > 0) {
    return {
      ok: false,
      reason:
        `Dropbox granted less than a migration needs: the consent is missing ${missing.join(' ')}. ` +
        `Granted: ${granted.join(' ') || '(nothing)'}. Enable the missing permission on the app ` +
        "(App Console → Permissions) and press Connect with Dropbox again — a token minted " +
        'before the permission was added does not gain it.',
    };
  }
  if (!json.refresh_token) {
    return {
      ok: false,
      reason:
        'Dropbox answered without a refresh token. The consent was asked with token_access_type=offline, ' +
        'so this usually means the code was already used or the app is not allowed offline access.',
    };
  }
  return { ok: true, refreshToken: json.refresh_token, grantedScopes: granted };
}
