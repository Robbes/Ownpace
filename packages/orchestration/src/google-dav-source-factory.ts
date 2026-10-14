// Copyright 2026 The Ownpace authors (Apache-2.0)

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

import {
  CREDENTIAL_STORE_NL,
  CredentialRefusalError,
  shownFields,
  missingAccountAddress,
} from '@openmig/shared';
import type { CalendarSource, ContactSource, TokenProvider } from '@openmig/shared';
import { CalDAVSource, CarddavSource, GoogleTokenProvider } from '@openmig/connectors';
import {
  GOOGLE_STORED_LABELS,
  type GoogleCredentialNaming,
  type GoogleCredentialsAsFound,
} from './drive-source-factory.ts';
import {
  ENV_GOOGLE_DWD_KEY_NAME,
  STORED_GOOGLE_DWD_KEY_NAME,
  dwdTokenProviderIfConfigured,
} from './google-dwd.ts';

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
  where: "this account's saved details, on the Accounts page",
  whereNl: CREDENTIAL_STORE_NL.managed,
  labels: GOOGLE_STORED_LABELS,
};

/** The managed `connection.kind`s (migration 0015). */
export const GOOGLE_CALENDAR_CONNECTION_KIND = 'google_calendar';
export const GOOGLE_CONTACTS_CONNECTION_KIND = 'google_contacts';

/**
 * The ACCOUNT kind (migration 0034, workplan 0106 T3b): one Google row wearing
 * several faces, on the `soverin` precedent T4a set.
 *
 * It cohabits with the two single-purpose kinds above rather than replacing
 * them — a mapping created before today keeps its `google_calendar` row and
 * keeps behaving exactly as it did.
 */
export const GOOGLE_ACCOUNT_CONNECTION_KIND = 'google';

/**
 * `googleDavServes` and `googleDriveServes` USED TO LIVE HERE.
 *
 * They answered "does this kind serve that face with the Google builder?" for
 * the two DAV faces and for Drive, and the three seams in
 * `build-deps-from-mapping.ts` asked them. Microsoft became the third provider
 * (0114 T5a) and a boolean per provider stops working at three: the seam
 * becomes a `?:` chain whose last branch does the wrong work silently.
 *
 * `sourceFaceBuilder` in `source-face-builders.ts` replaced both. It answers
 * with a NAME rather than a boolean, so the seams switch on it, an unhandled
 * builder is a refusal that names both halves of the disagreement, and
 * `scripts/a-face-a-provider-account-cannot-build.unit.test.ts` pairs the
 * table against `PROVIDER_ACCOUNT_DOMAINS` in both directions.
 *
 * Removed rather than kept beside it: a second answer to the same question,
 * with its own passing tests, is the "decision function fully green while the
 * caller ignores it" defect that `google-account-kind.unit.test.ts` was
 * written about.
 */


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
  const keys = (['clientId', 'clientSecret', 'refreshToken'] as const).filter((k) => !creds[k]);
  const missing = keys.map((k) => naming[k]);
  const shown = shownFields(keys, missing, naming.labels);
  if (missing.length > 0) {
    throw new CredentialRefusalError({
      code: 'credentials_missing',
      fields: missing,
      // Written for the person who reads it (the owner, 2026-10-14).
      en:
        `Google ${what} source is missing ${shown.en.join(', ')} in ${naming.where}. All three are ` +
        "needed: your own app's client ID and secret, and a sign-in that gave permission for " +
        `Google ${what} (${scope}). A sign-in given for another Google product does not cover ` +
        `${what}. ` +
        'The guide shows where to find each one.',
      nl:
        `Google ${what}-bron: ${shown.nl.join(', ')} ontbreekt in ` +
        `${naming.whereNl ?? naming.where}. Alle drie zijn nodig: de Client-ID en het ` +
        `clientsecret van uw eigen oauth-app, en een aanmelding met toestemming voor Google ` +
        `${what} (${scope}). Een aanmelding voor een ander Google-product geldt niet voor ` +
        `${what}. In de ` +
        'handleiding staat waar u elk gegeven vindt.',
      // The guide's own-app steps, linked beside the words (0148 T7).
      guide: 'google#own-app',
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
