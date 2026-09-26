// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The Dropbox authorization-code flow (2026-09-02: Connect with Dropbox),
 * built the way `google-consent.ts` built Google's and reusing its state
 * store, its refusals and its result page. What differs is Dropbox's:
 *
 *  - **`token_access_type=offline` cannot be forgotten** — without it Dropbox
 *    answers with a short-lived access token and no refresh token; pinned on
 *    the URL by a test.
 *  - **The read scopes on the URL, and nothing that writes accepted back**
 *    (workplan 0140 T7 (b), 2026-09-26). This header used to say "no `scope`
 *    on the URL": a Dropbox app is created with its permissions, a consent
 *    asked without a scope list is granted exactly those, and least privilege
 *    was set once, at the app. That left the promise with a console the
 *    product cannot read, for the deployment's app and a tester's own alike,
 *    while the guides call read-only an enforced guarantee. So the URL now
 *    asks for `files.metadata.read` and `files.content.read`, which a
 *    migration reads with, and `account_info.read`, which the Test's space
 *    usage (`users/get_space_usage`) needs. As Dropbox's OAuth guide documents
 *    the parameter, that is a subset of the scopes the app carries and cannot
 *    widen them, and without `include_granted_scopes` the grant holds only
 *    what was asked for: hence the third scope, which every user-linked app
 *    carries. And the token answer's `scope` field, read and never assumed,
 *    is refused twice over: when a migration could not run on it (a read
 *    scope missing, named), and when it carries anything outside the read
 *    scopes this product uses (named, with the remedy: take it off the app).
 *    `sharing.read` is accepted back but not asked for, so a token from the
 *    button cannot run the shared-folder browse even where the app has it;
 *    whether to ask for it is 0140's open question 5.
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

/**
 * What the consent URL asks for (0140 T7 (b)): the two a migration reads with,
 * and the account read the Test's space usage needs (`users/get_space_usage`
 * is an `account_info.read` route). Dropbox grants only what the URL names, so
 * leaving the third out would cost the Measured line its figure; Dropbox keeps
 * it on every user-linked app, so asking for it is never refused.
 */
export const DROPBOX_CONSENT_SCOPES: ReadonlyArray<string> = [
  'account_info.read',
  ...DROPBOX_REQUIRED_SCOPES,
];

/**
 * Every scope a grant may carry and still be stored (0140 T7 (b)): what the
 * URL asks for, and the shared-folder browse's (`sharing.read`), which the URL
 * does not ask for (open question 5) and which reads too, so is no reason to
 * refuse. Anything else the grant carries, a write scope above all, is
 * refused by name.
 */
export const DROPBOX_ACCEPTED_SCOPES: ReadonlyArray<string> = [
  ...DROPBOX_CONSENT_SCOPES,
  'sharing.read',
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
  // Only what this product reads with (0140 T7 (b)): a subset of the app's own
  // permissions, whatever the App Console carries.
  url.searchParams.set('scope', DROPBOX_CONSENT_SCOPES.join(' '));
  return url.toString();
}

export type DropboxExchangeResult =
  | { readonly ok: true; readonly refreshToken: string; readonly grantedScopes: ReadonlyArray<string> }
  | { readonly ok: false; readonly reason: string };

/** The scopes a migration needs that the grant does not carry. */
export function missingDropboxScopes(granted: ReadonlyArray<string>): string[] {
  return DROPBOX_REQUIRED_SCOPES.filter((scope) => !granted.includes(scope));
}

/** The scopes the grant carries beyond what this product reads with. */
export function unexpectedDropboxScopes(granted: ReadonlyArray<string>): string[] {
  return granted.filter((scope) => !DROPBOX_ACCEPTED_SCOPES.includes(scope));
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
  // First, and never stored: a grant that could write. The URL asked for the
  // read scopes only, so an answer carrying more is an app, or a Dropbox,
  // that did not narrow; either way the token is refused rather than kept.
  const unexpected = unexpectedDropboxScopes(granted);
  if (unexpected.length > 0) {
    return {
      ok: false,
      reason:
        `Dropbox granted more than this product reads with: ${unexpected.join(' ')}. ` +
        `Nothing was stored. Remove it from the app (App Console → Permissions), keeping only ` +
        `${DROPBOX_ACCEPTED_SCOPES.join(', ')}, and press Connect with Dropbox again.`,
    };
  }
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
