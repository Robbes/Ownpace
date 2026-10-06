// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The Moneybird adapter: a reference, never a number (workplan 0111 T4; the
 * first seam on 2026-08-29, completed as slice 2 of §"The build, sliced").
 *
 * ADR-0044 in function signatures: Moneybird assigns the invoice number,
 * renders the document and files it; Ownpace is upstream of the record. What
 * this module owns is the one property hard rule 1 demands at this seam —
 * **a retried push cannot double-invoice** — and it gets it from Moneybird's
 * own API design: `reference` is ours to set, `find_by_reference` looks it
 * up, so creation is LOOK-THEN-CREATE and an invoice that already exists is
 * returned as it stands.
 *
 * ## Returned as it stands — never updated
 *
 * `ensureSalesInvoiceByReference` deliberately has no update path. An issued
 * invoice is immutable (ADR-0044); if the caller's idea of the lines differs
 * from what exists under the reference, that is a DISCREPANCY to surface,
 * not a PATCH to apply — the correction instrument is a credit note (T7).
 * One existing invoice is refused outright: one under our reference but for
 * another contact. A reference is ours and names one buyer's month; an
 * invoice for somebody else under it is not ours to adopt.
 *
 * ## The double-invoice hole this refuses to have
 *
 * The lookup failing is not the same as the invoice not existing. A naive
 * seam treats a 500 on `find_by_reference` as "not found" and falls through
 * to create — which is exactly how a flaky afternoon mints two invoices for
 * one period. Here only an explicit 404 opens the create path; every other
 * lookup failure is `unavailable`, try later, nothing created.
 *
 * ## The workflow and its VAT, stated on every invoice
 *
 * A Moneybird workflow says whether line prices include VAT, and an invoice
 * created without saying takes the workflow's setting. On the sandbox the
 * owner set prices including VAT (2026-10-05); a line priced for the other
 * setting gains or loses 21% without any error. So `workflowId` and
 * `pricesAreInclTax` are required on every create, never defaulted, and the
 * caller (`moneybird-push.ts`) checks the draft's total before it is sent.
 *
 * ## Sending: only a draft, never by default
 *
 * `sendSalesInvoice` takes the invoice as read and sends it only while it is a
 * `draft`, so a retry after a send whose answer was lost finds an `open`
 * invoice and sends nothing, and mails nobody twice. The delivery method has
 * no default: `Manual` numbers the invoice and e-mails nothing; `Email` is for
 * live, where the buyer gave an invoice address.
 *
 * ## Contacts, by our key, kept in step
 *
 * A sales invoice needs a Moneybird `contact_id`. `ensureContact` finds the
 * contact by OUR stable key — Moneybird's `customer_id` field, which is the
 * caller's to fill with something tenant-derived — and creates it when
 * absent. Moneybird's contact search is fuzzy, so the match is re-checked
 * exactly, client-side, against `customer_id`; and because Moneybird does
 * not enforce uniqueness on that field, a lost race can in principle leave
 * two contacts with one key. That costs nothing an invoice cares about
 * (both are the same buyer) and is preferred over pretending the API gives
 * an atomicity it does not. A contact that exists but says something else
 * (an address moved, a VAT number added) is brought in step before the
 * invoice is made: the mirror keeps no buyer address, Moneybird's contact
 * does, and a reverse-charge invoice without the buyer's VAT number is not
 * one.
 *
 * ## What is deliberately NOT here
 *
 * No tax arithmetic (a line carries a `tax_rate_id` from
 * `moneybird-tax-rates.ts` and a price from `line-price.ts`), no PDF download
 * or credit notes (T6/T7), no environment reads (configuration is parameters,
 * `moneybird-config.ts` reads it), and no retry loop — idempotency is what
 * makes the CALLER's retry safe, which is better than owning one. A 429 is
 * its own outcome, `slow_down`, so the caller paces itself.
 *
 * Injectable fetch throughout, same as `vies.ts` and
 * `moneybird-tax-rates.ts`: a test of this module must not be a test of
 * Moneybird.
 */

import { centsFromDecimal } from './line-price.ts';
import {
  moneybirdRequest,
  tokenRefusal,
  type MoneybirdAccess,
  type MoneybirdResponse,
  type SlowDown,
} from './moneybird-http.ts';

