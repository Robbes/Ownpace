// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * `fetch`, but a server saying "too many requests" is waited out rather than
 * turned into a failed item — and waited out in SMALL STEPS.
 *
 * ## Why the steps are small
 *
 * Observed on a real migration, 2026-08-09, Stalwart target, ~500 messages:
 *
 * ```
 * [jmap] 429 from /jmap/upload/c; waiting 40000ms before retry 2/5
 * ```
 *
 * Forty seconds, twice, from concurrent uploads. That number was not invented
 * here — Stalwart sent `Retry-After: 40` and the old code obeyed it literally.
 * The same response's body said:
 *
 *     "Your request has been rate limited. Please try again in a few seconds."
 *
 * The server's header and the server's own prose disagree by an order of
 * magnitude, and the prose was the accurate one: the pass resumed fine.
 *
 * `Retry-After` is advisory. RFC 9110 §10.2.3 defines it as how long the
 * service *expects* to be unavailable, and nothing obliges a client to sleep
 * exactly that long — clients routinely cap it, usually to stop a hostile or
 * misconfigured server parking them for hours. The cap here is for the opposite
 * reason: to stop a conservative server stalling a migration that could have
 * continued. So the ASK is honoured as an upper bound on urgency and the WAIT
 * is capped, which means we probe at {@link RATE_LIMIT_MAX_WAIT_MS} instead of
 * sleeping through a recovery that already happened.
 *
 * The cost of being wrong is one extra request per probe, which is the cheapest
 * thing a rate limiter can refuse. The cost of the old behaviour was up to 40
 * seconds of a migration window, per throttled request, spent asleep after the
 * server was ready.
 *
 * ## …and why the cap does not apply to a long ask
 *
 * That reasoning was then tested on the same server and found to be **half
 * right**. Stalwart has two different mechanisms behind one status code:
 *
 * ```
 * {"title":"Too Many Requests","detail":"…try again in a few seconds."}   Retry-After: 40
 * {"title":"Quota exceeded",   "detail":"…quota of 1000 files or 50000000 bytes."}  Retry-After: 441
 * ```
 *
 * The first is a burst limit and its header really is over-cautious. The second
 * is a QUOTA, and its header counts down accurately to the window rollover —
 * 441s, then 436, then 431. Probing it at five-second intervals produced
 * twenty-four guaranteed-failing requests and burned the whole budget per item
 * before failing anyway.
 *
 * So the cap applies only where it can pay off: when the server asks for longer
 * than the budget, we believe it and stop immediately. Magnitude separates the
 * two cases and nothing else needs to. See the `asked > remaining` branch.
 *
 * ## Why a budget rather than an attempt count
 *
 * The old rule was five attempts, which meant total patience swung between 15
 * seconds (no header, exponential backoff) and 160 seconds (Stalwart's 40s
 * header) with nothing choosing that. An operator cares how long ONE request
 * can stall a pass, not how many times it was re-sent, so that is what is
 * configured. When the budget is spent the 429 is RETURNED, not swallowed —
 * the caller reports it, the item goes to the failure queue, and the next pass
 * picks it up (hard rule 9).
 */

import { parseRetryAfterMs, log } from '@openmig/shared';

/**
 * Total time one request may spend waiting on rate limits before its 429 is
 * handed back to the caller.
 */
export const RATE_LIMIT_TOTAL_BUDGET_MS = 120_000;

/**
 * The longest single sleep, however long the server asked for.
 *
 * Five seconds is short enough that a server recovering "in a few seconds" is
 * noticed almost immediately, and long enough that probing costs a handful of
 * requests rather than a flood.
 */
export const RATE_LIMIT_MAX_WAIT_MS = 5_000;

/** Backoff when the server says "slow down" but does not say for how long. */
export const RATE_LIMIT_BASE_BACKOFF_MS = 250;

/** Statuses that mean "ask me again", as opposed to "this will never work". */
function isRateLimited(status: number): boolean {
  return status === 429 || status === 503;
}

/**
 * Fetch, retrying while the server is rate-limiting, within a time budget.
 *
 * Safe for every call that uses it: JMAP reads (`Email/query`, `Email/get`,
 * `Mailbox/*`) are idempotent, the session document is a GET, and a re-uploaded
 * blob is content-addressed by the server and returns the same `blobId`. 503 is
 * included for the same reason the DAV writers retry it — a target restarting
 * mid-migration should cost seconds, not items.
 *
 * @param label what appears in the log line, e.g. `jmap`.
 */
