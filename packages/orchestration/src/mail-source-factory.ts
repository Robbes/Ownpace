// Copyright 2026 The Ownpace authors (Apache-2.0)

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

import { delegatedFlowCannotReadMailbox } from '@openmig/shared';
import type { SourceConnector, ThrottleLimiter } from '@openmig/shared';
import {
  GraphMailSource,
  ImapFlowSource,
  MailSourceWithGraphFallback,
  createTokenProvider,
  type ImapByteMeter,
} from '@openmig/connectors';

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
  /**
   * How to NAME these credentials when refusing, in words the operator can act
   * on. Not a credential itself, but determined by the same thing that supplies
   * them — a config file's operator sets environment variables, a managed
   * operator edits a connection record — so it travels with them.
   *
   * Defaults to the environment-variable names, which is what BOTH editions said
   * before this was parameterised.
   */
  readonly naming?: GraphCredentialNaming;
}

/**
 * The operator-facing names for the two credentials a refusal has to mention.
 *
 * Added 2026-08-14. The mailbox refusal below was written once and copied, so it
 * named `OAUTH2_REFRESH_TOKEN` / `OAUTH2_CLIENT_SECRET` on BOTH paths — including
 * the managed one, where neither variable is read and setting them changes
 * nothing. The collapse in workplan 0041 made that visible by putting it in one
 * place; this makes it correct. Hard rule 9 says name the fix, and a fix the
 * operator cannot apply is not one.
 */
export interface GraphCredentialNaming {
  readonly refreshToken: string;
  readonly clientSecret: string;
}

/** Self-host: the operator sets environment variables. */
export const ENV_CREDENTIAL_NAMES: GraphCredentialNaming = {
  refreshToken: 'OAUTH2_REFRESH_TOKEN',
  clientSecret: 'OAUTH2_CLIENT_SECRET',
};

