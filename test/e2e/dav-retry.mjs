// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// One retry policy for every e2e script that talks to the source Nextcloud.
//
// WHY THIS EXISTS. Nextcloud's default SQLite is a SINGLE-WRITER database. Under
// concurrent access it really does answer
//
//   500 … SQLSTATE[HY000]: General error: 5 database is locked
//
// and it is transient by nature — the lock clears as soon as the other write
// commits. `seed-dav-source.mjs` learned this the hard way and grew a retry; the
// other three DAV scripts did not, and on 2026-08-14 the scheduled e2e failed
// exactly there: a DELETE in `trash-caldav-source.mjs` took a 500 "database is
// locked", the script exited 1, and FOUR tests in
// selfhost-apply-deletion-calendar.e2e.test.ts failed downstream of it — none of
// them for a reason that had anything to do with the product. It was the third
// such failure in thirty scheduled runs (2026-08-10, -08-11, -08-14), which is
// what a transient infrastructure fault looks like from a distance.
//
// WHAT IS RETRIED, AND WHAT IS NOT. 5xx, 423 (WebDAV Locked) and 429 all mean
// "come back", not "your request is wrong". Everything else — 401, 403, 404, 415,
// a malformed body — is a real failure and is returned immediately; retrying those
// would only delay the error by a few seconds and make the log harder to read.
//
// READS ARE RETRIED TOO, and that is deliberate rather than incidental. A 500 on
// the GET that `trash-caldav-source.mjs` does first would have been reported as
// "is not readable … Run seed-dav-source.mjs first" — blaming the seed for a lock
// held by something else. A misleading error costs more to chase than the failure
// itself.

import { setTimeout as sleep } from 'node:timers/promises';

/** Attempts before a busy server is treated as a real failure. */
export const DAV_ATTEMPTS = Number(process.env.DAV_ATTEMPTS ?? 5);

/** The server is telling us to come back, not that the request is wrong. */
export function isRetryableStatus(status) {
  return status >= 500 || status === 423 || status === 429;
}

/**
 * `fetch`, retrying only while the server is merely busy.
 *
 * Returns the final Response — callers keep their own success/failure rules, so
 * this changes when a request is given up on, never what counts as success.
 *
 * Backoff doubles with jitter, so writers that collided do not all retry in the
 * same millisecond and collide again.
 */
export async function davFetch(url, init = {}, { attempts = DAV_ATTEMPTS, label = '' } = {}) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, init);
    if (!isRetryableStatus(response.status) || attempt === attempts) return response;

    const where = label ? `${label} ` : '';
    console.log(
      `[dav-retry] ${where}${init.method ?? 'GET'} ${url} -> ${response.status}, ` +
        `attempt ${attempt}/${attempts}; retrying`,
    );
    await sleep(200 * 2 ** (attempt - 1) + Math.random() * 200);
  }
}
