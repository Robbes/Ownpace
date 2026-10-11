// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * One credit note pushed: found or copied, written down, filled, checked,
 * sent and read back (workplan 0111, T7, slice 7a).
 *
 * What matters here: Moneybird makes ONE credit invoice per credit note,
 * whatever dies when (a retry reads what was written down, finds ours by
 * reference, or finds the copy a dead run left); the id is written down
 * before the copy is filled; the credit is the share of the invoice as
 * issued, at its rate, on one line that names the invoice; a draft whose
 * total is not the credit is never sent; two lost copies are refused rather
 * than guessed between; and a 429 is `slow_down`, with nothing more asked.
 */

import { describe, it, expect } from 'vitest';
import type { MoneybirdSettings } from './moneybird-config.ts';
import { creditCents, creditWords, pushCreditNote, type CreditNoteToPush } from './moneybird-credit-push.ts';

const SETTINGS: MoneybirdSettings = {
  apiToken: 'not-a-real-token',
  administrationId: '123456789012345678',
  workflowId: '702',
  taxRates: { domesticStandard: '611', reverseCharge: '622', outsideEu: null },
  delivery: 'manual',
  mollieAccountId: null,
};

const ORIGINAL = {
  id: '700',
  invoice_id: '2026-0007',
  state: 'open',
  reference: 'ownpace-alpha-m-2026-10-medium',
  contact_id: '9',
  invoice_date: '2026-10-01',
  due_date: '2026-10-15',
  prices_are_incl_tax: true,
  total_price_incl_tax: '12.00',
  total_price_excl_tax: '9.92',
  original_sales_invoice_id: null,
  details: [{ id: '701', description: 'Ownpace Medium, oktober 2026: het pakket dat u koos', price: '12.00', tax_rate_id: '611' }],
};

