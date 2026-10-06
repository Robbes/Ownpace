// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DRAFT NUMBERED BY THE BOOKS (workplan 0111, slice 5): `invoice-push.ts`.
 *
 *  - what is pushed, decided before Moneybird is asked anything: no invoice
 *    details is refused, and so is e-mail delivery while there is no invoice
 *    address; a consumer is addressed by their full name, a business by its
 *    name and VAT number; and a reverse-charge line ends with VIES's evidence
 *    (decision 10);
 *  - on a real database, as `app_user` in the organisation's own scope: a
 *    draft is claimed once while its lease holds, again after it runs out,
 *    and never once issued; the write-back takes it out of draft with
 *    Moneybird's number, date, due date, ids, the treatment, the rate, the
 *    lines as invoiced and the totals, and gives the lease back, once; and a
 *    draft two days old is said behind.
 *
 * PGlite, both chains. The names, addresses and numbers are invented.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import type { TenantId } from '@openmig/shared';
import { runManagedMigrations } from './migrate-managed.ts';
import {
  claimNextDraft,
  draftsBehind,
  planPush,
  recordIssued,
  type BuyerStanding,
  type DraftToPush,
  type PushContext,
} from './invoice-push.ts';
import type { PushOutcome } from './moneybird-push.ts';

const CONTEXT: PushContext = { sellerCountry: 'NL', ossActive: false, delivery: 'manual' };

const DRAFT: DraftToPush = {
  id: '0111d000-e29b-41d4-a716-446655440900',
  reference: 'ownpace-org-m-2026-10-medium',
  lines: [{ description: 'Ownpace Medium, oktober 2026: 12 migraties tegelijk op 3 oktober', publishedCents: 1200 }],
};

const party = (over: Partial<NonNullable<BuyerStanding['party']>> = {}): NonNullable<BuyerStanding['party']> => ({
  tenantId: '0111d000-e29b-41d4-a716-446655440001',
  kind: 'consumer',
  name: 'Sam de Vries',
  addressLine1: 'Dorpsstraat 1',
  addressLine2: null,
  postalCode: '1234 AB',
  city: 'Ons Dorp',
  countryCode: 'NL',
  vatNumber: null,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
  ...over,
});

const consultation = (
  over: Partial<NonNullable<BuyerStanding['vatConsultation']>> = {},
): NonNullable<BuyerStanding['vatConsultation']> => ({
  id: '0111d000-e29b-41d4-a716-446655440950',
  countryCode: 'DE',
  vatNumber: '123456789',
  valid: true,
  requestDate: '2026-09-30',
  consultationNumber: 'WAPIAAAAW1zZ3AbC',
  traderName: 'Beispiel GmbH',
  traderAddress: null,
  checkedAt: new Date('2026-09-30T10:00:00Z'),
  ...over,
});

