// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * CalDAV Source Connector Types
 * 
 * Types for CalDAV calendar source implementation following RFC 4791 and RFC 6578.
 */

/**
 * Configuration for CalDAV source connection.
 */
export interface CalDAVSourceConfig {
  /** CalDAV endpoint URL (e.g., https://caldav.example.com/) */
  url: string;
  /** Authentication username */
  username: string;
  /** Environment variable name containing the password or token (self-host/CLI path) */
  passwordEnv?: string;
  /** Direct password/token (managed path — credentials decrypted from the DB at runtime). */
  password?: string;
  /**
   * OAuth2 token provider — when set, requests authenticate with
   * `Bearer <token>` minted per request instead of Basic (workplan 0045:
   * Google's CalDAV/CardDAV endpoints take OAuth only, and a static token
   * would die mid-pass; the provider caches until expiry and re-mints).
   */
  tokenProvider?: import('@openmig/shared').TokenProvider;
  /**
   * The mapping's shared rate/concurrency limiter (workplan 0050). Optional —
   * absent means unlimited, which is what every mapping without a
   * `throttleConfig` has always had. When set, every request first takes a
   * slot: the caps an owner wrote down are enforced here, not merely merged
   * and handed to the mail source alone (the gap `DomainConfig.throttleConfig`
   * has documented since 0026 T1).
   */
  throttleLimiter?: import('@openmig/shared').ThrottleLimiter;
  /** Optional calendar home set path (if known, otherwise discovered via PROPFIND) */
  calendarHomeSet?: string;
}

/**
 * Sync token for incremental CalDAV synchronization (RFC 6578).
 * Can be either a sync-token (preferred) or CTag (fallback).
 */
export interface CalDAVSyncToken {
  /** The sync token value from the server */
  readonly token: string;
  /** Whether this is a sync-token (true) or CTag fallback (false) */
  readonly isSyncToken: boolean;
  /** The collection path this token applies to */
  readonly collectionPath: string;
}

/**
 * Calendar event data from CalDAV server.
 */
export interface CalDAVCalendarObject {
  /** The href/URL of the calendar object */
  readonly href: string;
  /** The iCalendar data content */
  readonly icalendar: string;
  /** The sync token for this object (if available) */
  readonly syncToken?: string;
  /**
   * This object's own DAV ETag, from its `<D:getetag>` in the REPORT response.
   *
   * Per-object, unlike the collection-level ctag the same element was
   * previously scraped for. It is the shadow-sync change signal: stored in the
   * ledger and compared on a later pass so an event edited on the source is
   * re-copied rather than skipped forever.
   */
  readonly etag?: string;
}

/**
 * Parsed PROPFIND response for calendar home discovery.
 */
export interface CalDAVHomeSet {
  /** The calendar home set URL */
  readonly homeSet: string;
  /** List of calendar collections under the home set */
  readonly collections: CalDAVCollection[];
}

/**
 * Calendar collection information.
 */
export interface CalDAVCollection {
  /** The collection path/URL */
  readonly path: string;
  /** Human-readable display name */
  readonly displayName?: string;
  /** Calendar description */
  readonly description?: string;
  /** Timezone identifier */
  readonly timezone?: string;
  /** Color preference */
  readonly color?: string;
  /** Maximum date-time for calendar data */
  readonly maxDate?: string;
  /** Minimum date-time for calendar data */
  readonly minDate?: string;
}
