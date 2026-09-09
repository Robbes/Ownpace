// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Usage history that survives run retention (workplan 0121, §4b's open consequence).
 *
 * `GET /api/billing/usage/history` takes its months from the `run` ledger by
 * `GROUP BY`, because T3 made compute and sync operations DERIVED rather than
 * stored. That was right, and it has an expiry date: T5 prunes `run` after
 * sixty days, so months older than the window stop appearing — not as a zero,
 * but as ABSENCE, which the route's own comment calls *"silence"*. A customer
 * looking at their second year would see their first year vanish.
 *
 * Nothing was lost when that happened. T3 froze the measured quantities onto
 * the invoice precisely so the run rows could go, and said so:
 *
 * > freezing the quantities here … returns those rows to being audit trail,
 * > and makes retention on `run` a storage decision instead of a correctness
 * > one.
 *
 * The route just never read them. This is the half that reads them.
 *
 * ## Which side wins, and why it is not the invoice
 *
 * The ledger answers for months it still holds; issued invoices fill in only
 * the months it no longer does. Not because the ledger is more truthful — for
 * a billed period the invoice is what the customer was actually charged — but
 * because a month inside the retention window is one the ledger can answer
 * exactly, and changing what those months report is a different change from
 * the one this makes. Ledger months keep behaving as they did; older months
 * appear where nothing appeared before.
 *
 * ## The money comes off the invoice, never recomputed
 *
 * A frozen quantity re-priced at today's list would produce a number the
 * customer's invoice never showed — the exact fault `/billing/estimate`
 * already guards against ("an estimate that quietly used the template would
 * tell an existing customer a number their own invoice will never show"). So
 * an invoice-derived row reports the invoice's own subtotal, tax and total,
 * and its `costByDriver` breakdown. If that breakdown is missing — an invoice
 * issued before T3 froze anything — the row is dropped rather than shown with
 * invented figures.
 *
 * ## Only ISSUED invoices
 *
 * `draft` is excluded for the same reason T5's prune excludes it: a draft is
 * regenerated from the ledger, so it is a view of data that may since have
 * been pruned, not a record of anything. `void` is excluded because it was
 * withdrawn. That leaves `sent`, `paid` and `overdue` — the same set
 * `managed-retention` treats as proof a period is settled.
 */

/** The invoice statuses that count as a settled record of a period. */
export const ISSUED_INVOICE_STATUSES = ['sent', 'paid', 'overdue'] as const;

/** Decimal GB, as `invoice-generation.ts` uses — a price list is not binary. */
const BYTES_PER_GB = 1_000_000_000;

/** The cost breakdown both sides report, shaped as `calculateCost` returns it. */
export interface UsageCost {
  baseFee: number;
  storage: number;
  egress: number;
  compute: number;
  subtotal: number;
  taxRate: number;
  tax: number;
  total: number;
}

export interface UsageHistoryRow {
  /** `YYYY-MM`. */
  period: string;
  storageUsedGB: number;
  egressGB: number;
  computeHours: number;
  syncCount: number;
  cost: UsageCost;
  /**
   * Where the figures came from. On screen this is the difference between
   * "derived from what we still hold" and "what your invoice said", and a
   * consumer that wants to say so can.
   */
  source: 'ledger' | 'invoice';
}

/** One issued invoice, as the route selects it. Strings, because the columns are. */
export interface IssuedInvoiceRow {
  periodStart: string;
  subtotal: string;
  taxRate: string;
  taxAmount: string;
  total: string;
  metadata: unknown;
}

/** `2026-04-01` -> `2026-04`. Returns null for anything that is not a date string. */
export function periodOf(periodStart: string): string | null {
  return /^\d{4}-\d{2}(-\d{2})?$/.test(periodStart) ? periodStart.slice(0, 7) : null;
}

/** A number from a text column, or null — never NaN silently reaching a screen about money. */
function money(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Turn one issued invoice into a history row, or null when it cannot answer.
 *
 * Null rather than zeros: an invoice from before T3 has no `measured` block,
 * and a row of zeros beside real months reads as a month in which nothing
 * happened. Absence is at least honest about being absence.
 */
export function rowFromIssuedInvoice(invoice: IssuedInvoiceRow): UsageHistoryRow | null {
  const period = periodOf(invoice.periodStart);
  if (!period) return null;

  const meta = invoice.metadata;
  if (!meta || typeof meta !== 'object') return null;
  const measured = (meta as { measured?: unknown }).measured;
  const byDriver = (meta as { costByDriver?: unknown }).costByDriver;
  if (!measured || typeof measured !== 'object') return null;
  if (!byDriver || typeof byDriver !== 'object') return null;

  const m = measured as Record<string, unknown>;
  const d = byDriver as Record<string, unknown>;

  const computeHours = money(m.computeHours);
  const syncCount = money(m.syncCount);
  const storageBytes = money(m.storageBytes);
  const egressBytes = money(m.egressBytes);
  const base = money(d.base);
  const storage = money(d.storage);
  const egress = money(d.egress);
  const compute = money(d.compute);
  const subtotal = money(invoice.subtotal);
  const taxRate = money(invoice.taxRate);
  const tax = money(invoice.taxAmount);
  const total = money(invoice.total);

  const required = [computeHours, syncCount, storageBytes, egressBytes, base, storage, egress, compute, subtotal, taxRate, tax, total];
  if (required.some((v) => v === null)) return null;

  return {
    period,
    storageUsedGB: storageBytes! / BYTES_PER_GB,
    egressGB: egressBytes! / BYTES_PER_GB,
    computeHours: computeHours!,
    syncCount: syncCount!,
    cost: {
      baseFee: base!,
      storage: storage!,
      egress: egress!,
      compute: compute!,
      subtotal: subtotal!,
      taxRate: taxRate!,
      tax: tax!,
      total: total!,
    },
    source: 'invoice',
  };
}

/**
 * Ledger months, then the invoice months the ledger does not cover, newest first.
 *
 * The ordering is re-applied here rather than trusted from either query: the
 * two lists arrive separately and a merged list that is only mostly descending
 * puts an old month in the middle of a table nobody is reading closely.
 */
export function mergeUsageHistory(
  fromLedger: readonly UsageHistoryRow[],
  fromInvoices: readonly UsageHistoryRow[],
): UsageHistoryRow[] {
  const covered = new Set(fromLedger.map((r) => r.period));
  return [...fromLedger, ...fromInvoices.filter((r) => !covered.has(r.period))].sort((a, b) =>
    b.period.localeCompare(a.period),
  );
}
