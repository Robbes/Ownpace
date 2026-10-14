// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * One Dropbox source builder, two ways in (workplan 0055) — the Drive
 * factory's shape, for the Drive factory's reasons: the CONSTRUCTION is
 * shared between the appliance (env vars) and the managed edition (decrypted
 * connection credentials), refusals included, in whichever vocabulary the
 * operator can act on.
 *
 * Dropbox's App Console calls the client credentials "App key" and
 * "App secret"; the managed credential record stores them under the same
 * three keys every OAuth trio uses (clientId/clientSecret/refreshToken) so
 * the wizard, the probe and the pass all read one shape — the NAMING maps
 * the words, exactly like `GoogleCredentialNaming` does.
 */

import { CREDENTIAL_STORE_NL } from '@openmig/shared';
import { missingCredentials, shownFields, type FieldLabels } from '@openmig/shared';
import type { DropboxNativeFilePolicies, FileSource } from '@openmig/shared';
import { DropboxFileSource, DropboxTokenProvider, dropboxTransport } from '@openmig/connectors';

export interface DropboxEndpoint {
  readonly rootPath?: string | undefined;
  /** The format Paper docs arrive in (workplan 0150 T3); unset refuses them by name. */
  readonly nativeFilePolicies?: DropboxNativeFilePolicies | undefined;
  readonly apiBaseUrl?: string | undefined;
  readonly contentBaseUrl?: string | undefined;
}

/** The three values the refresh grant needs, as the caller found them. */
export interface DropboxCredentialsAsFound {
  readonly appKey?: string | undefined;
  readonly appSecret?: string | undefined;
  readonly refreshToken?: string | undefined;
}

export interface DropboxCredentialNaming {
  readonly appKey: string;
  readonly appSecret: string;
  readonly refreshToken: string;
  readonly where: string;
  /** The same place in Dutch. Optional: unset falls back to the English. */
  readonly whereNl?: string;
  /** What the managed form calls each field, per language (the owner, 2026-10-14). */
  readonly labels?: FieldLabels;
}

/** Self-host: the operator sets environment variables on the appliance. */
export const ENV_DROPBOX_CREDENTIAL_NAMES: DropboxCredentialNaming = {
  appKey: 'DROPBOX_APP_KEY',
  appSecret: 'DROPBOX_APP_SECRET',
  refreshToken: 'DROPBOX_REFRESH_TOKEN',
  where: "the appliance's environment",
  whereNl: CREDENTIAL_STORE_NL.appliance,
};

/** Managed: stored on the connection, encrypted, under the shared trio keys. */
export const STORED_DROPBOX_CREDENTIAL_NAMES: DropboxCredentialNaming = {
  appKey: 'clientId',
  appSecret: 'clientSecret',
  refreshToken: 'refreshToken',
  where: "this account's saved details, on the Accounts page",
  whereNl: CREDENTIAL_STORE_NL.managed,
  labels: {
    en: { appKey: 'App key', appSecret: 'App secret', refreshToken: 'the sign-in from Connect with Dropbox' },
    nl: { appKey: 'App-sleutel', appSecret: 'App-secret', refreshToken: 'de aanmelding via Verbinden met Dropbox' },
  },
};

/** The managed `connection.kind` (migration 0018). */
export const DROPBOX_CONNECTION_KIND = 'dropbox';

/** Build the Dropbox source, refusing at BUILD TIME when a credential is missing. */
export function buildDropboxSourceFrom(
  endpoint: DropboxEndpoint,
  creds: DropboxCredentialsAsFound,
  naming: DropboxCredentialNaming = ENV_DROPBOX_CREDENTIAL_NAMES,
): FileSource {
  const keys = (['appKey', 'appSecret', 'refreshToken'] as const).filter((key) => !creds[key]);
  const missing = keys.map((key) => naming[key]);
  if (missing.length > 0) {
    throw missingCredentials({
      subject: 'dropbox source',
      missing,
      shown: shownFields(keys, missing, naming.labels),
      // Written for the person who reads it (the owner, 2026-10-14).
      detailEn:
        'Ownpace reads Dropbox as the account that gave permission, so all three are ' +
        `needed, in ${naming.where}. The guide shows where to find each one. Create your own ` +
        'app with read-only access to files: Ownpace never writes to your Dropbox.',
      detailNl:
        'Ownpace leest Dropbox als het account dat toestemming gaf, dus alle drie zijn ' +
        `nodig, in ${naming.whereNl ?? naming.where}. In de handleiding staat waar u elk ` +
        'gegeven vindt. Maak uw eigen oauth-app aan met alleen leesrechten op bestanden: ' +
        'Ownpace schrijft nooit in uw Dropbox.',
      // The guide's own-app steps, linked beside the words (0148 T7).
      guide: 'dropbox#own-app',
    });
  }

  const tokens = new DropboxTokenProvider({
    appKey: creds.appKey!,
    appSecret: creds.appSecret!,
    refreshToken: creds.refreshToken!,
  });
  return new DropboxFileSource(dropboxTransport(tokens), {
    ...(endpoint.rootPath === undefined ? {} : { rootPath: endpoint.rootPath }),
    ...(endpoint.nativeFilePolicies === undefined
      ? {}
      : { nativeFilePolicies: endpoint.nativeFilePolicies }),
    ...(endpoint.apiBaseUrl === undefined ? {} : { apiBaseUrl: endpoint.apiBaseUrl }),
    ...(endpoint.contentBaseUrl === undefined ? {} : { contentBaseUrl: endpoint.contentBaseUrl }),
  });
}
