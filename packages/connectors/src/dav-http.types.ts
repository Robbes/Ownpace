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
  body: string;
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
