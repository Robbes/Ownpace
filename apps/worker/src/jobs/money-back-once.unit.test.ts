// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * MONEY BACK, AS THE HOURLY RUN MAKES IT (workplan 0111, T7, slice 7d, its
 * second half): `pushOrganisation` after a credit note is issued, on a
 * database, a Mollie and a Moneybird of the test's own.
 *
 *  - one run refunds through Mollie what was paid above what is owed, then
 *    books the refund on the credit note; the next run asks nothing;
 *  - without a Mollie key the refund waits, said each run, and nothing is
 *    written;
 *  - an invoice paid by transfer is said to the operator once, for a transfer
 *    by hand, and nobody is asked anything;
 *  - each refund is followed until Mollie says it ended (managed 0053): one
 *    that failed is said once and never booked, one still queued a week on is
 *    said once, and one paid out ends quietly.
 *
 * PGlite as `app_user`. The names, ids and keys are invented, and nothing is
 * contacted: Mollie and Moneybird here are a function.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { Pool } from 'pg';
import { pgliteDriver, runMigrations, type LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations, type MoneybirdSettings, type PushContext } from '@openmig/managed';
import { log, type MoneyToGiveBackEvent } from '@openmig/shared';
import { pushOrganisation, type PushBudget, type PushCounts } from './managed-invoice-push.ts';

const ADMINISTRATION = '123456789012345678';
const MOLLIE_ACCOUNT = '123456789012345644';
const MOLLIE_KEY = 'test_not-a-real-key';
const SETTINGS: MoneybirdSettings = {
  apiToken: 'not-a-real-token',
  administrationId: ADMINISTRATION,
  workflowId: '702',
  taxRates: { domesticStandard: '611', reverseCharge: '622', outsideEu: null },
  delivery: 'manual',
  mollieAccountId: MOLLIE_ACCOUNT,
};
const CONTEXT: PushContext = { sellerCountry: 'NL', ossActive: false, delivery: 'manual' };

// UUID family 01117d30-…, unused elsewhere in the repo.
const REFUNDED = '01117d30-e29b-41d4-a716-446655440001';
const NO_KEY = '01117d30-e29b-41d4-a716-446655440002';
const BY_BANK = '01117d30-e29b-41d4-a716-446655440003';
const FAILS = '01117d30-e29b-41d4-a716-446655440004';
const QUEUED = '01117d30-e29b-41d4-a716-446655440005';
const NOW = new Date('2026-10-11T09:41:00Z');

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * A Mollie that keeps its refunds, and a Moneybird whose credit invoices are
 * open until a payment is booked. A refund is made `pending`, and listed as
 * `listedAs` says from then on, as Mollie moves it. Its ids start `ids`: one
 * Mollie refund is one credit note's, across the organisations here too.
 */
function services(listedAs = 'pending', ids = 're_') {
  const refunds: { id: string; amount: unknown; status: string; metadata: unknown }[] = [];
  const payments = new Map<string, unknown[]>();
  const calls: string[] = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    const at = new URL(String(url));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push(`${method} ${at.host}${at.pathname}`);
    if (at.host === 'api.mollie.com') {
      if (method === 'GET') return json({ _embedded: { refunds } });
      const made = { id: `${ids}${refunds.length + 1}`, amount: body.amount, status: 'pending', metadata: body.metadata };
      refunds.push({ ...made, status: listedAs });
      return json(made, 201);
    }
    const path = at.pathname.replace(`/api/v2/${ADMINISTRATION}`, '');
    const booking = /^\/sales_invoices\/(\d+)\/payments\.json$/.exec(path);
    if (booking && method === 'POST') {
      payments.set(booking[1]!, [...(payments.get(booking[1]!) ?? []), { id: '900', ...body.payment }]);
      return json({ id: '900' }, 201);
    }
    const one = /^\/sales_invoices\/(\d+)\.json$/.exec(path);
    if (one) {
      const booked = payments.get(one[1]!) ?? [];
      return json({ id: one[1], invoice_id: '2026-0010', state: booked.length ? 'paid' : 'open', payments: booked });
    }
    return json({ error: `unexpected ${method} ${path}` }, 500);
  }) as typeof fetch;
  return { impl, calls, refunds, payments };
}

