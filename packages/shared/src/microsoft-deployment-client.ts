// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The Entra application this DEPLOYMENT owns, so nobody has to register one
 * (2026-09-03, the owner: "make the grant button for Microsoft like o365
 * mail, OneDrive, calendar, and the other kinds we support").
 *
 * Google's module (`google-deployment-client.ts`) explains the shape and the
 * trade, and every word of it holds here: the client ID and secret are the
 * deployment's, the refresh token is the account's; the connection stores
 * neither half of the pair (owner decision 2026-09-01, option B); a
 * connection's own pair always wins; both or neither; and the deployment's
 * pair is handed only to a MICROSOFT connection, because `clientId` and
 * `clientSecret` are shared key names and a Google row must never be given
 * Microsoft's application.
 *
 * ## What this replaces, and for whom
 *
 * `credential-fields.ts` asks an O365 customer for a tenant ID, a client ID
 * and a client secret today, because "oauth2 and graph authenticate with the
 * customer's OWN Entra app registration". That is a reasonable ask of an IT
 * department and an unreasonable one of a family. **Both paths stay**: a
 * customer with their own registration keeps it, and the deployment's
 * application serves everybody else. Same cohabitation as `gmail` beside
 * `google`.
 *
 * ## The authority, which Google and Dropbox do not have
 *
 * Microsoft needs to be told WHICH directory to authenticate against. That is
 * a third value, not a third of the pair — the pair is still id and secret,
 * both or neither, and the authority has a safe default.
 *
 * **`common` is that default and it is the one a shared deployment needs.**
 * An application registered as single-tenant authenticates only its own
 * directory: it would work for the operator, work in their testing, and fail
 * for the first customer in another organisation — the kind of wrong that
 * looks fine until it is in front of somebody. `MICROSOFT_OAUTH_TENANT` exists
 * so an operator running a deliberately single-tenant deployment can say so,
 * not so anybody has to think about it.
 *
 * Registering multi-tenant is a choice made in Entra, not here, and no value
 * in this file can compensate for a registration that was not. The operator
 * guide says which radio button; this default only ensures we ask the right
 * endpoint once they have.
 */

/** Microsoft's multi-tenant authority — any work or school account. */
export const MICROSOFT_DEFAULT_TENANT = 'common';

export interface MicrosoftClientEnv {
  readonly MICROSOFT_OAUTH_CLIENT_ID?: string | undefined;
  readonly MICROSOFT_OAUTH_CLIENT_SECRET?: string | undefined;
  readonly MICROSOFT_OAUTH_TENANT?: string | undefined;
}

export interface MicrosoftDeploymentClient {
  readonly clientId: string;
  readonly clientSecret: string;
  /** The directory to authenticate against. `common` unless set. */
  readonly tenant: string;
}

const trimmed = (value: string | undefined): string => (value ?? '').trim();

/**
 * The authority segment to use. Never empty: an empty or whitespace value
 * would build `https://login.microsoftonline.com//oauth2/v2.0/authorize`,
 * which is a different URL and not a better error.
 */
export function microsoftTenant(env: MicrosoftClientEnv = process.env): string {
  return trimmed(env.MICROSOFT_OAUTH_TENANT) || MICROSOFT_DEFAULT_TENANT;
}

/** The configured pair, or null when this deployment has none. BOTH OR NEITHER. */
export function microsoftDeploymentClient(
  env: MicrosoftClientEnv = process.env,
): MicrosoftDeploymentClient | null {
  const clientId = trimmed(env.MICROSOFT_OAUTH_CLIENT_ID);
  const clientSecret = trimmed(env.MICROSOFT_OAUTH_CLIENT_SECRET);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, tenant: microsoftTenant(env) };
}

/** The sentence for a HALF-configured application, or null. Never prints a value. */
export function microsoftDeploymentClientProblem(
  env: MicrosoftClientEnv = process.env,
): string | null {
  const clientId = trimmed(env.MICROSOFT_OAUTH_CLIENT_ID);
  const clientSecret = trimmed(env.MICROSOFT_OAUTH_CLIENT_SECRET);
  if (!clientId && !clientSecret) return null;
  if (clientId && clientSecret) return null;
  const missing = clientId ? 'MICROSOFT_OAUTH_CLIENT_SECRET' : 'MICROSOFT_OAUTH_CLIENT_ID';
  const set = clientId ? 'MICROSOFT_OAUTH_CLIENT_ID' : 'MICROSOFT_OAUTH_CLIENT_SECRET';
  return (
    `This deployment has ${set} set and ${missing} empty, so it has no usable Entra ` +
    'application: an application ID without its client secret cannot exchange an ' +
    `authorization code. Set ${missing} in deploy/compose/.env and restart the API, or ` +
    'clear both and let each connection carry its own registration.'
  );
}

