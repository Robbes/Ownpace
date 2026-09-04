// Copyright 2026 OpenHands Agent (Apache-2.0)
// Shared HTTP client types for DAV connectors (CalDAV, CardDAV, WebDAV)

/** HTTP client interface for DAV requests. */
export interface HttpClient {
  request(options: HttpRequestOptions): Promise<HttpResponse>;
}

/** HTTP request options for DAV requests. */
export interface HttpRequestOptions {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string | Buffer | Uint8Array;
}

/** HTTP response from DAV requests. */
export interface HttpResponse {
  status: number;
  /**
   * The response decoded as UTF-8 text. Correct for the XML every DAV method
   * returns; NOT correct for file content. See `bodyBytes`.
   */
  body: string;
  /**
   * The response's actual bytes, when the client can provide them.
   *
   * File content must be read from here and never from `body`. A UTF-8 decode
   * replaces every byte sequence that is not valid UTF-8 with U+FFFD, and the
   * replacement is irreversible — re-encoding does not recover the original.
   * Measured on a 476 KB JPEG: 476,387 bytes in, 863,389 bytes out, and not one
   * of them the original. Every JPEG, PDF, MP4 and Office document in a file
   * migration went through exactly that (see WebdavFileSource.fetchFileContent).
   */
  bodyBytes?: Uint8Array;
  headers: Record<string, string>;
}

/**
 * The RFC 6764 well-known URI for a service, at the ORIGIN root.
 *
 * §4 places `/.well-known/caldav` and `/.well-known/carddav` at the root of the
 * origin — they are properties of the host, not of whatever DAV path happens to
 * be configured. Appending them to the configured base produced
 * `https://host/remote.php/dav/.well-known/caldav`, which cannot exist: every
 * request 404s, and every calendar and contact pass paid that round trip plus
 * the fallback PROPFIND before doing any work (confirmed live against Nextcloud
 * — `"GET /remote.php/dav/.well-known/caldav" 404` on every run).
 *
 * Built from the origin, Nextcloud actually answers it: `/.well-known/caldav`
 * redirects to the DAV root, which is what the discovery code wants.
 */
export function wellKnownUrl(baseUrl: string, service: 'caldav' | 'carddav'): string {
  return new URL(`/.well-known/${service}`, baseUrl).toString();
}

/**
 * A DAV href, normalised for USE AS A REQUEST TARGET — **host preserved**.
 *
 * Workplan 0115 T1. Both DAV sources carried a private `normalizePath` whose
 * whole job was to guarantee a leading and a trailing slash, and whose
 * unwritten assumption was that its argument is a PATH. It was handed three
 * things that can be absolute URLs instead: a redirect's `Location`, a
 * `calendar-home-set`/`addressbook-home-set` href, and a collection href in a
 * multistatus. For every provider this product had, all three arrive as paths
 * on the host already configured, so the assumption held and nothing failed.
 *
 * **iCloud is the provider it does not hold for.** Apple partitions accounts
 * across hundreds of hosts and answers the home set with an absolute URL on the
 * one that holds yours (`https://p34-caldav.icloud.com/1234567890/calendars/`).
 * Prefixing that with `/` produced
 * `/https://p34-caldav.icloud.com/1234567890/calendars/` — a path, on
 * `caldav.icloud.com`, that does not exist — so every request after discovery
 * went somewhere with no calendars in it. No test caught it and none could:
 * Soverin and Nextcloud return same-host, path-only hrefs, so the whole DAV
 * suite passes either way. That is #597's family, and this time the assumption
 * that met a third provider was the TYPE OF AN ARGUMENT.
 *
 * An absolute `http(s)` URL keeps its origin and has only its path normalised;
 * anything else is treated as a path, exactly as before. Query and fragment are
 * dropped: a DAV collection is a path, and an href carrying either is not one
 * this code can address.
 */
export function normalizeDavHref(hrefOrUrl: string): string {
  const trimmed = hrefOrUrl.trim();
  const absolute = asAbsoluteDavUrl(trimmed);
  if (absolute) return `${absolute.origin}${normalizeDavPath(absolute.pathname)}`;
  return normalizeDavPath(trimmed);
}

/**
 * The PATH of a DAV href, whoever it names — for COMPARING two of them.
 *
 * A multistatus lists the collection it was asked about beside the collections
 * under it, and both sources drop that first entry by comparing its href with
 * the home set. Once the home set may carry a host and the hrefs beside it may
 * not (iCloud answers exactly that way), comparing the two as strings says
 * "different" about the same collection, and the home set itself is offered as
 * a calendar or an address book to migrate. Compare paths, and it is one
 * question about one thing.
 */
export function davPathOf(hrefOrUrl: string): string {
  const trimmed = hrefOrUrl.trim();
  const absolute = asAbsoluteDavUrl(trimmed);
  return normalizeDavPath(absolute ? absolute.pathname : trimmed);
}

/** `new URL` when the string really is an absolute http(s) URL, else undefined. */
function asAbsoluteDavUrl(value: string): URL | undefined {
  if (!/^https?:\/\//i.test(value)) return undefined;
  try {
    return new URL(value);
  } catch {
    // A malformed absolute-looking href is not one this code can address, and
    // treating it as a path is what every version before 0115 did.
    return undefined;
  }
}

/** Leading and trailing slash, backslashes folded — the old `normalizePath`. */
function normalizeDavPath(path: string): string {
  let normalized = path.replace(/\\/g, '/');
  if (!normalized.startsWith('/')) normalized = '/' + normalized;
  if (!normalized.endsWith('/')) normalized += '/';
  return normalized;
}
