// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A year of history that disappears sixty days at a time.
 *
 * 0121 T3 made usage DERIVED — compute and sync operations from the `run`
 * ledger, storage and egress from `item` — and T5 then made `run` prunable
 * after sixty days, which is only safe because T3 froze the measured
 * quantities onto the invoice first. §4b recorded the half nobody had built:
 *
 * > Once runs are pruned, months older than the window stop appearing — not as
 * > a zero, but as absence, which that route's own comment calls "silence".
 * > The invoice holds the frozen figures for those periods, so nothing is
 * > lost, but the route does not read invoices.
 *
 * The owner chose the fallback on 2026-09-09. These tests hold the four things
 * that make it honest rather than merely non-empty.
 */

import { describe, it, expect } from 'vitest';
import {
  ISSUED_INVOICE_STATUSES,
  mergeUsageHistory,
  rowFromIssuedInvoice,
  periodOf,
  type IssuedInvoiceRow,
  type UsageHistoryRow,
} from './usage-history.ts';

/** An invoice as the route selects it: text columns, jsonb metadata. */
function issued(overrides: Partial<IssuedInvoiceRow> = {}): IssuedInvoiceRow {
  return {
    periodStart: '2026-03-01',
    subtotal: '4200',
    taxRate: '0.21',
    taxAmount: '882',
    total: '5082',
    metadata: {
      costByDriver: { base: 1000, storage: 1200, egress: 800, compute: 1200 },
      measured: {
        computeHours: 12.5,
        syncCount: 340,
        storageBytes: 3_000_000_000,
        egressBytes: 2_000_000_000,
      },
      generatedAt: '2026-04-01T00:00:00.000Z',
    },
    ...overrides,
  };
}

function ledgerRow(period: string): UsageHistoryRow {
  return {
    period,
    storageUsedGB: 1,
    egressGB: 1,
    computeHours: 1,
    syncCount: 1,
    cost: { baseFee: 1000, storage: 0, egress: 0, compute: 0, subtotal: 1000, taxRate: 0.21, tax: 210, total: 1210 },
    source: 'ledger',
  };
}

describe('usage history reaches back past what the run ledger still holds', () => {
  it('only a settled invoice counts — a draft is a view of rows that may be gone', () => {
    // The same set managed-retention treats as proof a period is billed. A
    // `draft` is regenerated FROM the ledger, so using one as the fallback
    // would answer with a re-derivation of data the prune already removed.
    expect([...ISSUED_INVOICE_STATUSES]).toEqual(['sent', 'paid', 'overdue']);
    expect(ISSUED_INVOICE_STATUSES).not.toContain('draft');
    expect(ISSUED_INVOICE_STATUSES).not.toContain('void');
  });

  it('turns a frozen invoice into the month it paid for', () => {
    const row = rowFromIssuedInvoice(issued());
    expect(row).not.toBeNull();
    expect(row!.period).toBe('2026-03');
    expect(row!.source).toBe('invoice');
    // Quantities come off `measured`, bytes converted the way the rest of
    // billing converts them (decimal GB — a price list is not binary).
    expect(row!.computeHours).toBe(12.5);
    expect(row!.syncCount).toBe(340);
    expect(row!.storageUsedGB).toBe(3);
    expect(row!.egressGB).toBe(2);
  });

  it('reports the money the invoice charged, never re-priced at today ‘s list', () => {
    // The fault this avoids is the one /billing/estimate already names: a
    // figure the customer's invoice never showed. So the totals are the
    // invoice's own, and the breakdown is its frozen costByDriver.
    const row = rowFromIssuedInvoice(issued())!;
    expect(row.cost).toEqual({
      baseFee: 1000,
      storage: 1200,
      egress: 800,
      compute: 1200,
      subtotal: 4200,
      taxRate: 0.21,
      tax: 882,
      total: 5082,
    });
  });

  it('drops an invoice that cannot answer, rather than showing a month of zeros', () => {
    // An invoice issued before T3 has no `measured` block. Zeros beside real
    // months read as a month in which nothing happened — a different lie from
    // the silence this fixes, not an improvement on it.
    expect(rowFromIssuedInvoice(issued({ metadata: {} }))).toBeNull();
    expect(rowFromIssuedInvoice(issued({ metadata: null }))).toBeNull();
    expect(rowFromIssuedInvoice(issued({ metadata: { costByDriver: { base: 1 } } }))).toBeNull();
    expect(
      rowFromIssuedInvoice(issued({ metadata: { measured: { computeHours: 1 }, costByDriver: {} } })),
    ).toBeNull();
    // A total that is not a number is the same problem wearing a different hat.
    expect(rowFromIssuedInvoice(issued({ total: 'n/a' }))).toBeNull();
    expect(rowFromIssuedInvoice(issued({ periodStart: 'whenever' }))).toBeNull();
  });

  it('the ledger answers for months it still holds; invoices fill only the rest', () => {
    // Not because the ledger is more truthful — for a billed period the
    // invoice is what was charged — but because changing what in-window months
    // report is a different change from the one this makes.
    const merged = mergeUsageHistory(
      [ledgerRow('2026-08'), ledgerRow('2026-07')],
      [rowFromIssuedInvoice(issued({ periodStart: '2026-07-01' }))!, rowFromIssuedInvoice(issued())!],
    );
    expect(merged.map((r) => r.period)).toEqual(['2026-08', '2026-07', '2026-03']);
    expect(merged.map((r) => r.source)).toEqual(['ledger', 'ledger', 'invoice']);
    // The overlapping month kept the ledger's figures, not the invoice's.
    expect(merged[1]!.computeHours).toBe(1);
  });

  it('comes back newest first even though the two lists arrive separately', () => {
    // A merged list that is only mostly descending puts an old month in the
    // middle of a table nobody reads closely.
    const merged = mergeUsageHistory(
      [ledgerRow('2026-02')],
      [rowFromIssuedInvoice(issued({ periodStart: '2026-09-01' }))!, rowFromIssuedInvoice(issued())!],
    );
    expect(merged.map((r) => r.period)).toEqual(['2026-09', '2026-03', '2026-02']);
  });

  it('a tenant with no ledger months left still has its history', () => {
    // The state this exists for: everything pruned, invoices intact.
    const merged = mergeUsageHistory([], [rowFromIssuedInvoice(issued())!]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.period).toBe('2026-03');
  });

  it('periodOf takes the month off a period start, and refuses anything else', () => {
    expect(periodOf('2026-03-01')).toBe('2026-03');
    expect(periodOf('2026-03')).toBe('2026-03');
    expect(periodOf('')).toBeNull();
    expect(periodOf('not-a-date')).toBeNull();
  });
});
