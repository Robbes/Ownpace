// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Usage Metering Service
 * 
 * Handles usage metering from real migration runs.
 * Implements hybrid approach:
 * - Storage/Egress: Derive-at-read from item ledger (perfect idempotency)
 * - Compute/API calls: Idempotent upsert from job runs (retry-safe)
 * 
 * Security: All operations use withTenant for RLS enforcement.
 */

import { type PgDatabase } from '@openmig/ledger/db';
import { and, eq, inArray, gte, lte, sql, type SQL } from 'drizzle-orm';
import * as ledgerSchema from '@openmig/ledger/schema-pg';
import * as billingSchema from './schema-managed.ts';

// One `schema` namespace over two modules, so the query bodies below read
// exactly as they did before the tables moved (ADR-0036). The core tables this
// meters FROM stay in the ledger; the table it meters INTO is billing's.
const schema = { ...ledgerSchema, ...billingSchema };
import type { TenantId, MappingId } from '@openmig/shared';
import type { DiscoveryDomain } from '@openmig/shared';

export interface UsageMetricsResult {
  storageBytes: number;
  egressBytes: number;
  computeHours: number;
  apiCallCount: number;
}

export interface ComputeUsageInput {
  tenantId: TenantId;
  mappingId: MappingId;
  domain: DiscoveryDomain;
  /**
   * WHICH PASS this measurement is of (workplan 0121).
   *
   * The row's key, not a label. Before this, compute was keyed by
   * (tenant, period, metricType, `domain-<domain>`) and the write REPLACED —
   * so a period's compute for a domain was the duration of the LAST pass
   * metered in it, while the invoice line said "compute hours". A month of
   * 15-minute passes billed one pass.
   *
   * Keyed by the run instead, the write is still idempotent — a Trigger.dev
   * retry of the same run rewrites its OWN row rather than adding a second —
   * and the read sums, which it already did. That is the whole change: the
   * same upsert, a narrower key.
   */
  runId: string;
  startedAt: Date;
  completedAt: Date;
  periodStart: string;
  periodEnd: string;
}

export interface ApiCallUsageInput {
  tenantId: TenantId;
  mappingId: MappingId;
  domain: DiscoveryDomain;
  /** Which pass — see `ComputeUsageInput.runId`. Same key, same reason. */
  runId: string;
  periodStart: string;
  periodEnd: string;
}

/**
 * The row key for one measurement of one pass.
 *
 * ONE function, used by both meters, because the property that matters is
 * that the key is per-run and both of them have it — a metric keyed per
 * period behaves completely reasonably on its own and is simply wrong when
 * summed beside one that is not.
 */
