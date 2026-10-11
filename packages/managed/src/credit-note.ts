// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CREDIT NOTE IS OUR ROW FIRST (workplan 0111, T7 and slice 7a of §"The
 * build, sliced"; ADR-0044: an issued invoice is corrected by a credit note,
 * never edited).
 *
 * The row says what is credited, and why, when the decision is made: which
 * invoice, what share of it (`numerator` of `denominator`, the days not used
 * of the days it paid for, for a withdrawal, decision 15), the words, and the
 * evidence. It is a draft, `kind = 'credit_note'`, naming the invoice it
 * corrects (managed 0045 holds a credit note to naming one), under our
 * reference: the invoice's, with `-c-` for `-m-`. So an invoice has one credit
 * note at the most, and recording it twice records it once.
 *
 * The push (`moneybird-credit-push.ts`) takes it to the books once the invoice
 * it corrects is issued: an invoice still a draft has no number to correct,
 * and is numbered within the hour. Its price is decided then, from the
 * invoice's lines as issued; the row is written back numbered, with the line
 * and the totals as Moneybird made them, negative.
 *
 * ## One writer by construction
 *
 * As a draft invoice's push: a claim first (`push_lease_until`, managed
 * 0047), in an update only one claim can win. Moneybird's id of the credit
 * note's draft is written onto the row the moment Moneybird gives it
 * (`recordCreditDraft`), before the draft is filled, so the next push fills
 * that one; managed 0045 allows the id on a draft and never lets it change.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { PgDatabase } from '@openmig/ledger/db';
import type { TenantId } from '@openmig/shared';
import { PUSH_LEASE_MINUTES } from './invoice-push.ts';
import type { MoneybirdSettings } from './moneybird-config.ts';
import type { CreditNoteToPush, CreditPushOutcome, CreditedInvoice } from './moneybird-credit-push.ts';
import { invoice } from './schema-managed.ts';
import type { VatTreatment } from './vat-treatment.ts';

/** The invoice's reference, `-m-` (a month's step) made `-c-`: its credit note's. */
export function creditReference(reference: string): string {
  const at = reference.lastIndexOf('-m-');
  if (!reference.startsWith('ownpace-') || at < 0) {
    throw new Error(`${reference} is not a month's invoice reference, so it has no credit note reference`);
  }
  return `${reference.slice(0, at)}-c-${reference.slice(at + 3)}`;
}

/** What a credit note says when it is decided. */
export interface CreditDecision {
  /** Its words, in the organisation's language; `{invoice}` stands for the invoice's number. */
  readonly description: string;
  /** The share credited: `numerator` of `denominator`. */
  readonly numerator: number;
  readonly denominator: number;
  /** Why, as the row keeps it (the withdrawal's facts, for one). */
  readonly evidence: Readonly<Record<string, unknown>>;
}

export type RecordCreditOutcome =
  | { readonly kind: 'recorded'; readonly reference: string }
  /** A credit note for this invoice exists already: the first one stands. */
  | { readonly kind: 'exists'; readonly reference: string }
  | { readonly kind: 'refused'; readonly reason: string };

/**
 * Record a credit note for the invoice `creditedId`, as a draft, in the
 * organisation's own scope. A void invoice, a credit note, and an invoice of
 * another organisation are refused; a share of nothing is not recorded.
 */
export async function recordCreditNote(
  db: PgDatabase,
  tenantId: TenantId,
  creditedId: string,
  decision: CreditDecision,
): Promise<RecordCreditOutcome> {
  const { numerator, denominator } = decision;
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator <= 0 || numerator < 0 || numerator > denominator) {
    return { kind: 'refused', reason: `a share of ${numerator} of ${denominator} is not one a credit note can credit` };
  }
  if (numerator === 0) return { kind: 'refused', reason: 'a share of nothing credits nothing' };
  const [credited] = await db
    .select({ id: invoice.id, reference: invoice.reference, kind: invoice.kind, status: invoice.status, total: invoice.total })
    .from(invoice)
    .where(and(eq(invoice.id, creditedId), eq(invoice.tenantId, tenantId)));
  if (!credited) return { kind: 'refused', reason: `no invoice ${creditedId} in this organisation` };
  if (credited.kind !== 'invoice') return { kind: 'refused', reason: `${credited.reference ?? creditedId} is not an invoice` };
  if (credited.status === 'void') return { kind: 'refused', reason: `${credited.reference ?? creditedId} is void: nothing to credit` };
  if (!credited.reference) return { kind: 'refused', reason: `invoice ${creditedId} has no reference, so it was never pushed` };
  const reference = creditReference(credited.reference);
  // Provisional until issued: the invoice's total as it stands, shared out.
  // The push writes Moneybird's figures over it.
  const provisional = String(-Math.round((Number(credited.total) * numerator) / denominator));
  const result = await db.execute(sql`
    INSERT INTO invoice (tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total,
                         currency, reference, kind, credited_invoice_id, evidence, lines)
    SELECT tenant_id, period_start, period_end, 'draft', ${provisional}::numeric, 0, 0, ${provisional}::numeric,
           currency, ${reference}::text, 'credit_note', id, ${JSON.stringify(decision.evidence)}::jsonb,
           ${JSON.stringify([{ description: decision.description, numerator, denominator }])}::jsonb
      FROM invoice WHERE id = ${creditedId}
    ON CONFLICT (reference) WHERE reference IS NOT NULL DO NOTHING
    RETURNING id`);
  const rows = (result as unknown as { rows: { id: string }[] }).rows;
  return rows.length === 1 ? { kind: 'recorded', reference } : { kind: 'exists', reference };
}

