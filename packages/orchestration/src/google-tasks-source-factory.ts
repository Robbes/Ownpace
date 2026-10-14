// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Google Tasks as a source (workplan 0126 T2): the fifth face of a Google
 * account.
 *
 * Google's CalDAV carries no VTODO (0113 T5), so this face is the Tasks API,
 * read by `GoogleTasksSource` (T1). It is built the way the calendar and
 * contacts faces are: domain-wide delegation when the credentials carry a
 * service-account key (ADR-0033), the refresh token otherwise, and a refusal
 * at BUILD time that names what is missing, so a pass never starts on
 * credentials that cannot mint a token.
 *
 * Unlike the DAV faces it takes the tenant's rate budget. The Tasks API pages
 * a hundred tasks at a time, and a limiter handed to the source is what turns
 * a 429 into a pause rather than a failed pass (0126 T5).
 */

import { CREDENTIAL_STORE_NL, CredentialRefusalError, shownFields } from '@openmig/shared';
import type { CalendarSource, ThrottleLimiter, TokenProvider } from '@openmig/shared';
import { GoogleTasksSource, GoogleTokenProvider } from '@openmig/connectors';
import type { GoogleCredentialNaming, GoogleCredentialsAsFound } from './drive-source-factory.ts';
import { GOOGLE_STORED_LABELS } from './drive-source-factory.ts';
import { STORED_GOOGLE_DWD_KEY_NAME, dwdTokenProviderIfConfigured } from './google-dwd.ts';

/** The one scope this face asks for and mints with: read-only, all a migration needs. */
export const GOOGLE_TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks.readonly';

/** Managed: stored on the connection, encrypted — the same names as every Google face. */
export const STORED_GOOGLE_TASKS_CREDENTIAL_NAMES: GoogleCredentialNaming = {
  clientId: 'clientId',
  clientSecret: 'clientSecret',
  refreshToken: 'refreshToken',
  serviceAccountKey: STORED_GOOGLE_DWD_KEY_NAME,
  where: "this account's saved details, on the Accounts page",
  whereNl: CREDENTIAL_STORE_NL.managed,
  labels: GOOGLE_STORED_LABELS,
};

/**
 * The key the limiter's in-process bucket is held under. Any stable label
 * serves: the tenant's shared budget is keyed by the tenant it was built for,
 * not by this (`tenantThrottleLimiter`).
 */
const LIMITER_LABEL = 'google';

/** Test seam, the same shape as the DAV factory's. */
export type GoogleTasksTokenProviderFactory = (
  creds: { clientId: string; clientSecret: string; refreshToken: string },
  scope: string,
) => TokenProvider;

const defaultProvider: GoogleTasksTokenProviderFactory = (c, scope) =>
  new GoogleTokenProvider(c, { scope });

/**
 * The refresh-token half's refusal. No account address is demanded, unlike
 * the DAV faces: the Tasks API answers for the token's own user (`@me`), so
 * the address matters only as domain-wide delegation's subject, and that
 * provider refuses a missing one itself.
 */
function refuseMissing(
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
        `Google Tasks source is missing ${shown.en.join(', ')} in ${naming.where}. All three are ` +
        "needed: your own app's client ID and secret, and a sign-in that gave permission for " +
        `Google Tasks (${GOOGLE_TASKS_SCOPE}). A sign-in given for another Google product does ` +
        'not cover Tasks. The ' +
        'guide shows where to find each one.',
      nl:
        `Google Tasks-bron: ${shown.nl.join(', ')} ontbreekt in ` +
        `${naming.whereNl ?? naming.where}. Alle drie zijn nodig: de Client-ID en het ` +
        'clientsecret van uw eigen oauth-app, en een aanmelding met toestemming voor Google ' +
        `Tasks (${GOOGLE_TASKS_SCOPE}). Een aanmelding voor een ander Google-product geldt niet ` +
        'voor Tasks. In de ' +
        'handleiding staat waar u elk gegeven vindt.',
      // The guide's own-app steps, linked beside the words (0148 T7).
      guide: 'google#own-app',
    });
  }
  return {
    clientId: creds.clientId!,
    clientSecret: creds.clientSecret!,
    refreshToken: creds.refreshToken!,
  };
}

/** Build the Google Tasks source for one account. */
export function buildGoogleTasksSourceFrom(
  user: string,
  creds: GoogleCredentialsAsFound,
  /**
   * The tenant's shared rate budget, or `undefined` for a one-shot probe.
   * Required in position, as at every builder seam: forgetting it must not
   * compile (see `buildCalendarSourceFromConnection`).
   */
  throttleLimiter: ThrottleLimiter | undefined,
  naming: GoogleCredentialNaming = STORED_GOOGLE_TASKS_CREDENTIAL_NAMES,
  makeTokenProvider: GoogleTasksTokenProviderFactory = defaultProvider,
): CalendarSource {
  // A service-account key selects domain-wide delegation (ADR-0033), and the
  // subject is the account this mapping migrates.
  const dwd = dwdTokenProviderIfConfigured(creds, user, GOOGLE_TASKS_SCOPE, 'Google Tasks source');
  const tokenProvider = dwd ?? makeTokenProvider(refuseMissing(creds, naming), GOOGLE_TASKS_SCOPE);
  return new GoogleTasksSource(tokenProvider, LIMITER_LABEL, throttleLimiter ? { throttleLimiter } : undefined);
}
