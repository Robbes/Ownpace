// Copyright 2026 The Ownpace authors (Apache-2.0)

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

import { CREDENTIAL_STORE_NL } from '@openmig/shared';
import { missingCredentials, shownFields, type FieldLabels } from '@openmig/shared';
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
  /** The same place in Dutch. Optional: unset falls back to the English. */
  readonly whereNl?: string;
  /** What the managed form calls each field, per language (the owner, 2026-10-14). */
  readonly labels?: FieldLabels;
}

/** Self-host: the operator sets environment variables on the appliance. */
export const ENV_BOX_CREDENTIAL_NAMES: BoxCredentialNaming = {
  clientId: 'BOX_CLIENT_ID',
  clientSecret: 'BOX_CLIENT_SECRET',
  subjectUserId: "userId (on the mapping's source config)",
  where: "the appliance's environment (userId on the mapping file)",
  whereNl: `${CREDENTIAL_STORE_NL.appliance} (userId in het mapping-bestand)`,
};

/** Managed: stored on the connection, encrypted; the subject rides the config. */
export const STORED_BOX_CREDENTIAL_NAMES: BoxCredentialNaming = {
  clientId: 'clientId',
  clientSecret: 'clientSecret',
  subjectUserId: "userId (on the source config)",
  where: "this account's saved details, on the Accounts page",
  whereNl: CREDENTIAL_STORE_NL.managed,
  labels: {
    en: { clientId: 'Client ID', clientSecret: 'Client secret', subjectUserId: 'Box user ID' },
    nl: { clientId: 'Client-ID', clientSecret: 'Clientsecret', subjectUserId: 'Box-gebruikers-ID' },
  },
};

/** The managed `connection.kind` (migration 0019). */
export const BOX_CONNECTION_KIND = 'box';

/** Build the Box source, refusing at BUILD TIME when a credential is missing. */
export function buildBoxSourceFrom(
  endpoint: BoxEndpoint,
  creds: BoxCredentialsAsFound,
  naming: BoxCredentialNaming = ENV_BOX_CREDENTIAL_NAMES,
): FileSource {
  const keys = (['clientId', 'clientSecret', 'subjectUserId'] as const).filter((key) => !creds[key]);
  const missing = keys.map((key) => naming[key]);
  if (missing.length > 0) {
    throw missingCredentials({
      subject: 'box source',
      missing,
      shown: shownFields(keys, missing, naming.labels),
      // Written for the person who reads it, not for whoever wrote the
      // connector (the owner, 2026-10-14). Why there is no token field stays
      // said: Box replaces its sign-in tokens at every use.
      detailEn:
        `All three are needed, in ${naming.where}. Ownpace signs in to Box as an app you ` +
        'create, because Box replaces its sign-in tokens every time one is used. The app can ' +
        'only read: Ownpace never writes to your Box. The guide shows where to find each one, ' +
        'including the approval a Box administrator gives once.',
      detailNl:
        `Alle drie zijn nodig, in ${naming.whereNl ?? naming.where}. Ownpace meldt zich bij ` +
        'Box aan als een app die u zelf aanmaakt, omdat Box zijn aanmeldtokens bij elk ' +
        'gebruik vervangt. De app kan alleen lezen: Ownpace schrijft nooit in uw Box. In de ' +
        'handleiding staat waar u elk gegeven vindt, ook de goedkeuring die een Box-beheerder ' +
        'één keer geeft.',
      // The guide's own steps, linked beside the words (0148 T7).
      guide: 'box#connect',
    });
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
