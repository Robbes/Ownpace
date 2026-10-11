// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * One credit note, pushed to the books (workplan 0111, T7 and slice 7a of
 * §"The build, sliced"): found or made, filled, checked, sent and read back,
 * in one function, the way `pushInvoice` pushes an invoice.
 *
 * **Our row first, then Moneybird's draft, so a retry adopts the draft
 * instead of making a second.** Moneybird makes a credit invoice as a copy of
 * the invoice it corrects (`duplicate_creditinvoice`), and the copy takes no
 * reference, so the push looks before it asks for one, in this order:
 *
 *  1. the draft our row names, once its id is written down (`onDraft`);
 *  2. a credit invoice under our reference (`ownpace-{organisation}-c-…`),
 *     which a fill gave it: a run that died after the fill;
 *  3. a draft credit invoice of the buyer's against the same original, still
 *     under the original's reference or none: a run that died after the copy
 *     and before writing its id down. One is adopted; two are refused by
 *     name, for a person to delete one, since nothing here can tell which;
 *  4. only then, the copy, whose id `onDraft` writes down before anything
 *     else is done with it.
 *
 * Each step is idempotent, or guarded by the ones before it, so the whole is:
 * run it again and it finds the credit note, sees it is no longer a draft,
 * sends nothing, and reads it back.
 *
 * **What is credited is priced from the invoice as it was issued.** The
 * original's lines carry their price in the setting the invoice was made in
 * (prices including VAT, or without the Dutch VAT for a reverse charge;
 * `line-price.ts`), and the copy keeps that setting. So the credit is a share
 * of what the original's lines add up to, at the original's rate, rounded to
 * the cent once, on one line; the push never re-derives a price. The draft is
 * checked after the fill, as an invoice's is before its send: its total must
 * be the line's price, or it is left a draft and refused by name.
 *
 * **A reverse charge says so again.** The original's line ended with its VIES
 * evidence (decision 10); the credit note's line ends with the same words.
 *
 * Outcomes as `pushInvoice`'s: `issued` (numbered; `adopted` when it existed
 * sent already), `refused`, `unavailable` and `slow_down`.
 */

import { decimalFromCents } from './line-price.ts';
import type { MoneybirdSettings } from './moneybird-config.ts';
import {
  duplicateCreditInvoice,
  fillCreditDraft,
  findDraftCreditInvoices,
  readCreditInvoice,
  type MoneybirdCreditInvoice,
} from './moneybird-credit-invoices.ts';
import type { SlowDown } from './moneybird-http.ts';
import { sendSalesInvoice } from './moneybird-sales-invoices.ts';

/** Where the original's line says its reverse charge (invoice-push.ts, decision 10). */
export const REVERSE_CHARGE_WORDS = 'Btw verlegd / VAT reverse charged.';

/** The invoice a credit note corrects, as the mirror holds it once issued. */
export interface CreditedInvoice {
  readonly reference: string;
  readonly moneybirdId: string;
  readonly invoiceNumber: string;
  /** `YYYY-MM-DD`, Moneybird's. */
  readonly invoiceDate: string;
  readonly taxRateId: string;
  /** Each line as it went on the invoice: its words, and its price in the setting it was made in, in cents. */
  readonly lines: readonly { readonly description: string; readonly cents: number }[];
}

/** A credit note to push. */
export interface CreditNoteToPush {
  /** Ours, fixed once used: `ownpace-{organisation}-c-{YYYY-MM}-{tier}`. */
  readonly reference: string;
  /** Moneybird's id of its draft, once one was made and written down; null before. */
  readonly moneybirdId: string | null;
  /** What it says, `{invoice}` standing for the original's number. */
  readonly description: string;
  /** The share of the original credited: `numerator` of `denominator` (days not used of the days paid for). */
  readonly numerator: number;
  readonly denominator: number;
  readonly credited: CreditedInvoice;
  /** Today, `YYYY-MM-DD`: the last day a lost draft can be dated. */
  readonly today: string;
}

export type CreditPushOutcome =
  | {
      readonly kind: 'issued';
      readonly invoice: MoneybirdCreditInvoice;
      /** True when it was sent already: a retry, or a run that died after the send. */
      readonly adopted: boolean;
      /** Its one line as it went on the credit note: the words, and the price (negative), in cents. */
      readonly line: { readonly description: string; readonly cents: number };
    }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | SlowDown;

