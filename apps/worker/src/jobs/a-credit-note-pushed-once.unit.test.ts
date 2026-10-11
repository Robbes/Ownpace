// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CREDIT NOTE PUSHED ONCE (workplan 0111, T7, slice 7a): the wiring half,
 * as the hourly run asks it of one organisation (`pushOrganisation`), on a
 * database and a Moneybird of the test's own.
 *
 *  - a credit note recorded while its invoice is still a draft waits for it,
 *    and the run that numbers the invoice then numbers the credit note: the
 *    copy Moneybird makes of the invoice, filled with the share credited and
 *    sent, written back `sent`, negative, crediting the invoice's number;
 *  - the next run finds nothing to push and asks Moneybird nothing;
 *  - a run that writes to another administration than the invoice's is
 *    refused by name, and Moneybird is asked nothing about the credit note.
 *
 * PGlite as `app_user`. The names, addresses and token are invented, and
 * nothing is contacted: Moneybird here is a function.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { pgliteDriver, runMigrations, withTenant, type LedgerDriver } from '@openmig/ledger';
import { recordCreditNote, runManagedMigrations, type MoneybirdSettings, type PushContext } from '@openmig/managed';
import { log, type TenantId } from '@openmig/shared';
import { pushOrganisation, type PushBudget, type PushCounts } from './managed-invoice-push.ts';

const SETTINGS: MoneybirdSettings = {
  apiToken: 'not-a-real-token',
  administrationId: '123456789012345678',
  workflowId: '702',
  taxRates: { domesticStandard: '611', reverseCharge: '622', outsideEu: null },
  delivery: 'manual',
  mollieAccountId: null,
};
const CONTEXT: PushContext = { sellerCountry: 'NL', ossActive: false, delivery: 'manual' };
const RATES = [{ id: '611', name: '21% btw', percentage: '21.0', tax_rate_type: 'sales_invoice', active: true, country: null }];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const cents = (price: unknown) => Math.round(Number(price) * 100);
const decimal = (value: number) => (value / 100).toFixed(2);

/** A small Moneybird: invoices made, sent and numbered, and credit invoices copied, filled and sent. */
function moneybird() {
  const invoices = new Map<string, Record<string, unknown>>();
  const contacts: Record<string, unknown>[] = [];
  const calls: Array<{ method: string; path: string }> = [];
  let nextId = 700;
  let numbered = 6;
  const totals = (invoice: Record<string, unknown>) => {
    const sum = (invoice.details as Array<{ price: string }>).reduce((t, d) => t + cents(d.price), 0);
    invoice.total_price_incl_tax = decimal(sum);
    invoice.total_price_excl_tax = decimal(Math.round((sum * 100) / 121));
  };
  const impl = (async (url: unknown, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const parsed = new URL(String(url));
    const path = parsed.pathname.replace('/api/v2/123456789012345678', '');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path });
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
      const id = String(nextId++);
      const invoice: Record<string, unknown> = {
        id,
        invoice_id: null,
        state: 'draft',
        reference: wanted.reference,
        contact_id: wanted.contact_id,
        prices_are_incl_tax: wanted.prices_are_incl_tax,
        original_sales_invoice_id: null,
        details: (wanted.details_attributes as Array<Record<string, unknown>>).map((d) => ({ ...d, id: String(nextId++) })),
      };
      totals(invoice);
      invoices.set(id, invoice);
      return json(invoice, 201);
    }
    if (path === '/sales_invoices.json' && method === 'GET') {
      const contact = /contact_id:(\d+)/.exec(parsed.searchParams.get('filter') ?? '')?.[1];
      return json([...invoices.values()].filter((i) => i.state === 'draft' && i.contact_id === contact));
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
        original_sales_invoice_id: original.id,
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
    const send = /^\/sales_invoices\/(\d+)\/send_invoice\.json$/.exec(path);
    if (send && method === 'PATCH') {
      numbered += 1;
      const sent = {
        ...invoices.get(send[1]!)!,
        state: 'open',
        invoice_id: `2026-000${numbered}`,
        invoice_date: '2026-10-03',
        due_date: '2026-10-17',
      };
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
        details = change._destroy ? details.filter((d) => d.id !== change.id) : [...details, { ...change, id: String(nextId++) }];
      }
      invoice.details = details;
      totals(invoice);
      return json(invoice);
    }
    if (one) return json(invoices.get(one[1]!));
    return json({ error: `unexpected ${method} ${path}` }, 500);
  }) as typeof fetch;
  return { impl, calls };
}

// UUID family 01117b00-…, unused elsewhere in the repo.
const ORG = '01117b00-e29b-41d4-a716-446655440001' as TenantId;
const ELSEWHERE = '01117b00-e29b-41d4-a716-446655440002' as TenantId;
const OCT_3 = new Date('2026-10-03T10:41:00Z');
const DESCRIPTION = 'Herroeping op 3 oktober 2026: 28 van de 31 dagen van factuur {invoice} niet gebruikt, en gecrediteerd';

