// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The money the operator gives back by hand, or watches (workplan 0111; the
 * owner, 2026-10-11: "yes, build the support list and the email too").
 *
 * The hourly push says three things that ask the operator to act, once each:
 * a credit note paid, but not through Mollie, to pay back by transfer; a
 * refund Mollie ended failed or canceled, to pay back by transfer; a refund
 * still going a week after it was made, to look at. Said only on a run's
 * output, they went with the run's container. Now the support screen lists
 * them from what the invoice table records (`support_money_to_give_back`,
 * managed migration 0055), and the push mails each to `NOTIFY_TO`.
 *
 * The operator marks one paid back once the transfer is made (and, for a
 * failed refund booked in the books, its payment taken off the credit note):
 * `money_given_back`, who and when, never changed. A late refund takes no
 * mark: it leaves the list when Mollie ends it.
 *
 * Both functions run as the operator (`withSubject`): the view and the table
 * answer an operator and nobody else, so a non-operator lists nothing and
 * marks nothing, and is told "not found" (the support routes' doctrine).
 */

import { sql } from 'drizzle-orm';
import type { PgDatabase } from '@openmig/ledger/db';

/** Why a credit note is on the list. */
export type MoneyReason = 'by_hand' | 'refund_failed' | 'refund_canceled' | 'refund_late';

export const MONEY_REASONS: readonly MoneyReason[] = ['by_hand', 'refund_failed', 'refund_canceled', 'refund_late'];

/** The reasons an operator pays back by transfer, and marks when done. */
export const PAID_BACK_BY_HAND: readonly MoneyReason[] = ['by_hand', 'refund_failed', 'refund_canceled'];

export interface MoneyToGiveBack {
  readonly creditNoteId: string;
  readonly tenantId: string;
  readonly organisation: string;
  readonly creditNoteNumber: string | null;
  readonly invoiceNumber: string | null;
  readonly reason: MoneyReason;
  /** What goes back, in cents: the credit note's amount by hand, the refund's otherwise. */
  readonly cents: number;
  readonly currency: string;
  readonly refundId: string | null;
  /** Mollie's last word on the refund, or null by hand. */
  readonly refundStatus: string | null;
  /** A failed refund booked on its credit note in the books, whose payment must come off it. */
  readonly refundInTheBooks: boolean;
  /** When the push wrote it down. */
  readonly saidAt: string;
  readonly givenBackAt: string | null;
  /** The address of the operator who marked it. */
  readonly givenBackBy: string | null;
}

type Row = Record<string, unknown>;
const rowsOf = (result: unknown) => (result as { rows: Row[] }).rows;
const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const iso = (v: unknown): string | null => (v === null || v === undefined ? null : new Date(String(v)).toISOString());

/** A reason read back through the guard: one this build does not know is no row of ours. */
const reasonOf = (v: unknown): MoneyReason | null =>
  (MONEY_REASONS as readonly string[]).includes(String(v)) ? (v as MoneyReason) : null;

/**
 * Everything on the list: what is still owed or watched first, oldest first,
 * then what was marked, newest first.
 */
export async function listMoneyToGiveBack(db: PgDatabase): Promise<MoneyToGiveBack[]> {
  const rows = rowsOf(
    await db.execute(sql`
      SELECT credit_note_id, tenant_id, organisation, credit_note_number, invoice_number, reason,
             cents::text AS cents, currency, refund_id, refund_status, refund_in_the_books,
             said_at, given_back_at, given_back_by
        FROM public.support_money_to_give_back
       ORDER BY (given_back_at IS NOT NULL), said_at, given_back_at DESC, credit_note_id`),
  );
  const out: MoneyToGiveBack[] = [];
  for (const r of rows) {
    const reason = reasonOf(r.reason);
    if (!reason) continue;
    out.push({
      creditNoteId: String(r.credit_note_id),
      tenantId: String(r.tenant_id),
      organisation: String(r.organisation ?? ''),
      creditNoteNumber: text(r.credit_note_number),
      invoiceNumber: text(r.invoice_number),
      reason,
      cents: Number(r.cents ?? 0),
      currency: String(r.currency ?? 'EUR'),
      refundId: text(r.refund_id),
      refundStatus: text(r.refund_status),
      refundInTheBooks: r.refund_in_the_books === true || r.refund_in_the_books === 't',
      saidAt: iso(r.said_at) ?? '',
      givenBackAt: iso(r.given_back_at),
      givenBackBy: text(r.given_back_by),
    });
  }
  return out;
}

/**
 * What marking one did:
 * - `marked`: the mark is written, in this operator's name;
 * - `already`: it was marked before, by whoever did;
 * - `watched`: a late refund, which takes no mark;
 * - `not_found`: no such credit note on the list, or not this subject's to see.
 */
export type MarkOutcome = 'marked' | 'already' | 'watched' | 'not_found';

/** Mark a credit note's money paid back by hand, once, in the operator's name. */
export async function markMoneyGivenBack(
  db: PgDatabase,
  creditNoteId: string,
  operatorUserId: string,
  now: Date,
): Promise<MarkOutcome> {
  const [row] = rowsOf(
    await db.execute(sql`
      SELECT reason, given_back_at FROM public.support_money_to_give_back
       WHERE credit_note_id = ${creditNoteId}::uuid`),
  );
  if (!row) return 'not_found';
  const reason = reasonOf(row.reason);
  if (!reason) return 'not_found';
  if (!PAID_BACK_BY_HAND.includes(reason)) return 'watched';
  if (row.given_back_at !== null && row.given_back_at !== undefined) return 'already';
  // Two operators pressing at once: the key keeps one mark, and the other is told.
  const written = rowsOf(
    await db.execute(sql`
      INSERT INTO public.money_given_back (invoice_id, given_back_at, given_back_by)
      VALUES (${creditNoteId}::uuid, ${now.toISOString()}::timestamptz, ${operatorUserId})
      ON CONFLICT (invoice_id) DO NOTHING
      RETURNING invoice_id`),
  );
  return written.length === 1 ? 'marked' : 'already';
}
