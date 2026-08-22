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

export interface GrantResult {
  readonly tenantId: string;
  readonly name: string;
  readonly email: string;
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

/** Say no. Provisions nothing, and the row stays as a record either way. */
export async function declineAccessRequest(id: string, note?: string): Promise<void> {
  await apiClient.post(`/access-requests/${id}/decline`, note ? { note } : {});
}
