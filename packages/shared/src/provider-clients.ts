// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Which OAuth applications this DEPLOYMENT carries, one fact per provider
 * (2026-09-02). `GET /api/provider-accounts` answers the same for Google
 * beside the account kind's faces; Dropbox is a single-face source with no
 * account kind, so its fact has nowhere to go there — and a wizard about to
 * offer *Connect with Dropbox* needs the answer before it can fold the App
 * key and secret away. One object, every provider that has a client, read
 * from the environment at the moment it is asked.
 *
 * Never the values: `deployment` says the pair is configured, and nothing
 * more leaves the process.
 */

import { dropboxDeploymentClient, type DropboxClientEnv } from './dropbox-deployment-client.ts';
import { googleDeploymentClient, type GoogleClientEnv } from './google-deployment-client.ts';
import type { ProviderClientSource } from './provider-accounts.ts';

export interface ProviderClientFacts {
  readonly google: ProviderClientSource;
  readonly dropbox: ProviderClientSource;
}

export function providerClientFacts(
  env: GoogleClientEnv & DropboxClientEnv = process.env,
): ProviderClientFacts {
  return {
    google: googleDeploymentClient(env) ? 'deployment' : 'connection',
    dropbox: dropboxDeploymentClient(env) ? 'deployment' : 'connection',
  };
}
