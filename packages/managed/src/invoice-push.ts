// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * EACH DRAFT, NUMBERED BY MONEYBIRD (workplan 0111, slice 5 of §"The build,
 * sliced"; ADR-0044: Moneybird numbers, renders and files the document, and
 * Ownpace mirrors it).
 *
 * The month task makes drafts (month-invoice.ts). This takes each one to the
 * books: it claims the draft, decides the VAT treatment from the buyer's
 * details and the latest VIES answer for the number as stored, builds the
 * invoice `pushInvoice` sends (moneybird-push.ts), and writes back what
 * Moneybird made of it: the legal number and date, the due date, the ids, the
 * treatment, the rate, the lines as invoiced and the totals. In that one
 * update the row leaves draft, which the database allows only with
 * Moneybird's number and id (managed 0045).
 *
 * ## One writer by construction
 *
 * A push claims its draft first (`push_lease_until`, managed 0047), in an
 * update only one claim can win, and talks to Moneybird only about a draft it
 * holds. The claim is for one attempt: a draft that is refused, or that
 * Moneybird could not take now, keeps its lease until it runs out, so a run
 * tries each draft once and the next run tries again. Only an issued draft
 * gives its lease back, in the update that issues it. A push that died after
 * Moneybird made the invoice is answered by the next one, which finds the
 * invoice by its reference and sends nothing twice (`pushInvoice`).
 *
 * ## Refused here, before Moneybird is asked anything
 *
 * A draft with no invoice details has nobody to be addressed to, and one that
 * Moneybird would e-mail has nowhere to go without an invoice address (the
 * Invoice details card asks for it, decision 11, managed 0048; without one,
 * `email` delivery is refused by name). Neither costs a request to find out.
 *
 * ## The buyer, as Moneybird holds it
 *
 * One contact per organisation, under our key `ownpace-{organisation}`. A
 * business by its registered name, with its VAT number; a consumer by their
 * full name, as `billing_party` holds it, in Moneybird's last-name field, so
 * the document prints it as given and nothing splits a name it cannot know
 * the parts of.
 *
 * ## Reverse charge says its evidence (decision 10)
 *
 * *Btw verlegd / VAT reverse charged. VIES {number}, {date}*, after the
 * line's own words: the consultation number VIES gave when the check was
 * qualified, or the number checked when it was not, and the date of VIES's
 * answer. The price is the published one without the Dutch VAT in it
 * (decision 9, line-price.ts).
 */

import { and, asc, eq, lt, sql } from 'drizzle-orm';
import type { PgDatabase } from '@openmig/ledger/db';
import type { TenantId } from '@openmig/shared';
import type { MoneybirdDelivery, MoneybirdSettings } from './moneybird-config.ts';
import type { InvoiceToPush, PushOutcome } from './moneybird-push.ts';
import { invoice } from './schema-managed.ts';
import type { readVatStanding } from './vat-standing.ts';
import { decideVatTreatment, type VatTreatment } from './vat-treatment.ts';

/** How long a push holds a draft: one attempt, and the next run after it runs out. */
export const PUSH_LEASE_MINUTES = 15;

/** A draft still a draft this long after it was made is behind (decision 6's alert). */
export const DRAFT_BEHIND_AFTER_HOURS = 48;

/** One line as the month task wrote it. */
export interface DraftLine {
  readonly description: string;
  readonly publishedCents: number;
}

/** A draft a push holds. */
export interface DraftToPush {
  readonly id: string;
  readonly reference: string;
  readonly lines: readonly DraftLine[];
}

/** What the buyer's details say, as `readVatStanding` reads them. */
export type BuyerStanding = Awaited<ReturnType<typeof readVatStanding>>;

/** The instance's facts a treatment is decided with. */
export interface PushContext {
  /** `OWNPACE_SELLER_COUNTRY`, NL until the entity decision says otherwise. */
  readonly sellerCountry: string;
  /** `VAT_OSS_ACTIVE`: false until the threshold decision flips (2026-08-29). */
  readonly ossActive: boolean;
  readonly delivery: MoneybirdDelivery;
}

