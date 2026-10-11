// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The adapter (workplan 0111 T4; its seam on 2026-08-29, completed as slice 2).
 *
 * The assertions this file exists for: a retried ensure CONVERGES on one
 * invoice (hard rule 1); **an uncertain lookup never falls through to
 * create** (a 500 on `find_by_reference` is `unavailable` with zero POSTs);
 * an invoice under our reference for another contact is never adopted;
 * every create states the workflow and whether prices include VAT; a send
 * happens only from `draft`, so a retry mails nobody twice; and a 429 is its
 * own outcome. Everything runs against an injected fetch.
 */

import { describe, it, expect } from 'vitest';
import {
  ensureContact,
  ensureSalesInvoiceByReference,
  readSalesInvoice,
  sendSalesInvoice,
  type MoneybirdSalesInvoice,
} from './moneybird-sales-invoices.ts';

const ACCESS = { administrationId: '123456789', apiToken: 'not-a-real-token' };

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
function fakeFetch(handler: Handler) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return handler(String(url), init ?? {});
  }) as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

/** An issued invoice as Moneybird answers it (ids made up). */
const WIRE_INVOICE = {
  id: '555000111',
  invoice_id: '2026-0007',
  reference: 'ownpace-alpha-m-2026-10-medium',
  state: 'open',
  contact_id: '444000222',
  invoice_date: '2026-10-01',
  due_date: '2026-10-15',
  prices_are_incl_tax: true,
  total_price_incl_tax: '12.0',
  total_price_excl_tax: '9.92',
  total_unpaid: '12.0',
};

const INVOICE: MoneybirdSalesInvoice = {
  id: '555000111',
  invoiceNumber: '2026-0007',
  reference: 'ownpace-alpha-m-2026-10-medium',
  state: 'open',
  contactId: '444000222',
  invoiceDate: '2026-10-01',
  dueDate: '2026-10-15',
  pricesAreInclTax: true,
  totalInclTaxCents: 1200,
  totalExclTaxCents: 992,
  totalUnpaidCents: 1200,
};

const ENSURE = {
  contactId: '444000222',
  reference: 'ownpace-alpha-m-2026-10-medium',
  workflowId: '777',
  pricesAreInclTax: true,
  lines: [{ description: 'Ownpace Medium, oktober 2026', price: '12.00', taxRateId: '111' }],
} as const;

