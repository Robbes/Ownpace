// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * A 500 is a BUG, not a refusal — and it must not answer with the bug
 * (workplan 0079).
 *
 * Eleven routes answered `{ error: 'list_failed', reason: String(error) }`.
 * Two things were wrong with that, and the create route's own comment had
 * already said both:
 *
 *  1. **It hands internals to a browser.** `String(error)` on a driver failure
 *     can carry a connection string, a query, a host. That is the reason the
 *     create route stopped doing it (workplan 0068), and eleven other places
 *     went on doing it.
 *  2. **It gives the person nothing to act on.** A stringified error is not a
 *     sentence anyone can use, and it does not connect the red box in front of
 *     them to the stack sitting in the log.
 *
 * The fix for both is the one 0068 T10c asked for and only ever applied to
 * create: a short reference shared by the log line and the response. The
 * message stays safe, and quoting the reference finds the detail. Reference
 * `e133a809` is how the create-route 500 was diagnosed at all — this is that,
 * everywhere.
 */

import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { log } from '@openmig/shared';

/**
 * Log the fault with a reference and answer with a safe sentence carrying it.
 *
 * `doing` completes both "…failed" in the log and "Something went wrong …" in
 * the response, so it reads as a gerund: `'listing connections'`.
 */
export function serverFault(res: Response, code: string, doing: string, error: unknown): void {
  const ref = randomUUID().slice(0, 8);
  log.error(`[api] ${doing} failed [ref ${ref}]:`, error);
  res.status(500).json({
    error: code,
    reason:
      `Something went wrong ${doing} — this is a fault on our side, not something ` +
      `your input caused. Reference ${ref}; quoting it finds the detail in the server log.`,
  });
}
