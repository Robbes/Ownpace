// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * PAID AND LATE, READ BACK FROM THE BOOKS (workplan 0111, slice 5f, its second
 * half; the owner, 2026-10-11): `books-read-back.ts`, the list against a
 * Moneybird of its own and the write on a real database, in the
 * organisation's own scope as `app_user`.
 *
 *  - the list asks for late, reminded and paid, changed since the moment
 *    given, over an explicit period, a page of 100 at a time, and says when
 *    more waits;
 *  - the organisation is read from our reference, and nothing else is ours;
 *  - late and reminded move a sent invoice to overdue; paid moves a sent or
 *    overdue invoice to paid, on Moneybird's day, and notes the books hold it;
 *  - never backwards, never a credit note, never another administration's or
 *    another organisation's, and never paid for an invoice its credit notes
 *    take off in full.
 *
 * PGlite, both chains. The names are invented, and nothing is contacted.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import type { TenantId } from '@openmig/shared';
import { runManagedMigrations } from './migrate-managed.ts';
import {
  READ_BACK_PAGE,
  READ_BACK_PAGES,
  applyReadBack,
  listChangedSalesInvoices,
  organisationOf,
  type ChangedInvoice,
} from './books-read-back.ts';

// UUID family 01115f20-…, unused elsewhere in the repo.
const ORG = '01115f20-e29b-41d4-a716-446655440001' as TenantId;
const OTHER = '01115f20-e29b-41d4-a716-446655440002' as TenantId;
const ADMINISTRATION = '123456789012345678';
const ACCESS = { administrationId: ADMINISTRATION, apiToken: 'not-a-real-token' };
const NOW = new Date('2026-10-11T09:41:00Z');

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('organisationOf', () => {
  it("reads the organisation from a month's invoice reference, and nothing else", () => {
    expect(organisationOf(`ownpace-${ORG}-m-2026-10-medium`)).toBe(ORG);
    expect(organisationOf(`ownpace-${ORG.toUpperCase()}-m-2026-10-medium`)).toBe(ORG);
    for (const reference of [
      `ownpace-${ORG}-c-2026-10-medium`,
      'ownpace-proof-2026-10',
      'ownpace-nightly-2026-10-11',
      `x-ownpace-${ORG}-m-2026-10-medium`,
      '',
      null,
    ]) {
      expect(organisationOf(reference), String(reference)).toBeNull();
    }
  });
});

describe('listChangedSalesInvoices', () => {
  it('asks for late, reminded and paid, changed since the moment, over an explicit period, a page at a time', async () => {
    const urls: string[] = [];
    const impl = (async (url: unknown) => {
      urls.push(String(url));
      return json([
        { id: '701', reference: `ownpace-${ORG}-m-2026-10-medium`, state: 'paid', paid_at: '2026-10-09' },
        { id: '702', reference: `ownpace-${ORG}-m-2026-09-medium`, state: 'late', paid_at: null },
        { id: '703', reference: 'by hand', state: 'open' },
      ]);
    }) as typeof fetch;
    const since = new Date('2026-10-10T07:41:00Z');
    const listed = await listChangedSalesInvoices(ACCESS, since, NOW, impl);
    expect(listed).toEqual({
      kind: 'ok',
      more: false,
      invoices: [
        { moneybirdId: '701', reference: `ownpace-${ORG}-m-2026-10-medium`, state: 'paid', paidOn: '2026-10-09' },
        { moneybirdId: '702', reference: `ownpace-${ORG}-m-2026-09-medium`, state: 'late', paidOn: null },
      ],
    });
    const asked = new URL(urls[0]!);
    expect(asked.pathname).toBe(`/api/v2/${ADMINISTRATION}/sales_invoices.json`);
    expect(asked.searchParams.get('filter')).toBe(
      'state:late|reminded|paid,updated_after:2026-10-10T07:41:00.000Z,period:20260101..20271231',
    );
    expect(asked.searchParams.get('per_page')).toBe(String(READ_BACK_PAGE));
    expect(asked.searchParams.get('page')).toBe('1');
    expect(urls).toHaveLength(1);
  });

  it('reads on while pages are full, and says when the run stops with more to read', async () => {
    let asked = 0;
    const full = Array.from({ length: READ_BACK_PAGE }, (_, i) => ({ id: String(1000 + i), state: 'late' }));
    const impl = (async () => {
      asked += 1;
      return json(full);
    }) as typeof fetch;
    const listed = await listChangedSalesInvoices(ACCESS, NOW, NOW, impl);
    expect(asked).toBe(READ_BACK_PAGES);
    expect(listed.kind === 'ok' && listed.more).toBe(true);
  });

  it('is unavailable when Moneybird is, and a 429 is its own outcome', async () => {
    expect((await listChangedSalesInvoices(ACCESS, NOW, NOW, (async () => json({}, 500)) as typeof fetch)).kind).toBe(
      'unavailable',
    );
    const slow = await listChangedSalesInvoices(
      ACCESS,
      NOW,
      NOW,
      (async () => new Response('{}', { status: 429, headers: { 'Retry-After': '30' } })) as typeof fetch,
    );
    expect(slow.kind).toBe('slow_down');
  });
});

