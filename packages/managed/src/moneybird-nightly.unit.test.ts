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
 *
 * And when Moneybird says try later (E2E (managed) #260, 2026-10-20: the
 * sandbox answered 404 to reading the invoice it had just numbered): the
 * night asks once more, after 30 s or a 429's Retry-After of two minutes or
 * less (a longer one fails the night rather than asking early), and makes,
 * sends and pays nothing twice; a payment whose answer did not come is read,
 * never posted again, and a re-read that shows it paid is the read back; the
 * month is not counted again when a later step asks again; one ask-again a
 * night, with both answers in the lines; a refusal or a wrong state fails at
 * once.
 */

import { describe, it, expect, vi } from 'vitest';
import { nightlyMoneybird, nightlyReference, NIGHTLY_MONTH_LIMIT, type NightlyOptions } from './moneybird-nightly.ts';
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
 * A request the sandbox answers wrongly for a while, as Moneybird's did on
 * 2026-10-20: `GET /sales_invoices/700.json` answering 404 just after the send.
 */
interface Fault {
  /** The method and the path after the administration: `GET /sales_invoices/700.json`. */
  readonly request: string;
  readonly status: number;
  /** How many of those requests answer so; one when not said. */
  readonly times?: number;
  /** How many of those requests are answered as they should be first; none when not said. */
  readonly after?: number;
  /** A 429's `Retry-After`. */
  readonly retryAfter?: string;
  /** The sandbox does the work and only its answer goes wrong: a payment Moneybird did register. */
  readonly afterTheWork?: boolean;
}

/**
 * A sandbox holding `alreadyThisMonth` invoices from earlier, plus whatever
 * the night makes; a payment marks an invoice paid unless `payment` says
 * otherwise; each of `faults` answers wrongly while it lasts.
 */
