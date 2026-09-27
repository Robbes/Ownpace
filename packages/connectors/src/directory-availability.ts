// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Can this worker enumerate a tenant's directory at all? (workplan 0028 T2)
 *
 * Three preconditions, each failing for a different reason with a different
 * fix, and the whole value of this function is telling them apart. The
 * detector's output when it cannot look is a sentence somebody reads in a log
 * and acts on; "directory unavailable" would send them hunting.
 *
 * It lives in connectors, beside `graph-scope.ts` and `graph-directory.ts`,
 * because BOTH editions ask the question and neither should own the other's
 * copy — the appliance and the managed worker each wire a detector, and two
 * copies of this rule with a comment asking them to match is the arrangement
 * that eventually stops matching.
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
 * The one Microsoft kind that carries an administrator's app registration,
 * and so the one that can ever hold application permissions (0141 T11).
 */
const APPLICATION_REGISTRATION_KIND = 'o365';

/**
 * WHY A MICROSOFT ACCOUNT'S SOURCE CANNOT READ A DIRECTORY (workplan 0141 T11).
 *
 * A `microsoft` connection holds one person's refresh token. Before this, the
 * detectors and the permission report looked for `kind = 'o365'` alone, found
 * nothing, and told a tenant whose source was exactly that account that it had
 * no Microsoft 365 source connection. The true reason is the grant, and it
 * holds whatever this deployment's environment says. A personal account has
 * no organisation at all, which is why the administrator is conditional.
 */
export const MICROSOFT_ACCOUNT_IS_DELEGATED =
  "this source is a Microsoft account, connected with one person's own sign-in. That grant is " +
  "delegated: it reads the signed-in person's own data and nothing of anyone else's. The " +
  "directory, other people's mailboxes and calendar sharing are not read with it; in an " +
  "organisation they need an administrator's app registration with application permissions. " +
  'Note them by hand before cutover';

/**
 * @param graphTenantId the O365 tenant on the source connection, if any.
 * @param sourceKind the stored kind of the Microsoft source the caller found in
 *   the ledger: `o365`, or an account kind whose mail face is Graph
 *   (`microsoftSourceKinds()` in orchestration). Every kind but `o365` is a
 *   delegated grant. The appliance's mapping files name no kind, and pass none.
 */
export function directoryAvailability(
  env: DirectoryEnv,
  graphTenantId: string | undefined,
  sourceKind?: string,
): DirectoryAvailability {
  if (sourceKind !== undefined && sourceKind !== APPLICATION_REGISTRATION_KIND) {
    // First, before the tenant: an account row stores no directory of its own,
    // so the check below would call it "no Microsoft 365 source connection".
    return { ok: false, reason: MICROSOFT_ACCOUNT_IS_DELEGATED };
  }

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
