// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `operator.sh moneybird proof` (workplan 0111, decision 12, slice 5): one
 * invoice a month, made by hand, to prove the books.
 *
 * What matters here: live, a stack that cannot say it is not live, e-mail
 * delivery and Moneybird off each refuse before a single request; the month's
 * proof is made under its own reference, to a contact without an e-mail
 * address, sent by hand, and says its number; run again that month it answers
 * that it exists and asks Moneybird to write nothing; the next month is a new
 * proof; a refusal and a 429 are said, not passed; and no line carries the
 * token.
 */

import { describe, it, expect } from 'vitest';
import { proveMoneybird, proofReference } from './moneybird-proof.ts';

const TOKEN = 'not-a-real-token-and-never-printed';

/** The OTA stack: a test stack against the sandbox, delivery by hand. */
const OTA = {
  NODE_ENV: 'development',
  MONEYBIRD_API_TOKEN: TOKEN,
  MONEYBIRD_ADMINISTRATION_ID: '123456789012345678',
  MONEYBIRD_WORKFLOW_ID: '702',
  MONEYBIRD_TAX_RATE_ID_DOMESTIC: '611',
  MONEYBIRD_TAX_RATE_ID_REVERSE_CHARGE: '622',
  MONEYBIRD_DELIVERY: 'manual',
};

const OCTOBER = new Date('2026-10-10T13:00:00Z');
const NOVEMBER = new Date('2026-11-01T00:30:00Z');

const RATES = [
  { id: '611', name: '21% btw', percentage: '21.0', tax_rate_type: 'sales_invoice', active: true, country: null },
  { id: '622', name: 'Dienst binnen EU (btw verlegd)', percentage: null, tax_rate_type: 'sales_invoice', active: true },
];

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

/** A sandbox that keeps its contacts and invoices between calls, numbering each invoice it sends. */
function sandbox(options: { draftTotal?: string; slowOn?: string } = {}) {
  const invoices = new Map<string, Record<string, unknown>>();
  const contacts: Record<string, unknown>[] = [];
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = new URL(String(url)).pathname.replace('/api/v2/123456789012345678', '');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    if (options.slowOn && path.includes(options.slowOn)) return json({}, 429, { 'Retry-After': '30' });

    if (path === '/tax_rates.json') return json(RATES);
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
      const id = String(600 + invoices.size);
      const invoice = {
        id,
        invoice_id: null,
        state: 'draft',
        reference: wanted.reference,
        contact_id: wanted.contact_id,
        prices_are_incl_tax: wanted.prices_are_incl_tax,
        total_price_incl_tax: options.draftTotal ?? (sum / 100).toFixed(2),
        total_price_excl_tax: options.draftTotal ?? (sum / 100).toFixed(2),
      };
      invoices.set(id, invoice);
      return json(invoice, 201);
    }
    const send = /^\/sales_invoices\/(\d+)\/send_invoice\.json$/.exec(path);
    if (send && method === 'PATCH') {
      const number = `2026-${String(invoices.size).padStart(4, '0')}`;
      const sent = { ...invoices.get(send[1]!)!, state: 'open', invoice_id: number, invoice_date: '2026-10-10' };
      invoices.set(send[1]!, sent);
      return json(sent);
    }
    const read = /^\/sales_invoices\/(\d+)\.json$/.exec(path);
    if (read) return json(invoices.get(read[1]!));
    return json({ error: `unexpected ${method} ${path}` }, 500);
  }) as typeof fetch;
  return { impl, calls, invoices, contacts };
}

function noToken(lines: readonly string[]): void {
  for (const line of lines) expect(line).not.toContain(TOKEN);
}

describe('where a proof may not be made, Moneybird is asked nothing', () => {
  it.each([
    ['live, which runs NODE_ENV=production', { ...OTA, NODE_ENV: 'production' }, /NODE_ENV=production, as live does/],
    ['a stack that names no NODE_ENV', { ...OTA, NODE_ENV: '' }, /names no NODE_ENV, so it cannot say it is not live/],
    ['e-mail delivery', { ...OTA, MONEYBIRD_DELIVERY: 'email' }, /MONEYBIRD_DELIVERY is email, and a proof is never e-mailed/],
    ['Moneybird off', { NODE_ENV: 'development' }, /Moneybird is off/],
    ['half a set of keys', { NODE_ENV: 'development', MONEYBIRD_API_TOKEN: TOKEN }, /MONEYBIRD_ADMINISTRATION_ID/],
  ])('%s', async (_case, env, said) => {
    const books = sandbox();
    const proof = await proveMoneybird(env, OCTOBER, books.impl);

    expect(proof.ok).toBe(false);
    expect(proof.lines.join('\n')).toMatch(/^No proof was made\. /);
    expect(proof.lines.join('\n')).toMatch(said);
    expect(books.calls).toEqual([]);
    noToken(proof.lines);
  });
});

