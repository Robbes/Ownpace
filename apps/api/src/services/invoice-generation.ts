// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Invoice generation (workplan 0011 T5).
 *
 * Aggregates a tenant's metered usage for a billing period into a single
 * `invoice` row, using ADR-0014 cost-recovery pricing: a flat monthly base fee
 * + pass-through of storage/egress/compute (no margin), plus VAT.
 *
 * Usage comes from the T4 read model (`getUsageMetricsForPeriod`): storage/egress
 * are derived from the immutable `item` ledger, compute/api-calls from the
 * upserted `usage_metric` rows — so the invoice reflects every cost driver, and
 * pricing goes through the one `calculateCost` function shared with the estimate
 * and usage routes.
 *
 * Idempotent: keyed by the unique (tenant_id, period_start) invoice constraint.
 * Re-running refreshes a DRAFT invoice's amounts and touches nothing past
 * draft: an issued invoice (`sent` and onward) is a document, and documents
 * are corrected by credit note, never regenerated (ADR-0044; managed
 * migration 0014 enforces this at the database, so the `setWhere` below is
 * the app agreeing with the rule, not the only thing holding it).
 *
 * Managed-only: this module lives in apps/api and is never imported by the
 * self-host edition (hard rule 5 — self-host loads no billing code).
 */

import { and, eq } from 'drizzle-orm';
import type { PgDatabase } from '@openmig/ledger';
import { getUsageMetricsForPeriod, resolveTenantPricing, VAT_RATE } from '@openmig/managed';
import * as schema from '@openmig/managed/schema-managed';
import type { TenantId } from '@openmig/shared';
import { calculateCost, type PricingConfig } from './billing-service.ts';

// VAT_RATE is imported, not redeclared: this file used to carry its own
// `const VAT_RATE = 0.21` — a third copy, and the one actually STAMPED ON THE
// INVOICE ROW, so a rate change made elsewhere would have left issued invoices
// claiming a rate the arithmetic never used.
const BYTES_PER_GB = 1_000_000_000;

export interface GeneratedInvoice {
  id: string;
  status: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  currency: string;
  /** Per-driver cost (cents) that fed the subtotal. */
  costByDriver: { base: number; storage: number; egress: number; compute: number };
  /** True when the invoice already existed as paid/void and was left untouched. */
  locked: boolean;
}

/**
 * Generate (or refresh) the invoice for one tenant + period.
 *
 * Must be called inside a tenant-scoped transaction (withTenant/withTenantDb),
 * so RLS confines every read and write to `tenantId`.
 */
export async function generateInvoiceForPeriod(
  db: PgDatabase,
  tenantId: string,
  periodStart: string,
  periodEnd: string,
  pricing?: PricingConfig,
): Promise<GeneratedInvoice> {
  // The prices THIS TENANT agreed to, resolved here rather than defaulted by
  // the caller. The parameter used to default to the built-in template, so a
  // caller that simply forgot it — every caller did — invoiced at whatever the
  // product currently charges instead of at the customer's own rates. Now the
  // only way to bill someone at a different price is to pass it deliberately
  // (which the tests do), and forgetting produces the correct invoice.
  const agreed = pricing ?? (await resolveTenantPricing(db, tenantId));

  // T4 read model: storage/egress derived from the item ledger, compute/api-calls
  // from the upserted usage_metric rows.
  const usage = await getUsageMetricsForPeriod(
    db,
    tenantId as unknown as TenantId,
    periodStart,
    periodEnd,
  );

  const cost = calculateCost(
    {
      storageUsedGB: usage.storageBytes / BYTES_PER_GB,
      egressGB: usage.egressBytes / BYTES_PER_GB,
      computeHours: usage.computeHours,
      syncCount: usage.apiCallCount,
    },
    agreed,
  );

  const subtotal = cost.subtotal;
  const taxAmount = cost.tax;
  const total = cost.total;
  const costByDriver = {
    base: agreed.baseFee,
    storage: cost.storage,
    egress: cost.egress,
    compute: cost.compute,
  };

  // If an ISSUED invoice already exists for this period — sent, paid, void,
  // anything past draft — leave it untouched: regeneration is a draft-phase
  // act (migration 0014's freeze would refuse the rewrite anyway; skipping
  // here avoids a pointless round-trip and answers with the row as it
  // stands).
  const existing = await db
    .select({ id: schema.invoice.id, status: schema.invoice.status })
    .from(schema.invoice)
    .where(
      and(
        eq(schema.invoice.tenantId, tenantId),
        eq(schema.invoice.periodStart, periodStart),
      ),
    );

  const locked = existing.some((i) => i.status !== 'draft');
  if (locked && existing[0]) {
    return {
      id: existing[0].id,
      status: existing[0].status,
      subtotal,
      taxAmount,
      total,
      currency: 'EUR',
      costByDriver,
      locked: true,
    };
  }

  const metadata = { costByDriver, generatedAt: new Date().toISOString() };

  // Upsert the draft invoice — one per (tenant, period) via the unique index.
  // The `setWhere` guard makes the "only drafts regenerate" rule ATOMIC: if
  // the customer starts paying (draft → sent) between the SELECT above and
  // this statement, the ON CONFLICT UPDATE is skipped by the database, not
  // just by the earlier read. Migration 0014's trigger is the backstop the
  // day this drifts — an issued invoice's amounts refuse at the database.
  const [invoice] = await db
    .insert(schema.invoice)
    .values({
      tenantId,
      periodStart,
      periodEnd,
      status: 'draft',
      subtotal: String(subtotal),
      taxRate: String(VAT_RATE),
      taxAmount: String(taxAmount),
      total: String(total),
      currency: 'EUR',
      metadata,
    })
    .onConflictDoUpdate({
      target: [schema.invoice.tenantId, schema.invoice.periodStart],
      set: {
        subtotal: String(subtotal),
        taxRate: String(VAT_RATE),
        taxAmount: String(taxAmount),
        total: String(total),
        metadata,
        updatedAt: new Date(),
      },
      setWhere: eq(schema.invoice.status, 'draft'),
    })
    .returning({ id: schema.invoice.id, status: schema.invoice.status });

  if (!invoice) {
    // The row was issued after the SELECT above (a concurrent pay click can
    // send it mid-generation), so `setWhere` skipped the update. Re-read and
    // return it untouched — the document wins.
    const [current] = await db
      .select({ id: schema.invoice.id, status: schema.invoice.status })
      .from(schema.invoice)
      .where(
        and(
          eq(schema.invoice.tenantId, tenantId),
          eq(schema.invoice.periodStart, periodStart),
        ),
      );
    if (!current) {
      throw new Error('invoice upsert returned no row');
    }
    return {
      id: current.id,
      status: current.status,
      subtotal,
      taxAmount,
      total,
      currency: 'EUR',
      costByDriver,
      locked: true,
    };
  }

  return {
    id: invoice.id,
    status: invoice.status,
    subtotal,
    taxAmount,
    total,
    currency: 'EUR',
    costByDriver,
    locked: false,
  };
}
