// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The Moneybird adapter's core: a reference, never a number (workplan 0111
 * T4, first seam).
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
 * The `exists` outcome hands back Moneybird's row so the caller can compare
 * and say so.
 *
 * ## The double-invoice hole this refuses to have
 *
 * The lookup failing is not the same as the invoice not existing. A naive
 * seam treats a 500 on `find_by_reference` as "not found" and falls through
 * to create — which is exactly how a flaky afternoon mints two invoices for
 * one period. Here only an explicit 404 opens the create path; every other
 * lookup failure is `unavailable`, try later, nothing created.
 *
 * ## Contacts, by our key
 *
 * A sales invoice needs a Moneybird `contact_id`. `ensureContact` finds the
 * contact by OUR stable key — Moneybird's `customer_id` field, which is the
 * caller's to fill with something tenant-derived — and creates it when
 * absent. Moneybird's contact search is fuzzy, so the match is re-checked
 * exactly, client-side, against `customer_id`; and because Moneybird does
 * not enforce uniqueness on that field, a lost race can in principle leave
 * two contacts with one key. That costs nothing an invoice cares about
 * (both are the same buyer) and is preferred over pretending the API gives
 * an atomicity it does not.
 *
 * ## What is deliberately NOT here
 *
 * No tax arithmetic (a line carries a `tax_rate_id` from
 * `moneybird-tax-rates.ts` and nothing else), no PDF download or credit
 * notes (T6/T7), no environment reads (config is parameters; wiring is the
 * caller's, and lands when the trial administration exists), and no retry
 * loop — idempotency is what makes the CALLER's retry safe, which is better
 * than owning one.
 *
 * Injectable fetch throughout, same as `vies.ts` and
 * `moneybird-tax-rates.ts`: a test of this module must not be a test of
 * Moneybird — and the live shapes still need proving against the trial
 * administration before anything real flows (the German-19% gating test).
 */

export interface MoneybirdConfig {
  readonly administrationId: string;
  /** Rides the vault/env, never git, never the appliance image (ADR-0044). */
  readonly apiToken: string;
}

const BASE = 'https://moneybird.com/api/v2';

/** One shared request shape: Bearer token, JSON, a 10s cap, no retries. */
async function moneybirdRequest(
  config: MoneybirdConfig,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<
  | { readonly kind: 'response'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'unreachable'; readonly reason: string }
> {
  let response: Response;
  try {
    response = await fetchImpl(`${BASE}/${encodeURIComponent(config.administrationId)}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    return {
      kind: 'unreachable',
      reason: `Moneybird could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    // Some answers (204s, HTML error pages) carry no JSON; the status decides.
  }
  return { kind: 'response', status: response.status, body: parsed };
}

function refusedToken(status: number): string {
  return `Moneybird refused the token (HTTP ${status}) — check MONEYBIRD_API_TOKEN and the administration id.`;
}

/** A few hundred bytes of Moneybird's own words, for a refusal a person reads. */
function bodyText(body: unknown): string {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
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
  /** Where Moneybird sends the document (T6's delivery path). */
  readonly email?: string | null;
}

export interface MoneybirdContact {
  readonly id: string;
  readonly customerId: string | null;
}

export type EnsureContactOutcome =
  | { readonly kind: 'exists'; readonly contact: MoneybirdContact }
  | { readonly kind: 'created'; readonly contact: MoneybirdContact }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string };

function parseContact(entry: unknown): MoneybirdContact | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const raw = entry as Record<string, unknown>;
  if (typeof raw.id !== 'string') return null;
  return {
    id: raw.id,
    customerId: typeof raw.customer_id === 'string' && raw.customer_id !== '' ? raw.customer_id : null,
  };
}

/**
 * Find the contact carrying our key, or create it. Look-then-create, with
 * the same rule as invoices: only a clean "no match" opens the create path.
 */
export async function ensureContact(
  config: MoneybirdConfig,
  input: MoneybirdContactInput,
  fetchImpl: typeof fetch = fetch,
): Promise<EnsureContactOutcome> {
  const search = await moneybirdRequest(
    config,
    'GET',
    `/contacts.json?query=${encodeURIComponent(input.customerId)}`,
    undefined,
    fetchImpl,
  );
  if (search.kind === 'unreachable') return { kind: 'unavailable', reason: search.reason };
  if (search.status === 401 || search.status === 403) {
    return { kind: 'unavailable', reason: refusedToken(search.status) };
  }
  if (search.status !== 200 || !Array.isArray(search.body)) {
    return { kind: 'unavailable', reason: `Moneybird answered HTTP ${search.status} to the contact search.` };
  }
  // The search is fuzzy; the MATCH is exact. A contact whose customer_id
  // merely contains our key is somebody else.
  for (const entry of search.body) {
    const contact = parseContact(entry);
    if (contact && contact.customerId === input.customerId) {
      return { kind: 'exists', contact };
    }
  }

  const created = await moneybirdRequest(
    config,
    'POST',
    '/contacts.json',
    {
      contact: {
        customer_id: input.customerId,
        ...(input.companyName ? { company_name: input.companyName } : {}),
        ...(input.firstname ? { firstname: input.firstname } : {}),
        ...(input.lastname ? { lastname: input.lastname } : {}),
        address1: input.address1,
        ...(input.address2 ? { address2: input.address2 } : {}),
        zipcode: input.zipcode,
        city: input.city,
        country: input.country,
        ...(input.taxNumber ? { tax_number: input.taxNumber } : {}),
        ...(input.email ? { send_invoices_to_email: input.email } : {}),
      },
    },
    fetchImpl,
  );
  if (created.kind === 'unreachable') return { kind: 'unavailable', reason: created.reason };
  if (created.status === 401 || created.status === 403) {
    return { kind: 'unavailable', reason: refusedToken(created.status) };
  }
  if (created.status === 422) {
    return {
      kind: 'refused',
      reason: `Moneybird refused the contact as invalid: ${bodyText(created.body)}`,
    };
  }
  const contact = created.status === 201 || created.status === 200 ? parseContact(created.body) : null;
  if (!contact) {
    return { kind: 'unavailable', reason: `Moneybird answered HTTP ${created.status} to the contact create.` };
  }
  return { kind: 'created', contact };
}

// ------------------------------------------------------------ sales invoices

export interface MoneybirdInvoiceLine {
  readonly description: string;
  /** Euro amount as a string, Moneybird's own convention — e.g. "9.99". */
  readonly price: string;
  readonly amount?: string | null;
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
  readonly state: string | null;
  readonly contactId: string | null;
}

export type EnsureInvoiceOutcome =
  | { readonly kind: 'exists'; readonly invoice: MoneybirdSalesInvoice }
  | { readonly kind: 'created'; readonly invoice: MoneybirdSalesInvoice }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string };

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
  };
}

