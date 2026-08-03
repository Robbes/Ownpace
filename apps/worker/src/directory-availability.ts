// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Can this worker enumerate a tenant's directory at all? (workplan 0028 T2)
 *
 * Three preconditions, each failing for a different reason with a different
 * fix, and the whole value of this function is telling them apart. The
 * detector's output when it cannot look is a sentence somebody reads in a log
 * and acts on; "directory unavailable" would send them hunting.
 *
 * The permission mode is DERIVED from the credentials rather than declared:
 * a refresh token means the delegated flow, which cannot read `/users`
 * whatever a config flag claims. A declared flag can disagree with reality;
 * the credentials cannot.
 */

export interface DirectoryEnv {
  readonly OAUTH2_CLIENT_ID?: string | undefined;
  readonly OAUTH2_CLIENT_SECRET?: string | undefined;
  readonly OAUTH2_REFRESH_TOKEN?: string | undefined;
}

export type DirectoryAvailability =
  /** Application permissions are available; the directory can be read. */
  | { readonly ok: true; readonly clientId: string; readonly clientSecret: string }
  /** It cannot be read, and this is the reason to carry into the queue. */
  | { readonly ok: false; readonly reason: string };

const DOC = 'see docs/o365-application-access.md';

/**
 * @param graphTenantId the O365 tenant on the source connection, if any.
 */
export function directoryAvailability(
  env: DirectoryEnv,
  graphTenantId: string | undefined,
): DirectoryAvailability {
  if (!graphTenantId) {
    // Not a failure — an IMAP-only or DAV-only tenant is a legitimate
    // configuration. It is simply not one whose directory can be listed, and
    // that is different from "no new mailboxes".
    return {
      ok: false,
      reason:
        'this tenant has no Microsoft 365 source connection, and only Graph can ' +
        'enumerate a directory',
    };
  }

  if (env.OAUTH2_REFRESH_TOKEN) {
    // The delegated flow. Checked BEFORE the client secret, because a stack
    // carrying both is configured for delegated access and would otherwise be
    // told it was fine and then get a 403 from Graph.
    return {
      ok: false,
      reason:
        'the worker is configured for the DELEGATED flow (OAUTH2_REFRESH_TOKEN is set), ' +
        `which can only read the signed-in mailbox — ${DOC}`,
    };
  }

  const clientId = env.OAUTH2_CLIENT_ID;
  const clientSecret = env.OAUTH2_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    // Named individually: "credentials are missing" leaves an operator
    // checking both when only one is absent.
    const missing = [
      ...(clientId ? [] : ['OAUTH2_CLIENT_ID']),
      ...(clientSecret ? [] : ['OAUTH2_CLIENT_SECRET']),
    ].join(' and ');
    return {
      ok: false,
      reason:
        `${missing} ${missing.includes('and') ? 'are' : 'is'} not set, so no application ` +
        `token can be obtained — ${DOC}`,
    };
  }

  return { ok: true, clientId, clientSecret };
}
