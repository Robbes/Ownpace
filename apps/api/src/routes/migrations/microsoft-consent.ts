// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The Microsoft authorization-code flow (workplan 0114 T2), built the way
 * `google-consent.ts` built Google's and `dropbox-consent.ts` built Dropbox's,
 * reusing their state store, refusals and result page. Four things differ, and
 * each of them is a way this could be silently wrong:
 *
 *  - **The endpoints are TENANT-SCOPED.** Every other provider here has one
 *    authorization URL; Microsoft's carries the directory in its path. An
 *    empty segment builds a different URL rather than an error, which is why
 *    `microsoftTenant()` can never return empty and why these functions take
 *    the tenant rather than reading it.
 *
 *  - **`offline_access` is a SCOPE, not a parameter.** Dropbox has
 *    `token_access_type=offline` and Google has `access_type=offline`;
 *    Microsoft returns a refresh token when `offline_access` is among the
 *    granted scopes and not otherwise. Forgetting it yields a working consent,
 *    an access token good for an hour, and a migration that dies overnight.
 *
 *  - **`prompt=select_account`, deliberately.** Microsoft users very commonly
 *    hold a personal and a work account in one browser session, and without
 *    this the consent is granted silently by whichever is signed in. The
 *    failure is not an error: it is a successful migration OF THE WRONG
 *    MAILBOX, discovered later by someone who cannot tell why their mail is
 *    not there. `prompt=consent` is NOT used — unlike Google, Microsoft
 *    re-issues a refresh token on every authorization carrying
 *    `offline_access`, so forcing the consent screen again would buy nothing
 *    and cost a click.
 *
 *  - **Scopes are asked PER DOMAIN.** A consent for someone who only wants
 *    their calendar should not ask for their mail. The map below is the whole
 *    of that policy; `microsoftScopesFor` is the only thing that reads it.
 *
 * The client secret travels only in the authenticated authorize POST and the
 * token-exchange body. Never in a URL, a redirect or a log.
 */


// THE FACTS THIS MODULE USED TO OWN — the authority's two endpoints, the
// offline scope, the face-to-scope map and the scope string builder — live in
// `@openmig/shared` since 2026-09-06 (0114 T10): the connection Test reads a
// stored grant against the same map this consent asked with, from a package
// the orchestration can import. Re-exported here so every caller of this
// module keeps its import, and so the guard that pins the map keeps its door.
export {
  MICROSOFT_CONSENT_DOMAINS,
  MICROSOFT_DOMAIN_SCOPES,
  MICROSOFT_OFFLINE_SCOPE,
  microsoftAuthEndpoint,
  microsoftScopesFor,
  microsoftTokenEndpoint,
} from '@openmig/shared';
import { microsoftAuthEndpoint, microsoftScopesFor, microsoftTokenEndpoint } from '@openmig/shared';

export function microsoftConsentUrl(p: {
  clientId: string;
  tenant: string;
  redirectUri: string;
  state: string;
  domains: ReadonlyArray<string>;
}): string {
  const url = new URL(microsoftAuthEndpoint(p.tenant));
  url.searchParams.set('client_id', p.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', p.redirectUri);
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', microsoftScopesFor(p.domains).join(' '));
  url.searchParams.set('state', p.state);
  // See the header: the wrong-mailbox failure is a successful migration.
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

export type MicrosoftExchangeResult =
  | {
      readonly ok: true;
      readonly refreshToken: string;
      readonly grantedScopes: ReadonlyArray<string>;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Entra's own consent refusals, turned into sentences with a way forward.
 *
 * These are the failures a tenant POLICY produces rather than a mistake in the
 * request, and they are the most likely thing a first customer meets: an
 * organisation that set *Users can consent to apps* to No. A raw
 * `AADSTS65001` in a browser window tells them nothing they can act on.
 */
export function microsoftConsentRefusal(errorDescription: string): string | null {
  if (errorDescription.includes('AADSTS65001')) {
    return (
      'Microsoft says this account has not consented to the application. When an organisation ' +
      'has turned off "Users can consent to applications", an administrator has to grant it ' +
      'once for the tenant — after that this button works for everybody in it. The Entra error ' +
      'is AADSTS65001.'
    );
  }
  if (errorDescription.includes('AADSTS90094')) {
    return (
      'Microsoft requires an administrator to approve this application for the organisation ' +
      'before anyone in it can connect. Ask an administrator to grant consent once in Entra ID ' +
      '(Enterprise applications → Permissions); it does not have to be repeated per person. ' +
      'The Entra error is AADSTS90094.'
    );
  }
  if (errorDescription.includes('AADSTS700016') || errorDescription.includes('AADSTS900023')) {
    return (
      'Microsoft could not find this application in the directory it was asked about. That is ' +
      'usually a single-tenant registration being authenticated against "common": either ' +
      'register the application as multi-tenant, or set MICROSOFT_OAUTH_TENANT to the ' +
      'directory it belongs to (docs/microsoft-setup.md).'
    );
  }
  return null;
}

export async function exchangeMicrosoftCode(
  p: {
    code: string;
    clientId: string;
    clientSecret: string;
    tenant: string;
    redirectUri: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<MicrosoftExchangeResult> {
  const body = new URLSearchParams({
    code: p.code,
    grant_type: 'authorization_code',
    client_id: p.clientId,
    client_secret: p.clientSecret,
    redirect_uri: p.redirectUri,
  });
  const response = await fetchImpl(microsoftTokenEndpoint(p.tenant), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await response.text();
  if (!response.ok) {
    const sentence = microsoftConsentRefusal(text);
    if (sentence) return { ok: false, reason: sentence };
    // Microsoft's words, verbatim and bounded — what somebody pastes into a
    // search. Never the secret: it was in the request, not the answer.
    return {
      ok: false,
      reason: `Microsoft refused the code exchange (${response.status}): ${text.slice(0, 300)}`,
    };
  }
  let json: { refresh_token?: string; scope?: string };
  try {
    json = JSON.parse(text) as { refresh_token?: string; scope?: string };
  } catch {
    return {
      ok: false,
      reason: `Microsoft answered the code exchange with something that is not JSON: ${text.slice(0, 120)}`,
    };
  }
  if (!json.refresh_token) {
    return {
      ok: false,
      reason:
        'Microsoft answered without a refresh token. The consent is asked with offline_access, ' +
        'so this usually means the code was already used, or the application is configured in a ' +
        'way that withholds offline access.',
    };
  }
  return {
    ok: true,
    refreshToken: json.refresh_token,
    grantedScopes: (json.scope ?? '').split(/\s+/).filter(Boolean),
  };
}
