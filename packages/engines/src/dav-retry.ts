// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Retry a DAV write while the server is merely busy.
 *
 * Nextcloud's default SQLite is a SINGLE-WRITER database. Under concurrent
 * writes it answers
 *
 *   500 … SQLSTATE[HY000]: General error: 5 database is locked
 *
 * and the lock is transient by nature — it clears the moment the other write
 * commits. Every DAV target writer had its own copy of this retry, all three
 * identical, all three weaker than they needed to be: 3 attempts, a linear
 * 250 ms step, and 5xx only.
 *
 * The seed script's retry was measured against exactly this failure — a stub
 * modelling a single-writer backend served the real Nextcloud lock document to
 * every overlapping write, and 200/200 fixtures landed through 27 locks with 5
 * attempts and doubling backoff plus jitter. This is that, shared, so the
 * product path is no weaker than the test scaffolding that proved it.
 *
 * 423 (WebDAV Locked) and 429 join 5xx: all three mean "come back", not "your
 * request is wrong". Everything else — 401, 403, 412, 415 — returns on the
 * first response, because retrying those only delays the answer. 412 in
 * particular is a create-only precondition doing its job and is a SUCCESS to
 * the caller, never something to repeat.
 */

/** The minimum an HTTP response needs for a retry decision. */
export interface RetryableResponse {
  status: number;
}

export interface DavRetryOptions {
  /** Total attempts including the first. */
  readonly attempts?: number;
  /** First backoff step; each subsequent wait doubles it. */
  readonly baseBackoffMs?: number;
}

const DEFAULT_ATTEMPTS = 5;
const DEFAULT_BASE_BACKOFF_MS = 200;

/** True when the status says "busy, try again", as opposed to "no". */
export function isTransientDavStatus(status: number): boolean {
  return status >= 500 || status === 423 || status === 429;
}

/**
 * Run `send` until it returns a non-transient status or attempts run out.
 *
 * Returns the last response either way — callers already inspect `status` and
 * raise their own domain-specific errors, so throwing here would take that
 * decision away from them.
 */
export async function requestWithDavRetry<R extends RetryableResponse>(
  send: () => Promise<R>,
  options: DavRetryOptions = {},
): Promise<R> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const base = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;

  let response = await send();
  for (let attempt = 1; attempt < attempts; attempt++) {
    if (!isTransientDavStatus(response.status)) return response;
    // Jitter so writers that collided do not all wake in the same millisecond
    // and collide again — the difference between backing off and rescheduling
    // the same pile-up.
    await new Promise((resolve) => setTimeout(resolve, base * 2 ** (attempt - 1) + Math.random() * base));
    response = await send();
  }
  return response;
}