/** A credit note a push holds, with the invoice it corrects as issued. */
export interface CreditNoteDraft {
  readonly id: string;
  readonly reference: string;
  readonly moneybirdId: string | null;
  readonly description: string;
  readonly numerator: number;
  readonly denominator: number;
  readonly credited: CreditedInvoice & {
    readonly id: string;
    readonly administrationId: string;
    readonly vatTreatment: VatTreatment | null;
    /** The rate as the invoice's row holds it, a fraction. */
    readonly taxRate: string;
  };
}

function decisionOf(raw: unknown): { description: string; numerator: number; denominator: number } | null {
  if (!Array.isArray(raw) || raw.length !== 1) return null;
  const line = raw[0] as { description?: unknown; numerator?: unknown; denominator?: unknown };
  if (typeof line?.description !== 'string' || line.description === '') return null;
  if (!Number.isInteger(line.numerator) || !Number.isInteger(line.denominator)) return null;
  return { description: line.description, numerator: line.numerator as number, denominator: line.denominator as number };
}

function issuedLinesOf(raw: unknown): { description: string; cents: number }[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const lines: { description: string; cents: number }[] = [];
  for (const line of raw as { description?: unknown; cents?: unknown }[]) {
    if (typeof line?.description !== 'string' || !Number.isSafeInteger(line.cents)) return null;
    lines.push({ description: line.description, cents: line.cents as number });
  }
  return lines;
}

/**
 * Claim the organisation's oldest credit note whose invoice is issued and no
 * other push holds, for one attempt. Null when there is none. In the
 * organisation's own scope.
 */
export async function claimNextCreditNote(db: PgDatabase, tenantId: TenantId, now: Date): Promise<CreditNoteDraft | null> {
  const until = new Date(now.getTime() + PUSH_LEASE_MINUTES * 60_000);
  const claimed = await db.execute(sql`
    UPDATE invoice SET push_lease_until = ${until.toISOString()}::timestamptz
     WHERE id = (
       SELECT c.id FROM invoice c JOIN invoice o ON o.id = c.credited_invoice_id
        WHERE c.tenant_id = ${tenantId} AND c.status = 'draft' AND c.kind = 'credit_note' AND c.reference IS NOT NULL
          AND (c.push_lease_until IS NULL OR c.push_lease_until < ${now.toISOString()}::timestamptz)
          AND o.status IN ('sent', 'paid', 'overdue') AND o.moneybird_id IS NOT NULL
        ORDER BY c.created_at, c.reference
        LIMIT 1
        FOR UPDATE OF c SKIP LOCKED)
    RETURNING id, reference, moneybird_id, lines, credited_invoice_id`);
  const row = (
    claimed as unknown as {
      rows: { id: string; reference: string; moneybird_id: string | null; lines: unknown; credited_invoice_id: string }[];
    }
  ).rows[0];
  if (!row) return null;
  const decision = decisionOf(row.lines);
  // Never guessed: a credit note whose decision cannot be read is held, and said, not sent.
  if (!decision) throw new Error(`credit note ${row.reference}: what it credits cannot be read from its row`);
  const read = await db.execute(sql`
    SELECT id, reference, moneybird_administration_id, moneybird_id, invoice_number, invoice_date::text AS invoice_date,
           tax_rate_id, tax_rate::text AS tax_rate, vat_treatment, lines
      FROM invoice WHERE id = ${row.credited_invoice_id}`);
  const original = (
    read as unknown as {
      rows: {
        id: string;
        reference: string | null;
        moneybird_administration_id: string;
        moneybird_id: string;
        invoice_number: string;
        invoice_date: string;
        tax_rate_id: string | null;
        tax_rate: string;
        vat_treatment: VatTreatment | null;
        lines: unknown;
      }[];
    }
  ).rows[0];
  const lines = original ? issuedLinesOf(original.lines) : null;
  if (!original || !original.reference || !original.tax_rate_id || !lines) {
    throw new Error(`credit note ${row.reference}: the invoice it corrects cannot be read as issued`);
  }
  return {
    id: row.id,
    reference: row.reference,
    moneybirdId: row.moneybird_id,
    ...decision,
    credited: {
      id: original.id,
      reference: original.reference,
      administrationId: original.moneybird_administration_id,
      moneybirdId: original.moneybird_id,
      invoiceNumber: original.invoice_number,
      invoiceDate: original.invoice_date,
      taxRateId: original.tax_rate_id,
      taxRate: original.tax_rate,
      vatTreatment: original.vat_treatment,
      lines,
    },
  };
}

