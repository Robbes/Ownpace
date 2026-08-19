// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * A credential we forgot but never revoked is not forgotten (workplan 0085 T4a).
 *
 * ## The gap
 *
 * `purgeTenant` deletes the `connection` row, and with it our encrypted copy of
 * the customer's credential. That is our copy. **The token at the provider is
 * still live.** Nothing about deleting a row tells Google that the refresh
 * token it issued should stop working, and a refresh token that nobody holds is
 * still a refresh token that works if anybody ever does.
 *
 * ## What this turned out to be, which is not what it looked like
 *
 * The task read like "call revoke on each provider". It is not, because **most
 * of the providers here have no revocation we can call**, and the useful work
 * was finding out which. Stated as a table, because a table is checkable and a
 * paragraph is not:
 *
 * | Connection kind | What we actually hold | Can we revoke it? |
 * | --- | --- | --- |
 * | `gmail`, `google_drive`, `google_calendar`, `google_contacts` | the customer's refresh token | **Yes.** Google publishes a revocation endpoint, and revoking the refresh token invalidates the access tokens derived from it. |
 * | `o365` | our client secret (application flow), or the customer's delegated refresh token | **No.** Microsoft identity platform has no OAuth revocation endpoint. Sessions are revoked by the user withdrawing consent, or by an admin through Graph with a directory permission this deployment deliberately does not hold. |
 * | `dropbox` | the customer's refresh token | **No.** Dropbox's token-revoke call disables the *access* token presented with it; the app link that mints refresh tokens is removed by the customer in their own account. |
 * | `box` | our client id and secret (client-credentials grant) | **Nothing of theirs to revoke.** CCG mints short-lived tokens from OUR secret; there is no long-lived customer credential in play, and deleting our copy is the whole story. |
 * | `imap`, `jmap`, `caldav`, `carddav`, `webdav`, `nextcloud`, `proton`, `soverin`, `selfhosted_mail` | a password or app password | **No.** A password is revoked by changing it, which only the account holder can do. |
 *
 * So the outcome for most kinds is `unsupported`, **with the reason**, and the
 * receipt says that rather than implying a revocation happened. This is the
 * same rule the rest of this repository keeps landing on: say what actually
 * happened. A row of green "revoked" ticks, four of which were nothing, would
 * be worse than no revocation at all, because it would stop the customer doing
 * the one thing that does work.
 *
 * ## And this is why T4b exists
 *
 * Every `unsupported` row above has the same answer: the customer withdraws it
 * in their own console. `standing-grants.ts` already names those consoles,
 * bilingually, for the kinds a tenant actually used. **This module and that one
 * are two halves of one honest sentence** — we revoked what we could, we
 * deleted our copy of the rest, and here is what only you can remove.
 *
 * ## Never a reason to refuse the erasure
 *
 * Revocation is attempted before the purge and is **best effort**. A provider
 * being down must not stop somebody being forgotten — so a failure is recorded
 * as a failure and the purge proceeds. `failed` in the receipt means exactly
 * what it says: we deleted our copy and could not revoke it, and the credential
 * may still be live at the provider until the customer removes it.
 */

import type { RefusalLocale } from './credential-refusals.ts';

/** What happened when we tried to revoke one connection's credential. */
export type RevocationStatus =
  /** The provider accepted a revocation and the credential is dead. */
  | 'revoked'
  /** We tried, and it did not work. The credential may still be live. */
  | 'failed'
  /** This provider has no revocation we can call. The reason says which. */
  | 'unsupported'
  /** There was no credential stored to revoke — nothing to do, and not a failure. */
  | 'no_credential';

export interface RevocationOutcome {
  /** The `connection.kind` this is about. */
  readonly kind: string;
  readonly status: RevocationStatus;
  /**
   * Why, in one clause. Present on every status except `revoked`, where the
   * status is the whole story.
   */
  readonly reason?: string;
}

/** What a kind's credential is, and whether anything can be done about it. */
export interface RevocationCapability {
  /** Whether an attempt is worth making at all. */
  readonly revocable: boolean;
  /** Stated in the module docs' table; repeated here so code can quote it. */
  readonly reason: string;
}

/**
 * The capability table, keyed by `connection.kind`.
 *
 * **An unknown kind is `unsupported`, never `revoked`.** A kind added later
 * without a decision here shows up in the receipt as one we do not know how to
 * revoke, which is true and prompts the decision — rather than inheriting a
 * silent "nothing to do" that reads as success.
 */
