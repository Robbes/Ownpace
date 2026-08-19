// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * The three tables that only exist because somebody is being charged.
 *
 * They lived in `@openmig/ledger`'s `schema-pg.ts` until the edition boundary
 * was drawn (ADR-0036). Nothing in the appliance reads or writes them, but
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


// ========================= Accounts =========================

export const tenantMember = pgTable(
  'tenant_member',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    email: text('email').notNull(),
    role: text('role', { enum: ['owner', 'admin', 'member', 'viewer'] }).notNull().default('member'),
    status: text('status', { enum: ['active', 'invited', 'suspended', 'removed'] })
      .notNull()
      .default('active'),
    invitedAt: timestamp('invited_at', { withTimezone: true }),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ix_tenant_member_tenant').on(t.tenantId),
    index('ix_tenant_member_user').on(t.userId),
    uniqueIndex('uk_tenant_member').on(t.tenantId, t.userId),
  ],
);

// ========================= Erasure receipts =========================

/**
 * Proof that an erasure happened, holding no personal data of its own —
 * migration 0025, workplan 0085.
 *
 * `tenantRef` is a sha256 of the tenant id, never the id: an auditor holding
 * the id can verify the record, and the table cannot be read back into a list
 * of former customers. No tenant foreign key (a record that cascades away with
 * its subject is not a record) and no RLS (system-level code reads it, with no
 * tenant context to key a policy on).
 */
export const erasureRecord = pgTable('erasure_record', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantRef: text('tenant_ref').notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
  windowDays: integer('window_days').notNull(),
  // Nullable on purpose: records written before 0085 T5 carry no promise about
  // backups, and inventing one for them retroactively would be writing a
  // commitment nobody gave.
  backupRetentionDays: integer('backup_retention_days'),
  backupsExpireAt: timestamp('backups_expire_at', { withTimezone: true }),
  purgedAt: timestamp('purged_at', { withTimezone: true }),
  retainedInvoiceIds: uuid('retained_invoice_ids').array().notNull().default([]),
  revocations: jsonb('revocations').notNull().default({}),
  purgedCounts: jsonb('purged_counts').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});


// ========================= What a tenant agreed to pay =========================

/**
 * The agreement, not the current price list (migration `0001_the_managed_service`).
 *
 * Was a nullable `tenant.pricing` column until ADR-0036. `tenant` is the RLS
 * anchor every other table keys on, so it is core by definition and cannot
 * move; a price on it put money in the one table an appliance certainly has.
 *
 * NO ROW means "nothing agreed yet". As a column this needed a comment saying
 * NULL was not zero — a distinction a reader could get wrong exactly once, on
 * an invoice.
 */
export const tenantPricing = pgTable('tenant_pricing', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenant.id, { onDelete: 'cascade' }),
  pricing: jsonb('pricing').notNull(),
  agreedAt: timestamp('agreed_at', { withTimezone: true }).notNull().defaultNow(),
});

// ========================= When we promised to delete them =========================

/**
 * A closed tenant's dates. No row means not closed.
 *
 * Split off `tenant` in ADR-0036 for the same reason as the pricing: the window
 * a customer chose is a promise made to a customer. An appliance's operator has
 * root and ends the service with `forget-me`, which revokes the credentials the
 * wipe is about to destroy and does not wait for anything.
 */
export const tenantClosure = pgTable(
  'tenant_closure',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    closedAt: timestamp('closed_at', { withTimezone: true }).notNull(),
    /** now() for an immediate close, so one code path serves every window. */
    purgeAfter: timestamp('purge_after', { withTimezone: true }).notNull(),
    closedBy: text('closed_by'),
  },
  (t) => [index('ix_tenant_closure_due').on(t.purgeAfter)],
);