describe("the month's proof", () => {
  it('is made under its own reference, to a contact without an e-mail address, sent by hand, and says its number', async () => {
    const books = sandbox();
    const proof = await proveMoneybird(OTA, OCTOBER, books.impl);

    expect(proof.ok).toBe(true);
    expect(proof.lines).toEqual([
      'Made invoice 2026-0001 (ownpace-proof-2026-10), dated 2026-10-10: €1.00 including VAT, under rate 611.',
      'Sent by hand (delivery Manual): no e-mail went out.',
      'Running this again this month answers that it exists.',
    ]);
    const contact = books.calls.find((c) => c.path === '/contacts.json' && c.method === 'POST')!;
    expect(contact.body).toMatchObject({ contact: { customer_id: 'ownpace-proof', company_name: 'Ownpace proof' } });
    expect((contact.body as { contact: Record<string, unknown> }).contact.send_invoices_to_email ?? null).toBeNull();
    const create = books.calls.find((c) => c.path === '/sales_invoices.json')!;
    expect(create.body).toMatchObject({
      sales_invoice: {
        reference: 'ownpace-proof-2026-10',
        workflow_id: '702',
        details_attributes: [{ description: 'Ownpace proof, October 2026: made by hand to prove the books', price: '1.00', tax_rate_id: '611' }],
      },
    });
    const sent = books.calls.find((c) => c.path.endsWith('/send_invoice.json'))!;
    expect(sent.body).toEqual({ sales_invoice_sending: { delivery_method: 'Manual' } });
    noToken(proof.lines);
  });

  it('run again that month answers that it exists, and asks Moneybird to write nothing', async () => {
    const books = sandbox();
    await proveMoneybird(OTA, OCTOBER, books.impl);
    const before = books.calls.length;
    const again = await proveMoneybird(OTA, new Date('2026-10-31T23:59:00Z'), books.impl);

    expect(again).toEqual({
      ok: true,
      lines: [
        'It exists: invoice 2026-0001 (ownpace-proof-2026-10), dated 2026-10-10, state open. Nothing was made or sent.',
        "One proof a month: the next is next month's.",
      ],
    });
    expect(books.calls.slice(before).filter((c) => c.method !== 'GET')).toEqual([]);
    expect(books.invoices.size).toBe(1);
  });

  it('is a new proof the next month, by UTC', async () => {
    const books = sandbox();
    await proveMoneybird(OTA, OCTOBER, books.impl);
    const november = await proveMoneybird(OTA, NOVEMBER, books.impl);

    expect(proofReference(NOVEMBER)).toBe('ownpace-proof-2026-11');
    expect(november.lines[0]).toMatch(/^Made invoice 2026-0002 \(ownpace-proof-2026-11\)/);
    expect(books.invoices.size).toBe(2);
  });

  it('says why it did not go through when the draft does not add up, and sends nothing', async () => {
    const books = sandbox({ draftTotal: '1.21' });
    const proof = await proveMoneybird(OTA, OCTOBER, books.impl);

    expect(proof.ok).toBe(false);
    expect(proof.lines[0]).toMatch(/^The proof did not go through \(refused\): The draft for ownpace-proof-2026-10 .* was not sent/);
    expect(books.calls.some((c) => c.path.endsWith('/send_invoice.json'))).toBe(false);
  });

  it('stops at a 429 and says when to run it again', async () => {
    const books = sandbox({ slowOn: '/contacts.json' });
    const proof = await proveMoneybird(OTA, OCTOBER, books.impl);

    expect(proof).toEqual({
      ok: false,
      lines: ['Moneybird asked to slow down. Run the proof again in 30 seconds; nothing is made twice.'],
    });
    expect(books.calls.some((c) => c.path === '/sales_invoices.json')).toBe(false);
  });
});