/** The credit, in cents, negative: the share of the original's lines, rounded once, half away from zero. */
export function creditCents(credited: CreditedInvoice, numerator: number, denominator: number): number {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator <= 0) {
    throw new RangeError(`a share of ${numerator} of ${denominator} is not one`);
  }
  if (numerator < 0 || numerator > denominator) throw new RangeError(`a share of ${numerator} of ${denominator} is more than the whole`);
  const total = credited.lines.reduce((sum, line) => sum + line.cents, 0);
  return -Math.round((total * numerator) / denominator);
}

/** The credit note's words: ours, with the original's number, and its reverse charge said again. */
export function creditWords(note: Pick<CreditNoteToPush, 'description' | 'credited'>): string {
  const words = note.description.replaceAll('{invoice}', note.credited.invoiceNumber);
  const evidence = note.credited.lines.find((line) => line.description.includes(REVERSE_CHARGE_WORDS))?.description;
  if (evidence === undefined) return words;
  return `${words}. ${evidence.slice(evidence.indexOf(REVERSE_CHARGE_WORDS))}`;
}

/** A credit invoice that corrects another invoice than ours is not ours to fill or send. */
function correctsAnother(invoice: MoneybirdCreditInvoice, credited: CreditedInvoice): string | null {
  if (invoice.originalSalesInvoiceId === credited.moneybirdId) return null;
  return (
    `Moneybird's credit invoice ${invoice.id} corrects ${invoice.originalSalesInvoiceId ?? 'no invoice'}, ` +
    `and ${credited.reference} credits invoice ${credited.invoiceNumber} (Moneybird ${credited.moneybirdId}). ` +
    'Nothing is filled or sent.'
  );
}