describe('a credit note pushed as the hourly run pushes it', () => {
  let driver: LedgerDriver;
  const pool = () => driver as unknown as Pool;
  const noPace = { pace: async () => {} };

  async function owner(statement: string, params: unknown[] = []) {
    const conn = await driver.acquire();
    try {
      return await conn.query(statement, params);
    } finally {
      await conn.release();
    }
  }

  const draft = (tenantId: string) =>
    owner(
      `INSERT INTO invoice (tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total,
                            reference, evidence, lines, created_at)
       VALUES ($1, '2026-10-01', '2026-10-31', 'draft', 1200, 0, 0, 1200, $2, '{"cents": 1200}'::jsonb,
               '[{"description": "Ownpace Medium, oktober 2026: het pakket dat u koos", "publishedCents": 1200}]'::jsonb,
               '2026-10-03T10:23:00Z')
       RETURNING id`,
      [tenantId, `ownpace-${tenantId}-m-2026-10-medium`],
    );

  const rowsOf = (tenantId: string) =>
    withTenant(driver, tenantId, async (db) => {
      const result = await db.execute(
        sql`SELECT reference, kind, status, invoice_number, total::text AS total, lines
              FROM invoice WHERE tenant_id = ${tenantId} ORDER BY created_at, reference`,
      );
      return (result as unknown as { rows: Record<string, unknown>[] }).rows;
    });

  const fresh = (): { budget: PushBudget; counts: PushCounts } => ({
    budget: { left: 60, stopped: false },
    counts: { issued: 0, credited: 0, adopted: 0, booked: 0, held: 0, refused: 0, unavailable: 0, slowed: 0 },
  });

  beforeAll(async () => {
    driver = pgliteDriver({ role: 'app_user' });
    await runMigrations({ driver, logger: () => {} });
    await runManagedMigrations({ driver, logger: () => {} });
    await owner(`INSERT INTO tenant (id, name) VALUES ($1, 'Withdraws'), ($2, 'Issued Elsewhere')`, [ORG, ELSEWHERE]);
    for (const tenant of [ORG, ELSEWHERE]) {
      await owner(
        `INSERT INTO billing_party (tenant_id, kind, name, address_line1, postal_code, city, country_code)
         VALUES ($1, 'consumer', 'Sam de Vries', 'Dorpsstraat 1', '1234 AB', 'Ons Dorp', 'NL')`,
        [tenant],
      );
    }
  }, 120_000);

  afterAll(async () => {
    await driver?.end();
  });

  it('numbers the invoice, then its credit note, in one run; the next run asks nothing', async () => {
    const invoiceId = ((await draft(ORG)).rows[0] as { id: string }).id;
    const recorded = await withTenant(driver, ORG, (db) =>
      recordCreditNote(db, ORG, invoiceId, { description: DESCRIPTION, numerator: 28, denominator: 31, evidence: {} }),
    );
    expect(recorded.kind).toBe('recorded');

    const books = moneybird();
    const { budget, counts } = fresh();
    await pushOrganisation(pool(), ORG, OCT_3, SETTINGS, CONTEXT, budget, counts, { fetchImpl: books.impl, ...noPace });

    expect(counts).toEqual({ issued: 2, credited: 1, adopted: 0, booked: 0, held: 0, refused: 0, unavailable: 0, slowed: 0 });
    expect(await rowsOf(ORG)).toEqual([
      {
        reference: `ownpace-${ORG}-m-2026-10-medium`,
        kind: 'invoice',
        status: 'sent',
        invoice_number: '2026-0007',
        total: '1200',
        lines: [{ description: 'Ownpace Medium, oktober 2026: het pakket dat u koos', publishedCents: 1200, cents: 1200 }],
      },
      {
        reference: `ownpace-${ORG}-c-2026-10-medium`,
        kind: 'credit_note',
        status: 'sent',
        invoice_number: '2026-0008',
        total: '-1084',
        lines: [
          {
            description: 'Herroeping op 3 oktober 2026: 28 van de 31 dagen van factuur 2026-0007 niet gebruikt, en gecrediteerd',
            cents: -1084,
            numerator: 28,
            denominator: 31,
          },
        ],
      },
    ]);
    expect(books.calls.filter((c) => c.path.endsWith('/duplicate_creditinvoice.json'))).toHaveLength(1);

    const again = fresh();
    const quiet = moneybird();
    await pushOrganisation(pool(), ORG, new Date('2026-10-03T11:41:00Z'), SETTINGS, CONTEXT, again.budget, again.counts, {
      fetchImpl: quiet.impl,
      ...noPace,
    });
    expect(again.counts.issued).toBe(0);
    expect(quiet.calls).toEqual([]);
  });

  it("refuses a credit note whose invoice was numbered in another administration, asking Moneybird nothing about it", async () => {
    const invoiceId = ((await draft(ELSEWHERE)).rows[0] as { id: string }).id;
    await owner(
      `UPDATE invoice SET status = 'sent', invoice_number = '2026-0100', invoice_date = '2026-10-01', moneybird_id = '9100',
              moneybird_administration_id = '999', tax_rate_id = '611',
              lines = '[{"description": "Ownpace Medium, oktober 2026", "publishedCents": 1200, "cents": 1200}]'::jsonb
        WHERE id = $1`,
      [invoiceId],
    );
    await withTenant(driver, ELSEWHERE, (db) =>
      recordCreditNote(db, ELSEWHERE, invoiceId, { description: DESCRIPTION, numerator: 28, denominator: 31, evidence: {} }),
    );
    const said = vi.spyOn(log, 'error').mockImplementation(() => {});

    const books = moneybird();
    const { budget, counts } = fresh();
    await pushOrganisation(pool(), ELSEWHERE, OCT_3, SETTINGS, CONTEXT, budget, counts, { fetchImpl: books.impl, ...noPace });

    expect(counts).toMatchObject({ issued: 0, credited: 0, refused: 1 });
    expect(books.calls).toEqual([]);
    expect(String(said.mock.calls[0]?.[0])).toContain('administration 999');
    said.mockRestore();
  });
});
