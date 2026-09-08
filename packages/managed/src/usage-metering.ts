// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Usage metering — every figure DERIVED AT READ, none of them written.
 *
 * ## What this used to be, and why it changed
 *
 * The design was a hybrid: storage and egress derived from the `item` ledger
 * ("perfect idempotency", said the header), compute and sync operations
 * UPSERTED into `usage_metric` from each job run ("retry-safe"). Workplan 0121
 * fixed the upsert's key, which was per PERIOD rather than per pass, so a
 * month of 15-minute passes recorded the duration of the last one. That fix
 * was right and it cost 2 976 rows per mapping per month — measured at
 * 18.7 MB, on a table nothing prunes.
 *
 * The owner asked the obvious question: why write those rows at all?
 *
 * ## Nothing is written now
 *
 * Compute and sync operations derive from the `run` table, exactly as storage
 * and egress derive from `item`. A `run` row is one pass of one mapping. It is
 * written regardless of billing, carries `started_at` and `finished_at`, and
 * always closes (#860). `SUM(finished_at - started_at)` over a period IS the
 * compute; `COUNT(*)` IS the number of sync operations. No second record, no
 * rows, and idempotency by construction rather than by care — you cannot
 * double-count what you never wrote.
 *
 * `usage_metric` consequently has NO WRITER AT ALL. It is left in place
 * holding what 0121 wrote before this landed; nothing reads it any more.
 *
 * ## What makes this safe to prune later
 *
 * Deriving billing from `run` would ordinarily make that table load-bearing
 * for ever — and every OTHER reader of it touches only the newest 21 rows per
 * mapping (`listRunsWithEvents`) or rows still `running`/`queued` (the sync
 * tick, the purge, the erasure quiesce). Its historical body has no other
 * consumer. So `recordUsageOnInvoice` freezes the measured quantities onto the
 * invoice at issue, where ADR-0044 makes them immutable, and the run rows go
 * back to being audit trail. Retention on `run` is then a storage decision
 * rather than a correctness one. Do not remove that freeze.
 *
 * Security: All operations use withTenant for RLS enforcement.
 */

import { type PgDatabase } from '@openmig/ledger/db';
import { and, eq, inArray, gte, lt, isNotNull, sql, type SQL } from 'drizzle-orm';
import * as ledgerSchema from '@openmig/ledger/schema-pg';
import * as billingSchema from './schema-managed.ts';

// One `schema` namespace over two modules, so the query bodies below read
// exactly as they did before the tables moved (ADR-0036). The core tables this
// meters FROM stay in the ledger; the table it meters INTO is billing's.
const schema = { ...ledgerSchema, ...billingSchema };
import type { TenantId } from '@openmig/shared';

export interface UsageMetricsResult {
  storageBytes: number;
  egressBytes: number;
  computeHours: number;
  apiCallCount: number;
}

/**
 * The half-open instant range a billing period actually covers.
 *
 * `periodStart` and `periodEnd` are DATES — '2026-07-01', '2026-07-31'. The
 * columns they are compared against are TIMESTAMPS. A date promoted to a
 * timestamp is that date at MIDNIGHT, so `<= periodEnd` means
 * `<= 2026-07-31T00:00:00Z` and silently excludes everything that happened on
 * the 31st. A month loses its last day; February loses 1/28th of itself.
 *
 * Both derivations ask `[from, until)` instead, with `until` the midnight that
 * starts the following day. One function so the two cannot drift again: this
 * bug existed in `deriveStorageAndEgressForPeriod` while
 * `deriveComputeForPeriod` was written correctly beside it, which is exactly
 * the shape that makes two figures on one invoice disagree.
 */
export function billingWindow(periodStart: string, periodEnd: string): { from: Date; until: Date } {
  const from = new Date(periodStart);
  const until = new Date(periodEnd);
  until.setUTCDate(until.getUTCDate() + 1);
  return { from, until };
}

/**
 * Derive storage and egress usage from item ledger for a billing period.
 * 
 * Uses derive-at-read approach: no writes, computed on-demand from immutable ledger.
 * Filters items by lastSyncedAt to get period-specific usage.
 * 
 * @param db - PostgreSQL database client (already tenant-scoped via withTenant)
 * @param tenantId - Tenant ID (for validation, RLS already enforced)
 * @param periodStart - Period start date (YYYY-MM-DD format)
 * @param periodEnd - Period end date (YYYY-MM-DD format)
 * @returns Storage and egress bytes (identical values)
 */
export async function deriveStorageAndEgressForPeriod(
  db: PgDatabase,
  tenantId: TenantId,
  periodStart: string,
  periodEnd: string
): Promise<{ storageBytes: number; egressBytes: number }> {
  const storage = billingWindow(periodStart, periodEnd);
  // Build WHERE conditions
  const conditions: SQL[] = [
    eq(schema.item.tenantId, tenantId),
    inArray(schema.item.status, ['copied', 'updated', 'skipped']),
    // Filter by lastSyncedAt - items with NULL are automatically excluded.
    // Half-open: `lte(periodEnd)` compared a timestamp against a DATE, which
    // is that date at midnight, so every item synced on the last day of the
    // period went uncounted. See `billingWindow`.
    gte(schema.item.lastSyncedAt, storage.from),
    lt(schema.item.lastSyncedAt, storage.until),
  ];

  const result = await db.select({
    storageBytes: sql<number>`COALESCE(SUM(${schema.item.sizeBytes}), 0)`,
  })
  .from(schema.item)
  .where(and(...conditions));

  const storageBytes = Number(result[0]?.storageBytes ?? 0);
  
  // Egress = Storage (every synced byte is both read AND retained)
  return {
    storageBytes,
    egressBytes: storageBytes,
  };
}

/**
 * The RUN KINDS that count as billable compute.
 *
 * `run.kind` allows six values and only two are ever written: `incremental`
 * by the delta pass (both editions) and `initial_copy` by the full sync.
 * `cutover`, `verify`, `discovery` and `backup` are in the CHECK constraint
 * with no writer — verification keeps its own `verification_run` table — so
 * naming them here would be a filter against rows that cannot exist.
 *
 * Listed rather than left open BECAUSE the list will grow: the day something
 * starts writing `verify` rows, whether a verification run is billable
 * compute is a pricing answer somebody has to give, and an open filter would
 * answer it silently by starting to charge for it.
 */
export const BILLABLE_RUN_KINDS = ['initial_copy', 'incremental'] as const;

/** Compute for a period, and where it went. */
export interface ComputeUsage {
  /** Wall-clock hours across every billable pass that finished in the period. */
  computeHours: number;
  /** How many such passes ran — the "sync operations" the invoice counts. */
  passCount: number;
  /** Seconds per domain, from `run.stats.domainSeconds`. Empty before #866. */
  byDomain: Record<string, number>;
}

/**
 * Derive compute for a billing period from the run ledger. No writes.
 *
 * ## The window is half-open, deliberately
 *
 * `periodEnd` is a DATE ('2026-07-31'), and a date compared against a
 * timestamp is that date at midnight — so `<= periodEnd` silently drops
 * everything that happened ON the last day of the month. This asks for
 * `< periodEnd + 1 day` instead, which is the whole month.
 *
 * `deriveStorageAndEgressForPeriod` above had the same bug and was fixed in
 * the same shape (owner's go-ahead, 2026-09-08); both now share
 * `billingWindow` so they cannot drift apart again.
 *
 * ## Why wall clock, and what it includes
 *
 * A run covers every domain of one mapping, so its duration includes the gaps
 * between domains and the run-ledger bookkeeping. That is the time the machine
 * was actually occupied on this customer's behalf, which is the honest thing
 * to price compute on — and it is a slightly LARGER number than the sum of the
 * per-domain passes that 0121 metered. Said out loud because an invoice line
 * quietly changing meaning is worse than one that changes visibly.
 *
 * A pass killed outright (an OOM, a `maxDuration` kill) never closes, so it
 * has no `finished_at` and contributes nothing. That matches the policy the
 * upsert had — it only ever metered on the success path — so nothing is billed
 * now that was not billed before.
 */
export async function deriveComputeForPeriod(
  db: PgDatabase,
  tenantId: TenantId,
  periodStart: string,
  periodEnd: string,
): Promise<ComputeUsage> {
  const { from, until } = billingWindow(periodStart, periodEnd);

  const window = and(
    eq(schema.run.tenantId, tenantId),
    gte(schema.run.createdAt, from),
    lt(schema.run.createdAt, until),
    inArray(schema.run.kind, [...BILLABLE_RUN_KINDS]),
    isNotNull(schema.run.finishedAt),
  );

  const [totals] = await db
    .select({
      seconds: sql<string>`COALESCE(SUM(EXTRACT(EPOCH FROM (${schema.run.finishedAt} - ${schema.run.startedAt}))), 0)`,
      passes: sql<string>`COUNT(*)`,
    })
    .from(schema.run)
    .where(window);

  // The per-domain split, folded IN THE DATABASE rather than by reading every
  // row's `stats` into the process. A 50-mailbox customer's month is ~148 800
  // run rows; shipping their jsonb here to sum five numbers would undo the
  // point of not writing rows in the first place.
  const perDomain = await db
    .select({
      domain: sql<string>`d.key`,
      seconds: sql<string>`SUM(d.value::numeric)`,
    })
    .from(sql`${schema.run}, jsonb_each_text(COALESCE(${schema.run.stats} -> 'domainSeconds', '{}'::jsonb)) AS d`)
    .where(window)
    .groupBy(sql`d.key`);

  const byDomain: Record<string, number> = {};
  for (const row of perDomain) byDomain[row.domain] = Number(row.seconds);

  return {
    computeHours: Number(totals?.seconds ?? 0) / 3600,
    passCount: Number(totals?.passes ?? 0),
    byDomain,
  };
}

/**
 * Every usage figure for a tenant and period — all four derived, none stored.
 *
 * Storage and egress come from the `item` ledger, compute and sync operations
 * from the `run` ledger. `usage_metric` is not read: it has no writer, and the
 * rows 0121 left in it would double-count anything still in range.
 */
export async function getUsageMetricsForPeriod(
  db: PgDatabase,
  tenantId: TenantId,
  periodStart: string,
  periodEnd: string
): Promise<UsageMetricsResult> {
  const { storageBytes, egressBytes } = await deriveStorageAndEgressForPeriod(
    db,
    tenantId,
    periodStart,
    periodEnd
  );
  const compute = await deriveComputeForPeriod(db, tenantId, periodStart, periodEnd);

  return {
    storageBytes,
    egressBytes,
    computeHours: compute.computeHours,
    // One pass is one sync operation. Keyed per period the old upsert made
    // this the count of DOMAINS that had ever run in the month; keyed per
    // pass it was a row each; derived it is simply how many runs there were.
    apiCallCount: compute.passCount,
  };
}