/**
 * Fill in the deployment's application where a MICROSOFT connection has none.
 * The credentials it is given win, key by key; `isMicrosoft` is the caller's
 * answer, gated on the connection kind, never guessed here.
 *
 * `tenantId` is filled the same way and for the same reason: a connection that
 * named its own directory keeps it, and one that named none gets the
 * deployment's authority rather than an empty path segment.
 */
export function withDeploymentMicrosoftClient(
  isMicrosoft: boolean,
  credentials: Record<string, string>,
  env: MicrosoftClientEnv = process.env,
): Record<string, string> {
  if (!isMicrosoft) return credentials;
  const configured = microsoftDeploymentClient(env);
  if (!configured) return credentials;
  const filled = { ...credentials };
  if (!trimmed(filled.clientId)) filled.clientId = configured.clientId;
  if (!trimmed(filled.clientSecret)) filled.clientSecret = configured.clientSecret;
  if (!trimmed(filled.tenantId)) filled.tenantId = configured.tenant;
  return filled;
}

/** The sentence for HALF a client pair on a Microsoft connection, or null. */
export function halfMicrosoftClientPairProblem(
  credentials: {
    readonly clientId?: string | undefined;
    readonly clientSecret?: string | undefined;
  },
  env: MicrosoftClientEnv = process.env,
): string | null {
  if (microsoftDeploymentClient(env) === null) return null;
  const hasId = trimmed(credentials.clientId) !== '';
  const hasSecret = trimmed(credentials.clientSecret) !== '';
  if (hasId === hasSecret) return null;
  const sent = hasId ? 'clientId' : 'clientSecret';
  const missing = hasId ? 'clientSecret' : 'clientId';
  return (
    `${sent} was sent without ${missing}. An Entra application is both halves or neither: ` +
    "send both to use your own registration, or neither to use this deployment's. The " +
    `deployment's ${missing} does not belong to the ${sent} you sent, and Microsoft would ` +
    'refuse the pair at its token endpoint — hours later, from a sync pass.'
  );
}

export type MicrosoftClientResolution =
  | {
      readonly ok: true;
      readonly clientId: string;
      readonly clientSecret: string;
      readonly tenant: string;
    }
  | {
      readonly ok: false;
      readonly error: 'half_client_pair' | 'no_microsoft_client';
      readonly reason: string;
    };

/**
 * The application a Microsoft request may use: the caller's WHOLE pair, else
 * the deployment's, else a refusal.
 *
 * A caller who sent their own pair may also have sent their own `tenantId`,
 * and it is theirs — a single-tenant registration authenticating against
 * `common` fails at Entra with a message about the application not being
 * found in the directory, which reads like a typo and is not one.
 */
export function resolveMicrosoftClient(
  sent: {
    readonly clientId?: string | undefined;
    readonly clientSecret?: string | undefined;
    readonly tenantId?: string | undefined;
  },
  env: MicrosoftClientEnv = process.env,
): MicrosoftClientResolution {
  const half = halfMicrosoftClientPairProblem(sent, env);
  if (half) return { ok: false, error: 'half_client_pair', reason: half };
  const clientId = trimmed(sent.clientId);
  const clientSecret = trimmed(sent.clientSecret);
  if (clientId && clientSecret) {
    return {
      ok: true,
      clientId,
      clientSecret,
      tenant: trimmed(sent.tenantId) || microsoftTenant(env),
    };
  }
  const client = microsoftDeploymentClient(env);
  if (!client) {
    return {
      ok: false,
      error: 'no_microsoft_client',
      reason:
        microsoftDeploymentClientProblem(env) ??
        'This needs an Entra application and there is none: send clientId and clientSecret ' +
          'with the request, or set MICROSOFT_OAUTH_CLIENT_ID and ' +
          'MICROSOFT_OAUTH_CLIENT_SECRET on this deployment so every connection can share ' +
          "the owner's own registration (docs/microsoft-setup.md).",
    };
  }
  return { ok: true, clientId: client.clientId, clientSecret: client.clientSecret, tenant: client.tenant };
}