/** A few hundred bytes of Moneybird's own words, for a refusal a person reads. */
function bodyText(body: unknown): string {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

/** What every outcome does with no answer, a 429, and a refused token. */
function failed(
  answer: MoneybirdResponse,
): SlowDown | { readonly kind: 'unavailable'; readonly reason: string } | null {
  if (answer.kind === 'unreachable') return { kind: 'unavailable', reason: answer.reason };
  if (answer.kind === 'slow_down') return answer;
  if (answer.status === 401 || answer.status === 403) {
    return { kind: 'unavailable', reason: tokenRefusal(answer.status) };
  }
  return null;
}

// ------------------------------------------------------------------ contacts

/** The buyer, as the caller wants Moneybird to hold them (from billing_party). */
export interface MoneybirdContactInput {
  /** OUR stable key, stored in Moneybird's `customer_id` — tenant-derived. */
  readonly customerId: string;
  /** Exactly one of the two shapes: a company, or a person. */
  readonly companyName?: string | null;
  readonly firstname?: string | null;
  readonly lastname?: string | null;
  readonly address1: string;
  readonly address2?: string | null;
  readonly zipcode: string;
  readonly city: string;
  /** ISO 3166-1 alpha-2, as billing_party stores it. */
  readonly country: string;
  /** As stated (and, for reverse charge, VIES-validated by T2). */
  readonly taxNumber?: string | null;
  /** Where Moneybird sends the document, with delivery `Email` (decision 11). */
  readonly email?: string | null;
}

export interface MoneybirdContact {
  readonly id: string;
  readonly customerId: string | null;
}

export type EnsureContactOutcome =
  | { readonly kind: 'exists'; readonly contact: MoneybirdContact }
  | { readonly kind: 'updated'; readonly contact: MoneybirdContact }
  | { readonly kind: 'created'; readonly contact: MoneybirdContact }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | SlowDown;

function parseContact(entry: unknown): MoneybirdContact | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const raw = entry as Record<string, unknown>;
  if (typeof raw.id !== 'string') return null;
  return {
    id: raw.id,
    customerId: typeof raw.customer_id === 'string' && raw.customer_id !== '' ? raw.customer_id : null,
  };
}

/** The fields this module sets on a contact, in Moneybird's names; empty is absent. */
function contactFields(input: MoneybirdContactInput): Record<string, string> {
  const fields: Record<string, string | null | undefined> = {
    company_name: input.companyName,
    firstname: input.firstname,
    lastname: input.lastname,
    address1: input.address1,
    address2: input.address2,
    zipcode: input.zipcode,
    city: input.city,
    country: input.country,
    tax_number: input.taxNumber,
    send_invoices_to_email: input.email,
  };
  return Object.fromEntries(
    Object.entries(fields).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== ''),
  );
}

/**
 * The fields to change on an existing contact so it says what the buyer
 * said: each field we set that differs, and each we no longer set that it
 * still holds (sent as empty). Empty when it already agrees.
 */
function contactChanges(existing: Record<string, unknown>, wanted: Record<string, string>): Record<string, string> {
  const changes: Record<string, string> = {};
  for (const key of [
    'company_name',
    'firstname',
    'lastname',
    'address1',
    'address2',
    'zipcode',
    'city',
    'country',
    'tax_number',
    'send_invoices_to_email',
  ]) {
    const has = typeof existing[key] === 'string' ? (existing[key] as string) : '';
    const want = wanted[key] ?? '';
    if (has !== want) changes[key] = want;
  }
  return changes;
}

/**
 * Find the contact carrying our key, bring it in step, or create it.
 * Look-then-create, with the same rule as invoices: only a clean "no match"
 * opens the create path.
 */
export async function ensureContact(
  access: MoneybirdAccess,
  input: MoneybirdContactInput,
  fetchImpl: typeof fetch = fetch,
): Promise<EnsureContactOutcome> {
  const search = await moneybirdRequest(
    access,
    'GET',
    `/contacts.json?query=${encodeURIComponent(input.customerId)}`,
    undefined,
    fetchImpl,
  );
  const searchFailed = failed(search);
  if (searchFailed) return searchFailed;
  if (search.kind !== 'response' || search.status !== 200 || !Array.isArray(search.body)) {
    const status = search.kind === 'response' ? search.status : 0;
    return { kind: 'unavailable', reason: `Moneybird answered HTTP ${status} to the contact search.` };
  }
  const wanted = contactFields(input);
  // The search is fuzzy; the MATCH is exact. A contact whose customer_id
  // merely contains our key is somebody else.
  for (const entry of search.body) {
    const contact = parseContact(entry);
    if (!contact || contact.customerId !== input.customerId) continue;
    const changes = contactChanges(entry as Record<string, unknown>, wanted);
    if (Object.keys(changes).length === 0) return { kind: 'exists', contact };
    const patched = await moneybirdRequest(
      access,
      'PATCH',
      `/contacts/${encodeURIComponent(contact.id)}.json`,
      { contact: changes },
      fetchImpl,
    );
    const patchFailed = failed(patched);
    if (patchFailed) return patchFailed;
    if (patched.kind === 'response' && patched.status === 422) {
      return { kind: 'refused', reason: `Moneybird refused the contact's new details: ${bodyText(patched.body)}` };
    }
    if (patched.kind !== 'response' || patched.status !== 200) {
      const status = patched.kind === 'response' ? patched.status : 0;
      return { kind: 'unavailable', reason: `Moneybird answered HTTP ${status} to the contact update.` };
    }
    return { kind: 'updated', contact };
  }

  const created = await moneybirdRequest(
    access,
    'POST',
    '/contacts.json',
    { contact: { customer_id: input.customerId, ...wanted } },
    fetchImpl,
  );
  const createFailed = failed(created);
  if (createFailed) return createFailed;
  if (created.kind === 'response' && created.status === 422) {
    return { kind: 'refused', reason: `Moneybird refused the contact as invalid: ${bodyText(created.body)}` };
  }
  const contact =
    created.kind === 'response' && (created.status === 201 || created.status === 200)
      ? parseContact(created.body)
      : null;
  if (!contact) {
    const status = created.kind === 'response' ? created.status : 0;
    return { kind: 'unavailable', reason: `Moneybird answered HTTP ${status} to the contact create.` };
  }
  return { kind: 'created', contact };
}

