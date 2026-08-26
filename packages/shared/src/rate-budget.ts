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

/**
 * The byte-aware budget beside the request-aware one (workplan 0090 T2).
 *
 * A different instrument for a different limit. `RateBudget` paces REQUESTS
 * per second and makes callers wait — the right shape for a 429 that costs
 * time. Gmail's IMAP ceiling is 2,500 MB of DOWNLOAD per day (verified 0090
 * T1), and its reported penalty is a ~24-hour lockout of the customer's own
 * live mailbox. Waiting is not an answer at that scale — a caller at the
 * ceiling must STOP AND SAY SO (0090 T4), so this is a meter with a state you
 * can read, never a gate that parks a process for hours.
 *
 * Two properties are load-bearing and easy to lose:
 *
 * - **Counted on fetch, not on write.** The cap is on what the provider
 *   SENDS, so a retry that re-fetches spends the budget again even though the
 *   ledger records the item once. That is the opposite of ADR-0014's
 *   first-copy-only billing rule, and the two must never share a query.
 * - **`spend` never refuses and never waits.** By the time the number exists
 *   the bytes were already fetched; refusing to record them would only hide
 *   what happened (hard rule 9). The GATE is the caller reading the returned
 *   state — or `state()` before the next fetch — and stopping.
 *
 * The window is a fixed 24 hours anchored at the first byte after a reset.
 * Google's own reset rule is unobserved (the open residue of 0090 T1), and a
 * fixed window can admit up to twice the ceiling across two adjacent windows
 * where a true rolling sum would not — the ceiling is configurable per
 * mapping precisely so an operator can set headroom under it.
 */
export interface ByteBudgetConfig {
  /** The provider's ceiling in bytes per day. Must be positive. */
  readonly bytesPerDay: number;
}

export interface ByteBudgetState {
  /** Bytes recorded in the current window. The truth, never clamped. */
  readonly spentBytes: number;
  readonly ceilingBytes: number;
  /** `max(0, ceiling - spent)` — zero means stop, not "wait a moment". */
  readonly remainingBytes: number;
  /**
   * When the current window ends and the meter starts over — or null when no
   * window is running (nothing spent yet, or the last one expired).
   */
  readonly windowResetsAt: Date | null;
}

export interface ByteBudget {
  /**
   * Record bytes that were actually fetched, and answer with the state after
   * recording them. Never refuses, never waits — see above for why.
   */
  spend(tenantId: string, provider: string, bytes: number): Promise<ByteBudgetState>;
  /** Read the state without spending — the pre-fetch gate consults this. */
  state(tenantId: string, provider: string): Promise<ByteBudgetState>;
}

/**
 * A byte budget with its key halves attached — what a connector spends and a
 * pass gate reads (workplan 0090 T3/T4). The budget is keyed by
 * (tenant, provider) because a provider-endpoint limit is shared by every
 * mapping a tenant runs against it; the carrier travels with those two
 * strings so no consumer invents its own.
 */
export interface DownloadMeter {
  readonly budget: ByteBudget;
  readonly tenantId: string;
  readonly provider: string;
}

/**
 * What a pass reports when it stopped at the day's download ceiling (0090
 * T4). A SCHEDULED PAUSE, not an error: nothing failed, nothing is retried,
 * the cursor stays where it is, and the next pass continues by itself. The
 * numbers are the sentence's evidence — what the limit is, how much of it
 * was used, and when it resets.
 */
export interface BudgetPause {
  readonly provider: string;
  readonly ceilingBytes: number;
  readonly spentBytes: number;
  /** ISO timestamp, or null when the meter reported no running window. */
  readonly windowResetsAt: string | null;
}

