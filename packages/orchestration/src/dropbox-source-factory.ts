// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

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

import type { FileSource } from '@openmig/shared';
import { DropboxFileSource, DropboxTokenProvider, dropboxTransport } from '@openmig/connectors';

export interface DropboxEndpoint {
  readonly rootPath?: string | undefined;
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
}

/** Self-host: the operator sets environment variables on the appliance. */
export const ENV_DROPBOX_CREDENTIAL_NAMES: DropboxCredentialNaming = {
  appKey: 'DROPBOX_APP_KEY',
  appSecret: 'DROPBOX_APP_SECRET',
  refreshToken: 'DROPBOX_REFRESH_TOKEN',
  where: "the appliance's environment",
};

/** Managed: stored on the connection, encrypted, under the shared trio keys. */
export const STORED_DROPBOX_CREDENTIAL_NAMES: DropboxCredentialNaming = {
  appKey: 'clientId',
  appSecret: 'clientSecret',
  refreshToken: 'refreshToken',
  where: "the source connection's stored credentials",
};

/** The managed `connection.kind` (migration 0018). */
export const DROPBOX_CONNECTION_KIND = 'dropbox';

/** Build the Dropbox source, refusing at BUILD TIME when a credential is missing. */
export function buildDropboxSourceFrom(
  endpoint: DropboxEndpoint,
  creds: DropboxCredentialsAsFound,
  naming: DropboxCredentialNaming = ENV_DROPBOX_CREDENTIAL_NAMES,
): FileSource {
  const missing = (['appKey', 'appSecret', 'refreshToken'] as const)
    .filter((key) => !creds[key])
    .map((key) => naming[key]);
  if (missing.length > 0) {
    throw new Error(
      `dropbox source: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set. ` +
        `A Dropbox migration authenticates as the account that consented, so it needs all three ` +
        `of ${naming.appKey}, ${naming.appSecret} and ${naming.refreshToken} in ${naming.where}. ` +
        'docs/dropbox-setup.md walks through obtaining each; create the app with the read-only ' +
        'files scopes — this product never writes to a Dropbox.',
    );
  }

  const tokens = new DropboxTokenProvider({
    appKey: creds.appKey!,
    appSecret: creds.appSecret!,
    refreshToken: creds.refreshToken!,
  });
  return new DropboxFileSource(dropboxTransport(tokens), {
    ...(endpoint.rootPath === undefined ? {} : { rootPath: endpoint.rootPath }),
    ...(endpoint.apiBaseUrl === undefined ? {} : { apiBaseUrl: endpoint.apiBaseUrl }),
    ...(endpoint.contentBaseUrl === undefined ? {} : { contentBaseUrl: endpoint.contentBaseUrl }),
  });
}
