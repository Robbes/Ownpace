// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Pure helpers for turning a stored DAV connection (config + decrypted
 * credentials) into a normalized endpoint. Kept free of DB/secret-store imports
 * so they are cheaply unit-testable (review findings #4).
 */

import type { DavEndpoint } from './dav-factories.ts';
import { publishedDavUrl } from '@openmig/shared';

/**
 * Build a DAV endpoint URL from a stored connection config (url/baseUrl/host+port).
 *
 * `kind` and `face` are how a row with NO endpoint in its config still gets
 * one (workplan 0115 T4). Apple's hosts are not a customer choice — every
 * iCloud account is at the same two roots — so its door asks for no host, and
 * this is where the published root is read instead. Every other kind carries
 * its own, and passing neither argument keeps the pre-0115 behaviour exactly:
 * a config with nothing in it refuses, by name.
 */
export function davUrl(config: Record<string, unknown>, kind?: string, face?: string): string {
  if (typeof config.url === 'string') return config.url;
  if (typeof config.baseUrl === 'string') return config.baseUrl;
  const host = config.host;
  if (typeof host !== 'string' || !host) {
    // The stored config wins over the published root wherever it says
    // anything, so a customer who somehow needs a different address keeps
    // being able to say so — this is a fallback, never an override.
    const published = kind && face ? publishedDavUrl(kind, face) : undefined;
    if (published) return published;
    throw new Error('DAV connection config is missing url/baseUrl/host');
  }
  const scheme = config.useSsl === false ? 'http' : 'https';
  const port = typeof config.port === 'number' ? `:${config.port}` : '';
  return `${scheme}://${host}${port}/`;
}

/**
 * Resolve a DAV endpoint from a stored connection's config + decrypted
 * credentials, requiring a username and password. Fails fast with a clear
 * message (naming the role + expected keys) instead of silently building a
 * connector with empty credentials that only fails later as an opaque 401.
 */
export function davEndpointFromCreds(
  role: 'source' | 'target',
  config: Record<string, unknown>,
  creds: Record<string, string>,
  kind?: string,
  face?: string,
): DavEndpoint {
  const username = creds.username;
  const password = creds.password;
  if (!username || !password) {
    throw new Error(
      `${role} DAV connection is missing credentials: expected non-empty "username" and "password" ` +
        `in the decrypted secret (got username=${username ? 'set' : 'missing'}, password=${password ? 'set' : 'missing'}).`,
    );
  }
  return { url: davUrl(config, kind, face), username, password };
}

/**
 * Resolve the endpoint the `file` domain actually needs, for a connection shared with
 * calendar/contact (a single managed `connection` row/config used by every enabled domain --
 * there is no per-domain URL in the schema). Unlike CalDAV/CardDAV, plain WebDAV has no RFC 6764
 * well-known/principal discovery for a user's file storage root, so `WebdavFileSource`/
 * `WebDAVTargetWriter` have none of their own either (confirmed: they use `config.url` directly
 * as the enumeration root, matching the self-host convention where an operator configures that
 * full path by hand per domain in their mapping file).
 *
 * Two cases:
 * - `config.fileBaseUrl` set explicitly -- always wins; the escape hatch for a non-Nextcloud
 *   WebDAV backend, or a Nextcloud install behind an atypical reverse-proxy path.
 * - `kind === 'nextcloud'` and unset -- append Nextcloud's own `files/{username}/` convention to
 *   the connection's base DAV URL (the same one calendar/contact already use via their own
 *   discovery), since that's what a combined Nextcloud connection's base URL actually needs for
 *   the file domain specifically.
 * A `kind === 'webdav'`-only connection (not shared with calendar/contact) is assumed to already
 * store the full, correct WebDAV path in its own `config.url`/`config.baseUrl` -- used as-is.
 */
export function fileEndpointFromCreds(
  role: 'source' | 'target',
  config: Record<string, unknown>,
  creds: Record<string, string>,
  kind: string,
): DavEndpoint {
  const endpoint = davEndpointFromCreds(role, config, creds);
  if (typeof config.fileBaseUrl === 'string' && config.fileBaseUrl) {
    return { ...endpoint, url: config.fileBaseUrl };
  }
  if (kind === 'nextcloud') {
    const base = endpoint.url.replace(/\/$/, '');
    return { ...endpoint, url: `${base}/files/${encodeURIComponent(endpoint.username)}/` };
  }
  return endpoint;
}
