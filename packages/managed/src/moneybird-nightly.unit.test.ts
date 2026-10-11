// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The nightly's sandbox invoice (workplan 0111, decision 12): made, paid by a
 * registered payment, and read back as paid, once a night.
 *
 * What matters here: live and e-mail delivery refuse before a request, and
 * Moneybird off is a skip that passes; the month's invoices are counted
 * first, page by page, and from the fortieth the night makes none; the night's
 * invoice is made to a contact without an e-mail address, sent by hand, paid
 * for its total, and read back as paid; a second run the same night makes
 * nothing and pays nothing twice; a payment Moneybird refuses, or an invoice
 * that does not read back as paid, fails the night; and no line carries the
 * token.
 */

import { describe, it, expect } from 'vitest';
import { nightlyMoneybird, nightlyReference, NIGHTLY_MONTH_LIMIT } from './moneybird-nightly.ts';
import { countSalesInvoicesThisMonth } from './moneybird-sales-invoices.ts';

const TOKEN = 'not-a-real-token-and-never-printed';

/** The nightly's stack: a test stack against the sandbox, delivery by hand. */
const NIGHTLY = {
  NODE_ENV: 'development',
  MONEYBIRD_API_TOKEN: TOKEN,
  MONEYBIRD_ADMINISTRATION_ID: '123456789012345678',
  MONEYBIRD_WORKFLOW_ID: '702',
  MONEYBIRD_TAX_RATE_ID_DOMESTIC: '611',
  MONEYBIRD_TAX_RATE_ID_REVERSE_CHARGE: '622',
  MONEYBIRD_DELIVERY: 'manual',
};

const TONIGHT = new Date('2026-10-10T03:40:00Z');

const RATES = [
  { id: '611', name: '21% btw', percentage: '21.0', tax_rate_type: 'sales_invoice', active: true, country: null },
  { id: '622', name: 'Dienst binnen EU (btw verlegd)', percentage: null, tax_rate_type: 'sales_invoice', active: true },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * A sandbox holding `alreadyThisMonth` invoices from earlier, plus whatever
 * the night makes; a payment marks an invoice paid unless `payment` says
 * otherwise.
 */
function sandbox(options: { alreadyThisMonth?: number; payment?: 'refused' | 'ignored' } = {}) {
  const earlier = Array.from({ length: options.alreadyThisMonth ?? 3 }, (_, i) => ({ id: `e${i}`, state: 'paid' }));
  const invoices = new Map<string, Record<string, unknown>>();
  const contacts: Record<string, unknown>[] = [];
  const calls: Array<{ method: string; path: string; query: string; body: unknown }> = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    const parsed = new URL(String(url));
    const method = init?.method ?? 'GET';
    const path = parsed.pathname.replace('/api/v2/123456789012345678', '');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, query: parsed.search, body });

    if (path === '/tax_rates.json') return json(RATES);
    if (path === '/contacts.json' && method === 'GET') return json(contacts);
    if (path === '/contacts.json' && method === 'POST') {
      const contact = { id: '9', ...(body as { contact: object }).contact };
      contacts.push(contact);
      return json(contact, 201);
    }
    if (path === '/sales_invoices.json' && method === 'GET') {
      const page = Number(parsed.searchParams.get('page') ?? '1');
      const perPage = Number(parsed.searchParams.get('per_page') ?? '100');
      const all = [...earlier, ...invoices.values()];
      return json(all.slice((page - 1) * perPage, page * perPage));
    }
    const byReference = /^\/sales_invoices\/find_by_reference\/(.+)\.json$/.exec(path);
    if (byReference) {
      const found = [...invoices.values()].find((i) => i.reference === decodeURIComponent(byReference[1]!));
      return found ? json(found) : json({}, 404);
    }
    if (path === '/sales_invoices.json' && method === 'POST') {
      const wanted = (body as { sales_invoice: Record<string, unknown> }).sales_invoice;
      const invoice = {
        id: '700',
        invoice_id: null,
        state: 'draft',
        reference: wanted.reference,
        contact_id: wanted.contact_id,
        prices_are_incl_tax: wanted.prices_are_incl_tax,
        total_price_incl_tax: '1.00',
        total_price_excl_tax: '1.00',
        total_unpaid: '1.00',
      };
      invoices.set('700', invoice);
      return json(invoice, 201);
    }
    if (path === '/sales_invoices/700/send_invoice.json' && method === 'PATCH') {
      const sent = { ...invoices.get('700')!, state: 'open', invoice_id: '2026-0004', invoice_date: '2026-10-10' };
      invoices.set('700', sent);
      return json(sent);
    }
    if (path === '/sales_invoices/700/payments.json' && method === 'POST') {
      if (options.payment === 'refused') return json({ error: 'price is too high' }, 422);
      if (options.payment !== 'ignored') invoices.set('700', { ...invoices.get('700')!, state: 'paid', total_unpaid: '0.0' });
      return json({ id: '800' }, 201);
    }
    if (path === '/sales_invoices/700.json') return json(invoices.get('700'));
    return json({ error: `unexpected ${method} ${path}` }, 500);
  }) as typeof fetch;
  return { impl, calls, invoices };
}

function noToken(lines: readonly string[]): void {
  for (const line of lines) expect(line).not.toContain(TOKEN);
}

