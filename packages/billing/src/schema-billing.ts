// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * The three tables that only exist because somebody is being charged.
 *
 * They lived in `@openmig/ledger`'s `schema-pg.ts` until the edition boundary
 * was drawn (ADR-0032). Nothing in the appliance reads or writes them, but
 * every appliance imports `@openmig/ledger`'s index, so the appliance's own
 * type surface carried `invoice`, `payment_method` and `usage_metric` — and a
 * `db.select().from(schema.invoice)` written by mistake in shared code would
 * have compiled on both editions.
 *
 * WHAT DID **NOT** MOVE, and why:
 *
 *  - **`tenant.pricing`.** A table is declared in one place. `tenant` is core,
 *    and splitting one nullable jsonb column into a second declaration of the
 *    same physical table would give the drift guard two rows named `tenant`
 *    with different columns — a guard that quietly checks the wrong one. The
 *    money LOGIC moved (`tenant-pricing.ts`); the column stays declared
 *    beside its table.
 *
 *  - **The DDL.** These tables are created by `0001_baseline.sql`, which every
 *    install has already applied, and `offboarding.ts` — shared, and reached
 *    by the appliance's own `forget-me` — issues raw SQL against `invoice` to
 *    detach it at erasure. Dropping them on the appliance would be a
 *    destructive migration against hard rule 2 to reclaim three empty tables,
 *    and would break an erasure path that works today. They stay physically
 *    present and inert; what changes is that no shared code can name them.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { tenant } from '@openmig/ledger/schema-pg';

// ========================= Usage Metrics (for billing) =========================

export const usageMetric = pgTable(
  'usage_metric',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
    periodStart: text('period_start').notNull(), // Using text for date
    periodEnd: text('period_end').notNull(),
    metricType: text('metric_type', {
      enum: ['storage', 'egress', 'compute', 'api_calls'],
    }).notNull(),
    resource: text('resource'),
    quantity: text('quantity').notNull(), // Using text for numeric
    unit: text('unit').notNull(),
    unitPrice: text('unit_price').notNull(),
    totalCost: text('total_cost').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ix_usage_tenant_period').on(t.tenantId, t.periodStart),
    index('ix_usage_period_type').on(t.periodStart, t.metricType),
    uniqueIndex('uk_usage_metric').on(t.tenantId, t.periodStart, t.metricType, t.resource),
  ],
);

// ========================= Billing Invoices =========================

export const invoice = pgTable(
  'invoice',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // NULL once the tenant is erased: the invoice outlives it, because tax
    // retention outlives the customer relationship (0085).
    tenantId: uuid('tenant_id').references(() => tenant.id, { onDelete: 'set null' }),
    // Captured at issue time. An invoice records a moment, so a later rename
    // must not rewrite invoices already issued — and a detached invoice has to
    // be able to say who it was for at all.
    billedToName: text('billed_to_name'),
    periodStart: text('period_start').notNull(),
    periodEnd: text('period_end').notNull(),
    status: text('status', {
      enum: ['draft', 'sent', 'paid', 'overdue', 'void'],
    })
      .notNull()
      .default('draft'),
    subtotal: text('subtotal').notNull(),
    taxRate: text('tax_rate').notNull(),
    taxAmount: text('tax_amount').notNull(),
    total: text('total').notNull(),
    currency: text('currency').notNull().default('EUR'),
    paymentMethod: text('payment_method'),
    paymentId: text('payment_id'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    dueDate: text('due_date'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ix_invoice_tenant').on(t.tenantId, t.periodStart),
    index('ix_invoice_status').on(t.status, t.periodStart),
    uniqueIndex('uk_invoice_tenant_period').on(t.tenantId, t.periodStart),
  ],
);

// ========================= Payment Methods =========================

export const paymentMethod = pgTable(
  'payment_method',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
    mollieId: text('mollie_id').notNull().unique(),
    type: text('type').notNull(),
    brand: text('brand'),
    lastFour: text('last_four'),
    expiryMonth: integer('expiry_month'),
    expiryYear: integer('expiry_year'),
    isDefault: boolean('is_default').notNull().default(false),
    status: text('status', { enum: ['active', 'expired', 'revoked'] })
      .notNull()
      .default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ix_payment_method_tenant').on(t.tenantId)],
);