describe('applyReadBack', () => {
  let driver: LedgerDriver;
  let made = 0;

  async function owner(statement: string, params: unknown[] = []) {
    const conn = await driver.acquire();
    try {
      return await conn.query(statement, params);
    } finally {
      await conn.release();
    }
  }

  /** An invoice issued the only way there is, at the status asked, with its Moneybird id. */
  async function issued(
    tenant: string,
    status: 'sent' | 'overdue' | 'paid',
    moneybirdId: string,
    kind = 'invoice',
    credits: string | null = null,
  ) {
    made += 1;
    const id = `01115f20-e29b-41d4-a716-${String(446655440100 + made)}`;
    const letter = kind === 'credit_note' ? 'c' : 'm';
    await owner(
      `INSERT INTO invoice (id, tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total, reference, kind,
                            credited_invoice_id)
       VALUES ($1, $2, '2026-10-01', '2026-10-31', 'draft', 992, 0.21, 208, $5, $3, $4, $6)`,
      [
        id,
        tenant,
        `ownpace-${tenant}-${letter}-2026-${String(made).padStart(2, '0')}-medium`,
        kind,
        kind === 'credit_note' ? -1200 : 1200,
        credits,
      ],
    );
    await owner(
      `UPDATE invoice SET status = 'sent', invoice_number = $2, invoice_date = '2026-10-01', moneybird_id = $3,
              moneybird_administration_id = $4, sent_at = now() WHERE id = $1`,
      [id, `2026-${String(made).padStart(4, '0')}`, moneybirdId, ADMINISTRATION],
    );
    if (status !== 'sent') {
      await owner(
        status === 'paid'
          ? `UPDATE invoice SET status = 'paid', paid_at = '2026-10-05T21:30:00Z', payment_id = 'tr_x', paid_cents = 1200 WHERE id = $1`
          : `UPDATE invoice SET status = 'overdue' WHERE id = $1`,
        [id],
      );
    }
    return id;
  }

  const rowOf = async (id: string) =>
    (
      await owner(
        `SELECT status, paid_at, moneybird_paid_at FROM invoice WHERE id = $1`,
        [id],
      )
    ).rows[0] as { status: string; paid_at: Date | null; moneybird_paid_at: Date | null };

  const change = (moneybirdId: string, state: ChangedInvoice['state'], paidOn: string | null = null): ChangedInvoice => ({
    moneybirdId,
    reference: null,
    state,
    paidOn,
  });

  const apply = (tenant: TenantId, invoice: ChangedInvoice, administration = ADMINISTRATION) =>
    withTenant(driver, tenant, (db) => applyReadBack(db, tenant, administration, invoice, NOW));

  beforeAll(async () => {
    driver = pgliteDriver({ role: 'app_user' });
    await runMigrations({ driver, logger: () => {} });
    await runManagedMigrations({ driver, logger: () => {} });
    await owner(`INSERT INTO tenant (id, name) VALUES ($1, 'Reads Back BV'), ($2, 'Somebody Else BV')`, [ORG, OTHER]);
  }, 120_000);

  afterAll(async () => {
    await driver?.end();
  });

  it('moves a sent invoice to overdue when the books say late or reminded, once', async () => {
    const late = await issued(ORG, 'sent', '801');
    expect(await apply(ORG, change('801', 'late'))).toBe('overdue');
    expect((await rowOf(late)).status).toBe('overdue');
    // Reminded later: it is overdue already, and nothing moves.
    expect(await apply(ORG, change('801', 'reminded'))).toBeNull();
  });

  it('moves sent or overdue to paid on the books’ day, noting the books hold it', async () => {
    const sent = await issued(ORG, 'sent', '802');
    expect(await apply(ORG, change('802', 'paid', '2026-10-09'))).toBe('paid');
    expect(await rowOf(sent)).toEqual({
      status: 'paid',
      paid_at: new Date('2026-10-09T00:00:00Z'),
      moneybird_paid_at: NOW,
    });
    const overdue = await issued(ORG, 'overdue', '803');
    expect(await apply(ORG, change('803', 'paid', null))).toBe('paid');
    expect((await rowOf(overdue)).paid_at).toEqual(NOW);
  });

  it('never moves backwards, and leaves an invoice paid through Mollie as Mollie said', async () => {
    const mollie = await issued(ORG, 'paid', '804');
    expect(await apply(ORG, change('804', 'late'))).toBeNull();
    expect(await apply(ORG, change('804', 'paid', '2026-10-09'))).toBeNull();
    expect(await rowOf(mollie)).toMatchObject({ status: 'paid', paid_at: new Date('2026-10-05T21:30:00Z') });
  });

  it('never touches a credit note, another administration’s or another organisation’s invoice', async () => {
    const original = await issued(ORG, 'paid', '810');
    const note = await issued(ORG, 'sent', '805', 'credit_note', original);
    expect(await apply(ORG, change('805', 'paid', '2026-10-09'))).toBeNull();
    expect(await apply(ORG, change('805', 'late'))).toBeNull();
    expect((await rowOf(note)).status).toBe('sent');

    const elsewhere = await issued(ORG, 'sent', '806');
    expect(await apply(ORG, change('806', 'paid', '2026-10-09'), '999')).toBeNull();
    expect((await rowOf(elsewhere)).status).toBe('sent');

    const theirs = await issued(OTHER, 'sent', '807');
    expect(await apply(ORG, change('807', 'late'))).toBeNull();
    expect((await rowOf(theirs)).status).toBe('sent');
  });

  it('never calls paid an invoice its credit notes take off in full; one credited in part is', async () => {
    const credited = await issued(ORG, 'sent', '808');
    await owner(
      `INSERT INTO invoice (tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total, reference, kind, credited_invoice_id)
       VALUES ($1, '2026-10-01', '2026-10-31', 'draft', -992, 0.21, -208, -1200, $2, 'credit_note', $3)`,
      [ORG, `ownpace-${ORG}-c-2026-10-full`, credited],
    );
    expect(await apply(ORG, change('808', 'paid', '2026-10-09'))).toBeNull();
    expect((await rowOf(credited)).status).toBe('sent');

    const part = await issued(ORG, 'sent', '809');
    await owner(
      `INSERT INTO invoice (tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total, reference, kind, credited_invoice_id)
       VALUES ($1, '2026-10-01', '2026-10-31', 'draft', -331, 0.21, -69, -400, $2, 'credit_note', $3)`,
      [ORG, `ownpace-${ORG}-c-2026-10-part`, part],
    );
    expect(await apply(ORG, change('809', 'paid', '2026-10-09'))).toBe('paid');
  });
});