describe('ensureSalesInvoiceByReference', () => {
  it('an existing reference is returned AS IT STANDS — one call, no create, no patch, totals in cents', async () => {
    const { impl, calls } = fakeFetch(() => json(WIRE_INVOICE));
    const outcome = await ensureSalesInvoiceByReference(ACCESS, ENSURE, impl);

    expect(outcome).toEqual({ kind: 'exists', invoice: INVOICE });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/find_by_reference/ownpace-alpha-m-2026-10-medium.json');
    expect(calls[0]!.method).toBe('GET');
  });

  it('an invoice under our reference for ANOTHER contact is refused — never adopted, nothing created', async () => {
    const { impl, calls } = fakeFetch(() => json({ ...WIRE_INVOICE, contact_id: '999' }));
    const outcome = await ensureSalesInvoiceByReference(ACCESS, ENSURE, impl);

    expect(outcome.kind).toBe('refused');
    if (outcome.kind === 'refused') expect(outcome.reason).toContain('another contact');
    expect(calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });

  it('a clean 404 — and nothing else — creates, stating the workflow and the VAT setting', async () => {
    const { impl, calls } = fakeFetch((url) =>
      url.includes('find_by_reference')
        ? json({}, 404)
        : json({ ...WIRE_INVOICE, invoice_id: null, state: 'draft', invoice_date: null }, 201),
    );
    const outcome = await ensureSalesInvoiceByReference(ACCESS, { ...ENSURE, pricesAreInclTax: false }, impl);

    expect(outcome.kind).toBe('created');
    if (outcome.kind === 'created') {
      // A draft has NO number yet — the number is assigned by Moneybird at
      // send time, which is the whole ADR-0044 point.
      expect(outcome.invoice.invoiceNumber).toBeNull();
      expect(outcome.invoice.invoiceDate).toBeNull();
    }
    expect(calls).toHaveLength(2);
    const body = calls[1]!.body as { sales_invoice: Record<string, unknown> };
    expect(body.sales_invoice).toEqual({
      contact_id: '444000222',
      reference: 'ownpace-alpha-m-2026-10-medium',
      workflow_id: '777',
      // Stated even when false: an invoice that says nothing takes the workflow's setting.
      prices_are_incl_tax: false,
      details_attributes: [{ description: 'Ownpace Medium, oktober 2026', price: '12.00', tax_rate_id: '111' }],
    });
    // No percentage anywhere near the wire (ADR-0044): the line names a
    // rate by ID and nothing else.
    expect(JSON.stringify(body)).not.toContain('percentage');
  });

  it('a retry converges: the second ensure finds what the first created (hard rule 1)', async () => {
    let created = false;
    const { impl, calls } = fakeFetch((url) => {
      if (url.includes('find_by_reference')) return created ? json(WIRE_INVOICE) : json({}, 404);
      created = true;
      return json(WIRE_INVOICE, 201);
    });

    const first = await ensureSalesInvoiceByReference(ACCESS, ENSURE, impl);
    const second = await ensureSalesInvoiceByReference(ACCESS, ENSURE, impl);

    expect(first.kind).toBe('created');
    expect(second.kind).toBe('exists');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('an UNCERTAIN lookup never falls through to create — the double-invoice hole, refused', async () => {
    // The one assertion this file exists for: 500 ≠ 404.
    const { impl, calls } = fakeFetch(() => json({ error: 'boom' }, 500));
    const outcome = await ensureSalesInvoiceByReference(ACCESS, ENSURE, impl);

    expect(outcome.kind).toBe('unavailable');
    if (outcome.kind === 'unavailable') expect(outcome.reason).toContain('not creating');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('a 429 on the lookup is slow_down with Moneybird’s Retry-After, and creates nothing', async () => {
    const { impl, calls } = fakeFetch(() => json({}, 429, { 'Retry-After': '12' }));
    const outcome = await ensureSalesInvoiceByReference(ACCESS, ENSURE, impl);

    expect(outcome).toMatchObject({ kind: 'slow_down', retryAfterSeconds: 12 });
    expect(calls).toHaveLength(1);
  });

  it('a 422 on create is refused with Moneybird’s own words; 401 names the token', async () => {
    const { impl } = fakeFetch((url) =>
      url.includes('find_by_reference')
        ? json({}, 404)
        : json({ error: { details_attributes: ['tax rate is archived'] } }, 422),
    );
    const refused = await ensureSalesInvoiceByReference(ACCESS, ENSURE, impl);
    expect(refused.kind).toBe('refused');
    if (refused.kind === 'refused') expect(refused.reason).toContain('tax rate is archived');

    const denied = await ensureSalesInvoiceByReference(ACCESS, ENSURE, fakeFetch(() => json({}, 401)).impl);
    expect(denied.kind).toBe('unavailable');
    if (denied.kind === 'unavailable') expect(denied.reason).toContain('MONEYBIRD_API_TOKEN');
  });

  it('a thrown fetch is unavailable, never a verdict', async () => {
    const outcome = await ensureSalesInvoiceByReference(
      ACCESS,
      ENSURE,
      (async () => {
        throw new Error('getaddrinfo ENOTFOUND moneybird.com');
      }) as unknown as typeof fetch,
    );
    expect(outcome.kind).toBe('unavailable');
  });

  it('a total finer than a cent is read as unknown, never rounded', async () => {
    const outcome = await ensureSalesInvoiceByReference(
      ACCESS,
      ENSURE,
      fakeFetch(() => json({ ...WIRE_INVOICE, total_price_incl_tax: '12.005' })).impl,
    );
    expect(outcome.kind).toBe('exists');
    if (outcome.kind === 'exists') expect(outcome.invoice.totalInclTaxCents).toBeNull();
  });
});

describe('ensureContact', () => {
  const INPUT = {
    customerId: 'ownpace-alpha',
    firstname: 'Piet',
    lastname: 'Jansen',
    address1: 'Dorpsstraat 1',
    zipcode: '1234 AB',
    city: 'Ons Dorp',
    country: 'NL',
  };
  const STORED = { id: '2', customer_id: 'ownpace-alpha', ...{ firstname: 'Piet', lastname: 'Jansen' }, address1: 'Dorpsstraat 1', address2: '', zipcode: '1234 AB', city: 'Ons Dorp', country: 'NL', company_name: null, tax_number: '', send_invoices_to_email: null };

  it('the fuzzy search is matched EXACTLY on customer_id — a substring hit is somebody else', async () => {
    const { impl, calls } = fakeFetch(() => json([{ id: '1', customer_id: 'ownpace-alpha-other' }, STORED]));
    const outcome = await ensureContact(ACCESS, INPUT, impl);
    expect(outcome).toEqual({ kind: 'exists', contact: { id: '2', customerId: 'ownpace-alpha' } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/contacts.json?query=ownpace-alpha');
  });

  it('a contact that says something else is brought in step: only what differs, a cleared field sent empty', async () => {
    const { impl, calls } = fakeFetch((url, init) =>
      init.method === 'PATCH' ? json({ ...STORED }) : json([{ ...STORED, address2: 'Achterhuis', city: 'Oud Dorp' }]),
    );
    const outcome = await ensureContact(ACCESS, { ...INPUT, taxNumber: 'NL000099998B57' }, impl);

    expect(outcome).toEqual({ kind: 'updated', contact: { id: '2', customerId: 'ownpace-alpha' } });
    expect(calls[1]!.method).toBe('PATCH');
    expect(calls[1]!.url).toContain('/contacts/2.json');
    expect(calls[1]!.body).toEqual({ contact: { address2: '', city: 'Ons Dorp', tax_number: 'NL000099998B57' } });
  });

  it('no exact match creates the contact, carrying our key and the buyer’s facts, and no e-mail unless given', async () => {
    const { impl, calls } = fakeFetch((url) =>
      url.includes('?query=') ? json([{ id: '1', customer_id: 'ownpace-alpha-other' }]) : json({ id: '9', customer_id: 'ownpace-alpha' }, 201),
    );
    const outcome = await ensureContact(ACCESS, INPUT, impl);
    expect(outcome.kind).toBe('created');
    const body = calls[1]!.body as { contact: Record<string, unknown> };
    expect(body.contact).toEqual({
      customer_id: 'ownpace-alpha',
      firstname: 'Piet',
      lastname: 'Jansen',
      address1: 'Dorpsstraat 1',
      zipcode: '1234 AB',
      city: 'Ons Dorp',
      country: 'NL',
    });
  });

  it('a failed search never falls through to create — same rule as invoices', async () => {
    const { impl, calls } = fakeFetch(() => json({}, 500));
    const outcome = await ensureContact(ACCESS, INPUT, impl);
    expect(outcome.kind).toBe('unavailable');
    expect(calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });

  it('new details Moneybird refuses are refused with its words', async () => {
    const { impl } = fakeFetch((url, init) =>
      init.method === 'PATCH' ? json({ error: { country: ['is invalid'] } }, 422) : json([{ ...STORED, city: 'Elders' }]),
    );
    const outcome = await ensureContact(ACCESS, INPUT, impl);
    expect(outcome.kind).toBe('refused');
    if (outcome.kind === 'refused') expect(outcome.reason).toContain('is invalid');
  });
});

describe('readSalesInvoice', () => {
  it('reads the invoice as Moneybird holds it now', async () => {
    const { impl, calls } = fakeFetch(() => json(WIRE_INVOICE));
    expect(await readSalesInvoice(ACCESS, '555000111', impl)).toEqual({ kind: 'ok', invoice: INVOICE });
    expect(calls[0]!.url).toContain('/sales_invoices/555000111.json');
  });

  it('anything but the invoice is unavailable', async () => {
    expect((await readSalesInvoice(ACCESS, 'x', fakeFetch(() => json({}, 404)).impl)).kind).toBe('unavailable');
  });
});

describe('sendSalesInvoice', () => {
  const DRAFT: MoneybirdSalesInvoice = { ...INVOICE, invoiceNumber: null, state: 'draft', invoiceDate: null };

  it('sends a draft with the delivery method asked for — the moment Moneybird assigns the legal number', async () => {
    const { impl, calls } = fakeFetch(() => json(WIRE_INVOICE));
    const outcome = await sendSalesInvoice(ACCESS, DRAFT, 'Manual', impl);

    expect(outcome.kind).toBe('sent');
    if (outcome.kind === 'sent') expect(outcome.invoice?.invoiceNumber).toBe('2026-0007');
    expect(calls[0]!.method).toBe('PATCH');
    expect(calls[0]!.url).toContain('/sales_invoices/555000111/send_invoice.json');
    expect(calls[0]!.body).toEqual({ sales_invoice_sending: { delivery_method: 'Manual' } });
  });

  it('anything but a draft is not sent again — no request, so a retry mails nobody twice', async () => {
    const { impl, calls } = fakeFetch(() => json(WIRE_INVOICE));
    for (const state of ['open', 'late', 'paid', null]) {
      const outcome = await sendSalesInvoice(ACCESS, { ...INVOICE, state }, 'Email', impl);
      expect(outcome.kind).toBe('not_draft');
    }
    expect(calls).toHaveLength(0);
  });

  it('a refusal carries Moneybird’s words; an outage is unavailable', async () => {
    const refused = await sendSalesInvoice(
      ACCESS,
      DRAFT,
      'Manual',
      fakeFetch(() => json({ error: 'invoice has no details' }, 422)).impl,
    );
    expect(refused.kind).toBe('refused');
    if (refused.kind === 'refused') expect(refused.reason).toContain('no details');

    const down = await sendSalesInvoice(ACCESS, DRAFT, 'Manual', fakeFetch(() => json({}, 503)).impl);
    expect(down.kind).toBe('unavailable');
  });
});
