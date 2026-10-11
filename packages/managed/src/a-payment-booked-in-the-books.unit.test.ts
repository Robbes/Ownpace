// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PAYMENT BOOKED IN THE BOOKS (workplan 0111, slice 5f; the owner,
 * 2026-10-11: "Ownpace follows Mollie"): `payment-book.ts`, on a real
 * database, in the organisation's own scope as `app_user`, with a Moneybird of
 * its own.
 *
 *  - claimed: an invoice paid through Mollie that the books do not hold, one
 *    push at a time; never a credit note, an invoice paid without Mollie, one
 *    the books hold, or another organisation's;
 *  - booked: on the configured account, under Mollie's payment id, for what
 *    Mollie took, on the day it was paid;
 *  - never twice: a payment there with Mollie's id, or the invoice paid in the
 *    books by other means, is held and nothing is booked; another
 *    administration's invoice is refused before anything is asked;
 *  - written down once, and the claim let go.
 *
 * PGlite, both chains. The names are invented, and nothing is contacted.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import type { TenantId } from '@openmig/shared';
import { runManagedMigrations } from './migrate-managed.ts';
import { bookPayment, claimNextPaymentToBook, recordPaymentBooked, type PaymentToBook } from './payment-book.ts';
import type { MoneybirdSettings } from './moneybird-config.ts';

// UUID family 01115f00-…, unused elsewhere in the repo.
const ORG = '01115f00-e29b-41d4-a716-446655440001' as TenantId;
const OTHER = '01115f00-e29b-41d4-a716-446655440002' as TenantId;
const PAID = '01115f00-e29b-41d4-a716-446655440101';
const BY_BANK = '01115f00-e29b-41d4-a716-446655440102';
const OPEN = '01115f00-e29b-41d4-a716-446655440103';
const THEIRS = '01115f00-e29b-41d4-a716-446655440104';
const ADMINISTRATION = '123456789012345678';
const MOLLIE_ACCOUNT = '123456789012345644';
const NOW = new Date('2026-10-11T09:41:00Z');

const SETTINGS: MoneybirdSettings = {
  apiToken: 'not-a-real-token',
  administrationId: ADMINISTRATION,
  workflowId: '702',
  taxRates: { domesticStandard: '611', reverseCharge: '622', outsideEu: null },
  delivery: 'manual',
  mollieAccountId: MOLLIE_ACCOUNT,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A Moneybird with one invoice, whose state and payments the test sets. */
function books(invoice: { state: string; payments?: unknown[] }, booking: Response = json({ id: '900' }, 201)) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    calls.push({ method: init?.method ?? 'GET', path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (path.endsWith('/payments.json')) return booking;
    return json({ id: '700', invoice_id: '2026-0007', state: invoice.state, payments: invoice.payments ?? [] });
  }) as typeof fetch;
  return { impl, calls };
}

