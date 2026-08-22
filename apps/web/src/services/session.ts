// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Turning an access token into a signed-in session (ADR-0042).
 *
 * **Who somebody is no longer comes out of the token.** It used to: `Login.tsx`
 * decoded the JWT and read `tenantId` and `role` straight off it. After
 * ADR-0042 a token carries `sub` and `email` and nothing this product invented,
 * so the answer to "which organisation, and as what" belongs to `GET /api/me` —
 * which is the API asking the database, which is where it was authoritative all
 * along (`auth.ts` already overwrote the role claim on every request).
 *
 * That makes this the one call that has to happen between the exchange and the
 * first real request.
 */

import apiClient from './api.ts';

export interface Membership {
  readonly tenantId: string;
  readonly role: string;
}

export interface Me {
  readonly userId: string;
  /**
   * From the verified `email` claim. Optional because a self-host token or an
   * issuer that stops asserting it would leave it absent, and the UI has to
   * survive that rather than render `undefined` — `AuthCallback` falls back to
   * the subject.
   */
  readonly email?: string;
  /** The tenant this request was resolved to; absent if it could not be. */
  readonly tenantId?: string;
  readonly role?: string;
  readonly tenants: ReadonlyArray<Membership>;
}

/**
 * Who am I, and where may I act?
 *
 * `tenantId` optional on purpose: a subject in several organisations that has
 * not chosen one gets a 400 from `resolveTenant` naming the choices, and that
 * refusal is a case for the UI to handle rather than an error to swallow.
 */
export async function fetchMe(token: string): Promise<Me> {
  const response = await apiClient.get<Me>('/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.data;
}
