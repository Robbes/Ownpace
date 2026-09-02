// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The Dropbox app this DEPLOYMENT owns, so nobody has to paste one
 * (2026-09-02, the owner: "add the grant button for Dropbox, similar to how
 * we now have Google").
 *
 * Google's module (`google-deployment-client.ts`) explains the shape and
 * the trade, and every word of it holds here: the App key and App secret are
 * the deployment's, the refresh token is the account's; the connection
 * stores neither half of the pair (owner decision 2026-09-01, option B); a
 * connection's own pair always wins; both or neither; and the deployment's
 * pair is handed only to a DROPBOX connection, because `clientId` and
 * `clientSecret` are shared key names and a Google row must never be given
 * Dropbox's application.
 *
 * Dropbox's own words are "App key" and "App secret" (its App Console); the
 * variables say so, the wire says `client_id`/`client_secret`, and the stored
 * credential keeps the shared trio names.
 */

export interface DropboxClientEnv {
  readonly DROPBOX_OAUTH_CLIENT_ID?: string | undefined;
  readonly DROPBOX_OAUTH_CLIENT_SECRET?: string | undefined;
}

export interface DropboxDeploymentClient {
  readonly clientId: string;
  readonly clientSecret: string;
}

const trimmed = (value: string | undefined): string => (value ?? '').trim();

/** The configured pair, or null when this deployment has none. BOTH OR NEITHER. */
export function dropboxDeploymentClient(
  env: DropboxClientEnv = process.env,
): DropboxDeploymentClient | null {
  const clientId = trimmed(env.DROPBOX_OAUTH_CLIENT_ID);
  const clientSecret = trimmed(env.DROPBOX_OAUTH_CLIENT_SECRET);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** The sentence for a HALF-configured app, or null. Never prints a value. */
export function dropboxDeploymentClientProblem(
  env: DropboxClientEnv = process.env,
): string | null {
  const clientId = trimmed(env.DROPBOX_OAUTH_CLIENT_ID);
  const clientSecret = trimmed(env.DROPBOX_OAUTH_CLIENT_SECRET);
  if (!clientId && !clientSecret) return null;
  if (clientId && clientSecret) return null;
  const missing = clientId ? 'DROPBOX_OAUTH_CLIENT_SECRET' : 'DROPBOX_OAUTH_CLIENT_ID';
  const set = clientId ? 'DROPBOX_OAUTH_CLIENT_ID' : 'DROPBOX_OAUTH_CLIENT_SECRET';
  return (
    `This deployment has ${set} set and ${missing} empty, so it has no usable Dropbox ` +
    'app: an App key without its App secret cannot exchange an authorization code. ' +
    `Set ${missing} in deploy/compose/.env and restart the API, or clear both and let ` +
    'each connection carry its own.'
  );
}

/**
 * Fill in the deployment's app where a DROPBOX connection has none. The
 * credentials it is given win, key by key; `isDropbox` is the caller's
 * answer, gated on the connection kind, never guessed here.
 */
export function withDeploymentDropboxClient(
  isDropbox: boolean,
  credentials: Record<string, string>,
  env: DropboxClientEnv = process.env,
): Record<string, string> {
  if (!isDropbox) return credentials;
  const configured = dropboxDeploymentClient(env);
  if (!configured) return credentials;
  const filled = { ...credentials };
  if (!trimmed(filled.clientId)) filled.clientId = configured.clientId;
  if (!trimmed(filled.clientSecret)) filled.clientSecret = configured.clientSecret;
  return filled;
}

/** The sentence for HALF an App-key pair on a Dropbox connection, or null. */
export function halfDropboxClientPairProblem(
  credentials: {
    readonly clientId?: string | undefined;
    readonly clientSecret?: string | undefined;
  },
  env: DropboxClientEnv = process.env,
): string | null {
  if (dropboxDeploymentClient(env) === null) return null;
  const hasId = trimmed(credentials.clientId) !== '';
  const hasSecret = trimmed(credentials.clientSecret) !== '';
  if (hasId === hasSecret) return null;
  const sent = hasId ? 'clientId' : 'clientSecret';
  const missing = hasId ? 'clientSecret' : 'clientId';
  return (
    `${sent} was sent without ${missing}. A Dropbox app is both halves or neither: send ` +
    "both to use your own app, or neither to use this deployment's. The deployment's " +
    `${missing} does not belong to the ${sent} you sent, and Dropbox would refuse the ` +
    'pair at its token endpoint — hours later, from a sync pass.'
  );
}

export type DropboxClientResolution =
  | { readonly ok: true; readonly clientId: string; readonly clientSecret: string }
  | {
      readonly ok: false;
      readonly error: 'half_client_pair' | 'no_dropbox_client';
      readonly reason: string;
    };

/** The app a Dropbox request may use: the caller's WHOLE pair, else the deployment's, else a refusal. */
export function resolveDropboxClient(
  sent: {
    readonly clientId?: string | undefined;
    readonly clientSecret?: string | undefined;
  },
  env: DropboxClientEnv = process.env,
): DropboxClientResolution {
  const half = halfDropboxClientPairProblem(sent, env);
  if (half) return { ok: false, error: 'half_client_pair', reason: half };
  const clientId = trimmed(sent.clientId);
  const clientSecret = trimmed(sent.clientSecret);
  const own = clientId && clientSecret ? { clientId, clientSecret } : null;
  const client = own ?? dropboxDeploymentClient(env);
  if (!client) {
    return {
      ok: false,
      error: 'no_dropbox_client',
      reason:
        dropboxDeploymentClientProblem(env) ??
        'This needs a Dropbox app and there is none: send clientId and clientSecret (the App ' +
          'key and App secret) with the request, or set DROPBOX_OAUTH_CLIENT_ID and ' +
          'DROPBOX_OAUTH_CLIENT_SECRET on this deployment so every connection can share the ' +
          "owner's own app (docs/dropbox-setup.md).",
    };
  }
  return { ok: true, clientId: client.clientId, clientSecret: client.clientSecret };
}
