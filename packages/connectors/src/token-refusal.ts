// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * HOW A TOKEN ENDPOINT'S REFUSAL IS SAID: OUR WORDS FIRST, THE PROVIDER'S LAST
 * (workplan 0136 T3).
 *
 * Google's, Box's and Dropbox's token providers each name the causes their
 * provider's refusal leaves out (rule 9): `invalid_grant` from Google says
 * nothing about a consent screen left in Testing, whose refresh tokens Google
 * expires after seven days. They wrote that hint AFTER the provider's body.
 *
 * The managed API repeats a server's words only when they come after the
 * status, as the last thing in the message, and only when they are an error
 * document of a kind it knows (`apps/api/src/failure-answer.ts`, reading the
 * vocabulary every refusal of ours writes: our prose, an HTTP status, then
 * `: `, then what the server sent). With our hint behind it, Google's
 * `{"error":"invalid_grant",…}` was no document at all, so a run's log on the
 * managed service said *"the server answered with something that is not a
 * DAV, JMAP or IMAP error"* where Google had said `invalid_grant`, and lost
 * the hint with it (2026-11-15). So the hint comes first, and the body last.
 *
 * The appliance's owner reads the message whole, as before: the same words,
 * in the other order.
 */
export function tokenRefusalMessage(provider: string, status: number, body: string, hint: string): string {
  return hint === ''
    ? `${provider} refused the token request (${status}): ${body}`
    : `${provider} refused the token request: ${hint} ${provider} answered (${status}): ${body}`;
}
