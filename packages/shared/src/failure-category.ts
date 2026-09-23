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
 * Where it stops: this must not become the thing that DECIDES anything — no
 * billing, no refusal branches on a category. It is a label for a human.
 * `unknown` staying large is a signal the list needs work, not a reason to
 * guess harder.
 *
 * ## And where matching is the wrong tool entirely (2026-09-18)
 *
 * All three arguments above are about OTHER PEOPLE'S errors. None of them
 * covers an error this codebase built itself. `NativeFileRefused` branches on
 * exactly why a Google file is not going — this migration's policy, a type
 * Drive cannot render, and until 2026-09-23 a measured-unstable export — and
 * then throws prose for
 * this function to guess at; it guessed `unknown` on thirty of the owner's
 * files, whose remedy is *"send it to us and we will look"* about a refusal we
 * wrote one line earlier.
 *
 * So a category may also be STATED, by the code that threw
 * (`stated-failure-category.ts`), and a stated one is preferred over a matched
 * one. Migration 0048 made this same move for the side: carry what the throw
 * site knew rather than write a better regex. Nothing infers a stated category
 * from prose and nothing accepts one from outside this repository — that is
 * what `RULES` is for, where the evidence can be read.
 *
 * ## The one exception, and it is a real one (recorded 2026-09-17)
 *
 * This paragraph read *"no retry policy"* until today, and the codebase had
 * already stopped obeying it. `SELF_HEALING_CATEGORIES` in
 * `@openmig/orchestration/failing-backoff` is a set of the categories below,
 * passed as `$2` into the managed tick's SQL, and the `any_self_healing` it
 * computes decides whether a failing mapping is attempted at all on this tick.
 * That is a retry policy keyed on a category.
 *
 * It was the owner's decision and it is a good one — a daily ceiling that
 * clears tomorrow and a rate limit that clears in minutes should NOT be slowed
 * down, because slowing them delays exactly the recovery the cadence exists
 * for. What went wrong is only that the rule here was never told. A "never"
 * that the code openly breaks is worse than no rule: it tells the next reader
 * the opposite of what is true, and this repository has now watched three
 * comments expire the same way in a single day.
 *
 * **SO: ADDING A CATEGORY CHANGES BEHAVIOUR.** A new category is by default
 * NOT self-healing, so a migration that hits it is asked less and less often
 * until somebody acts. That is usually right — it was right for both refusals
 * added on 2026-09-17 — and it is never automatic. `failing-backoff.ts` states
 * the set as the COMPLEMENT of "needs a person" and a guard there asserts the
 * complement by name, so a category cannot be added and land on the wrong side
 * unnoticed. Go and look at that guard's expectation when you add one; it will
 * be red, and what it asks is whether this new thing clears on its own.
 */

/**
 * The nine. Each earns its place by changing what the person does next — that
 * was the owner's test, and it is why there is no `provider_error` or
 * `internal`: neither tells anybody to do anything different.
 *
 * ## It was six until 2026-09-17, and a refusal was one word
 *
 * `target_refused` was the only refusal, so every refusal became one — including
 * the ones where the destination was never asked. Drive answering
 * `cannotExportFile` on a Google Doc whose owner disabled download is a SOURCE
 * refusal: nothing was sent anywhere, the destination is fine, and the remedy
 * offered ("a full mailbox, a read-only folder or missing permission on the
 * target account") sent the reader to check an account that had done nothing
 * wrong. A wrong remedy is worse than `unknown`, which at least says so.
 *
 * The owner added the third case on the same day: *"it also makes sense a
 * target might refuse certain fileformats/types and we need to be transparrant
 * about that."* A destination that will not take a `.svg` is not a destination
 * that is full, and telling somebody to free up space is the same failure one
 * step along.
 *
 * ## The ninth is the one WE refused, and the owner chose it on 2026-09-18
 *
 * Thirty files sat `failed` on his live migration, all reading `unknown`, and
 * they were not one group: nine are Google types Drive will not export in any
 * format, and twenty-one were refused by this migration's own
 * `nativeFilePolicy`. Opposite remedies — *accept leaving it behind* and
 * *change a setting* — and the Failures page, which groups by kind × category
 * and offers one press per group, had them under one button.
 *
 * He was asked whether one category for all thirty or a new one separating the
 * twenty-one, and picked the second. `policy_refused` is the only category in
 * this list whose cause is US: the source would have handed the item over and
 * the destination was never asked.
 */
