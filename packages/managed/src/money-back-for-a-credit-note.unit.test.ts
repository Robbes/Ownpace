// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * MONEY BACK FOR A CREDIT NOTE (workplan 0111, T7, slice 7d, its second half;
 * terms §7): `money-back.ts` and `mollie-refunds.ts`, on a real database as
 * `app_user`, with a Mollie and a Moneybird of their own.
 *
 *  - decided: what was paid through Mollie above what is owed goes back, never
 *    more than the credit note and never more than was paid, less what went
 *    back before; nothing paid above is settled in the books; a payment not
 *    through Mollie is by hand;
 *  - refunded once: the refund carries the credit note's reference as its
 *    idempotency key and in its metadata, and one found made before is
 *    adopted, never made again; without a key it waits;
 *  - settled once: a credit invoice the books hold paid is written down, not
 *    settled again;
 *  - the refund booked on the credit note, negative, on Mollie's account,
 *    under the refund's id, once;
 *  - written once: the database refuses a second money back, and any on an
 *    invoice.
 *
 * PGlite, both chains. The names, ids and keys are invented, and nothing is
 * contacted.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import type { TenantId } from '@openmig/shared';
import { runManagedMigrations } from './migrate-managed.ts';
import type { MoneybirdSettings } from './moneybird-config.ts';
import { recordPaymentBooked } from './payment-book.ts';
import {
  bookRefund,
  claimNextMoneyBack,
  claimNextRefundToBook,
  decideMoneyBack,
  makeMoneyBack,
  recordMoneyBack,
  type MoneyBackDue,
  type MoneyBackOutcome,
} from './money-back.ts';

// UUID family 01117d20-…, unused elsewhere in the repo.
const ORG = '01117d20-e29b-41d4-a716-446655440001' as TenantId;
const ADMINISTRATION = '123456789012345678';
const MOLLIE_ACCOUNT = '123456789012345644';
const MOLLIE_KEY = 'test_not-a-real-key';
const NOW = new Date('2026-10-11T09:41:00Z');

const SETTINGS: MoneybirdSettings = {
  apiToken: 'not-a-real-token',
  administrationId: ADMINISTRATION,
  workflowId: '702',
  taxRates: { domesticStandard: '611', reverseCharge: '622', outsideEu: null },
  delivery: 'manual',
  mollieAccountId: MOLLIE_ACCOUNT,
};

