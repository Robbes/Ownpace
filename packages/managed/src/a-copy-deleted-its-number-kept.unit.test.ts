// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A COPY DELETED, ITS NUMBER KEPT (workplan 0111 T10; ADR-0044; the owner,
 * 2026-10-03: "delete the copy, keep the numbers"; managed 0054).
 *
 * The books keep the invoices, so the purge of an erased organisation deletes
 * our copy of each invoice and credit note they hold, and each draft, and keeps
 * their Moneybird numbers on the erasure record. An issued invoice the books do
 * not hold is the only record of itself: detached and kept, as before.
 *
 *  - the purge, as the tasks' system role (the way the hourly purge runs it):
 *    the copies the books hold go, credit notes first, their numbers stay, a
 *    draft goes with no number, an invoice the books do not hold is detached;
 *  - only an erasure deletes an invoice: `app_user` and the system role are
 *    refused an invoice of an organisation that is not `deleting`, and an
 *    issued invoice the books do not hold even when it is; the owner's
 *    connection is not held to it;
 *  - the operator's view lists the numbers by the erasure's hash, and nobody
 *    else sees them.
 *
 * PGlite, both chains. The names, ids and numbers are invented.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from './migrate-managed.ts';
import { purgeTenant, tenantRef } from './offboarding.ts';

// UUID family 01117d60-…, unused elsewhere in the repo.
const ERASED = '01117d60-e29b-41d4-a716-446655440001';
const LIVE = '01117d60-e29b-41d4-a716-446655440002';
const OPERATOR = 'user-01117d60-operator';
const ADMINISTRATION = '123456789012345678';
const NOW = new Date('2026-10-11T09:41:00Z');

