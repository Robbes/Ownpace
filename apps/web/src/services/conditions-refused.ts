// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A door refused because the texts are not accepted yet (workplan 0139 T3;
 * review of 2026-09-29).
 *
 * While the deployment asks, the API answers 409 `conditions_not_accepted` at
 * every door that would store somebody's access (adding a connection, a new
 * key, creating a migration, issuing a grant link) until the person pressing
 * it has accepted the current version of each text. `AcceptanceGate` shows
 * the screen on load, but it asks `GET /api/me` once per page load, so a
 * version that changes while somebody has the app open reached them only as
 * that refusal, with a sentence telling them the app would ask, and no screen.
 *
 * So the app's own client (`api.ts`, the response interceptor beside the 401)
 * says here when it meets one, and the gate listens: it reads again and shows
 * the screen at once, keeping the page underneath. A bundle not built for the
 * Alpha asks nothing on load, and starts asking at the first such refusal.
 *
 * No imports from the rest of the app: `api.ts` imports this, and this must
 * not import `api.ts` back.
 */

/** The refusal's code, as `apps/api/src/conditions-not-accepted.ts` answers it. */
export const CONDITIONS_NOT_ACCEPTED = 'conditions_not_accepted';

/** Whether a failed request was a door refusing because the texts are not accepted. */
export function isConditionsNotAccepted(err: unknown): boolean {
  const response = (err as { response?: { status?: unknown; data?: { error?: unknown } } } | null)?.response;
  return response?.status === 409 && response.data?.error === CONDITIONS_NOT_ACCEPTED;
}

const listeners = new Set<() => void>();

/** Be told whenever a door refuses because the texts are not accepted; returns the way to stop. */
export function onConditionsNotAccepted(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called by the app's client with every failed request; tells the listeners of this refusal only. */
export function noticeConditionsNotAccepted(err: unknown): void {
  if (!isConditionsNotAccepted(err)) return;
  for (const listener of [...listeners]) listener();
}
