// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CREDIT NOTE FOR AN ISSUED INVOICE (workplan 0111, T7, slice 7a):
 * `credit-note.ts`, on a real database, in the organisation's own scope as
 * `app_user`.
 *
 *  - recorded: a draft, `credit_note`, naming its invoice, under the
 *    invoice's reference with `-c-`, saying what share it credits and why;
 *    recorded twice, it is one row, the first; a void invoice, a credit note,
 *    another organisation's invoice and a share of nothing are refused;
 *  - claimed only once the invoice it corrects is numbered, by one push at a
 *    time, with the invoice as issued: its number, date, rate and lines;
 *  - Moneybird's id of its draft written down once, and never another;
 *  - written back numbered, negative, with its line, its lease given back,
 *    and then frozen like every issued document;
 *  - not pushed into another administration than its invoice's;
 *  - said behind when it is still a draft two days on.
 *
 * PGlite, both chains. The names are invented, and nothing is contacted.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import type { TenantId } from '@openmig/shared';
import { runManagedMigrations } from './migrate-managed.ts';
import { draftsBehind } from './invoice-push.ts';
import {
  claimNextCreditNote,
  creditReference,
  planCreditPush,
  recordCreditDraft,
  recordCreditIssued,
  recordCreditNote,
  type CreditDecision,
} from './credit-note.ts';
import type { MoneybirdCreditInvoice } from './moneybird-credit-invoices.ts';

// UUID family 01117a00-…, unused elsewhere in the repo.
const ORG = '01117a00-e29b-41d4-a716-446655440001' as TenantId;
const OTHER = '01117a00-e29b-41d4-a716-446655440002' as TenantId;
const OCTOBER = '01117a00-e29b-41d4-a716-446655440101';
const VOIDED = '01117a00-e29b-41d4-a716-446655440102';
const THEIRS = '01117a00-e29b-41d4-a716-446655440103';
const ADMINISTRATION = { administrationId: '123456789012345678' };
const OCT_3 = new Date('2026-10-03T10:00:00Z');

const DECISION: CreditDecision = {
  description: 'Herroeping op 3 oktober 2026: 28 van de 31 dagen van factuur {invoice} niet gebruikt, en gecrediteerd',
  numerator: 28,
  denominator: 31,
  evidence: { reason: 'withdrawal', withdrawnAt: OCT_3.toISOString(), daysPaid: 31, daysUsed: 3 },
};

const MONEYBIRD_CREDIT: MoneybirdCreditInvoice = {
  id: '800',
  invoiceNumber: '2026-0008',
  reference: `ownpace-${ORG}-c-2026-10-medium`,
  state: 'open',
  contactId: '9',
  invoiceDate: '2026-10-03',
  dueDate: '2026-10-17',
  pricesAreInclTax: true,
  totalInclTaxCents: -1084,
  totalExclTaxCents: -896,
  totalUnpaidCents: -1084,
  originalSalesInvoiceId: '700',
  detailIds: ['805'],
};