describe('what is pushed, decided before Moneybird is asked anything', () => {
  it('refuses a draft whose organisation gave no invoice details', () => {
    expect(planPush('org', DRAFT, { party: null, vatConsultation: null }, CONTEXT)).toEqual({
      kind: 'refused',
      reason: `invoice ${DRAFT.reference}: the organisation has given no invoice details, so there is nobody to address it to`,
    });
  });

  it('refuses e-mail delivery while there is no invoice address to send it to', () => {
    const plan = planPush('org', DRAFT, { party: party(), vatConsultation: null }, { ...CONTEXT, delivery: 'email' });
    expect(plan).toMatchObject({ kind: 'refused', reason: expect.stringContaining('no invoice e-mail address') });
  });

  it('addresses a consumer by their full name, with domestic VAT and the line as made', () => {
    const plan = planPush('org', DRAFT, { party: party(), vatConsultation: null }, CONTEXT);
    expect(plan).toEqual({
      kind: 'push',
      treatment: 'domestic_standard',
      invoice: {
        reference: DRAFT.reference,
        treatment: 'domestic_standard',
        buyer: {
          customerId: 'ownpace-org',
          companyName: null,
          firstname: null,
          lastname: 'Sam de Vries',
          address1: 'Dorpsstraat 1',
          address2: null,
          zipcode: '1234 AB',
          city: 'Ons Dorp',
          country: 'NL',
          taxNumber: null,
          email: null,
        },
        lines: DRAFT.lines,
      },
    });
  });

  it("reverse charges a business abroad with a valid VIES answer, and says VIES's evidence on the line", () => {
    const business = party({ kind: 'business', name: 'Beispiel GmbH', countryCode: 'DE', vatNumber: 'DE123456789' });
    const plan = planPush('org', DRAFT, { party: business, vatConsultation: consultation() }, CONTEXT);
    expect(plan).toMatchObject({
      kind: 'push',
      treatment: 'reverse_charge',
      invoice: {
        buyer: { companyName: 'Beispiel GmbH', lastname: null, taxNumber: 'DE123456789', country: 'DE' },
        lines: [
          {
            description:
              'Ownpace Medium, oktober 2026: 12 migraties tegelijk op 3 oktober. ' +
              'Btw verlegd / VAT reverse charged. VIES WAPIAAAAW1zZ3AbC, 2026-09-30',
            publishedCents: 1200,
          },
        ],
      },
    });
  });

  it('names the number checked when VIES gave no consultation number (an unqualified check)', () => {
    const business = party({ kind: 'business', countryCode: 'DE', vatNumber: 'DE123456789' });
    const plan = planPush(
      'org',
      DRAFT,
      { party: business, vatConsultation: consultation({ consultationNumber: null, requestDate: null }) },
      CONTEXT,
    );
    expect(plan.kind === 'push' && plan.invoice.lines[0]!.description).toMatch(/VIES DE123456789, 2026-09-30$/);
  });

  it('charges a business abroad like a consumer when its number was not found valid', () => {
    const business = party({ kind: 'business', countryCode: 'DE', vatNumber: 'DE123456789' });
    const plan = planPush('org', DRAFT, { party: business, vatConsultation: consultation({ valid: false }) }, CONTEXT);
    expect(plan).toMatchObject({ kind: 'push', treatment: 'domestic_standard', invoice: { lines: DRAFT.lines } });
  });
});

// UUID family 0111d000-…, unused elsewhere in the repo.
const ORG = '0111d000-e29b-41d4-a716-446655440001' as TenantId;
const OTHER = '0111d000-e29b-41d4-a716-446655440002' as TenantId;
const OCT_1 = new Date('2026-10-01T00:41:00Z');

