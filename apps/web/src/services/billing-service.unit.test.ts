// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
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
  it('parses the literal response, baseFee and taxRate included (0039 T2)', () => {
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
    });
    // The itemized lines sum to the subtotal — the on-screen arithmetic's
    // precondition.
    const c = parsed.currentCost;
    expect(c.baseFee + c.storage + c.egress + c.compute).toBe(c.subtotal);
  });

  it('rejects a cost breakdown without baseFee — the shape that made the screen lie', () => {
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
        currentCost: { storage: 0, egress: 0, compute: 0, subtotal: 999, tax: 210, total: 1209 },
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