describe('a copy deleted, its number kept', () => {
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

  /** As a role the service runs as, in one transaction, rolled back or committed. */
  async function as<T>(role: 'ownpace_system' | 'app_user', run: (conn: Awaited<ReturnType<LedgerDriver['acquire']>>) => Promise<T>) {
    const conn = await driver.acquire();
    try {
      await conn.query('BEGIN');
      await conn.query(`SET LOCAL ROLE ${role}`);
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

  /** An invoice, a draft, issued in the books (a number), or issued before them (none). */
  async function invoice(
    tenant: string,
    shape: 'in_the_books' | 'before_the_books' | 'draft',
    kind: 'invoice' | 'credit_note' = 'invoice',
    corrects: string | null = null,
  ): Promise<{ id: string; number: string | null }> {
    made += 1;
    const id = `01117d60-e29b-41d4-a716-${String(446655440100 + made)}`;
    const [subtotal, tax, total] = kind === 'credit_note' ? [-331, -69, -400] : [992, 208, 1200];
    // One issued before the books is as the retired generator left it: paid, with no number,
    // inserted so, since 0045 refuses a step out of draft without the books' number and id.
    const status = shape === 'before_the_books' ? 'paid' : 'draft';
    await owner(
      `INSERT INTO invoice (id, tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total, reference,
                            kind, credited_invoice_id)
       VALUES ($1, $2, '2026-10-01', '2026-10-31', $3, $4, 0.21, $5, $6, $7, $8, $9)`,
      [id, tenant, status, subtotal, tax, total, `ownpace-${tenant}-m-2026-10-${made}`, kind, corrects],
    );
    if (shape !== 'in_the_books') return { id, number: null };
    const number = `2026-${String(made).padStart(4, '0')}`;
    await owner(
      `UPDATE invoice SET status = 'sent', invoice_number = $2, invoice_date = '2026-10-01', moneybird_id = $3,
              moneybird_administration_id = $4, sent_at = now() WHERE id = $1`,
      [id, number, `70${made}`, ADMINISTRATION],
    );
    return { id, number };
  }

  const exists = async (id: string) => (await owner('SELECT 1 FROM invoice WHERE id = $1', [id])).rows.length === 1;

  beforeAll(async () => {
    driver = pgliteDriver({ role: 'app_user' });
    await runMigrations({ driver, logger: () => {} });
    await runManagedMigrations({ driver, logger: () => {} });
    await owner(`INSERT INTO tenant (id, name) VALUES ($1, 'Erased BV'), ($2, 'Live BV')`, [ERASED, LIVE]);
    await owner(`INSERT INTO platform_operator (user_id, email, note) VALUES ($1, 'operator@ownpace.eu', '0111 T10 fixture')`, [
      OPERATOR,
    ]);
  }, 120_000);

  afterAll(async () => {
    await driver?.end();
  });

  it('refuses app_user and the system role an invoice of an organisation that is not being erased', async () => {
    const issued = await invoice(LIVE, 'in_the_books');
    const draft = await invoice(LIVE, 'draft');
    for (const one of [issued, draft]) {
      await expect(
        as('app_user', async (conn) => {
          await conn.query("SELECT set_config('app.current_tenant', $1, true)", [LIVE]);
          await conn.query('DELETE FROM invoice WHERE id = $1', [one.id]);
        }),
      ).rejects.toThrow(/only its organisation's erasure deletes an invoice/);
    }
    await expect(as('ownpace_system', (conn) => conn.query('DELETE FROM invoice WHERE id = $1', [issued.id]))).rejects.toThrow(
      /only its organisation's erasure deletes an invoice/,
    );
    expect(await exists(issued.id)).toBe(true);
    expect(await exists(draft.id)).toBe(true);
  });

  it('purges as the system role: the copies the books hold go and their numbers stay, the rest is detached', async () => {
    const paid = await invoice(ERASED, 'in_the_books');
    const credit = await invoice(ERASED, 'in_the_books', 'credit_note', paid.id);
    const draft = await invoice(ERASED, 'draft');
    const before = await invoice(ERASED, 'before_the_books');

    // As the purge task leaves it: the receipt written at close, the organisation `deleting`.
    await owner(`INSERT INTO erasure_record (tenant_ref, requested_at, window_days) VALUES ($1, $2, 0)`, [
      tenantRef(ERASED),
      NOW.toISOString(),
    ]);
    await owner("UPDATE tenant SET status = 'deleting' WHERE id = $1", [ERASED]);

    // An issued invoice the books do not hold may not go, even while erasing.
    await expect(as('ownpace_system', (conn) => conn.query('DELETE FROM invoice WHERE id = $1', [before.id]))).rejects.toThrow(
      /only its organisation's erasure deletes an invoice/,
    );

    const result = await as('ownpace_system', (conn) => purgeTenant(conn.db, ERASED, NOW));
    expect(result.invoiceNumbers).toEqual([paid.number, credit.number].sort());
    expect(result.counts.invoice).toBe(3);
    expect(result.retainedInvoiceIds).toEqual([before.id]);
    for (const gone of [paid, credit, draft]) expect(await exists(gone.id)).toBe(false);
    expect((await owner('SELECT tenant_id, billed_to_name FROM invoice WHERE id = $1', [before.id])).rows[0]).toEqual({
      tenant_id: null,
      billed_to_name: 'Erased BV',
    });
    expect(
      (await owner('SELECT invoice_numbers, retained_invoice_ids FROM erasure_record WHERE tenant_ref = $1', [tenantRef(ERASED)]))
        .rows[0],
    ).toEqual({ invoice_numbers: [paid.number, credit.number].sort(), retained_invoice_ids: [before.id] });
  });

  it("shows the numbers to an operator by the erasure's hash, and to nobody else", async () => {
    const read = (user: string) =>
      as('app_user', async (conn) => {
        await conn.query("SELECT set_config('app.current_user', $1, true)", [user]);
        return (await conn.query('SELECT tenant_ref, invoice_numbers FROM support_erased_invoice_numbers')).rows;
      });
    expect(await read(OPERATOR)).toEqual([
      { tenant_ref: tenantRef(ERASED), invoice_numbers: expect.arrayContaining([expect.stringMatching(/^2026-\d{4}$/)]) },
    ]);
    expect(await read('user-01117d60-somebody')).toEqual([]);
  });

  it("does not hold the owner's connection to it: an operator at the database may still delete", async () => {
    const issued = await invoice(LIVE, 'in_the_books');
    await owner('DELETE FROM invoice WHERE id = $1', [issued.id]);
    expect(await exists(issued.id)).toBe(false);
  });
});
