// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PAYMENT BOOKED ONCE (workplan 0111, slice 5f; the owner, 2026-10-11:
 * "Ownpace follows Mollie"): the wiring half, as the hourly run asks it of
 * one organisation (`pushOrganisation`), on a database and a Moneybird of the
 * test's own.
 *
 *  - an invoice paid through Mollie is booked on its invoice in the books,
 *    on the Mollie account, and written down; the next run books nothing and
 *    asks Moneybird nothing;
 *  - without `MONEYBIRD_FINANCIAL_ACCOUNT_ID_MOLLIE` nothing is booked and
 *    Moneybird is asked nothing;
 *  - a booking the books refuse is counted and said, and the invoice is not
 *    written down: the next hour tries again.
 *
 * PGlite as `app_user`. The names, numbers and token are invented, and
 * nothing is contacted: Moneybird here is a function.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { Pool } from 'pg';
import { pgliteDriver, runMigrations, type LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations, type MoneybirdSettings, type PushContext } from '@openmig/managed';
import { log } from '@openmig/shared';
import { pushOrganisation, type PushBudget, type PushCounts } from './managed-invoice-push.ts';

const ADMINISTRATION = '123456789012345678';
const MOLLIE_ACCOUNT = '123456789012345644';
const SETTINGS: MoneybirdSettings = {
  apiToken: 'not-a-real-token',
  administrationId: ADMINISTRATION,
  workflowId: '702',
  taxRates: { domesticStandard: '611', reverseCharge: '622', outsideEu: null },
  delivery: 'manual',
  mollieAccountId: MOLLIE_ACCOUNT,
};
const CONTEXT: PushContext = { sellerCountry: 'NL', ossActive: false, delivery: 'manual' };

// UUID family 01115f10-…, unused elsewhere in the repo.
const BOOKED = '01115f10-e29b-41d4-a716-446655440001';
const UNSET = '01115f10-e29b-41d4-a716-446655440002';
const REFUSED = '01115f10-e29b-41d4-a716-446655440003';
const NOW = new Date('2026-10-11T09:41:00Z');

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A Moneybird whose invoices are open until a payment is booked on them. */
function books(options: { refuse?: boolean } = {}) {
  const payments = new Map<string, unknown[]>();
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = new URL(String(url)).pathname.replace(`/api/v2/${ADMINISTRATION}`, '');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    const booking = /^\/sales_invoices\/(\d+)\/payments\.json$/.exec(path);
    if (booking && method === 'POST') {
      if (options.refuse) return json({ error: 'Financial account is not valid' }, 422);
      const paid = (body as { payment: Record<string, unknown> }).payment;
      payments.set(booking[1]!, [...(payments.get(booking[1]!) ?? []), { id: '900', ...paid }]);
      return json({ id: '900' }, 201);
    }
    const one = /^\/sales_invoices\/(\d+)\.json$/.exec(path);
    if (one) {
      const booked = payments.get(one[1]!) ?? [];
      return json({ id: one[1], invoice_id: '2026-0007', state: booked.length ? 'paid' : 'open', payments: booked });
    }
    return json({ error: `unexpected ${method} ${path}` }, 500);
  }) as typeof fetch;
  return { impl, calls };
}