describe('a payment through Mollie, booked in the books', () => {
  let driver: LedgerDriver;

  async function owner(statement: string, params: unknown[] = []) {
    const conn = await driver.acquire();
    try {
      return await conn.query(statement, params);
    } finally {
      await conn.release();
    }
  }

  /** Issued the only way there is, then paid: through Mollie when `cents` is given, by bank otherwise. */
  async function paid(
    id: string,
    tenant: string,
    number: string,
    moneybirdId: string,
    payment: { id: string | null; cents: number | null },
  ) {
    await owner(
      `INSERT INTO invoice (id, tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total, reference)
       VALUES ($1, $2, '2026-10-01', '2026-10-31', 'draft', 992, 0.21, 208, 1200, $3)`,
      [id, tenant, `ownpace-${tenant}-m-2026-10-${number}`],
    );
    await owner(
      `UPDATE invoice SET status = 'sent', invoice_number = $2, invoice_date = '2026-10-01', moneybird_id = $4,
              moneybird_administration_id = $3, sent_at = now() WHERE id = $1`,
      [id, number, ADMINISTRATION, moneybirdId],
    );
    await owner(
      `UPDATE invoice SET status = 'paid', paid_at = '2026-10-05T21:30:00Z', payment_id = $2, paid_cents = $3 WHERE id = $1`,
      [id, payment.id, payment.cents],
    );
  }

  beforeAll(async () => {
    driver = pgliteDriver({ role: 'app_user' });
    await runMigrations({ driver, logger: () => {} });
    await runManagedMigrations({ driver, logger: () => {} });
    await owner(`INSERT INTO tenant (id, name) VALUES ($1, 'Pays BV'), ($2, 'Somebody Else BV')`, [ORG, OTHER]);
    // Paid through Mollie, 800 of 1200: a credit note took 400 off before (slice 7d).
    await paid(PAID, ORG, '2026-0007', '700', { id: 'tr_paid', cents: 800 });
    // Paid by bank transfer, read back from the books: nothing for the push.
    await paid(BY_BANK, ORG, '2026-0008', '701', { id: null, cents: null });
    // Another organisation's: never in this one's scope.
    await paid(THEIRS, OTHER, '2026-0009', '702', { id: 'tr_theirs', cents: 1200 });
    // Issued and still open: nothing paid, nothing to book.
    await owner(
      `INSERT INTO invoice (id, tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total, reference)
       VALUES ($1, $2, '2026-09-01', '2026-09-30', 'draft', 992, 0.21, 208, 1200, $3)`,
      [OPEN, ORG, `ownpace-${ORG}-m-2026-09-medium`],
    );
  }, 120_000);

  afterAll(async () => {
    await driver?.end();
  });

  it('claims the invoice paid through Mollie, once, with what the booking needs', async () => {
    const claimed = await withTenant(driver, ORG, (db) => claimNextPaymentToBook(db, ORG, NOW));
    expect(claimed).toEqual({
      id: PAID,
      reference: `ownpace-${ORG}-m-2026-10-2026-0007`,
      invoiceNumber: '2026-0007',
      administrationId: ADMINISTRATION,
      moneybirdId: '700',
      paymentId: 'tr_paid',
      paidCents: 800,
      paymentDate: '2026-10-05',
    });
    // Held by that push: a second one finds nothing, and the bank's and the open one are never its.
    expect(await withTenant(driver, ORG, (db) => claimNextPaymentToBook(db, ORG, NOW))).toBeNull();
    // Nor another organisation's, whatever this one's scope would allow.
    expect(await withTenant(driver, OTHER, (db) => claimNextPaymentToBook(db, ORG, NOW))).toBeNull();
  });

  it('books it on the Mollie account, under Mollie’s id, for what Mollie took, on the day it was paid', async () => {
    const payment = claimedPayment();
    const { impl, calls } = books({ state: 'open' });
    expect(await bookPayment(SETTINGS, MOLLIE_ACCOUNT, payment, impl)).toEqual({ kind: 'booked' });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `GET /api/v2/${ADMINISTRATION}/sales_invoices/700.json`,
      `POST /api/v2/${ADMINISTRATION}/sales_invoices/700/payments.json`,
    ]);
    expect(calls[1]!.body).toEqual({
      payment: {
        payment_date: '2026-10-05',
        price: '8.00',
        financial_account_id: MOLLIE_ACCOUNT,
        transaction_identifier: 'tr_paid',
      },
    });
  });

  it('never books twice: a payment with Mollie’s id there, or the invoice paid in the books, is held', async () => {
    const payment = claimedPayment();
    const before = books({ state: 'open', payments: [{ id: '900', transaction_identifier: 'tr_paid', price: '8.0' }] });
    expect(await bookPayment(SETTINGS, MOLLIE_ACCOUNT, payment, before.impl)).toEqual({ kind: 'held', why: 'booked_before' });
    expect(before.calls.filter((call) => call.method === 'POST')).toEqual([]);

    const otherwise = books({ state: 'paid', payments: [{ id: '901', transaction_identifier: 'NL91 transfer' }] });
    expect(await bookPayment(SETTINGS, MOLLIE_ACCOUNT, payment, otherwise.impl)).toEqual({
      kind: 'held',
      why: 'paid_in_the_books',
    });
    expect(otherwise.calls.filter((call) => call.method === 'POST')).toEqual([]);
  });

  it('refuses another administration’s invoice before asking anything, and says a refused booking', async () => {
    const elsewhere = books({ state: 'open' });
    const outcome = await bookPayment(SETTINGS, MOLLIE_ACCOUNT, { ...claimedPayment(), administrationId: '999' }, elsewhere.impl);
    expect(outcome.kind).toBe('refused');
    expect(outcome.kind === 'refused' && outcome.reason).toMatch(/invoice 2026-0007 was issued in administration 999/);
    expect(elsewhere.calls).toEqual([]);

    const refused = books({ state: 'open' }, json({ error: 'financial account not found' }, 422));
    const said = await bookPayment(SETTINGS, MOLLIE_ACCOUNT, claimedPayment(), refused.impl);
    expect(said.kind).toBe('refused');
    expect(said.kind === 'refused' && said.reason).toMatch(/^invoice 2026-0007: Moneybird refused the payment/);
  });

  it('writes it down once, lets the claim go, and then the invoice is never claimed again', async () => {
    expect(await withTenant(driver, ORG, (db) => recordPaymentBooked(db, ORG, PAID, NOW))).toBe(true);
    expect(await withTenant(driver, ORG, (db) => recordPaymentBooked(db, ORG, PAID, NOW))).toBe(false);
    const row = (await owner(`SELECT moneybird_paid_at, push_lease_until FROM invoice WHERE id = $1`, [PAID])).rows[0] as {
      moneybird_paid_at: Date | null;
      push_lease_until: Date | null;
    };
    expect(row.moneybird_paid_at?.toISOString()).toBe(NOW.toISOString());
    expect(row.push_lease_until).toBeNull();
    const later = new Date(NOW.getTime() + 60 * 60_000);
    expect(await withTenant(driver, ORG, (db) => claimNextPaymentToBook(db, ORG, later))).toBeNull();
  });

  it('refuses what Mollie took as nothing: the database holds paid_cents above zero', async () => {
    await expect(owner(`UPDATE invoice SET paid_cents = 0 WHERE id = $1`, [BY_BANK])).rejects.toThrow(
      /invoice_paid_cents_check/,
    );
  });

  /** The claim of the first case, as the push would hold it. */
  function claimedPayment(): PaymentToBook {
    return {
      id: PAID,
      reference: `ownpace-${ORG}-m-2026-10-2026-0007`,
      invoiceNumber: '2026-0007',
      administrationId: ADMINISTRATION,
      moneybirdId: '700',
      paymentId: 'tr_paid',
      paidCents: 800,
      paymentDate: '2026-10-05',
    };
  }
});
