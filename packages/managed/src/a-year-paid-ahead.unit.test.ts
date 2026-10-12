// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A YEAR PAID AHEAD (workplan 0111 T11; ADR-0014, Amendment 2026-10-04; terms
 * §8; the owner's four answers of 2026-10-12): `year-credit.ts` and the month
 * task's draw (`month-invoice.ts`).
 *
 *  - the rule: where a year falls (with the first month not yet billed; its
 *    twelve after a year still running); the credit a month may draw (from the
 *    year's first month, never below nothing); the month's rate (fixed by its
 *    first step; half within a year while credit is left; full when spent or
 *    after the twelve); what the credit covers of a step;
 *  - the words: the year's own line, and a month's at half price less what the
 *    credit paid, in both languages; a year's credit note reference; the books
 *    read-back finds a year's organisation;
 *  - on a real database, as the task runs it: a month the credit pays makes no
 *    invoice, and a second run draws nothing twice; a move up draws the
 *    difference at half price; the month that empties the credit invoices the
 *    rest at half price, and the next is monthly at full price; credit left
 *    after the twelve months pays the full price; a year bought in a month
 *    already billed starts the next, and pays nothing of this one; a
 *    withdrawal credits the year for the days not used and the credit starts
 *    again at nothing; nothing of another organisation's is read or written.
 *
 * PGlite, both chains. The names are invented.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import type { TenantId } from '@openmig/shared';
import { runManagedMigrations } from './migrate-managed.ts';
import { MANAGED_TIERS, type ManagedTier } from './tier-calculator.ts';
import { PgDataAllowanceStore } from './data-ceiling.ts';
import { PgTierPickStore } from './tier-pick.ts';
import { openTheMonth } from './month-invoice.ts';
import { monthLine } from './month-invoice-words.ts';
import { creditReference } from './credit-note.ts';
import { organisationOf } from './books-read-back.ts';
import { withdraw } from './withdrawal.ts';
import {
  addMonths,
  creditForMonth,
  monthRate,
  placeYear,
  readDraws,
  readYears,
  recordYear,
  splitStep,
  yearLine,
  yearTiers,
  type YearBought,
} from './year-credit.ts';

const tier = (id: ManagedTier['id']): ManagedTier => MANAGED_TIERS.find((t) => t.id === id)!;
const year = (over: Partial<YearBought>): YearBought => ({
  reference: 'ownpace-x-y-1',
  tierId: 'medium',
  cents: 7200,
  creditFrom: '2026-10',
  halfFrom: '2026-10',
  halfTo: '2027-09',
  ...over,
});

describe('where a year falls (the owner, answer 1)', () => {
  const OCT_12 = new Date('2026-10-12T09:00:00Z');

  it('starts this month when nothing is billed for it yet, and runs twelve months', () => {
    expect(placeYear(OCT_12, false, [])).toEqual({ creditFrom: '2026-10', halfFrom: '2026-10', halfTo: '2027-09' });
  });

  it('starts next month when this one is billed, so no month is paid twice', () => {
    expect(placeYear(OCT_12, true, [])).toEqual({ creditFrom: '2026-11', halfFrom: '2026-11', halfTo: '2027-10' });
  });

  it("adds its twelve after a year still running, and its credit from the same first month", () => {
    const running = year({ creditFrom: '2026-05', halfFrom: '2026-05', halfTo: '2027-04' });
    expect(placeYear(OCT_12, true, [running])).toEqual({ creditFrom: '2026-11', halfFrom: '2027-05', halfTo: '2028-04' });
  });

  it("starts its own twelve when the last year's are over", () => {
    const over = year({ creditFrom: '2025-01', halfFrom: '2025-01', halfTo: '2025-12' });
    expect(placeYear(OCT_12, true, [over])).toEqual({ creditFrom: '2026-11', halfFrom: '2026-11', halfTo: '2027-10' });
  });

  it('reads months in UTC, across a year end', () => {
    expect(placeYear(new Date('2026-12-31T23:30:00-02:00'), false, [])).toMatchObject({ creditFrom: '2027-01' });
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2027-01', -1)).toBe('2026-12');
  });

  it('is bought for the tier the month bills or a higher one, never Free (the owner, answer 3)', () => {
    expect(yearTiers(tier('medium')).map((t) => t.id)).toEqual(['medium', 'large', 'xl']);
    expect(yearTiers(tier('free')).map((t) => t.id)).toEqual(['small', 'medium', 'large', 'xl']);
  });
});

describe('the credit a month may draw, and its rate (the owner, answer 2)', () => {
  const y = year({});

  it('counts a year from its first month, less every draw', () => {
    expect(creditForMonth('2026-09', [y], [])).toEqual({ leftCents: 0, yearMonth: false });
    expect(creditForMonth('2026-10', [y], [{ month: '2026-10', tierId: 'medium', cents: 600, rate: 'half' }])).toEqual({
      leftCents: 6600,
      yearMonth: true,
    });
    expect(creditForMonth('2027-10', [y], [])).toEqual({ leftCents: 7200, yearMonth: false });
  });

  it('refuses a credit spent past what was given, rather than read it as nothing', () => {
    expect(() => creditForMonth('2026-10', [y], [{ month: '2026-10', tierId: 'xl', cents: 9000, rate: 'full' }])).toThrow(
      /more was drawn than the years gave/,
    );
  });

  it('is half within a year while credit is left, full once spent or after the twelve; the first step fixes it', () => {
    expect(monthRate(null, { leftCents: 100, yearMonth: true })).toBe('half');
    expect(monthRate(null, { leftCents: 0, yearMonth: true })).toBe('full');
    expect(monthRate(null, { leftCents: 100, yearMonth: false })).toBe('full');
    expect(monthRate('half', { leftCents: 0, yearMonth: true })).toBe('half');
    expect(monthRate('full', { leftCents: 5000, yearMonth: true })).toBe('full');
  });

  it('draws what the credit covers of a step, and invoices the rest', () => {
    expect(splitStep(600, 7200)).toEqual({ drawCents: 600, invoiceCents: 0 });
    expect(splitStep(2000, 1200)).toEqual({ drawCents: 1200, invoiceCents: 800 });
    expect(splitStep(500, 0)).toEqual({ drawCents: 0, invoiceCents: 500 });
  });
});

describe('the words', () => {
  it("says a year's line: the tier, its months, credit", () => {
    const placed = { creditFrom: '2026-11', halfFrom: '2026-11', halfTo: '2027-10' };
    expect(yearLine(tier('medium'), placed, 'nl')).toBe('Ownpace Medium, een jaar vooruit, november 2026 tot en met oktober 2027: tegoed');
    expect(yearLine(tier('medium'), placed, 'en')).toBe('Ownpace Medium, a year ahead, November 2026 to October 2027: credit');
  });

  it("says a month at half price, less what the credit paid, and a move up after a month paid from credit", () => {
    const facts = {
      tier: tier('large'),
      month: new Date('2027-01-01T00:23:00Z'),
      by: 'picked' as const,
      peakPaths: 0,
      peakAt: null,
      gbCounted: 0,
      after: tier('medium'),
      afterDrawn: true,
      rate: 'half' as const,
      drawnCents: 1200,
    };
    expect(monthLine(facts, 'nl')).toBe(
      'Ownpace Large, januari 2027: het pakket dat u koos, min het pakket Medium dat deze maand al rekende, ' +
        'voor de helft van de maandprijs (een jaar vooruit), min € 12,00 uit uw tegoed',
    );
    expect(monthLine(facts, 'en')).toBe(
      'Ownpace Large, January 2027: the tier you picked, less Medium already billed this month, ' +
        'at half the monthly price (a year ahead), less €12.00 from your credit',
    );
  });

  it("gives a year's credit note its own reference, which a month's cannot take", () => {
    expect(creditReference('ownpace-0111c000-e29b-41d4-a716-446655440001-y-2')).toBe(
      'ownpace-0111c000-e29b-41d4-a716-446655440001-c-y-2',
    );
    expect(creditReference('ownpace-0111c000-e29b-41d4-a716-446655440001-m-2026-10-small')).toBe(
      'ownpace-0111c000-e29b-41d4-a716-446655440001-c-2026-10-small',
    );
  });

  it("lets the books' read-back find a year's organisation", () => {
    expect(organisationOf('ownpace-0111c000-e29b-41d4-a716-446655440001-y-1')).toBe('0111c000-e29b-41d4-a716-446655440001');
    expect(organisationOf('ownpace-0111c000-e29b-41d4-a716-446655440001-c-y-1')).toBeNull();
  });
});

// UUID family 0111c000-…, unused elsewhere in the repo.
const GROWS = '0111c000-e29b-41d4-a716-446655440001' as TenantId;
const STAYS_SMALL = '0111c000-e29b-41d4-a716-446655440002' as TenantId;
const LATE_YEAR = '0111c000-e29b-41d4-a716-446655440003' as TenantId;
const WITHDRAWS = '0111c000-e29b-41d4-a716-446655440004' as TenantId;

describe('a year on a real database, month by month, as the task runs it', () => {
  let driver: LedgerDriver;

  async function owner(statement: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    const conn = await driver.acquire();
    try {
      return ((await conn.query(statement, params)) as { rows: Record<string, unknown>[] }).rows;
    } finally {
      await conn.release();
    }
  }

  /** A pick of `tierId` at `at`, with its yes, as the Billing page records one. */
  async function pick(tenantId: TenantId, tierId: Exclude<ManagedTier['id'], 'free'>, at: string, beganOnRequest = false) {
    await withTenant(driver, tenantId, async (db) => {
      await new PgTierPickStore(db).record(tenantId, { tierId, priceEur: tier(tierId).monthlyCents / 100 }, 'someone@example.invalid', new Date(at));
      await new PgDataAllowanceStore(db).record(
        tenantId,
        { kind: 'tier', tierId, bandGb: tier(tierId).dataGb, priceEur: tier(tierId).monthlyCents / 100 },
        'someone@example.invalid',
        'pick',
        beganOnRequest,
      );
    });
    await owner(
      `UPDATE data_allowance SET consented_at = $2 WHERE tenant_id = $1 AND tier_id = $3 AND consented_at > $2`,
      [tenantId, at, tierId],
    );
  }

  const month = (tenantId: TenantId, at: string, locale: 'nl' | 'en' = 'en') =>
    withTenant(driver, tenantId, (db) => openTheMonth(db, tenantId, new Date(at), locale));

  const buy = (tenantId: TenantId, tierId: Exclude<ManagedTier['id'], 'free'>, at: string) =>
    withTenant(driver, tenantId, (db) =>
      recordYear(db, tenantId, { tier: tier(tierId), cents: tier(tierId).annualCents, priceFrom: 'list' }, new Date(at), 'en'),
    );

  const invoicesOf = (tenantId: TenantId) =>
    withTenant(driver, tenantId, async (db) => {
      const result = await db.execute(
        sql`SELECT reference, total::text AS total, period_start::text AS period_start, period_end::text AS period_end,
                   lines, evidence, kind
              FROM invoice WHERE tenant_id = ${tenantId} ORDER BY created_at, reference`,
      );
      return (result as unknown as { rows: Record<string, unknown>[] }).rows;
    });

  const drawsOf = (tenantId: TenantId) => withTenant(driver, tenantId, (db) => readDraws(db, tenantId));

  beforeAll(async () => {
    driver = pgliteDriver({ role: 'app_user' });
    await runMigrations({ driver, logger: () => {} });
    await runManagedMigrations({ driver, logger: () => {} });
    await owner(
      `INSERT INTO tenant (id, name) VALUES ($1, 'Grows BV'), ($2, 'Stays Small BV'), ($3, 'Late Year BV'), ($4, 'Withdraws BV')`,
      [GROWS, STAYS_SMALL, LATE_YEAR, WITHDRAWS],
    );
  }, 120_000);

  afterAll(async () => {
    await driver?.end();
  });

  it('records a year as one draft invoice, placed with the first month not yet billed', async () => {
    await pick(GROWS, 'medium', '2026-10-01T00:05:00Z');
    const bought = await buy(GROWS, 'medium', '2026-10-01T00:10:00Z');
    expect(bought).toEqual({
      kind: 'recorded',
      reference: `ownpace-${GROWS}-y-1`,
      cents: 7200,
      creditFrom: '2026-10',
      halfFrom: '2026-10',
      halfTo: '2027-09',
    });
    const [row] = await invoicesOf(GROWS);
    expect(row).toMatchObject({
      reference: `ownpace-${GROWS}-y-1`,
      kind: 'invoice',
      total: '7200',
      period_start: '2026-10-01',
      period_end: '2027-09-30',
      lines: [{ description: 'Ownpace Medium, a year ahead, October 2026 to September 2027: credit', publishedCents: 7200 }],
    });
  });

  it('pays a month from the credit at half price, with no invoice, and draws nothing twice', async () => {
    expect(await month(GROWS, '2026-10-01T00:23:00Z')).toEqual({ kind: 'drawn', tier: 'medium', drawnCents: 600 });
    expect(await month(GROWS, '2026-10-01T01:23:00Z')).toEqual({ kind: 'in_step' });
    expect(await invoicesOf(GROWS)).toHaveLength(1);
    expect(await drawsOf(GROWS)).toEqual([{ month: '2026-10', tierId: 'medium', cents: 600, rate: 'half' }]);
  });

  it('draws a move up for the difference, at the half price the month began with', async () => {
    await pick(GROWS, 'large', '2026-10-10T09:00:00Z');
    expect(await month(GROWS, '2026-10-10T09:23:00Z')).toEqual({ kind: 'drawn', tier: 'large', drawnCents: 1400 });
  });

  it('invoices the rest at half price in the month that empties the credit, then goes monthly at the full price', async () => {
    // 7200 − 600 − 1400 = 5200; November and December draw 2000 each.
    expect(await month(GROWS, '2026-11-01T00:23:00Z')).toEqual({ kind: 'drawn', tier: 'large', drawnCents: 2000 });
    expect(await month(GROWS, '2026-12-01T00:23:00Z')).toEqual({ kind: 'drawn', tier: 'large', drawnCents: 2000 });
    // January: 1200 left of a 2000 step at half.
    expect(await month(GROWS, '2027-01-01T00:23:00Z', 'nl')).toEqual({
      kind: 'made',
      reference: `ownpace-${GROWS}-m-2027-01-large`,
      tier: 'large',
      cents: 800,
      drawnCents: 1200,
    });
    const january = (await invoicesOf(GROWS)).at(-1)!;
    expect(january).toMatchObject({
      total: '800',
      lines: [
        {
          description:
            'Ownpace Large, januari 2027: het pakket dat u koos, voor de helft van de maandprijs (een jaar vooruit), ' +
            'min € 12,00 uit uw tegoed',
          publishedCents: 800,
        },
      ],
    });
    expect(january.evidence).toMatchObject({ rate: 'half', drawnCents: 1200, cents: 800, priceCents: 4000 });
    // February: nothing left, so monthly, at Large's full price, though within the twelve.
    expect(await month(GROWS, '2027-02-01T00:23:00Z')).toEqual({
      kind: 'made',
      reference: `ownpace-${GROWS}-m-2027-02-large`,
      tier: 'large',
      cents: 4000,
    });
    expect((await invoicesOf(GROWS)).at(-1)!.evidence).toMatchObject({ rate: 'full', drawnCents: 0 });
  });

  it('pays the months after the twelve from what is left, at the full price', async () => {
    // A Medium year on a Small month: twelve months at 250 leave 4200.
    await pick(STAYS_SMALL, 'small', '2026-10-01T00:05:00Z');
    await buy(STAYS_SMALL, 'medium', '2026-10-01T00:10:00Z');
    for (let m = 0; m < 12; m++) {
      const at = `${addMonths('2026-10', m)}-01T00:23:00Z`;
      expect(await month(STAYS_SMALL, at)).toEqual({ kind: 'drawn', tier: 'small', drawnCents: 250 });
    }
    expect(await month(STAYS_SMALL, '2027-10-01T00:23:00Z')).toEqual({ kind: 'drawn', tier: 'small', drawnCents: 500 });
    const credit = await withTenant(driver, STAYS_SMALL, async (db) =>
      creditForMonth('2027-11', await readYears(db, STAYS_SMALL), await readDraws(db, STAYS_SMALL)),
    );
    expect(credit).toEqual({ leftCents: 3700, yearMonth: false });
  });

  it('starts a year bought in a month already billed with the next, and pays nothing of this one', async () => {
    await pick(LATE_YEAR, 'small', '2026-10-01T00:05:00Z');
    expect(await month(LATE_YEAR, '2026-10-01T00:23:00Z')).toMatchObject({ kind: 'made', cents: 500 });
    expect(await buy(LATE_YEAR, 'small', '2026-10-05T12:00:00Z')).toMatchObject({ creditFrom: '2026-11', halfTo: '2027-10' });
    // A move up this month is invoiced as before, at the full price.
    await pick(LATE_YEAR, 'medium', '2026-10-06T09:00:00Z');
    expect(await month(LATE_YEAR, '2026-10-06T09:23:00Z')).toMatchObject({ kind: 'made', tier: 'medium', cents: 700 });
    expect(await month(LATE_YEAR, '2026-11-01T00:23:00Z')).toEqual({ kind: 'drawn', tier: 'medium', drawnCents: 600 });
  });

  it('credits a year withdrawn from for the days not used, and starts the credit again at nothing', async () => {
    await pick(WITHDRAWS, 'medium', '2026-10-01T00:05:00Z', true);
    await buy(WITHDRAWS, 'medium', '2026-10-01T00:10:00Z');
    expect(await month(WITHDRAWS, '2026-10-01T00:23:00Z')).toMatchObject({ kind: 'drawn', drawnCents: 600 });
    const outcome = await withTenant(driver, WITHDRAWS, (db) =>
      withdraw(
        db,
        WITHDRAWS,
        { by: 'someone', name: 'A. Tester', confirmTo: 'someone@example.invalid', language: 'en', via: 'screen' },
        new Date('2026-10-03T10:00:00Z'),
      ),
    );
    expect(outcome).toMatchObject({ kind: 'withdrawn' });
    // October to September is 365 days; three were used.
    expect(outcome.kind === 'withdrawn' && outcome.credits).toEqual([
      {
        reference: `ownpace-${WITHDRAWS}-c-y-1`,
        invoice: `ownpace-${WITHDRAWS}-y-1`,
        share: { daysPaid: 365, daysUsed: 3, numerator: 362, denominator: 365 },
      },
    ]);
    expect(await withTenant(driver, WITHDRAWS, (db) => readYears(db, WITHDRAWS))).toEqual([]);
    expect(await drawsOf(WITHDRAWS)).toEqual([]);
    // Back on Free: the next month draws nothing and invoices nothing.
    expect(await month(WITHDRAWS, '2026-11-01T00:23:00Z')).toEqual({ kind: 'free' });
  });

  /** What the database said, under the query wrapper's own words. */
  const refusal = (attempt: Promise<unknown>) =>
    attempt.then(
      () => 'allowed',
      (error: unknown) => String((error as { cause?: { message?: unknown } }).cause?.message ?? error),
    );

  it('refuses to change or delete a draw, and reads none of another organisation', async () => {
    expect(
      await refusal(withTenant(driver, GROWS, (db) => db.execute(sql`UPDATE credit_draw SET cents = 1 WHERE tenant_id = ${GROWS}`))),
    ).toMatch(/permission denied/);
    expect(
      await refusal(withTenant(driver, GROWS, (db) => db.execute(sql`DELETE FROM credit_draw WHERE tenant_id = ${GROWS}`))),
    ).toMatch(/permission denied/);
    const crossed = await withTenant(driver, STAYS_SMALL, (db) => readDraws(db, GROWS));
    expect(crossed).toEqual([]);
    expect(await withTenant(driver, STAYS_SMALL, (db) => readYears(db, GROWS))).toEqual([]);
  });
});