describe("one organisation's payments through Mollie, booked as the hourly run books them", () => {
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

  /** Issued and paid through Mollie: 1200, its payment `tr_…`. */
  async function paidThroughMollie(tenant: string, moneybirdId: string) {
    await owner(
      `INSERT INTO invoice (tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total, reference)
       VALUES ($1, '2026-10-01', '2026-10-31', 'draft', 992, 0.21, 208, 1200, $2)`,
      [tenant, `ownpace-${tenant}-m-2026-10-medium`],
    );
    await owner(
      `UPDATE invoice SET status = 'sent', invoice_number = '2026-0007', invoice_date = '2026-10-01', moneybird_id = $2,
              moneybird_administration_id = $3, sent_at = now() WHERE tenant_id = $1`,
      [tenant, moneybirdId, ADMINISTRATION],
    );
    await owner(
      `UPDATE invoice SET status = 'paid', paid_at = '2026-10-05T21:30:00Z', payment_id = $2, paid_cents = 1200
        WHERE tenant_id = $1`,
      [tenant, `tr_${moneybirdId}`],
    );
  }

  const bookedAt = async (tenant: string) =>
    ((await owner(`SELECT moneybird_paid_at FROM invoice WHERE tenant_id = $1`, [tenant])).rows[0] as {
      moneybird_paid_at: Date | null;
    }).moneybird_paid_at;

  const fresh = (): { budget: PushBudget; counts: PushCounts } => ({
    budget: { left: 60, stopped: false },
    counts: { issued: 0, credited: 0, adopted: 0, booked: 0, held: 0, refunded: 0, settled: 0, byHand: 0, refundsEnded: 0, refundsFailed: 0, refundsLate: 0, refused: 0, unavailable: 0, slowed: 0 },
  });

  beforeAll(async () => {
    driver = pgliteDriver({ role: 'app_user' });
    await runMigrations({ driver, logger: () => {} });
    await runManagedMigrations({ driver, logger: () => {} });
    await owner(`INSERT INTO tenant (id, name) VALUES ($1, 'Booked BV'), ($2, 'Unset BV'), ($3, 'Refused BV')`, [
      BOOKED,
      UNSET,
      REFUSED,
    ]);
    await paidThroughMollie(BOOKED, '701');
    await paidThroughMollie(UNSET, '702');
    await paidThroughMollie(REFUSED, '703');
  }, 120_000);

  afterAll(async () => {
    await driver?.end();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('books the payment on the Mollie account, writes it down, and the next run asks nothing', async () => {
    const moneybird = books();
    const { budget, counts } = fresh();
    await pushOrganisation(pool(), BOOKED, NOW, SETTINGS, CONTEXT, budget, counts, { fetchImpl: moneybird.impl, ...noPace });
    expect(counts).toMatchObject({ booked: 1, held: 0, refunded: 0, settled: 0, byHand: 0, refused: 0 });
    expect(moneybird.calls.find((call) => call.method === 'POST')?.body).toEqual({
      payment: {
        payment_date: '2026-10-05',
        price: '12.00',
        financial_account_id: MOLLIE_ACCOUNT,
        transaction_identifier: 'tr_701',
      },
    });
    expect((await bookedAt(BOOKED))?.toISOString()).toBe(NOW.toISOString());

    const quiet = books();
    const again = fresh();
    const later = new Date(NOW.getTime() + 60 * 60_000);
    await pushOrganisation(pool(), BOOKED, later, SETTINGS, CONTEXT, again.budget, again.counts, {
      fetchImpl: quiet.impl,
      ...noPace,
    });
    expect(again.counts.booked).toBe(0);
    expect(quiet.calls).toEqual([]);
  });

  it('books nothing, and asks nothing, while the Mollie account is not set', async () => {
    const moneybird = books();
    const { budget, counts } = fresh();
    await pushOrganisation(pool(), UNSET, NOW, { ...SETTINGS, mollieAccountId: null }, CONTEXT, budget, counts, {
      fetchImpl: moneybird.impl,
      ...noPace,
    });
    expect(counts.booked).toBe(0);
    expect(moneybird.calls).toEqual([]);
    expect(await bookedAt(UNSET)).toBeNull();
  });

  it('says a booking the books refuse, and leaves the invoice for the next hour', async () => {
    const said = vi.spyOn(log, 'error').mockImplementation(() => {});
    const moneybird = books({ refuse: true });
    const { budget, counts } = fresh();
    await pushOrganisation(pool(), REFUSED, NOW, SETTINGS, CONTEXT, budget, counts, { fetchImpl: moneybird.impl, ...noPace });
    expect(counts).toMatchObject({ booked: 0, refused: 1 });
    expect(said.mock.calls.flat().join(' ')).toContain('invoice 2026-0007: Moneybird refused the payment');
    expect(await bookedAt(REFUSED)).toBeNull();
    // Once the claim runs out, the next run tries again.
    const later = new Date(NOW.getTime() + 60 * 60_000);
    const retry = books();
    const again = fresh();
    await pushOrganisation(pool(), REFUSED, later, SETTINGS, CONTEXT, again.budget, again.counts, {
      fetchImpl: retry.impl,
      ...noPace,
    });
    expect(again.counts.booked).toBe(1);
  });
});