/** The day after `date`, `YYYY-MM-DD`: Moneybird's day may already be tomorrow's. */
function dayAfter(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/** The draft to fill: the one written down, ours by reference, a lost one, or a new copy. */
async function draftFor(
  settings: MoneybirdSettings,
  note: CreditNoteToPush,
  onDraft: (moneybirdId: string) => Promise<void>,
  fetchImpl: typeof fetch | undefined,
): Promise<
  | { readonly kind: 'draft'; readonly invoice: MoneybirdCreditInvoice; readonly found: boolean }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | SlowDown
> {
  // 1. The draft our row names.
  if (note.moneybirdId !== null) {
    const read = await readCreditInvoice(settings, { id: note.moneybirdId }, fetchImpl);
    if (read.kind !== 'found') {
      return read.kind === 'missing' ? { kind: 'unavailable', reason: `credit invoice ${note.moneybirdId} is gone` } : read;
    }
    return { kind: 'draft', invoice: read.invoice, found: true };
  }

  // 2. Ours, by reference: a fill gave it ours, and the id was not written down.
  const ours = await readCreditInvoice(settings, { reference: note.reference }, fetchImpl);
  if (ours.kind === 'found') {
    await onDraft(ours.invoice.id);
    return { kind: 'draft', invoice: ours.invoice, found: true };
  }
  if (ours.kind !== 'missing') return ours;

  // 3. A copy made before, whose id was never written down.
  const original = await readCreditInvoice(settings, { id: note.credited.moneybirdId }, fetchImpl);
  if (original.kind !== 'found') {
    return original.kind === 'missing' ? { kind: 'unavailable', reason: 'the original is gone' } : original;
  }
  if (original.invoice.contactId === null) {
    return { kind: 'unavailable', reason: `Moneybird gave no contact for invoice ${note.credited.invoiceNumber}.` };
  }
  const lost = await findDraftCreditInvoices(
    settings,
    {
      contactId: original.invoice.contactId,
      originalId: note.credited.moneybirdId,
      from: note.credited.invoiceDate,
      to: dayAfter(note.today),
    },
    fetchImpl,
  );
  if (lost.kind !== 'found') return lost;
  const ownerless = lost.drafts.filter((d) => d.reference === null || d.reference === '' || d.reference === note.credited.reference);
  if (ownerless.length > 1 || lost.drafts.length > ownerless.length) {
    return {
      kind: 'refused',
      reason:
        `Moneybird holds ${lost.drafts.length} draft credit invoices against invoice ${note.credited.invoiceNumber} ` +
        `(${lost.drafts.map((d) => d.id).join(', ')}) and none under ${note.reference}; a person keeps one at the most, ` +
        'deleting the rest in Moneybird, and the next run fills it.',
    };
  }
  if (ownerless.length === 1) {
    await onDraft(ownerless[0]!.id);
    return { kind: 'draft', invoice: ownerless[0]!, found: true };
  }

  // 4. A new copy, written down before anything else is done with it.
  const copy = await duplicateCreditInvoice(settings, note.credited.moneybirdId, fetchImpl);
  if (copy.kind !== 'drafted') return copy;
  await onDraft(copy.invoice.id);
  return { kind: 'draft', invoice: copy.invoice, found: false };
}

/**
 * Pushes one credit note. `onDraft` writes Moneybird's id of its draft onto
 * our row; it is called before the draft is filled, and a throw from it stops
 * the push there.
 */
export async function pushCreditNote(
  settings: MoneybirdSettings,
  note: CreditNoteToPush,
  onDraft: (moneybirdId: string) => Promise<void>,
  fetchImpl?: typeof fetch,
): Promise<CreditPushOutcome> {
  if (note.credited.lines.length === 0) {
    return { kind: 'refused', reason: `${note.credited.reference} has no lines as issued, so nothing can be credited.` };
  }
  const cents = creditCents(note.credited, note.numerator, note.denominator);
  if (cents === 0) return { kind: 'refused', reason: `${note.reference} credits nothing: a credit note of 0.00 is not made.` };
  const line = { description: creditWords(note), cents };

  const found = await draftFor(settings, note, onDraft, fetchImpl);
  if (found.kind !== 'draft') return found;
  const wrong = correctsAnother(found.invoice, note.credited);
  if (wrong) return { kind: 'refused', reason: wrong };
  let invoice = found.invoice;
  const adopted = invoice.state !== 'draft';

  if (!adopted) {
    // 5. Filled with ours, checked, then sent.
    const filled = await fillCreditDraft(
      settings,
      invoice,
      {
        reference: note.reference,
        lines: [{ description: line.description, price: decimalFromCents(line.cents), taxRateId: note.credited.taxRateId }],
      },
      fetchImpl,
    );
    if (filled.kind === 'refused' || filled.kind === 'unavailable' || filled.kind === 'slow_down') return filled;
    invoice = filled.invoice;
    if (invoice.state === 'draft') {
      const total = invoice.pricesAreInclTax === false ? invoice.totalExclTaxCents : invoice.totalInclTaxCents;
      if (total !== line.cents) {
        return {
          kind: 'refused',
          reason:
            `The draft credit invoice for ${note.reference} (Moneybird ${invoice.id}) was not sent: its total is ` +
            `${total === null ? 'not one this client can read as cents' : decimalFromCents(total)}, and it credits ` +
            `${decimalFromCents(line.cents)}. Check it in Moneybird, then delete the draft.`,
        };
      }
      const sent = await sendSalesInvoice(settings, invoice, settings.delivery === 'email' ? 'Email' : 'Manual', fetchImpl);
      if (sent.kind === 'refused' || sent.kind === 'unavailable' || sent.kind === 'slow_down') return sent;
    }
  }

  // 6. Read back: the number and the date are Moneybird's.
  const read = await readCreditInvoice(settings, { id: invoice.id }, fetchImpl);
  if (read.kind !== 'found') {
    return read.kind === 'missing' ? { kind: 'unavailable', reason: `credit invoice ${invoice.id} is gone` } : read;
  }
  if (read.invoice.invoiceNumber === null || read.invoice.state === 'draft') {
    return {
      kind: 'unavailable',
      reason:
        `Credit note ${note.reference} (Moneybird ${read.invoice.id}) is not numbered yet ` +
        `(state ${read.invoice.state ?? 'not given'}); the next run reads it again and sends nothing twice.`,
    };
  }
  return { kind: 'issued', invoice: read.invoice, adopted, line };
}
