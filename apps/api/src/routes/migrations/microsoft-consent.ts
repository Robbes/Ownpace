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

import type { DiscoveryDomain } from '@openmig/shared';

const AUTHORITY = 'https://login.microsoftonline.com';

/** Tenant-scoped, because Microsoft's are. */
export function microsoftAuthEndpoint(tenant: string): string {
  return `${AUTHORITY}/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`;
}
export function microsoftTokenEndpoint(tenant: string): string {
  return `${AUTHORITY}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
}

/**
 * What a refresh token is worth. Without it Microsoft answers with an access
 * token good for about an hour and nothing to renew it with — a consent that
 * works during the demo and fails during the migration.
 */
export const MICROSOFT_OFFLINE_SCOPE = 'offline_access';

/**
 * One Graph scope per face, READ-ONLY.
 *
 * `Files.Read` rather than `Files.Read.All`: the signed-in user's own
 * OneDrive, not the tenant's. The reasoning is already written in
 * `google-token-provider.ts` and holds unchanged — a migration reads, and a
 * token that cannot write is the cheapest possible guarantee of that.
 *
 * `task` is absent. Microsoft To Do lives behind `/me/todo/lists` with a model
 * of its own (`Tasks.Read`), and 0114 keeps it out of the grant deliberately:
 * a fifth face and a first consent in one change would be two unproven things
 * at once.
 */
export const MICROSOFT_DOMAIN_SCOPES: Readonly<Partial<Record<DiscoveryDomain, string>>> = {
  email: 'Mail.Read',
  calendar: 'Calendars.Read',
  contact: 'Contacts.Read',
  file: 'Files.Read',
};

/**
 * The faces this consent can ask for, in the order a person ticks them.
 *
 * DERIVED from the scope map rather than written again. `a-domain-union-typed-
 * out-by-hand` caught the second copy the moment it existed, which is exactly
 * 0113 T1's point: two lists of the same capability disagree with each other
 * precisely once. There is now one fact — a face has a Graph scope or it does
 * not — and both the URL builder and this order read it.
 */
export const MICROSOFT_CONSENT_DOMAINS: ReadonlyArray<DiscoveryDomain> = Object.keys(
  MICROSOFT_DOMAIN_SCOPES,
) as ReadonlyArray<DiscoveryDomain>;

/**
 * The scope string for the faces asked for — always with `offline_access`, and
 * never with a scope for a face nobody ticked.
 *
 * An empty or unrecognised request asks for every face rather than none:
 * a consent that grants nothing is not a safer failure, it is a button that
 * silently does not work.
 */
export function microsoftScopesFor(domains: ReadonlyArray<string>): string[] {
  const asked = domains.filter((d): d is DiscoveryDomain => d in MICROSOFT_DOMAIN_SCOPES);
  const chosen = asked.length > 0 ? asked : MICROSOFT_CONSENT_DOMAINS;
  const scopes = chosen
    .map((d) => MICROSOFT_DOMAIN_SCOPES[d])
    .filter((s): s is string => typeof s === 'string');
  return [MICROSOFT_OFFLINE_SCOPE, ...scopes];
}

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
