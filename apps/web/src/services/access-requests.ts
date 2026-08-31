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
  body: {
    organisationName?: string;
    note?: string;
    /**
     * Mean it anyway, when the address already owns one.
     *
     * `true` or absent, never `false`: the server takes `z.literal(true)`, and
     * a field that can say "no" invites a client to send it by default and
     * turn a deliberate override into a checkbox nobody reads.
     */
    alsoCreateSecondOrganisation?: true;
  } = {},
): Promise<GrantResult> {
  const response = await apiClient.post<GrantResult>(`/access-requests/${id}/grant`, body);
  return response.data;
}

/** What the server said when it refused to make a person an owner twice. */
export interface AlreadyOwnsRefusal {
  /** The server's own sentence, which already handles one versus several. */
  readonly message: string;
  /** The organisations it named, so the screen can show them rather than describe them. */
  readonly organisations: readonly string[];
}

/**
 * Is this the refusal an operator can override, or an error they cannot?
 *
 * Both answers from `POST …/grant` that mean "no" are 409: "already decided"
 * and "already owns one". Only the second has a way forward, so the status is
 * not the discriminator — `confirmWith` is. The server names the field to send
 * precisely so the client does not have to carry a copy of that vocabulary
 * beyond this one comparison, and so a screen cannot offer an override for a
 * refusal that has none.
 *
 * Deliberately NOT keyed on the status as well. If the server ever answered
 * this with a different code, a client requiring 409 would quietly stop
 * offering the override and show a bare sentence instead — failing in the
 * direction where nobody notices. The shape below is specific enough on its
 * own: no other response carries this field with a list of names.
 *
 * Takes `unknown` because that is what a rejected mutation hands you, and
 * returns null for everything it does not recognise rather than throwing —
 * the caller is an error handler and has nowhere to put a second error.
 */
export function alreadyOwnsRefusal(error: unknown): AlreadyOwnsRefusal | null {
  const body = (error as { response?: { data?: unknown } })?.response?.data;
  if (typeof body !== 'object' || body === null) return null;

  const { confirmWith, organisations, message } = body as {
    confirmWith?: unknown;
    organisations?: unknown;
    message?: unknown;
  };
  if (confirmWith !== 'alsoCreateSecondOrganisation') return null;
  if (!Array.isArray(organisations)) return null;
  // Every entry a string, and at least one: a refusal that names nothing is
  // not one an operator can act on, and rendering an empty list under "they
  // already own these" would say the opposite of what it means.
  const named = organisations.filter((o): o is string => typeof o === 'string');
  if (named.length === 0 || named.length !== organisations.length) return null;

  return {
    message: typeof message === 'string' && message !== '' ? message : '',
    organisations: named,
  };
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
