// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * Billing Service
 *
 * Pricing types and the single cost-calculation function (ADR-0014 cost-recovery
 * pricing, integer cents). The live billing data path is Drizzle-backed
 * (routes/billing + services/invoice-generation); the previous in-memory
 * `billingApi` mock was removed once those moved to real persistence.
 */

// Pricing lives in @openmig/billing (ONE copy — the worker meters against the
// same numbers this file invoices from; they used to be two literals in two
// packages). It moved out of @openmig/shared in ADR-0036: shared is loaded by
// the appliance too, and an appliance is never invoiced. `defaultPricing` is the built-in template, kept as a named export
// because it is a sensible last-resort default for the pure calculator; every
// route that prices a REAL tenant passes that tenant's agreed prices instead
// (resolveTenantPricing), which is what keeps an operator's price change off
// an existing customer's invoice.
export {
  type PricingConfig,
  DEFAULT_PRICING as defaultPricing,
  VAT_RATE,
} from '@openmig/billing';
import { type PricingConfig, DEFAULT_PRICING, VAT_RATE } from '@openmig/billing';

// Usage metrics
export interface UsageMetrics {
  id: string;
  tenantId: string;
  period: string; // YYYY-MM
  storageUsedGB: number;
  egressGB: number;
  computeHours: number;
  syncCount: number;
  lastUpdated: string;
}

// The dead zod half of this file — an Invoice type speaking Stripe vocabulary
// (`open`/`uncollectible`) against a Mollie DB enum (`sent`/`overdue`), plus
// schemas nothing imported — was deleted with 0039 T3. The DB CHECK owns the
// enum; the routes serve rows straight from Drizzle; the client parses those
// rows against its own literal-response schemas.

// VAT (one rate, said once — re-exported from @openmig/shared above) is NOT
// part of a tenant's agreement: a tax rate is set by a government and changes
// for everyone at once, so it is not pinned per tenant like the prices are.
// The rate the UI shows derives from `taxRate` on the served cost, so the
// label can never disagree with the arithmetic.

// Cost calculation — integer cents throughout (each component is rounded, so no
// floating-point drift reaches the invoice).
export function calculateCost(metrics: Partial<UsageMetrics>, pricing: PricingConfig = DEFAULT_PRICING): {
  baseFee: number;
  storage: number;
  egress: number;
  compute: number;
  subtotal: number;
  taxRate: number;
  tax: number;
  total: number;
} {
  const storageCost = Math.round((metrics.storageUsedGB ?? 0) * pricing.storagePricePerGB);
  const egressCost = Math.round((metrics.egressGB ?? 0) * pricing.egressPricePerGB);
  const computeCost = Math.round((metrics.computeHours ?? 0) * pricing.computePricePerHour);

  const subtotal = pricing.baseFee + storageCost + egressCost + computeCost;
  const tax = Math.round(subtotal * VAT_RATE);
  const total = subtotal + tax;

  // baseFee is IN the returned breakdown (0039 T2): without it the UI's
  // "Base Fee" line had nothing true to render and showed the whole subtotal
  // — itemized lines summing to double the printed subtotal, on a screen
  // about money.
  return {
    baseFee: pricing.baseFee,
    storage: storageCost,
    egress: egressCost,
    compute: computeCost,
    subtotal,
    taxRate: VAT_RATE,
    tax,
    total,
  };
}
