// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DRAFT PUSHED ONCE (workplan 0111, slice 5): the wiring half of
 * `managed-invoice-push`, as the hourly run asks it of one organisation
 * (`pushOrganisation`), on a database and a Moneybird of the test's own.
 *
 *  - a domestic consumer's draft is numbered and written back: `sent`, with
 *    Moneybird's number, date, due date and figures; the next run finds
 *    nothing to push and asks Moneybird nothing;
 *  - a reverse-charge business's draft goes at the price without the Dutch
 *    VAT in it, its line ending with VIES's evidence;
 *  - an organisation without invoice details asks Moneybird nothing, keeps
 *    its draft, and is said as an error; a draft two days old is said behind;
 *  - a 429 stops the run where it is, and the draft waits for the next.
 *
 * PGlite as `app_user`. The names, addresses, numbers and token are invented,
 * and nothing is contacted: Moneybird here is a function.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { pgliteDriver, runMigrations, withTenant, type LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations, type MoneybirdSettings, type PushContext } from '@openmig/managed';
import { log } from '@openmig/shared';
import { pushOrganisation, type PushBudget, type PushCounts } from './managed-invoice-push.ts';

const SETTINGS: MoneybirdSettings = {
  apiToken: 'not-a-real-token',
  administrationId: '123456789012345678',
  workflowId: '702',
  taxRates: { domesticStandard: '611', reverseCharge: '622', outsideEu: null },
  delivery: 'manual',
};
const CONTEXT: PushContext = { sellerCountry: 'NL', ossActive: false, delivery: 'manual' };

const RATES = [
  { id: '611', name: '21% btw', percentage: '21.0', tax_rate_type: 'sales_invoice', active: true, country: null },
  { id: '622', name: 'Dienst binnen EU (btw verlegd)', percentage: null, tax_rate_type: 'sales_invoice', active: true },
];

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

/** Moneybird's ids and numbers are its own, and never repeat within an administration. */
let nextId = 555;
let numbered = 0;

/** A small Moneybird: rates, contacts and invoices, kept between calls, numbering what it sends. */
function moneybird(options: { slowOn?: string } = {}) {
  const invoices = new Map<string, Record<string, unknown>>();
  const contacts: Record<string, unknown>[] = [];
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = new URL(String(url)).pathname.replace('/api/v2/123456789012345678', '');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    if (options.slowOn && path.includes(options.slowOn)) return json({}, 429, { 'Retry-After': '20' });
    if (path === '/tax_rates.json') return json(RATES);
    if (path === '/contacts.json' && method === 'GET') return json(contacts);
    if (path === '/contacts.json' && method === 'POST') {
      const contact = { id: String(9 + contacts.length), ...(body as { contact: object }).contact };
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
      const lines = wanted.details_attributes as Array<{ price: string; tax_rate_id: string }>;
      const sum = lines.reduce((total, line) => total + Math.round(Number(line.price) * 100), 0);
      const domestic = lines.every((line) => line.tax_rate_id === '611');
      const incl = wanted.prices_are_incl_tax ? sum : domestic ? Math.round(sum * 1.21) : sum;
      const excl = wanted.prices_are_incl_tax ? Math.round((sum * 100) / 121) : sum;
      const id = String(nextId++);
      const invoice = {
        id,
        invoice_id: null,
        state: 'draft',
        reference: wanted.reference,
        contact_id: wanted.contact_id,
        prices_are_incl_tax: wanted.prices_are_incl_tax,
        total_price_incl_tax: (incl / 100).toFixed(2),
        total_price_excl_tax: (excl / 100).toFixed(2),
      };
      invoices.set(id, invoice);
      return json(invoice, 201);
    }
    const send = /^\/sales_invoices\/(\d+)\/send_invoice\.json$/.exec(path);
    if (send && method === 'PATCH') {
      numbered += 1;
      const sent = {
        ...invoices.get(send[1]!)!,
        state: 'open',
        invoice_id: `2026-000${numbered}`,
        invoice_date: '2026-10-01',
        due_date: '2026-10-15',
      };
      invoices.set(send[1]!, sent);
      return json(sent);
    }
    const one = /^\/sales_invoices\/(\d+)\.json$/.exec(path);
    if (one) return json(invoices.get(one[1]!));
    return json({ error: `unexpected ${method} ${path}` }, 500);
  }) as typeof fetch;
  return { impl, calls, invoices };
}

