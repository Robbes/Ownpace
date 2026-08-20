// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A rate budget one process does not own on its own (workplan 0082 T5).
 *
 * `ThrottleLimiter` keyed its buckets by `(tenant, provider)` from the start —
 * the design was right. What was wrong is where the buckets lived: a `Map` on
 * an instance built per `buildDepsFromMapping` call, which is per mapping pass.
 *
 * On self-host that is fine and is still what runs: one tenant, one appliance
 * process, so in-process IS the whole service. In managed it is close to no
 * limit at all — Trigger.dev runs every task run in its own process, so two
 * passes for one tenant each hold a private full-size bucket, and the more the
 * service scales the more copies of the "limit" exist. The resource being
 * protected is shared and singular: SAD §13 specifies ONE multi-tenant Entra
 * app, so Microsoft's per-app and per-tenant quotas are spent by every customer
 * through the same credential.
 *
 * A port rather than a direct dependency, for the reason the `Scheduler` port
 * exists (ADR-0004): the two editions genuinely need different implementations,
 * and hard rule 5 says they must not differ in BEHAVIOUR. One interface, one
 * set of semantics, two places to keep the state.
 */

/**
 * Permission to make one request against a provider, on behalf of one tenant.
 *
 * `acquire` resolves when the caller may proceed and is expected to WAIT
 * rather than refuse: a migration that fails because it was busy is worse than
 * one that takes longer. Implementations must be safe to call concurrently
 * from anywhere, including other processes.
 */
export interface RateBudget {
  acquire(tenantId: string, provider: string): Promise<void>;
}

/** Requests per second a single (tenant, provider) pair may make. */
export interface RateBudgetConfig {
  readonly requestsPerSecond: number;
  /** Burst size. Defaults to one second's worth, which is the classic bucket. */
  readonly burst?: number;
}

/**
 * The single-process budget: correct for the appliance, and the fallback for
 * managed when no shared store is wired.
 *
 * Kept rather than deleted because it is the RIGHT answer on self-host — there
 * is one process, so process-local state is service-wide state — and because a
 * managed deployment that has not yet run migration 0024 must degrade to the
 * old behaviour rather than fail to sync.
 */
export class InProcessRateBudget implements RateBudget {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  private readonly rate: number;
  private readonly burst: number;

  private readonly now: () => number;
  constructor(config: RateBudgetConfig, now: () => number = Date.now) {
    this.now = now;
    this.rate = config.requestsPerSecond;
    this.burst = config.burst ?? config.requestsPerSecond;
  }

  async acquire(tenantId: string, provider: string): Promise<void> {
    const key = `${tenantId}:${provider}`;
    for (;;) {
      const wait = this.take(key);
      if (wait <= 0) return;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }

  /** Take a token if one is available; otherwise say how long to wait, in ms. */
  private take(key: string): number {
    const at = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.burst, at };
    const refilled = Math.min(this.burst, bucket.tokens + ((at - bucket.at) / 1000) * this.rate);
    if (refilled >= 1) {
      this.buckets.set(key, { tokens: refilled - 1, at });
      return 0;
    }
    // Store the refill even when denied, so `at` advances and the next call
    // does not recompute the same elapsed window twice.
    this.buckets.set(key, { tokens: refilled, at });
    return Math.ceil(((1 - refilled) / this.rate) * 1000);
  }
}

/**
 * A budget that never waits — for tests, and for a caller that has decided
 * limiting is somebody else's job.
 *
 * Named rather than expressed as `undefined` at call sites, so "no limiting
 * here" reads as a decision in the code that made it.
 */
export const UNLIMITED_RATE_BUDGET: RateBudget = {
  acquire: async () => {},
};