export function perPassResource(kind: 'domain' | 'sync', domain: string, runId: string): string {
  return `${kind}-${domain}#${runId}`;
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
  // Build WHERE conditions
  const conditions: SQL[] = [
    eq(schema.item.tenantId, tenantId),
    inArray(schema.item.status, ['copied', 'updated', 'skipped']),
    // Filter by lastSyncedAt - items with NULL are automatically excluded
    gte(schema.item.lastSyncedAt, new Date(periodStart)),
    lte(schema.item.lastSyncedAt, new Date(periodEnd)),
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
 * Record compute usage for ONE PASS, via idempotent upsert.
 *
 * ## What was wrong with it
 *
 * The key was (tenantId, periodStart, metricType, `domain-<domain>`) and the
 * write REPLACES rather than increments — which is what makes it retry-safe,
 * and is also what made the number mean the wrong thing. One row per domain
 * per PERIOD, overwritten by each pass, so a month of 15-minute passes
 * recorded the duration of the LAST one. The invoice line said "compute
 * hours" and carried the length of a single pass: at a 20-second pass and
 * €0.05/hour, €0.00 for a month of continuous copying.
 *
 * ## The fix, which is a narrower key and nothing else
 *
 * The row is keyed by the RUN as well, so each pass has its own and the
 * period's compute is their sum — which is what the read already did
 * (`getUsageMetricsForPeriod`). The upsert stays: a Trigger.dev retry of the
 * same run rewrites its own row rather than adding a second, so retry-safety
 * is kept rather than traded away. That was the whole objection to simply
 * making the write accumulate.
 *
 * Owner's decision, 2026-09-08, chosen over accumulate-in-place and over
 * leaving it: *"the actual measures of compute are for me to understand if the
 * pricing is somewhat balanced and fair"* — which needs the per-pass grain,
 * not only a correct total.
 *
 * Key: (tenantId, periodStart, metricType, resource)
 * where resource = `domain-<domain>#<runId>` for compute
 * 
 * @param db - PostgreSQL database client (already tenant-scoped)
 * @param input - Compute usage input with timing info
 * @param pricing - Pricing configuration
 */
export async function recordComputeForRun(
  db: PgDatabase,
  input: ComputeUsageInput,
  pricing: { computePricePerHour: number }
): Promise<void> {
  const durationMinutes = (input.completedAt.getTime() - input.startedAt.getTime()) / (1000 * 60);
  const durationHours = durationMinutes / 60;
  // EXACT, not rounded to the cent. `total_cost` is `numeric`, and once the
  // row is per PASS the rounding that used to happen once a month happens
  // 2 976 times: at €0.05/hour a 20-second pass costs 0.028 cents, which
  // `Math.round` makes 0, and a month of them sums to 0 while the same passes
  // sum to 16.5 real hours. The invoice never read this column — it prices the
  // SUMMED hours through `calculateCost`, which rounds once, at the end, where
  // rounding belongs — but the usage history does, and it would have shown a
  // month of work costing nothing beside a cost line saying otherwise.
  const cost = durationHours * pricing.computePricePerHour;

  await db.insert(schema.usageMetric)
    .values({
      tenantId: input.tenantId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      metricType: 'compute',
      resource: perPassResource('domain', input.domain, input.runId),
      quantity: String(durationHours),
      unit: 'hours',
      unitPrice: String(pricing.computePricePerHour),
      totalCost: String(cost),
      metadata: {
        mappingId: input.mappingId,
        domain: input.domain,
        runId: input.runId,
        startedAt: input.startedAt.toISOString(),
        completedAt: input.completedAt.toISOString(),
        durationMinutes,
      },
    })
    .onConflictDoUpdate({
      target: [
        schema.usageMetric.tenantId,
        schema.usageMetric.periodStart,
        schema.usageMetric.metricType,
        schema.usageMetric.resource,
      ],
      set: {
        quantity: String(durationHours),
        totalCost: String(cost),
        updatedAt: new Date(),
      },
    });
}

/**
 * Record ONE sync operation, via idempotent upsert.
 *
 * The same defect as compute above and the same fix: keyed per period and
 * overwritten with `quantity: '1'`, the count of sync operations in a month
 * was the number of DOMAINS that had ever run in it — never more than five,
 * whether the mapping synced twice or three thousand times. Keyed by the run,
 * each pass is its own row and the read's sum is the count.
 *
 * Key: (tenantId, periodStart, metricType, resource)
 * where resource = `sync-<domain>#<runId>` for api_calls
 * 
 * @param db - PostgreSQL database client (already tenant-scoped)
 * @param input - API call usage input
 */
export async function recordApiCallForRun(
  db: PgDatabase,
  input: ApiCallUsageInput
): Promise<void> {
  await db.insert(schema.usageMetric)
    .values({
      tenantId: input.tenantId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      metricType: 'api_calls',
      resource: perPassResource('sync', input.domain, input.runId),
      quantity: '1',
      unit: 'request',
      unitPrice: '0',
      totalCost: '0',
      metadata: {
        mappingId: input.mappingId,
        domain: input.domain,
        runId: input.runId,
      },
    })
    .onConflictDoUpdate({
      target: [
        schema.usageMetric.tenantId,
        schema.usageMetric.periodStart,
        schema.usageMetric.metricType,
        schema.usageMetric.resource,
      ],
      set: {
        quantity: '1',
        updatedAt: new Date(),
      },
    });
}

/**
 * Get all usage metrics for a tenant and period.
 * 
 * Combines derived metrics (storage/egress) with upserted metrics (compute/api_calls).
 * 
 * @param db - PostgreSQL database client (already tenant-scoped)
 * @param tenantId - Tenant ID
 * @param periodStart - Period start date
 * @param periodEnd - Period end date
 * @returns Complete usage metrics
 */
export async function getUsageMetricsForPeriod(
  db: PgDatabase,
  tenantId: TenantId,
  periodStart: string,
  periodEnd: string
): Promise<UsageMetricsResult> {
  // Get derived storage/egress
  const { storageBytes, egressBytes } = await deriveStorageAndEgressForPeriod(
    db,
    tenantId,
    periodStart,
    periodEnd
  );

  // Get upserted compute and api_calls
  const metrics = await db.select({
    metricType: schema.usageMetric.metricType,
    quantity: schema.usageMetric.quantity,
    resource: schema.usageMetric.resource,
  })
  .from(schema.usageMetric)
  .where(
    and(
      eq(schema.usageMetric.tenantId, tenantId),
      eq(schema.usageMetric.periodStart, periodStart),
    )
  );

  let computeHours = 0;
  let apiCallCount = 0;

  for (const metric of metrics) {
    if (metric.metricType === 'compute') {
      computeHours += Number(metric.quantity);
    } else if (metric.metricType === 'api_calls') {
      apiCallCount += Number(metric.quantity);
    }
  }

  return {
    storageBytes,
    egressBytes,
    computeHours,
    apiCallCount,
  };
}