const NOTE: CreditNoteToPush = {
  reference: 'ownpace-alpha-c-2026-10-medium',
  moneybirdId: null,
  description: 'Herroeping op 3 oktober 2026: 28 van de 31 dagen van factuur {invoice} niet gebruikt, en gecrediteerd',
  numerator: 28,
  denominator: 31,
  credited: {
    reference: 'ownpace-alpha-m-2026-10-medium',
    moneybirdId: '700',
    invoiceNumber: '2026-0007',
    invoiceDate: '2026-10-01',
    taxRateId: '611',
    lines: [{ description: 'Ownpace Medium, oktober 2026: het pakket dat u koos', cents: 1200 }],
  },
  today: '2026-10-03',
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const cents = (price: unknown) => Math.round(Number(price) * 100);
const decimal = (value: number) => (value / 100).toFixed(2);

/**
 * A small Moneybird: the original, the credit invoices it copies, a fill, a
 * send that numbers, and the list, kept between calls, so a second push meets
 * what the first one left.
 */
function moneybird(options: { slowOn?: string; totalsOffBy?: number; copyCorrects?: string } = {}) {
  const invoices = new Map<string, Record<string, unknown>>([[ORIGINAL.id, structuredClone(ORIGINAL)]]);
  const calls: Array<{ method: string; path: string; query: string; body: unknown }> = [];
  let nextId = 800;
  let numbered = 7;
  const totals = (invoice: Record<string, unknown>) => {
    const sum = (invoice.details as Array<{ price: string }>).reduce((t, d) => t + cents(d.price), 0) + (options.totalsOffBy ?? 0);
    invoice.total_price_incl_tax = decimal(sum);
    invoice.total_price_excl_tax = decimal(Math.round((sum * 100) / 121));
  };
  const impl = (async (url: unknown, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const parsed = new URL(String(url));
    const path = parsed.pathname.replace('/api/v2/123456789012345678', '');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, query: decodeURIComponent(parsed.search), body });
    if (options.slowOn && path.includes(options.slowOn)) return json({}, 429, { 'Retry-After': '20' });

    const byReference = /^\/sales_invoices\/find_by_reference\/(.+)\.json$/.exec(path);
    if (byReference) {
      const found = [...invoices.values()].find((i) => i.reference === decodeURIComponent(byReference[1]!));
      return found ? json(found) : json({}, 404);
    }
    const copy = /^\/sales_invoices\/(\d+)\/duplicate_creditinvoice\.json$/.exec(path);
    if (copy && method === 'PATCH') {
      const original = invoices.get(copy[1]!)!;
      const id = String(nextId++);
      const credit: Record<string, unknown> = {
        ...structuredClone(original),
        id,
        invoice_id: null,
        state: 'draft',
        original_sales_invoice_id: options.copyCorrects ?? original.id,
        details: (original.details as Array<Record<string, unknown>>).map((d) => ({
          ...d,
          id: String(nextId++),
          price: decimal(-cents(d.price)),
        })),
      };
      totals(credit);
      invoices.set(id, credit);
      return json(credit);
    }
    if (path === '/sales_invoices.json' && method === 'GET') {
      const filter = parsed.searchParams.get('filter') ?? '';
      const contact = /contact_id:(\d+)/.exec(filter)?.[1];
      return json([...invoices.values()].filter((i) => i.state === 'draft' && i.contact_id === contact));
    }
    const send = /^\/sales_invoices\/(\d+)\/send_invoice\.json$/.exec(path);
    if (send && method === 'PATCH') {
      numbered += 1;
      const sent = { ...invoices.get(send[1]!)!, state: 'open', invoice_id: `2026-000${numbered}`, invoice_date: '2026-10-03' };
      invoices.set(send[1]!, sent);
      return json(sent);
    }
    const one = /^\/sales_invoices\/(\d+)\.json$/.exec(path);
    if (one && method === 'PATCH') {
      const invoice = invoices.get(one[1]!)!;
      const wanted = (body as { sales_invoice: { reference: string; details_attributes: Array<Record<string, unknown>> } })
        .sales_invoice;
      invoice.reference = wanted.reference;
      let details = invoice.details as Array<Record<string, unknown>>;
      for (const change of wanted.details_attributes) {
        if (change._destroy) details = details.filter((d) => d.id !== change.id);
        else details = [...details, { ...change, id: String(nextId++) }];
      }
      invoice.details = details;
      totals(invoice);
      return json(invoice);
    }
    if (one) return invoices.has(one[1]!) ? json(invoices.get(one[1]!)) : json({}, 404);
    return json({ error: `unexpected ${method} ${path}` }, 500);
  }) as typeof fetch;
  const copies = () => calls.filter((c) => c.path.endsWith('/duplicate_creditinvoice.json'));
  const sends = () => calls.filter((c) => c.path.endsWith('/send_invoice.json'));
  const fills = () => calls.filter((c) => c.method === 'PATCH' && /^\/sales_invoices\/\d+\.json$/.test(c.path));
  return { impl, calls, invoices, copies, sends, fills };
}

/** What a run writes down, in the order it happens, beside what it asked Moneybird. */
function writer(events: string[], fail = false) {
  const ids: string[] = [];
  return {
    ids,
    onDraft: async (id: string) => {
      events.push(`written ${id}`);
      if (fail) throw new Error('the database went away');
      ids.push(id);
    },
  };
}

describe('the credit, from the invoice as it was issued', () => {
  it('is the share of its lines, at minus, rounded once', () => {
    expect(creditCents(NOTE.credited, 28, 31)).toBe(-1084);
    expect(creditCents(NOTE.credited, 31, 31)).toBe(-1200);
    expect(() => creditCents(NOTE.credited, 32, 31)).toThrow(/more than the whole/);
  });

  it("names the invoice it corrects, and a reverse charge's evidence again", () => {
    expect(creditWords(NOTE)).toContain('factuur 2026-0007');
    const abroad = {
      ...NOTE,
      credited: {
        ...NOTE.credited,
        lines: [{ description: 'Ownpace Medium, October 2026. Btw verlegd / VAT reverse charged. VIES WAPIAAAAX, 2026-10-01', cents: 992 }],
      },
    };
    expect(creditWords(abroad)).toMatch(/2026-0007 niet gebruikt, en gecrediteerd\. Btw verlegd \/ VAT reverse charged\. VIES WAPIAAAAX, 2026-10-01$/);
  });
});

