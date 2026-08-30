// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * An update the invoice refuses (managed migration 0014; workplan 0111
 * §"The refusal, designed", landed early by owner decision 2026-08-30).
 *
 * ADR-0044 says an issued invoice is immutable and the correction instrument
 * is a credit note. Until 0014 that was a convention: `invoice.status` was
 * freely writable, and the generation upsert's own guard skipped only
 * paid/void — a SENT invoice's amounts could be rewritten by a re-run. This
 * file holds the refusal to its shape, one arm per case:
 *
 * - the writers the product actually has (regeneration on a draft, the pay
 *   route's draft→sent, the webhook's sent→paid) pass BY CONSTRUCTION;
 * - amount edits past draft refuse citing the credit note;
 * - illegal transitions refuse naming both states, terminal states are
 *   final;
 * - identity/period columns are a column-privilege refusal for app_user
 *   whatever the status;
 * - the trigger fires for the OWNER too — the sharpest arm, because "the
 *   grants don't apply to me" is exactly the hole a trigger exists to close;
 * - the erasure detach (owner path, billed_to_name + tenant_id) keeps
 *   working until T10 replaces detach with purge;
 * - and the catalog pin: app_user's UPDATE surface on `invoice` is EXACTLY
 *   the granted list, both directions, so a new column cannot be added
 *   without deciding its class (the `a-rate-that-must-not-spread` style).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from './migrate-managed.ts';

// UUID family 0119…, unused elsewhere in the repo.
const TENANT_A = '01190000-e29b-41d4-a716-446655442001';
const DRAFT = '01190000-e29b-41d4-a716-446655442101';
const SENT = '01190000-e29b-41d4-a716-446655442102';
const PAID = '01190000-e29b-41d4-a716-446655442103';

let driver: LedgerDriver;

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  const conn = await driver.acquire();
  try {
    await conn.query('DELETE FROM invoice');
    await conn.query('DELETE FROM tenant');
    await conn.query(`INSERT INTO tenant (id, name, status) VALUES ($1,'A','active')`, [
      TENANT_A,
    ]);
    // One invoice per status the cases need; distinct periods for the
    // (tenant, period_start) unique index. INSERT is untouched by 0014 —
    // only UPDATE carries the machine.
    await conn.query(
      `INSERT INTO invoice (id, tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total, currency)
       VALUES ($1,$4,'2026-01-01','2026-01-31','draft','1000','0.21','210','1210','EUR'),
              ($2,$4,'2026-02-01','2026-02-28','sent', '1000','0.21','210','1210','EUR'),
              ($3,$4,'2026-03-01','2026-03-31','paid', '1000','0.21','210','1210','EUR')`,
      [DRAFT, SENT, PAID, TENANT_A],
    );
  } finally {
    conn.release();
  }
});

/** Drizzle wraps PG errors ("Failed query: …"); walk the cause chain so the
 *  assertion reads the database's own sentence, not the wrapper's. */
async function refusalOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const messages: string[] = [];
    let current: unknown = error;
    while (current) {
      messages.push(current instanceof Error ? current.message : String(current));
      current = current instanceof Error ? current.cause : undefined;
    }
    return messages.join(' :: ');
  }
  throw new Error('expected the statement to be refused, and it was not');
}

const asTenant = (statement: ReturnType<typeof sql>) =>
  withTenant(driver, TENANT_A, async (db) => db.execute(statement));

const statusOf = async (id: string): Promise<string> => {
  const conn = await driver.acquire();
  try {
    const { rows } = await conn.query<{ status: string }>(
      'SELECT status FROM invoice WHERE id = $1',
      [id],
    );
    return rows[0]!.status;
  } finally {
    conn.release();
  }
};

