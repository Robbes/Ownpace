// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * CardDAV Source Connector Types
 * 
 * Types for CardDAV contact source implementation following RFC 4791 (WebDAV),
 * RFC 6350 (vCard), and RFC 6578 (Collection Synchronization).
 */

/**
 * Configuration for CardDAV source connection.
 */
export interface CardDAVSourceConfig {
  /** CardDAV endpoint URL (e.g., https://carddav.example.com/) */
  url: string;
  /** Authentication username */
  username: string;
  /** Environment variable name containing the password or token */
  passwordEnv?: string;
  /** Direct password/token (managed path — credentials decrypted from the DB at runtime). */
  password?: string;
  /**
   * The mapping's shared rate/concurrency limiter (workplan 0050). Optional —
   * absent means unlimited, which is what every mapping without a
   * `throttleConfig` has always had. When set, every request first takes a
   * slot: the caps an owner wrote down are enforced here, not merely merged
   * and handed to the mail source alone (the gap `DomainConfig.throttleConfig`
   * has documented since 0026 T1).
   */
  throttleLimiter?: import('@openmig/shared').ThrottleLimiter;
  /**
   * OAuth2 token provider — when set, requests authenticate with
   * `Bearer <token>` minted per request instead of Basic (workplan 0045:
   * Google's CalDAV/CardDAV endpoints take OAuth only, and a static token
   * would die mid-pass; the provider caches until expiry and re-mints).
   */
  tokenProvider?: import('@openmig/shared').TokenProvider;
  /** Optional address book home set path (if known, otherwise discovered via PROPFIND) */
  addressBookHomeSet?: string;
}

/**
 * Sync token for incremental CardDAV synchronization (RFC 6578).
 * Can be either a sync-token (preferred) or CTag (fallback).
 */
export interface CardDAVSyncToken {
  /** The sync token value from the server */
  readonly token: string;
  /** Whether this is a sync-token (true) or CTag fallback (false) */
  readonly isSyncToken: boolean;
  /** The collection path this token applies to */
  readonly collectionPath: string;
}

/**
 * Contact data from CardDAV server.
 */
export interface CardDAVContactObject {
  /** The href/URL of the contact object */
  readonly href: string;
  /** The vCard data content */
  readonly vcard: string;
  /** The sync token for this object (if available) */
  readonly syncToken?: string;
  /**
   * This card's own DAV ETag, from its `<D:getetag>` in the REPORT response.
   *
   * Per-object, unlike the collection-level ctag the same element was
   * previously scraped for. The shadow-sync change signal — see
   * `CalDAVCalendarObject.etag`.
   */
  readonly etag?: string;
}

/**
 * Parsed PROPFIND response for address book home discovery.
 */
export interface CardDAVHomeSet {
  /** The address book home set URL */
  readonly homeSet: string;
  /** List of address book collections under the home set */
  readonly collections: CardDAVCollection[];
}

/**
 * Address book collection information.
 */
export interface CardDAVCollection {
  /** The collection path/URL */
  readonly path: string;
  /** Human-readable display name */
  readonly displayName?: string;
  /** Address book description */
  readonly description?: string;
  /** Supported vCard versions */
  readonly supportedVersions?: ReadonlyArray<'3.0' | '4.0'>;
  /** Color preference */
  readonly color?: string;
}
