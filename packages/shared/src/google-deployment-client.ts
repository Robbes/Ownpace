// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The Google OAuth client this DEPLOYMENT owns, so nobody has to paste one
 * (ADR-0041; owner decision 2026-09-01, option B).
 *
 * ## What was wrong with pasting
 *
 * Every Google source made the same three demands: a client id, a client
 * secret, and a refresh token. The first two belong to the DEPLOYMENT — they
 * are the same values for every connection on the box, they are the owner's
 * own registered application, and typing them into a wizard once per
 * connection is transcription work with a secret in it. The refresh token is
 * the only one that is per-account.
 *
 * ## Why the connection stores NEITHER, rather than a copy of both
 *
 * The other design copies the deployment's client id and secret into every
 * connection's encrypted credential store at create time. It works today and
 * it makes rotation a migration: the owner changes one value at Google and
 * every stored connection still carries the old one, silently, until each is
 * edited. The owner chose this shape instead — *"B, store neither"* — so the
 * client is read at the moment it is used and a rotation is one `.env` edit
 * and a restart.
 *
 * The cost is real and worth naming: a connection is no longer
 * self-describing. Its credentials alone are not enough to mint a token, and
 * moving one to another deployment means that deployment needs a client too.
 * That is the trade the owner made, and it is the right way round for a
 * managed box where the client is the box's, not the row's.
 *
 * ## A CONNECTION'S OWN VALUES ALWAYS WIN
 *
 * This is a FALLBACK, never an override. A customer who registered their own
 * Google application and typed its credentials keeps using it — ADR-0041's
 * whole point is that owning a client is a real choice, and a deployment-wide
 * default that quietly replaced theirs would take it away.
 *
 * ## And it is never handed to a non-Google connection
 *
 * `clientId` and `clientSecret` are shared key names: Dropbox stores its App
 * key and App secret under exactly those, and Box its own client pair. A
 * fallback that filled them in for any connection missing them would hand
 * Google's application credentials to a Dropbox row — which fails at Dropbox
 * with an error naming nothing useful. So the caller gates on the connection
 * KIND, and this module refuses to be the place that forgets.
 */

/** The two variables, and nothing else this module reads. */
export interface GoogleClientEnv {
  readonly GOOGLE_OAUTH_CLIENT_ID?: string | undefined;
  readonly GOOGLE_OAUTH_CLIENT_SECRET?: string | undefined;
}

export interface GoogleDeploymentClient {
  readonly clientId: string;
  readonly clientSecret: string;
}

const trimmed = (value: string | undefined): string => (value ?? '').trim();

/**
 * The configured pair, or null when this deployment has none.
 *
 * BOTH OR NEITHER. A client id without a secret cannot mint a token, and
 * returning half a pair would turn a configuration mistake into a failure at
 * Google's token endpoint hours later. `googleDeploymentClientProblem` below
 * is what says so at the moment it matters.
 */
export function googleDeploymentClient(
  env: GoogleClientEnv = process.env,
): GoogleDeploymentClient | null {
  const clientId = trimmed(env.GOOGLE_OAUTH_CLIENT_ID);
  const clientSecret = trimmed(env.GOOGLE_OAUTH_CLIENT_SECRET);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * The sentence for a HALF-configured client, or null.
 *
 * Set them all or none — the rule `readNotifierConfig` already follows for
 * SMTP, and for its reason: somebody who set one of the two has plainly tried,
 * and answering them with the same silence as somebody who set neither hides
 * a typo behind a feature that simply looks absent.
 *
 * Never prints either VALUE. The secret is the point of the pair.
 */
export function googleDeploymentClientProblem(
  env: GoogleClientEnv = process.env,
): string | null {
  const clientId = trimmed(env.GOOGLE_OAUTH_CLIENT_ID);
  const clientSecret = trimmed(env.GOOGLE_OAUTH_CLIENT_SECRET);
  if (!clientId && !clientSecret) return null;
  if (clientId && clientSecret) return null;
  const missing = clientId ? 'GOOGLE_OAUTH_CLIENT_SECRET' : 'GOOGLE_OAUTH_CLIENT_ID';
  const set = clientId ? 'GOOGLE_OAUTH_CLIENT_ID' : 'GOOGLE_OAUTH_CLIENT_SECRET';
  return (
    `This deployment has ${set} set and ${missing} empty, so it has no usable Google ` +
    'client: a client id without its secret cannot exchange an authorization code. ' +
    `Set ${missing} in deploy/compose/.env and restart the API, or clear both and let ` +
    'each connection carry its own.'
  );
}

/**
 * Fill in the deployment's client where a GOOGLE connection has none.
 *
 * The credentials it is given win, key by key — see the header. The keys are
 * the shared trio's own names, which every Google factory reads
 * (`STORED_GMAIL_CREDENTIAL_NAMES` and its siblings are the same three
 * strings), so this needs no naming argument and cannot disagree with one.
 *
 * `isGoogle` is the caller's answer, not this module's: the kinds live in
 * orchestration and importing them here would point the dependency the wrong
 * way. What this refuses to do is decide it by guessing.
 */
export function withDeploymentGoogleClient(
  isGoogle: boolean,
  credentials: Record<string, string>,
  env: GoogleClientEnv = process.env,
): Record<string, string> {
  if (!isGoogle) return credentials;
  const configured = googleDeploymentClient(env);
  if (!configured) return credentials;
  const filled = { ...credentials };
  if (!trimmed(filled.clientId)) filled.clientId = configured.clientId;
  if (!trimmed(filled.clientSecret)) filled.clientSecret = configured.clientSecret;
  return filled;
}
