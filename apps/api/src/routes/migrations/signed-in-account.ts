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

import {
  NO_NAMED_ACCOUNT,
  addressKey,
  anotherAccount,
  anotherAccountAt,
  isAddress,
  noNamedAccountAt,
  reasonPair,
  unconfirmedAccount,
  unconfirmedAccountAt,
} from '@openmig/shared';
import type { GrantProviderId } from '../grant-providers.ts';

/**
 * WHO SIGNED IN, as any provider confirmed it (workplan 0171 §3.2).
 *
 * Google's ending knew one address, read from its ID token. Microsoft's knows
 * the sign-in name and the addresses that deliver to the same mailbox, and a
 * named account may be any of them, so the one shape carries both. `confirmed`
 * is the provider's word, never the person's: an address somebody typed is
 * not evidence of who controls it.
 */
export interface SignedInAccount {
  /** As the provider confirmed it: Google's verified email, Microsoft's sign-in name. */
  readonly address: string;
  /** Verified by the provider, not typed by the person. */
  readonly confirmed: boolean;
  /** Microsoft: the account's `mail` and its `smtp:` proxy addresses, beside the sign-in name. */
  readonly alsoKnownAs?: readonly string[];
}

/** Google's ending says who signed in as one address, or null; the seam's shape for it. */
export function signedInFromAddress(address: string | null): SignedInAccount | null {
  return address === null ? null : { address, confirmed: true };
}

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
 * when the value is not an address at all. The fold is `addressKey`'s
 * (`@openmig/shared`, workplan 0168 T1), where it moved so the address table
 * matches on the same key.
 */
export function googleAccountKey(address: string): string | null {
  return isAddress(address) ? addressKey(address) : null;
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
  /** The same sentence in Dutch (workplan 0145 T6), from the pairs in `@openmig/shared`. */
  readonly reasonNl: string;
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
  signedIn: SignedInAccount | string | null,
  provider: GrantProviderId = 'google',
): SignedInAccountRefusal | null {
  // A string is Google's ending as it was before the seam: an address Google
  // verified (`accountInIdToken` answers null for any other).
  const who = typeof signedIn === 'string' ? signedInFromAddress(signedIn) : signedIn;
  if (provider === 'google') {
    // Google's rule, word for word as before the seam: its own fold, its own
    // sentences. Only the address counts; Google names no aliases.
    if (!named || !namesAGoogleAccount(named)) {
      return { code: 'no_named_account', ...reasonPair(NO_NAMED_ACCOUNT) };
    }
    if (who === null || !who.confirmed) {
      return { code: 'unconfirmed', ...reasonPair(unconfirmedAccount(named)) };
    }
    if (!sameGoogleAccount(named, who.address)) {
      return { code: 'another_account', ...reasonPair(anotherAccount(who.address, named)) };
    }
    return null;
  }
  if (!named || !isAddress(named)) {
    return { code: 'no_named_account', ...reasonPair(noNamedAccountAt(provider)) };
  }
  if (who === null || !who.confirmed) {
    return { code: 'unconfirmed', ...reasonPair(unconfirmedAccountAt(provider, named)) };
  }
  if (!sameAccountAt(named, who)) {
    return { code: 'another_account', ...reasonPair(anotherAccountAt(provider, who.address, named)) };
  }
  return null;
}

/**
 * Whether the named account is the one that signed in, at a provider other
 * than Google: equal, without case, to the sign-in name or to one of the
 * addresses the provider says are the same account. Nothing is folded beyond
 * case. Dots and `+suffix` are Gmail's rule, and on any other domain two
 * addresses that differ by them can be two people.
 */
export function sameAccountAt(named: string, who: SignedInAccount): boolean {
  const key = named.trim().toLowerCase();
  if (key === '') return false;
  return [who.address, ...(who.alsoKnownAs ?? [])].some((a) => a.trim().toLowerCase() === key);
}

/**
 * Whether two named accounts are the same account at this provider: Google's
 * fold for Google, case alone for every other (`sameAccountAt`'s reason).
 */
export function sameNamedAccount(provider: GrantProviderId, a: string, b: string): boolean {
  if (provider === 'google') return sameGoogleAccount(a, b);
  return sameAccountAt(a, { address: b, confirmed: true });
}

/** The key two named accounts share at this provider, or null for something that is not an address. */
export function namedAccountKey(provider: GrantProviderId, address: string): string | null {
  if (provider === 'google') return googleAccountKey(address);
  return isAddress(address) ? address.trim().toLowerCase() : null;
}
