// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Files the owner has thrown away, read from Nextcloud's trashbin.
 *
 * The file domain's deletion evidence has been absence-counting alone: a file
 * stops appearing in a complete listing twice in a row, so it has probably been
 * deleted. That is the weakest of the three signals, and for files it is also the
 * slowest to trust, while the answer was sitting one endpoint away — the owner's
 * bin, with the ORIGINAL PATH of everything in it.
 *
 * Reading it gives files the same `trashed` evidence mail now has: a positive
 * observation of the item in a place that means "the person deleted this", rather
 * than an inference from not seeing it.
 *
 * NOT PART OF WebDAV. RFC 4918 has no concept of a bin. This is Nextcloud's own
 * extension — a separate `/remote.php/dav/trashbin/<user>/trash/` collection whose
 * entries carry `{http://nextcloud.org/ns}trashbin-original-location`. So it is
 * derived and probed rather than assumed: a plain WebDAV server, or any endpoint
 * that does not match Nextcloud's files convention, reports nothing and stays on
 * absence-counting, which is the honest answer rather than a guess.
 *
 * THE ONE THING THAT MAKES OR BREAKS IT is that the paths agree, exactly, with
 * `FileItem.path`. The sync loop matches by natural key, and the file natural key
 * is `file:<path>` — so a trashed path that differs by a leading slash, a
 * percent-escape or a `rootPath` prefix produces a hash that matches nothing at
 * all. Not an error: SILENCE, which is the failure mode nobody notices. Hence
 * `trashbinPathToKeyPath`, and hence the deliberate choice to normalise there
 * rather than trusting two code paths to agree by coincidence.
 */

/** The properties the trashbin PROPFIND asks for. */
export const TRASHBIN_PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:nc="http://nextcloud.org/ns">
  <d:prop>
    <nc:trashbin-original-location/>
    <nc:trashbin-deletion-time/>
  </d:prop>
</d:propfind>`;

/** Decode the five XML entities plus numeric references. Property text, not a URI. */
function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    // Ampersand LAST, so `&amp;lt;` decodes to the literal `&lt;` and not to `<`.
    .replace(/&amp;/g, '&');
}

/**
 * The original locations of everything in a trashbin multistatus body.
 *
 * Namespace-prefix tolerant, like `parseRemovedHrefs`: a server is never obliged
 * to echo back the prefixes we sent, and Nextcloud/sabre-dav demonstrably does
 * not — a lesson this project has already paid for twice.
 *
 * The trash root's own self-entry has no such property and so drops out by itself.
 * A deleted FOLDER does have one, and yields the folder's path; that matches no
 * file's natural key, so it reports nothing and the files that were inside it fall
 * back to absence-counting. That is the correct outcome rather than a gap worth
 * papering over: Nextcloud trashes a folder as ONE entry, so there is no per-file
 * information here to report even in principle.
 */
export function parseTrashbinOriginalLocations(body: string): string[] {
  const out: string[] = [];
  const responseRegex = /<[A-Za-z][\w-]*:response[^>]*>([\s\S]*?)<\/[A-Za-z][\w-]*:response>/gi;

  let match: RegExpExecArray | null;
  while ((match = responseRegex.exec(body)) !== null) {
    const responseXml = match[1];
    if (!responseXml) continue;
    const locationMatch = responseXml.match(
      /<[A-Za-z][\w-]*:trashbin-original-location[^>]*>([\s\S]*?)<\/[A-Za-z][\w-]*:trashbin-original-location>/i,
    );
    const raw = locationMatch?.[1]?.trim();
    // Empty covers both "the server has no value" (it answers with a self-closing
    // element inside a 404 propstat) and a property that is genuinely blank. An
    // entry with no original location cannot be matched to anything we copied.
    if (!raw) continue;
    out.push(decodeXml(raw));
  }

  return out;
}

/**
 * Nextcloud's trashbin URL for the account a files URL belongs to, if there is one.
 *
 * Derived from the files endpoint rather than configured, because the two are the
 * same account by construction and asking an operator to write the second URL by
 * hand is asking them to get it subtly wrong. `undefined` means this endpoint does
 * not look like Nextcloud's files convention — a plain WebDAV server, a different
 * product, a custom mount — and there is nothing to probe.
 *
 * The USER COMES FROM THE URL, not from the configured username. Those can differ
 * (an admin reading another account's files), and the bin we want is the one
 * belonging to the files we are actually reading.
 */
export function nextcloudTrashbinUrl(filesUrl: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(filesUrl);
  } catch {
    return undefined;
  }
  // `/remote.php/dav/files/<user>/...` and `/remote.php/webdav` are the two shapes
  // Nextcloud serves; only the first names an account, and only an account has a
  // bin. Deliberately anchored on `/dav/files/` rather than the whole prefix, so a
  // reverse-proxied install under a subdirectory still matches.
  const match = /^(.*)\/dav\/files\/([^/]+)(?:\/|$)/.exec(parsed.pathname);
  const prefix = match?.[1];
  const user = match?.[2];
  if (prefix === undefined || !user) return undefined;
  return `${parsed.origin}${prefix}/dav/trashbin/${user}/trash/`;
}

/**
 * Turn a trashbin original location into a path in `FileItem.path`'s exact form,
 * or `undefined` when it is outside this connection's root.
 *
 * Three normalisations, each of which has to happen or the natural keys do not
 * match and nothing is ever reported:
 *
 * 1. **No leading or trailing slash.** `FileItem.path` comes from
 *    `toRelativePath`, which strips both. Nextcloud's property is usually
 *    slash-free already, but not on every version, and a single leading `/` is
 *    enough to make every hash miss.
 * 2. **Not percent-decoded.** The property is XML element TEXT, so it arrives as
 *    real characters — unlike an href, which is percent-encoded and which
 *    `toRelativePath` decodes. Both sides therefore end up decoded; running
 *    `decodeURIComponent` here as well would corrupt any name containing a
 *    literal `%`.
 * 3. **`rootPath` stripped.** `FileItem.path` is relative to this connection's
 *    configured root (`config.url` + `rootPath`), while the trashbin property is
 *    relative to the account's files root. When a mapping syncs a subtree, the two
 *    differ by exactly that prefix — and a file deleted OUTSIDE the subtree is not
 *    in scope, so it is dropped rather than reported against a key we never wrote.
 */
export function trashbinPathToKeyPath(
  originalLocation: string,
  rootPath?: string,
): string | undefined {
  const location = originalLocation.replace(/^\/+/, '').replace(/\/+$/, '');
  if (location === '') return undefined;

  const root = (rootPath ?? '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (root === '') return location;
  if (location === root) return undefined; // the root itself, not an item in it
  if (!location.startsWith(`${root}/`)) return undefined; // outside the sync scope
  return location.slice(root.length + 1);
}