describe('the writers the product has pass by construction', () => {
  it('regeneration rewrites a DRAFT: amounts, metadata, updated_at', async () => {
    await asTenant(
      sql`UPDATE invoice
             SET subtotal = '2000', tax_rate = '0.21', tax_amount = '420',
                 total = '2420', metadata = '{"regenerated":true}'::jsonb,
                 updated_at = now()
           WHERE id = ${DRAFT}::uuid AND status = 'draft'`,
    );
    const conn = await driver.acquire();
    try {
      const { rows } = await conn.query<{ total: string }>(
        'SELECT total FROM invoice WHERE id = $1',
        [DRAFT],
      );
      expect(rows[0]!.total).toBe('2420');
    } finally {
      conn.release();
    }
  });

  it('the pay route sends a draft: draft → sent with payment_id + metadata', async () => {
    await asTenant(
      sql`UPDATE invoice
             SET status = 'sent', payment_id = 'tr_test',
                 metadata = '{"mollieInvoiceId":"tr_test"}'::jsonb, updated_at = now()
           WHERE id = ${DRAFT}::uuid`,
    );
    expect(await statusOf(DRAFT)).toBe('sent');
  });

  it('the webhook lands a payment: sent → paid with paid_at', async () => {
    await asTenant(
      sql`UPDATE invoice SET status = 'paid', paid_at = now(), updated_at = now()
           WHERE id = ${SENT}::uuid`,
    );
    expect(await statusOf(SENT)).toBe('paid');
  });

  it('a same-to-same touch does not throw (idempotent re-delivery)', async () => {
    await asTenant(
      sql`UPDATE invoice SET status = 'sent', updated_at = now() WHERE id = ${SENT}::uuid`,
    );
    expect(await statusOf(SENT)).toBe('sent');
  });
});

describe('the refusals', () => {
  it('amounts on a SENT invoice refuse, citing the credit note', async () => {
    expect(
      await refusalOf(asTenant(sql`UPDATE invoice SET total = '9999' WHERE id = ${SENT}::uuid`)),
    ).toMatch(/credit note/i);
  });

  it('sent → draft is an illegal transition, named as such', async () => {
    expect(
      await refusalOf(
        asTenant(sql`UPDATE invoice SET status = 'draft' WHERE id = ${SENT}::uuid`),
      ),
    ).toMatch(/illegal status transition sent -> draft/i);
  });

  it('paid is final: paid → void refuses (undo is a credit note)', async () => {
    expect(
      await refusalOf(asTenant(sql`UPDATE invoice SET status = 'void' WHERE id = ${PAID}::uuid`)),
    ).toMatch(/illegal status transition paid -> void/i);
  });

  it('period identity is closed to the app on ANY status: column privilege', async () => {
    expect(
      await refusalOf(
        asTenant(sql`UPDATE invoice SET period_start = '2027-01-01' WHERE id = ${DRAFT}::uuid`),
      ),
    ).toMatch(/permission denied/i);
  });

  it('the trigger fires for the OWNER too — no quiet role exception', async () => {
    const conn = await driver.acquire();
    try {
      await expect(
        conn.query(`UPDATE invoice SET total = '9999' WHERE id = $1`, [SENT]),
      ).rejects.toThrow(/credit note/i);
    } finally {
      conn.release();
    }
  });
});

describe('what deliberately keeps working', () => {
  it('the erasure detach (owner path) stamps billed_to_name and orphans tenant_id, paid or not', async () => {
    const conn = await driver.acquire();
    try {
      await conn.query(
        `UPDATE invoice SET billed_to_name = 'Jansen', tenant_id = NULL WHERE id = $1`,
        [PAID],
      );
      const { rows } = await conn.query<{ billed_to_name: string; tenant_id: string | null }>(
        'SELECT billed_to_name, tenant_id FROM invoice WHERE id = $1',
        [PAID],
      );
      expect(rows[0]).toMatchObject({ billed_to_name: 'Jansen', tenant_id: null });
    } finally {
      conn.release();
    }
  });
});

describe('the catalog pin', () => {
  it("app_user's UPDATE surface on invoice is EXACTLY the granted list, both directions", async () => {
    // A new column added without deciding its class (document? lifecycle?)
    // lands in neither list and goes red here — the point is that the
    // decision cannot be skipped, not any particular answer.
    const GRANTED = [
      'metadata',
      'paid_at',
      'payment_id',
      'payment_method',
      'sent_at',
      'status',
      'subtotal',
      'tax_amount',
      'tax_rate',
      'total',
      'updated_at',
    ];
    const conn = await driver.acquire();
    try {
      const { rows } = await conn.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.column_privileges
          WHERE grantee = 'app_user' AND table_name = 'invoice'
            AND privilege_type = 'UPDATE'
          ORDER BY column_name`,
      );
      expect(rows.map((r) => r.column_name)).toEqual(GRANTED);
    } finally {
      conn.release();
    }
  });
});
