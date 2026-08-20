// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The revocation we can actually perform (workplan 0085 T4a).
 *
 * `@openmig/shared`'s `token-revocation.ts` holds the decision — which
 * connection kinds have a revocation we can call, and the reason for each one
 * that does not. This is the half that talks to a provider, and today that
 * means **Google and nothing else**. See that module's table for why: Microsoft
 * publishes no revocation endpoint, Dropbox's call disables the access token
 * rather than the app link, Box's client-credentials grant has no long-lived
 * customer credential in it, and everything else authenticates with a password
 * only its owner can change.
 *
 * ## Why exactly one provider is implemented, deliberately
 *
 * The receipt this feeds says `revoked` or it says why not, and a customer acts
 * on the difference: `revoked` means done, anything else means *go and remove
 * this yourself*. So a revocation that silently did nothing while reporting
 * success is worse than no revocation at all — it would stop the customer doing
 * the one thing that works.
 *
 * Google's revocation endpoint is stable, documented, and takes the refresh
 * token we already hold. The others are not "not done yet"; they are provider
 * facts recorded in the table. If one changes, adding it here is a function and
 * a row.
 *
 * ## Never throws
 *
 * Every failure becomes a `failed` outcome with the reason. A revoker that
 * threw would be caught by the purge anyway — and a caller that forgot would
 * stop somebody being forgotten because a provider was down, which is the wrong
 * way round.
 */

import {
  revocationCapability,
  type RevocationOutcome,
  type TokenRevoker,
} from '@openmig/shared';
import type { TokenFetch } from './google-token-provider.ts';

/**
 * Google's OAuth 2.0 revocation endpoint.
 *
 * Revoking a REFRESH token invalidates the access tokens derived from it, which
 * is why the refresh token is the one to send: revoking an access token alone
 * would leave the thing that mints more of them untouched.
 */
export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

const GOOGLE_KINDS = new Set(['gmail', 'google_drive', 'google_calendar', 'google_contacts']);

export interface HttpTokenRevokerOptions {
  readonly fetchImpl?: TokenFetch;
  readonly googleRevokeEndpoint?: string;
}

const defaultFetch: TokenFetch = (url, init) =>
  fetch(url, { method: init.method, headers: { ...init.headers }, body: init.body });

export class HttpTokenRevoker implements TokenRevoker {
  private readonly fetchImpl: TokenFetch;
  private readonly googleEndpoint: string;

  constructor(options: HttpTokenRevokerOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.googleEndpoint = options.googleRevokeEndpoint ?? GOOGLE_REVOKE_ENDPOINT;
  }

  async revoke(input: {
    readonly kind: string;
    readonly credentials: Readonly<Record<string, string>>;
  }): Promise<RevocationOutcome> {
    const { kind, credentials } = input;

    const capability = revocationCapability(kind);
    if (!capability.revocable) {
      // Not a failure. The reason is a fact about the provider, and it is the
      // sentence the customer needs in order to do the part only they can do.
      return { kind, status: 'unsupported', reason: capability.reason };
    }

    if (GOOGLE_KINDS.has(kind)) return this.revokeGoogle(kind, credentials);

    // The table says revocable and this file has no implementation — which is a
    // gap in THIS file, not a fact about the provider, so it says so in those
    // words rather than borrowing the `unsupported` reason.
    return {
      kind,
      status: 'failed',
      reason: `'${kind}' is marked revocable but no revocation is implemented for it in token-revoker.ts.`,
    };
  }

  private async revokeGoogle(
    kind: string,
    credentials: Readonly<Record<string, string>>,
  ): Promise<RevocationOutcome> {
    const token = credentials['refreshToken'] ?? credentials['refresh_token'];
    if (!token) {
      // Distinct from `failed`: there was nothing to revoke, so nothing is
      // outstanding at the provider on account of a token we never had.
      return {
        kind,
        status: 'no_credential',
        reason: 'No refresh token was stored for this connection.',
      };
    }

    try {
      const res = await this.fetchImpl(this.googleEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }).toString(),
      });

      if (res.ok) return { kind, status: 'revoked' };

      // 400 `invalid_token` means the token is already dead — expired, or
      // revoked by the customer before they asked us to erase them. The outcome
      // we want to report is the STATE (it does not work), not the mechanism,
      // and reporting that as a failure would send somebody to hunt for an
      // authorization that is not there.
      const body = await res.text().catch(() => '');
      if (res.status === 400 && body.includes('invalid_token')) {
        return {
          kind,
          status: 'revoked',
          reason: 'The provider reports the token was already invalid; nothing is outstanding.',
        };
      }

      return {
        kind,
        status: 'failed',
        // The body is Google's error code, not a credential — but truncate it
        // anyway rather than paste an arbitrary upstream response into a record
        // the customer receives.
        reason: `Google refused the revocation (HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ''}).`,
      };
    } catch (err) {
      return {
        kind,
        status: 'failed',
        reason: `Could not reach the provider: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
