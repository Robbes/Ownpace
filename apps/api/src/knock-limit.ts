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
 * **What this is NOT**: distributed, and usually not per-caller either. The
 * counters live in one process, so with N replicas the effective limit is N
 * times what is configured; and the key is `req.ip`, which is the INGRESS's
 * address unless a deployment sets `TRUST_PROXY`. A determined flood is not
 * what this stops. What it stops is the ordinary case — a script, a stuck retry
 * loop, somebody's form submitted forty times — from filling a table before
 * anyone notices, and it does so without a round trip.
 *
 * Both facts are why the default is sized as a service-wide cap rather than as
 * a per-person one. See `DEFAULT_KNOCK_LIMIT`.
 */

/** A fixed window, and how many knocks it allows from one caller. */
export interface KnockLimitConfig {
  readonly windowMs: number;
  readonly max: number;
}

/**
 * An hour, and sixty knocks in it.
 *
 * **Sized as a GLOBAL cap, because that is what it usually is.** The key is
 * `req.ip`, which is the ingress's address unless a deployment sets
 * `TRUST_PROXY` — so on a normal managed deployment every caller shares one
 * bucket. The first version of this said 5, reasoning that "too strict is the
 * safe direction to be wrong in". It is not: five an hour across the whole
 * service means the sixth real person to ask for an account that hour is told
 * to go away, and nobody would find out from a log line. Its own integration
 * test caught it — the suite's sixth request 429'd.
 *
 * Sixty still bounds a runaway to ~1,400 rows a day, which is the job: this is
 * a nuisance gate, and the ingress in front of the service is the real
 * protection. Raise or lower it with `ACCESS_REQUEST_MAX_PER_HOUR`.
 *
 * ## WHEN THE FRONT DOOR OPENS, THIS NUMBER IS NO LONGER SIZED FOR IT
 *
 * Sixty an hour for the whole service is a sane cap for a door only an
 * OPERATOR can open (workplan 0093 T0, invite-only, decided 2026-08-22).
 * Every knock is a row a human then reads and answers, so the binding
 * constraint is not the database — one insert is nothing — it is the mail each
 * knock sends to `NOTIFY_TO` and the queue behind it. A rate the operator can
 * keep up with IS the right rate while asking is a request.
 *
 * Self-service ends that, and the owner has said so (2026-09-01): the limit
 * goes up, sized to what the infrastructure supports rather than to what one
 * person can read.
 *
 * **Raising the number alone would be the wrong half of the change.** The key
 * is still `req.ip`, which behind an ingress is the ingress: one bucket for
 * everybody. Six hundred an hour shared globally is one runaway script away
 * from refusing every real signup on the platform — the same defect the 5/hour
 * version had, just further along. So the pair is:
 *
 *   1. set `TRUST_PROXY` so the key becomes the CALLER (the limiter already
 *      supports this; `index.ts` reads it, and it is off by default because
 *      trusting that header when nothing strips it lets anybody claim any
 *      address), and only then
 *   2. raise `ACCESS_REQUEST_MAX_PER_HOUR` to a per-caller number measured
 *      against the relay's send rate and the ingress's own limits.
 *
 * A test in `knock-limit.unit.test.ts` pins the premise this number rests on —
 * that no self-service route exists yet — so the day one does, it says so.
 */
export const DEFAULT_KNOCK_LIMIT: KnockLimitConfig = {
  windowMs: 60 * 60 * 1000,
  max: 60,
};

/**
 * The configured limit, or the default — with a refusal rather than a silent
 * fallback for a value somebody clearly meant to set (hard rule 9).
 */
export function knockLimitFromEnv(env: NodeJS.ProcessEnv = process.env): KnockLimitConfig {
  const raw = env.ACCESS_REQUEST_MAX_PER_HOUR;
  if (raw === undefined || raw.trim() === '') return DEFAULT_KNOCK_LIMIT;
  const max = Number(raw);
  if (!Number.isInteger(max) || max < 1) {
    throw new Error(
      `ACCESS_REQUEST_MAX_PER_HOUR must be a positive integer; got ${JSON.stringify(raw)}. ` +
        'It is the number of access requests one caller may make per hour — and unless ' +
        'TRUST_PROXY is set, "one caller" is the ingress, so this is a service-wide cap.',
    );
  }
  return { windowMs: DEFAULT_KNOCK_LIMIT.windowMs, max };
}

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
