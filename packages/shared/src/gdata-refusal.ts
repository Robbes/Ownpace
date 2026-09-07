// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Google's DAV endpoints refuse in GData XML, and the sentence that matters is
 * inside it (2026-09-02).
 *
 * The owner's first Test of a Google account answered
 *
 *   PROPFIND failed with status 403: <?xml version="1.0" encoding="UTF-8"?>
 *   <errors xmlns="http://schemas.google.com/g/2005"><error><domain>GData
 *   </domain><code>accessNotConfigured</code><internalReason>CalDAV API has
 *   not been used in project … before or it is disabled. Enable it by
 *   visiting https://console.developers.google.com/… then retry. …
 *
 * Every word of the remedy was there — which API, which project, the exact
 * console page — wrapped in markup a phone screen turns into a wall. The
 * provider's words are rendered verbatim by rule (`probe-outcome.ts`: they
 * are the string somebody pastes into the provider's console), and this keeps
 * that rule: the code and the reason are Google's, untouched and in Google's
 * order. Only the envelope goes.
 *
 * Anything that is not a GData error document passes through unchanged. A
 * Nextcloud or a Stalwart refuses in its own shape and loses nothing here.
 *
 * ## In shared since 2026-09-07, because one site is not the family
 *
 * This shipped applied to FOUR PROPFIND refusals in `@openmig/connectors` and
 * to none of the nine others that interpolate a response body the same way.
 * The owner met one of the nine on his own card five days later — the
 * addressbook-query fallback, printing the same GData envelope this function
 * exists to remove — so the fix had been written, tested, and not reached the
 * line that needed it.
 *
 * `@openmig/engines` cannot import from `@openmig/connectors`, which is why
 * its five DAV writers could not have used it where it was. Both packages
 * depend on shared, and it is a pure string function with no dependencies of
 * its own, so shared is where it can actually be reached from.
 * `scripts/a-refusal-that-pastes-its-envelope.unit.test.ts` fails on a tenth
 * site that forgets.
 */

const GDATA_ERRORS = /<errors\b[^>]*xmlns="http:\/\/schemas\.google\.com\/g\/2005"/;

function text(body: string, tag: string): string {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(body);
  return m?.[1]?.trim() ?? '';
}

/** The refusal body as a person should read it: Google's reason without its envelope. */
export function davRefusalBody(body: string): string {
  if (!GDATA_ERRORS.test(body)) return body;
  const code = text(body, 'code');
  const reason = text(body, 'internalReason');
  if (!code && !reason) return body;
  return code && reason ? `${code} — ${reason}` : code || reason;
}