function linesOf(raw: unknown): DraftLine[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const lines: DraftLine[] = [];
  for (const line of raw as { description?: unknown; publishedCents?: unknown }[]) {
    if (typeof line?.description !== 'string' || line.description === '') return null;
    if (typeof line.publishedCents !== 'number' || !Number.isInteger(line.publishedCents) || line.publishedCents <= 0) {
      return null;
    }
    lines.push({ description: line.description, publishedCents: line.publishedCents });
  }
  return lines;
}

/**
 * Claim the organisation's oldest draft no other push holds, for one
 * attempt. Null when there is none. In the organisation's own scope.
 */
export async function claimNextDraft(db: PgDatabase, tenantId: TenantId, now: Date): Promise<DraftToPush | null> {
  const until = new Date(now.getTime() + PUSH_LEASE_MINUTES * 60_000);
  const result = await db.execute(sql`
    UPDATE invoice SET push_lease_until = ${until.toISOString()}::timestamptz
     WHERE id = (
       SELECT id FROM invoice
        WHERE tenant_id = ${tenantId} AND status = 'draft' AND kind = 'invoice' AND reference IS NOT NULL
          AND (push_lease_until IS NULL OR push_lease_until < ${now.toISOString()}::timestamptz)
        ORDER BY created_at, reference
        LIMIT 1
        FOR UPDATE SKIP LOCKED)
    RETURNING id, reference, lines`);
  const rows = (result as unknown as { rows: { id: string; reference: string; lines: unknown }[] }).rows;
  const row = rows[0];
  if (!row) return null;
  const lines = linesOf(row.lines);
  // Never guessed: a draft whose lines cannot be read is held, and said, not sent.
  if (!lines) throw new Error(`invoice ${row.reference}: its lines cannot be read as words and published cents`);
  return { id: row.id, reference: row.reference, lines };
}

/** What to push, decided here without asking Moneybird anything. */
export type PushPlan =
  | { readonly kind: 'push'; readonly invoice: InvoiceToPush; readonly treatment: VatTreatment }
  | { readonly kind: 'refused'; readonly reason: string };

/** The VIES words a reverse-charge line ends with (decision 10). */
function reverseChargeWords(consultation: NonNullable<BuyerStanding['vatConsultation']>): string {
  const number = consultation.consultationNumber ?? `${consultation.countryCode}${consultation.vatNumber}`;
  const date = consultation.requestDate ?? consultation.checkedAt.toISOString().slice(0, 10);
  return `Btw verlegd / VAT reverse charged. VIES ${number}, ${date}`;
}

/** The invoice for a draft, from the buyer's details as they stand. */
export function planPush(tenantId: string, draft: DraftToPush, standing: BuyerStanding, context: PushContext): PushPlan {
  const party = standing.party;
  if (!party) {
    return {
      kind: 'refused',
      reason: `invoice ${draft.reference}: the organisation has given no invoice details, so there is nobody to address it to`,
    };
  }
  if (context.delivery === 'email' && !party.invoiceEmail) {
    return {
      kind: 'refused',
      reason:
        `invoice ${draft.reference}: Moneybird would e-mail it, and the organisation has given no invoice ` +
        'e-mail address to send it to (decision 11)',
    };
  }
  const { treatment } = decideVatTreatment({
    sellerCountry: context.sellerCountry,
    ossActive: context.ossActive,
    buyer: { kind: party.kind, countryCode: party.countryCode },
    consultation: standing.vatConsultation ? { valid: standing.vatConsultation.valid } : null,
  });
  const words = treatment === 'reverse_charge' && standing.vatConsultation ? reverseChargeWords(standing.vatConsultation) : null;
  const business = party.kind === 'business';
  return {
    kind: 'push',
    treatment,
    invoice: {
      reference: draft.reference,
      treatment,
      buyer: {
        customerId: `ownpace-${tenantId}`,
        companyName: business ? party.name : null,
        firstname: null,
        lastname: business ? null : party.name,
        address1: party.addressLine1,
        address2: party.addressLine2,
        zipcode: party.postalCode,
        city: party.city,
        country: party.countryCode,
        taxNumber: business ? party.vatNumber : null,
        // Where Moneybird e-mails it, the invoice address the card asks for
        // (managed 0048), and only when it is to e-mail it: under `Manual`, on
        // the sandbox and the OTA stack, a tester's address has no business in
        // the books, and the contact follows the buyer once delivery changes.
        email: context.delivery === 'email' ? (party.invoiceEmail ?? null) : null,
      },
      lines: draft.lines.map((line) => ({
        description: words ? `${line.description}. ${words}` : line.description,
        publishedCents: line.publishedCents,
      })),
    },
  };
}

