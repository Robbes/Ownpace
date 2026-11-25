// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHICH MICROSOFT ACCOUNT SIGNED IN (workplan 0171 §3.3, T3).
 *
 * A grant link is bound to the account the migration names, as Google's has
 * been since 0108 T8 (b). Microsoft's sign-in says more than Google's and is
 * trusted for less, so it is read in two steps:
 *
 * 1. **The ID token says who issued it, and for whom.** Its `iss` must be
 *    `https://login.microsoftonline.com/{tid}/v2.0` for the `tid` the same
 *    token carries, and its `aud` must be this deployment's (or the
 *    connection's) client id. It is read in the request that received it,
 *    straight from Microsoft's token endpoint over TLS, which is OpenID
 *    Connect's own allowance for not checking its signature (Core 1.0,
 *    3.1.3.7), as `accountInIdToken` does for Google.
 * 2. **The directory says which addresses are the account's.** With the new
 *    access token, `GET /me?$select=mail,userPrincipalName,proxyAddresses`.
 *    The named account must be the sign-in name (UPN), the primary `mail`, or
 *    an `smtp:` proxy address. The token's `email` claim is NOT read: in a
 *    work tenant an administrator can set it to anything, so it proves
 *    nothing about who controls a mailbox.
 *
 * A **personal** account (the consumer tenant, `MICROSOFT_PERSONAL_TENANT`)
 * has no directory entry to read in that way; its sign-in name is the
 * `preferred_username` of the ID token, which Microsoft sets to the account's
 * own address, compared the same way.
 *
 * Null means *not confirmed*: the caller refuses and stores nothing. A
 * failure to reach Microsoft at all is thrown, never turned into null (hard
 * rule 9): the person is then told nothing was kept, and the link is unused.
 */

/**
 * The tenant id Microsoft gives every personal (consumer) account. Microsoft's
 * own documented constant, the same for everybody, and not any customer's.
 */
export const MICROSOFT_PERSONAL_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

/** Microsoft Graph's own profile of the signed-in user. */
export const MICROSOFT_ME_URL =
  'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,proxyAddresses';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a valid Microsoft ID token says about the sign-in, or null. */
export interface MicrosoftIdClaims {
  readonly tid: string;
  readonly preferredUsername: string | null;
}

/**
 * The ID token's claims this file reads, or null when Microsoft did not issue
 * it for this application: absent, malformed, an issuer that is not the
 * token's own tenant at `login.microsoftonline.com`, or another audience.
 */
export function microsoftIdClaims(idToken: unknown, clientId: string): MicrosoftIdClaims | null {
  if (typeof idToken !== 'string') return null;
  const parts = idToken.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (claims === null || typeof claims !== 'object') return null;
  const c = claims as Record<string, unknown>;
  if (typeof c.tid !== 'string' || !GUID.test(c.tid)) return null;
  // The issuer must be the token's OWN tenant: a token issued by another
  // directory, or by anything that is not Microsoft's v2.0 endpoint, says
  // nothing about this sign-in.
  if (c.iss !== `https://login.microsoftonline.com/${c.tid}/v2.0`) return null;
  if (c.aud !== clientId) return null;
  const preferred = typeof c.preferred_username === 'string' ? c.preferred_username.trim() : '';
  return { tid: c.tid, preferredUsername: preferred === '' ? null : preferred };
}

/** The `smtp:` addresses of `proxyAddresses`, either case of the prefix, without it. */
export function smtpProxyAddresses(proxyAddresses: unknown): string[] {
  if (!Array.isArray(proxyAddresses)) return [];
  const out: string[] = [];
  for (const p of proxyAddresses) {
    if (typeof p !== 'string') continue;
    // `SMTP:` is the primary, `smtp:` the others; `X500:`, `SIP:` and the
    // like are not addresses mail is delivered to.
    if (p.slice(0, 5).toLowerCase() !== 'smtp:') continue;
    const address = p.slice(5).trim();
    if (address !== '') out.push(address);
  }
  return out;
}

/** The account that signed in, as Microsoft confirmed it (see `SignedInAccount`). */
export interface MicrosoftSignedIn {
  readonly address: string;
  readonly confirmed: boolean;
  readonly alsoKnownAs: readonly string[];
}

/**
 * Who signed in, or null when Microsoft does not vouch for an account. Throws
 * when Microsoft could not be reached or answered with a fault of its own.
 */
export async function microsoftSignedInAccount(
  p: { readonly idToken: unknown; readonly accessToken: string | undefined; readonly clientId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<MicrosoftSignedIn | null> {
  const claims = microsoftIdClaims(p.idToken, p.clientId);
  if (claims === null) return null;
  if (claims.tid === MICROSOFT_PERSONAL_TENANT) {
    return claims.preferredUsername === null
      ? null
      : { address: claims.preferredUsername, confirmed: true, alsoKnownAs: [] };
  }
  if (!p.accessToken) return null;
  const response = await fetchImpl(MICROSOFT_ME_URL, {
    headers: { Authorization: `Bearer ${p.accessToken}`, Accept: 'application/json' },
  });
  // Refused: the grant does not carry `User.Read` (a consent that left it
  // out), or the token is not good for Graph. Nobody vouched, so nothing is
  // stored; the person is told to sign in again.
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Microsoft Graph answered /me with ${response.status}: ${text.slice(0, 200)}`);
  }
  const me = (await response.json()) as Record<string, unknown>;
  const upn = typeof me.userPrincipalName === 'string' ? me.userPrincipalName.trim() : '';
  if (upn === '') return null;
  const mail = typeof me.mail === 'string' && me.mail.trim() !== '' ? [me.mail.trim()] : [];
  const also = [...mail, ...smtpProxyAddresses(me.proxyAddresses)].filter(
    (a, i, all) => all.findIndex((b) => b.toLowerCase() === a.toLowerCase()) === i,
  );
  return { address: upn, confirmed: true, alsoKnownAs: also };
}
