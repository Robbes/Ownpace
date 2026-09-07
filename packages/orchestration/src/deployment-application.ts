// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHICH DEPLOYMENT APPLICATION A STORED ROW LEANS ON (ADR-0041).
 *
 * A connection made with a grant button stores the refresh token and nothing
 * else: the OAuth application belongs to the DEPLOYMENT, and its id and secret
 * live in `GOOGLE_`/`DROPBOX_`/`MICROSOFT_OAUTH_CLIENT_ID|SECRET`. So every
 * path that reaches the provider has to put the pair back, and shared gives
 * one filler per provider to do it with.
 *
 * ## Why the callers stopped being trusted to nest them
 *
 * Because two of them did, and one of them dropped a provider. This was the
 * seam every sync pass and every discovery goes through:
 *
 *     withDeploymentDropboxClient(
 *       kind === DROPBOX_CONNECTION_KIND,
 *       withDeploymentGoogleClient(isGoogleGrantKind(kind), connectionCreds),
 *     )
 *
 * Microsoft arrived in workplan 0114, three fillers existed, and this nesting
 * still had the two it was born with — so a `microsoft` row that took the
 * grant button was built with no `clientId` at all, and every one of its five
 * Graph faces refused *"clientId is not set (the Entra app registration id)"*
 * from inside the pass. The probe and the qualification both nested all three,
 * which is what made it read as **Test passed, the run refused**: the exact
 * inverse of the lie `probe-connection.ts` exists to prevent, on a connection
 * whose card showed 25 messages and 3.8 GB measured off Graph minutes earlier.
 *
 * A hand-nested chain is the fan-out family in its quietest form — adding a
 * provider is not a compile error, it is a fill that silently does not happen.
 * `source-face-builders.ts` and `provider-clients.ts` each open with that
 * sentence; this is the third place it has cost a day. So the fillers are a
 * TABLE over `GRANT_PROVIDERS`, typed `Record<GrantProvider, …>`: a fourth
 * provider added to that list fails to compile here until somebody says which
 * kinds it claims and which filler answers for it.
 *
 * ## The kind gate is load-bearing, not tidiness
 *
 * `clientId` and `clientSecret` are SHARED KEY NAMES. Dropbox stores its App
 * key and App secret under exactly those, and Box its own pair. Filling every
 * row that lacked them would hand Google's application to a Dropbox
 * connection, which then fails at Dropbox with an error naming nothing useful.
 * Each row therefore names the kinds it claims, and a kind no row claims is
 * returned untouched — which is what every protocol connection is and must
 * remain.
 *
 * ## What is deliberately NOT routed through here
 *
 * The three `qualify*` functions each call their own filler directly. Each is
 * already gated on ONE kind by the guard at the top of it, so there is no
 * fan-out in them to get wrong — and `account-qualification.ts` is a
 * dependency of this file, so reading it back would be a cycle. What this
 * unifies is the two paths that see EVERY kind and must therefore agree: the
 * build path and the probe path.
 */

import {
  GRANT_PROVIDERS,
  withDeploymentDropboxClient,
  withDeploymentGoogleClient,
  withDeploymentMicrosoftClient,
  type GrantProvider,
  type ProviderClientEnv,
} from '@openmig/shared';
import { GOOGLE_GRANT_KINDS } from './account-qualification.ts';
import { DROPBOX_CONNECTION_KIND } from './dropbox-source-factory.ts';
import { MICROSOFT_ACCOUNT_KIND } from './graph-domain-source-factory.ts';

/**
 * The connection kinds whose credentials ARE that provider's OAuth
 * application — the answer to "is this row one of ours", per provider.
 *
 * Exported because it is the honest input to a guard: a test that invented its
 * own kind per provider would prove that a fiction is filled.
 */
export const DEPLOYMENT_APPLICATION_KINDS: Readonly<
  Record<GrantProvider, ReadonlyArray<string>>
> = {
  // Four single-purpose rows and the account kind, all carrying a Google
  // OAuth client — the same list the qualification exchanges tokens for.
  google: GOOGLE_GRANT_KINDS,
  dropbox: [DROPBOX_CONNECTION_KIND],
  microsoft: [MICROSOFT_ACCOUNT_KIND],
};

/** The filler that puts that provider's application back, from shared. */
const DEPLOYMENT_APPLICATION_FILL: Readonly<
  Record<
    GrantProvider,
    (isThatProvider: boolean, creds: Record<string, string>, env: ProviderClientEnv) => Record<string, string>
  >
> = {
  google: withDeploymentGoogleClient,
  dropbox: withDeploymentDropboxClient,
  microsoft: withDeploymentMicrosoftClient,
};

/** Which provider's application this connection kind leans on, if any. */
export function grantProviderForKind(kind: string): GrantProvider | undefined {
  return GRANT_PROVIDERS.find((provider) =>
    DEPLOYMENT_APPLICATION_KINDS[provider].includes(kind),
  );
}

/**
 * Fill in the deployment's application for whichever provider this row is.
 *
 * The credentials given always win, key by key — ADR-0041's rule: a customer
 * who registered their own application keeps using it, and a deployment-wide
 * default that quietly replaced theirs would take that choice away. A row
 * whose kind no provider claims, or a deployment that configured no
 * application, comes back exactly as it went in.
 */
export function withDeploymentApplication(
  kind: string,
  credentials: Record<string, string>,
  env: ProviderClientEnv = process.env,
): Record<string, string> {
  const provider = grantProviderForKind(kind);
  if (!provider) return credentials;
  return DEPLOYMENT_APPLICATION_FILL[provider](true, credentials, env);
}
