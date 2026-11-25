// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE PERSON'S OWN MICROSOFT PROFILE, for Finish (workplan 0171 T10, §7.2).
 *
 * Finish lists the addresses that receive mail from `/me`, which needs
 * `User.Read`: an identity scope every new Microsoft consent asks
 * (`MICROSOFT_IDENTITY_SCOPES`, the owner's D7 (a)). It lives here, apart from
 * `graph-domain-source-factory.ts`, because that file is the sync side and no
 * sync path asks an identity scope (`a-consent-that-asks-for-a-different-scope`).
 */

import {
  ENV_GRAPH_FIELD_NAMING,
  graphTokenProviderWithScope,
  type GraphDomainEndpoint,
  type GraphEntraCredsAsFound,
  type GraphFieldNaming,
} from './graph-domain-source-factory.ts';

/** The delegated scope for `/me`; application permissions use `.default`. */
const PROFILE_SCOPE = 'https://graph.microsoft.com/User.Read offline_access';

/**
 * A Graph token for reading the mailbox's own user (workplan 0171 T10, §7.2):
 * `User.Read` under the delegated flow, for `/me`; `.default` under
 * application permissions, for `/users/{mailbox}`, which `User.Read.All`
 * answers. The same registration and refusals as the Graph faces in
 * `graph-domain-source-factory.ts`.
 */
export function graphProfileTokenFrom(
  endpoint: GraphDomainEndpoint,
  creds: GraphEntraCredsAsFound,
  naming: GraphFieldNaming = ENV_GRAPH_FIELD_NAMING,
): () => Promise<string> {
  const provider = graphTokenProviderWithScope(PROFILE_SCOPE, 'Microsoft profile read', endpoint, creds, naming);
  return async () => (await provider.getToken()).accessToken;
}