export async function fetchWithRateLimitRetry(
  url: string,
  init: RequestInit,
  label = 'http',
): Promise<Response> {
  let waitedMs = 0;

  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, init);
    if (!isRateLimited(response.status)) return response;

    const remaining = RATE_LIMIT_TOTAL_BUDGET_MS - waitedMs;
    if (remaining <= 0) {
      // Budget spent. Hand back the 429 itself rather than a synthesised error:
      // the caller's own error path already quotes the status and body, and a
      // server that has refused for two minutes is not merely busy.
      log.warn(
        `[${label}] ${response.status} from ${pathOf(url)}; gave up after ` +
          `${Math.round(waitedMs / 1000)}s of waiting`,
      );
      return response;
    }

    // A HEADER IS A CLAIM BY THE SERVER. A BACKOFF IS A GUESS BY US.
    //
    // Keeping those apart is the whole of the branch below, and conflating them
    // is a bug I wrote and the test caught: the no-header backoff doubles, so
    // by attempt 9 it "asks" for 128s, and an early exit keyed on the number
    // alone then fired on our own invention and abandoned the request after
    // 28s of a 120s budget. Only the server's word is worth obeying; our own
    // guess is only ever worth capping.
    const header = response.headers.get('retry-after');
    let waitMs: number;
    let probingSooner = false;

    if (header) {
      const asked = parseRetryAfterMs(header);

      // BELIEVE A SERVER THAT ASKS FOR LONGER THAN WE CAN WAIT.
      //
      // Probing early only pays off if the server might recover inside the
      // budget. When it asks for longer, every probe is guaranteed to fail --
      // and on 2026-08-09 that guarantee cost real time:
      //
      //   [jmap] 429 ... waiting 5000ms (server asked 441000ms; probing sooner)
      //   ... twenty-four times ...
      //   [jmap] 429 ... gave up after 120s of waiting
      //
      // per item, before failing anyway. That was not a burst limit at all:
      //
      //   {"title":"Quota exceeded","detail":"You have exceeded the blob upload
      //    quota of 1000 files or 50000000 bytes."}
      //
      // A QUOTA, with Retry-After counting down accurately to the window
      // rollover -- 441s, then 436, then 431. The assumption behind the cap,
      // that a server asking for 40s while its body says "a few seconds" is
      // being over-cautious, simply does not hold for it.
      //
      // Magnitude separates the two and nothing else needs to. "Wait 40s" from
      // a busy server is worth testing early. "Wait 441s" when we can spare 120
      // is a fact about a window we cannot outlast, so the useful move is to
      // stop now: the item goes to the retry queue, the pass moves on, and the
      // next scheduled run picks it up after the window has rolled over. One
      // request instead of twenty-five, and none of the budget instead of all.
      if (asked > remaining) {
        await response.text().catch(() => undefined);
        log.warn(
          `[${label}] ${response.status} from ${pathOf(url)}; server asked for ` +
            `${Math.round(asked / 1000)}s, longer than the ${Math.round(remaining / 1000)}s ` +
            'left in the retry budget -- not waiting, the next pass will retry',
        );
        return response;
      }

      waitMs = Math.min(asked, RATE_LIMIT_MAX_WAIT_MS, remaining);
      probingSooner = asked > waitMs;
    } else {
      // Jitter so a pool of workers throttled in the same instant does not
      // resume in lockstep and throttle the target again.
      const backoff = RATE_LIMIT_BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 250;
      waitMs = Math.min(backoff, RATE_LIMIT_MAX_WAIT_MS, remaining);
    }

    // Drain the body so the connection can be reused for the retry.
    await response.text().catch(() => undefined);

    // Say when we are deliberately probing sooner than asked, so a log showing
    // short waits against a server demanding longer ones reads as a choice
    // rather than as a bug.
    log.warn(
      `[${label}] ${response.status} from ${pathOf(url)}; waiting ${Math.round(waitMs)}ms` +
        (probingSooner ? ' (probing sooner than the server asked)' : '') +
        ` -- ${Math.round((remaining - waitMs) / 1000)}s of budget left`,
    );

    await new Promise((resolve) => setTimeout(resolve, waitMs));
    waitedMs += waitMs;
  }
}

/** The path alone, so a log line does not carry credentials in a query string. */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
