// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * An update the invoice refuses (managed migration 0014; workplan 0111
 * §"The refusal, designed", landed early by owner decision 2026-08-30;
 * extended by managed 0045, the mirror, slice 3 of §"The build, sliced").
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
 *
 * Since 0045, issued means numbered: draft → sent needs Moneybird's number and
 * id (the pay route's old draft → sent is refused, and the route no longer
 * makes it); Moneybird's facts are written once; a row is born without a
 * number; and the column pin classifies EVERY column of the table and checks
 * that each one the document is made of is in the trigger's freeze, so a new
 * column cannot stay editable after issue unnoticed.
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
    // The draft carries our reference, as every row the month task makes
    // will (0045); the sent and paid rows are the retired generator's kind,
    // issued without a number or a reference, which 0045 leaves standing.
    await conn.query(
      `INSERT INTO invoice (id, tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total, currency, reference)
       VALUES ($1,$4,'2026-01-01','2026-01-31','draft','1000','0.21','210','1210','EUR','ownpace-a-m-2026-01-small'),
              ($2,$4,'2026-02-01','2026-02-28','sent', '1000','0.21','210','1210','EUR',NULL),
              ($3,$4,'2026-03-01','2026-03-31','paid', '1000','0.21','210','1210','EUR',NULL)`,
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

  it('the push issues a draft: what it sent, then draft → sent with Moneybird’s number, id and date', async () => {
    await asTenant(
      sql`UPDATE invoice
             SET vat_treatment = 'domestic_standard', tax_rate_id = '611',
                 lines = '[{"description":"Ownpace Medium, oktober 2026","price":"12.00"}]'::jsonb,
                 updated_at = now()
           WHERE id = ${DRAFT}::uuid AND status = 'draft'`,
    );
    await asTenant(
      sql`UPDATE invoice
             SET status = 'sent', invoice_number = '2026-0001', invoice_date = '2026-10-01',
                 moneybird_id = '555000111', moneybird_administration_id = '123456789012345678',
                 sent_at = now(), updated_at = now()
           WHERE id = ${DRAFT}::uuid`,
    );
    expect(await statusOf(DRAFT)).toBe('sent');
  });

  it('the pay route records a payment on an issued invoice: payment_id, metadata added to', async () => {
    await asTenant(
      sql`UPDATE invoice
             SET payment_id = 'tr_test',
                 metadata = metadata || '{"mollieInvoiceId":"tr_test"}'::jsonb, updated_at = now()
           WHERE id = ${SENT}::uuid`,
    );
    expect(await statusOf(SENT)).toBe('sent');
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

  it('draft → sent without Moneybird’s number is refused: the pay route’s old write, named', async () => {
    expect(
      await refusalOf(
        asTenant(
          sql`UPDATE invoice
                 SET status = 'sent', payment_id = 'tr_test',
                     metadata = '{"mollieInvoiceId":"tr_test"}'::jsonb, updated_at = now()
               WHERE id = ${DRAFT}::uuid`,
        ),
      ),
    ).toMatch(/draft -> sent needs Moneybird's number and id/);
    expect(await statusOf(DRAFT)).toBe('draft');
  });

  it('a draft carries no number', async () => {
    expect(
      await refusalOf(
        asTenant(
          sql`UPDATE invoice
                 SET invoice_number = '2026-0001', invoice_date = '2026-10-01',
                     moneybird_id = '555', moneybird_administration_id = '123'
               WHERE id = ${DRAFT}::uuid`,
        ),
      ),
    ).toMatch(/invoice_numbered_check/);
  });

  it('Moneybird’s number is written once: an issued number never changes, even by the owner', async () => {
    await asTenant(
      sql`UPDATE invoice
             SET status = 'sent', invoice_number = '2026-0001', invoice_date = '2026-10-01',
                 moneybird_id = '555000111', moneybird_administration_id = '123456789012345678'
           WHERE id = ${DRAFT}::uuid`,
    );
    const conn = await driver.acquire();
    try {
      await expect(
        conn.query(`UPDATE invoice SET invoice_number = '2026-0002' WHERE id = $1`, [DRAFT]),
      ).rejects.toThrow(/written once/i);
    } finally {
      conn.release();
    }
  });

  it('past draft the mirror’s document columns are frozen too, citing the credit note', async () => {
    for (const assignment of [
      sql`lines = '[{"description":"another"}]'::jsonb`,
      sql`vat_treatment = 'reverse_charge'`,
      sql`tax_rate_id = '999'`,
    ]) {
      expect(
        await refusalOf(asTenant(sql`UPDATE invoice SET ${assignment} WHERE id = ${SENT}::uuid`)),
      ).toMatch(/credit note/i);
    }
    const conn = await driver.acquire();
    try {
      for (const statement of [
        `UPDATE invoice SET reference = 'another' WHERE id = $1`,
        `UPDATE invoice SET evidence = '{"peak":99}'::jsonb WHERE id = $1`,
      ]) {
        await expect(conn.query(statement, [SENT])).rejects.toThrow(/credit note/i);
      }
    } finally {
      conn.release();
    }
  });

  it('a row is born without a number, whoever inserts it', async () => {
    const conn = await driver.acquire();
    try {
      await expect(
        conn.query(
          `INSERT INTO invoice (tenant_id, period_start, period_end, status, reference, invoice_number, invoice_date, moneybird_id, moneybird_administration_id)
           VALUES ($1, '2026-05-01', '2026-05-31', 'sent', 'ownpace-a-m-2026-05-small', '2026-0009', '2026-05-01', '9', '1')`,
          [TENANT_A],
        ),
      ).rejects.toThrow(/born without Moneybird's number/);
    } finally {
      conn.release();
    }
  });

  it('a reference names one row, and a credit note names its invoice', async () => {
    const conn = await driver.acquire();
    try {
      await expect(
        conn.query(
          `INSERT INTO invoice (tenant_id, period_start, period_end, reference) VALUES ($1, '2026-06-01', '2026-06-30', 'ownpace-a-m-2026-01-small')`,
          [TENANT_A],
        ),
      ).rejects.toThrow(/uk_invoice_reference/);
      await expect(
        conn.query(
          `INSERT INTO invoice (tenant_id, period_start, period_end, kind) VALUES ($1, '2026-07-01', '2026-07-31', 'credit_note')`,
          [TENANT_A],
        ),
      ).rejects.toThrow(/invoice_credit_note_check/);
    } finally {
      conn.release();
    }
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
      'invoice_date',
      'invoice_number',
      'lines',
      'metadata',
      'moneybird_administration_id',
      'moneybird_id',
      'paid_at',
      'payment_id',
      'payment_method',
      'sent_at',
      'status',
      'subtotal',
      'tax_amount',
      'tax_rate',
      'tax_rate_id',
      'total',
      'updated_at',
      'vat_treatment',
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

describe('the column pin (0045)', () => {
  /**
   * Every column of `invoice`, in exactly one class. Identity, document and
   * at-issue columns are what an issued invoice IS, so each must be in the
   * trigger's freeze; lifecycle columns move after issue by design; the
   * detach columns are the erasure's, until T10. A column this map does not
   * know fails the first case: adding one means deciding what it is.
   */
  const CLASSES: Record<string, 'identity' | 'document' | 'at_issue' | 'lifecycle' | 'detach'> = {
    id: 'identity',
    reference: 'identity',
    kind: 'identity',
    credited_invoice_id: 'identity',
    period_start: 'identity',
    period_end: 'identity',
    currency: 'identity',
    created_at: 'identity',
    subtotal: 'document',
    tax_rate: 'document',
    tax_amount: 'document',
    total: 'document',
    due_date: 'document',
    evidence: 'document',
    vat_treatment: 'document',
    tax_rate_id: 'document',
    lines: 'document',
    moneybird_administration_id: 'at_issue',
    moneybird_id: 'at_issue',
    invoice_number: 'at_issue',
    invoice_date: 'at_issue',
    status: 'lifecycle',
    payment_method: 'lifecycle',
    payment_id: 'lifecycle',
    paid_at: 'lifecycle',
    sent_at: 'lifecycle',
    metadata: 'lifecycle',
    updated_at: 'lifecycle',
    tenant_id: 'detach',
    billed_to_name: 'detach',
  };

  it('knows every column of the table, and only those', async () => {
    const conn = await driver.acquire();
    try {
      const { rows } = await conn.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'invoice'
          ORDER BY column_name`,
      );
      expect(rows.map((r) => r.column_name)).toEqual(Object.keys(CLASSES).sort());
    } finally {
      conn.release();
    }
  });

  it('freezes, past draft, every column an issued invoice is made of', async () => {
    const conn = await driver.acquire();
    try {
      const { rows } = await conn.query<{ src: string }>(
        `SELECT prosrc AS src FROM pg_proc WHERE proname = 'invoice_refuse_illegal_update'`,
      );
      const source = rows[0]!.src;
      const freeze = source.slice(source.indexOf("IF OLD.status <> 'draft' THEN"));
      const frozen = Object.entries(CLASSES)
        .filter(([, cls]) => cls === 'identity' || cls === 'document' || cls === 'at_issue')
        .map(([column]) => column);
      for (const column of frozen) {
        expect(freeze, `${column} is not in the freeze`).toMatch(
          new RegExp(`NEW\\.${column}\\s+IS DISTINCT FROM OLD\\.${column}\\b`),
        );
      }
    } finally {
      conn.release();
    }
  });
});
