// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A RATE LIMIT IS WAITED OUT ONCE, NOT FAILED (workplan 0143 T10).
 *
 * One OAuth project serves every organisation on a deployment, so Google's
 * quotas per project are shared by every tester at once. A rate limit is
 * weather: it clears by itself. The Tasks source has waited one out since
 * 0126 T5. The Drive source and the DAV sources that read Google's calendars
 * and contacts did not, so a 429 there failed the item, or the whole listing,
 * on first sight.
 *
 * This is the Tasks source's rule, in the one place all four read it:
 *
 *  - A 429 or a 503 is waited out once: what `Retry-After` asks, otherwise
 *    one second.
 *  - Google's 403 `rateLimitExceeded` or `userRateLimitExceeded` is the same
 *    answer under another status. The reason is read from Google's JSON
 *    (`error.errors[0].reason`: Drive, Tasks) or from its GData XML (`<code>`:
 *    CalDAV, CardDAV). Neither 403 has been observed here; both are in
 *    Google's published error tables.
 *  - A server asking for longer than a minute is believed, not slept
 *    through. Its answer goes back as it came, the item fails as
 *    `rate_limited` (`classifyFailure` reads the status or the reason), and a
 *    later pass takes it. The rule `http-rate-limit.ts` states for the JMAP
 *    target: a window we cannot outlast is not worth sleeping in.
 *
 * The 429 and 503 half holds for every server a DAV source reads, not only
 * Google: a 429 asks the same of us from any server, and one wait of a second
 * costs nothing where it does not help.
 */

import { gdataRefusalCode } from '@openmig/shared';
import { googleRefusalReason } from './drive-refusal.ts';

/** The reasons Google gives for a rate limit on a 403 rather than a 429. */
export const GOOGLE_RATE_LIMIT_REASONS: ReadonlySet<string> = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
]);

/** How long to wait when the server does not say: one second (0126 T5). */
export const RATE_LIMIT_FALLBACK_WAIT_MS = 1_000;

/** The longest wait worth taking inside a pass. A longer ask is handed back. */
export const RATE_LIMIT_LONGEST_WAIT_MS = 60_000;

/** Whether a 403 is Google's rate limit, by its JSON reason or its GData code. */
export function isGoogleRateLimit(status: number, body: string): boolean {
  if (status !== 403) return false;
  return (
    GOOGLE_RATE_LIMIT_REASONS.has(googleRefusalReason(body)) ||
    GOOGLE_RATE_LIMIT_REASONS.has(gdataRefusalCode(body))
  );
}

/** Whether this answer asks us to slow down: a 429, a 503, or Google's 403. */
export function asksToSlowDown(status: number, body: string): boolean {
  return status === 429 || status === 503 || isGoogleRateLimit(status, body);
}

/**
 * How long to wait before the one retry, in ms, or `undefined` when the
 * server asks for longer than a pass should sleep.
 *
 * `Retry-After` is seconds or an HTTP-date (RFC 9110 §10.2.3). Absent or
 * unreadable, the wait is one second: the Tasks source's rule, and not
 * `parseRetryAfterMs`'s sixty, which would be the same wait as a server that
 * asked for a minute.
 */
export function rateLimitWaitMs(retryAfter: string | null | undefined): number | undefined {
  const value = retryAfter?.trim();
  if (!value) return RATE_LIMIT_FALLBACK_WAIT_MS;
  const seconds = Number(value);
  const asked = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  if (!Number.isFinite(asked)) return RATE_LIMIT_FALLBACK_WAIT_MS;
  if (asked > RATE_LIMIT_LONGEST_WAIT_MS) return undefined;
  return Math.max(0, asked);
}
