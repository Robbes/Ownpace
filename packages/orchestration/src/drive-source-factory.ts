// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * One Google Drive source builder, two ways in (workplan 0042 T5).
 *
 * The shape `mail-source-factory.ts` established after 0041: the CONSTRUCTION is
 * shared between the appliance (env vars) and the managed edition (decrypted
 * connection credentials), so a fix to a timeout, a scope or a retry is a fix to
 * both. Hard rule 5 says the editions do not differ; two copies is how they come
 * to.
 *
 * WHERE THIS DIVERGES FROM THE MAIL FACTORY, and why. There, validation stays
 * with each caller because the two editions genuinely check different things —
 * self-host follows the mapping's DECLARED auth kind, managed follows which
 * credential is PRESENT. Here they check the identical thing: three OAuth values,
 * all required, no flow selection. Only the WORDS differ, and words are a
 * parameter (`GoogleCredentialNaming`). So the refusal is shared too — one
 * refusal, in whichever vocabulary the operator can act on.
 *
 * NOTHING ABOUT A TARGET. A Drive migration reads from Drive and writes wherever
 * the mapping's file target says; the target side is untouched, and the token
 * this mints cannot write to Drive at all (`drive.readonly`).
 */

import { CREDENTIAL_STORE_NL, missingCredentials } from '@openmig/shared';
import type { FileSource, GoogleNativeFilePolicy } from '@openmig/shared';
import {
  DRIVE_READONLY_SCOPE,
  GoogleDriveSource,
  createGoogleTokenProvider,
  googleDriveTransport,
} from '@openmig/connectors';
import {
  ENV_GOOGLE_DWD_KEY_NAME,
  STORED_GOOGLE_DWD_KEY_NAME,
  dwdTokenProviderIfConfigured,
} from './google-dwd.ts';

/**
 * Where the Drive is, with no trace of whether a file or a database row said so.
 *
 * Structural rather than `SourceConfig`-narrowed, so both callers' types satisfy
 * it as they stand — and so the managed edition, whose stored config is untyped
 * JSON validated by `parseGoogleDriveSource`, needs no cast here.
 */
export interface GoogleDriveEndpoint {
  readonly baseUrl?: string;
  readonly rootFolderId?: string;
  readonly nativeFilePolicy?: GoogleNativeFilePolicy;
}

/** The credentials as the caller found them — either flow's (ADR-0033). */
export interface GoogleCredentialsAsFound {
  readonly clientId?: string | undefined;
  readonly clientSecret?: string | undefined;
  readonly refreshToken?: string | undefined;
  /** A service-account key file selects domain-wide delegation instead. */
  readonly serviceAccountKey?: string | undefined;
  /** The impersonated account, for factories that take no user parameter. */
  readonly subject?: string | undefined;
  /**
   * A Google **app password** — the one Google path that skips OAuth entirely
   * (workplan 0089 T7). Personal accounts only, and only for MAIL: it is an
   * IMAP credential, so no other Google product can be reached with it.
   *
   * Its own key rather than `password`, for the reason `serviceAccountKey` has
   * its own: **the credential's shape IS the choice.** There is no mode flag to
   * disagree with what is stored, and nothing can confuse it with
   * `clientSecret`.
   */
  readonly appPassword?: string | undefined;
}

/**
 * What to CALL the credentials when refusing, in words the operator can act on.
 *
 * The mail factory learned this the expensive way: a refusal written once and
 * copied told managed operators to set an environment variable that edition does
 * not read. A fix the operator cannot apply is not one (rule 9).
 */
export interface GoogleCredentialNaming {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  /** The DWD alternative's name (ADR-0033); optional for older callers. */
  readonly serviceAccountKey?: string;
  /** The app-password alternative's name (0089 T7); mail factories only. */
  readonly appPassword?: string;
  /** Where these are configured, completing the sentence "set them in …". */
  readonly where: string;
  /** The same place in Dutch. Optional: unset falls back to the English. */
  readonly whereNl?: string;
}

/** Self-host: the operator sets environment variables on the appliance. */
export const ENV_GOOGLE_CREDENTIAL_NAMES: GoogleCredentialNaming = {
  clientId: 'GOOGLE_CLIENT_ID',
  clientSecret: 'GOOGLE_CLIENT_SECRET',
  refreshToken: 'GOOGLE_REFRESH_TOKEN',
  serviceAccountKey: ENV_GOOGLE_DWD_KEY_NAME,
  where: "the appliance's environment",
  whereNl: CREDENTIAL_STORE_NL.appliance,
};

