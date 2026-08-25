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

import apiClient, { signInClient } from './api.ts';

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
  /**
   * Whether to offer the access queue (workplan 0093 T7).
   *
   * A hint for the UI and nothing more: the queue is guarded by policies on
   * `access_request`, so a client that got this wrong would show or hide a link
   * and be told nothing either way.
   */
  readonly operator?: boolean;
  /**
   * Open invitations addressed to this caller's verified address (0099).
   *
   * Optional so an older API, or one that stops answering with the field, does
   * not render `undefined.length` — every reader defaults it to empty. Empty is
   * also the ordinary case, and the case for an issuer that will not assert
   * `email_verified`.
   */
  readonly invitations?: ReadonlyArray<Invitation>;
}

/** An offer of membership. NOT a membership — that is what answering it makes. */
export interface Invitation {
  readonly tenantId: string;
  readonly name: string;
  readonly role: string;
  readonly invitedAt?: string | null;
}

/**
 * Who am I, and where may I act?
 *
 * `tenantId` optional on purpose, and no longer because of a refusal: this
 * route REPORTS (workplan 0093 T7). A subject in several organisations that has
 * not chosen one gets all of them listed and no current one — a case for the UI
 * to handle rather than an error to swallow. So is `tenants: []`, which is a
 * platform operator's normal state and also the state of somebody whose
 * invitation has not bound.
 */
export async function fetchMe(token: string): Promise<Me> {
  // `signInClient`, NOT `apiClient` — the stored token must not override the one
  // just exchanged, and a 401 has to reach AuthCallback so it can say why.
  const response = await signInClient.get<Me>('/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.data;
}

/**
 * Answer an invitation.
 *
 * **There is deliberately no `skip` call.** Leaving one unanswered is the
 * absence of a decision, so the row stays `invited` and `/api/me` offers it
 * again next time. A "skip" endpoint would have to answer "for how long", and
 * the honest answer — until you decide — is what doing nothing already means.
 */
export async function answerInvitation(
  token: string,
  tenantId: string,
  answer: 'accept' | 'decline',
): Promise<{ tenantId: string; outcome: 'accepted' | 'declined' }> {
  const response = await apiClient.post<{ tenantId: string; outcome: 'accepted' | 'declined' }>(
    `/invitations/${tenantId}/${answer}`,
    {},
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return response.data;
}
