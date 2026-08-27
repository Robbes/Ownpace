// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * What KIND of failure this is, so the person it happened to can act on it
 * (workplan 0110 T3 — the owner's six, accepted and reframed 2026-08-27).
 *
 * ## Who this is for
 *
 * The customer, first. The owner's words: *"it's good to have customers be
 * able to understand what is going on. and, most of it must be self-service.
 * I'm to be contacted in rare / edge cases."* An operator reading the same
 * category later is the second reader, not the first — which matters, because
 * a classification built for staff would happily stop at a label, and a
 * customer cannot act on `auth_expired`. They can act on *"the connection to
 * Google has expired — reconnect it"*.
 *
 * ## Beside the prose, never instead of it
 *
 * `last_error` keeps carrying exactly what the provider said. It is precise,
 * it is what an engineer needs, and paraphrasing it would be a different
 * claim. What it is NOT is actionable by the person whose migration stopped,
 * and it routinely carries a mailbox address — which is why 0110's
 * metadata-only operator views cannot show it at all. The category is a
 * second, coarser field that both readers may see.
 *
 * ## Why matching on text is acceptable here, and where it stops
 *
 * The honest objection: this reads provider prose, and provider prose
 * changes. Three things make it survivable rather than fragile.
 *
 *  1. **A wrong answer is bounded.** The worst case is `unknown`, which is a
 *     real answer with its own sentence — not a crash, not a wrong remedy.
 *     `unknown` is the DEFAULT, so an unrecognised message stays honest.
 *  2. **The signals matched are protocol vocabulary, not marketing copy** —
 *     `invalid_grant` (RFC 6749 §5.2), HTTP 401/403/429, IMAP `AUTHENTICATIONFAILED`
 *     (RFC 5530). Those are specified; the sentences around them are not, and
 *     are not matched on.
 *  3. **It is checked at the seam that already knows.** `markFailed` receives
 *     the message the connector produced, so nothing has to be re-derived
 *     later from a string that travelled.
 *
 * Where it stops: this must never become the thing that DECIDES anything —
 * no retry policy, no billing, no refusal branches on a category. It is a
 * label for a human. `unknown` staying large is a signal the list needs work,
 * not a reason to guess harder.
 */

/**
 * The six. Each earns its place by changing what the person does next — that
 * was the owner's test, and it is why there is no `provider_error` or
 * `internal`: neither tells anybody to do anything different.
 */
export const FAILURE_CATEGORIES = [
  /** The credential no longer works. Reconnect. By far the most common. */
  'auth_expired',
  /** The provider asked us to slow down. Nothing is wrong; it resumes. */
  'rate_limited',
  /** A daily ceiling is spent (Gmail's 2 500 MB/day). Resumes tomorrow. */
  'quota_exceeded',
  /** The TARGET refused the write. The one that usually needs a human. */
  'target_refused',
  /** The network did not reach. Transient; it retries. */
  'network',
  /** Not recognised. A real answer, with its own way out. */
  'unknown',
] as const;

export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

/** Every category is a known one — for reading a value back out of the table. */
export function isFailureCategory(value: unknown): value is FailureCategory {
  return (FAILURE_CATEGORIES as ReadonlyArray<unknown>).includes(value);
}

/**
 * Order matters, and it is not alphabetical.
 *
 * A message can carry more than one signal — a 429 while refreshing a token
 * mentions both auth and rate. The first match wins, so the list runs from the
 * most specific remedy to the least: being rate-limited while authenticating
 * is a rate limit (wait), not an expired credential (reconnect), and telling
 * somebody to reconnect a working credential sends them to do damage.
 *
 * Quota before rate for the same reason: "wait until tomorrow" and "wait a
 * minute" are different instructions, and the daily ceiling is the one that
 * ruins an afternoon if it is described as a blip.
 */
const RULES: ReadonlyArray<{ readonly category: FailureCategory; readonly test: RegExp }> = [
  // A daily ceiling. Gmail's own words, plus this product's refusal (0090 T4),
  // which names the ceiling before the provider ever locks the account out.
  {
    category: 'quota_exceeded',
    test: /\b(daily\s+limit|quota\s*exceeded|quotaexceeded|over\s+quota|dailylimitexceeded|bytes?\s+per\s+day|daily\s+ceiling)\b/i,
  },
  // Asked to slow down. 429 is the specified signal; the words vary.
  {
    category: 'rate_limited',
    test: /\b(429|rate[\s_-]?limit(ed|ing)?|too\s+many\s+requests|throttl(ed|ing)|try\s+again\s+later|backoff)\b/i,
  },
  // The credential is no longer usable. `invalid_grant` is RFC 6749 §5.2;
  // AUTHENTICATIONFAILED is RFC 5530. 401 is the HTTP half.
  {
    category: 'auth_expired',
    test: /\b(invalid_grant|invalid_token|token[\s_-]?expired|expired[\s_-]?token|authenticationfailed|authentication\s+failed|unauthorized|unauthorised|401|invalid_client|revoked)\b/i,
  },
  // The network did not reach. Node/undici codes are the reliable part.
  {
    category: 'network',
    test: /\b(econnrefused|econnreset|enotfound|etimedout|ehostunreach|enetunreach|epipe|socket\s+hang\s+up|network\s+error|dns|getaddrinfo|tls|certificate)\b/i,
  },
  // The target said no to the write. Deliberately last of the matchers: it is
  // the broadest, and anything above it is a better answer when both fit.
  {
    category: 'target_refused',
    test: /\b(403|409|412|422|507|forbidden|permission\s+denied|insufficient\s+(permission|storage|quota)|read[\s_-]?only|refused\s+the|rejected|conflict|precondition\s+failed|mailbox\s+full|over\s+capacity)\b/i,
  },
];

/**
 * The category a failure message falls into. `unknown` when nothing matches,
 * and `unknown` is a real answer rather than a gap — see the module comment.
 *
 * Never throws, for any input, including one that is not a string: this runs
 * where a failure is ALREADY being recorded, and a classifier that threw
 * would replace a useful error with a useless one.
 */
export function classifyFailure(message: unknown): FailureCategory {
  if (typeof message !== 'string' || message.trim() === '') return 'unknown';
  for (const rule of RULES) {
    if (rule.test.test(message)) return rule.category;
  }
  return 'unknown';
}