describe('one credit note pushed', () => {
  it("copies the invoice, writes the copy's id down before filling it, fills one line at the invoice's rate, sends it once", async () => {
    const mb = moneybird();
    const events: string[] = [];
    const write = writer(events);
    const wrapped = (async (url: unknown, init?: RequestInit) => {
      events.push(`${init?.method ?? 'GET'} ${new URL(String(url)).pathname.replace('/api/v2/123456789012345678', '')}`);
      return mb.impl(url as string, init);
    }) as typeof fetch;

    const outcome = await pushCreditNote(SETTINGS, NOTE, write.onDraft, wrapped);

    expect(outcome).toMatchObject({
      kind: 'issued',
      adopted: false,
      line: { cents: -1084 },
      invoice: { invoiceNumber: '2026-0008', originalSalesInvoiceId: '700', totalInclTaxCents: -1084 },
    });
    expect(events).toEqual([
      'GET /sales_invoices/find_by_reference/ownpace-alpha-c-2026-10-medium.json',
      'GET /sales_invoices/700.json',
      'GET /sales_invoices.json',
      'PATCH /sales_invoices/700/duplicate_creditinvoice.json',
      'written 800',
      'PATCH /sales_invoices/800.json',
      'PATCH /sales_invoices/800/send_invoice.json',
      'GET /sales_invoices/800.json',
    ]);
    expect(mb.calls.find((c) => c.path === '/sales_invoices.json')!.query).toContain(
      'state:draft,contact_id:9,period:20261001..20261004',
    );
    expect(mb.fills()[0]!.body).toEqual({
      sales_invoice: {
        reference: 'ownpace-alpha-c-2026-10-medium',
        details_attributes: [
          { id: '801', _destroy: true },
          {
            description: 'Herroeping op 3 oktober 2026: 28 van de 31 dagen van factuur 2026-0007 niet gebruikt, en gecrediteerd',
            price: '-10.84',
            amount: 1,
            tax_rate_id: '611',
          },
        ],
      },
    });
    expect(mb.sends()[0]!.body).toEqual({ sales_invoice_sending: { delivery_method: 'Manual' } });
  });

  it('sends nothing the second time: it reads what was written down, or finds ours by reference, and answers adopted', async () => {
    const mb = moneybird();
    const first = writer([]);
    await pushCreditNote(SETTINGS, NOTE, first.onDraft, mb.impl);
    mb.calls.length = 0;

    const written = await pushCreditNote(SETTINGS, { ...NOTE, moneybirdId: first.ids[0]! }, writer([]).onDraft, mb.impl);
    expect(written).toMatchObject({ kind: 'issued', adopted: true, invoice: { invoiceNumber: '2026-0008' } });
    expect(mb.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /sales_invoices/800.json', 'GET /sales_invoices/800.json']);

    mb.calls.length = 0;
    const again = writer([]);
    const byReference = await pushCreditNote(SETTINGS, NOTE, again.onDraft, mb.impl);
    expect(byReference).toMatchObject({ kind: 'issued', adopted: true });
    expect(again.ids).toEqual(['800']);
    expect(mb.copies()).toEqual([]);
    expect(mb.sends()).toEqual([]);
  });

  it('a run that died after the copy finds it again: one credit invoice in Moneybird in all', async () => {
    const mb = moneybird();
    await expect(pushCreditNote(SETTINGS, NOTE, writer([], true).onDraft, mb.impl)).rejects.toThrow('database went away');
    expect(mb.copies()).toHaveLength(1);
    expect(mb.fills()).toEqual([]);

    const next = writer([]);
    const outcome = await pushCreditNote(SETTINGS, NOTE, next.onDraft, mb.impl);

    expect(outcome).toMatchObject({ kind: 'issued', adopted: false, invoice: { id: '800' } });
    expect(next.ids).toEqual(['800']);
    expect(mb.copies()).toHaveLength(1);
    expect(mb.sends()).toHaveLength(1);
    expect([...mb.invoices.values()].filter((i) => i.original_sales_invoice_id === '700')).toHaveLength(1);
  });

  it('two lost copies are refused by name, and nothing is filled, sent or copied', async () => {
    const mb = moneybird();
    // Two copies nobody wrote down (a dead run adopts its own copy the next
    // time, so two are made by asking for them, as a person might by hand).
    for (let i = 0; i < 2; i++) {
      await mb.impl(`https://moneybird.com/api/v2/${SETTINGS.administrationId}/sales_invoices/700/duplicate_creditinvoice.json`, {
        method: 'PATCH',
        body: '{}',
      });
    }
    mb.calls.length = 0;

    const outcome = await pushCreditNote(SETTINGS, NOTE, writer([]).onDraft, mb.impl);

    expect(outcome).toMatchObject({ kind: 'refused' });
    expect((outcome as { reason: string }).reason).toMatch(/2 draft credit invoices against invoice 2026-0007 \(800, 802\)/);
    expect(mb.copies()).toEqual([]);
    expect(mb.fills()).toEqual([]);
    expect(mb.sends()).toEqual([]);
  });

  it("a draft against the invoice under someone else's reference is not taken", async () => {
    const mb = moneybird();
    await expect(pushCreditNote(SETTINGS, NOTE, writer([], true).onDraft, mb.impl)).rejects.toThrow();
    mb.invoices.get('800')!.reference = 'a-credit-made-by-hand';

    const outcome = await pushCreditNote(SETTINGS, NOTE, writer([]).onDraft, mb.impl);

    expect(outcome).toMatchObject({ kind: 'refused' });
    expect(mb.copies()).toHaveLength(1);
    expect(mb.fills()).toEqual([]);
  });

  it('a filled draft whose total is not the credit stays a draft, and is refused', async () => {
    const mb = moneybird({ totalsOffBy: 1 });
    const outcome = await pushCreditNote(SETTINGS, NOTE, writer([]).onDraft, mb.impl);

    expect(outcome).toMatchObject({ kind: 'refused' });
    expect((outcome as { reason: string }).reason).toContain('its total is -10.83, and it credits -10.84');
    expect(mb.sends()).toEqual([]);
  });

  it('a copy that corrects another invoice is neither written down nor filled', async () => {
    const mb = moneybird({ copyCorrects: '999' });
    const write = writer([]);
    const outcome = await pushCreditNote(SETTINGS, NOTE, write.onDraft, mb.impl);

    expect(outcome).toMatchObject({ kind: 'refused' });
    expect(write.ids).toEqual([]);
    expect(mb.fills()).toEqual([]);

    const named = await pushCreditNote(SETTINGS, { ...NOTE, moneybirdId: '800' }, writer([]).onDraft, mb.impl);
    expect(named).toMatchObject({ kind: 'refused' });
    expect((named as { reason: string }).reason).toContain('corrects 999');
    expect(mb.fills()).toEqual([]);
  });

  it('a 429 is slow_down, and nothing more is asked', async () => {
    const mb = moneybird({ slowOn: 'duplicate_creditinvoice' });
    const outcome = await pushCreditNote(SETTINGS, NOTE, writer([]).onDraft, mb.impl);

    expect(outcome).toMatchObject({ kind: 'slow_down', retryAfterSeconds: 20 });
    expect(mb.calls.at(-1)!.path).toBe('/sales_invoices/700/duplicate_creditinvoice.json');
  });

  it('a share of nothing is not pushed, and Moneybird is asked nothing', async () => {
    const mb = moneybird();
    const outcome = await pushCreditNote(SETTINGS, { ...NOTE, numerator: 0 }, writer([]).onDraft, mb.impl);

    expect(outcome).toMatchObject({ kind: 'refused' });
    expect(mb.calls).toEqual([]);
  });
});