/** Garbage in, zero recorded: a NaN or negative "size" must not refill the meter. */
function countableBytes(bytes: number): number {
  return Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The single-process byte meter — correct for the appliance (one process is
 * the whole service), and the in-memory twin the pg-backed one must agree
 * with. Managed passes share theirs through the database, because a daily
 * ceiling must survive process restarts and be seen by every runner
 * (`PgByteBudget`, `@openmig/ledger`).
 */
export class InProcessByteBudget implements ByteBudget {
  private readonly windows = new Map<string, { startedAt: number; spent: number }>();
  private readonly ceiling: number;

  private readonly now: () => number;
  constructor(config: ByteBudgetConfig, now: () => number = Date.now) {
    this.now = now;
    this.ceiling = config.bytesPerDay;
    if (!(this.ceiling > 0)) throw new Error(`bytesPerDay must be positive, got ${this.ceiling}`);
  }

  async spend(tenantId: string, provider: string, bytes: number): Promise<ByteBudgetState> {
    const key = `${tenantId}:${provider}`;
    const at = this.now();
    const current = this.windows.get(key);
    const window =
      current && at < current.startedAt + DAY_MS
        ? { startedAt: current.startedAt, spent: current.spent + countableBytes(bytes) }
        : { startedAt: at, spent: countableBytes(bytes) };
    this.windows.set(key, window);
    return this.describe(window);
  }

  async state(tenantId: string, provider: string): Promise<ByteBudgetState> {
    const current = this.windows.get(`${tenantId}:${provider}`);
    if (!current || this.now() >= current.startedAt + DAY_MS) {
      return {
        spentBytes: 0,
        ceilingBytes: this.ceiling,
        remainingBytes: this.ceiling,
        windowResetsAt: null,
      };
    }
    return this.describe(current);
  }

  private describe(window: { startedAt: number; spent: number }): ByteBudgetState {
    return {
      spentBytes: window.spent,
      ceilingBytes: this.ceiling,
      remainingBytes: Math.max(0, this.ceiling - window.spent),
      windowResetsAt: new Date(window.startedAt + DAY_MS),
    };
  }
}

/**
 * Gmail's IMAP download ceiling, in bytes per day — the number workplan 0090
 * is named after, verified from Google's own bandwidth-limits page (T1,
 * 2026-08-26): "Downloaden via IMAP: 2500 MB" per day, per account. Read as
 * decimal megabytes deliberately: Google writes "MB", and 2 500 000 000 is
 * the SMALLER reading, so being wrong about their arithmetic errs toward
 * stopping early rather than toward a locked mailbox.
 */
export const GMAIL_IMAP_DOWNLOAD_BYTES_PER_DAY = 2_500_000_000;

/**
 * Whether an IMAP endpoint gets a download meter, and with which ceiling —
 * the ONE place both editions decide this (hard rule 5).
 *
 * Keyed by the ENDPOINT, never by a connection kind: the ceiling belongs to
 * `imap.gmail.com`, so a plain `imap` connection pointed at Gmail is metered
 * exactly like the `gmail` kind, and a self-hosted Dovecot at any other host
 * gets NO invented cap — a ceiling for a server that has none would be this
 * plan's own way of making migrations mysteriously slow. A configured
 * per-mapping value (`throttleConfig.downloadBytesPerDay`, migration 0017's
 * surface) always wins, for any host — including setting headroom under
 * Gmail's, which the fixed-window note on `ByteBudget` recommends.
 */
export function imapDownloadPlan(
  host: string | undefined,
  configuredBytesPerDay?: number,
): { readonly provider: string; readonly bytesPerDay: number } | undefined {
  if (!host) return undefined;
  const h = host.trim().toLowerCase();
  const gmail = h === 'imap.gmail.com';
  const ceiling = configuredBytesPerDay ?? (gmail ? GMAIL_IMAP_DOWNLOAD_BYTES_PER_DAY : undefined);
  if (!(typeof ceiling === 'number' && ceiling > 0)) return undefined;
  return { provider: gmail ? 'gmail-imap' : `imap:${h}`, bytesPerDay: ceiling };
}

/**
 * The named "counting is somebody else's job" meter — for tests, and for
 * sources whose server has no ceiling (a self-hosted Dovecot). It counts
 * NOTHING: the state always reads as an untouched, infinite budget. A cap
 * invented for a server that has none would be 0090's own way of making
 * migrations mysteriously slow.
 */
export const UNLIMITED_BYTE_BUDGET: ByteBudget = {
  spend: async () => ({
    spentBytes: 0,
    ceilingBytes: Number.POSITIVE_INFINITY,
    remainingBytes: Number.POSITIVE_INFINITY,
    windowResetsAt: null,
  }),
  state: async () => ({
    spentBytes: 0,
    ceilingBytes: Number.POSITIVE_INFINITY,
    remainingBytes: Number.POSITIVE_INFINITY,
    windowResetsAt: null,
  }),
};