/** What `pushCreditNote` is asked to push, or why it is not asked: the invoice was issued in another administration. */
export function planCreditPush(
  note: CreditNoteDraft,
  settings: Pick<MoneybirdSettings, 'administrationId'>,
  now: Date,
): { readonly kind: 'push'; readonly note: CreditNoteToPush } | { readonly kind: 'refused'; readonly reason: string } {
  if (note.credited.administrationId !== settings.administrationId) {
    return {
      kind: 'refused',
      reason:
        `credit note ${note.reference}: invoice ${note.credited.invoiceNumber} was issued in Moneybird administration ` +
        `${note.credited.administrationId}, and this push writes to ${settings.administrationId}`,
    };
  }
  return {
    kind: 'push',
    note: {
      reference: note.reference,
      moneybirdId: note.moneybirdId,
      description: note.description,
      numerator: note.numerator,
      denominator: note.denominator,
      credited: note.credited,
      today: now.toISOString().slice(0, 10),
    },
  };
}

/**
 * Write Moneybird's id of the credit note's draft onto the row, before the
 * draft is filled. Only a draft, and only an id it does not hold another of:
 * a second id for one credit note is a second draft in Moneybird, and is
 * said, not written.
 */
export async function recordCreditDraft(
  db: PgDatabase,
  note: Pick<CreditNoteDraft, 'id' | 'reference'>,
  moneybirdId: string,
  settings: Pick<MoneybirdSettings, 'administrationId'>,
  now: Date,
): Promise<void> {
  const result = await db.execute(sql`
    UPDATE invoice SET moneybird_administration_id = ${settings.administrationId}, moneybird_id = ${moneybirdId},
                       updated_at = ${now.toISOString()}::timestamptz
     WHERE id = ${note.id} AND status = 'draft' AND (moneybird_id IS NULL OR moneybird_id = ${moneybirdId})
    RETURNING id`);
  if ((result as unknown as { rows: unknown[] }).rows.length !== 1) {
    throw new Error(
      `credit note ${note.reference}: Moneybird's draft ${moneybirdId} cannot be written down, because the row is no ` +
        'longer a draft or names another one',
    );
  }
}

/**
 * Write back what Moneybird made of a credit note: it leaves draft here,
 * numbered, with its line and its totals, and gives its lease back. Only a
 * draft is written.
 */
export async function recordCreditIssued(
  db: PgDatabase,
  note: CreditNoteDraft,
  outcome: Extract<CreditPushOutcome, { kind: 'issued' }>,
  settings: Pick<MoneybirdSettings, 'administrationId'>,
  now: Date,
): Promise<boolean> {
  const issued = outcome.invoice;
  if (!issued.invoiceNumber || !issued.invoiceDate) {
    throw new Error(`credit note ${note.reference}: Moneybird answered issued without a number and a date`);
  }
  const incl = issued.totalInclTaxCents;
  const excl = issued.totalExclTaxCents;
  const totals =
    incl !== null && excl !== null
      ? { subtotal: String(excl), total: String(incl), taxAmount: String(incl - excl), taxRate: note.credited.taxRate }
      : {};
  const rows = await db
    .update(invoice)
    .set({
      status: 'sent',
      sentAt: now,
      vatTreatment: note.credited.vatTreatment,
      taxRateId: note.credited.taxRateId,
      lines: [{ ...outcome.line, numerator: note.numerator, denominator: note.denominator }],
      moneybirdAdministrationId: settings.administrationId,
      moneybirdId: issued.id,
      invoiceNumber: issued.invoiceNumber,
      invoiceDate: issued.invoiceDate,
      ...(issued.dueDate ? { dueDate: issued.dueDate } : {}),
      ...totals,
      pushLeaseUntil: null,
      updatedAt: now,
    })
    .where(and(eq(invoice.id, note.id), eq(invoice.status, 'draft')))
    .returning({ id: invoice.id });
  return rows.length === 1;
}

/**
 * What the credit notes of the invoice `invoiceId` take off it, in cents, as a
 * positive amount (0111 T7, slice 7d): every credit note recorded for it that
 * is not void, issued or still a draft, since a credit decided is a credit owed.
 * The pay route asks for the invoice's total less this, and refuses when
 * nothing is left; the Billing page offers *Pay* on the same rule.
 */
export async function creditedCents(db: PgDatabase, tenantId: TenantId, invoiceId: string): Promise<number> {
  const result = await db.execute(sql`
    SELECT COALESCE(-sum(total), 0)::bigint::text AS credited FROM invoice
     WHERE tenant_id = ${tenantId} AND credited_invoice_id = ${invoiceId}
       AND kind = 'credit_note' AND status <> 'void'`);
  const row = (result as unknown as { rows: { credited: string }[] }).rows[0];
  return Number(row?.credited ?? 0);
}

/** The SQL the invoice list reads the same amount with, per row: credit-note.ts's `creditedCents`, inline. */
export const CREDITED_CENTS_SQL = sql`COALESCE((
  SELECT -sum(c.total) FROM invoice c
   WHERE c.credited_invoice_id = invoice.id AND c.kind = 'credit_note' AND c.status <> 'void'), 0)`;
