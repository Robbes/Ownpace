// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Load a JMAP session, and fail as the thing that actually failed.
 *
 * **Why this exists, in one sentence:** `JamClient.loadSession` never checks
 * `response.ok`, so a rejected credential arrives looking like an empty server.
 *
 * Its entire body is
 *
 * ```js
 * fetch(url, { headers }).then(r => r.json())
 * ```
 *
 * A 401, a 403 or a 404 carrying a JSON body parses perfectly happily, so the
 * helper RESOLVES with the error document — an object with no `accounts` and no
 * `primaryAccounts`. Every JMAP writer here then reaches its own account-
 * resolution guard, finds nothing to resolve, and refuses with a message about
 * failing to find an account.
 *
 * **Nothing is corrupted by that and no data is at risk** — those guards exist
 * precisely so a writer never guesses which account to put a customer's data in,
 * and they do their job. What is wrong is the DIAGNOSIS. An operator reading
 *
 *     Could not resolve a JMAP contacts account for 'x@example.com'.
 *     The session advertises 0 account(s)…
 *
 * goes looking at account provisioning on a server that was only ever saying
 * "wrong password". That is a failure reported as a different failure, and it
 * costs whoever reads it real time in the one situation — a broken connection —
 * where they have least of it.
 *
 * Found on 2026-08-06 by `jmap-capabilities.integration.test.ts`, whose whole
 * subject is not conflating "I could not look" with "there is nothing there";
 * the capability probe hit the same helper and its own test caught it. Recorded
 * as a follow-up then, and this is that follow-up.
 *
 * @see docs/workplans/0031-jmap-full-target.md — T4
 */

/** The fields every caller here reads off a session. */
export interface JmapSessionLike {
  readonly accounts?: Record<string, { id?: string; name?: string; email?: string }>;
  readonly primaryAccounts?: Record<string, string>;
  readonly capabilities?: Record<string, unknown>;
  readonly downloadUrl?: string;
  readonly uploadUrl?: string;
}

/**
 * GET the session document, or throw saying what went wrong.
 *
 * Deliberately NOT a wrapper that falls back to `JamClient.loadSession` on
 * error: a fallback would restore the exact behaviour this replaces.
 *
 * @param sessionUrl the well-known URL, already assembled by the caller.
 * @param authHeader the full `Authorization` header value.
 */
export async function loadJmapSession(
  sessionUrl: string,
  authHeader: string,
): Promise<JmapSessionLike> {
  let response: Response;
  try {
    response = await fetch(sessionUrl, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
      cache: 'no-cache',
    });
  } catch (err) {
    // DNS, TLS, connection refused — the request never reached a server.
    throw new Error(
      `Could not reach the JMAP server at ${sessionUrl}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  if (!response.ok) {
    // Read as TEXT first. A proxy or a rate limiter answers with HTML, and
    // `response.json()` would then throw a parse error saying nothing about the
    // status the server actually returned (hard rule 9).
    const body = await response.text().catch(() => '');
    throw new Error(
      `${describeStatus(response.status)} JMAP session request to ${sessionUrl} returned ` +
        `HTTP ${response.status}${body ? ` - ${body.slice(0, 300)}` : ''}`,
    );
  }

  try {
    return (await response.json()) as JmapSessionLike;
  } catch (err) {
    throw new Error(
      `The JMAP session at ${sessionUrl} returned HTTP 200 but the body was not JSON: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

/**
 * A plain-language lead for the statuses that mean something specific.
 *
 * The point of the whole file is that the reader learns what to go and fix, so
 * the two statuses that name a cause say it in words before the number.
 * Everything else gets no invented interpretation — an unfamiliar status is
 * reported as itself.
 */
function describeStatus(status: number): string {
  if (status === 401) return 'Authentication was REFUSED (check the username and password) —';
  if (status === 403) return 'Access was FORBIDDEN (the credential is valid but not permitted) —';
  if (status === 404) {
    return 'No JMAP session document was found (is this a JMAP server, and is the path right?) —';
  }
  return 'The';
}
