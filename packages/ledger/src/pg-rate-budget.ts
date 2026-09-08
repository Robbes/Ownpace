// Copyright 2026 The Ownpace authors (Apache-2.0)

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
import type {
  ByteBudget,
  ByteBudgetConfig,
  ByteBudgetState,
  RateBudget,
  RateBudgetConfig,
} from '@openmig/shared';

/** How long to sleep when a bucket is empty and the server did not say. */
const FALLBACK_WAIT_MS = 50;

/** Never sleep longer than this in one go, so a slow refill stays interruptible. */
const MAX_WAIT_MS = 2_000;

/** A tenant id shaped like one. The column is `uuid`; this refuses earlier. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PgRateBudget implements RateBudget {
  private readonly rate: number;
  private readonly burst: number;

  /**
   * OUR TENANT, BOUND AT CONSTRUCTION — never the one the caller passes.
   *
   * `RateBudget.acquire(scope, provider)` reads like it takes a tenant, and
   * the module header opposite says the `(tenant, provider)` keying "was right
   * from the start". The design was. The WIRING never delivered a tenant, and
   * on 2026-09-08 it turned out no caller ever had:
   *
   *   - the four Graph sources pass `this.config.tenantId` — the ENTRA tenant,
   *     which for a multi-tenant app registration is the literal `common`;
   *   - the three DAV sources pass the literal string `'dav'`;
   *   - the mail sources never call the shared budget at all, only
   *     `handleRateLimited`.
   *
   * So `${tenantId}::uuid` had never once been handed a uuid, and this budget
   * had never written a row in production. It stayed invisible because the
   * only path that built a `PgRateBudget` was the mail one, whose sources do
   * not reach it — until the four non-mail faces were given a limiter and
   * every domain of a Microsoft preflight died on `invalid input syntax for
   * type uuid: "common"`.
   *
   * The crash is the lesser half. `common` is the SAME STRING for every
   * customer of one multi-tenant app, so a budget keyed on it would have been
   * one bucket shared by every tenant on the deployment — the exact opposite
   * of the per-tenant quota this class exists to keep. A cast error that is
   * loud is a kinder failure than a limiter that silently throttles strangers
   * against each other.
   *
   * The fix is the shape `PgByteBudget`'s caller already uses: the seam that
   * KNOWS the tenant (`tenantThrottleLimiter`) binds it, and the connector's
   * argument is treated as what it actually is — a scope label.
   */
  private readonly tenantId: string;

  private readonly db: PgDatabase;
  constructor(
    db: PgDatabase,
    config: RateBudgetConfig & { readonly tenantId: string },
  ) {
    this.db = db;
    this.rate = config.requestsPerSecond;
    this.burst = config.burst ?? config.requestsPerSecond;
    if (!(this.rate > 0)) throw new Error(`requestsPerSecond must be positive, got ${this.rate}`);
    // REFUSED HERE, not at the first request. A bad tenant is a wiring fault,
    // and a wiring fault should stop the build of the deps rather than surface
    // as a Postgres cast error in the middle of somebody's migration, one per
    // domain, with the SQL in the report (0090 T4's rule: refuse before the
    // lockout, not after).
    this.tenantId = config.tenantId;
    if (!UUID.test(this.tenantId)) {
      throw new Error(
        `PgRateBudget needs this deployment's tenant id, got ${JSON.stringify(this.tenantId)}. ` +
          'A provider-side tenant (Entra\'s `common`) or a protocol label (`dav`) is not one — ' +
          'see the tenantId field for why that distinction is the whole point of this class.',
      );
    }
  }

  /**
   * @param _scope What the connector calls its tenant: `dav`, or the Entra
   *   tenant. DELIBERATELY UNUSED for the row key — see `tenantId`. It stays
   *   in the signature because `RateBudget` is a port with a second
   *   implementation (`InProcessRateBudget`), whose per-process map may key by
   *   it harmlessly; folding it in here would fragment one tenant's real quota
   *   into a bucket per label.
   */
  async acquire(_scope: string, provider: string): Promise<void> {
    for (;;) {
      const wait = await this.take(this.tenantId, provider);
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
 * The daily byte meter, in Postgres (workplan 0090 T2) — the shared twin of
 * `InProcessByteBudget`, same table reasoning as `PgRateBudget` above: the
 * ceiling belongs to the provider's endpoint, every runner spends against it,
 * and a daily window must survive process restarts, so the state lives in the
 * one store that is already up whenever a sync runs (migration 0030,
 * `byte_budget`).
 *
 * `spend` is one statement for the same reason `take` is: read-then-write
 * across two statements loses updates under concurrency, and two runners
 * fetching for one tenant concurrently is the normal case, not the edge. The
 * window check and the accumulate-or-reset both happen inside the upsert, so
 * simultaneous spends serialise on the row and each sees the other's bytes.
 *
 * `spend` never refuses and never waits — the bytes were already fetched by
 * the time the number exists, and hiding them would be masking (hard rule 9).
 * The GATE is the caller reading the state and stopping (0090 T4).
 */
export class PgByteBudget implements ByteBudget {
  private readonly ceiling: number;

  private readonly db: PgDatabase;
  constructor(db: PgDatabase, config: ByteBudgetConfig) {
    this.db = db;
    this.ceiling = config.bytesPerDay;
    if (!(this.ceiling > 0)) throw new Error(`bytesPerDay must be positive, got ${this.ceiling}`);
  }

  async spend(tenantId: string, provider: string, bytes: number): Promise<ByteBudgetState> {
    // Garbage in, zero recorded — a NaN or negative "size" must not refill
    // the meter. Rounded because the column counts whole bytes.
    const n = Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes) : 0;
    const rows = await this.db.execute(sql`
      INSERT INTO byte_budget (tenant_id, provider, window_started_at, spent_bytes)
      VALUES (${tenantId}::uuid, ${provider}, clock_timestamp(), ${n}::bigint)
      ON CONFLICT (tenant_id, provider) DO UPDATE SET
        spent_bytes = CASE
          WHEN clock_timestamp() >= byte_budget.window_started_at + interval '24 hours'
          THEN ${n}::bigint
          ELSE byte_budget.spent_bytes + ${n}::bigint
        END,
        window_started_at = CASE
          WHEN clock_timestamp() >= byte_budget.window_started_at + interval '24 hours'
          THEN clock_timestamp()
          ELSE byte_budget.window_started_at
        END
      RETURNING spent_bytes::text AS spent_bytes, window_started_at
    `);
    const row = resultRows<{ spent_bytes: string; window_started_at: unknown }>(rows)[0];
    // The upsert always returns its row; a driver that hands back nothing is
    // answered with the SAFE reading — a full window — so a broken read makes
    // the caller stop early rather than fetch uncounted.
    if (!row) {
      return {
        spentBytes: this.ceiling,
        ceilingBytes: this.ceiling,
        remainingBytes: 0,
        windowResetsAt: null,
      };
    }
    return this.describe(Number(row.spent_bytes), row.window_started_at);
  }

  async state(tenantId: string, provider: string): Promise<ByteBudgetState> {
    const rows = await this.db.execute(sql`
      SELECT spent_bytes::text AS spent_bytes, window_started_at,
             (clock_timestamp() >= window_started_at + interval '24 hours') AS expired
        FROM byte_budget
       WHERE tenant_id = ${tenantId}::uuid AND provider = ${provider}
    `);
    const row = resultRows<{ spent_bytes: string; window_started_at: unknown; expired: unknown }>(
      rows,
    )[0];
    if (!row || row.expired === true || row.expired === 't') {
      return {
        spentBytes: 0,
        ceilingBytes: this.ceiling,
        remainingBytes: this.ceiling,
        windowResetsAt: null,
      };
    }
    return this.describe(Number(row.spent_bytes), row.window_started_at);
  }

  private describe(spentRaw: number, windowStartedAt: unknown): ByteBudgetState {
    // A driver handing back a shape Number() cannot read must err SHORT — an
    // unreadable meter that reads as empty would count nothing, the exact
    // failure this table exists to fix.
    const spent = Number.isFinite(spentRaw) ? spentRaw : this.ceiling;
    const started = new Date(windowStartedAt as string | number | Date);
    return {
      spentBytes: spent,
      ceilingBytes: this.ceiling,
      remainingBytes: Math.max(0, this.ceiling - spent),
      windowResetsAt: Number.isNaN(started.getTime())
        ? null
        : new Date(started.getTime() + 24 * 60 * 60 * 1000),
    };
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