describe('before anything is made', () => {
  it.each([
    ['live, which runs NODE_ENV=production', { ...NIGHTLY, NODE_ENV: 'production' }, /as live does/],
    ['e-mail delivery', { ...NIGHTLY, MONEYBIRD_DELIVERY: 'email' }, /never e-mailed/],
  ])('refuses %s, and asks Moneybird nothing', async (_case, env, said) => {
    const books = sandbox();
    const night = await nightlyMoneybird(env, TONIGHT, books.impl);

    expect(night).toMatchObject({ ok: false, skipped: false });
    expect(night.lines.join('\n')).toMatch(said);
    expect(books.calls).toEqual([]);
    noToken(night.lines);
  });

  it('skips, and passes, where Moneybird is off: the gate proves the books once the stack has the keys', async () => {
    const books = sandbox();
    const night = await nightlyMoneybird({ NODE_ENV: 'development' }, TONIGHT, books.impl);

    expect(night).toEqual({
      ok: true,
      skipped: true,
      lines: ['Skipped: Moneybird is off on this stack (no MONEYBIRD_* key), so there are no books to prove tonight.'],
    });
    expect(books.calls).toEqual([]);
  });

  it(`counts the month's invoices first, and from the ${NIGHTLY_MONTH_LIMIT}th makes none`, async () => {
    const books = sandbox({ alreadyThisMonth: NIGHTLY_MONTH_LIMIT });
    const night = await nightlyMoneybird(NIGHTLY, TONIGHT, books.impl);

    expect(night).toMatchObject({ ok: true, skipped: true });
    expect(night.lines[0]).toMatch(/^Skipped: this month already has 40 or more invoices of the sandbox's 50/);
    expect(books.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /sales_invoices.json']);
    expect(new URLSearchParams(books.calls[0]!.query).get('filter')).toBe('period:this_month,state:all');
  });

  it('counts page by page, since Moneybird gives no total, and no further than asked', async () => {
    const access = { administrationId: '123456789012345678', apiToken: TOKEN };
    const books = sandbox({ alreadyThisMonth: 150 });

    expect(await countSalesInvoicesThisMonth(access, 500, books.impl)).toEqual({ kind: 'counted', count: 150 });
    const pages = books.calls.map((c) => new URLSearchParams(c.query));
    expect(pages.map((q) => [q.get('page'), q.get('per_page')])).toEqual([
      ['1', '100'],
      ['2', '100'],
    ]);

    books.calls.length = 0;
    expect(await countSalesInvoicesThisMonth(access, NIGHTLY_MONTH_LIMIT, books.impl)).toEqual({
      kind: 'counted',
      count: NIGHTLY_MONTH_LIMIT,
    });
    expect(books.calls).toHaveLength(1);
  });
});

describe("the night's invoice", () => {
  it('is made to a contact without an e-mail address, sent by hand, paid for its total, and read back as paid', async () => {
    const books = sandbox();
    const night = await nightlyMoneybird(NIGHTLY, TONIGHT, books.impl);

    expect(night).toEqual({
      ok: true,
      skipped: false,
      lines: [
        'Made invoice 2026-0004 (ownpace-nightly-2026-10-10), dated 2026-10-10, sent by hand.',
        'Registered a payment of €1.00 on 2026-10-10.',
        'Read back as paid.',
      ],
    });
    expect(nightlyReference(TONIGHT)).toBe('ownpace-nightly-2026-10-10');
    const contact = books.calls.find((c) => c.path === '/contacts.json' && c.method === 'POST')!;
    expect((contact.body as { contact: Record<string, unknown> }).contact.send_invoices_to_email ?? null).toBeNull();
    const sent = books.calls.find((c) => c.path.endsWith('/send_invoice.json'))!;
    expect(sent.body).toEqual({ sales_invoice_sending: { delivery_method: 'Manual' } });
    const payment = books.calls.find((c) => c.path.endsWith('/payments.json'))!;
    expect(payment.body).toEqual({ payment: { payment_date: '2026-10-10', price: '1.00' } });
    noToken(night.lines);
  });

  it('a second run the same night makes nothing and pays nothing twice', async () => {
    const books = sandbox();
    await nightlyMoneybird(NIGHTLY, TONIGHT, books.impl);
    const before = books.calls.length;
    const again = await nightlyMoneybird(NIGHTLY, new Date('2026-10-10T09:00:00Z'), books.impl);

    expect(again).toEqual({
      ok: true,
      skipped: false,
      lines: ['Found tonight\'s invoice 2026-0004 (ownpace-nightly-2026-10-10), made by an earlier run.', 'Read back as paid.'],
    });
    expect(books.calls.slice(before).filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('fails the night when Moneybird refuses the payment', async () => {
    const books = sandbox({ payment: 'refused' });
    const night = await nightlyMoneybird(NIGHTLY, TONIGHT, books.impl);

    expect(night.ok).toBe(false);
    expect(night.lines.at(-1)).toMatch(/^The payment was not registered \(refused\): Moneybird refused the payment: .*price is too high/);
  });

  it('fails the night when the invoice does not read back as paid', async () => {
    const books = sandbox({ payment: 'ignored' });
    const night = await nightlyMoneybird(NIGHTLY, TONIGHT, books.impl);

    expect(night.ok).toBe(false);
    expect(night.lines.at(-1)).toBe('It reads back as open, not paid.');
  });
});
