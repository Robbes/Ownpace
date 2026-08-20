// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The authenticated transport `GoogleDriveSource` talks through (workplan 0042 T5).
 *
 * The connector deliberately carries no opinion about how a token is obtained —
 * its `DriveTransport` seam is a bare function, so its tests are literals with no
 * network and no OAuth. This is the other half: the one place a bearer token is
 * attached, and the one place a rejected token is replaced.
 *
 * WHY THE 401 RETRY IS HERE and not in the connector. A files pass can run longer
 * than an access token lives, and it can run longer than the token provider's
 * five-minute expiry buffer accounts for if Google revokes early — a password
 * change on the source account does exactly that, mid-pass. Without this, every
 * remaining item in the pass fails with `401` and the owner is told their files
 * are broken. With it, the pass mints a new token and carries on.
 *
 * EXACTLY ONE RETRY. A second 401 is returned as it stands, because a token that
 * was just minted and is still rejected is not a stale token — it is a revoked
 * refresh token, a scope the consent never granted, or a file the account cannot
 * see. Retrying that in a loop turns one clear failure into a rate-limit ban and
 * tells the owner nothing.
 */

import type { TokenProvider } from '@openmig/shared';
import type { DriveResponse, DriveTransport } from './google-drive-source.types.ts';

/** The seam to the network. A `fetch` Response satisfies `DriveResponse` as it is. */
export type DriveFetch = (
  url: string,
  init: { readonly headers: Readonly<Record<string, string>> },
) => Promise<DriveResponse>;

export function googleDriveTransport(
  tokens: TokenProvider,
  fetchImpl: DriveFetch = defaultDriveFetch,
): DriveTransport {
  const send = async (url: string, accessToken: string, extra?: Readonly<Record<string, string>>) =>
    fetchImpl(url, {
      headers: {
        ...extra,
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

  return async (url, init) => {
    const token = await tokens.getToken();
    const first = await send(url, token.accessToken, init?.headers);
    if (first.status !== 401) return first;

    // The token was rejected. `refresh()` bypasses the provider's cache — which
    // still holds the token Google just refused — and joins any mint already in
    // flight, so a folder's worth of concurrent items produces one replacement
    // rather than one each.
    const renewed = await tokens.refresh();
    return send(url, renewed.accessToken, init?.headers);
  };
}

const defaultDriveFetch: DriveFetch = (url, init) => fetch(url, { headers: { ...init.headers } });
