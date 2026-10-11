// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * One invoice pushed: rate, contact, invoice by reference, check, send, read
 * back (workplan 0111, slice 2).
 *
 * What matters here: a second run sends nothing (the invoice is no longer a
 * draft) and answers `issued`, adopted; a draft whose total disagrees with its
 * lines is never sent; a missing rate refuses before anything is made; the
 * delivery is the configured one; and a 429 anywhere is `slow_down`, with
 * nothing more asked.
 */

import { describe, it, expect } from 'vitest';
import type { MoneybirdSettings } from './moneybird-config.ts';
import { pushInvoice, type InvoiceToPush } from './moneybird-push.ts';

const SETTINGS: MoneybirdSettings = {
  apiToken: 'not-a-real-token',
  administrationId: '123456789012345678',
  workflowId: '702',
  taxRates: { domesticStandard: '611', reverseCharge: '622', outsideEu: null },
  delivery: 'manual',
};

const RATES = [
  { id: '611', name: '21% btw', percentage: '21.0', tax_rate_type: 'sales_invoice', active: true, country: null },
  { id: '622', name: 'Dienst binnen EU (btw verlegd)', percentage: null, tax_rate_type: 'sales_invoice', active: true },
];

const BUYER = {
  customerId: 'ownpace-alpha',
  firstname: 'Piet',
  lastname: 'Jansen',
  address1: 'Dorpsstraat 1',
  zipcode: '1234 AB',
  city: 'Ons Dorp',
  country: 'NL',
};

const MEDIUM: InvoiceToPush = {
  reference: 'ownpace-alpha-m-2026-10-medium',
  treatment: 'domestic_standard',
  buyer: BUYER,
  lines: [{ description: 'Ownpace Medium, oktober 2026: 12 migraties tegelijk op 1 oktober', publishedCents: 1200 }],
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

/**
 * A small Moneybird: one administration's rates, contacts and invoices, kept
 * between calls, so a second push meets what the first one left.
 */
function moneybird(options: { draftTotal?: string; rates?: unknown[]; slowOn?: string } = {}) {
  const invoices = new Map<string, Record<string, unknown>>();
  const contacts: Record<string, unknown>[] = [];
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = new URL(String(url)).pathname.replace('/api/v2/123456789012345678', '');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    if (options.slowOn && path.includes(options.slowOn)) return json({}, 429, { 'Retry-After': '20' });

    if (path === '/tax_rates.json') return json(options.rates ?? RATES);
    if (path === '/contacts.json' && method === 'GET') return json(contacts);
    if (path === '/contacts.json' && method === 'POST') {
      const contact = { id: '9', ...(body as { contact: object }).contact };
      contacts.push(contact);
      return json(contact, 201);
    }
    const byReference = /^\/sales_invoices\/find_by_reference\/(.+)\.json$/.exec(path);
    if (byReference) {
      const found = [...invoices.values()].find((i) => i.reference === decodeURIComponent(byReference[1]!));
      return found ? json(found) : json({}, 404);
    }
    if (path === '/sales_invoices.json' && method === 'POST') {
      const wanted = (body as { sales_invoice: Record<string, unknown> }).sales_invoice;
      const lines = wanted.details_attributes as Array<{ price: string }>;
      const sum = lines.reduce((total, line) => total + Math.round(Number(line.price) * 100), 0);
      const invoice = {
        id: '555',
        invoice_id: null,
        state: 'draft',
        reference: wanted.reference,
        contact_id: wanted.contact_id,
        prices_are_incl_tax: wanted.prices_are_incl_tax,
        total_price_incl_tax: options.draftTotal ?? (sum / 100).toFixed(2),
        total_price_excl_tax: options.draftTotal ?? (sum / 100).toFixed(2),
      };
      invoices.set('555', invoice);
      return json(invoice, 201);
    }
    if (path === '/sales_invoices/555/send_invoice.json' && method === 'PATCH') {
      const sent = { ...invoices.get('555')!, state: 'open', invoice_id: '2026-0001', invoice_date: '2026-10-01' };
      invoices.set('555', sent);
      return json(sent);
    }
    if (path === '/sales_invoices/555.json') return json(invoices.get('555'));
    return json({ error: `unexpected ${method} ${path}` }, 500);
  }) as typeof fetch;
  return { impl, calls, invoices };
}

