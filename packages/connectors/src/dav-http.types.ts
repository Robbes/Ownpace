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
