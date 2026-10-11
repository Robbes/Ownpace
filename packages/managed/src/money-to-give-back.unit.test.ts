// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * MONEY TO GIVE BACK, WHERE THE OPERATOR SEES IT (workplan 0111; the owner,
 * 2026-10-11: "yes, build the support list and the email too"; managed 0055).
 *
 * The hourly push's three sentences that ask the operator to act were lines on
 * a run's output, gone with its container. The support screen now lists them
 * from what the invoice table records, and the operator marks one paid back:
 *
 *  - listed: paid but not through Mollie (the credit note's amount), a refund
 *    that failed or was canceled (the refund's), a refund still going a week
 *    on; never one settled, refunded and ended, or still going in time;
 *  - to an operator only: anybody else lists nothing and marks nothing;
 *  - marked once, in the operator's own name, never changed or taken back; a
 *    late refund takes no mark;
 *  - an erasure still purges a credit note that carries a mark.
 *
 * PGlite, both chains. The names, ids and numbers are invented.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from './migrate-managed.ts';
import { listMoneyToGiveBack, markMoneyGivenBack } from './money-to-give-back.ts';
import { purgeTenant, tenantRef } from './offboarding.ts';

// UUID family 01117d70-…, unused elsewhere in the repo.
const ORG = '01117d70-e29b-41d4-a716-446655440001';
const ERASED = '01117d70-e29b-41d4-a716-446655440002';
const OPERATOR = 'user-01117d70-operator';
const SOMEBODY = 'user-01117d70-somebody';
const ADMINISTRATION = '123456789012345678';
const NOW = new Date('2026-10-11T09:41:00Z');
const at = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString();

describe('money to give back', () => {
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

  type Conn = Awaited<ReturnType<LedgerDriver['acquire']>>;

  /** As a role the service runs as, in one transaction; as a subject when one is named. */
  async function as<T>(role: 'ownpace_system' | 'app_user', subject: string | null, run: (conn: Conn) => Promise<T>) {
    const conn = await driver.acquire();
    try {
      await conn.query('BEGIN');
      await conn.query(`SET LOCAL ROLE ${role}`);
      if (subject) await conn.query("SELECT set_config('app.current_user', $1, true)", [subject]);
      const result = await run(conn);
      await conn.query('COMMIT');
      return result;
    } catch (error) {
      await conn.query('ROLLBACK');
      throw error;
    } finally {
      await conn.release();
    }
  }

  /** An issued document in the books: an invoice of 12.00, or a credit note of 4.00 on one. */
  async function issued(tenant: string, corrects: string | null = null): Promise<{ id: string; number: string }> {
    made += 1;
    const id = `01117d70-e29b-41d4-a716-${String(446655440100 + made)}`;
    const credit = corrects !== null;
    const [subtotal, tax, total] = credit ? [-331, -69, -400] : [992, 208, 1200];
    await owner(
      `INSERT INTO invoice (id, tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total, reference,
                            kind, credited_invoice_id)
       VALUES ($1, $2, '2026-10-01', '2026-10-31', 'draft', $3, 0.21, $4, $5, $6, $7, $8)`,
      [id, tenant, subtotal, tax, total, `ownpace-${tenant}-m-2026-10-${made}`, credit ? 'credit_note' : 'invoice', corrects],
    );
    const number = `2026-${String(made).padStart(4, '0')}`;
    await owner(
      `UPDATE invoice SET status = 'sent', invoice_number = $2, invoice_date = '2026-10-01', moneybird_id = $3,
              moneybird_administration_id = $4, sent_at = now() WHERE id = $1`,
      [id, number, `70${made}`, ADMINISTRATION],
    );
    return { id, number };
  }

  /** A credit note on a fresh invoice, its money made real as the push writes it. */
  async function creditNote(
    tenant: string,
    shape: 'by_hand' | 'settled' | 'failed' | 'canceled' | 'late' | 'refunded_in_time' | 'refunded_ended',
    madeAt = at(-8),
  ) {
    const invoice = await issued(tenant);
    const note = await issued(tenant, invoice.id);
    if (shape === 'by_hand' || shape === 'settled') {
      await owner(`UPDATE invoice SET money_back = $2, money_back_at = $3 WHERE id = $1`, [note.id, shape, madeAt]);
      return { invoice, note };
    }
    await owner(
      `UPDATE invoice SET money_back = 'refunded', money_back_at = $2, refund_id = $3, refund_cents = 300 WHERE id = $1`,
      [note.id, madeAt, `re_${made}`],
    );
    if (shape === 'failed' || shape === 'canceled' || shape === 'refunded_ended') {
      const status = shape === 'refunded_ended' ? 'refunded' : shape;
      await owner(`UPDATE invoice SET refund_status = $2, refund_ended_at = $3 WHERE id = $1`, [note.id, status, at(-1)]);
    } else if (shape === 'late') {
      await owner(`UPDATE invoice SET refund_status = 'queued', refund_late_said_at = $2 WHERE id = $1`, [note.id, at(-1)]);
    } else {
      await owner(`UPDATE invoice SET refund_status = 'pending' WHERE id = $1`, [note.id]);
    }
    return { invoice, note };
  }

  const list = (subject: string) => as('app_user', subject, (conn) => listMoneyToGiveBack(conn.db));
  const mark = (subject: string, id: string) =>
    as('app_user', subject, (conn) => markMoneyGivenBack(conn.db, id, subject, NOW));

  beforeAll(async () => {
    driver = pgliteDriver({ role: 'app_user' });
    await runMigrations({ driver, logger: () => {} });
    await runManagedMigrations({ driver, logger: () => {} });
    await owner(`INSERT INTO tenant (id, name) VALUES ($1, 'Mutsaers BV'), ($2, 'Erased BV')`, [ORG, ERASED]);
    await owner(`INSERT INTO platform_operator (user_id, email, note) VALUES ($1, 'operator@ownpace.eu', 'money fixture')`, [
      OPERATOR,
    ]);
  }, 120_000);

  afterAll(async () => {
    await driver?.end();
  });

  let byHand: Awaited<ReturnType<typeof creditNote>>;
  let failed: Awaited<ReturnType<typeof creditNote>>;
  let canceled: Awaited<ReturnType<typeof creditNote>>;
  let late: Awaited<ReturnType<typeof creditNote>>;

  it('lists what is owed back by hand, or watched, and nothing else, oldest first', async () => {
    byHand = await creditNote(ORG, 'by_hand', at(-9));
    failed = await creditNote(ORG, 'failed');
    canceled = await creditNote(ORG, 'canceled');
    late = await creditNote(ORG, 'late');
    await creditNote(ORG, 'settled');
    await creditNote(ORG, 'refunded_in_time');
    await creditNote(ORG, 'refunded_ended');

    const listed = await list(OPERATOR);
    expect(listed.map((i) => [i.creditNoteNumber, i.reason, i.cents])).toEqual([
      [byHand.note.number, 'by_hand', 400],
      [failed.note.number, 'refund_failed', 300],
      [canceled.note.number, 'refund_canceled', 300],
      [late.note.number, 'refund_late', 300],
    ]);
    expect(listed[0]).toMatchObject({
      tenantId: ORG,
      organisation: 'Mutsaers BV',
      invoiceNumber: byHand.invoice.number,
      currency: 'EUR',
      refundId: null,
      givenBackAt: null,
    });
    expect(listed[3]).toMatchObject({ refundStatus: 'queued', refundId: expect.stringMatching(/^re_/) });
    expect(listed[1]!.refundInTheBooks).toBe(false);
  });

  it('shows it to an operator and nobody else, who marks nothing', async () => {
    expect(await list(SOMEBODY)).toEqual([]);
    expect(await mark(SOMEBODY, byHand.note.id)).toBe('not_found');
    expect((await owner('SELECT count(*)::int AS n FROM money_given_back')).rows[0]).toEqual({ n: 0 });
  });

  it("marks one paid back once, in the operator's name; a late refund takes no mark", async () => {
    expect(await mark(OPERATOR, byHand.note.id)).toBe('marked');
    expect(await mark(OPERATOR, byHand.note.id)).toBe('already');
    expect(await mark(OPERATOR, failed.note.id)).toBe('marked');
    expect(await mark(OPERATOR, late.note.id)).toBe('watched');
    expect(await mark(OPERATOR, '01117d70-e29b-41d4-a716-446655449999')).toBe('not_found');

    const listed = await list(OPERATOR);
    expect(listed.map((i) => [i.creditNoteNumber, i.givenBackAt !== null])).toEqual([
      [canceled.note.number, false],
      [late.note.number, false],
      [byHand.note.number, true],
      [failed.note.number, true],
    ]);
    expect(listed[2]).toMatchObject({ givenBackAt: NOW.toISOString(), givenBackBy: 'operator@ownpace.eu' });
  });

  it('never changes or takes back a mark, and writes none in another name', async () => {
    await expect(
      as('app_user', OPERATOR, (conn) => conn.query('UPDATE money_given_back SET given_back_at = now()')),
    ).rejects.toThrow(/permission denied/);
    await expect(as('app_user', OPERATOR, (conn) => conn.query('DELETE FROM money_given_back'))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      as('app_user', OPERATOR, (conn) =>
        conn.query('INSERT INTO money_given_back (invoice_id, given_back_by) VALUES ($1, $2)', [canceled.note.id, SOMEBODY]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('still lets an erasure purge a credit note that carries a mark', async () => {
    const gone = await creditNote(ERASED, 'by_hand');
    expect(await mark(OPERATOR, gone.note.id)).toBe('marked');
    await owner(`INSERT INTO erasure_record (tenant_ref, requested_at, window_days) VALUES ($1, $2, 0)`, [
      tenantRef(ERASED),
      NOW.toISOString(),
    ]);
    await owner("UPDATE tenant SET status = 'deleting' WHERE id = $1", [ERASED]);

    const result = await as('ownpace_system', null, (conn) => purgeTenant(conn.db, ERASED, NOW));
    expect(result.invoiceNumbers).toEqual([gone.invoice.number, gone.note.number].sort());
    expect((await owner('SELECT 1 FROM money_given_back WHERE invoice_id = $1', [gone.note.id])).rows).toEqual([]);
  });
});
