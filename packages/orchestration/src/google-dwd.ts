// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The second way into Google: domain-wide delegation (ADR-0033, accepted).
 *
 * One helper, used by all four Google source factories, so "which credential
 * mode is this" is decided in exactly one place: a `serviceAccountKey` present
 * in the credentials selects the JWT-bearer flow; absent, every factory falls
 * through to its existing refresh-token path untouched. Per-user tokens stay
 * the default — DWD is the opt-in for Workspace tenants with an admin in the
 * loop, and the setup doc treats the Admin-console authorisation with the
 * weight of the consent it is.
 *
 * The SUBJECT is the mapping's own user: the credential can impersonate
 * anybody in the domain, the built provider impersonates exactly one account
 * — the one this mapping migrates (ADR-0033 §1).
 */

import { GoogleJwtBearerProvider } from '@openmig/connectors';
import type { TokenProvider } from '@openmig/shared';

/** Appliance: one env var, the whole key file Google generated. */
export const ENV_GOOGLE_DWD_KEY_NAME = 'GOOGLE_SERVICE_ACCOUNT_KEY';
/** Managed: stored on the connection, encrypted, beside the other credentials. */
export const STORED_GOOGLE_DWD_KEY_NAME = 'serviceAccountKey';

export interface GoogleDwdAsFound {
  /** The service-account key FILE (JSON text), when the deployment opted in. */
  readonly serviceAccountKey?: string | undefined;
  /** Fallback subject for callers whose factory takes no user parameter. */
  readonly subject?: string | undefined;
}

/**
 * The DWD token provider, when the credentials select that mode; undefined
 * otherwise. Throws the provider's own refusals (bad key paste, missing
 * subject) prefixed with the product, at BUILD time — the same moment every
 * factory's refresh-token refusals fire.
 */
export function dwdTokenProviderIfConfigured(
  creds: GoogleDwdAsFound,
  subject: string | undefined,
  scope: string,
  product: string,
): TokenProvider | undefined {
  if (!creds.serviceAccountKey) return undefined;
  try {
    return new GoogleJwtBearerProvider(creds.serviceAccountKey, subject ?? creds.subject ?? '', scope);
  } catch (err) {
    throw new Error(`${product}: ${err instanceof Error ? err.message : String(err)}`, {
      cause: err,
    });
  }
}