/** Managed: the operator edits the connection's stored credentials. */
export const STORED_CREDENTIAL_NAMES: GraphCredentialNaming = {
  refreshToken: 'refreshToken',
  clientSecret: 'clientSecret',
};

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
  // (hard rule 9) — in the vocabulary of whichever edition is asking, since a
  // fix the operator cannot apply is not one. See GraphCredentialNaming.
  if (endpoint.mailbox !== undefined && creds.refreshToken) {
    const naming = creds.naming ?? ENV_CREDENTIAL_NAMES;
    throw delegatedFlowCannotReadMailbox({
      subject: 'graph-mail source',
      mailbox: endpoint.mailbox,
      refreshTokenField: naming.refreshToken,
      clientSecretField: naming.clientSecret,
      store: 'mailbox',
    });
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

// ---------------------------------------------------------------------------
// IMAP (workplan 0041 T2, second pair)
//
// The IMAP builders are ~112/113 lines and look like a matched pair by length,
// but only PART of them is a copy — the managed one does strictly more. What
// follows is the part that is genuinely identical in both; the rest stays with
// its caller, deliberately, and the reasons are recorded at each seam below.
// ---------------------------------------------------------------------------

/** Where the mailbox is, with no trace of whether a file or a row said so. */
export interface ImapEndpoint {
  readonly host: string;
  readonly port: number;
  readonly tls?: boolean;
  readonly tlsVerify?: boolean;
  /** Required, not optional: the connector's config type will not accept an absent user. */
  readonly user: string;
}

/**
 * The credential the connector will actually authenticate with.
 *
 * `authType` is passed IN rather than derived here, and that is deliberate: the
 * two editions derive it differently and a shared derivation would change one of
 * them. Self-host follows the mapping's DECLARED `auth.kind`; managed follows
 * which credential is actually PRESENT. Both are defensible — a config file
 * states intent, a credential store only has contents — and reconciling them is
 * a behaviour change, not a refactor. See workplan 0041.
 */
export interface ResolvedImapAuth {
  readonly accessToken?: string | undefined;
  readonly password?: string | undefined;
  readonly authType: 'XOAUTH2' | 'LOGIN';
  readonly tokenProvider?: ReturnType<typeof createTokenProvider> | undefined;
}

/**
 * Build the IMAP source from an endpoint and an already-resolved credential.
 *
 * The TLS defaults live here now, in one place, which is the point: they encode
 * an asymmetry argument that must not drift between editions.
 */
export function buildImapSourceFrom(
  endpoint: ImapEndpoint,
  auth: ResolvedImapAuth,
  throttleLimiter?: ThrottleLimiter,
  byteMeter?: ImapByteMeter,
): SourceConnector {
  const imapConfig = {
    host: endpoint.host,
    port: endpoint.port,
    // TLS unless the mapping says otherwise. Was `port === 993` -- a literal
    // port comparison, so an IMAPS server on any other port got a CLEARTEXT
    // socket. See ImapTlsSetting in packages/shared/src/config.ts for why the
    // default is true rather than a guess: being wrong this way costs a
    // connection error, being wrong the other way puts a password on the wire.
    tls: endpoint.tls ?? true,
    // Certificate verification rides beside the tls flag, same default, same
    // asymmetry argument -- see ImapTlsVerifySetting. Undefined here lets the
    // connector's own `?? true` be the single place the default lives.
    rejectUnauthorized: endpoint.tlsVerify,
    auth: {
      user: endpoint.user,
      accessToken: auth.accessToken,
      password: auth.password,
    },
    authType: auth.authType,
    tokenProvider: auth.tokenProvider,
    throttleLimiter,
    // The daily download meter (workplan 0090 T3) — the connector spends it
    // on every fetched body. Which endpoints get one, and with what ceiling,
    // is `imapDownloadPlan`'s decision, made by the caller who holds the
    // budget store; this seam only carries it through.
    byteMeter,
  };

  // **CUT OVER TO `imapflow` on 2026-08-06 (workplan 0032 T3).**
  //
  // What it rests on, so a future reader can judge it rather than trust it:
  // `imap-parity.integration.test.ts` ran `ImapSource` and `ImapFlowSource`
  // against the same seeded Stalwart mailbox and reported any disagreement as a
  // named field — folder set, per-folder path/name/specialUse, per message
  // messageId/keywords/receivedAt/size/sourceRef, the resume cursor, the
  // `unkeyable` count, and a bytewise body sample. The field that mattered is
  // `messageId`: it is what `naturalKeyForItem()` hashes, so a difference there
  // would re-copy every message on the next pass with every write succeeding.
  return new ImapFlowSource(imapConfig);
}

/**
 * Wrap an IMAP source in the Graph fallback when Graph credentials are also
 * available (workplan 0023 T3, ADR-0006).
 *
 * `tenantId` is the signal, since the Graph token endpoint needs it and plain
 * IMAP does not. Construction is LAZY inside the wrapper: a mapping whose IMAP
 * works never touches these credentials.
 *
 * The RULE for when to wrap is what matters here. It was written twice —
 * `tenantId && clientId && (clientSecret || refreshToken)`, once against
 * `process.env` and once against a credential record — and an edition that
 * changed its mind about, say, accepting a refresh token would have silently
 * disagreed with the other about when a mailbox gets a second chance.
 */
export function withGraphFallback(
  imap: SourceConnector,
  graph: {
    readonly tenantId?: string | undefined;
    readonly clientId?: string | undefined;
    readonly clientSecret?: string | undefined;
    readonly refreshToken?: string | undefined;
  },
  throttleLimiter?: ThrottleLimiter,
): SourceConnector {
  const { tenantId, clientId, clientSecret, refreshToken } = graph;
  if (!tenantId || !clientId || !(clientSecret || refreshToken)) return imap;

  return new MailSourceWithGraphFallback(imap, () =>
    buildGraphMailSourceFrom(
      { tenantId },
      { clientId, clientSecret, refreshToken },
      throttleLimiter,
    ),
  );
}
