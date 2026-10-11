// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REFUND FOLLOWED TO ITS END (workplan 0111, T7, slice 7d; managed 0053):
 * `refund-follow.ts`, on a real database as `app_user`, with a Mollie of its
 * own.
 *
 *  - followed: each refund that has not ended is listed with the payment it
 *    refunds; Mollie's word is read from the payment's refunds, and a refund
 *    still going seven days after it was made is late;
 *  - written once: a new word is written, the same word again is not, an end
 *    is stamped and then nothing moves, and the late word is written once;
 *  - a refund Mollie ended failed or canceled is not booked in the books;
 *  - the database refuses a status without a refund, an end without an ending
 *    word, and any change to an end or a late word.
 *
 * PGlite, both chains. The names, ids and keys are invented, and nothing is
 * contacted.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import type { TenantId } from '@openmig/shared';
import { runManagedMigrations } from './migrate-managed.ts';
import { claimNextRefundToBook, recordMoneyBack } from './money-back.ts';
import {
  followRefund,
  recordRefundLateSaid,
  recordRefundStatus,
  refundsToFollow,
  REFUND_LATE_DAYS,
  type RefundToFollow,
} from './refund-follow.ts';

// UUID family 01117d40-…, unused elsewhere in the repo.
const ORG = '01117d40-e29b-41d4-a716-446655440001' as TenantId;
const ADMINISTRATION = '123456789012345678';
const MOLLIE_KEY = 'test_not-a-real-key';
const NOW = new Date('2026-10-11T09:41:00Z');
const DAY = 86_400_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A Mollie whose payment holds these refunds, every call kept. */
function mollie(refunds: unknown[], status = 200) {
  const calls: string[] = [];
  const impl = (async (url: unknown) => {
    calls.push(String(url));
    return status === 200 ? json({ _embedded: { refunds } }) : json({ detail: 'Mollie is down' }, status);
  }) as typeof fetch;
  return { impl, calls };
}

const refund = (id: string, status: string, creditNote = 'x') => ({
  id,
  amount: { currency: 'EUR', value: '4.00' },
  status,
  metadata: { creditNote },
});

const toFollow = (over: Partial<RefundToFollow> = {}): RefundToFollow => ({
  id: 'c',
  reference: 'ownpace-x-c-2026-10-small',
  invoiceNumber: '2026-0010',
  creditedInvoiceNumber: '2026-0009',
  refundId: 're_made',
  refundCents: 400,
  paymentId: 'tr_paid',
  status: null,
  madeAt: NOW,
  lateSaid: false,
  inTheBooks: true,
  ...over,
});

describe('followRefund', () => {
  it("reads Mollie's word on the refund from the payment's refunds", async () => {
    const { impl, calls } = mollie([refund('re_other', 'refunded'), refund('re_made', 'pending')]);
    expect(await followRefund(MOLLIE_KEY, toFollow(), NOW, impl)).toEqual({ kind: 'read', status: 'pending', late: false });
    expect(calls).toEqual(['https://api.mollie.com/v2/payments/tr_paid/refunds?limit=250']);
  });

  it(`is late still going ${REFUND_LATE_DAYS} days after it was made, and never once ended`, async () => {
    const week = new Date(NOW.getTime() + REFUND_LATE_DAYS * DAY);
    const almost = new Date(week.getTime() - 60_000);
    expect(await followRefund(MOLLIE_KEY, toFollow(), almost, mollie([refund('re_made', 'queued')]).impl)).toEqual({
      kind: 'read',
      status: 'queued',
      late: false,
    });
    expect(await followRefund(MOLLIE_KEY, toFollow(), week, mollie([refund('re_made', 'queued')]).impl)).toEqual({
      kind: 'read',
      status: 'queued',
      late: true,
    });
    for (const ended of ['refunded', 'failed', 'canceled'] as const) {
      expect(await followRefund(MOLLIE_KEY, toFollow(), week, mollie([refund('re_made', ended)]).impl)).toEqual({
        kind: 'read',
        status: ended,
        late: false,
      });
    }
  });

  it('says what it cannot read: Mollie down, a refund not listed, a word it does not know', async () => {
    expect(await followRefund(MOLLIE_KEY, toFollow(), NOW, mollie([], 503).impl)).toMatchObject({ kind: 'unavailable' });
    expect(await followRefund(MOLLIE_KEY, toFollow(), NOW, mollie([refund('re_other', 'pending')]).impl)).toEqual({
      kind: 'unavailable',
      reason: 'credit note 2026-0010: Mollie lists no refund re_made on payment tr_paid',
    });
    expect(await followRefund(MOLLIE_KEY, toFollow(), NOW, mollie([refund('re_made', 'reversed')]).impl)).toMatchObject({
      kind: 'unavailable',
      reason: expect.stringContaining("'reversed'"),
    });
  });
});

