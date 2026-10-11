// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A credit note, as Moneybird makes one (workplan 0111, T7 and slice 7a of
 * §"The build, sliced"; ADR-0044: an issued invoice is corrected by a credit
 * note, never edited).
 *
 * Moneybird's own credit invoice is a copy of the invoice it corrects, made by
 * `PATCH sales_invoices/{id}/duplicate_creditinvoice`, which links the two
 * (`original_sales_invoice_id`), so the document says which invoice it
 * corrects and the books can settle one against the other. The copy is a
 * draft, with the original's lines at minus their price; it is then filled
 * with what is credited and sent like any invoice, which numbers it.
 *
 * **The copy takes no reference.** `duplicate_creditinvoice` has an empty
 * body, so unlike an invoice (`ensureSalesInvoiceByReference`) a credit note
 * cannot be made under our reference in one call. What this module gives the
 * push instead (`moneybird-credit-push.ts`): a lookup by our reference or by
 * Moneybird's id (`readCreditInvoice`), and a list of the draft credit
 * invoices Moneybird holds for one original (`findDraftCreditInvoices`), so a
 * run that died between the copy and writing its id down finds the copy
 * again instead of making a second.
 *
 * These four calls were read from Moneybird's own OpenAPI description
 * (github.com/moneybird/openapi, `openapi.json`, read 2026-10-11): the copy
 * (body `{}`, 200 with the credit invoice), the update of a draft (only the
 * attributes sent change; `details_attributes` with an `id` and `_destroy`
 * removes a line), and the list's `filter` (`state`, `contact_id`, and
 * `period`, which matches on the invoice date and is always given, since a
 * filter replaces the defaults, among them this year).
 *
 * Injectable fetch, one use of Node's own in each public function, as in
 * `moneybird-sales-invoices.ts`.
 */

import { centsFromDecimal } from './line-price.ts';
import {
  moneybirdRead,
  moneybirdRequest,
  tokenRefusal,
  type MoneybirdAccess,
  type MoneybirdResponse,
  type SlowDown,
} from './moneybird-http.ts';
import { transactionIdentifiersOf, type MoneybirdSalesInvoice } from './moneybird-sales-invoices.ts';

/** A credit invoice as Moneybird holds it: an invoice, the one it corrects, and its lines' ids. */
export interface MoneybirdCreditInvoice extends MoneybirdSalesInvoice {
  /** Moneybird's id of the invoice this one corrects; null on an invoice that corrects nothing. */
  readonly originalSalesInvoiceId: string | null;
  /** Its lines' ids, so a fill can take them off before it adds its own. */
  readonly detailIds: readonly string[];
}

type Failed = SlowDown | { readonly kind: 'unavailable'; readonly reason: string };

/** A few hundred bytes of Moneybird's own words, for a refusal a person reads. */
function bodyText(body: unknown): string {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

/** What every call does with no answer, a 429, and a refused token. */
function failed(answer: MoneybirdResponse): Failed | null {
  if (answer.kind === 'unreachable') return { kind: 'unavailable', reason: answer.reason };
  if (answer.kind === 'slow_down') return answer;
  if (answer.status === 401 || answer.status === 403) {
    return { kind: 'unavailable', reason: tokenRefusal(answer.status) };
  }
  return null;
}

const dateOf = (value: unknown): string | null =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;

const idOf = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : typeof value === 'number' ? String(value) : null;

/** A credit invoice from Moneybird's JSON; null when it is not one this client can read. */
export function parseCreditInvoice(entry: unknown): MoneybirdCreditInvoice | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const raw = entry as Record<string, unknown>;
  if (typeof raw.id !== 'string') return null;
  const details = Array.isArray(raw.details) ? (raw.details as unknown[]) : [];
  const detailIds: string[] = [];
  for (const detail of details) {
    const id = idOf((detail as { id?: unknown } | null)?.id);
    if (id === null) return null;
    detailIds.push(id);
  }
  return {
    id: raw.id,
    invoiceNumber: typeof raw.invoice_id === 'string' && raw.invoice_id !== '' ? raw.invoice_id : null,
    reference: typeof raw.reference === 'string' ? raw.reference : null,
    state: typeof raw.state === 'string' ? raw.state : null,
    contactId: typeof raw.contact_id === 'string' ? raw.contact_id : null,
    invoiceDate: dateOf(raw.invoice_date),
    dueDate: dateOf(raw.due_date),
    pricesAreInclTax: typeof raw.prices_are_incl_tax === 'boolean' ? raw.prices_are_incl_tax : null,
    totalInclTaxCents: centsFromDecimal(raw.total_price_incl_tax),
    totalExclTaxCents: centsFromDecimal(raw.total_price_excl_tax),
    totalUnpaidCents: centsFromDecimal(raw.total_unpaid),
    transactionIdentifiers: transactionIdentifiersOf(raw.payments),
    originalSalesInvoiceId: idOf(raw.original_sales_invoice_id),
    detailIds,
  };
}