/**
 * A rate's percentage as the column has always held it, a fraction: Moneybird
 * says `21.0`, the row says `0.21`. None (reverse charge) is 0.
 */
function fractionOf(percentage: string | null): string {
  if (percentage === null) return '0';
  const n = Number(percentage);
  if (!Number.isFinite(n)) throw new Error(`a tax rate of ${percentage}% cannot be read as a number`);
  return String(n / 100);
}

/**
 * Write back what Moneybird made of a draft: it leaves draft here, numbered,
 * and gives its lease back. Only a draft is written; a row issued since by
 * another road is left as it is.
 */
export async function recordIssued(
  db: PgDatabase,
  draft: DraftToPush,
  plan: Extract<PushPlan, { kind: 'push' }>,
  outcome: Extract<PushOutcome, { kind: 'issued' }>,
  settings: Pick<MoneybirdSettings, 'administrationId'>,
  now: Date,
): Promise<boolean> {
  const issued = outcome.invoice;
  if (!issued.invoiceNumber || !issued.invoiceDate) {
    throw new Error(`invoice ${draft.reference}: Moneybird answered issued without a number and a date`);
  }
  const lines = outcome.lines.map((line, i) => ({
    description: line.description,
    publishedCents: plan.invoice.lines[i]?.publishedCents ?? null,
    cents: line.cents,
  }));
  const incl = issued.totalInclTaxCents;
  const excl = issued.totalExclTaxCents;
  // In cents, as the money columns have always held it (the pay route asks
  // Mollie for `total` in cents), and the rate as a fraction.
  const totals =
    incl !== null && excl !== null
      ? {
          subtotal: String(excl),
          total: String(incl),
          taxAmount: String(incl - excl),
          taxRate: fractionOf(outcome.taxPercentage),
        }
      : {};
  const rows = await db
    .update(invoice)
    .set({
      status: 'sent',
      sentAt: now,
      vatTreatment: plan.treatment,
      taxRateId: outcome.taxRateId,
      lines,
      moneybirdAdministrationId: settings.administrationId,
      moneybirdId: issued.id,
      invoiceNumber: issued.invoiceNumber,
      invoiceDate: issued.invoiceDate,
      ...(issued.dueDate ? { dueDate: issued.dueDate } : {}),
      ...totals,
      pushLeaseUntil: null,
      updatedAt: now,
    })
    .where(and(eq(invoice.id, draft.id), eq(invoice.status, 'draft')))
    .returning({ id: invoice.id });
  return rows.length === 1;
}

/** The organisation's drafts still drafts two days after they were made, by reference: decision 6's alert. */
export async function draftsBehind(db: PgDatabase, tenantId: TenantId, now: Date): Promise<string[]> {
  const before = new Date(now.getTime() - DRAFT_BEHIND_AFTER_HOURS * 3_600_000);
  const rows = await db
    .select({ reference: invoice.reference })
    .from(invoice)
    .where(
      and(
        eq(invoice.tenantId, tenantId),
        eq(invoice.status, 'draft'),
        eq(invoice.kind, 'invoice'),
        lt(invoice.createdAt, before),
      ),
    )
    .orderBy(asc(invoice.createdAt));
  return rows.map((r) => r.reference ?? '(no reference)');
}