describe('a refund followed, on a real database', () => {
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

  /** An invoice paid through Mollie, and its issued credit note of 400, refunded (`re_…`) or settled. */
  async function creditNote(moneyBack: 'refunded' | 'settled', refundId = `re_${made + 2}`): Promise<string> {
    made += 1;
    const original = `01117d40-e29b-41d4-a716-${String(446655440100 + made)}`;
    await owner(
      `INSERT INTO invoice (id, tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total, reference)
       VALUES ($1, $2, '2026-10-01', '2026-10-31', 'draft', 992, 0.21, 208, 1200, $3)`,
      [original, ORG, `ownpace-${ORG}-m-2026-10-${made}`],
    );
    await owner(
      `UPDATE invoice SET status = 'sent', invoice_number = $2, invoice_date = '2026-10-01', moneybird_id = $3,
              moneybird_administration_id = $4, sent_at = now() WHERE id = $1`,
      [original, `2026-${String(made).padStart(4, '0')}`, `70${made}`, ADMINISTRATION],
    );
    await owner(
      `UPDATE invoice SET status = 'paid', paid_at = '2026-10-05T21:30:00Z', payment_id = $2, paid_cents = 1200 WHERE id = $1`,
      [original, `tr_${made}`],
    );
    made += 1;
    const id = `01117d40-e29b-41d4-a716-${String(446655440100 + made)}`;
    await owner(
      `INSERT INTO invoice (id, tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total, reference,
                            kind, credited_invoice_id)
       VALUES ($1, $2, '2026-10-01', '2026-10-31', 'draft', -331, 0.21, -69, -400, $3, 'credit_note', $4)`,
      [id, ORG, `ownpace-${ORG}-c-2026-10-${made}`, original],
    );
    await owner(
      `UPDATE invoice SET status = 'sent', invoice_number = $2, invoice_date = '2026-10-11', moneybird_id = $3,
              moneybird_administration_id = $4, sent_at = now() WHERE id = $1`,
      [id, `2026-${String(made).padStart(4, '0')}`, `80${made}`, ADMINISTRATION],
    );
    await withTenant(driver, ORG, (db) =>
      recordMoneyBack(
        db,
        ORG,
        id,
        moneyBack === 'refunded' ? { kind: 'refunded', refundId, cents: 400, adopted: false } : { kind: 'settled', before: false },
        NOW,
      ),
    );
    return id;
  }

  const rowOf = async (id: string) =>
    (
      await owner(
        `SELECT refund_status, refund_ended_at IS NOT NULL AS ended, refund_late_said_at IS NOT NULL AS late_said
           FROM invoice WHERE id = $1`,
        [id],
      )
    ).rows[0] as Record<string, unknown>;

  const following = () => withTenant(driver, ORG, (db) => refundsToFollow(db, ORG));

  beforeAll(async () => {
    driver = pgliteDriver({ role: 'app_user' });
    await runMigrations({ driver, logger: () => {} });
    await runManagedMigrations({ driver, logger: () => {} });
    await owner(`INSERT INTO tenant (id, name) VALUES ($1, 'Followed Refunds BV')`, [ORG]);
  }, 120_000);

  afterAll(async () => {
    await driver?.end();
  });

  it('lists each refund that has not ended, with the payment it refunds, and writes each new word once', async () => {
    const note = await creditNote('refunded', 're_followed');
    await creditNote('settled');

    const [listed, ...rest] = await following();
    expect(rest).toEqual([]);
    expect(listed).toMatchObject({
      id: note,
      refundId: 're_followed',
      refundCents: 400,
      paymentId: `tr_${made - 3}`,
      status: null,
      lateSaid: false,
      inTheBooks: false,
    });
    expect(listed!.madeAt.toISOString()).toBe(NOW.toISOString());

    const write = (status: Parameters<typeof recordRefundStatus>[3]) =>
      withTenant(driver, ORG, (db) => recordRefundStatus(db, ORG, note, status, NOW));
    expect(await write('queued')).toBe(true);
    // The same word again writes nothing.
    expect(await write('queued')).toBe(false);
    expect(await write('pending')).toBe(true);
    expect(await rowOf(note)).toEqual({ refund_status: 'pending', ended: false, late_said: false });
    expect((await following())[0]).toMatchObject({ id: note, status: 'pending' });

    // The end, stamped, and then nothing moves: the writer writes nothing...
    expect(await write('refunded')).toBe(true);
    expect(await rowOf(note)).toEqual({ refund_status: 'refunded', ended: true, late_said: false });
    expect(await write('failed')).toBe(false);
    expect(await following()).toEqual([]);
    // ...and the database refuses a change to the end.
    await expect(owner(`UPDATE invoice SET refund_status = 'failed' WHERE id = $1`, [note])).rejects.toThrow(/written once/);
  });

  it('says a late refund once, and the database writes that once', async () => {
    const note = await creditNote('refunded');
    const late = () => withTenant(driver, ORG, (db) => recordRefundLateSaid(db, ORG, note, NOW));
    expect(await late()).toBe(true);
    expect(await late()).toBe(false);
    expect((await following()).find((r) => r.id === note)).toMatchObject({ lateSaid: true });
    await expect(owner(`UPDATE invoice SET refund_late_said_at = now() + interval '1 day' WHERE id = $1`, [note])).rejects.toThrow(
      /written once/,
    );
  });

  it('books no refund Mollie ended failed or canceled, and books one still going', async () => {
    const failed = await creditNote('refunded');
    const canceled = await creditNote('refunded');
    const going = await creditNote('refunded');
    await withTenant(driver, ORG, (db) => recordRefundStatus(db, ORG, failed, 'failed', NOW));
    await withTenant(driver, ORG, (db) => recordRefundStatus(db, ORG, canceled, 'canceled', NOW));
    await withTenant(driver, ORG, (db) => recordRefundStatus(db, ORG, going, 'processing', NOW));

    const claimed: string[] = [];
    for (;;) {
      const next = await withTenant(driver, ORG, (db) => claimNextRefundToBook(db, ORG, NOW));
      if (!next) break;
      claimed.push(next.id);
    }
    expect(claimed).toContain(going);
    expect(claimed).not.toContain(failed);
    expect(claimed).not.toContain(canceled);
  });

  it('refuses a status without a refund, and an end without an ending word', async () => {
    const settled = await creditNote('settled');
    await expect(owner(`UPDATE invoice SET refund_status = 'pending' WHERE id = $1`, [settled])).rejects.toThrow(
      /invoice_refund_followed_check/,
    );
    const note = await creditNote('refunded');
    await expect(
      owner(`UPDATE invoice SET refund_status = 'pending', refund_ended_at = now() WHERE id = $1`, [note]),
    ).rejects.toThrow(/invoice_refund_followed_check/);
    await expect(owner(`UPDATE invoice SET refund_status = 'refunded' WHERE id = $1`, [note])).rejects.toThrow(
      /invoice_refund_followed_check/,
    );
    await expect(owner(`UPDATE invoice SET refund_status = 'reversed' WHERE id = $1`, [note])).rejects.toThrow(
      /invoice_refund_followed_check/,
    );
  });
});