describe("one organisation's money back, as the hourly run makes it", () => {
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

  /** Issued and paid, through Mollie (1200, `tr_…`) or by transfer, then credited 400 by an issued credit note. */
  async function paidThenCredited(tenant: string, moneybirdId: string, through: 'mollie' | 'bank') {
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
      `UPDATE invoice SET status = 'paid', paid_at = '2026-10-05T21:30:00Z', payment_id = $2, paid_cents = $3,
              moneybird_paid_at = now() WHERE tenant_id = $1`,
      [tenant, through === 'mollie' ? `tr_${moneybirdId}` : null, through === 'mollie' ? 1200 : null],
    );
    await owner(
      `INSERT INTO invoice (tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total, reference,
                            kind, credited_invoice_id)
       SELECT $1, '2026-10-01', '2026-10-31', 'draft', -331, 0.21, -69, -400, $2, 'credit_note', id
         FROM invoice WHERE tenant_id = $1 AND kind = 'invoice'`,
      [tenant, `ownpace-${tenant}-c-2026-10-medium`],
    );
    await owner(
      `UPDATE invoice SET status = 'sent', invoice_number = '2026-0010', invoice_date = '2026-10-11', moneybird_id = $2,
              moneybird_administration_id = $3, sent_at = now() WHERE tenant_id = $1 AND kind = 'credit_note'`,
      [tenant, `8${moneybirdId}`, ADMINISTRATION],
    );
  }

  const creditNote = async (tenant: string) =>
    (
      await owner(
        `SELECT money_back, refund_id, refund_cents::int AS refund_cents, moneybird_paid_at IS NOT NULL AS in_the_books
           FROM invoice WHERE tenant_id = $1 AND kind = 'credit_note'`,
        [tenant],
      )
    ).rows[0];

  const followed = async (tenant: string) =>
    (
      await owner(
        `SELECT refund_status, refund_ended_at IS NOT NULL AS ended, refund_late_said_at IS NOT NULL AS late_said
           FROM invoice WHERE tenant_id = $1 AND kind = 'credit_note'`,
        [tenant],
      )
    ).rows[0];

  const fresh = (): { budget: PushBudget; counts: PushCounts } => ({
    budget: { left: 60, stopped: false },
    counts: { issued: 0, credited: 0, adopted: 0, booked: 0, held: 0, refunded: 0, settled: 0, byHand: 0, refundsEnded: 0, refundsFailed: 0, refundsLate: 0, refused: 0, unavailable: 0, slowed: 0 },
  });

  beforeAll(async () => {
    driver = pgliteDriver({ role: 'app_user' });
    await runMigrations({ driver, logger: () => {} });
    await runManagedMigrations({ driver, logger: () => {} });
    await owner(
      `INSERT INTO tenant (id, name) VALUES ($1, 'Refunded BV'), ($2, 'No Key BV'), ($3, 'By Bank BV'), ($4, 'Fails BV'),
              ($5, 'Queued BV')`,
      [REFUNDED, NO_KEY, BY_BANK, FAILS, QUEUED],
    );
    await paidThenCredited(REFUNDED, '701', 'mollie');
    await paidThenCredited(NO_KEY, '702', 'mollie');
    await paidThenCredited(BY_BANK, '703', 'bank');
    await paidThenCredited(FAILS, '704', 'mollie');
    await paidThenCredited(QUEUED, '705', 'mollie');
  }, 120_000);

  afterAll(async () => {
    await driver?.end();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refunds what was paid above through Mollie, books it on the credit note, and the next run asks nothing', async () => {
    const world = services();
    const { budget, counts } = fresh();
    await pushOrganisation(pool(), REFUNDED, NOW, SETTINGS, CONTEXT, budget, counts, {
      fetchImpl: world.impl,
      mollieApiKey: MOLLIE_KEY,
      ...noPace,
    });
    expect(counts).toMatchObject({ refunded: 1, booked: 1, settled: 0, byHand: 0, refused: 0, unavailable: 0 });
    expect(world.refunds).toHaveLength(1);
    expect(world.payments.get('8701')).toMatchObject([
      { price: '-4.00', financial_account_id: MOLLIE_ACCOUNT, transaction_identifier: 're_1' },
    ]);
    expect(await creditNote(REFUNDED)).toEqual({ money_back: 'refunded', refund_id: 're_1', refund_cents: 400, in_the_books: true });

    const again = fresh();
    const later = new Date(NOW.getTime() + 60 * 60_000);
    await pushOrganisation(pool(), REFUNDED, later, SETTINGS, CONTEXT, again.budget, again.counts, {
      fetchImpl: world.impl,
      mollieApiKey: MOLLIE_KEY,
      ...noPace,
    });
    expect(again.counts).toMatchObject({ refunded: 0, booked: 0 });
    expect(world.refunds).toHaveLength(1);
  });

  it('waits without a Mollie key, says so, and writes nothing', async () => {
    const said = vi.spyOn(log, 'error').mockImplementation(() => {});
    const world = services();
    const { budget, counts } = fresh();
    await pushOrganisation(pool(), NO_KEY, NOW, SETTINGS, CONTEXT, budget, counts, { fetchImpl: world.impl, ...noPace });
    expect(counts).toMatchObject({ refunded: 0, unavailable: 1 });
    expect(world.calls).toEqual([]);
    expect(said.mock.calls.flat().join(' ')).toContain('MOLLIE_API_KEY is not set');
    expect((await creditNote(NO_KEY))!.money_back).toBeNull();
  });

  it('says a transfer by hand once, for an invoice not paid through Mollie, asking nobody', async () => {
    const said = vi.spyOn(log, 'error').mockImplementation(() => {});
    // The operator's mail (2026-10-11): told once, with the numbers and no name.
    const told: MoneyToGiveBackEvent[] = [];
    const tell = async (event: MoneyToGiveBackEvent) => void told.push(event);
    const world = services();
    const { budget, counts } = fresh();
    await pushOrganisation(pool(), BY_BANK, NOW, SETTINGS, CONTEXT, budget, counts, {
      fetchImpl: world.impl,
      mollieApiKey: MOLLIE_KEY,
      tell,
      ...noPace,
    });
    expect(counts).toMatchObject({ byHand: 1, refunded: 0 });
    expect(world.calls).toEqual([]);
    expect(said.mock.calls.flat().join(' ')).toContain('but not through Mollie: pay back what was paid above what is owed');
    expect((await creditNote(BY_BANK))!.money_back).toBe('by_hand');
    expect(told).toEqual([
      {
        kind: 'money_to_give_back',
        reason: 'by_hand',
        organisationId: BY_BANK,
        creditNote: expect.any(String),
        invoice: expect.any(String),
        cents: expect.any(Number),
      },
    ]);

    // Once: the next run says nothing more.
    said.mockClear();
    const again = fresh();
    await pushOrganisation(pool(), BY_BANK, new Date(NOW.getTime() + 60 * 60_000), SETTINGS, CONTEXT, again.budget, again.counts, {
      fetchImpl: world.impl,
      mollieApiKey: MOLLIE_KEY,
      tell,
      ...noPace,
    });
    expect(again.counts.byHand).toBe(0);
    expect(told).toHaveLength(1);
    expect(said.mock.calls.flat().join(' ')).not.toContain('not through Mollie');
  });
  it('says a refund Mollie ended failed once, and never books it', async () => {
    const said = vi.spyOn(log, 'error').mockImplementation(() => {});
    // Mollie takes the refund, then fails it before the books are told.
    const world = services('failed', 're_f');
    // The mail cannot go: said, and the run goes on (the support screen lists it).
    const told: MoneyToGiveBackEvent[] = [];
    const tell = async (event: MoneyToGiveBackEvent) => {
      told.push(event);
      throw new Error('SMTP is down');
    };
    const { budget, counts } = fresh();
    await pushOrganisation(pool(), FAILS, NOW, SETTINGS, CONTEXT, budget, counts, {
      fetchImpl: world.impl,
      mollieApiKey: MOLLIE_KEY,
      tell,
      ...noPace,
    });
    expect(counts).toMatchObject({ refunded: 1, refundsFailed: 1, refundsEnded: 0, booked: 0 });
    expect(said.mock.calls.flat().join(' ')).toContain(
      "Mollie's refund re_f1 of 400 cents for credit note 2026-0010 ended failed: the money did not go back. Pay it " +
        'back by transfer within 14 days of the withdrawal (terms §7); it was not booked in Moneybird, and will not be.',
    );
    expect(world.payments.get('8704')).toBeUndefined();
    expect(await followed(FAILS)).toEqual({ refund_status: 'failed', ended: true, late_said: false });
    expect(told).toEqual([
      {
        kind: 'money_to_give_back',
        reason: 'refund_failed',
        organisationId: FAILS,
        creditNote: '2026-0010',
        invoice: expect.any(String),
        cents: 400,
        refundId: 're_f1',
        inTheBooks: false,
      },
    ]);
    expect(said.mock.calls.flat().join(' ')).toContain('the operator could not be mailed about credit note 2026-0010');

    // Once: the next run says nothing, asks Mollie nothing, and books nothing.
    said.mockClear();
    const before = world.calls.length;
    const again = fresh();
    await pushOrganisation(pool(), FAILS, new Date(NOW.getTime() + 60 * 60_000), SETTINGS, CONTEXT, again.budget, again.counts, {
      fetchImpl: world.impl,
      mollieApiKey: MOLLIE_KEY,
      tell,
      ...noPace,
    });
    expect(again.counts).toMatchObject({ refundsFailed: 0, booked: 0 });
    expect(world.calls.slice(before).filter((c) => c.includes('api.mollie.com'))).toEqual([]);
    expect(world.payments.get('8704')).toBeUndefined();
    expect(said.mock.calls.flat().join(' ')).not.toContain('ended failed');
    expect(told).toHaveLength(1);
  });

  it('says a refund still queued a week on once, then lets it end quietly', async () => {
    const said = vi.spyOn(log, 'error').mockImplementation(() => {});
    const world = services('queued', 're_q');
    const told: MoneyToGiveBackEvent[] = [];
    const tell = async (event: MoneyToGiveBackEvent) => void told.push(event);
    const run = async (at: Date) => {
      const { budget, counts } = fresh();
      await pushOrganisation(pool(), QUEUED, at, SETTINGS, CONTEXT, budget, counts, {
        fetchImpl: world.impl,
        mollieApiKey: MOLLIE_KEY,
        tell,
        ...noPace,
      });
      return counts;
    };
    // Made, followed (queued, not late) and booked.
    expect(await run(NOW)).toMatchObject({ refunded: 1, booked: 1, refundsLate: 0 });
    expect(await followed(QUEUED)).toEqual({ refund_status: 'queued', ended: false, late_said: false });

    // A week on, still queued: said once.
    const week = new Date(NOW.getTime() + 7 * 86_400_000);
    expect(await run(week)).toMatchObject({ refundsLate: 1, refunded: 0 });
    expect(said.mock.calls.flat().join(' ')).toContain(
      "Mollie's refund re_q1 of 400 cents for credit note 2026-0010 is still queued 7 days after it was made.",
    );
    expect(told).toEqual([
      {
        kind: 'money_to_give_back',
        reason: 'refund_late',
        organisationId: QUEUED,
        creditNote: '2026-0010',
        invoice: expect.any(String),
        cents: 400,
        refundId: 're_q1',
        refundStatus: 'queued',
      },
    ]);
    said.mockClear();
    expect(await run(new Date(week.getTime() + 60 * 60_000))).toMatchObject({ refundsLate: 0 });
    expect(said.mock.calls.flat().join(' ')).not.toContain('still queued');

    // Mollie pays it out: it ends, said by nobody, and is asked after no more.
    world.refunds[0]!.status = 'refunded';
    expect(await run(new Date(week.getTime() + 2 * 60 * 60_000))).toMatchObject({ refundsEnded: 1, refundsLate: 0 });
    expect(said).not.toHaveBeenCalled();
    expect(await followed(QUEUED)).toEqual({ refund_status: 'refunded', ended: true, late_said: true });
    const before = world.calls.length;
    await run(new Date(week.getTime() + 3 * 60 * 60_000));
    expect(world.calls.slice(before).filter((c) => c.includes('api.mollie.com'))).toEqual([]);
    expect(told).toHaveLength(1);
  });
});
