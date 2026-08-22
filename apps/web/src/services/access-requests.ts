// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The access queue, from the browser (workplan 0093 T7).
 *
 * Every call here is authorised by POLICIES on `access_request`, not by this
 * file and not by the screen that uses it. A non-operator calling `list()` gets
 * `[]` and calling `grant()` gets a 404 — because to the database the row is
 * invisible, and "not found" is the honest answer to a question about a row you
 * cannot see. So there is nothing to check client-side that would mean anything;
 * `Me.operator` decides whether to SHOW the queue, never whether it works.
 */

import apiClient from './api.ts';

export type RequestState = 'open' | 'granted' | 'declined';

export interface AccessRequest {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly organisation: string | null;
  readonly note: string | null;
  readonly tier: string | null;
  readonly locale: 'en' | 'nl';
  readonly state: RequestState;
  readonly tenantId: string | null;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly decisionNote: string | null;
  readonly createdAt: string;
}

/** Everything, or one state. Oldest first — the queue is worked from the top. */
export async function listAccessRequests(state?: RequestState): Promise<AccessRequest[]> {
  const response = await apiClient.get<{ requests: AccessRequest[] }>('/access-requests', {
    ...(state ? { params: { state } } : {}),
  });
  return response.data.requests;
}

/**
 * What became of the courtesy email, as the API reports it.
 *
 * Four states rather than a boolean because they need different things from the
 * operator: `sent` needs nothing, `off` and `failed` both put the manual step
 * back (for different reasons, and the fix is different), and `skipped` is what
 * they themselves asked for. A boolean would collapse "we could not" into "we
 * did not", which is the distinction the screen exists to show.
 */
export type NotifiedOutcome = 'sent' | 'off' | 'failed' | 'skipped';

export interface GrantResult {
  readonly tenantId: string;
  readonly name: string;
  readonly email: string;
  /**
   * Never `skipped` — a grant has no "do not tell them" to choose. An
   * unannounced grant is one the person can never use, because that email is
   * the only thing that tells them the door exists. The type says so rather
   * than leaving it to a comment somewhere else.
   */
  readonly notified: Exclude<NotifiedOutcome, 'skipped'>;
}

export interface DeclineResult {
  readonly declined: true;
  readonly id: string;
  readonly notified: NotifiedOutcome;
}

/**
 * Say yes: create the organisation and invite the asker as its owner.
 *
 * `organisationName` is what it will be called; the server falls back to what
 * they told us, which is usually right and occasionally a typo somebody wants
 * to fix before it becomes a customer's name.
 */
export async function grantAccessRequest(
  id: string,
  body: { organisationName?: string; note?: string } = {},
): Promise<GrantResult> {
  const response = await apiClient.post<GrantResult>(`/access-requests/${id}/grant`, body);
  return response.data;
}

/**
 * Say no. Provisions nothing, and the row stays as a record either way.
 *
 * `notify` is sent EXPLICITLY rather than left to the server's default, so the
 * unticked box travels as `false` instead of as an absent field — the two are
 * the same to zod's `.default(true)` only by accident, and this way the request
 * says what the operator actually chose.
 */
export async function declineAccessRequest(
  id: string,
  options: { note?: string; notify?: boolean } = {},
): Promise<DeclineResult> {
  const response = await apiClient.post<DeclineResult>(`/access-requests/${id}/decline`, {
    ...(options.note ? { note: options.note } : {}),
    notify: options.notify ?? true,
  });
  return response.data;
}
