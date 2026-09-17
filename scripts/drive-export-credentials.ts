// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Where `drive-export-stability.ts` gets its credentials — both editions.
 *
 * THE DEFECT THIS EXISTS TO FIX. The measurement script was written for the
 * APPLIANCE (workplan 0042 T6), where `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
 * and `GOOGLE_REFRESH_TOKEN` genuinely are environment variables — that is the
 * appliance's whole credential model. It then read them straight off
 * `process.env` with no fallback.
 *
 * On MANAGED, two of those three live somewhere else:
 *
 *   - the client pair is the DEPLOYMENT's, under `GOOGLE_OAUTH_CLIENT_ID` and
 *     `GOOGLE_OAUTH_CLIENT_SECRET` — different names, same values, resolved
 *     everywhere else in this codebase through `googleDeploymentClient`;
 *   - the refresh token is per-connection and ENCRYPTED, obtained through
 *     Connect with Google and never handled by a person.
 *
 * So the one measurement that decides whether the export policies are usable
 * could not be run by the operator of a deployment that already held
 * everything it needed — and the workaround was pasting a decrypted refresh
 * token into a shell, which is the exact thing the secret store exists to
 * prevent. Every other Google door was folded onto the shared resolver in
 * September; `scripts/` was missed because nothing imports it.
 *
 * PURE ON PURPOSE. This decides WHICH route to take and says what is missing
 * when neither is open; the script does the database read for the `connection`
 * route. That keeps the part worth testing free of a pool, and it is why this
 * is a module rather than twenty lines inlined into a script nobody can test.
 *
 * AND THE SECOND DEFECT, 2026-09-17. The routes above were right and the
 * refusals still cost the owner three commands, because they named the
 * variables to set and not the fact that a managed box ALREADY HAS THEM SET, in
 * `deploy/compose/.env`, which this script does not read. Every refusal here
 * therefore says where the value already is and what does not reach it — not
 * only which name it goes under.
 */

import { googleDeploymentClient, googleDeploymentClientProblem } from '@openmig/shared';

/** The environment this reads. Named, so a test is a literal. */
export interface MeasurementEnv {
  readonly GOOGLE_CLIENT_ID?: string | undefined;
  readonly GOOGLE_CLIENT_SECRET?: string | undefined;
  readonly GOOGLE_REFRESH_TOKEN?: string | undefined;
  readonly GOOGLE_OAUTH_CLIENT_ID?: string | undefined;
  readonly GOOGLE_OAUTH_CLIENT_SECRET?: string | undefined;
  readonly DRIVE_CONNECTION_ID?: string | undefined;
  readonly DATABASE_URL?: string | undefined;
}

/**
 * How the run will authenticate.
 *
 * `env` is the appliance's way and stays the override on managed too: somebody
 * measuring a Drive that has no connection row yet must still be able to.
 * `connection` is managed's, and names a row rather than a secret.
 */
export type MeasurementCredentials =
  | {
      readonly route: 'env';
      readonly clientId: string;
      readonly clientSecret: string;
      readonly refreshToken: string;
    }
  | {
      readonly route: 'connection';
      readonly clientId: string;
      readonly clientSecret: string;
      readonly connectionId: string;
    }
  | { readonly route: 'refuse'; readonly reason: string };

const trimmed = (value: string | undefined): string => (value ?? '').trim();

/**
 * The client pair, or the sentence for why there is none.
 *
 * A RAW PAIR WINS, and half of one is refused rather than completed from the
 * deployment's. Falling through would run the measurement against a DIFFERENT
 * Google application than the operator named — the same half-a-pair hazard
 * `resolveGoogleClient` refuses at every other door, and worse here, because
 * the whole output of this script is a verdict about a specific application's
 * export behaviour.
 */
function clientPair(env: MeasurementEnv): { clientId: string; clientSecret: string } | string {
  const rawId = trimmed(env.GOOGLE_CLIENT_ID);
  const rawSecret = trimmed(env.GOOGLE_CLIENT_SECRET);
  if (rawId && rawSecret) return { clientId: rawId, clientSecret: rawSecret };
  if (rawId || rawSecret) {
    const missing = rawId ? 'GOOGLE_CLIENT_SECRET' : 'GOOGLE_CLIENT_ID';
    const set = rawId ? 'GOOGLE_CLIENT_ID' : 'GOOGLE_CLIENT_SECRET';
    return (
      `${set} is set and ${missing} is empty. A client id without its secret cannot mint a ` +
      `token, and completing the pair from this deployment's own client would measure a ` +
      `DIFFERENT Google application than the one you named — so this refuses instead. Set ` +
      `${missing}, or unset ${set} to use the deployment's client.`
    );
  }
  const deployment = googleDeploymentClient(env);
  if (deployment) return deployment;
  return (
    googleDeploymentClientProblem(env) ??
    'This needs a Google OAuth client and there is none. On a MANAGED deployment you already ' +
      'have one: GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are in ' +
      'deploy/compose/.env — the same pair the app uses for Connect with Google — but this ' +
      'script reads the environment and never reads that file, so load it first, from the ' +
      'repo root: `set -a; . deploy/compose/.env; set +a`. On an appliance there is no such ' +
      'file; set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET yourself.'
  );
}