// UUID family 0111e000-…, unused elsewhere in the repo.
const AT_HOME = '0111e000-e29b-41d4-a716-446655440001';
const ABROAD = '0111e000-e29b-41d4-a716-446655440002';
const NO_DETAILS = '0111e000-e29b-41d4-a716-446655440003';
const OCT_1 = new Date('2026-10-01T00:41:00Z');

describe("one organisation's drafts, pushed as the hourly run pushes them", () => {
  let driver: LedgerDriver;
  const pool = () => driver as unknown as Pool;
  const noPace = { pace: async () => {} };

  async function owner(statement: string, params: unknown[] = []): Promise<void> {
    const conn = await driver.acquire();
    try {
      await conn.query(statement, params);
    } finally {
      await conn.release();
    }
  }

  const draft = (tenantId: string, tier: string, createdAt = '2026-10-01T00:23:00Z') =>
    owner(
      `INSERT INTO invoice (tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total,
                            reference, evidence, lines, created_at)
       VALUES ($1, '2026-10-01', '2026-10-31', 'draft', 12, 0, 0, 12, $2, '{"cents": 1200}'::jsonb,
               '[{"description": "Ownpace Medium, oktober 2026: het pakket dat u koos", "publishedCents": 1200}]'::jsonb, $3)`,
      [tenantId, `ownpace-${tenantId}-m-2026-10-${tier}`, createdAt],
    );

  const rowsOf = (tenantId: string) =>
    withTenant(driver, tenantId, async (db) => {
      const result = await db.execute(
        sql`SELECT reference, status, invoice_number, due_date::text AS due_date, total::text AS total,
                   subtotal::text AS subtotal, vat_treatment, lines
              FROM invoice WHERE tenant_id = ${tenantId} ORDER BY reference`,
      );
      return (result as unknown as { rows: Record<string, unknown>[] }).rows;
    });

  const fresh = (): { budget: PushBudget; counts: PushCounts } => ({
    budget: { left: 60, stopped: false },
    counts: { issued: 0, adopted: 0, refused: 0, unavailable: 0, slowed: 0 },
  });

  beforeAll(async () => {
    driver = pgliteDriver({ role: 'app_user' });
    await runMigrations({ driver, logger: () => {} });
    await runManagedMigrations({ driver, logger: () => {} });
    await owner(`INSERT INTO tenant (id, name) VALUES ($1, 'At Home'), ($2, 'Abroad GmbH'), ($3, 'No Details BV')`, [
      AT_HOME,
      ABROAD,
      NO_DETAILS,
    ]);
    await owner(
      `INSERT INTO billing_party (tenant_id, kind, name, address_line1, postal_code, city, country_code)
       VALUES ($1, 'consumer', 'Sam de Vries', 'Dorpsstraat 1', '1234 AB', 'Ons Dorp', 'NL')`,
      [AT_HOME],
    );
    await owner(
      `INSERT INTO billing_party (tenant_id, kind, name, address_line1, postal_code, city, country_code, vat_number)
       VALUES ($1, 'business', 'Abroad GmbH', 'Hauptstrasse 1', '10115', 'Berlin', 'DE', 'DE123456789')`,
      [ABROAD],
    );
    await owner(
      `INSERT INTO vat_consultation (tenant_id, country_code, vat_number, valid, request_date, consultation_number)
       VALUES ($1, 'DE', '123456789', true, '2026-09-30', 'WAPIAAAAW1zZ3AbC')`,
      [ABROAD],
    );
    await draft(AT_HOME, 'medium');
    await draft(ABROAD, 'medium');
    await draft(NO_DETAILS, 'medium', '2026-09-28T00:23:00Z');
  }, 120_000);

  afterAll(async () => {
    await driver?.end();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("numbers a domestic consumer's draft and writes it back, sent", async () => {
    const books = moneybird();
    const { budget, counts } = fresh();
    await pushOrganisation(pool(), AT_HOME, OCT_1, SETTINGS, CONTEXT, budget, counts, { fetchImpl: books.impl, ...noPace });
    expect(counts).toEqual({ issued: 1, adopted: 0, refused: 0, unavailable: 0, slowed: 0 });
    expect(await rowsOf(AT_HOME)).toEqual([
      {
        reference: `ownpace-${AT_HOME}-m-2026-10-medium`,
        status: 'sent',
        invoice_number: '2026-0001',
        due_date: '2026-10-15',
        total: '1200',
        subtotal: '992',
        vat_treatment: 'domestic_standard',
        lines: [{ description: 'Ownpace Medium, oktober 2026: het pakket dat u koos', publishedCents: 1200, cents: 1200 }],
      },
    ]);
    // The next hour: nothing to push, and Moneybird is asked nothing.
    const again = fresh();
    const quiet = moneybird();
    await pushOrganisation(pool(), AT_HOME, new Date('2026-10-01T01:41:00Z'), SETTINGS, CONTEXT, again.budget, again.counts, {
      fetchImpl: quiet.impl,
      ...noPace,
    });
    expect(again.counts.issued).toBe(0);
    expect(quiet.calls).toEqual([]);
  });

  it("sends a reverse-charge business's draft without the Dutch VAT, saying VIES's evidence", async () => {
    const books = moneybird();
    const { budget, counts } = fresh();
    await pushOrganisation(pool(), ABROAD, OCT_1, SETTINGS, CONTEXT, budget, counts, { fetchImpl: books.impl, ...noPace });
    expect(counts.issued).toBe(1);
    const create = books.calls.find((c) => c.path === '/sales_invoices.json')!;
    expect(create.body).toMatchObject({
      sales_invoice: {
        prices_are_incl_tax: false,
        details_attributes: [
          {
            price: '9.92',
            tax_rate_id: '622',
            description:
              'Ownpace Medium, oktober 2026: het pakket dat u koos. ' +
              'Btw verlegd / VAT reverse charged. VIES WAPIAAAAW1zZ3AbC, 2026-09-30',
          },
        ],
      },
    });
    const [row] = await rowsOf(ABROAD);
    expect(row).toMatchObject({ status: 'sent', vat_treatment: 'reverse_charge', total: '992', subtotal: '992' });
  });

  it('asks Moneybird nothing for an organisation without invoice details, keeps its draft, and says so', async () => {
    const errors = vi.spyOn(log, 'error').mockImplementation(() => {});
    const books = moneybird();
    const { budget, counts } = fresh();
    await pushOrganisation(pool(), NO_DETAILS, OCT_1, SETTINGS, CONTEXT, budget, counts, { fetchImpl: books.impl, ...noPace });
    expect(counts).toMatchObject({ issued: 0, refused: 1 });
    expect(books.calls).toEqual([]);
    expect((await rowsOf(NO_DETAILS))[0]).toMatchObject({ status: 'draft', invoice_number: null });
    const said = errors.mock.calls.map((c) => String(c[0]));
    expect(said.some((line) => line.includes('has given no invoice details'))).toBe(true);
    // Made on 28 September and still a draft on 1 October: behind, by its reference.
    expect(said.some((line) => line.includes('still drafts two days after') && line.includes(`ownpace-${NO_DETAILS}-m-2026-10-medium`))).toBe(true);
  });

  it('stops the run where it is on a 429, and the draft waits for the next', async () => {
    await draft(AT_HOME, 'large');
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    const books = moneybird({ slowOn: '/tax_rates.json' });
    const { budget, counts } = fresh();
    await pushOrganisation(pool(), AT_HOME, new Date('2026-10-02T00:41:00Z'), SETTINGS, CONTEXT, budget, counts, {
      fetchImpl: books.impl,
      ...noPace,
    });
    expect(counts.slowed).toBe(1);
    expect(budget.stopped).toBe(true);
    const large = (await rowsOf(AT_HOME)).find((r) => String(r.reference).endsWith('-large'));
    expect(large).toMatchObject({ status: 'draft' });
  });
});
