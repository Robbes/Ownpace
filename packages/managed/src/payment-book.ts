// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PAYMENT THROUGH MOLLIE, BOOKED IN THE BOOKS (workplan 0111, slice 5f; the
 * owner, 2026-10-11: *"Ownpace follows Mollie"*).
 *
 * Mollie's webhook moves an invoice to `paid` and notes what Mollie took
 * (`paid_cents`, managed 0050). The books do not know yet, and Moneybird
 * reminds a customer about an invoice it thinks is open. So the hourly push
 * books each such payment on its invoice in Moneybird: on the financial
 * account Mollie pays out from (`MONEYBIRD_FINANCIAL_ACCOUNT_ID_MOLLIE`), under
 * Mollie's payment id, for what Mollie took (after a credit note decided
 * before the payment, less than the total; slice 7d), on the day it was paid.
 *
 * Once, whatever happens between: the invoice is claimed by the push's lease
 * (managed 0047), one writer at a time, and before booking, the invoice is
 * read: a payment there already carrying Mollie's id, or the invoice paid in
 * the books by other means, is written down as held and never booked again.
 * A run that dies after the booking and before the write finds its booking on
 * the next read.
 */

import { sql } from 'drizzle-orm';
import type { PgDatabase } from '@openmig/ledger/db';
import type { TenantId } from '@openmig/shared';
import type { MoneybirdSettings } from './moneybird-config.ts';
import type { SlowDown } from './moneybird-http.ts';
import { readSalesInvoice, registerPayment } from './moneybird-sales-invoices.ts';
import { PUSH_LEASE_MINUTES } from './invoice-push.ts';

/** A paid invoice whose payment the books do not hold yet. */
export interface PaymentToBook {
  readonly id: string;
  readonly reference: string | null;
  readonly invoiceNumber: string | null;
  readonly administrationId: string;
  readonly moneybirdId: string;
  /** Mollie's payment id, `tr_…`: the booking's transaction identifier. */
  readonly paymentId: string;
  /** What Mollie took, in cents. */
  readonly paidCents: number;
  /** The day it was paid, a UTC day, `YYYY-MM-DD`. */
  readonly paymentDate: string;
}

/**
 * Claim the organisation's oldest invoice paid through Mollie that the books
 * do not hold yet and no other push holds, for one attempt. Null when there is
 * none. In the organisation's own scope.
 */
export async function claimNextPaymentToBook(
  db: PgDatabase,
  tenantId: TenantId,
  now: Date,
): Promise<PaymentToBook | null> {
  const until = new Date(now.getTime() + PUSH_LEASE_MINUTES * 60_000);
  const claimed = await db.execute(sql`
    UPDATE invoice SET push_lease_until = ${until.toISOString()}::timestamptz
     WHERE id = (
       SELECT id FROM invoice
        WHERE tenant_id = ${tenantId} AND status = 'paid' AND kind = 'invoice'
          AND paid_cents IS NOT NULL AND payment_id IS NOT NULL AND paid_at IS NOT NULL
          AND moneybird_id IS NOT NULL AND moneybird_administration_id IS NOT NULL
          AND moneybird_paid_at IS NULL
          AND (push_lease_until IS NULL OR push_lease_until < ${now.toISOString()}::timestamptz)
        ORDER BY paid_at, id
        LIMIT 1
        FOR UPDATE SKIP LOCKED)
    RETURNING id, reference, invoice_number, moneybird_administration_id, moneybird_id, payment_id,
              paid_cents::text AS paid_cents, to_char(paid_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS payment_date`);
  const row = (
    claimed as unknown as {
      rows: {
        id: string;
        reference: string | null;
        invoice_number: string | null;
        moneybird_administration_id: string;
        moneybird_id: string;
        payment_id: string;
        paid_cents: string;
        payment_date: string;
      }[];
    }
  ).rows[0];
  if (!row) return null;
  return {
    id: row.id,
    reference: row.reference,
    invoiceNumber: row.invoice_number,
    administrationId: row.moneybird_administration_id,
    moneybirdId: row.moneybird_id,
    paymentId: row.payment_id,
    paidCents: Number(row.paid_cents),
    paymentDate: row.payment_date,
  };
}

/** The books hold the payment: written once, and the claim let go. True when this call wrote it. */
export async function recordPaymentBooked(
  db: PgDatabase,
  tenantId: TenantId,
  invoiceId: string,
  now: Date,
): Promise<boolean> {
  const written = await db.execute(sql`
    UPDATE invoice SET moneybird_paid_at = ${now.toISOString()}::timestamptz, push_lease_until = NULL
     WHERE id = ${invoiceId} AND tenant_id = ${tenantId} AND moneybird_paid_at IS NULL
    RETURNING id`);
  return (written as unknown as { rows: unknown[] }).rows.length === 1;
}

export type BookPaymentOutcome =
  | { readonly kind: 'booked' }
  /** The books held it already: a payment with Mollie's id, or the invoice paid there by other means. */
  | { readonly kind: 'held'; readonly why: 'booked_before' | 'paid_in_the_books' }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | SlowDown;

/** Book one payment on its invoice in Moneybird, once (see the header). */
export async function bookPayment(
  settings: MoneybirdSettings,
  mollieAccountId: string,
  payment: PaymentToBook,
  fetchImpl?: typeof fetch,
): Promise<BookPaymentOutcome> {
  const name = payment.invoiceNumber ?? payment.reference ?? payment.id;
  if (payment.administrationId !== settings.administrationId) {
    return {
      kind: 'refused',
      reason:
        `invoice ${name} was issued in administration ${payment.administrationId}, and this deployment's books ` +
        `are ${settings.administrationId}: its payment is not booked in books that do not hold it`,
    };
  }
  const read = await readSalesInvoice(settings, payment.moneybirdId, fetchImpl);
  if (read.kind !== 'ok') return read;
  if (read.invoice.transactionIdentifiers.includes(payment.paymentId)) return { kind: 'held', why: 'booked_before' };
  if (read.invoice.state === 'paid') return { kind: 'held', why: 'paid_in_the_books' };
  const booked = await registerPayment(
    settings,
    payment.moneybirdId,
    {
      paymentDate: payment.paymentDate,
      cents: payment.paidCents,
      financialAccountId: mollieAccountId,
      transactionIdentifier: payment.paymentId,
    },
    fetchImpl,
  );
  if (booked.kind === 'registered') return { kind: 'booked' };
  if (booked.kind === 'refused') return { kind: 'refused', reason: `invoice ${name}: ${booked.reason}` };
  return booked;
}
