// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The billing schemas against the ROUTES' literal responses (0039 T3) —
 * the same fixture discipline as mapping-service.unit.test.ts. The invoice
 * fixture's money fields are STRINGS on purpose: the Postgres columns are
 * numeric and arrive as strings over JSON, which the old hand-written
 * `number` types hid behind implicit coercion.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { InvoiceSchema, UsageResponseSchema, PaymentMethodSchema } from './billing-service.ts';

/** GET /billing/invoices — a row as the route's Drizzle select serves it. */
const invoiceRow = {
  id: 'b2c3d4e5-0000-0000-0000-000000000001',
  tenantId: 'a1b2c3d4-0000-0000-0000-000000000001',
  periodStart: '2026-07-01',
  periodEnd: '2026-07-31',
  status: 'overdue',
  subtotal: '3599', // numeric column -> string over JSON
  taxRate: '0.21',
  taxAmount: '756',
  total: '4355',
  currency: 'EUR',
  paymentMethod: null,
  paymentId: null,
  paidAt: null,
  dueDate: '2026-08-14',
  sentAt: null,
  metadata: { costByDriver: { base: 999 } },
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('InvoiceSchema vs the invoices route', () => {
  it('parses a literal row, coercing the numeric-column strings to numbers', () => {
    const parsed = InvoiceSchema.parse(invoiceRow);
    expect(parsed.status).toBe('overdue');
    expect(parsed.total).toBe(4355);
    expect(parsed.subtotal + parsed.taxAmount).toBe(parsed.total);
    expect(parsed.periodStart).toBe('2026-07-01');
  });

  it("rejects Stripe's vocabulary — the words the old client typed and the server never sends", () => {
    for (const stripeStatus of ['open', 'uncollectible']) {
      expect(() => InvoiceSchema.parse({ ...invoiceRow, status: stripeStatus })).toThrow();
    }
  });

  it('accepts every word of the DB enum', () => {
    for (const status of ['draft', 'sent', 'paid', 'overdue', 'void']) {
      expect(InvoiceSchema.parse({ ...invoiceRow, status }).status).toBe(status);
    }
  });
});

describe('UsageResponseSchema vs the usage route', () => {
  it('parses the literal response: measured quantities, the tier, and its evidence', () => {
    const parsed = UsageResponseSchema.parse({
      usage: {
        tenantId: 'a1b2c3d4-0000-0000-0000-000000000001',
        period: '2026-08',
        storageUsedGB: 50,
        egressGB: 100,
        computeHours: 20,
        syncCount: 7,
        lastUpdated: '2026-08-09T12:00:00.000Z',
      },
      tier: { id: 'medium', name: 'Medium', paths: 20, dataGb: 2000, setup: 15, monthly: 8 },
      decidedBy: 'data',
      evidence: { peakPaths: 4, peakAt: '2026-08-12', gbMoved: 900 },
      period: '2026-08',
    });
    // Whole EUROS, as ADR-0014's table publishes them — not cents. A schema
    // that shrugged here would let the screen print a hundredth of the price.
    expect(parsed.tier?.setup).toBe(15);
    expect(parsed.tier?.monthly).toBe(8);
    expect(parsed.evidence.gbMoved).toBe(900);
  });

  it('accepts a null tier — past the table is an ANSWER, not a failure', () => {
    const parsed = UsageResponseSchema.parse({
      usage: {
        tenantId: 't',
        period: '2026-08',
        storageUsedGB: 0,
        egressGB: 0,
        computeHours: 0,
        syncCount: 0,
        lastUpdated: '2026-08-09T12:00:00.000Z',
      },
      tier: null,
      decidedBy: 'both',
      evidence: { peakPaths: 900, peakAt: null, gbMoved: 90000 },
      period: '2026-08',
    });
    // "Talk to us" is the site's published ending. A schema that rejected it
    // would blank the whole screen for exactly the largest customer.
    expect(parsed.tier).toBeNull();
  });

  it('rejects the RETIRED metered breakdown — the shape that quoted a dead price list', () => {
    expect(() =>
      UsageResponseSchema.parse({
        usage: {
          tenantId: 't',
          period: '2026-08',
          storageUsedGB: 0,
          egressGB: 0,
          computeHours: 0,
          syncCount: 0,
          lastUpdated: '2026-08-09T12:00:00.000Z',
        },
        // What the route served until 2026-09-09: base fee, per-GB storage and
        // egress, per-hour compute, VAT, total — every figure correct, none of
        // them a price anybody would be charged (ADR-0014 amended 2026-08-20).
        currentCost: {
          baseFee: 999,
          storage: 500,
          egress: 2000,
          compute: 100,
          subtotal: 3599,
          taxRate: 0.21,
          tax: 756,
          total: 4355,
        },
        period: '2026-08',
      }),
    ).toThrow();
  });

  it('rejects a tier whose id is not one of ADR-0014\'s five', () => {
    expect(() =>
      UsageResponseSchema.parse({
        usage: {
          tenantId: 't',
          period: '2026-08',
          storageUsedGB: 0,
          egressGB: 0,
          computeHours: 0,
          syncCount: 0,
          lastUpdated: '2026-08-09T12:00:00.000Z',
        },
        tier: { id: 'enterprise', name: 'Enterprise', paths: 500, dataGb: 50000, setup: 0, monthly: 0 },
        decidedBy: 'paths',
        evidence: { peakPaths: 1, peakAt: null, gbMoved: 1 },
        period: '2026-08',
      }),
    ).toThrow();
  });
});

describe('PaymentMethodSchema vs the payment-methods route', () => {
  it("parses a literal row — the route's column names (mollieId, lastFour), not the old client's (mollieCustomerId, last4)", () => {
    const parsed = z.array(PaymentMethodSchema).parse([
      {
        id: 'pm-1',
        tenantId: 't1',
        mollieId: 'cst_123',
        type: 'card',
        brand: 'Visa',
        lastFour: '4242',
        expiryMonth: 12,
        expiryYear: 2028,
        isDefault: true,
        status: 'active',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ]);
    expect(parsed[0]!.lastFour).toBe('4242');
    expect(parsed[0]!.isDefault).toBe(true);
  });
});
