// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Google Calendar and Google Contacts as sources (workplan 0045) — the third
 * and fourth Google providers, and the cheapest of the four, because Google
 * still speaks the protocols this product already implements.
 *
 * WHAT IS REUSED, deliberately: the ENTIRE CalDAV/CardDAV read path —
 * discovery, sync-collection, the removal reports that feed deletion evidence.
 * Google's CalDAV v2 and CardDAV v1 endpoints are RFC-shaped; what they will
 * not take is a password. So the one capability this workplan added to the
 * connectors is `tokenProvider` — requests authenticate `Bearer <token>`,
 * minted per request by the SAME `GoogleTokenProvider` Drive and Gmail use,
 * cached until expiry, which is what keeps a pass alive past Google's one-hour
 * token lifetime.
 *
 * WHAT ONLY REALITY CAN PROVE, stated rather than assumed (the same posture
 * as Gmail's view-filter and Drive's export stability): that Google's
 * principal URLs answer this connector's discovery walk, and that its
 * sync-token behaviour matches the RFC 6578 path. The owner runbook's Stage 6
 * is that proof.
 */

import { CREDENTIAL_STORE_NL, CredentialRefusalError, missingAccountAddress } from '@openmig/shared';
import type { CalendarSource, ContactSource, TokenProvider } from '@openmig/shared';
import { CalDAVSource, CarddavSource, GoogleTokenProvider } from '@openmig/connectors';
import type { GoogleCredentialNaming, GoogleCredentialsAsFound } from './drive-source-factory';
import {
  ENV_GOOGLE_DWD_KEY_NAME,
  STORED_GOOGLE_DWD_KEY_NAME,
  dwdTokenProviderIfConfigured,
} from './google-dwd';

/** The scope Google's CalDAV v2 endpoint requires. */
export const GOOGLE_CALDAV_SCOPE = 'https://www.googleapis.com/auth/calendar';
/** The scope Google's CardDAV v1 endpoint requires. */
export const GOOGLE_CARDDAV_SCOPE = 'https://www.googleapis.com/auth/carddav';

/**
 * Google's CalDAV v2 principal for an account. The connector's discovery
 * PROPFINDs here for the calendar-home-set and enumerates from there — so
 * every calendar the account can see arrives the ordinary way, not just the
 * primary.
 */
export function googleCalDavPrincipalUrl(user: string): string {
  return `https://apidata.googleusercontent.com/caldav/v2/${encodeURIComponent(user)}/user/`;
}

/** Google's CardDAV v1 principal — the addressbook-home-set hangs off it. */
export function googleCardDavPrincipalUrl(user: string): string {
  return `https://www.googleapis.com/carddav/v1/principals/${encodeURIComponent(user)}/`;
}

/** Appliance: the operator sets these in the environment. */
export const ENV_GOOGLE_CALENDAR_CREDENTIAL_NAMES: GoogleCredentialNaming = {
  clientId: 'GOOGLE_CLIENT_ID',
  clientSecret: 'GOOGLE_CLIENT_SECRET',
  // Its own variable, exactly like GOOGLE_MAIL_REFRESH_TOKEN: a refresh token
  // carries the scopes it was CONSENTED with, and one consented for Drive or
  // mail answers invalid_scope here. One consent CAN carry several scopes —
  // an owner who consented calendar+carddav together may set the same value
  // in both variables — but the config stays explicit about which consent
  // each domain runs on.
  refreshToken: 'GOOGLE_CALENDAR_REFRESH_TOKEN',
  serviceAccountKey: ENV_GOOGLE_DWD_KEY_NAME,
  where: "the appliance's environment",
  whereNl: CREDENTIAL_STORE_NL.appliance,
};

/** Same, for contacts. */
export const ENV_GOOGLE_CONTACTS_CREDENTIAL_NAMES: GoogleCredentialNaming = {
  clientId: 'GOOGLE_CLIENT_ID',
  clientSecret: 'GOOGLE_CLIENT_SECRET',
  refreshToken: 'GOOGLE_CONTACTS_REFRESH_TOKEN',
  serviceAccountKey: ENV_GOOGLE_DWD_KEY_NAME,
  where: "the appliance's environment",
  whereNl: CREDENTIAL_STORE_NL.appliance,
};

/** Managed: stored on the connection, encrypted — the same three names as every Google source. */
export const STORED_GOOGLE_DAV_CREDENTIAL_NAMES: GoogleCredentialNaming = {
  clientId: 'clientId',
  clientSecret: 'clientSecret',
  refreshToken: 'refreshToken',
  serviceAccountKey: STORED_GOOGLE_DWD_KEY_NAME,
  where: "the source connection's stored credentials",
  whereNl: CREDENTIAL_STORE_NL.managed,
};

