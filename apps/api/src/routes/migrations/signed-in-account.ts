// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHICH GOOGLE ACCOUNT SIGNED IN, and whether it is the one the page named
 * (workplan 0108 T8 (b), the owner's decision of 2026-09-23).
 *
 * The owner: *"B: yes, bind to the account the page already named (so filled
 * in by the requester/facilitator)."* The grant page says **From:** the account
 * the migration reads. Until this, that was a label: the refresh token Google
 * hands back belongs to whichever account the person signed in with. Drive and
 * Tasks read the token's own account, so a link forwarded to somebody else, or
 * opened in a browser signed in to the wrong account, would copy THAT account's
 * files and tasks into the destination the page named. Mail, calendars and
 * contacts name the account in the request, so there the same token would fail
 * at the first pass instead, as a sign-in error nobody could explain. Now the
 * account that signs in must be the one named, or nothing is stored.
 *
 * ## How the signed-in account is known
 *
 * The link's consent also asks for `openid` and Google's basic email scope
 * (`SIGNED_IN_ACCOUNT_SCOPES`). Neither is sensitive and neither costs a
 * verification. With them, Google's token response carries an ID token whose
 * `email` is the account that signed in. It is read in the same request that
 * received it, straight from Google's token endpoint over TLS, which is OpenID
 * Connect's own allowance for not checking its signature (Core 1.0, 3.1.3.7):
 * the issuer and the audience are still checked, so a token minted for another
 * application cannot answer for this one.
 *
 * ## What counts as the same account
 *
 * The comparison ignores case, and for Gmail addresses only it also ignores
 * dots and a `+suffix` in the name and treats `googlemail.com` as `gmail.com`,
 * because Google itself does: those are one account, however the owner typed
 * it. On any other domain those characters matter (two Workspace users can be
 * `a.b@` and `ab@`), so nothing else is folded. The failure this leaves is a
 * Workspace alias: an owner who named an alias is told the account's own
 * address, and names that instead. A refusal, never a wrong match.
 */

/**
 * What the link's consent asks beside the data: who signed in. Asked in the
 * long form, which is how Google enumerates it back.
 */
export const SIGNED_IN_ACCOUNT_SCOPES: ReadonlyArray<string> = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
];

/** The two spellings of Google's issuer that its ID tokens carry. */
const GOOGLE_ISSUERS: ReadonlySet<unknown> = new Set([
  'https://accounts.google.com',
  'accounts.google.com',
]);

/**
 * The address in Google's ID token, or null when it does not vouch for one.
 *
 * Null when the token is absent or malformed, was issued by anyone but Google,
 * was issued to another application (`aud`), or carries an address Google has
 * not verified. Each of those means the same thing to the caller: there is no
 * account to compare, so nothing may be stored.
 */
export function accountInIdToken(idToken: unknown, clientId: string): string | null {
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
  if (!GOOGLE_ISSUERS.has(c.iss)) return null;
  if (c.aud !== clientId) return null;
  // Strictly `true`: an address somebody typed at sign-up and never confirmed
  // says nothing about who controls it.
  if (c.email_verified !== true) return null;
  if (typeof c.email !== 'string') return null;
  return googleAccountKey(c.email) === null ? null : c.email.trim();
}

/**
 * One account's address in the form Google treats as the same account, or null
 * when the value is not an address at all.
 */
function googleAccountKey(address: string): string | null {
  const parts = address.trim().toLowerCase().split('@');
  if (parts.length !== 2) return null;
  let [name, domain] = parts as [string, string];
  if (name === '' || domain === '' || /\s/.test(name + domain)) return null;
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') {
    name = name.split('+')[0]!.replace(/\./g, '');
    if (name === '') return null;
  }
  return `${name}@${domain}`;
}

/**
 * Whether the migration names an account a sign-in can be compared with: an
 * address. A link for one that names none, or names something else, could
 * never be granted, so it is not issued (`no_named_account`).
 */
export function namesAGoogleAccount(named: string | null | undefined): boolean {
  return typeof named === 'string' && googleAccountKey(named) !== null;
}

/** Whether two addresses are the same Google account. */
export function sameGoogleAccount(a: string, b: string): boolean {
  const x = googleAccountKey(a);
  return x !== null && x === googleAccountKey(b);
}

/** Which of the three ways a sign-in was refused: a code for the record, never an address. */
export type SignedInAccountRefusalCode = 'no_named_account' | 'unconfirmed' | 'another_account';

export interface SignedInAccountRefusal {
  readonly code: SignedInAccountRefusalCode;
  /** The sentence for the person who just signed in. */
  readonly reason: string;
}

/**
 * Why this sign-in may not grant for this migration, in the words of the person
 * who just signed in, or null when it may.
 *
 * Every refusal here leaves the link unspent, so each says what to do with the
 * SAME link: open it again. The address they signed in with is theirs, shown in
 * their own browser, and naming it is what lets them see the mistake. The code
 * is what the audit record keeps (0108 T8 (d)), and it carries no address.
 */
export function signedInAccountRefusal(
  named: string | null | undefined,
  signedInAs: string | null,
): SignedInAccountRefusal | null {
  if (!named || !namesAGoogleAccount(named)) {
    return {
      code: 'no_named_account',
      reason:
        'This migration no longer names the Google account it reads, so your permission ' +
        'could not be checked against it. Please tell the person who sent you the link.',
    };
  }
  if (signedInAs === null) {
    return {
      code: 'unconfirmed',
      reason:
        `Google did not confirm which account you signed in with, so it could not be checked ` +
        `against ${named}. Open your link again and sign in as ${named}.`,
    };
  }
  if (!sameGoogleAccount(named, signedInAs)) {
    return {
      code: 'another_account',
      reason:
        `You signed in to Google as ${signedInAs}, but this migration reads ${named}. Open ` +
        `your link again and choose ${named} at Google.`,
    };
  }
  return null;
}