/**
 * Which route this run takes, or why neither is open.
 *
 * Never returns or prints a secret VALUE — the connection route carries a row
 * id, and the script resolves the token from it through the same secret store
 * the API uses. The point is that nobody has to read one out by hand.
 */
export function resolveMeasurementCredentials(env: MeasurementEnv): MeasurementCredentials {
  const client = clientPair(env);
  if (typeof client === 'string') return { route: 'refuse', reason: client };

  const refreshToken = trimmed(env.GOOGLE_REFRESH_TOKEN);
  if (refreshToken) return { route: 'env', ...client, refreshToken };

  const connectionId = trimmed(env.DRIVE_CONNECTION_ID);
  if (connectionId) {
    // THE THIRD THING, and the one loading the file does NOT give you. The pair
    // and `SECRET_ENCRYPTION_KEY` are both in `deploy/compose/.env`; a usable
    // `DATABASE_URL` is not, because the one the containers run on names
    // `pgbouncer:6432` — a host that exists only inside the compose network.
    // Left to `new Pool(undefined)` this comes back as libpq's default-socket
    // error naming a user nobody set, so it is refused here with the derivation
    // instead.
    if (!trimmed(env.DATABASE_URL)) {
      return {
        route: 'refuse',
        reason:
          'DRIVE_CONNECTION_ID names a row in a database, and DATABASE_URL is empty so there ' +
          'is no database to look in. Loading deploy/compose/.env does not give you one: the ' +
          'stack runs on an in-container URL naming pgbouncer:6432, which does not resolve ' +
          'from the host. Ask compose which port Postgres is published on and build it — ' +
          '`docker compose -f deploy/compose/managed.yml port postgres 5432` — or set ' +
          'GOOGLE_REFRESH_TOKEN instead and skip the database entirely.',
      };
    }
    return { route: 'connection', ...client, connectionId };
  }

  return {
    route: 'refuse',
    reason:
      'This needs a Google account to read. Set DRIVE_CONNECTION_ID to the id of a Google ' +
      'connection and its refresh token is resolved through the secret store, so no secret ' +
      'is typed or copied; or set GOOGLE_REFRESH_TOKEN directly, which is how an appliance ' +
      'with no connection row does it.',
  };
}

/**
 * A route that can actually run — everything but a refusal.
 *
 * Named because `typeof ROUTE` in the script reads the DECLARED union rather
 * than the one narrowed by the `fail()` above it, so the function taking a
 * route needs the narrowed type by name.
 */
export type OpenMeasurementRoute = Exclude<MeasurementCredentials, { route: 'refuse' }>;