/** An outcome that writes something down, or the test fails here. */
function done(outcome: MoneyBackOutcome) {
  if (outcome.kind === 'refunded' || outcome.kind === 'settled' || outcome.kind === 'by_hand') return outcome;
  throw new Error(`nothing to write down: ${outcome.kind}`);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const due = (
  over: Partial<Omit<MoneyBackDue, 'original'>> & { original?: Partial<MoneyBackDue['original']> },
): MoneyBackDue => ({
  id: 'c',
  reference: 'ownpace-x-c-2026-10-small',
  invoiceNumber: '2026-0010',
  administrationId: ADMINISTRATION,
  moneybirdId: '800',
  creditCents: 400,
  creditedCents: 400,
  refundedCents: 0,
  ...over,
  original: {
    id: 'o',
    invoiceNumber: '2026-0007',
    status: 'paid',
    totalCents: 1200,
    paymentId: 'tr_paid',
    paidCents: 1200,
    ...over.original,
  },
});

describe('decideMoneyBack', () => {
  it('gives back what was paid through Mollie above what is owed, and settles the rest', () => {
    expect(decideMoneyBack(due({}))).toEqual({ kind: 'refund', cents: 400, paymentId: 'tr_paid' });
    // Paid only what was left after the credit: nothing above, so the books settle it.
    expect(decideMoneyBack(due({ original: { paidCents: 800 } }))).toEqual({ kind: 'settle' });
    // Not paid at all.
    expect(decideMoneyBack(due({ original: { status: 'sent', paymentId: null, paidCents: null } }))).toEqual({ kind: 'settle' });
    expect(decideMoneyBack(due({ original: { status: 'overdue', paymentId: null, paidCents: null } }))).toEqual({ kind: 'settle' });
    // Paid, but not through Mollie.
    expect(decideMoneyBack(due({ original: { paymentId: null, paidCents: null } }))).toEqual({ kind: 'by_hand', cents: 400 });
  });

  it('never more than the credit note, nor more than was paid above, less what went back before', () => {
    // Two credit notes, 400 and 300, on 1200 paid: the second gives back 300 after the first gave 400.
    expect(decideMoneyBack(due({ creditCents: 300, creditedCents: 700, refundedCents: 400 }))).toEqual({
      kind: 'refund',
      cents: 300,
      paymentId: 'tr_paid',
    });
    // Only 900 paid of 1200, 700 credited: 400 above what is owed, 300 of it given back already.
    expect(decideMoneyBack(due({ creditCents: 300, creditedCents: 700, refundedCents: 300, original: { paidCents: 900 } }))).toEqual({
      kind: 'refund',
      cents: 100,
      paymentId: 'tr_paid',
    });
    // A credit larger than the invoice owes nothing below zero.
    expect(decideMoneyBack(due({ creditCents: 1500, creditedCents: 1500 }))).toEqual({ kind: 'refund', cents: 1200, paymentId: 'tr_paid' });
  });
});

describe('money back, on a real database', () => {
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

  /** An invoice issued the only way there is, and paid through Mollie, by bank, or not at all. */
  async function original(paid: 'mollie' | 'bank' | 'unpaid'): Promise<string> {
    made += 1;
    const id = `01117d20-e29b-41d4-a716-${String(446655440100 + made)}`;
    await owner(
      `INSERT INTO invoice (id, tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total, reference)
       VALUES ($1, $2, '2026-10-01', '2026-10-31', 'draft', 992, 0.21, 208, 1200, $3)`,
      [id, ORG, `ownpace-${ORG}-m-2026-10-${made}`],
    );
    await owner(
      `UPDATE invoice SET status = 'sent', invoice_number = $2, invoice_date = '2026-10-01', moneybird_id = $3,
              moneybird_administration_id = $4, sent_at = now() WHERE id = $1`,
      [id, `2026-${String(made).padStart(4, '0')}`, `70${made}`, ADMINISTRATION],
    );
    if (paid !== 'unpaid') {
      await owner(
        `UPDATE invoice SET status = 'paid', paid_at = '2026-10-05T21:30:00Z', payment_id = $2, paid_cents = $3 WHERE id = $1`,
        [id, paid === 'mollie' ? `tr_${made}` : null, paid === 'mollie' ? 1200 : null],
      );
    }
    return id;
  }

  /** Its credit note of 400, issued in the books. */
  async function credit(of: string): Promise<{ id: string; reference: string }> {
    made += 1;
    const id = `01117d20-e29b-41d4-a716-${String(446655440100 + made)}`;
    const reference = `ownpace-${ORG}-c-2026-10-${made}`;
    await owner(
      `INSERT INTO invoice (id, tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total, reference,
                            kind, credited_invoice_id)
       VALUES ($1, $2, '2026-10-01', '2026-10-31', 'draft', -331, 0.21, -69, -400, $3, 'credit_note', $4)`,
      [id, ORG, reference, of],
    );
    await owner(
      `UPDATE invoice SET status = 'sent', invoice_number = $2, invoice_date = '2026-10-11', moneybird_id = $3,
              moneybird_administration_id = $4, sent_at = now() WHERE id = $1`,
      [id, `2026-${String(made).padStart(4, '0')}`, `80${made}`, ADMINISTRATION],
    );
    return { id, reference };
  }

  /** A Mollie and a Moneybird of the test's own, every call kept. */
  function services(answers: { refunds?: unknown[]; creditState?: string; transactions?: string[] } = {}) {
    const calls: { method: string; url: URL; headers: Record<string, string>; body: unknown }[] = [];
    const impl = (async (url: unknown, init?: RequestInit) => {
      const at = new URL(String(url));
      calls.push({
        method: init?.method ?? 'GET',
        url: at,
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (at.host === 'api.mollie.com' && (init?.method ?? 'GET') === 'GET') {
        return json({ _embedded: { refunds: answers.refunds ?? [] } });
      }
      if (at.host === 'api.mollie.com') {
        const body = JSON.parse(String(init!.body)) as { amount: unknown; metadata: unknown };
        return json({ resource: 'refund', id: 're_made', amount: body.amount, status: 'pending', metadata: body.metadata }, 201);
      }
      if (at.pathname.endsWith('/register_payment_creditinvoice.json')) return json({ id: '800', state: 'paid' });
      if (at.pathname.endsWith('/payments.json')) return json({ id: '901' }, 201);
      return json({
        id: '800',
        invoice_id: '2026-0010',
        state: answers.creditState ?? 'open',
        payments: (answers.transactions ?? []).map((t) => ({ transaction_identifier: t })),
      });
    }) as typeof fetch;
    return { impl, calls };
  }

  const rowOf = async (id: string) =>
    (
      await owner(
        `SELECT money_back, refund_id, refund_cents::int AS refund_cents, money_back_at IS NOT NULL AS at,
                moneybird_paid_at IS NOT NULL AS in_the_books
           FROM invoice WHERE id = $1`,
        [id],
      )
    ).rows[0] as Record<string, unknown>;

  const claim = () => withTenant(driver, ORG, (db) => claimNextMoneyBack(db, ORG, NOW));

  beforeAll(async () => {
    driver = pgliteDriver({ role: 'app_user' });
    await runMigrations({ driver, logger: () => {} });
    await runManagedMigrations({ driver, logger: () => {} });
    await owner(`INSERT INTO tenant (id, name) VALUES ($1, 'Gets Money Back')`, [ORG]);
  }, 120_000);

  afterAll(async () => {
    await driver?.end();
  });

  it('refunds through Mollie once, under the credit note’s reference, then books it on the credit note', async () => {
    const paid = await original('mollie');
    const note = await credit(paid);

    const claimed = await claim();
    expect(claimed).toMatchObject({ id: note.id, creditCents: 400, creditedCents: 400, refundedCents: 0 });
    expect(claimed!.original).toMatchObject({ status: 'paid', totalCents: 1200, paidCents: 1200 });
    // Held by that push.
    expect(await claim()).toBeNull();

    const { impl, calls } = services();
    const outcome = await makeMoneyBack(SETTINGS, MOLLIE_KEY, claimed!, { fetchImpl: impl });
    expect(outcome).toEqual({ kind: 'refunded', refundId: 're_made', cents: 400, adopted: false });
    const [read, refund] = calls;
    expect(read!.url.href).toBe(`https://api.mollie.com/v2/payments/${claimed!.original.paymentId}/refunds?limit=250`);
    expect(refund).toMatchObject({
      method: 'POST',
      headers: { Authorization: `Bearer ${MOLLIE_KEY}`, 'Idempotency-Key': note.reference },
      body: { amount: { currency: 'EUR', value: '4.00' }, metadata: { creditNote: note.reference } },
    });

    expect(await withTenant(driver, ORG, (db) => recordMoneyBack(db, ORG, note.id, done(outcome), NOW))).toBe(true);
    expect(await rowOf(note.id)).toEqual({ money_back: 'refunded', refund_id: 're_made', refund_cents: 400, at: true, in_the_books: false });
    expect(await claim()).toBeNull();

    // Then the books: a payment on the credit note, negative, on Mollie's account, under the refund's id.
    const toBook = await withTenant(driver, ORG, (db) => claimNextRefundToBook(db, ORG, NOW));
    expect(toBook).toMatchObject({ id: note.id, refundId: 're_made', refundCents: 400, refundDate: '2026-10-11', moneybirdId: claimed!.moneybirdId });
    const books = services();
    expect(await bookRefund(SETTINGS, MOLLIE_ACCOUNT, toBook!, books.impl)).toEqual({ kind: 'booked' });
    expect(books.calls[1]).toMatchObject({
      method: 'POST',
      body: { payment: { price: '-4.00', financial_account_id: MOLLIE_ACCOUNT, transaction_identifier: 're_made' } },
    });
    await withTenant(driver, ORG, (db) => recordPaymentBooked(db, ORG, note.id, NOW));
    expect((await rowOf(note.id)).in_the_books).toBe(true);
    // Booked before: held, and nothing asked again.
    const before = services({ transactions: ['re_made'] });
    expect(await bookRefund(SETTINGS, MOLLIE_ACCOUNT, toBook!, before.impl)).toEqual({ kind: 'held', why: 'booked_before' });
    expect(before.calls).toHaveLength(1);
  });

  it('adopts a refund made before for this credit note, and waits without a key', async () => {
    const paid = await original('mollie');
    const note = await credit(paid);
    const claimed = (await claim())!;

    expect(await makeMoneyBack(SETTINGS, null, claimed, { fetchImpl: services().impl })).toMatchObject({ kind: 'waiting' });

    const { impl, calls } = services({
      refunds: [
        { id: 're_other', amount: { currency: 'EUR', value: '1.00' }, status: 'refunded', metadata: null },
        { id: 're_before', amount: { currency: 'EUR', value: '4.00' }, status: 'pending', metadata: { creditNote: note.reference } },
      ],
    });
    expect(await makeMoneyBack(SETTINGS, MOLLIE_KEY, claimed, { fetchImpl: impl })).toEqual({
      kind: 'refunded',
      refundId: 're_before',
      cents: 400,
      adopted: true,
    });
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('settles an unpaid invoice against its credit note in the books, once', async () => {
    const open = await original('unpaid');
    const note = await credit(open);
    const claimed = (await claim())!;
    const { impl, calls } = services();
    const outcome = await makeMoneyBack(SETTINGS, MOLLIE_KEY, claimed, { fetchImpl: impl });
    expect(outcome).toEqual({ kind: 'settled', before: false });
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      `GET /api/v2/${ADMINISTRATION}/sales_invoices/${claimed.moneybirdId}.json`,
      `PATCH /api/v2/${ADMINISTRATION}/sales_invoices/${claimed.moneybirdId}/register_payment_creditinvoice.json`,
    ]);
    await withTenant(driver, ORG, (db) => recordMoneyBack(db, ORG, note.id, done(outcome), NOW));
    expect(await rowOf(note.id)).toEqual({ money_back: 'settled', refund_id: null, refund_cents: null, at: true, in_the_books: true });

    // A credit invoice the books hold paid already is written down, not settled again.
    const held = services({ creditState: 'paid' });
    expect(await makeMoneyBack(SETTINGS, MOLLIE_KEY, claimed, { fetchImpl: held.impl })).toEqual({ kind: 'settled', before: true });
    expect(held.calls).toHaveLength(1);
  });

  it('says a payment not through Mollie for a transfer by hand, asking nobody', async () => {
    const byBank = await original('bank');
    const note = await credit(byBank);
    const claimed = (await claim())!;
    const { impl, calls } = services();
    const outcome = await makeMoneyBack(SETTINGS, MOLLIE_KEY, claimed, { fetchImpl: impl });
    expect(outcome).toEqual({ kind: 'by_hand', cents: 400 });
    expect(calls).toEqual([]);
    await withTenant(driver, ORG, (db) => recordMoneyBack(db, ORG, note.id, done(outcome), NOW));
    expect((await rowOf(note.id)).money_back).toBe('by_hand');
  });

  it('refuses a second money back, and any on an invoice', async () => {
    const paid = await original('mollie');
    const note = await credit(paid);
    await withTenant(driver, ORG, (db) =>
      recordMoneyBack(db, ORG, note.id, { kind: 'refunded', refundId: 're_once', cents: 400, adopted: false }, NOW),
    );
    // The writer writes only where nothing is written...
    expect(
      await withTenant(driver, ORG, (db) =>
        recordMoneyBack(db, ORG, note.id, { kind: 'refunded', refundId: 're_twice', cents: 400, adopted: false }, NOW),
      ),
    ).toBe(false);
    // ...and the database refuses a change to what is, and money back on an invoice.
    await expect(owner(`UPDATE invoice SET refund_id = 're_twice' WHERE id = $1`, [note.id])).rejects.toThrow(/written once/);
    await expect(
      owner(`UPDATE invoice SET money_back = 'settled', money_back_at = now() WHERE id = $1`, [paid]),
    ).rejects.toThrow(/invoice_money_back_check/);
  });
});