const unreadable = (what: string): Failed => ({
  kind: 'unavailable',
  reason: `Moneybird answered ${what} in a shape this client does not recognise.`,
});

// ------------------------------------------------------------------- reading

export type ReadCreditInvoiceOutcome =
  | { readonly kind: 'found'; readonly invoice: MoneybirdCreditInvoice }
  /** Only for a lookup by reference, and only on an explicit 404: nothing holds it. */
  | { readonly kind: 'missing' }
  | Failed;

/**
 * An invoice by Moneybird's id, or by our reference
 * (`GET sales_invoices/find_by_reference/{reference}`), with the invoice it
 * corrects and its lines' ids. By reference, an explicit 404 is `missing`; by
 * id, a 404 is `unavailable`, since the id came from Moneybird.
 */
export async function readCreditInvoice(
  access: MoneybirdAccess,
  by: { readonly id: string } | { readonly reference: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ReadCreditInvoiceOutcome> {
  const path =
    'id' in by
      ? `/sales_invoices/${encodeURIComponent(by.id)}.json`
      : `/sales_invoices/find_by_reference/${encodeURIComponent(by.reference)}.json`;
  const answer = await moneybirdRequest(access, 'GET', path, undefined, fetchImpl);
  const readFailed = failed(answer);
  if (readFailed) return readFailed;
  if (answer.kind === 'response' && answer.status === 404 && 'reference' in by) return { kind: 'missing' };
  if (answer.kind !== 'response' || answer.status !== 200) {
    const status = answer.kind === 'response' ? answer.status : 0;
    const which = 'id' in by ? `invoice ${by.id}` : `the reference ${by.reference}`;
    return { kind: 'unavailable', reason: `Moneybird answered HTTP ${status} to reading ${which}.` };
  }
  const invoice = parseCreditInvoice(answer.body);
  return invoice ? { kind: 'found', invoice } : unreadable('an invoice');
}

// -------------------------------------------------------------------- the copy

export type DuplicateCreditOutcome =
  | { readonly kind: 'drafted'; readonly invoice: MoneybirdCreditInvoice }
  | { readonly kind: 'refused'; readonly reason: string }
  | Failed;

/**
 * A draft credit invoice for the invoice `originalId` (Moneybird's id), its
 * lines the original's at minus their price. NOT IDEMPOTENT: each call makes
 * another draft. The push asks only after it has looked for one by our
 * reference and for a draft against the same original, and writes the id it
 * gets down before it does anything else with it.
 */
export async function duplicateCreditInvoice(
  access: MoneybirdAccess,
  originalId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DuplicateCreditOutcome> {
  const answer = await moneybirdRequest(
    access,
    'PATCH',
    `/sales_invoices/${encodeURIComponent(originalId)}/duplicate_creditinvoice.json`,
    {},
    fetchImpl,
  );
  const copyFailed = failed(answer);
  if (copyFailed) return copyFailed;
  if (answer.kind === 'response' && [400, 402, 404, 422].includes(answer.status)) {
    return {
      kind: 'refused',
      reason: `Moneybird refused a credit invoice for invoice ${originalId} (HTTP ${answer.status}): ${bodyText(answer.body)}`,
    };
  }
  if (answer.kind !== 'response' || (answer.status !== 200 && answer.status !== 201)) {
    const status = answer.kind === 'response' ? answer.status : 0;
    return { kind: 'unavailable', reason: `Moneybird answered HTTP ${status} to the credit invoice for ${originalId}.` };
  }
  const invoice = parseCreditInvoice(answer.body);
  if (!invoice) return unreadable('the credit invoice');
  if (invoice.originalSalesInvoiceId !== originalId) {
    return {
      kind: 'refused',
      reason:
        `Moneybird made credit invoice ${invoice.id} for invoice ${originalId}, and it names ` +
        `${invoice.originalSalesInvoiceId ?? 'no invoice'} as the one it corrects. Nothing is filled or sent.`,
    };
  }
  return { kind: 'drafted', invoice };
}

// ---------------------------------------------------- drafts against an original

export type FindCreditDraftsOutcome =
  | { readonly kind: 'found'; readonly drafts: readonly MoneybirdCreditInvoice[] }
  | Failed;

/** `YYYY-MM-DD` as Moneybird's period wants it: `YYYYMMDD`. */
const periodDay = (date: string): string => date.replaceAll('-', '');

/**
 * The draft credit invoices one contact holds against the invoice
 * `originalId`, dated `from` to `to` (`YYYY-MM-DD`, both included). A page of
 * a hundred: one original has one credit note, and a few drafts at the most.
 */
export async function findDraftCreditInvoices(
  access: MoneybirdAccess,
  query: { readonly contactId: string; readonly originalId: string; readonly from: string; readonly to: string },
  fetchImpl: typeof fetch = fetch,
): Promise<FindCreditDraftsOutcome> {
  const filter = `state:draft,contact_id:${query.contactId},period:${periodDay(query.from)}..${periodDay(query.to)}`;
  const read = await moneybirdRead(
    access,
    `sales_invoices.json?filter=${encodeURIComponent(filter)}&per_page=100&page=1`,
    fetchImpl,
  );
  if (read.kind !== 'ok') return read;
  if (!Array.isArray(read.body)) return unreadable('the list of invoices');
  const drafts: MoneybirdCreditInvoice[] = [];
  for (const entry of read.body as unknown[]) {
    const invoice = parseCreditInvoice(entry);
    if (!invoice) return unreadable('an invoice in the list');
    if (invoice.originalSalesInvoiceId === query.originalId && invoice.state === 'draft') drafts.push(invoice);
  }
  return { kind: 'found', drafts };
}

// -------------------------------------------------------------------- the fill

/** One line of a credit note: its words, its price (negative, Moneybird's decimal) and the original's rate. */
export interface MoneybirdCreditLine {
  readonly description: string;
  readonly price: string;
  readonly taxRateId: string;
}

export type FillCreditOutcome =
  | { readonly kind: 'filled'; readonly invoice: MoneybirdCreditInvoice }
  | { readonly kind: 'not_draft'; readonly invoice: MoneybirdCreditInvoice }
  | { readonly kind: 'refused'; readonly reason: string }
  | Failed;

/**
 * Give a draft credit invoice our reference and what is credited: the copy's
 * lines taken off, ours put on, in one update. Idempotent: run it again and
 * the lines it put on are taken off and put on again. Anything but a draft is
 * `not_draft`, with no request made: a sent credit note is a document.
 */
export async function fillCreditDraft(
  access: MoneybirdAccess,
  draft: MoneybirdCreditInvoice,
  fill: { readonly reference: string; readonly lines: readonly MoneybirdCreditLine[] },
  fetchImpl: typeof fetch = fetch,
): Promise<FillCreditOutcome> {
  if (draft.state !== 'draft') return { kind: 'not_draft', invoice: draft };
  const answer = await moneybirdRequest(
    access,
    'PATCH',
    `/sales_invoices/${encodeURIComponent(draft.id)}.json`,
    {
      sales_invoice: {
        reference: fill.reference,
        details_attributes: [
          ...draft.detailIds.map((id) => ({ id, _destroy: true })),
          ...fill.lines.map((line) => ({
            description: line.description,
            price: line.price,
            amount: 1,
            tax_rate_id: line.taxRateId,
          })),
        ],
      },
    },
    fetchImpl,
  );
  const fillFailed = failed(answer);
  if (fillFailed) return fillFailed;
  if (answer.kind === 'response' && answer.status === 422) {
    return { kind: 'refused', reason: `Moneybird refused the credit invoice's lines: ${bodyText(answer.body)}` };
  }
  if (answer.kind !== 'response' || answer.status !== 200) {
    const status = answer.kind === 'response' ? answer.status : 0;
    return { kind: 'unavailable', reason: `Moneybird answered HTTP ${status} to filling credit invoice ${draft.id}.` };
  }
  const invoice = parseCreditInvoice(answer.body);
  return invoice ? { kind: 'filled', invoice } : unreadable('the filled credit invoice');
}