/** The managed `connection.kind`s (migration 0015). */
export const GOOGLE_CALENDAR_CONNECTION_KIND = 'google_calendar';
export const GOOGLE_CONTACTS_CONNECTION_KIND = 'google_contacts';

/** Test seam, same shape as the Gmail factory's. */
export type GoogleDavTokenProviderFactory = (
  creds: { clientId: string; clientSecret: string; refreshToken: string },
  scope: string,
) => TokenProvider;

const defaultProvider: GoogleDavTokenProviderFactory = (c, scope) =>
  new GoogleTokenProvider(c, { scope });

/**
 * The shared build-time refusal — same shape as Drive's and Gmail's, for the
 * same reason: a source constructed without usable credentials fails on its
 * first listing, inside a pass, as an error that reads like Google is down.
 */
function refuseMissing(
  what: 'Calendar' | 'Contacts',
  scope: string,
  user: string,
  creds: GoogleCredentialsAsFound,
  naming: GoogleCredentialNaming,
): { clientId: string; clientSecret: string; refreshToken: string } {
  const missing: string[] = [];
  if (!creds.clientId) missing.push(naming.clientId);
  if (!creds.clientSecret) missing.push(naming.clientSecret);
  if (!creds.refreshToken) missing.push(naming.refreshToken);
  if (missing.length > 0) {
    throw new CredentialRefusalError({
      code: 'credentials_missing',
      fields: missing,
      en:
        `Google ${what} source is missing ${missing.join(', ')} in ${naming.where}. All three are ` +
        'required: the OAuth client (id + secret) and a refresh token consented with the ' +
        `${scope} scope — a token consented for another Google product will not mint these. ` +
        'docs/google-workspace-setup.md walks through obtaining each.',
      nl:
        `Google ${what}-bron: ${missing.join(', ')} ontbreekt in ` +
        `${naming.whereNl ?? naming.where}. Alle drie zijn vereist: de OAuth-client ` +
        `(id + secret) en een refresh-token met toestemming voor de scope ${scope} — een ` +
        'token dat voor een ander Google-product is toegestaan levert deze niet op. ' +
        'docs/google-workspace-setup.md legt stap voor stap uit hoe u ze verkrijgt.',
    });
  }
  if (!user) {
    throw missingAccountAddress(
      `Google ${what} source`,
      'the principal URL the DAV discovery starts from is derived from it.',
      'de principal-URL waar de DAV-detectie mee begint wordt eruit afgeleid.',
    );
  }
  return {
    clientId: creds.clientId!,
    clientSecret: creds.clientSecret!,
    refreshToken: creds.refreshToken!,
  };
}

/** Build the Google Calendar source: the ordinary CalDAV connector, aimed at Google, on Bearer. */
export function buildGoogleCalendarDavSourceFrom(
  user: string,
  creds: GoogleCredentialsAsFound,
  naming: GoogleCredentialNaming = ENV_GOOGLE_CALENDAR_CREDENTIAL_NAMES,
  makeTokenProvider: GoogleDavTokenProviderFactory = defaultProvider,
): CalendarSource {
  // A service-account key selects domain-wide delegation (ADR-0033); the
  // subject is the account whose principal URL the discovery starts from.
  const dwd = dwdTokenProviderIfConfigured(creds, user, GOOGLE_CALDAV_SCOPE, 'Google Calendar source');
  const tokenProvider =
    dwd ??
    makeTokenProvider(
      refuseMissing('Calendar', GOOGLE_CALDAV_SCOPE, user, creds, naming),
      GOOGLE_CALDAV_SCOPE,
    );
  return new CalDAVSource({
    url: googleCalDavPrincipalUrl(user),
    username: user,
    tokenProvider,
  });
}

/** Build the Google Contacts source: the ordinary CardDAV connector, aimed at Google, on Bearer. */
export function buildGoogleContactsDavSourceFrom(
  user: string,
  creds: GoogleCredentialsAsFound,
  naming: GoogleCredentialNaming = ENV_GOOGLE_CONTACTS_CREDENTIAL_NAMES,
  makeTokenProvider: GoogleDavTokenProviderFactory = defaultProvider,
): ContactSource {
  const dwd = dwdTokenProviderIfConfigured(creds, user, GOOGLE_CARDDAV_SCOPE, 'Google Contacts source');
  const tokenProvider =
    dwd ??
    makeTokenProvider(
      refuseMissing('Contacts', GOOGLE_CARDDAV_SCOPE, user, creds, naming),
      GOOGLE_CARDDAV_SCOPE,
    );
  return new CarddavSource({
    url: googleCardDavPrincipalUrl(user),
    username: user,
    tokenProvider,
  });
}
