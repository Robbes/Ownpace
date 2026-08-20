// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHOSE mailbox a Graph connector is reading (workplan 0027 T0).
 *
 * Every Graph connector built so far reads `/me/...` — the signed-in user's
 * own mailbox, under DELEGATED permissions. That is the right default and
 * stays the default. It is also the reason a shared mailbox has been
 * unreachable: a shared store has no interactive user to sign in as, and is
 * addressed as `/users/{address}/...` under APPLICATION permissions with
 * admin consent (SAD §14.3).
 *
 * This module is the whole difference, kept in one place rather than spread
 * across four connectors as a second URL convention. A connector asks for its
 * scope once and builds every URL from it.
 *
 * SAFETY, and why this file validates rather than concatenates. Under
 * application permissions the app can address ANY mailbox in the tenant that
 * its Application Access Policy allows. A malformed or empty address silently
 * producing `/users/` would aim a request at the tenant's user COLLECTION
 * instead of one mailbox — a listing of everybody, from code that meant to
 * read one person's mail. So an address that does not look like an address is
 * refused loudly here, before any request is built.
 *
 * The Application Access Policy is what actually bounds this (see
 * `docs/o365-application-access.md`); the validation below is the second lock,
 * not the first. Neither is a substitute for the other.
 */

/** How a Graph connector addresses the mailbox it reads. */
export type GraphMailboxScope =
  /** The signed-in user, under delegated permissions. The default. */
  | { readonly kind: 'me' }
  /** A named mailbox, under application permissions + admin consent. */
  | { readonly kind: 'user'; readonly address: string };

/**
 * An address Graph will accept as a user principal name.
 *
 * Deliberately strict and deliberately NOT a full RFC 5322 parser: what is
 * being guarded is a URL path segment, and the interesting failures are empty
 * strings, whitespace, and anything carrying `/` or `?` that would change
 * which endpoint is called. A legitimate UPN that this rejects is a loud,
 * fixable error; a malformed one that it accepts is a request aimed somewhere
 * nobody chose.
 *
 * `#` IS allowed in the local part, and that asymmetry is not an oversight.
 * An Azure AD guest account's UPN is literally
 * `person_theirdomain.com#EXT#@yourtenant.onmicrosoft.com` — refusing `#`
 * outright rejected every guest mailbox in the tenant, which a first version
 * of this pattern did until the test for it was written. After the `@` it
 * stays forbidden: `a@b.nl#frag` is a fragment stuck onto a domain, not an
 * address anybody has.
 */
const LOOKS_LIKE_UPN = /^[^\s/?@]+@[^\s/?#@]+\.[^\s/?#@]+$/;

/**
 * Resolve the scope from an optional configured mailbox address.
 *
 * `undefined` means "the signed-in user" — the delegated default every
 * existing mapping relies on. Passing an address is the explicit opt-in to
 * application-permission reads.
 */
export function resolveMailboxScope(mailbox?: string): GraphMailboxScope {
  if (mailbox === undefined) return { kind: 'me' };
  const address = mailbox.trim();
  if (address === '') {
    throw new Error(
      'Graph mailbox address is empty. Leave it unset to read the signed-in ' +
        "user's own mailbox (/me); an empty string is not the same thing and " +
        'would address the tenant user collection instead of a mailbox.',
    );
  }
  if (!LOOKS_LIKE_UPN.test(address)) {
    throw new Error(
      `Graph mailbox address ${JSON.stringify(address)} is not a usable user ` +
        'principal name. It must look like name@domain.tld and carry no spaces, ' +
        'slashes or query characters — a value that does would change which ' +
        'Graph endpoint is called.',
    );
  }
  return { kind: 'user', address };
}

/**
 * The URL prefix for this scope: `{baseUrl}/me` or `{baseUrl}/users/{address}`.
 *
 * Percent-encoded, because a UPN may legitimately contain characters (`#` in
 * guest accounts, `'` in some surnames) that would otherwise terminate or
 * corrupt the path.
 */
export function scopePrefix(baseUrl: string, scope: GraphMailboxScope): string {
  const base = baseUrl.replace(/\/$/, '');
  return scope.kind === 'me' ? `${base}/me` : `${base}/users/${encodeURIComponent(scope.address)}`;
}

/** Convenience: resolve and render in one step. */
export function graphScopePrefix(baseUrl: string, mailbox?: string): string {
  return scopePrefix(baseUrl, resolveMailboxScope(mailbox));
}

/**
 * What a connector should SAY when it cannot enumerate a directory.
 *
 * 0028's `new_mailbox` detector needs to list a tenant's mailboxes; an
 * IMAP-only source cannot, and a delegated Graph connector cannot either —
 * `/users` is an application-permission endpoint. Both must report that they
 * could not look, rather than an empty list that reads as "no new mailboxes"
 * (hard rule 9). The sentence lives here so both report it identically.
 */
export function directoryNotEnumerable(reason: string): string {
  return (
    `This source cannot enumerate the directory, so new mailboxes cannot be ` +
    `noticed: ${reason}. This is not "no new mailboxes found" — nothing was looked at.`
  );
}