describe('the reference: the invoice’s, with -c- for -m-', () => {
  it('makes one credit note reference per invoice', () => {
    expect(creditReference(`ownpace-${ORG}-m-2026-10-medium`)).toBe(`ownpace-${ORG}-c-2026-10-medium`);
    expect(() => creditReference('ownpace-proof-2026-10')).toThrow(/not a month's invoice reference/);
  });
});

describe('a credit note, recorded, claimed, written down and written back', () => {
  let driver: LedgerDriver;

  async function owner(statement: string, params: unknown[] = []) {
    const conn = await driver.acquire();
    try {
      return await conn.query(statement, params);
    } finally {
      await conn.release();
    }
  }

  const credits = async () =>
    (
      await owner(
        `SELECT id, reference, kind, status, credited_invoice_id, total::text AS total, lines, evidence, moneybird_id,
                invoice_number, push_lease_until FROM invoice WHERE kind = 'credit_note' ORDER BY created_at`,
      )
    ).rows as Array<Record<string, unknown>>;

  const issue = (id: string) =>
    owner(
      `UPDATE invoice SET status = 'sent', invoice_number = '2026-0007', invoice_date = '2026-10-01', moneybird_id = '700',
              moneybird_administration_id = '123456789012345678', tax_rate_id = '611', tax_rate = 0.21,
              vat_treatment = 'domestic_standard', subtotal = 992, tax_amount = 208, total = 1200,
              lines = '[{"description": "Ownpace Medium, oktober 2026: het pakket dat u koos", "publishedCents": 1200, "cents": 1200}]'::jsonb
        WHERE id = $1`,
      [id],
    );

  beforeAll(async () => {
    driver = pgliteDriver({ role: 'app_user' });
    await runMigrations({ driver, logger: () => {} });
    await runManagedMigrations({ driver, logger: () => {} });
    await owner(`INSERT INTO tenant (id, name) VALUES ($1, 'Withdraws BV'), ($2, 'Somebody Else BV')`, [ORG, OTHER]);
    await owner(
      `INSERT INTO invoice (id, tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total, reference, lines)
       VALUES ($1, $3, '2026-10-01', '2026-10-31', 'draft', 1200, 0, 0, 1200, $4,
               '[{"description": "Ownpace Medium, oktober 2026: het pakket dat u koos", "publishedCents": 1200}]'::jsonb),
              ($2, $3, '2026-10-01', '2026-10-31', 'void', 500, 0, 0, 500, $5, '[]'::jsonb),
              ($6, $7, '2026-10-01', '2026-10-31', 'draft', 500, 0, 0, 500, $8, '[]'::jsonb)`,
      [
        OCTOBER,
        VOIDED,
        ORG,
        `ownpace-${ORG}-m-2026-10-medium`,
        `ownpace-${ORG}-m-2026-10-small`,
        THEIRS,
        OTHER,
        `ownpace-${OTHER}-m-2026-10-small`,
      ],
    );
  }, 120_000);

  afterAll(async () => {
    await driver?.end();
  });

  it('records a draft credit note under the invoice’s reference, once, saying what it credits and why', async () => {
    const first = await withTenant(driver, ORG, (db) => recordCreditNote(db, ORG, OCTOBER, DECISION));
    const second = await withTenant(driver, ORG, (db) =>
      recordCreditNote(db, ORG, OCTOBER, { ...DECISION, numerator: 31 }),
    );

    expect(first).toEqual({ kind: 'recorded', reference: `ownpace-${ORG}-c-2026-10-medium` });
    expect(second).toEqual({ kind: 'exists', reference: `ownpace-${ORG}-c-2026-10-medium` });
    const rows = await credits();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reference: `ownpace-${ORG}-c-2026-10-medium`,
      kind: 'credit_note',
      status: 'draft',
      credited_invoice_id: OCTOBER,
      total: '-1084',
      lines: [{ description: DECISION.description, numerator: 28, denominator: 31 }],
      evidence: DECISION.evidence,
      moneybird_id: null,
    });
  });

  it('refuses a void invoice, a credit note, another organisation’s invoice and a share of nothing', async () => {
    const credit = (await credits())[0]!.id as string;
    const tries = await withTenant(driver, ORG, async (db) => [
      await recordCreditNote(db, ORG, VOIDED, DECISION),
      await recordCreditNote(db, ORG, credit, DECISION),
      await recordCreditNote(db, ORG, THEIRS, DECISION),
      await recordCreditNote(db, ORG, OCTOBER, { ...DECISION, numerator: 0 }),
      await recordCreditNote(db, ORG, OCTOBER, { ...DECISION, numerator: 32 }),
    ]);

    expect(tries.map((t) => t.kind)).toEqual(['refused', 'refused', 'refused', 'refused', 'refused']);
    expect(await credits()).toHaveLength(1);
  });

  it('is claimed only once its invoice is numbered, by one push at a time, with the invoice as issued', async () => {
    expect(await withTenant(driver, ORG, (db) => claimNextCreditNote(db, ORG, OCT_3))).toBeNull();
    await issue(OCTOBER);

    const claimed = await withTenant(driver, ORG, (db) => claimNextCreditNote(db, ORG, OCT_3));
    expect(claimed).toMatchObject({
      reference: `ownpace-${ORG}-c-2026-10-medium`,
      moneybirdId: null,
      description: DECISION.description,
      numerator: 28,
      denominator: 31,
      credited: {
        id: OCTOBER,
        reference: `ownpace-${ORG}-m-2026-10-medium`,
        administrationId: '123456789012345678',
        moneybirdId: '700',
        invoiceNumber: '2026-0007',
        invoiceDate: '2026-10-01',
        taxRateId: '611',
        vatTreatment: 'domestic_standard',
        lines: [{ description: 'Ownpace Medium, oktober 2026: het pakket dat u koos', cents: 1200 }],
      },
    });
    expect(await withTenant(driver, ORG, (db) => claimNextCreditNote(db, ORG, OCT_3))).toBeNull();
    expect(await withTenant(driver, OTHER, (db) => claimNextCreditNote(db, ORG, new Date('2026-10-04T00:00:00Z')))).toBeNull();
  });

  it('is pushed into its invoice’s administration and no other', async () => {
    const later = new Date(OCT_3.getTime() + 16 * 60_000);
    const claimed = (await withTenant(driver, ORG, (db) => claimNextCreditNote(db, ORG, later)))!;

    expect(planCreditPush(claimed, ADMINISTRATION, later)).toMatchObject({ kind: 'push', note: { today: '2026-10-03' } });
    const elsewhere = planCreditPush(claimed, { administrationId: '999' }, later);
    expect(elsewhere).toMatchObject({ kind: 'refused' });
    expect((elsewhere as { reason: string }).reason).toContain('administration 123456789012345678');
  });

  it('writes Moneybird’s draft down once, never another, then is written back numbered, negative, and frozen', async () => {
    const at = new Date(OCT_3.getTime() + 40 * 60_000);
    const claimed = (await withTenant(driver, ORG, (db) => claimNextCreditNote(db, ORG, at)))!;

    await withTenant(driver, ORG, (db) => recordCreditDraft(db, claimed, '800', ADMINISTRATION, at));
    await withTenant(driver, ORG, (db) => recordCreditDraft(db, claimed, '800', ADMINISTRATION, at));
    await expect(withTenant(driver, ORG, (db) => recordCreditDraft(db, claimed, '801', ADMINISTRATION, at))).rejects.toThrow(
      /names another one/,
    );
    expect((await credits())[0]).toMatchObject({ moneybird_id: '800', status: 'draft' });

    const written = await withTenant(driver, ORG, (db) =>
      recordCreditIssued(
        db,
        claimed,
        {
          kind: 'issued',
          invoice: MONEYBIRD_CREDIT,
          adopted: false,
          line: { description: 'Herroeping op 3 oktober 2026: 28 van de 31 dagen van factuur 2026-0007 niet gebruikt', cents: -1084 },
        },
        ADMINISTRATION,
        at,
      ),
    );
    expect(written).toBe(true);
    const [row] = await credits();
    expect(row).toMatchObject({
      status: 'sent',
      invoice_number: '2026-0008',
      total: '-1084',
      push_lease_until: null,
      lines: [
        {
          description: 'Herroeping op 3 oktober 2026: 28 van de 31 dagen van factuur 2026-0007 niet gebruikt',
          cents: -1084,
          numerator: 28,
          denominator: 31,
        },
      ],
    });
    // An issued credit note is a document: corrected by another, never edited.
    await expect(owner(`UPDATE invoice SET total = -1200 WHERE id = $1`, [row!.id])).rejects.toThrow(/immutable/);
    expect(await withTenant(driver, ORG, (db) => claimNextCreditNote(db, ORG, new Date('2026-10-05T00:00:00Z')))).toBeNull();
  });

  it('is said behind when it is still a draft two days after it was made', async () => {
    await owner(`DELETE FROM invoice WHERE kind = 'credit_note'`);
    await withTenant(driver, ORG, (db) => recordCreditNote(db, ORG, OCTOBER, DECISION));
    await owner(`UPDATE invoice SET created_at = '2026-10-01T00:00:00Z' WHERE kind = 'credit_note'`);

    const behind = await withTenant(driver, ORG, (db) => draftsBehind(db, ORG, new Date('2026-10-04T00:00:00Z')));
    expect(behind).toContain(`ownpace-${ORG}-c-2026-10-medium`);
  });
});
