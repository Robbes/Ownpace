// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Which OAuth applications this DEPLOYMENT carries, one fact per provider
 * (2026-09-02). `GET /api/provider-accounts` answers the same for an account
 * kind beside its faces; Dropbox is a single-face source with no account kind,
 * so its fact has nowhere to go there — and a wizard about to offer
 * *Connect with Dropbox* needs the answer before it can fold the App key and
 * secret away. One object, every provider that has a client, read from the
 * environment at the moment it is asked.
 *
 * Never the values: `deployment` says the pair is configured, and nothing
 * more leaves the process.
 *
 * ## Derived from a list, because this was a two-provider object
 *
 * Microsoft arrived in workplan 0114 and this file did not notice. Nothing
 * broke loudly: the web reads `providerClients?.[grantProvider]`, an absent
 * key is `undefined`, `undefined !== 'deployment'`, and the effect is that
 * **the client pair never folds away** — a deployment that carries the Entra
 * application would still have demanded a client id and secret from every
 * customer, and the button beside them would have been the one thing that
 * made the demand unnecessary.
 *
 * A hand-written object with one entry per provider is the fan-out family in
 * its quietest form: adding a provider is not a compile error, it is a fact
 * silently answered "no". So `GRANT_PROVIDERS` is the list, the probes are a
 * table over it, and the facts are derived — a fourth provider is one row.
 */

import { dropboxDeploymentClient, type DropboxClientEnv } from './dropbox-deployment-client.ts';
import { googleDeploymentClient, type GoogleClientEnv } from './google-deployment-client.ts';
import {
  microsoftDeploymentClient,
  type MicrosoftClientEnv,
} from './microsoft-deployment-client.ts';
import type { ProviderClientSource } from './provider-accounts.ts';

/**
 * Every provider whose consent a screen can offer.
 *
 * The same names the credential descriptors use in their `consent` field, and
 * that is not a coincidence to be preserved by hand:
 * `scripts/a-consent-nobody-can-answer.unit.test.ts` pairs the two, because a
 * descriptor naming a provider this list has never heard of is a button whose
 * fold silently never happens.
 */
export const GRANT_PROVIDERS = ['google', 'dropbox', 'microsoft'] as const;
export type GrantProvider = (typeof GRANT_PROVIDERS)[number];

export type ProviderClientEnv = GoogleClientEnv & DropboxClientEnv & MicrosoftClientEnv;

/** Does this deployment carry that provider's application? One probe per row. */
const DEPLOYMENT_CLIENTS: Readonly<
  Record<GrantProvider, (env: ProviderClientEnv) => boolean>
> = {
  google: (env) => googleDeploymentClient(env) !== null,
  dropbox: (env) => dropboxDeploymentClient(env) !== null,
  microsoft: (env) => microsoftDeploymentClient(env) !== null,
};

export type ProviderClientFacts = Readonly<Record<GrantProvider, ProviderClientSource>>;

export function providerClientFacts(env: ProviderClientEnv = process.env): ProviderClientFacts {
  return Object.fromEntries(
    GRANT_PROVIDERS.map((provider) => [
      provider,
      DEPLOYMENT_CLIENTS[provider](env) ? 'deployment' : 'connection',
    ]),
  ) as ProviderClientFacts;
}
