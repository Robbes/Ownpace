// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A refusing rate limit for the one route anybody on the internet can reach
 * (workplan 0093 T2).
 *
 * **Why not `RateBudget`**, which this repo already has: its `acquire` WAITS
 * rather than refuses — the right semantics for a provider quota, where "a
 * migration that fails because it was busy is worse than one that takes
 * longer", and exactly the wrong ones for an abuse gate, where waiting is a
 * queue of attackers holding request threads open. This says no.
 *
 * **Why not `express-rate-limit`**: a new runtime dependency on the API for
 * twenty lines, on a service whose real protection is the ingress in front of
 * it. Same reasoning `/metrics` is documented with — unauthenticated here,
 * fronted there.
 *
 * **What this is NOT**: distributed. The counters live in one process, so with
 * N replicas the effective limit is N times what is configured, and a
 * determined flood is not what this stops. What it stops is the ordinary case —
 * a script, a stuck retry loop, somebody's form submitted forty times — from
 * filling a table before anyone notices, and it does so without a round trip.
 * Said here rather than discovered later.
 */

/** A fixed window, and how many knocks it allows from one caller. */
export interface KnockLimitConfig {
  readonly windowMs: number;
  readonly max: number;
}

export const DEFAULT_KNOCK_LIMIT: KnockLimitConfig = {
  windowMs: 60 * 60 * 1000,
  // Generous on purpose: a person who mistypes their email and submits again
  // must not be told to come back in an hour, and nothing here is expensive.
  max: 5,
};

export interface KnockLimiter {
  /** True when this caller may proceed; false to refuse with 429. */
  take(key: string, now?: number): boolean;
  /** Seconds until `key` may knock again, for `Retry-After`. */
  retryAfterSeconds(key: string, now?: number): number;
}

/**
 * A fixed-window counter per key.
 *
 * Fixed rather than sliding because the failure mode of a fixed window — twice
 * the allowance across a boundary — is irrelevant at these numbers, and a
 * sliding window costs a list per key where this costs two integers. The map is
 * swept lazily on write, so an idle process does not hold yesterday's callers.
 */
export function createKnockLimiter(
  config: KnockLimitConfig = DEFAULT_KNOCK_LIMIT,
): KnockLimiter {
  const windows = new Map<string, { count: number; startedAt: number }>();

  const current = (key: string, now: number): { count: number; startedAt: number } | undefined => {
    const window = windows.get(key);
    if (!window) return undefined;
    if (now - window.startedAt >= config.windowMs) {
      windows.delete(key);
      return undefined;
    }
    return window;
  };

  return {
    take(key, now = Date.now()) {
      // Sweep before inserting, so the map cannot grow without bound on a
      // process that runs for months. Cheap: it only walks on a new window.
      if (windows.size > 10_000) {
        for (const [k, w] of windows) if (now - w.startedAt >= config.windowMs) windows.delete(k);
      }
      const window = current(key, now);
      if (!window) {
        windows.set(key, { count: 1, startedAt: now });
        return true;
      }
      if (window.count >= config.max) return false;
      window.count += 1;
      return true;
    },
    retryAfterSeconds(key, now = Date.now()) {
      const window = current(key, now);
      if (!window) return 0;
      return Math.max(1, Math.ceil((window.startedAt + config.windowMs - now) / 1000));
    },
  };
}