describe('pushInvoice', () => {
  it('pushes a domestic invoice: rate, contact, invoice, send by hand, read back', async () => {
    const books = moneybird();
    const outcome = await pushInvoice(SETTINGS, MEDIUM, books.impl);

    expect(outcome).toMatchObject({
      kind: 'issued',
      adopted: false,
      taxRateId: '611',
      pricesAreInclTax: true,
      invoice: { invoiceNumber: '2026-0001', invoiceDate: '2026-10-01', state: 'open', totalInclTaxCents: 1200 },
    });
    const create = books.calls.find((c) => c.path === '/sales_invoices.json')!;
    expect(create.body).toMatchObject({
      sales_invoice: {
        workflow_id: '702',
        prices_are_incl_tax: true,
        details_attributes: [{ price: '12.00', tax_rate_id: '611' }],
      },
    });
    const send = books.calls.find((c) => c.path.endsWith('/send_invoice.json'))!;
    expect(send.body).toEqual({ sales_invoice_sending: { delivery_method: 'Manual' } });
  });

  it('a second run sends nothing and answers issued, adopted: a retry mints and mails nothing', async () => {
    const books = moneybird();
    await pushInvoice(SETTINGS, MEDIUM, books.impl);
    const before = books.calls.length;
    const again = await pushInvoice(SETTINGS, MEDIUM, books.impl);

    expect(again).toMatchObject({ kind: 'issued', adopted: true, invoice: { invoiceNumber: '2026-0001' } });
    const second = books.calls.slice(before);
    expect(second.filter((c) => c.method !== 'GET')).toEqual([]);
    expect(books.invoices.size).toBe(1);
  });

  it('a reverse-charge invoice carries the price without Dutch VAT, prices excluding VAT, the reverse-charge rate', async () => {
    const books = moneybird();
    const outcome = await pushInvoice(
      SETTINGS,
      { ...MEDIUM, treatment: 'reverse_charge', reference: 'ownpace-beta-m-2026-10-medium' },
      books.impl,
    );
    expect(outcome).toMatchObject({ kind: 'issued', taxRateId: '622', pricesAreInclTax: false });
    const create = books.calls.find((c) => c.path === '/sales_invoices.json')!;
    expect(create.body).toMatchObject({
      sales_invoice: { prices_are_incl_tax: false, details_attributes: [{ price: '9.92', tax_rate_id: '622' }] },
    });
  });

  it('a draft whose total disagrees with its lines is never sent, and is refused by name', async () => {
    const books = moneybird({ draftTotal: '14.52' });
    const outcome = await pushInvoice(SETTINGS, MEDIUM, books.impl);

    expect(outcome.kind).toBe('refused');
    if (outcome.kind === 'refused') {
      expect(outcome.reason).toContain('was not sent');
      expect(outcome.reason).toContain('14.52');
      expect(outcome.reason).toContain('12.00');
    }
    expect(books.calls.some((c) => c.path.endsWith('/send_invoice.json'))).toBe(false);
  });

  it('a treatment without a rate refuses before anything is made', async () => {
    const books = moneybird();
    const outcome = await pushInvoice(SETTINGS, { ...MEDIUM, treatment: 'outside_eu' }, books.impl);
    expect(outcome.kind).toBe('refused');
    if (outcome.kind === 'refused') expect(outcome.reason).toContain('MONEYBIRD_TAX_RATE_ID_');
    expect(books.calls.map((c) => c.path)).toEqual(['/tax_rates.json']);
  });

  it('a 429 is slow_down, and nothing more is asked after it', async () => {
    const books = moneybird({ slowOn: '/contacts.json' });
    const outcome = await pushInvoice(SETTINGS, MEDIUM, books.impl);
    expect(outcome).toMatchObject({ kind: 'slow_down', retryAfterSeconds: 20 });
    expect(books.calls.map((c) => c.path)).toEqual(['/tax_rates.json', '/contacts.json']);
  });

  it('delivery email sends by e-mail; no lines is refused before a request', async () => {
    const books = moneybird();
    await pushInvoice({ ...SETTINGS, delivery: 'email' }, MEDIUM, books.impl);
    expect(books.calls.find((c) => c.path.endsWith('/send_invoice.json'))!.body).toEqual({
      sales_invoice_sending: { delivery_method: 'Email' },
    });

    const none = moneybird();
    expect((await pushInvoice(SETTINGS, { ...MEDIUM, lines: [] }, none.impl)).kind).toBe('refused');
    expect(none.calls).toEqual([]);
  });
});

