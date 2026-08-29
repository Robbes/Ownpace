// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The reference-idempotency seam (workplan 0111 T4, first slice).
 *
 * The two assertions this file exists for: a retried ensure CONVERGES on one
 * invoice (hard rule 1), and — the sharper one — **an uncertain lookup never
 * falls through to create**: a 500 on `find_by_reference` answers
 * `unavailable` with zero POSTs, because treating "could not look" as "not
 * found" is how a flaky afternoon double-invoices a customer. Everything
 * runs against an injected fetch; the live shapes still need the trial
 * administration (the German-19% gating test) before anything real flows.
 */

import { describe, it, expect } from 'vitest';
import {
  ensureContact,
  ensureSalesInvoiceByReference,
  sendSalesInvoice,
} from './moneybird-sales-invoices.ts';

const CONFIG = { administrationId: '123456789', apiToken: 'not-a-real-token' };

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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const WIRE_INVOICE = {
  id: '555000111',
  invoice_id: '2026-0007',
  reference: 'tenant-alpha-2026-09',
  state: 'open',
  contact_id: '444000222',
};

const LINES = [
  { description: 'Ownpace — September', price: '9.99', taxRateId: '111' },
] as const;

describe('ensureSalesInvoiceByReference', () => {
  it('an existing reference is returned AS IT STANDS — one call, no create, no patch', async () => {
    const { impl, calls } = fakeFetch(() => json(WIRE_INVOICE));
    const outcome = await ensureSalesInvoiceByReference(
      CONFIG,
      { contactId: '444000222', reference: 'tenant-alpha-2026-09', lines: LINES },
      impl,
    );

    expect(outcome).toEqual({
      kind: 'exists',
      invoice: {
        id: '555000111',
        invoiceNumber: '2026-0007',
        reference: 'tenant-alpha-2026-09',
        state: 'open',
        contactId: '444000222',
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/find_by_reference/tenant-alpha-2026-09.json');
    expect(calls[0]!.method).toBe('GET');
  });

  it('a clean 404 — and nothing else — opens the create path, with our reference on the body', async () => {
    const { impl, calls } = fakeFetch((url) =>
      url.includes('find_by_reference') ? json({}, 404) : json({ ...WIRE_INVOICE, invoice_id: null, state: 'draft' }, 201),
    );
    const outcome = await ensureSalesInvoiceByReference(
      CONFIG,
      { contactId: '444000222', reference: 'tenant-alpha-2026-09', lines: LINES },
      impl,
    );

    expect(outcome.kind).toBe('created');
    if (outcome.kind === 'created') {
      // A draft has NO number yet — the number is assigned by Moneybird at
      // send time, which is the whole ADR-0044 point.
      expect(outcome.invoice.invoiceNumber).toBeNull();
    }
    expect(calls).toHaveLength(2);
    const body = calls[1]!.body as {
      sales_invoice: { reference: string; contact_id: string; details_attributes: Array<Record<string, unknown>> };
    };
    expect(body.sales_invoice.reference).toBe('tenant-alpha-2026-09');
    expect(body.sales_invoice.contact_id).toBe('444000222');
    expect(body.sales_invoice.details_attributes[0]).toEqual({
      description: 'Ownpace — September',
      price: '9.99',
      tax_rate_id: '111',
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

    const first = await ensureSalesInvoiceByReference(
      CONFIG,
      { contactId: '444000222', reference: 'tenant-alpha-2026-09', lines: LINES },
      impl,
    );
    const second = await ensureSalesInvoiceByReference(
      CONFIG,
      { contactId: '444000222', reference: 'tenant-alpha-2026-09', lines: LINES },
      impl,
    );

    expect(first.kind).toBe('created');
    expect(second.kind).toBe('exists');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('an UNCERTAIN lookup never falls through to create — the double-invoice hole, refused', async () => {
    // The one assertion this file exists for: 500 ≠ 404.
    const { impl, calls } = fakeFetch(() => json({ error: 'boom' }, 500));
    const outcome = await ensureSalesInvoiceByReference(
      CONFIG,
      { contactId: '444000222', reference: 'tenant-alpha-2026-09', lines: LINES },
      impl,
    );

    expect(outcome.kind).toBe('unavailable');
    if (outcome.kind === 'unavailable') expect(outcome.reason).toContain('not creating');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('a 422 on create is refused with Moneybird’s own words; 401 names the token', async () => {
    const { impl } = fakeFetch((url) =>
      url.includes('find_by_reference')
        ? json({}, 404)
        : json({ error: { details_attributes: ['tax rate is archived'] } }, 422),
    );
    const refused = await ensureSalesInvoiceByReference(
      CONFIG,
      { contactId: '444000222', reference: 'tenant-alpha-2026-09', lines: LINES },
      impl,
    );
    expect(refused.kind).toBe('refused');
    if (refused.kind === 'refused') expect(refused.reason).toContain('tax rate is archived');

    const denied = await ensureSalesInvoiceByReference(
      CONFIG,
      { contactId: '444000222', reference: 'x', lines: LINES },
      fakeFetch(() => json({}, 401)).impl,
    );
    expect(denied.kind).toBe('unavailable');
    if (denied.kind === 'unavailable') expect(denied.reason).toContain('MONEYBIRD_API_TOKEN');
  });

  it('a thrown fetch is unavailable, never a verdict', async () => {
    const outcome = await ensureSalesInvoiceByReference(
      CONFIG,
      { contactId: '444000222', reference: 'x', lines: LINES },
      (async () => {
        throw new Error('getaddrinfo ENOTFOUND moneybird.com');
      }) as unknown as typeof fetch,
    );
    expect(outcome.kind).toBe('unavailable');
  });
});

describe('ensureContact', () => {
  const INPUT = {
    customerId: 'tenant-alpha',
    firstname: 'Piet',
    lastname: 'Jansen',
    address1: 'Dorpsstraat 1',
    zipcode: '1234 AB',
    city: 'Ons Dorp',
    country: 'NL',
  };

  it('the fuzzy search is matched EXACTLY on customer_id — a substring hit is somebody else', async () => {
    const { impl, calls } = fakeFetch(() =>
      json([
        { id: '1', customer_id: 'tenant-alpha-other' },
        { id: '2', customer_id: 'tenant-alpha' },
      ]),
    );
    const outcome = await ensureContact(CONFIG, INPUT, impl);
    expect(outcome).toEqual({ kind: 'exists', contact: { id: '2', customerId: 'tenant-alpha' } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/contacts.json?query=tenant-alpha');
  });

  it('no exact match creates the contact, carrying our key and the buyer’s facts', async () => {
    const { impl, calls } = fakeFetch((url) =>
      url.includes('?query=')
        ? json([{ id: '1', customer_id: 'tenant-alpha-other' }])
        : json({ id: '9', customer_id: 'tenant-alpha' }, 201),
    );
    const outcome = await ensureContact(CONFIG, INPUT, impl);
    expect(outcome.kind).toBe('created');
    const body = calls[1]!.body as { contact: Record<string, unknown> };
    expect(body.contact).toMatchObject({
      customer_id: 'tenant-alpha',
      firstname: 'Piet',
      lastname: 'Jansen',
      address1: 'Dorpsstraat 1',
      zipcode: '1234 AB',
      city: 'Ons Dorp',
      country: 'NL',
    });
    expect(body.contact).not.toHaveProperty('company_name');
  });

  it('a failed search never falls through to create — same rule as invoices', async () => {
    const { impl, calls } = fakeFetch(() => json({}, 500));
    const outcome = await ensureContact(CONFIG, INPUT, impl);
    expect(outcome.kind).toBe('unavailable');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });
});

describe('sendSalesInvoice', () => {
  it('PATCHes the send endpoint — the moment Moneybird assigns the legal number', async () => {
    const { impl, calls } = fakeFetch(() => json({ ...WIRE_INVOICE, state: 'open' }));
    const outcome = await sendSalesInvoice(CONFIG, '555000111', 'Email', impl);

    expect(outcome.kind).toBe('sent');
    if (outcome.kind === 'sent') expect(outcome.invoice?.invoiceNumber).toBe('2026-0007');
    expect(calls[0]!.method).toBe('PATCH');
    expect(calls[0]!.url).toContain('/sales_invoices/555000111/send_invoice.json');
    expect(calls[0]!.body).toEqual({ sales_invoice_sending: { delivery_method: 'Email' } });
  });

  it('a refusal carries Moneybird’s words; an outage is unavailable', async () => {
    const refused = await sendSalesInvoice(
      CONFIG,
      'x',
      'Email',
      fakeFetch(() => json({ error: 'invoice has no details' }, 422)).impl,
    );
    expect(refused.kind).toBe('refused');
    if (refused.kind === 'refused') expect(refused.reason).toContain('no details');

    const down = await sendSalesInvoice(CONFIG, 'x', 'Email', fakeFetch(() => json({}, 503)).impl);
    expect(down.kind).toBe('unavailable');
  });
});