// ------------------------------------------------------------ sales invoices

export interface MoneybirdInvoiceLine {
  readonly description: string;
  /** Euro amount as Moneybird writes it, from `decimalFromCents` — e.g. "9.92". */
  readonly price: string;
  /** From `moneybird-tax-rates.ts` — the ONLY tax field a line may carry. */
  readonly taxRateId: string;
}

export interface MoneybirdSalesInvoice {
  readonly id: string;
  /**
   * The legal number, MONEYBIRD'S — null while the invoice is a draft,
   * assigned when it is sent. Mirrored, never minted (ADR-0044).
   */
  readonly invoiceNumber: string | null;
  readonly reference: string | null;
  /** `draft`, `open`, `late`, `paid`, … as Moneybird names them. */
  readonly state: string | null;
  readonly contactId: string | null;
  /** The legal date, Moneybird's, set when it is sent: `YYYY-MM-DD`. */
  readonly invoiceDate: string | null;
  readonly dueDate: string | null;
  /** Whether its line prices include VAT; null when Moneybird did not say. */
  readonly pricesAreInclTax: boolean | null;
  /** Whole cents, or null when Moneybird's figure is not one this client can read exactly. */
  readonly totalInclTaxCents: number | null;
  readonly totalExclTaxCents: number | null;
  readonly totalUnpaidCents: number | null;
}

export type EnsureInvoiceOutcome =
  | { readonly kind: 'exists'; readonly invoice: MoneybirdSalesInvoice }
  | { readonly kind: 'created'; readonly invoice: MoneybirdSalesInvoice }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | SlowDown;

const dateOf = (value: unknown): string | null =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;

function parseInvoice(entry: unknown): MoneybirdSalesInvoice | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const raw = entry as Record<string, unknown>;
  if (typeof raw.id !== 'string') return null;
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
  };
}

/**
 * The idempotent create (hard rule 1 at the seam): look up by `reference`;
 * an explicit 404 — and nothing else — opens the create path.
 */
