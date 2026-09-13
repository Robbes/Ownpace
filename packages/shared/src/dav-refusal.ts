// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A DAV server refuses in XML, and the sentence that matters is inside it.
 *
 * ## Google, first (2026-09-02)
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
 * that rule: the code and the reason are the provider's, untouched and in the
 * provider's order. Only the envelope goes.
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
 *
 * ## Sabre too, since 2026-09-13, because the target refuses more often than
 * the source does
 *
 * Until this date the rule above stopped at Google, and this file said so:
 * "A Nextcloud or a Stalwart refuses in its own shape and loses nothing
 * here." The owner's live Google → Nextcloud migration disproved that
 * sentence. Two contacts out of 1,229 failed, and the whole of what the
 * ledger could tell him was
 *
 *   PUT failed for /addressbooks/users/admin/address-book/926caf98adce563.vcf
 *   with status 500: <?xml version="1.0"
 *
 * — not because anything truncated the record, but because Sabre's error
 * document opens with an XML declaration and a `d:error` element carrying two
 * namespace declarations, and that is over a hundred characters of
 * boilerplate before the first word of the reason. Any view with a width —
 * a phone notification, a grouped report, a table cell — spends its budget on
 * the prolog and shows the reader nothing at all.
 *
 * It matters more here than it did for Google. Google is a SOURCE: it refuses
 * at connection time, when somebody is sitting in front of the screen. Sabre
 * is the TARGET of every managed migration, and it refuses mid-pass, into a
 * ledger row read hours later by somebody reconstructing what happened. That
 * row is the only account of the failure that exists.
 *
 * So the same treatment, by the same rule: `s:exception` and `s:message` are
 * Sabre's own words, kept in Sabre's order, and the envelope goes. A debug
 * Nextcloud adds `s:file`, `s:line` and a full `s:trace`; those are dropped,
 * being the wall rather than the sentence.
 *
 * ## Entities are transport, not words
 *
 * Both documents escape their text — `&quot;`, `&amp;`, `&lt;`. An entity is
 * how XML carries a character, not a character the provider chose, so the
 * five predefined ones are decoded on the way out. Rendering verbatim means
 * rendering what the provider wrote, and the provider wrote the quote.
 */

const GDATA_ERRORS =
  /<errors\b[^>]*xmlns="http:\/\/schemas\.google\.com\/g\/2005"/;

/**
 * Sabre's namespace, and the prefix this document happens to bind it to.
 *
 * The prefix is `s` in every Sabre release and in Nextcloud, but it is a
 * document's choice rather than a protocol constant, so it is read from the
 * declaration rather than assumed. The character class deliberately excludes
 * `.` — legal in an XML name, a metacharacter in the pattern built from it —
 * so an exotic prefix falls through to the untouched body instead of matching
 * something it should not.
 */
const SABRE_NS = /xmlns:([A-Za-z_][A-Za-z0-9_-]*)="http:\/\/sabredav\.org\/ns"/;

/** The five entities XML predefines. Numeric references are left alone. */
function decodeEntities(s: string): string {
  return (
    s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      // Ampersand last, so a `&amp;lt;` in the provider's text stays `&lt;`.
      .replace(/&amp;/g, "&")
  );
}

function text(body: string, tag: string): string {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(body);
  return decodeEntities(m?.[1] ?? "").trim();
}

/** `a — b`, or whichever of the two the document actually carried. */
function joined(first: string, second: string): string {
  return first && second ? `${first} — ${second}` : first || second;
}

/** The refusal body as a person should read it: the server's reason without its envelope. */
export function davRefusalBody(body: string): string {
  if (GDATA_ERRORS.test(body)) {
    // Better a wall than nothing: a document with neither field readable is
    // returned as it came, rather than reduced to an empty string.
    return joined(text(body, "code"), text(body, "internalReason")) || body;
  }
  const prefix = SABRE_NS.exec(body)?.[1];
  if (prefix !== undefined) {
    return (
      joined(
        text(body, `${prefix}:exception`),
        text(body, `${prefix}:message`),
      ) || body
    );
  }
  return body;
}
