// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Minimal WebDAV 207 Multi-Status reader, shared by the DAV target reindexers.
 *
 * Deliberately namespace-prefix agnostic. DAV: is bound to whatever prefix the
 * server likes — SabreDAV/Nextcloud emit `<d:response>`/`<d:href>`, others emit
 * `<D:href>`, some emit no prefix at all. The existing per-writer regexes only
 * matched the literal `D:href`, which silently returns "not found" against a
 * lowercase-prefix server rather than failing. For reindexing, "silently found
 * nothing" is the dangerous answer: it reads as an empty target.
 *
 * This is not a general XML parser and does not try to be. It splits a 207 body
 * into <response> blocks and pulls out the href, the status, and a named child
 * element's text. That is the whole shape these reindexers need, and keeping it
 * small keeps it testable without pulling an XML dependency into the engines
 * package.
 */

/** One <response> element of a 207 Multi-Status body. */
export interface MultiStatusResponse {
  /** The (still percent-encoded) href, exactly as the server wrote it. */
  readonly href: string;
  /** The whole <response> block, for pulling further properties out of. */
  readonly xml: string;
}

/** Match an element by local name, ignoring any namespace prefix. */
function elementPattern(localName: string, flags: string): RegExp {
  return new RegExp(`<(?:[A-Za-z0-9._-]+:)?${localName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z0-9._-]+:)?${localName}>`, flags);
}

/** Split a 207 body into its <response> blocks. */
export function parseMultiStatus(xml: string): MultiStatusResponse[] {
  const out: MultiStatusResponse[] = [];
  for (const match of xml.matchAll(elementPattern('response', 'g'))) {
    const block = match[1] ?? '';
    const href = firstElementText(block, 'href');
    if (href === undefined) continue; // a <response> without an href is not addressable
    out.push({ href: href.trim(), xml: block });
  }
  return out;
}

/** Text of the first element with this local name, or undefined. */
export function firstElementText(xml: string, localName: string): string | undefined {
  const match = elementPattern(localName, '').exec(xml);
  return match ? match[1] : undefined;
}

/** Does this response describe a collection (a directory / calendar / address book)? */
export function isCollection(responseXml: string): boolean {
  const resourceType = firstElementText(responseXml, 'resourcetype');
  if (resourceType === undefined) return false;
  return /<(?:[A-Za-z0-9._-]+:)?collection(?:\s[^>]*)?\/?>/.test(resourceType);
}

/** Does this response's resourcetype include the given DAV collection kind? */
export function hasResourceType(responseXml: string, localName: string): boolean {
  const resourceType = firstElementText(responseXml, 'resourcetype');
  if (resourceType === undefined) return false;
  return new RegExp(`<(?:[A-Za-z0-9._-]+:)?${localName}(?:\\s[^>]*)?/?>`).test(resourceType);
}

/**
 * Decode an href into a path, undoing percent-encoding.
 *
 * Servers percent-encode hrefs (`Meeting%20notes.txt`), while the natural keys
 * the ledger stores come from the source connector's decoded paths. Comparing
 * the two without decoding would make every file with a space or non-ASCII
 * character look missing on the target.
 */
export function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    // A malformed escape sequence. Returning the raw href would mis-key the
    // entry; the caller must not treat this as "no such item".
    throw new Error(`Cannot decode DAV href: ${href}`);
  }
}

/**
 * Make an href relative to a base URL's path.
 *
 * Hrefs may be absolute URLs or absolute paths; the writers address everything
 * relative to their own configured endpoint. Returns undefined when the href
 * does not live under the base at all (a server pointing elsewhere).
 */
export function hrefRelativeTo(href: string, baseUrl: string): string | undefined {
  const decoded = decodeHref(href);
  const hrefPath = decoded.startsWith('http://') || decoded.startsWith('https://')
    ? new URL(decoded).pathname
    : decoded;

  const basePath = new URL(baseUrl).pathname.replace(/\/+$/, '');
  const normalizedHref = hrefPath.replace(/\/+$/, '');

  if (basePath === '' || basePath === '/') {
    return normalizedHref.replace(/^\/+/, '');
  }
  if (normalizedHref === basePath) return '';
  if (!normalizedHref.startsWith(`${basePath}/`)) return undefined;
  return normalizedHref.slice(basePath.length + 1);
}

/**
 * The `getcontentlength` a response reports, as a spreadable `{ sizeBytes }`.
 *
 * Returns `{}` — not `{ sizeBytes: 0 }` — when the server omits the property or
 * sends something unparseable. Zero is a real size, and a fabricated zero would
 * quietly drag `totalBytesTarget` below the source total, which reads as data
 * loss rather than as a gap in measurement.
 */
export function sizeOf(responseXml: string): { sizeBytes?: number } {
  const raw = firstElementText(responseXml, 'getcontentlength');
  if (raw === undefined) return {};
  const parsed = Number(raw.trim());
  return Number.isInteger(parsed) && parsed >= 0 ? { sizeBytes: parsed } : {};
}

/**
 * Undo XML escaping (and unwrap CDATA) for a text node.
 *
 * `calendar-data` / `address-data` carry an iCalendar or vCard body inside XML,
 * so `&` in a UID arrives as `&amp;` — and some servers wrap the whole body in
 * CDATA instead. Reading the UID without undoing that would key the entry by a
 * string the ledger never stored.
 */
export function unescapeXml(text: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(text);
  const raw = cdata ? cdata[1]! : text;
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    // Ampersand last, so "&amp;lt;" survives as the literal "&lt;".
    .replace(/&amp;/g, '&');
}

/**
 * Pull the UID out of an iCalendar or vCard body.
 *
 * Both formats fold long lines by starting the continuation with a space or tab
 * (RFC 5545 §3.1 / RFC 6350 §3.2), and a UID is easily long enough to be folded
 * by a server that re-serializes what it stored. Unfolding first is what makes
 * this correct rather than usually-correct.
 */
export function extractUid(body: string): string | undefined {
  const unfolded = body.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const match = /^UID(?:;[^:\r\n]*)?:(.*)$/im.exec(unfolded);
  const uid = match?.[1]?.trim();
  return uid && uid.length > 0 ? uid : undefined;
}