describe('a draft claimed, numbered and written back, on a real database', () => {
  let driver: LedgerDriver;

  async function owner(statement: string, params: unknown[] = []): Promise<void> {
    const conn = await driver.acquire();
    try {
      await conn.query(statement, params);
    } finally {
      await conn.release();
    }
  }

  const rowOf = (reference: string) =>
    withTenant(driver, ORG, async (db) => {
      const result = await db.execute(
        sql`SELECT status, invoice_number, invoice_date::text AS invoice_date, due_date::text AS due_date,
                   moneybird_administration_id, moneybird_id, vat_treatment, tax_rate_id, lines,
                   subtotal::text AS subtotal, tax_amount::text AS tax_amount, total::text AS total,
                   tax_rate::text AS tax_rate, push_lease_until, sent_at
              FROM invoice WHERE reference = ${reference}`,
      );
      return (result as unknown as { rows: Record<string, unknown>[] }).rows[0]!;
    });

  const draft = (reference: string, createdAt: string) =>
    owner(
      `INSERT INTO invoice (tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total,
                            reference, evidence, lines, created_at)
       VALUES ($1, '2026-10-01', '2026-10-31', 'draft', 12, 0, 0, 12, $2, '{"cents": 1200}'::jsonb,
               '[{"description": "Ownpace Medium, oktober 2026: het pakket dat u koos", "publishedCents": 1200}]'::jsonb, $3)`,
      [ORG, reference, createdAt],
    );

  beforeAll(async () => {
    driver = pgliteDriver({ role: 'app_user' });
    await runMigrations({ driver, logger: () => {} });
    await runManagedMigrations({ driver, logger: () => {} });
    await owner(`INSERT INTO tenant (id, name) VALUES ($1, 'Pays Monthly BV'), ($2, 'Somebody Else BV')`, [ORG, OTHER]);
    await draft(`ownpace-${ORG}-m-2026-10-small`, '2026-09-28T00:23:00Z');
    await draft(`ownpace-${ORG}-m-2026-10-medium`, '2026-10-01T00:23:00Z');
  }, 120_000);

  afterAll(async () => {
    await driver?.end();
  });

  it('claims the oldest draft, once while its lease holds', async () => {
    const first = await withTenant(driver, ORG, (db) => claimNextDraft(db, ORG, OCT_1));
    expect(first).toMatchObject({
      reference: `ownpace-${ORG}-m-2026-10-small`,
      lines: [{ description: 'Ownpace Medium, oktober 2026: het pakket dat u koos', publishedCents: 1200 }],
    });
    const second = await withTenant(driver, ORG, (db) => claimNextDraft(db, ORG, OCT_1));
    expect(second?.reference).toBe(`ownpace-${ORG}-m-2026-10-medium`);
    // Both held now: a third claim within the lease finds nothing.
    expect(await withTenant(driver, ORG, (db) => claimNextDraft(db, ORG, OCT_1))).toBeNull();
    // Another organisation's scope sees none of them.
    expect(await withTenant(driver, OTHER, (db) => claimNextDraft(db, ORG, OCT_1))).toBeNull();
  });

  it('claims a draft again once its lease has run out', async () => {
    const later = new Date(OCT_1.getTime() + 16 * 60_000);
    const again = await withTenant(driver, ORG, (db) => claimNextDraft(db, ORG, later));
    expect(again?.reference).toBe(`ownpace-${ORG}-m-2026-10-small`);
  });

  it('writes the issue back once: numbered, dated, the treatment, the lines as invoiced and the totals', async () => {
    const reference = `ownpace-${ORG}-m-2026-10-small`;
    const held = (await withTenant(driver, ORG, (db) =>
      db.execute(sql`SELECT id FROM invoice WHERE reference = ${reference}`),
    )) as unknown as { rows: { id: string }[] };
    const claimed: DraftToPush = {
      id: held.rows[0]!.id,
      reference,
      lines: [{ description: 'Ownpace Medium, oktober 2026: het pakket dat u koos', publishedCents: 1200 }],
    };
    const plan = planPush(ORG, claimed, { party: party(), vatConsultation: null }, CONTEXT);
    if (plan.kind !== 'push') throw new Error('expected a push');
    const outcome: Extract<PushOutcome, { kind: 'issued' }> = {
      kind: 'issued',
      adopted: false,
      taxRateId: '611',
      taxPercentage: '21.0',
      pricesAreInclTax: true,
      lines: [{ description: 'Ownpace Medium, oktober 2026: het pakket dat u koos', cents: 1200 }],
      invoice: {
        id: '555',
        invoiceNumber: '2026-0001',
        reference,
        state: 'open',
        contactId: '9',
        invoiceDate: '2026-10-01',
        dueDate: '2026-10-15',
        pricesAreInclTax: true,
        totalInclTaxCents: 1200,
        totalExclTaxCents: 992,
        totalUnpaidCents: 1200,
      },
    };
    const NOW = new Date('2026-10-01T00:42:00Z');
    expect(
      await withTenant(driver, ORG, (db) => recordIssued(db, claimed, plan, outcome, { administrationId: '123456789012345678' }, NOW)),
    ).toBe(true);
    expect(await rowOf(reference)).toMatchObject({
      status: 'sent',
      invoice_number: '2026-0001',
      invoice_date: '2026-10-01',
      due_date: '2026-10-15',
      moneybird_administration_id: '123456789012345678',
      moneybird_id: '555',
      vat_treatment: 'domestic_standard',
      tax_rate_id: '611',
      lines: [{ description: 'Ownpace Medium, oktober 2026: het pakket dat u koos', publishedCents: 1200, cents: 1200 }],
      subtotal: '992',
      tax_amount: '208',
      total: '1200',
      tax_rate: '0.21',
      push_lease_until: null,
    });
    // Once: the row is no longer a draft, and nothing writes it again.
    expect(
      await withTenant(driver, ORG, (db) => recordIssued(db, claimed, plan, outcome, { administrationId: '123456789012345678' }, NOW)),
    ).toBe(false);
    // And an issued invoice is never claimed again.
    const far = new Date(OCT_1.getTime() + 24 * 3_600_000);
    const next = await withTenant(driver, ORG, (db) => claimNextDraft(db, ORG, far));
    expect(next?.reference).toBe(`ownpace-${ORG}-m-2026-10-medium`);
  });

  it('says a draft behind two days after it was made, and not before', async () => {
    const behind = await withTenant(driver, ORG, (db) => draftsBehind(db, ORG, new Date('2026-10-02T00:00:00Z')));
    expect(behind).toEqual([]);
    const later = await withTenant(driver, ORG, (db) => draftsBehind(db, ORG, new Date('2026-10-03T00:30:00Z')));
    expect(later).toEqual([`ownpace-${ORG}-m-2026-10-medium`]);
  });
});