/**
 * The idempotent create (hard rule 1 at the seam): look up by `reference`;
 * an explicit 404 — and nothing else — opens the create path.
 */
export async function ensureSalesInvoiceByReference(
  config: MoneybirdConfig,
  input: {
    readonly contactId: string;
    /** Period-derived and OURS — e.g. `tenant-…-2026-09`. The idempotency key. */
    readonly reference: string;
    readonly lines: readonly MoneybirdInvoiceLine[];
  },
  fetchImpl: typeof fetch = fetch,
): Promise<EnsureInvoiceOutcome> {
  const found = await moneybirdRequest(
    config,
    'GET',
    `/sales_invoices/find_by_reference/${encodeURIComponent(input.reference)}.json`,
    undefined,
    fetchImpl,
  );
  if (found.kind === 'unreachable') return { kind: 'unavailable', reason: found.reason };
  if (found.status === 401 || found.status === 403) {
    return { kind: 'unavailable', reason: refusedToken(found.status) };
  }
  if (found.status === 200) {
    const invoice = parseInvoice(found.body);
    if (!invoice) {
      return { kind: 'unavailable', reason: 'Moneybird answered a shape this client does not recognise.' };
    }
    // As it stands — never patched. A difference from what the caller meant
    // is a discrepancy to surface; the correction instrument is a credit
    // note (T7), not an UPDATE.
    return { kind: 'exists', invoice };
  }
  if (found.status !== 404) {
    // THE rule: an uncertain lookup never falls through to create. That
    // fall-through is how a flaky afternoon double-invoices a customer.
    return {
      kind: 'unavailable',
      reason: `Moneybird answered HTTP ${found.status} to the reference lookup — not creating anything while the answer is uncertain.`,
    };
  }

  const created = await moneybirdRequest(
    config,
    'POST',
    '/sales_invoices.json',
    {
      sales_invoice: {
        contact_id: input.contactId,
        reference: input.reference,
        details_attributes: input.lines.map((line) => ({
          description: line.description,
          price: line.price,
          ...(line.amount ? { amount: line.amount } : {}),
          tax_rate_id: line.taxRateId,
        })),
      },
    },
    fetchImpl,
  );
  if (created.kind === 'unreachable') return { kind: 'unavailable', reason: created.reason };
  if (created.status === 401 || created.status === 403) {
    return { kind: 'unavailable', reason: refusedToken(created.status) };
  }
  if (created.status === 422) {
    return {
      kind: 'refused',
      reason: `Moneybird refused the invoice as invalid: ${bodyText(created.body)}`,
    };
  }
  const invoice = created.status === 201 || created.status === 200 ? parseInvoice(created.body) : null;
  if (!invoice) {
    return { kind: 'unavailable', reason: `Moneybird answered HTTP ${created.status} to the invoice create.` };
  }
  return { kind: 'created', invoice };
}

// ------------------------------------------------------------------- sending

export type SendInvoiceOutcome =
  | { readonly kind: 'sent'; readonly invoice: MoneybirdSalesInvoice | null }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string };

/**
 * Ask Moneybird to send (or mark manually delivered) an invoice. THIS is the
 * moment Moneybird assigns the legal number to a draft — which is exactly
 * why sending belongs to the system that owns numbering.
 */
export async function sendSalesInvoice(
  config: MoneybirdConfig,
  invoiceId: string,
  deliveryMethod: 'Email' | 'Manual' = 'Email',
  fetchImpl: typeof fetch = fetch,
): Promise<SendInvoiceOutcome> {
  const sent = await moneybirdRequest(
    config,
    'PATCH',
    `/sales_invoices/${encodeURIComponent(invoiceId)}/send_invoice.json`,
    { sales_invoice_sending: { delivery_method: deliveryMethod } },
    fetchImpl,
  );
  if (sent.kind === 'unreachable') return { kind: 'unavailable', reason: sent.reason };
  if (sent.status === 401 || sent.status === 403) {
    return { kind: 'unavailable', reason: refusedToken(sent.status) };
  }
  if (sent.status === 422) {
    return { kind: 'refused', reason: `Moneybird refused to send: ${bodyText(sent.body)}` };
  }
  if (sent.status === 200 || sent.status === 204) {
    return { kind: 'sent', invoice: parseInvoice(sent.body) };
  }
  return { kind: 'unavailable', reason: `Moneybird answered HTTP ${sent.status} to the send.` };
}
