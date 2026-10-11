// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REFUND FOLLOWED TO ITS END (workplan 0111, T7, slice 7d; terms §7:
 * *"whatever you paid above it we refund within 14 days, by the means of
 * payment you used"*; the owner, 2026-10-11: *"yes, add the refund status
 * check"*).
 *
 * `money-back.ts` writes a refund down the moment Mollie accepts it, and the
 * push books it on the credit note. Accepted is not paid out: Mollie keeps a
 * refund `queued` until its balance covers it, then `pending` and
 * `processing`; only `refunded` means the money went back, and a refund can
 * end `failed` or `canceled` instead. So each hour, for each refund that has
 * not ended, the push reads the payment's refunds (`listRefunds`, the call
 * the refund itself reads first) and writes Mollie's word down (managed 0053):
 *
 *  - **refunded**: ended, and nothing more to do.
 *  - **failed** or **canceled**: ended, and the money did not go back. Said to
 *    the operator once, for a transfer by hand; a refund the books were not
 *    told of yet is not booked (`claimNextRefundToBook` passes it over).
 *  - **still going** seven days after it was made (`REFUND_LATE_DAYS`, half of
 *    the fourteen the terms promise): said to the operator once. A queued
 *    refund waits for Mollie's balance.
 *
 * Once, each: the writes are made only where nothing is written yet, and
 * whoever writes says it; the database refuses a second end and a second late
 * word (0053's trigger).
 */

import { sql } from 'drizzle-orm';
import type { PgDatabase } from '@openmig/ledger/db';
import type { TenantId } from '@openmig/shared';
import { listRefunds } from './mollie-refunds.ts';

type Row = Record<string, string | null>;
const rowsOf = (result: unknown) => (result as { rows: Row[] }).rows;

/** Mollie's word on a refund, as managed 0053 takes it. */
export type RefundStatus = 'queued' | 'pending' | 'processing' | 'refunded' | 'failed' | 'canceled';

const STATUSES: readonly RefundStatus[] = ['queued', 'pending', 'processing', 'refunded', 'failed', 'canceled'];

/** The words that end a refund. */
export const REFUND_ENDS: readonly RefundStatus[] = ['refunded', 'failed', 'canceled'];

/** Days after it was made that a refund still going is said: half of terms §7's fourteen. */
export const REFUND_LATE_DAYS = 7;

/** The refunds one run follows in one organisation at the most; the rest, the next hour. */
export const REFUNDS_FOLLOWED_PER_RUN = 50;

/** A refund made through Mollie that has not ended, as far as following it needs. */
export interface RefundToFollow {
  readonly id: string;
  readonly reference: string;
  readonly invoiceNumber: string | null;
  /** The number of the invoice the credit note corrects, for the operator's mail. */
  readonly creditedInvoiceNumber: string | null;
  /** Mollie's `re_…`. */
  readonly refundId: string;
  readonly refundCents: number;
  /** The payment it refunds, the corrected invoice's `tr_…`. */
  readonly paymentId: string;
  /** What Mollie said last; null until first asked. */
  readonly status: RefundStatus | null;
  readonly madeAt: Date;
  readonly lateSaid: boolean;
  /** Whether the books were told of it (booked on the credit note). */
  readonly inTheBooks: boolean;
}

/** The organisation's refunds that have not ended, oldest first. In its own scope. */
export async function refundsToFollow(
  db: PgDatabase,
  tenantId: TenantId,
  limit: number = REFUNDS_FOLLOWED_PER_RUN,
): Promise<RefundToFollow[]> {
  const rows = rowsOf(
    await db.execute(sql`
      SELECT c.id, c.reference, c.invoice_number, o.invoice_number AS credited_number, c.refund_id,
             c.refund_cents::text AS refund_cents,
             o.payment_id, c.refund_status, c.money_back_at::text AS made_at,
             (c.refund_late_said_at IS NOT NULL)::text AS late_said, (c.moneybird_paid_at IS NOT NULL)::text AS in_the_books
        FROM invoice c JOIN invoice o ON o.id = c.credited_invoice_id
       WHERE c.tenant_id = ${tenantId} AND c.kind = 'credit_note' AND c.money_back = 'refunded'
         AND c.refund_id IS NOT NULL AND c.refund_ended_at IS NULL AND o.payment_id IS NOT NULL
       ORDER BY c.money_back_at, c.id
       LIMIT ${limit}`),
  );
  return rows.map((row) => ({
    id: row.id!,
    reference: row.reference!,
    invoiceNumber: row.invoice_number ?? null,
    creditedInvoiceNumber: row.credited_number ?? null,
    refundId: row.refund_id!,
    refundCents: Number(row.refund_cents),
    paymentId: row.payment_id!,
    status: (row.refund_status as RefundStatus | null) ?? null,
    madeAt: new Date(row.made_at!),
    lateSaid: row.late_said === 'true',
    inTheBooks: row.in_the_books === 'true',
  }));
}

export type RefundFollowed =
  /** Mollie's word now, whether it changed, and whether it is late (not ended, past `REFUND_LATE_DAYS`). */
  | { readonly kind: 'read'; readonly status: RefundStatus; readonly late: boolean }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** Ask Mollie where one refund is. Nothing is written here. */
export async function followRefund(
  apiKey: string,
  refund: RefundToFollow,
  now: Date,
  fetchImpl?: typeof fetch,
): Promise<RefundFollowed> {
  const name = refund.invoiceNumber ?? refund.reference;
  const listed = await listRefunds(apiKey, refund.paymentId, fetchImpl);
  if (listed.kind !== 'ok') return listed;
  const found = listed.refunds.find((r) => r.id === refund.refundId);
  if (!found) {
    return {
      kind: 'unavailable',
      reason: `credit note ${name}: Mollie lists no refund ${refund.refundId} on payment ${refund.paymentId}`,
    };
  }
  if (!(STATUSES as readonly string[]).includes(found.status)) {
    return {
      kind: 'unavailable',
      reason: `credit note ${name}: Mollie says refund ${refund.refundId} is '${found.status}', a word this push does not know`,
    };
  }
  const status = found.status as RefundStatus;
  const late = !REFUND_ENDS.includes(status) && now.getTime() - refund.madeAt.getTime() >= REFUND_LATE_DAYS * 86_400_000;
  return { kind: 'read', status, late };
}

/**
 * Write Mollie's word down, where it is new and the refund has not ended; an
 * end is stamped with when it was seen. True when this call wrote it, so
 * whoever writes an end is the one who says it.
 */
export async function recordRefundStatus(
  db: PgDatabase,
  tenantId: TenantId,
  creditNoteId: string,
  status: RefundStatus,
  now: Date,
): Promise<boolean> {
  const at = now.toISOString();
  const ended = REFUND_ENDS.includes(status);
  const written = await db.execute(sql`
    UPDATE invoice SET refund_status = ${status},
                       refund_ended_at = ${ended ? at : null}::timestamptz,
                       updated_at = ${at}::timestamptz
     WHERE id = ${creditNoteId} AND tenant_id = ${tenantId} AND refund_id IS NOT NULL
       AND refund_ended_at IS NULL AND refund_status IS DISTINCT FROM ${status}
    RETURNING id`);
  return rowsOf(written).length === 1;
}

/** Write down that a late refund was said, once. True when this call wrote it, so it is said once. */
export async function recordRefundLateSaid(
  db: PgDatabase,
  tenantId: TenantId,
  creditNoteId: string,
  now: Date,
): Promise<boolean> {
  const written = await db.execute(sql`
    UPDATE invoice SET refund_late_said_at = ${now.toISOString()}::timestamptz
     WHERE id = ${creditNoteId} AND tenant_id = ${tenantId} AND refund_id IS NOT NULL
       AND refund_ended_at IS NULL AND refund_late_said_at IS NULL
    RETURNING id`);
  return rowsOf(written).length === 1;
}
