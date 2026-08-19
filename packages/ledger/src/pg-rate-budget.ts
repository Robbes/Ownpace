// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The shared rate budget, in Postgres (workplan 0082 T5).
 *
 * ## Why Postgres and not Redis
 *
 * There IS a Redis in the managed stack — `trigger-redis` — and it is
 * Trigger.dev's private datastore. Putting our rate state in another product's
 * internal store couples our correctness to its upgrade and eviction policy,
 * which the SAD is careful to keep at arm's length (§12: the orchestrator sees
 * job metadata, nothing else). Adding a SECOND Redis means new infrastructure,
 * a new failure domain and a new thing to back up, for state that is one small
 * row per (tenant, provider).
 *
 * Postgres is already there, already transactional, and already the thing that
 * must be up for a sync to run at all. The cost argument settles it: an acquire
 * is a single round trip of about a millisecond, against a Graph or JMAP call
 * of a hundred or more. The limiter's overhead is under one percent of the work
 * it is pacing.
 *
 * ## Why one statement
 *
 * Read-then-write across two statements is a lost update under concurrency, and
 * concurrency is the entire point of this table. `INSERT … ON CONFLICT DO
 * UPDATE` takes a row lock, so simultaneous acquires for one pair serialise on
 * that row and each sees the previous one's decrement.
 *
 * `clock_timestamp()`, not `now()`: `now()` is transaction START time and is
 * frozen for the transaction's duration, which would refill nothing across
 * repeated attempts inside one.
 */

import { sql } from 'drizzle-orm';
import type { PgDatabase } from './db-types.ts';
import type { RateBudget, RateBudgetConfig } from '@openmig/shared';

/** How long to sleep when a bucket is empty and the server did not say. */
const FALLBACK_WAIT_MS = 50;

/** Never sleep longer than this in one go, so a slow refill stays interruptible. */
const MAX_WAIT_MS = 2_000;

export class PgRateBudget implements RateBudget {
  private readonly rate: number;
  private readonly burst: number;

  private readonly db: PgDatabase;
  constructor(
    db: PgDatabase,
    config: RateBudgetConfig,
  ) {
    this.db = db;
    this.rate = config.requestsPerSecond;
    this.burst = config.burst ?? config.requestsPerSecond;
    if (!(this.rate > 0)) throw new Error(`requestsPerSecond must be positive, got ${this.rate}`);
  }

  async acquire(tenantId: string, provider: string): Promise<void> {
    for (;;) {
      const wait = await this.take(tenantId, provider);
      if (wait <= 0) return;
      await new Promise((resolve) => setTimeout(resolve, Math.min(wait, MAX_WAIT_MS)));
    }
  }

  /**
   * Take a token if the bucket has one; otherwise return how long to wait.
   *
   * The refill is computed in SQL from the row's own `refilled_at`, so it is
   * exact regardless of how the callers happen to be scheduled and regardless
   * of any clock skew between the processes calling it — the only clock that
   * matters is the database's.
   */
  private async take(tenantId: string, provider: string): Promise<number> {
    const rows = await this.db.execute(sql`
      INSERT INTO rate_budget (tenant_id, provider, tokens, refilled_at)
      VALUES (${tenantId}::uuid, ${provider}, ${this.burst - 1}, clock_timestamp())
      ON CONFLICT (tenant_id, provider) DO UPDATE
        SET tokens = LEAST(
              ${this.burst}::double precision,
              rate_budget.tokens
                + EXTRACT(EPOCH FROM (clock_timestamp() - rate_budget.refilled_at))
                  * ${this.rate}::double precision
            ) - 1,
            refilled_at = clock_timestamp()
        WHERE LEAST(
              ${this.burst}::double precision,
              rate_budget.tokens
                + EXTRACT(EPOCH FROM (clock_timestamp() - rate_budget.refilled_at))
                  * ${this.rate}::double precision
            ) >= 1
      RETURNING tokens
    `);

    // A row came back: the token was ours. No row: the WHERE refused, so the
    // bucket is short and nothing was written — including `refilled_at`, which
    // is why a denied attempt cannot lose the time it waited.
    if (resultRows<{ tokens: unknown }>(rows).length > 0) return 0;

    const deficit = await this.deficit(tenantId, provider);
    return deficit ?? FALLBACK_WAIT_MS;
  }

  /** How long until one token exists, in ms — or null if the row vanished. */
  private async deficit(tenantId: string, provider: string): Promise<number | null> {
    const rows = await this.db.execute(sql`
      SELECT GREATEST(0, (1 - LEAST(
               ${this.burst}::double precision,
               tokens + EXTRACT(EPOCH FROM (clock_timestamp() - refilled_at))
                        * ${this.rate}::double precision
             )) / ${this.rate}::double precision) * 1000 AS wait_ms
        FROM rate_budget
       WHERE tenant_id = ${tenantId}::uuid AND provider = ${provider}
    `);
    const first = resultRows<{ wait_ms: unknown }>(rows)[0];
    if (!first) return null;
    // Postgres returns double precision as a number here, but a driver that
    // hands back a numeric string would otherwise make Math.ceil produce NaN
    // and spin this loop at full speed — the opposite of a rate limiter.
    const ms = Number(first.wait_ms);
    return Number.isFinite(ms) ? Math.max(1, Math.ceil(ms)) : FALLBACK_WAIT_MS;
  }
}

/**
 * The rows out of a driver's result.
 *
 * node-postgres answers `{ rows }`; drizzle's pglite path answers an array
 * directly. Checked rather than assumed after 0082 T2 shipped a fallback for a
 * difference that turned out not to exist — here the difference is real, and
 * an unrecognised shape reads as "no row", which makes the caller WAIT rather
 * than proceed. That is the safe direction for a rate limiter.
 */
function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}