export const FAILURE_CATEGORIES = [
  /** The credential no longer works. Reconnect. By far the most common. */
  'auth_expired',
  /** The provider asked us to slow down. Nothing is wrong; it resumes. */
  'rate_limited',
  /** A daily ceiling is spent (Gmail's 2 500 MB/day). Resumes tomorrow. */
  'quota_exceeded',
  /**
   * THIS MIGRATION declined it. The source would have handed it over and the
   * destination was never asked — a setting on the mapping is what changed
   * the answer, and changing it back makes the item eligible again.
   *
   * Never matched from prose: it is STATED by the code that refused (see the
   * module comment). Nothing a provider says can mean this, because no
   * provider was involved.
   */
  'policy_refused',
  /**
   * The SOURCE would not hand the item over — so nothing was ever sent, and
   * the destination is not the thing to go and look at.
   */
  'source_refused',
  /** The TARGET refused the write. The one that usually needs a human. */
  'target_refused',
  /**
   * The target refused THIS KIND OF FILE — a blocked extension, a rejected
   * media type, a name the destination will not store. Always the target: a
   * source that will not produce a format is `source_refused`.
   */
  'format_refused',
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
/**
 * WHICH SIDE TURNS ONE SIGNAL INTO TWO ANSWERS.
 *
 * A refusal looks the same in prose wherever it happened — a 403 is a 403 —
 * so the text cannot tell a source refusal from a target one. The pass
 * already knows: `sided()` tags what `fetchRaw` throws as `source` and what
 * `upsert` throws as `target`, at the closure, and `markFailed` receives that
 * tag and this message in the same call. So the side is READ here rather than
 * guessed at, which keeps the module's own rule — protocol vocabulary, never
 * marketing copy — and adds nothing to the regexes.
 *
 * **When the side is absent the answer is the target**, which is what this
 * code has always said. That is a default, not a finding: `failed_side` is
 * NULL for a pass that could not tell and for every row written before it
 * existed, and re-reading those as source refusals would rewrite history on no
 * evidence. A write is also where the overwhelming majority of refusals
 * happen, so the default is the likely answer as well as the old one.
 */
const RULES: ReadonlyArray<{
  readonly category: FailureCategory;
  readonly test: RegExp;
  /**
   * What this same signal means when the pass recorded the SOURCE side.
   * Absent where the side cannot change the answer — a 429 is a rate limit
   * whoever sent it.
   */
  readonly whenSource?: FailureCategory;
}> = [
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
  // THE DESTINATION WILL NOT TAKE THIS KIND OF FILE (the owner's third case,
  // 2026-09-17). Above the general refusal because it is the narrower reading
  // of the same event, and below everything else for the usual reason.
  //
  // WHAT IS MATCHED, AND HOW SURE EACH PART IS — the same distinction
  // `drive-refusal.ts` keeps between a reason observed and a reason published,
  // because the cost of guessing here is a confident wrong sentence:
  //
  //  - `415` / "unsupported media type" is SPECIFIED (RFC 9110 §15.5.16) and
  //    means exactly this and nothing else. It is the anchor.
  //  - The filename phrases are what Nextcloud and Sabre PUBLISH for a name or
  //    extension they refuse to store. **None has been observed by this code.**
  //    They are narrow on purpose: a phrase that turns out to be wrong simply
  //    never fires and the failure reads `target_refused`, which is what it
  //    read before this rule existed. A phrase that is too broad would
  //    mislabel a full mailbox as a format problem, which is the failure worth
  //    avoiding.
  //
  // NOT MATCHED, deliberately: a bare 403 carrying a blocked extension. Sabre
  // answers a file-access-control refusal with a plain `Forbidden` and no word
  // about the reason, so there is nothing in it to read. Those stay
  // `target_refused` and the prose beside them carries the path, which is what
  // a reader actually needs there.
  {
    category: 'format_refused',
    test: /\b(415|unsupported\s+media\s+type|invalid\s+file\s*name|reserved\s+word|not\s+an\s+allowed\s+file\s*type|forbidden\s+file\s*(name|type)|blacklisted\s+file)\b/i,
    // A source that will not produce a format is not a target refusing one.
    whenSource: 'source_refused',
  },
  // A refusal. Deliberately last of the matchers: it is the broadest, and
  // anything above it is a better answer when both fit. WHICH side refused is
  // the whole difference between "go and look at your destination" and
  // "nothing was sent anywhere" — see the comment above this list.
  //
  // A 500 IS A REFUSAL, AND WAS `unknown` UNTIL 2026-09-17. Two of the owner's
  // contacts were refused five times each by a live Nextcloud with
  //
  //   PUT failed for …/address-book/….vcf with status 500: TypeError — A type
  //   error occurred. For more details, please refer to the logs…
  //
  // and the category on both rows read `unknown`, whose remedy is *"send it to
  // us and we will look"*. That is the wrong instruction for the one failure in
  // the run where the reason was sitting in the customer's OWN destination log,
  // one `docker logs` away. The write did not happen and the destination is
  // where to look, which is precisely `target_refused`.
  //
  // MATCHED AS A STATUS, NEVER AS A BARE NUMBER: `status 500` is how every
  // refusal in this codebase phrases it, and "internal server error" is the
  // specified reason phrase (RFC 9110 §15.6.1). A bare `\b500\b` would read
  // "500 items" and "500 MB" as server errors, which is the false-positive this
  // module's own rule about protocol vocabulary exists to avoid.
  //
  // 502, 503 AND 504 ARE DELIBERATELY ABSENT. A gateway that is briefly
  // unavailable in front of a healthy destination has not refused anything, and
  // `target_refused` is not self-healing — so reading a proxy blip as one would
  // put a working migration on the backoff ladder. They stay `unknown` until a
  // real refusal argues otherwise.
  {
    category: 'target_refused',
    test: /\b(403|409|412|422|507|status\s+500|internal\s+server\s+error|forbidden|permission\s+denied|insufficient\s+(permission|storage|quota)|read[\s_-]?only|refused\s+the|rejected|conflict|precondition\s+failed|mailbox\s+full|over\s+capacity)\b/i,
    whenSource: 'source_refused',
  },
];

/**
 * The category a failure message falls into. `unknown` when nothing matches,
 * and `unknown` is a real answer rather than a gap — see the module comment.
 *
 * `side` is the pass's own record of WHERE it happened (`FAILURE_SIDES`
 * below), not a hint parsed out of the message. It is optional because it is
 * genuinely absent sometimes, and it only ever moves a refusal between the
 * source and the target reading of the same signal: every other category
 * answers the same whoever sent it.
 *
 * `stated` is the category the THROW SITE named, read off the error by
 * `statedFailureCategoryOf` (workplan 0125 T4). It wins outright, including
 * over `side`, and the reason is that it is not a hint: only code in this
 * repository sets one, at a `throw` that constructed the error and had already
 * branched on why. A regex over that same error's prose is a second, worse
 * derivation of something already known — and `policy_refused` is reachable no
 * other way, because nothing a provider says can mean *this migration's
 * settings declined it*.
 *
 * Never throws, for any input, including one that is not a string: this runs
 * where a failure is ALREADY being recorded, and a classifier that threw
 * would replace a useful error with a useless one.
 */
export function classifyFailure(
  message: unknown,
  side?: FailureSide,
  stated?: FailureCategory,
): FailureCategory {
  // Checked rather than trusted: a tag written by an older or newer build is
  // as unrenderable on a screen as a value read out of the table, and this
  // function's contract is that it answers with one of `FAILURE_CATEGORIES`.
  if (isFailureCategory(stated)) return stated;
  if (typeof message !== 'string' || message.trim() === '') return 'unknown';
  for (const rule of RULES) {
    if (!rule.test.test(message)) continue;
    return side === 'source' && rule.whenSource ? rule.whenSource : rule.category;
  }
  return 'unknown';
}

/**
 * WHICH SIDE a pass-level failure happened on (workplan 0094 T5, second
 * slice). Recorded at the seam that knows — the shared domain pass tags an
 * error where it calls a SOURCE closure or a TARGET closure — and never
 * parsed out of the prose. Absent when the failure happened on neither (the
 * ledger, a key derivation) or was written by a build that predates it; a
 * screen must then say "one of the two" rather than guess.
 */
export const FAILURE_SIDES = ['source', 'target'] as const;

export type FailureSide = (typeof FAILURE_SIDES)[number];

/** Every side is a known one — for reading a value back out of the table. */
export function isFailureSide(value: unknown): value is FailureSide {
  return (FAILURE_SIDES as ReadonlyArray<unknown>).includes(value);
}