export async function ensureSalesInvoiceByReference(
  access: MoneybirdAccess,
  input: {
    readonly contactId: string;
    /** Ours, fixed once used: `ownpace-{organisation}-m-{YYYY-MM}-{tier}`. The idempotency key. */
    readonly reference: string;
    /** The invoice workflow (`MONEYBIRD_WORKFLOW_ID`), never Moneybird's default. */
    readonly workflowId: string;
    /** Whether the line prices include VAT, stated, never taken from the workflow. */
    readonly pricesAreInclTax: boolean;
    readonly lines: readonly MoneybirdInvoiceLine[];
  },
  fetchImpl: typeof fetch = fetch,
): Promise<EnsureInvoiceOutcome> {
  const found = await moneybirdRequest(
    access,
    'GET',
    `/sales_invoices/find_by_reference/${encodeURIComponent(input.reference)}.json`,
    undefined,
    fetchImpl,
  );
  const lookupFailed = failed(found);
  if (lookupFailed) return lookupFailed;
  if (found.kind === 'response' && found.status === 200) {
    const invoice = parseInvoice(found.body);
    if (!invoice) {
      return { kind: 'unavailable', reason: 'Moneybird answered a shape this client does not recognise.' };
    }
    if (invoice.contactId !== input.contactId) {
      return {
        kind: 'refused',
        reason:
          `Moneybird already holds invoice ${invoice.id} under reference ${input.reference}, for another ` +
          'contact. A reference names one buyer; nothing is adopted, created or sent under it.',
      };
    }
    // As it stands — never patched. A difference from what the caller meant
    // is a discrepancy to surface; the correction instrument is a credit
    // note (T7), not an UPDATE.
    return { kind: 'exists', invoice };
  }
  if (found.kind !== 'response' || found.status !== 404) {
    // THE rule: an uncertain lookup never falls through to create. That
    // fall-through is how a flaky afternoon double-invoices a customer.
    const status = found.kind === 'response' ? found.status : 0;
    return {
      kind: 'unavailable',
      reason: `Moneybird answered HTTP ${status} to the reference lookup — not creating anything while the answer is uncertain.`,
    };
  }

  const created = await moneybirdRequest(
    access,
    'POST',
    '/sales_invoices.json',
    {
      sales_invoice: {
        contact_id: input.contactId,
        reference: input.reference,
        workflow_id: input.workflowId,
        prices_are_incl_tax: input.pricesAreInclTax,
        details_attributes: input.lines.map((line) => ({
          description: line.description,
          price: line.price,
          tax_rate_id: line.taxRateId,
        })),
      },
    },
    fetchImpl,
  );
  const createFailed = failed(created);
  if (createFailed) return createFailed;
  if (created.kind === 'response' && created.status === 422) {
    return { kind: 'refused', reason: `Moneybird refused the invoice as invalid: ${bodyText(created.body)}` };
  }
  const invoice =
    created.kind === 'response' && (created.status === 201 || created.status === 200)
      ? parseInvoice(created.body)
      : null;
  if (!invoice) {
    const status = created.kind === 'response' ? created.status : 0;
    return { kind: 'unavailable', reason: `Moneybird answered HTTP ${status} to the invoice create.` };
  }
  return { kind: 'created', invoice };
}

// ------------------------------------------------------------------- reading

export type ReadInvoiceOutcome =
  | { readonly kind: 'ok'; readonly invoice: MoneybirdSalesInvoice }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | SlowDown;

/** The invoice as Moneybird holds it now: its number, date, state and totals. */
export async function readSalesInvoice(
  access: MoneybirdAccess,
  invoiceId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ReadInvoiceOutcome> {
  const answer = await moneybirdRequest(
    access,
    'GET',
    `/sales_invoices/${encodeURIComponent(invoiceId)}.json`,
    undefined,
    fetchImpl,
  );
  const readFailed = failed(answer);
  if (readFailed) return readFailed;
  const invoice = answer.kind === 'response' && answer.status === 200 ? parseInvoice(answer.body) : null;
  if (!invoice) {
    const status = answer.kind === 'response' ? answer.status : 0;
    return { kind: 'unavailable', reason: `Moneybird answered HTTP ${status} to reading invoice ${invoiceId}.` };
  }
  return { kind: 'ok', invoice };
}

// ------------------------------------------------------------------- sending

export type SendInvoiceOutcome =
  | { readonly kind: 'sent'; readonly invoice: MoneybirdSalesInvoice | null }
  | { readonly kind: 'not_draft'; readonly invoice: MoneybirdSalesInvoice }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | SlowDown;

/**
 * Send a draft (or mark it manually delivered): THIS is the moment Moneybird
 * assigns the legal number, which is exactly why sending belongs to the
 * system that owns numbering. Anything but a draft is `not_draft`, with no
 * request made: it was sent before, and sending again would mail again.
 */
export async function sendSalesInvoice(
  access: MoneybirdAccess,
  invoice: MoneybirdSalesInvoice,
  deliveryMethod: 'Email' | 'Manual',
  fetchImpl: typeof fetch = fetch,
): Promise<SendInvoiceOutcome> {
  if (invoice.state !== 'draft') return { kind: 'not_draft', invoice };
  const sent = await moneybirdRequest(
    access,
    'PATCH',
    `/sales_invoices/${encodeURIComponent(invoice.id)}/send_invoice.json`,
    { sales_invoice_sending: { delivery_method: deliveryMethod } },
    fetchImpl,
  );
  const sendFailed = failed(sent);
  if (sendFailed) return sendFailed;
  if (sent.kind === 'response' && sent.status === 422) {
    return { kind: 'refused', reason: `Moneybird refused to send: ${bodyText(sent.body)}` };
  }
  if (sent.kind === 'response' && (sent.status === 200 || sent.status === 204)) {
    return { kind: 'sent', invoice: parseInvoice(sent.body) };
  }
  const status = sent.kind === 'response' ? sent.status : 0;
  return { kind: 'unavailable', reason: `Moneybird answered HTTP ${status} to the send.` };
}