function sandbox(
  options: { alreadyThisMonth?: number; payment?: 'refused' | 'ignored'; faults?: readonly Fault[] } = {},
) {
  const earlier = Array.from({ length: options.alreadyThisMonth ?? 3 }, (_, i) => ({ id: `e${i}`, state: 'paid' }));
  const invoices = new Map<string, Record<string, unknown>>();
  const contacts: Record<string, unknown>[] = [];
  const calls: Array<{ method: string; path: string; query: string; body: unknown }> = [];
  const seen = new Map<string, number>();
  const impl = (async (url: unknown, init?: RequestInit) => {
    const parsed = new URL(String(url));
    const method = init?.method ?? 'GET';
    const path = parsed.pathname.replace('/api/v2/123456789012345678', '');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, query: parsed.search, body });

    const request = `${method} ${path}`;
    const nth = seen.get(request) ?? 0;
    seen.set(request, nth + 1);
    const fault = options.faults?.find(
      (f) => f.request === request && nth >= (f.after ?? 0) && nth < (f.after ?? 0) + (f.times ?? 1),
    );
    if (!fault) return answer(method, path, parsed, body);
    if (fault.afterTheWork) await answer(method, path, parsed, body);
    return new Response(JSON.stringify({ error: 'try again later' }), {
      status: fault.status,
      headers: {
        'Content-Type': 'application/json',
        ...(fault.retryAfter === undefined ? {} : { 'Retry-After': fault.retryAfter }),
      },
    });
  }) as typeof fetch;

  async function answer(method: string, path: string, parsed: URL, body: unknown): Promise<Response> {
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
  }
  /** What the night wrote, in order: each POST and PATCH. */
  const writes = () => calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`);
  return { impl, calls, invoices, writes };
}

function noToken(lines: readonly string[]): void {
  for (const line of lines) expect(line).not.toContain(TOKEN);
}

/** A clock that waits no time and keeps how long the night asked to wait. */
function instant(): NightlyOptions & { waits: number[] } {
  const waits: number[] = [];
  return {
    waits,
    wait: async (ms: number) => {
      waits.push(ms);
    },
  };
}

/** Everything a night that makes, sends and pays its invoice once writes. */
const MADE_SENT_PAID_ONCE = [
  'POST /contacts.json',
  'POST /sales_invoices.json',
  'PATCH /sales_invoices/700/send_invoice.json',
  'POST /sales_invoices/700/payments.json',
];

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

describe('when Moneybird says try later', () => {
  const NOT_READ = 'Moneybird answered HTTP 404 to reading invoice 700';

  it('asks once more when the invoice it just sent does not read yet, and makes, sends and pays it once (#260)', async () => {
    const books = sandbox({ faults: [{ request: 'GET /sales_invoices/700.json', status: 404 }] });
    const clock = instant();
    const night = await nightlyMoneybird(NIGHTLY, TONIGHT, books.impl, clock);

    expect(night).toEqual({
      ok: true,
      skipped: false,
      lines: [
        `The night's invoice did not go through (unavailable): ${NOT_READ}; asked again after 30 s.`,
        "Found tonight's invoice 2026-0004 (ownpace-nightly-2026-10-10), made before the night asked again.",
        'Registered a payment of €1.00 on 2026-10-10.',
        'Read back as paid.',
      ],
    });
    expect(clock.waits).toEqual([30_000]);
    expect(books.writes()).toEqual(MADE_SENT_PAID_ONCE);
    noToken(night.lines);
  });

  it('fails the night with both answers when the second ask does not read it either, having paid nothing', async () => {
    const books = sandbox({ faults: [{ request: 'GET /sales_invoices/700.json', status: 404, times: 2 }] });
    const clock = instant();
    const night = await nightlyMoneybird(NIGHTLY, TONIGHT, books.impl, clock);

    expect(night).toEqual({
      ok: false,
      skipped: false,
      lines: [
        `The night's invoice did not go through (unavailable): ${NOT_READ}; asked again after 30 s.`,
        `The night's invoice did not go through (unavailable): ${NOT_READ}.`,
      ],
    });
    expect(clock.waits).toEqual([30_000]);
    expect(books.writes()).toEqual(MADE_SENT_PAID_ONCE.slice(0, 3));
    noToken(night.lines);
  });

  it('reads the invoice once more when it does not read back after the payment, and pays once', async () => {
    const books = sandbox({ faults: [{ request: 'GET /sales_invoices/700.json', status: 404, after: 1 }] });
    const clock = instant();
    const night = await nightlyMoneybird(NIGHTLY, TONIGHT, books.impl, clock);

    expect(night).toEqual({
      ok: true,
      skipped: false,
      lines: [
        'Made invoice 2026-0004 (ownpace-nightly-2026-10-10), dated 2026-10-10, sent by hand.',
        'Registered a payment of €1.00 on 2026-10-10.',
        `It could not be read back (unavailable): ${NOT_READ}; asked again after 30 s.`,
        'Read back as paid.',
      ],
    });
    expect(clock.waits).toEqual([30_000]);
    expect(books.writes()).toEqual(MADE_SENT_PAID_ONCE);
  });

  it('never posts a payment twice: one Moneybird did register, though it answered 500, reads as paid', async () => {
    const books = sandbox({
      faults: [{ request: 'POST /sales_invoices/700/payments.json', status: 500, afterTheWork: true }],
    });
    const clock = instant();
    const night = await nightlyMoneybird(NIGHTLY, TONIGHT, books.impl, clock);

    expect(night).toEqual({
      ok: true,
      skipped: false,
      lines: [
        'Made invoice 2026-0004 (ownpace-nightly-2026-10-10), dated 2026-10-10, sent by hand.',
        'The payment was not confirmed (unavailable): Moneybird answered HTTP 500 to the payment; ' +
          'read the invoice again after 30 s instead of paying again.',
        'It reads as paid: Moneybird registered the payment after all, so none was posted again.',
        'Read back as paid.',
      ],
    });
    expect(clock.waits).toEqual([30_000]);
    expect(books.writes()).toEqual(MADE_SENT_PAID_ONCE);
    noToken(night.lines);
  });

  it('never posts a payment twice: one Moneybird did not register fails the night, still to pay', async () => {
    const books = sandbox({ faults: [{ request: 'POST /sales_invoices/700/payments.json', status: 503 }] });
    const clock = instant();
    const night = await nightlyMoneybird(NIGHTLY, TONIGHT, books.impl, clock);

    expect(night.ok).toBe(false);
    expect(night.lines.slice(1)).toEqual([
      'The payment was not confirmed (unavailable): Moneybird answered HTTP 503 to the payment; ' +
        'read the invoice again after 30 s instead of paying again.',
      'It reads as open, with €1.00 still to pay. The payment is not posted again: nothing is paid twice.',
    ]);
    expect(clock.waits).toEqual([30_000]);
    expect(books.writes()).toEqual(MADE_SENT_PAID_ONCE);
    expect(books.invoices.get('700')!.state).toBe('open');
  });

  it.each([
    ['its Retry-After', '45', 45_000, '45 s'],
    ['its Retry-After of exactly two minutes', '120', 120_000, '120 s'],
    ['30 s when it gives none', undefined, 30_000, '30 s'],
  ])('waits, after a 429, %s', async (_case, retryAfter, ms, said) => {
    const books = sandbox({
      faults: [{ request: 'GET /sales_invoices.json', status: 429, ...(retryAfter ? { retryAfter } : {}) }],
    });
    const clock = instant();
    const night = await nightlyMoneybird(NIGHTLY, TONIGHT, books.impl, clock);

    expect(night.ok).toBe(true);
    expect(night.lines[0]).toMatch(/^The month's invoices could not be counted \(slow_down\): Moneybird asks us to slow down/);
    expect(night.lines[0]).toMatch(new RegExp(`; asked again after ${said}\\.$`));
    expect(night.lines.slice(1)).toEqual([
      'Made invoice 2026-0004 (ownpace-nightly-2026-10-10), dated 2026-10-10, sent by hand.',
      'Registered a payment of €1.00 on 2026-10-10.',
      'Read back as paid.',
    ]);
    expect(clock.waits).toEqual([ms]);
    expect(books.writes()).toEqual(MADE_SENT_PAID_ONCE);
  });

  it('does not ask early when a 429 asks for more than two minutes: the night fails at once, asked once', async () => {
    const books = sandbox({ faults: [{ request: 'GET /sales_invoices.json', status: 429, retryAfter: '600' }] });
    const clock = instant();
    const night = await nightlyMoneybird(NIGHTLY, TONIGHT, books.impl, clock);

    expect(night).toEqual({
      ok: false,
      skipped: false,
      lines: [
        "The month's invoices could not be counted (slow_down): Moneybird asks us to slow down " +
          '(HTTP 429; at most 150 requests per 5 minutes per administration) — ask again in 600 s.',
      ],
    });
    expect(clock.waits).toEqual([]);
    expect(books.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /sales_invoices.json']);
  });

  it('never posts a payment twice: one answered with a 429 is read after its Retry-After, not posted again', async () => {
    const books = sandbox({
      faults: [{ request: 'POST /sales_invoices/700/payments.json', status: 429, retryAfter: '45' }],
    });
    const clock = instant();
    const night = await nightlyMoneybird(NIGHTLY, TONIGHT, books.impl, clock);

    expect(night.ok).toBe(false);
    expect(night.lines.slice(1)).toEqual([
      'The payment was not confirmed (slow_down): Moneybird asks us to slow down ' +
        '(HTTP 429; at most 150 requests per 5 minutes per administration) — ask again in 45 s; ' +
        'read the invoice again after 45 s instead of paying again.',
      'It reads as open, with €1.00 still to pay. The payment is not posted again: nothing is paid twice.',
    ]);
    expect(clock.waits).toEqual([45_000]);
    expect(books.writes()).toEqual(MADE_SENT_PAID_ONCE);
    expect(books.invoices.get('700')!.state).toBe('open');
  });

  it('never posts a payment twice: one Moneybird did register, though it answered 429, reads as paid', async () => {
    const books = sandbox({
      faults: [{ request: 'POST /sales_invoices/700/payments.json', status: 429, retryAfter: '45', afterTheWork: true }],
    });
    const clock = instant();
    const night = await nightlyMoneybird(NIGHTLY, TONIGHT, books.impl, clock);

    expect(night.ok).toBe(true);
    expect(night.lines.slice(-2)).toEqual([
      'It reads as paid: Moneybird registered the payment after all, so none was posted again.',
      'Read back as paid.',
    ]);
    expect(clock.waits).toEqual([45_000]);
    expect(books.writes()).toEqual(MADE_SENT_PAID_ONCE);
  });

  it("takes a re-read that shows the payment after all as the read back: a lag after it cannot paint the night red", async () => {
    // The third read of the invoice, after the push's and the re-read, would answer 404.
    const books = sandbox({
      faults: [
        { request: 'POST /sales_invoices/700/payments.json', status: 500, afterTheWork: true },
        { request: 'GET /sales_invoices/700.json', status: 404, after: 2 },
      ],
    });
    const clock = instant();
    const night = await nightlyMoneybird(NIGHTLY, TONIGHT, books.impl, clock);

    expect(night).toEqual({
      ok: true,
      skipped: false,
      lines: [
        'Made invoice 2026-0004 (ownpace-nightly-2026-10-10), dated 2026-10-10, sent by hand.',
        'The payment was not confirmed (unavailable): Moneybird answered HTTP 500 to the payment; ' +
          'read the invoice again after 30 s instead of paying again.',
        'It reads as paid: Moneybird registered the payment after all, so none was posted again.',
        'Read back as paid.',
      ],
    });
    expect(clock.waits).toEqual([30_000]);
    expect(books.writes()).toEqual(MADE_SENT_PAID_ONCE);
    expect(books.calls.filter((c) => c.method === 'GET' && c.path === '/sales_invoices/700.json')).toHaveLength(2);
  });

  it('fails the night when the re-read after a payment without an answer does not answer either', async () => {
    const books = sandbox({
      faults: [
        { request: 'POST /sales_invoices/700/payments.json', status: 500, afterTheWork: true },
        { request: 'GET /sales_invoices/700.json', status: 404, after: 1 },
      ],
    });
    const clock = instant();
    const night = await nightlyMoneybird(NIGHTLY, TONIGHT, books.impl, clock);

    expect(night.ok).toBe(false);
    expect(night.lines.slice(1)).toEqual([
      'The payment was not confirmed (unavailable): Moneybird answered HTTP 500 to the payment; ' +
        'read the invoice again after 30 s instead of paying again.',
      `It could not be read again (unavailable): ${NOT_READ}.`,
    ]);
    expect(clock.waits).toEqual([30_000]);
    expect(books.writes()).toEqual(MADE_SENT_PAID_ONCE);
  });

  it(`does not count the month again when a later step asks again: the ${NIGHTLY_MONTH_LIMIT}th invoice is still paid`, async () => {
    // Counted 39, made the 40th, then its read back lagged: a second count
    // would read 40 and skip, leaving tonight's invoice made but never paid.
    const books = sandbox({
      alreadyThisMonth: NIGHTLY_MONTH_LIMIT - 1,
      faults: [{ request: 'GET /sales_invoices/700.json', status: 404 }],
    });
    const clock = instant();
    const night = await nightlyMoneybird(NIGHTLY, TONIGHT, books.impl, clock);

    expect(night).toMatchObject({ ok: true, skipped: false });
    expect(night.lines.at(-1)).toBe('Read back as paid.');
    expect(clock.waits).toEqual([30_000]);
    expect(books.writes()).toEqual(MADE_SENT_PAID_ONCE);
    expect(books.calls.filter((c) => c.method === 'GET' && c.path === '/sales_invoices.json')).toHaveLength(1);
  });

  it('asks again once a night at most: a payment whose answer did not come after that fails, posted once', async () => {
    const books = sandbox({
      faults: [
        { request: 'GET /sales_invoices/700.json', status: 404 },
        { request: 'POST /sales_invoices/700/payments.json', status: 500, afterTheWork: true },
      ],
    });
    const clock = instant();
    const night = await nightlyMoneybird(NIGHTLY, TONIGHT, books.impl, clock);

    expect(night).toEqual({
      ok: false,
      skipped: false,
      lines: [
        `The night's invoice did not go through (unavailable): ${NOT_READ}; asked again after 30 s.`,
        "Found tonight's invoice 2026-0004 (ownpace-nightly-2026-10-10), made before the night asked again.",
        'The payment was not confirmed (unavailable): Moneybird answered HTTP 500 to the payment.',
      ],
    });
    expect(clock.waits).toEqual([30_000]);
    expect(books.writes()).toEqual(MADE_SENT_PAID_ONCE);
  });

  it('asks again once a night at most: a read back after that fails with both answers', async () => {
    const books = sandbox({
      faults: [
        { request: 'GET /sales_invoices.json', status: 503 },
        { request: 'GET /sales_invoices/700.json', status: 404, after: 1 },
      ],
    });
    const clock = instant();
    const night = await nightlyMoneybird(NIGHTLY, TONIGHT, books.impl, clock);

    expect(night.ok).toBe(false);
    expect(night.lines[0]).toBe(
      "The month's invoices could not be counted (unavailable): Moneybird answered HTTP 503; asked again after 30 s.",
    );
    expect(night.lines.at(-1)).toBe(`It could not be read back (unavailable): ${NOT_READ}.`);
    expect(clock.waits).toEqual([30_000]);
    expect(books.writes()).toEqual(MADE_SENT_PAID_ONCE);
  });

  it.each([
    ['a refused payment', { payment: 'refused' as const }, /^The payment was not registered \(refused\)/, 1],
    ['an invoice that does not read back as paid', { payment: 'ignored' as const }, /^It reads back as open, not paid\.$/, 1],
    [
      'an invoice Moneybird refuses to make',
      { faults: [{ request: 'POST /sales_invoices.json', status: 422 }] },
      /^The night's invoice did not go through \(refused\): Moneybird refused the invoice as invalid/,
      0,
    ],
  ])('fails at once, without asking again, on %s', async (_case, options, said, payments) => {
    const books = sandbox(options);
    const clock = instant();
    const night = await nightlyMoneybird(NIGHTLY, TONIGHT, books.impl, clock);

    expect(night.ok).toBe(false);
    expect(night.lines.at(-1)).toMatch(said);
    expect(clock.waits).toEqual([]);
    expect(books.writes().filter((w) => w.endsWith('/payments.json'))).toHaveLength(payments);
    expect(night.lines.join('\n')).not.toMatch(/asked again|read the invoice again/);
    noToken(night.lines);
  });

  it('refuses a half-configured stack at once: no request, no wait', async () => {
    const books = sandbox();
    const clock = instant();
    const { MONEYBIRD_WORKFLOW_ID: _left, ...half } = NIGHTLY;
    const night = await nightlyMoneybird(half, TONIGHT, books.impl, clock);

    expect(night.ok).toBe(false);
    expect(night.lines).toEqual([expect.stringMatching(/^No nightly invoice\. Moneybird is half configured: MONEYBIRD_WORKFLOW_ID is not set/)]);
    expect(books.calls).toEqual([]);
    expect(clock.waits).toEqual([]);
    noToken(night.lines);
  });

  it('waits on a timer when no clock is given: 30 s, and not a moment less', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const books = sandbox({ faults: [{ request: 'GET /sales_invoices/700.json', status: 404 }] });
      let done = false;
      const running = nightlyMoneybird(NIGHTLY, TONIGHT, books.impl).then((night) => {
        done = true;
        return night;
      });
      for (let turn = 0; turn < 1000 && vi.getTimerCount() === 0; turn += 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(29_999);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect((await running).lines.at(-1)).toBe('Read back as paid.');
    } finally {
      vi.useRealTimers();
    }
  });
});