/** Managed: the operator stores them on the connection, encrypted. */
export const STORED_GOOGLE_CREDENTIAL_NAMES: GoogleCredentialNaming = {
  clientId: 'clientId',
  clientSecret: 'clientSecret',
  refreshToken: 'refreshToken',
  serviceAccountKey: STORED_GOOGLE_DWD_KEY_NAME,
  where: "the source connection's stored credentials",
  whereNl: CREDENTIAL_STORE_NL.managed,
};

/**
 * Build the Drive source, refusing at BUILD TIME when a credential is missing.
 *
 * Not at first use: a source constructed without usable credentials fails on its
 * first listing, inside a pass, as a folder-level error that reads like Drive is
 * down. Refusing here names the three values and where they go, before anything
 * is recorded as attempted.
 */
export function buildGoogleDriveSourceFrom(
  endpoint: GoogleDriveEndpoint,
  creds: GoogleCredentialsAsFound,
  naming: GoogleCredentialNaming = ENV_GOOGLE_CREDENTIAL_NAMES,
): FileSource {
  // A service-account key selects domain-wide delegation (ADR-0033): the
  // subject is the account this mapping migrates, and the refresh-token
  // refusals below never fire — the two flows need different values.
  const dwd = dwdTokenProviderIfConfigured(
    creds,
    creds.subject,
    DRIVE_READONLY_SCOPE,
    'google-drive source',
  );

  // Every missing value at once. Naming them one at a time makes an operator
  // fix, re-run, and be told about the next — three passes to learn one thing.
  const missing = dwd
    ? []
    : (['clientId', 'clientSecret', 'refreshToken'] as const)
        .filter((key) => !creds[key])
        .map((key) => naming[key]);

  if (missing.length > 0) {
    throw missingCredentials({
      subject: 'google-drive source',
      missing,
      detailEn:
        `A Drive migration authenticates as the user who consented, so it needs all three of ` +
        `${naming.clientId}, ${naming.clientSecret} and ${naming.refreshToken} in ${naming.where}. ` +
        'The token is minted read-only (drive.readonly): this product never writes to a Drive.',
      detailNl:
        'Een Drive-migratie meldt zich aan als de gebruiker die toestemming gaf, dus alle drie ' +
        `zijn nodig: ${naming.clientId}, ${naming.clientSecret} en ${naming.refreshToken} in ` +
        `${naming.whereNl ?? naming.where}. Het token wordt alleen-lezen aangemaakt ` +
        '(drive.readonly): dit product schrijft nooit naar een Drive.',
    });
  }

  const tokens =
    dwd ??
    createGoogleTokenProvider({
      clientId: creds.clientId!,
      clientSecret: creds.clientSecret!,
      refreshToken: creds.refreshToken!,
    });

  return new GoogleDriveSource(googleDriveTransport(tokens), {
    // Each omitted rather than defaulted here, so the connector stays the single
    // place that decides what unset means — including `nativeFilePolicy`, whose
    // default is `refuse` and must not be re-decided per edition.
    ...(endpoint.baseUrl === undefined ? {} : { baseUrl: endpoint.baseUrl }),
    ...(endpoint.rootFolderId === undefined ? {} : { rootFolderId: endpoint.rootFolderId }),
    ...(endpoint.nativeFilePolicy === undefined
      ? {}
      : { nativeFilePolicy: endpoint.nativeFilePolicy }),
  });
}

/**
 * The managed edition's `connection.kind` for a Google Drive source.
 *
 * TWO SPELLINGS, ONE PROVIDER, and it is worth saying out loud: a mapping FILE
 * names `"type": "google-drive"` (hyphenated, like `graph-mail` and
 * `imap-oauth2`), while the `connection.kind` column is `google_drive`
 * (underscored, like `selfhosted_mail`). Each follows the convention of the
 * place it lives. They never meet — one is parsed by `parseSource`, the other is
 * a database CHECK — so this constant exists to keep the managed comparison from
 * being a bare string literal somebody "corrects" to the other spelling.
 */
export const GOOGLE_DRIVE_CONNECTION_KIND = 'google_drive';
