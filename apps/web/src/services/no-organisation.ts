// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Where somebody with a good token and no organisation goes next.
 *
 * ## The dead end this exists to end
 *
 * A sign-in can succeed completely and leave a person nowhere: the issuer
 * asserts who they are, `tenant_member` says nothing about them, and after
 * ADR-0042 those are two different facts held on two different sides of the
 * boundary. Being in the identity provider is IDENTITY. Belonging to an
 * organisation is TENANCY. No amount of the first produces the second.
 *
 * On 2026-09-01 that boundary was met head-on: the owner signed in through the
 * new Google button, the round trip worked perfectly, and the app answered
 * "Your account is not part of an organisation yet. If you asked for access, we
 * will email you when it is ready." — under the heading *That sign-in did not
 * complete*. Three things were wrong with the screen and only one of them was
 * the words: the sign-in HAD completed; nothing had been asked, so nothing was
 * coming by email; and there was no way out of the page except the back button.
 *
 * ## Why the app cannot simply check whether a request exists
 *
 * The obvious fix — look up the address and say which of the two states this
 * is — is one the design forbids on purpose, in two places:
 *
 *  - `access_request` has no SELECT policy for the person who made the request
 *    (managed 0002 grants `anyone_may_ask` for INSERT; 0005 grants reading to
 *    an operator and to nobody else). Knocking is allowed; reading the queue
 *    is not.
 *  - `POST /api/access-requests` answers a duplicate with the SAME 201, byte
 *    for byte, as a first knock — because a different answer for an address
 *    that has already asked is how somebody enumerates which addresses have.
 *
 * So the honest screen states what it knows, offers the action, and phrases
 * the rest as a condition the reader resolves rather than a fact the app
 * asserts. That is the whole shape of it.
 *
 * ## Carrying the address
 *
 * The address comes from the verified `email` claim `GET /api/me` echoes back
 * — the one the issuer just asserted about the person standing there. Handing
 * it to the form saves a retype, and, more usefully, SHOWS them which identity
 * arrived: a social button can sign somebody in as an account they did not
 * mean to use, which is invisible on a screen that names no address.
 */

/** The path to the public ask-for-access form, carrying `email` when known. */
export function requestAccessHref(email: string | null | undefined): string {
  const address = email?.trim();
  // `encodeURIComponent` and not a template alone: an address may contain `+`
  // (the tag convention Gmail and others support), which a query string reads
  // as a space — so `a+b@x.test` would arrive in the form as `a b@x.test` and
  // be refused for a reason nobody could see.
  return address === undefined || address === ''
    ? '/request-access'
    : `/request-access?email=${encodeURIComponent(address)}`;
}