export const REVOCATION_CAPABILITIES: Readonly<Record<string, RevocationCapability>> = {
  gmail: { revocable: true, reason: 'Google revocation endpoint; revokes the refresh token and its access tokens' },
  google_drive: { revocable: true, reason: 'Google revocation endpoint; revokes the refresh token and its access tokens' },
  google_calendar: { revocable: true, reason: 'Google revocation endpoint; revokes the refresh token and its access tokens' },
  google_contacts: { revocable: true, reason: 'Google revocation endpoint; revokes the refresh token and its access tokens' },

  o365: {
    revocable: false,
    reason:
      'Microsoft identity platform publishes no OAuth revocation endpoint. Access is withdrawn by removing the app consent, which only the customer or their admin can do.',
  },
  dropbox: {
    revocable: false,
    reason:
      "Dropbox's revoke call disables the access token presented with it, not the app link that mints refresh tokens. The customer removes the linked app in their own account.",
  },
  box: {
    revocable: false,
    reason:
      'Box client-credentials tokens are minted from our own client secret and are short-lived; there is no long-lived customer credential to revoke. Deleting our copy is the whole story.',
  },
} as const;

/** Password-shaped kinds: nothing to revoke, and one shared reason. */
const PASSWORD_KINDS = [
  'imap',
  'jmap',
  'caldav',
  'carddav',
  'webdav',
  'nextcloud',
  'proton',
  'soverin',
  'selfhosted_mail',
] as const;

const PASSWORD_REASON =
  'This connection authenticates with a password or app password. A password is revoked by changing it, which only the account holder can do.';

export function revocationCapability(kind: string): RevocationCapability {
  const known = REVOCATION_CAPABILITIES[kind];
  if (known) return known;
  if ((PASSWORD_KINDS as readonly string[]).includes(kind)) {
    return { revocable: false, reason: PASSWORD_REASON };
  }
  return {
    revocable: false,
    reason: `No revocation is implemented for connection kind '${kind}'. Our copy of the credential was deleted; anything the provider still honours must be withdrawn by the customer.`,
  };
}

/**
 * The port. One method, and it never throws — a revocation that threw would
 * have to be caught by the purge anyway, and a caller that forgot would stop an
 * erasure because a provider was down.
 */
export interface TokenRevoker {
  revoke(input: {
    readonly kind: string;
    readonly credentials: Readonly<Record<string, string>>;
  }): Promise<RevocationOutcome>;
}

/**
 * A revoker that attempts nothing and says so.
 *
 * For the self-host appliance and for tests: it produces the same shaped
 * receipt as the real one, so nothing downstream has to special-case its
 * absence — the receipt just says, truthfully, that no attempt was made.
 */
export const NO_REVOCATION: TokenRevoker = {
  revoke: async ({ kind }) => ({
    kind,
    status: 'unsupported',
    reason: 'This deployment does not attempt provider-side revocation.',
  }),
};

/** How many of each status, for the log line and the receipt's summary. */
export function summariseRevocations(
  outcomes: readonly RevocationOutcome[],
): Readonly<Record<RevocationStatus, number>> {
  const summary: Record<RevocationStatus, number> = {
    revoked: 0,
    failed: 0,
    unsupported: 0,
    no_credential: 0,
  };
  for (const o of outcomes) summary[o.status] += 1;
  return summary;
}

/**
 * What the customer is told, in their language.
 *
 * The `failed` sentence is the one that matters and the one that is tempting to
 * soften. It must not be softened: somebody who reads "we could not revoke it"
 * goes and removes the access themselves, and somebody who reads a reassuring
 * paraphrase does not.
 */
export function revocationSummaryText(
  outcomes: readonly RevocationOutcome[],
  locale: RefusalLocale,
): string {
  const s = summariseRevocations(outcomes);
  const couldNot = s.failed + s.unsupported;

  if (outcomes.length === 0) {
    return locale === 'nl'
      ? 'Er waren geen opgeslagen inloggegevens om in te trekken.'
      : 'There were no stored credentials to revoke.';
  }

  const parts: string[] = [];
  if (s.revoked > 0) {
    parts.push(
      locale === 'nl'
        ? `Wij hebben ${s.revoked} inloggegeven(s) bij de aanbieder ingetrokken.`
        : `We revoked ${s.revoked} credential(s) at the provider.`,
    );
  }
  if (couldNot > 0) {
    parts.push(
      locale === 'nl'
        ? `Voor ${couldNot} andere hebben wij onze kopie verwijderd maar konden wij de toegang niet zelf intrekken — die moet u zelf in uw eigen account intrekken.`
        : `For ${couldNot} other(s) we deleted our copy but could not revoke the access ourselves — you must withdraw those in your own account.`,
    );
  }
  if (s.no_credential > 0) {
    parts.push(
      locale === 'nl'
        ? `Voor ${s.no_credential} waren geen inloggegevens opgeslagen.`
        : `For ${s.no_credential} there were no stored credentials.`,
    );
  }
  return parts.join(' ');
}
