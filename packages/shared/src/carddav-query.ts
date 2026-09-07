// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE FILTER RFC 6352 REQUIRES, AND THE ONE THAT ASKS FOR ONE CARD.
 *
 * On 2026-09-07 the owner's Google connection card read:
 *
 *     Contacts — not measured: addressbook-query REPORT failed with status
 *     400: Request contains an invalid argument.
 *
 * Three `addressbook-query` REPORT bodies existed in this repo. Two had no
 * `<filter>` element at all and the third had a CalDAV one. RFC 6352 §10.3 is
 * not ambiguous about the first:
 *
 *     <!ELEMENT addressbook-query ((DAV:allprop | DAV:propname | DAV:prop)?,
 *                                  filter, limit?)>
 *
 * `filter` carries no `?`. A body without one is not a valid request, and
 * Google refuses it — with a sentence that names no element, which is why it
 * took a printed card to find. Servers that accepted it were being generous.
 *
 * ## Why not an empty `<filter/>`
 *
 * It is grammatically legal — §10.5 is `<!ELEMENT filter (prop-filter*)>` —
 * and it is the obvious "match everything". It is also the most dangerous
 * thing to send, because §10.5's `test` attribute DEFAULTS TO `anyof`, and
 * `anyof` over zero tests is an OR over nothing. A server reading that
 * literally answers with an empty multistatus, and an empty multistatus from
 * a listing is not an error anywhere in this codebase: it is *"the address
 * book is empty"*. The 400 we are fixing is loud. Trading it for a silent
 * zero on a migration source would be a worse bug than the one that started
 * this.
 *
 * So the match-all filter NAMES properties instead, and rests on §10.5.1:
 *
 *     An address object is said to match a CARDDAV:prop-filter if:
 *     *  A vCard property of the type specified by the "name" attribute
 *        exists, and the CARDDAV:prop-filter is empty [...]
 *
 * An empty prop-filter is an existence test. Three of them under `anyof` —
 * UID, VERSION, FN — is "has any one of these", and each is independently
 * mandatory: UID by RFC 6352 §5.1 (*"vCard components in an address book
 * collection MUST have a UID property value"*), VERSION and FN by vCard
 * itself (RFC 6350 §6.7.9 and §6.2.1; RFC 2426 §3.6.9 and §3.1.1). A card
 * that fails one still comes back on the other two.
 *
 * ## Why the prefix is an argument
 *
 * The three call sites bind the CardDAV namespace to different prefixes —
 * `A:` in the source, `C:` in the writer. A fragment that declared its own
 * would be legal XML and resolve correctly in any namespace-aware parser, but
 * DAV server-side is full of prefix-matching by string, and this file exists
 * because a query silently matching nothing is the failure we are paying for.
 * The caller passes the prefix its document declared; the guard in
 * `scripts/an-addressbook-query-without-a-filter.unit.test.ts` checks that
 * every body declares the prefix it filters with.
 */

/** Escape a string for use as XML text or an attribute value. */
export function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * A CARDDAV:filter that every conforming address object matches.
 *
 * For the listings — "give me this whole address book" — where the filter is
 * a grammatical obligation rather than a question. See the note above on why
 * this is not `<filter/>`.
 *
 * @param prefix the prefix the caller's document binds
 *   `urn:ietf:params:xml:ns:carddav` to, without the colon.
 */
export function carddavMatchAllFilter(prefix: string): string {
  const p = `${prefix}:`;
  // `test="anyof"` is the §10.5 default; stated anyway, because the whole
  // correctness of this element is that a reader can see it is an OR.
  return `<${p}filter test="anyof">
          <${p}prop-filter name="UID"/>
          <${p}prop-filter name="VERSION"/>
          <${p}prop-filter name="FN"/>
        </${p}filter>`;
}

/**
 * A CARDDAV:filter matching the one card with this UID.
 *
 * `match-type="equals"` is the load-bearing attribute: §10.5.4 defaults
 * text-match to `contains`, so without it this is a SUBSTRING search deciding
 * whether a contact already exists on the target. A UID that is a prefix of
 * another card's UID would adopt the wrong resource and the write would
 * overwrite a different person's card.
 *
 * The collation is left at the §10.5.4 default (`i;unicode-casemap`, which
 * every server MUST support per §8.3.1) rather than asking for `i;octet`,
 * which servers only MAY support and which earns a `supported-collation`
 * precondition failure where they do not. That leaves the match
 * case-insensitive, so the caller compares the returned UID exactly —
 * `findHrefByUid` in `dav-multistatus.ts` does.
 */
export function carddavUidFilter(uid: string, prefix: string): string {
  const p = `${prefix}:`;
  return `<${p}filter>
          <${p}prop-filter name="UID">
            <${p}text-match match-type="equals">${escapeXmlText(uid)}</${p}text-match>
          </${p}prop-filter>
        </${p}filter>`;
}
