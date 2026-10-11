// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * MONEY BACK FOR A CREDIT NOTE (workplan 0111, T7, slice 7d, its second half;
 * terms §7: *"whatever you paid above it we refund within 14 days, by the
 * means of payment you used"*).
 *
 * A credit note takes an amount off the invoice it corrects (credit-note.ts),
 * and once the books have numbered it, the hourly push makes that amount real,
 * one way, once (managed 0052):
 *
 *  - **refunded**: the invoice was paid through Mollie, and more was paid than
 *    is owed now (its total less every credit note on it). What was paid above
 *    goes back through Mollie, as a refund of that payment, never more than
 *    the credit note and never more than was paid; then the books are told, as
 *    a payment on the credit note, on Mollie's account, under the refund's id.
 *  - **settled**: nothing was paid above what is owed (the invoice is unpaid,
 *    or was paid only what was left after the credit), so the credit note is
 *    set against the invoice in the books, and no money moves.
 *  - **by hand**: the invoice was paid, but not through Mollie (a transfer the
 *    books saw, slice 5f): the money goes back by transfer, and the operator is
 *    told, once, with the amount to check.
 *
 * Never twice: the credit note is claimed with the push's lease, one writer at
 * a time; before a refund, the payment's refunds are read, and one carrying
 * this credit note's reference is adopted, not made again (Mollie's idempotency
 * key, the same reference, covers a retry within its hour); before settling,
 * the credit invoice is read, and one the books hold paid is written down; and
 * the database writes the outcome once (0052's trigger).
 */

import { sql } from 'drizzle-orm';
import type { PgDatabase } from '@openmig/ledger/db';
import type { TenantId } from '@openmig/shared';
import type { MoneybirdSettings } from './moneybird-config.ts';
import type { SlowDown } from './moneybird-http.ts';
import { readSalesInvoice, registerCreditInvoicePayment, registerPayment } from './moneybird-sales-invoices.ts';
import { createRefund, creditNoteRefundOf, listRefunds } from './mollie-refunds.ts';
import { PUSH_LEASE_MINUTES } from './invoice-push.ts';

/** An issued credit note whose amount has not been made real yet, with the invoice it corrects. */
export interface MoneyBackDue {
  readonly id: string;
  readonly reference: string;
  readonly invoiceNumber: string | null;
  readonly administrationId: string;
  /** The credit invoice in Moneybird. */
  readonly moneybirdId: string;
  /** What it takes off, in cents, positive. */
  readonly creditCents: number;
  readonly original: {
    readonly id: string;
    readonly invoiceNumber: string | null;
    readonly status: 'sent' | 'overdue' | 'paid';
    readonly totalCents: number;
    /** Mollie's `tr_…` when it was paid through Mollie. */
    readonly paymentId: string | null;
    /** What Mollie took, in cents (slice 5f). */
    readonly paidCents: number | null;
  };
  /** What every credit note on the invoice takes off it, not void, issued or not: positive. */
  readonly creditedCents: number;
  /** What its other credit notes have refunded already, in cents. */
  readonly refundedCents: number;
}

export type MoneyBackDecision =
  | { readonly kind: 'refund'; readonly cents: number; readonly paymentId: string }
  | { readonly kind: 'settle' }
  | { readonly kind: 'by_hand'; readonly cents: number };

/**
 * How the credit note's amount is made real (see the header). What goes back
 * is what was paid above what is owed, less what went back before, and never
 * more than this credit note.
 */
export function decideMoneyBack(due: MoneyBackDue): MoneyBackDecision {
  const original = due.original;
  if (original.status !== 'paid') return { kind: 'settle' };
  if (original.paymentId === null || original.paidCents === null) return { kind: 'by_hand', cents: due.creditCents };
  const owed = Math.max(original.totalCents - due.creditedCents, 0);
  const cents = Math.min(due.creditCents, original.paidCents - owed - due.refundedCents);
  return cents > 0 ? { kind: 'refund', cents, paymentId: original.paymentId } : { kind: 'settle' };
}

type Row = Record<string, string | null>;
const rowsOf = (result: unknown) => (result as { rows: Row[] }).rows;

/**
 * Claim the organisation's oldest issued credit note whose amount has not been
 * made real and no other push holds, for one attempt. Null when there is none.
 * In the organisation's own scope.
 */
export async function claimNextMoneyBack(db: PgDatabase, tenantId: TenantId, now: Date): Promise<MoneyBackDue | null> {
  const until = new Date(now.getTime() + PUSH_LEASE_MINUTES * 60_000);
  const [note] = rowsOf(
    await db.execute(sql`
      UPDATE invoice SET push_lease_until = ${until.toISOString()}::timestamptz
       WHERE id = (
         SELECT c.id FROM invoice c JOIN invoice o ON o.id = c.credited_invoice_id
          WHERE c.tenant_id = ${tenantId} AND c.kind = 'credit_note' AND c.status = 'sent' AND c.money_back IS NULL
            AND c.moneybird_id IS NOT NULL AND c.moneybird_administration_id IS NOT NULL AND c.reference IS NOT NULL
            AND (c.push_lease_until IS NULL OR c.push_lease_until < ${now.toISOString()}::timestamptz)
            AND o.status IN ('sent', 'overdue', 'paid')
          ORDER BY c.sent_at, c.id
          LIMIT 1
          FOR UPDATE OF c SKIP LOCKED)
      RETURNING id, reference, invoice_number, moneybird_administration_id, moneybird_id, (-total)::text AS credit_cents,
                credited_invoice_id`),
  );
  if (!note) return null;
  const [original] = rowsOf(
    await db.execute(sql`
      SELECT o.id, o.invoice_number, o.status, o.total::text AS total, o.payment_id, o.paid_cents::text AS paid_cents,
             (SELECT COALESCE(-sum(c.total), 0) FROM invoice c
               WHERE c.credited_invoice_id = o.id AND c.kind = 'credit_note' AND c.status <> 'void')::text AS credited,
             (SELECT COALESCE(sum(c.refund_cents), 0) FROM invoice c
               WHERE c.credited_invoice_id = o.id AND c.money_back = 'refunded')::text AS refunded
        FROM invoice o WHERE o.id = ${note.credited_invoice_id}`),
  );
  if (!original) throw new Error(`credit note ${note.reference}: the invoice it corrects cannot be read`);
  return {
    id: note.id!,
    reference: note.reference!,
    invoiceNumber: note.invoice_number ?? null,
    administrationId: note.moneybird_administration_id!,
    moneybirdId: note.moneybird_id!,
    creditCents: Number(note.credit_cents),
    original: {
      id: original.id!,
      invoiceNumber: original.invoice_number ?? null,
      status: original.status as MoneyBackDue['original']['status'],
      totalCents: Number(original.total),
      paymentId: original.payment_id ?? null,
      paidCents: original.paid_cents === null || original.paid_cents === undefined ? null : Number(original.paid_cents),
    },
    creditedCents: Number(original.credited),
    refundedCents: Number(original.refunded),
  };
}

export type MoneyBackOutcome =
  | { readonly kind: 'refunded'; readonly refundId: string; readonly cents: number; readonly adopted: boolean }
  | { readonly kind: 'settled'; readonly before: boolean }
  | { readonly kind: 'by_hand'; readonly cents: number }
  /** A refund is due, and no Mollie key is set: it waits, and the run says so. */
  | { readonly kind: 'waiting'; readonly reason: string }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | SlowDown;

/** Make one credit note's amount real, as decided (see the header). Nothing is written here. */
export async function makeMoneyBack(
  settings: MoneybirdSettings,
  mollieApiKey: string | null,
  due: MoneyBackDue,
  options: { readonly fetchImpl?: typeof fetch } = {},
): Promise<MoneyBackOutcome> {
  const name = due.invoiceNumber ?? due.reference;
  const decision = decideMoneyBack(due);
  if (decision.kind === 'by_hand') return { kind: 'by_hand', cents: decision.cents };
  if (decision.kind === 'refund') {
    if (!mollieApiKey) {
      return { kind: 'waiting', reason: `credit note ${name}: a refund through Mollie is due, and MOLLIE_API_KEY is not set` };
    }
    const listed = await listRefunds(mollieApiKey, decision.paymentId, options.fetchImpl);
    if (listed.kind !== 'ok') return listed;
    const before = creditNoteRefundOf(listed.refunds, due.reference);
    if (before) return { kind: 'refunded', refundId: before.id, cents: before.cents, adopted: true };
    const made = await createRefund(
      mollieApiKey,
      decision.paymentId,
      {
        cents: decision.cents,
        reference: due.reference,
        description: `Ownpace ${name}, ${due.original.invoiceNumber ?? 'invoice'}`,
      },
      options.fetchImpl,
    );
    if (made.kind === 'refunded') return { kind: 'refunded', refundId: made.refund.id, cents: made.refund.cents, adopted: false };
    return made.kind === 'refused' ? { kind: 'refused', reason: `credit note ${name}: ${made.reason}` } : made;
  }
  if (due.administrationId !== settings.administrationId) {
    return {
      kind: 'refused',
      reason:
        `credit note ${name} was issued in administration ${due.administrationId}, and this deployment's books are ` +
        `${settings.administrationId}: it is not settled in books that do not hold it`,
    };
  }
  const read = await readSalesInvoice(settings, due.moneybirdId, options.fetchImpl);
  if (read.kind !== 'ok') return read;
  if (read.invoice.state === 'paid') return { kind: 'settled', before: true };
  const settled = await registerCreditInvoicePayment(settings, due.moneybirdId, options.fetchImpl);
  if (settled.kind === 'settled') return { kind: 'settled', before: false };
  return settled.kind === 'refused' ? { kind: 'refused', reason: `credit note ${name}: ${settled.reason}` } : settled;
}

/**
 * Write down how the credit note's amount was made real, once, and let go of
 * the claim. A settle is the books' own act, so the books hold it from then
 * (`moneybird_paid_at`); a refund is booked there next (`bookRefund`). True
 * when this call wrote it.
 */
export async function recordMoneyBack(
  db: PgDatabase,
  tenantId: TenantId,
  creditNoteId: string,
  outcome: Extract<MoneyBackOutcome, { kind: 'refunded' | 'settled' | 'by_hand' }>,
  now: Date,
): Promise<boolean> {
  const at = now.toISOString();
  const refundId = outcome.kind === 'refunded' ? outcome.refundId : null;
  const refundCents = outcome.kind === 'refunded' ? outcome.cents : null;
  const written = await db.execute(sql`
    UPDATE invoice SET money_back = ${outcome.kind}, money_back_at = ${at}::timestamptz,
                       refund_id = ${refundId}, refund_cents = ${refundCents}::bigint,
                       moneybird_paid_at = CASE WHEN ${outcome.kind}::text = 'settled'
                                                THEN COALESCE(moneybird_paid_at, ${at}::timestamptz)
                                                ELSE moneybird_paid_at END,
                       push_lease_until = NULL, updated_at = ${at}::timestamptz
     WHERE id = ${creditNoteId} AND tenant_id = ${tenantId} AND kind = 'credit_note' AND money_back IS NULL
    RETURNING id`);
  return rowsOf(written).length === 1;
}

/** A refund made through Mollie that the books have not been told of. */
export interface RefundToBook {
  readonly id: string;
  readonly reference: string;
  readonly invoiceNumber: string | null;
  readonly administrationId: string;
  readonly moneybirdId: string;
  /** Mollie's `re_…`: the booking's transaction identifier. */
  readonly refundId: string;
  readonly refundCents: number;
  /** The day it went back, a UTC day, `YYYY-MM-DD`. */
  readonly refundDate: string;
}

/** Claim the organisation's oldest refund the books have not been told of, for one attempt. */
export async function claimNextRefundToBook(db: PgDatabase, tenantId: TenantId, now: Date): Promise<RefundToBook | null> {
  const until = new Date(now.getTime() + PUSH_LEASE_MINUTES * 60_000);
  const [row] = rowsOf(
    await db.execute(sql`
      UPDATE invoice SET push_lease_until = ${until.toISOString()}::timestamptz
       WHERE id = (
         SELECT id FROM invoice
          WHERE tenant_id = ${tenantId} AND kind = 'credit_note' AND money_back = 'refunded' AND moneybird_paid_at IS NULL
            AND moneybird_id IS NOT NULL AND moneybird_administration_id IS NOT NULL
            AND (push_lease_until IS NULL OR push_lease_until < ${now.toISOString()}::timestamptz)
          ORDER BY money_back_at, id
          LIMIT 1
          FOR UPDATE SKIP LOCKED)
      RETURNING id, reference, invoice_number, moneybird_administration_id, moneybird_id, refund_id,
                refund_cents::text AS refund_cents, to_char(money_back_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS refund_date`),
  );
  if (!row) return null;
  return {
    id: row.id!,
    reference: row.reference!,
    invoiceNumber: row.invoice_number ?? null,
    administrationId: row.moneybird_administration_id!,
    moneybirdId: row.moneybird_id!,
    refundId: row.refund_id!,
    refundCents: Number(row.refund_cents),
    refundDate: row.refund_date!,
  };
}

export type BookRefundOutcome =
  | { readonly kind: 'booked' }
  | { readonly kind: 'held'; readonly why: 'booked_before' | 'paid_in_the_books' }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | SlowDown;

/**
 * Tell the books of a refund, once: a payment on the credit note, of the
 * amount that went back (negative, as the credit note is), on the account
 * Mollie pays out from, under the refund's id. Read first: one there already
 * is written down, never booked again.
 */
export async function bookRefund(
  settings: MoneybirdSettings,
  mollieAccountId: string,
  refund: RefundToBook,
  fetchImpl?: typeof fetch,
): Promise<BookRefundOutcome> {
  const name = refund.invoiceNumber ?? refund.reference;
  if (refund.administrationId !== settings.administrationId) {
    return {
      kind: 'refused',
      reason:
        `credit note ${name} was issued in administration ${refund.administrationId}, and this deployment's books are ` +
        `${settings.administrationId}: its refund is not booked in books that do not hold it`,
    };
  }
  const read = await readSalesInvoice(settings, refund.moneybirdId, fetchImpl);
  if (read.kind !== 'ok') return read;
  if (read.invoice.transactionIdentifiers.includes(refund.refundId)) return { kind: 'held', why: 'booked_before' };
  if (read.invoice.state === 'paid') return { kind: 'held', why: 'paid_in_the_books' };
  const booked = await registerPayment(
    settings,
    refund.moneybirdId,
    {
      paymentDate: refund.refundDate,
      cents: -refund.refundCents,
      financialAccountId: mollieAccountId,
      transactionIdentifier: refund.refundId,
    },
    fetchImpl,
  );
  if (booked.kind === 'registered') return { kind: 'booked' };
  if (booked.kind === 'refused') return { kind: 'refused', reason: `credit note ${name}: ${booked.reason}` };
  return booked;
}
