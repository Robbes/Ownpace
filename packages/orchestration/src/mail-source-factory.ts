// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * One Graph mail source builder, two ways in (workplan 0041 T1/T2).
 *
 * `build-deps.ts` (self-host, reads a config file plus OAUTH2_* env vars) and
 * `build-deps-from-mapping.ts` (managed, reads decrypted credentials out of the
 * database) each carried their own copy of this construction. The copies were
 * byte-identical from the mailbox refusal onward — same refusal, same token
 * endpoint, same scope selection, same `GraphMailSource` options — and differed
 * only in where the three credential values came from.
 *
 * Hard rule 5 says the editions do not differ in behaviour, but two copies is
 * how they come to. A timeout, a retry, an auth quirk fixed in one is silently
 * not fixed in the other, and nothing fails. That is not hypothetical here: the
 * audit found a third concurrency default living in these files, and it took a
 * bespoke guard test to notice.
 *
 * WHAT IS SHARED, AND WHAT DELIBERATELY IS NOT. The construction is shared. The
 * *validation* is not: each caller checks presence itself and refuses in its own
 * vocabulary, because the vocabularies are genuinely different. Self-host names
 * the environment variable an operator has to set (`OAUTH2_CLIENT_ID`); managed
 * names the credential field the connection record is missing (`clientId`).
 * Unifying those would make one of them wrong — telling a managed operator to
 * set an env var that has no effect there is worse than a little duplication.
 * So the callers hand this function values that are already known to be present.
 */

import type { SourceConnector, ThrottleLimiter } from '@openmig/shared';
import { GraphMailSource, createTokenProvider } from '@openmig/connectors';

/**
 * Where the mailbox is, with no trace of whether a file or a database row said
 * so. Structural rather than tied to `MappingConfig['source']` or
 * `SourceConfig`, so both callers' narrowed types satisfy it as they stand.
 */
export interface GraphMailEndpoint {
  readonly tenantId: string;
  readonly baseUrl?: string;
  readonly mailbox?: string;
}

/**
 * What the Graph mail connector actually needs to mint a token.
 *
 * `clientId` is required because both callers have already refused without it.
 * Exactly one of `clientSecret` / `refreshToken` decides the flow, and both
 * callers have already refused when neither is present — so this type describes
 * a credential set that has passed validation, not a raw one.
 */
export interface ResolvedGraphCreds {
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly refreshToken?: string;
}

/**
 * Build the Graph mail source from an endpoint and already-validated credentials.
 *
 * Two flows, chosen by what is set: a refresh token selects the delegated
 * Mail.Read flow; otherwise a client secret selects client-credentials with
 * `.default` (application permissions — needs admin consent plus an Application
 * Access Policy, ADR-0006).
 */
export function buildGraphMailSourceFrom(
  endpoint: GraphMailEndpoint,
  creds: ResolvedGraphCreds,
  throttleLimiter?: ThrottleLimiter,
): SourceConnector {
  // A mailbox address is a /users/{address} read, and that is ONLY possible
  // under the client-credentials (application-permission) flow. With a refresh
  // token present the token provider asks for a delegated token, Graph answers
  // 403 on /users, and the operator is left reading an access-denied error
  // that says nothing about the cause. Refuse here instead, naming the fix
  // (hard rule 9).
  //
  // NOTE, carried over verbatim rather than fixed here: this names the env vars
  // `OAUTH2_REFRESH_TOKEN` / `OAUTH2_CLIENT_SECRET` even on the managed path,
  // where neither is read. Both copies said exactly this before the collapse, so
  // keeping it identical is what makes this commit a refactor rather than a
  // behaviour change. It is now wrong in ONE place instead of two, which is the
  // point — see workplan 0041.
  if (endpoint.mailbox !== undefined && creds.refreshToken) {
    throw new Error(
      `graph-mail source: mailbox "${endpoint.mailbox}" names another user's ` +
        'mailbox, which requires application permissions (the client-credentials ' +
        'flow), but OAUTH2_REFRESH_TOKEN is set — that is the DELEGATED flow and ' +
        'can only read the signed-in user (/me). Unset OAUTH2_REFRESH_TOKEN and ' +
        'set OAUTH2_CLIENT_SECRET, having granted admin consent — see ' +
        'docs/o365-application-access.md — or remove the mailbox to read /me.',
    );
  }

  const tokenProvider = createTokenProvider({
    tokenEndpoint: `https://login.microsoftonline.com/${endpoint.tenantId}/oauth2/v2.0/token`,
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    refreshToken: creds.refreshToken,
    tenantId: endpoint.tenantId,
    scope: creds.refreshToken
      ? 'https://graph.microsoft.com/Mail.Read offline_access'
      : 'https://graph.microsoft.com/.default',
  });

  return new GraphMailSource(tokenProvider, endpoint.tenantId, {
    baseUrl: endpoint.baseUrl,
    throttleLimiter,
    // Unset means /me, which is what every delegated mapping does. An address
    // makes this a /users/{address} read — the shared-mailbox path (0027 T0),
    // and it only works under the client-credentials flow above.
    ...(endpoint.mailbox === undefined ? {} : { mailbox: endpoint.mailbox }),
  });
}
