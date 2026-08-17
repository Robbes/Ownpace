// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * One Box source builder, two ways in (workplan 0056) — the Drive factory's
 * shape, for the Drive factory's reasons: the CONSTRUCTION is shared between
 * the appliance (env vars) and the managed edition (decrypted connection
 * credentials), refusals included, in whichever vocabulary the operator can
 * act on.
 *
 * The credential shape is NOT the OAuth trio: Box rotates refresh tokens on
 * every use (single-use), and stored credentials here are never written back,
 * so a stored Box refresh token would break on the second pass. The
 * Client Credentials Grant is used instead — client id + secret plus the
 * SUBJECT USER ID naming whose files the token reads, which lives on the
 * mapping's source config (one subject per mapping, the DWD/ADR-0033
 * posture), not among the secrets.
 */

import type { FileSource } from '@openmig/shared';
import { BoxFileSource, BoxTokenProvider, boxTransport } from '@openmig/connectors';

export interface BoxEndpoint {
  /** Unset = '0', Box's id for the account root ("All Files"). */
  readonly rootFolderId?: string | undefined;
  readonly baseUrl?: string | undefined;
  readonly tokenEndpoint?: string | undefined;
}

/** The three values the Client Credentials Grant needs, as the caller found them. */
export interface BoxCredentialsAsFound {
  readonly clientId?: string | undefined;
  readonly clientSecret?: string | undefined;
  /** The NUMERIC Box user id being migrated — from the source CONFIG, not the secrets. */
  readonly subjectUserId?: string | undefined;
}

export interface BoxCredentialNaming {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly subjectUserId: string;
  readonly where: string;
}

/** Self-host: the operator sets environment variables on the appliance. */
export const ENV_BOX_CREDENTIAL_NAMES: BoxCredentialNaming = {
  clientId: 'BOX_CLIENT_ID',
  clientSecret: 'BOX_CLIENT_SECRET',
  subjectUserId: "userId (on the mapping's source config)",
  where: "the appliance's environment (userId on the mapping file)",
};

/** Managed: stored on the connection, encrypted; the subject rides the config. */
export const STORED_BOX_CREDENTIAL_NAMES: BoxCredentialNaming = {
  clientId: 'clientId',
  clientSecret: 'clientSecret',
  subjectUserId: "userId (on the source config)",
  where: "the source connection's stored credentials (userId on the source config)",
};

/** The managed `connection.kind` (migration 0019). */
export const BOX_CONNECTION_KIND = 'box';

/** Build the Box source, refusing at BUILD TIME when a credential is missing. */
export function buildBoxSourceFrom(
  endpoint: BoxEndpoint,
  creds: BoxCredentialsAsFound,
  naming: BoxCredentialNaming = ENV_BOX_CREDENTIAL_NAMES,
): FileSource {
  const missing = (['clientId', 'clientSecret', 'subjectUserId'] as const)
    .filter((key) => !creds[key])
    .map((key) => naming[key]);
  if (missing.length > 0) {
    throw new Error(
      `box source: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set. ` +
        `A Box migration uses the Client Credentials Grant — NOT a refresh token, because Box ` +
        `rotates refresh tokens on every use and stored credentials here are never written ` +
        `back — so it needs ${naming.clientId}, ${naming.clientSecret} and the numeric ` +
        `${naming.subjectUserId} in ${naming.where}. docs/box-setup.md walks through obtaining ` +
        'each, including the one-time admin authorization; the app is read-only by scope — ' +
        'this product never writes to a Box.',
    );
  }

  const tokens = new BoxTokenProvider(
    {
      clientId: creds.clientId!,
      clientSecret: creds.clientSecret!,
      subjectUserId: creds.subjectUserId!,
    },
    endpoint.tokenEndpoint === undefined ? {} : { tokenEndpoint: endpoint.tokenEndpoint },
  );
  return new BoxFileSource(boxTransport(tokens), {
    ...(endpoint.rootFolderId === undefined ? {} : { rootFolderId: endpoint.rootFolderId }),
    ...(endpoint.baseUrl === undefined ? {} : { baseUrl: endpoint.baseUrl }),
  });
}
