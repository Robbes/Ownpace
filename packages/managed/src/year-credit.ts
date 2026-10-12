// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A YEAR PAID AHEAD (workplan 0111 T11; ADR-0014, *Amendment 2026-10-04*;
 * terms §8).
 *
 * A year is credit, paid ahead at six months' price and billed at its start.
 * Each month of its twelve takes its own tier at half that tier's monthly
 * price, so finishing paths still lowers what a month costs, and a month on
 * Free costs nothing. What is left after the twelve months pays the months that
 * follow, each at its tier's full monthly price, until it runs out; then the
 * subscription runs month to month. A year is never refunded (a withdrawal
 * within the fourteen days aside, terms §7) and never renews as a year.
 *
 * ## The owner's four answers (2026-10-12)
 *
 * 1. **Where a year starts:** with the first month not yet invoiced. This month
 *    when nothing has been billed for it yet (coming from Free), else the next.
 *    So nobody pays a month twice, and the page shows the start before the
 *    order. A year bought while another's twelve months still run adds its
 *    twelve after them, and its credit from the same first month.
 * 2. **Credit that runs out within the twelve months:** the month that empties
 *    it is invoiced the rest at half price; from the next month it is monthly,
 *    at the full price (ADR-0014: *"asks you to add another year, or to go
 *    monthly"*).
 * 3. **Which tier:** the tier the month bills, or a higher one; the credit is
 *    that tier's yearly price.
 * 4. **A notice:** one email a month before the credit runs out (slice Y3).
 *
 * ## How a month meets it
 *
 * The month task (month-invoice.ts) decides a month's step as it always did,
 * at the month's rate: half when the month is one of a year's twelve and the
 * credit is not spent at its first step, full otherwise. The month's first step
 * fixes the rate for the whole month, so a move up within it is priced as the
 * month began. What the step asks is drawn from the credit as far as it goes
 * (`credit_draw`, managed 0056), and the rest is invoiced as before. A month the
 * credit pays makes no invoice.
 *
 * ## What counts
 *
 * A year is its invoice (`ownpace-{org}-y-{n}`), not void, made since the
 * organisation's latest withdrawal; a draw counts from the same moment. A
 * withdrawal credits the year's invoice for the days it paid for and did not
 * use, as it credits every invoice of the contract (withdrawal.ts), and the
 * credit starts again at nothing: the withdrawal settled it. A year's credit
 * counts from its first month, so a year bought for next month does not pay a
 * move up in this one.
 *
 * Months are UTC, as the peak's are (managed 0015). Money is integer cents,
 * VAT included, as published; a balance that reads below nothing is a refusal,
 * never a number (hard rule 9).
 */

import { sql } from 'drizzle-orm';
import type { PgDatabase } from '@openmig/ledger/db';
import type { NotificationLocale, TenantId } from '@openmig/shared';
import { monthOf } from './billing-from.ts';
import { sinceTheLatestWithdrawal } from './since-a-withdrawal.ts';
import { creditDraw, invoice } from './schema-managed.ts';
import { MANAGED_TIERS, type ManagedTier } from './tier-calculator.ts';

type PaidTierId = Exclude<ManagedTier['id'], 'free'>;

/** How many months a year's half price lasts. */
export const MONTHS_IN_A_YEAR = 12;

// ---------------------------------------------------------------- months

/** `YYYY-MM` as a count of months, for arithmetic. */
export function monthNumber(month: string): number {
  const found = /^(\d{4})-(\d{2})$/.exec(month);
  if (!found) throw new RangeError(`${month} is not a month (YYYY-MM)`);
  const m = Number(found[2]);
  if (m < 1 || m > 12) throw new RangeError(`${month} is not a month (YYYY-MM)`);
  return Number(found[1]) * 12 + (m - 1);
}

/** The month `n` months after `month` (before, for a negative `n`). */
export function addMonths(month: string, n: number): string {
  const at = monthNumber(month) + n;
  return `${String(Math.floor(at / 12)).padStart(4, '0')}-${String((at % 12) + 1).padStart(2, '0')}`;
}

/** The first day of a month, `YYYY-MM-01`. */
export const monthFirstDay = (month: string): string => `${month}-01`;

/** The last day of a month, `YYYY-MM-DD`. */
export function monthLastDay(month: string): string {
  const next = addMonths(month, 1);
  return new Date(Date.parse(`${next}-01T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- the rule

/** A year bought, as its invoice records it. */
export interface YearBought {
  readonly reference: string;
  /** The tier it was bought for: the line names it, the credit pays any. */
  readonly tierId: PaidTierId;
  /** The credit it gives: its invoice's total, VAT included, in cents. */
  readonly cents: number;
  /** The first month its credit pays. */
  readonly creditFrom: string;
  /** Its twelve months at half price: from, to, both counted. */
  readonly halfFrom: string;
  readonly halfTo: string;
}

/** A draw, as the credit counts it. */
export interface CreditDrawn {
  readonly month: string;
  readonly tierId: PaidTierId;
  readonly cents: number;
  readonly rate: 'half' | 'full';
}

/** Where a year bought now falls. */
export interface YearPlacement {
  readonly creditFrom: string;
  readonly halfFrom: string;
  readonly halfTo: string;
}

/**
 * Where a year bought at `now` falls (the owner's answer 1): its credit from the
 * first month not yet billed, its twelve months at half price from then, or
 * after the twelve of a year that still runs.
 */
export function placeYear(now: Date, thisMonthBilled: boolean, years: readonly YearBought[]): YearPlacement {
  const thisMonth = monthOf(now);
  const creditFrom = thisMonthBilled ? addMonths(thisMonth, 1) : thisMonth;
  // After the twelve months of any year still running, else with its credit.
  const start = monthNumber(creditFrom);
  const after = years.reduce((most, y) => Math.max(most, monthNumber(y.halfTo) + 1), start);
  const halfFrom = addMonths(creditFrom, after - start);
  return { creditFrom, halfFrom, halfTo: addMonths(halfFrom, MONTHS_IN_A_YEAR - 1) };
}

/** The credit as a month finds it. */
export interface CreditForMonth {
  /** What is left for this month to draw, in cents. */
  readonly leftCents: number;
  /** Whether the month is one of a year's twelve. */
  readonly yearMonth: boolean;
}

/**
 * The credit `month` may draw: what the years whose credit has begun gave, less
 * everything drawn; and whether the month is one of a year's twelve.
 */
export function creditForMonth(month: string, years: readonly YearBought[], drawn: readonly CreditDrawn[]): CreditForMonth {
  const at = monthNumber(month);
  const given = years.filter((y) => monthNumber(y.creditFrom) <= at).reduce((sum, y) => sum + y.cents, 0);
  const used = drawn.reduce((sum, d) => sum + d.cents, 0);
  const left = given - used;
  // Never guessed: credit spent past what was given is a fault in the record.
  if (left < 0) throw new Error(`the credit for ${month} reads ${left} cents: more was drawn than the years gave`);
  const yearMonth = years.some((y) => monthNumber(y.halfFrom) <= at && at <= monthNumber(y.halfTo));
  return { leftCents: left, yearMonth };
}

/**
 * The month's rate. Its first step fixed it, when there is one; else half for
 * one of a year's twelve months with credit left, full otherwise (the owner's
 * answer 2: once the credit is spent, monthly).
 */
export function monthRate(firstStepRate: 'half' | 'full' | null, credit: CreditForMonth): 'half' | 'full' {
  if (firstStepRate) return firstStepRate;
  return credit.yearMonth && credit.leftCents > 0 ? 'half' : 'full';
}

/** A tier's monthly price at a rate, in cents: half rounds down, in the customer's favour. */
export const atRate = (cents: number, rate: 'half' | 'full'): number => (rate === 'half' ? Math.floor(cents / 2) : cents);

/** A step's split: what the credit pays, and what is invoiced. */
export interface StepSplit {
  readonly drawCents: number;
  readonly invoiceCents: number;
}

/** What the credit covers of a step, and the rest. */
export function splitStep(stepCents: number, leftCents: number): StepSplit {
  const drawCents = Math.max(0, Math.min(stepCents, leftCents));
  return { drawCents, invoiceCents: stepCents - drawCents };
}

// ---------------------------------------------------------------- the record

/** Our reference for an organisation's `n`th year: `ownpace-{org}-y-{n}`. */
export const yearReference = (tenantId: string, n: number): string => `ownpace-${tenantId}-y-${n}`;

/** What a year's invoice keeps on its row (`invoice.evidence`). */
export interface YearEvidence {
  readonly year: true;
  readonly tier: PaidTierId;
  readonly cents: number;
  readonly priceFrom: 'agreed' | 'list';
  readonly creditFrom: string;
  readonly halfFrom: string;
  readonly halfTo: string;
  readonly at: string;
}

const PAID: ReadonlySet<string> = new Set(['small', 'medium', 'large', 'xl']);

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}$/.test(v);

/**
 * The organisation's years since its latest withdrawal, read off their
 * invoices. In its own scope. A year whose row cannot be read is refused,
 * never skipped: skipped, its credit would be lost from the record.
 */
export async function readYears(db: PgDatabase, tenantId: TenantId): Promise<YearBought[]> {
  const rows = rowsOf<{ reference: string; evidence: unknown }>(
    await db.execute(sql`
      SELECT reference, evidence FROM invoice
       WHERE tenant_id = ${tenantId} AND kind = 'invoice' AND status <> 'void'
         AND reference LIKE ${`ownpace-${tenantId}-y-%`}
         AND ${sinceTheLatestWithdrawal(invoice.createdAt, tenantId)}
       ORDER BY created_at, reference`),
  );
  return rows.map((row) => {
    const e = row.evidence as Partial<YearEvidence> | null;
    if (
      !e ||
      e.year !== true ||
      !PAID.has(String(e.tier)) ||
      typeof e.cents !== 'number' ||
      !Number.isInteger(e.cents) ||
      e.cents <= 0 ||
      !isMonth(e.creditFrom) ||
      !isMonth(e.halfFrom) ||
      !isMonth(e.halfTo)
    ) {
      throw new Error(`invoice ${row.reference}: it cannot be read as a year bought`);
    }
    return {
      reference: row.reference,
      tierId: e.tier as PaidTierId,
      cents: e.cents,
      creditFrom: e.creditFrom,
      halfFrom: e.halfFrom,
      halfTo: e.halfTo,
    };
  });
}

/** Every draw since the latest withdrawal. In the organisation's own scope. */
export async function readDraws(db: PgDatabase, tenantId: TenantId): Promise<CreditDrawn[]> {
  const rows = rowsOf<{ month: string; tier_id: string; cents: number; rate: string }>(
    await db.execute(sql`
      SELECT month::text AS month, tier_id, cents, rate FROM credit_draw
       WHERE tenant_id = ${tenantId} AND ${sinceTheLatestWithdrawal(creditDraw.drawnAt, tenantId)}
       ORDER BY drawn_at, month, tier_id`),
  );
  return rows.map((r) => ({
    // A date column, `YYYY-MM-DD`: its month, with no zone to render it in.
    month: r.month.slice(0, 7),
    tierId: r.tier_id as PaidTierId,
    cents: Number(r.cents),
    rate: r.rate === 'half' ? 'half' : 'full',
  }));
}

/** How many years the organisation ever bought: the next one's number. */
async function yearsEverBought(db: PgDatabase, tenantId: TenantId): Promise<number> {
  const [row] = rowsOf<{ n: number }>(
    await db.execute(sql`
      SELECT count(*)::int AS n FROM invoice
       WHERE tenant_id = ${tenantId} AND kind = 'invoice' AND reference LIKE ${`ownpace-${tenantId}-y-%`}`),
  );
  return Number(row?.n ?? 0);
}

/** Whether anything was billed for `month` yet: an invoice of its steps, or a draw. */
async function monthBilled(db: PgDatabase, tenantId: TenantId, month: string): Promise<boolean> {
  const [row] = rowsOf<{ n: number }>(
    await db.execute(sql`
      SELECT (SELECT count(*) FROM invoice
               WHERE tenant_id = ${tenantId} AND kind = 'invoice' AND status <> 'void'
                 AND reference LIKE ${`ownpace-${tenantId}-m-${month}-%`})
           + (SELECT count(*) FROM credit_draw
               WHERE tenant_id = ${tenantId} AND month = ${monthFirstDay(month)}::date) AS n`),
  );
  return Number(row?.n ?? 0) > 0;
}

/** Where a year bought now would fall, read in the organisation's own scope. */
export async function readYearPlacement(db: PgDatabase, tenantId: TenantId, now: Date): Promise<YearPlacement> {
  return placeYear(now, await monthBilled(db, tenantId, monthOf(now)), await readYears(db, tenantId));
}

/** The words of a year's invoice line, in the organisation's language. */
export function yearLine(tier: ManagedTier, placement: YearPlacement, locale: NotificationLocale): string {
  const [from, to] = [placement.creditFrom, placement.halfTo].map((m) => monthWords(m, locale));
  return locale === 'nl'
    ? `Ownpace ${tier.name}, een jaar vooruit, ${from} tot en met ${to}: tegoed`
    : `Ownpace ${tier.name}, a year ahead, ${from} to ${to}: credit`;
}

const MONTH_NAMES: Readonly<Record<NotificationLocale, readonly string[]>> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  nl: ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'],
};

/** `2026-11` as `November 2026` or `november 2026`. No `Intl`, as the month's line has none. */
export function monthWords(month: string, locale: NotificationLocale): string {
  const n = monthNumber(month);
  return `${MONTH_NAMES[locale][n % 12]} ${Math.floor(n / 12)}`;
}

/** A year bought: what it is for, and the price agreed. */
export interface YearOrder {
  readonly tier: ManagedTier;
  /** Its yearly price as shown, in cents, VAT included. */
  readonly cents: number;
  readonly priceFrom: 'agreed' | 'list';
}

export type YearRecorded = { readonly kind: 'recorded'; readonly reference: string } & YearPlacement & {
    readonly tierId: PaidTierId;
    readonly cents: number;
  };

/**
 * Record a year bought: its invoice, a draft the hourly push takes to the books
 * as it takes every draft, placed as `placeYear` says. In the organisation's own
 * transaction, under the month's lock, so the month task and the order see one
 * order of events: a step made first makes the year start next month, and a
 * year recorded first is drawn by the step.
 */
export async function recordYear(
  db: PgDatabase,
  tenantId: TenantId,
  order: YearOrder,
  now: Date,
  locale: NotificationLocale,
): Promise<YearRecorded> {
  if (order.tier.id === 'free') throw new RangeError('Free is never bought: free means no invoice');
  if (!Number.isInteger(order.cents) || order.cents <= 0) throw new RangeError(`${order.cents} cents is not a year's price`);
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`month-invoice:${tenantId}`}, 0))`);
  const placement = await readYearPlacement(db, tenantId, now);
  const reference = yearReference(tenantId, (await yearsEverBought(db, tenantId)) + 1);
  const evidence: YearEvidence = {
    year: true,
    tier: order.tier.id as PaidTierId,
    cents: order.cents,
    priceFrom: order.priceFrom,
    ...placement,
    at: now.toISOString(),
  };
  const description = yearLine(order.tier, placement, locale);
  const amount = String(order.cents);
  const inserted = rowsOf<{ id: string }>(
    await db.execute(sql`
      INSERT INTO invoice (tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total,
                           currency, reference, kind, evidence, lines, created_at)
      VALUES (${tenantId}, ${monthFirstDay(placement.creditFrom)}, ${monthLastDay(placement.halfTo)},
              'draft', ${amount}, 0, 0, ${amount}, 'EUR', ${reference}, 'invoice',
              ${JSON.stringify(evidence)}::jsonb,
              ${JSON.stringify([{ description, publishedCents: order.cents }])}::jsonb,
              -- The order's moment, which the withdrawal and the credit read it by.
              ${now.toISOString()}::timestamptz)
      RETURNING id`),
  );
  if (inserted.length !== 1) throw new Error(`the year ${reference} was not recorded`);
  return { kind: 'recorded', reference, tierId: order.tier.id as PaidTierId, cents: order.cents, ...placement };
}

/** A paid tier's yearly price as published, in cents: six months'. */
export function yearlyCentsOf(tier: ManagedTier): number {
  return tier.annualCents;
}

/** The tiers a year may be bought for: the one the month bills, or a higher paid one (the owner's answer 3). */
export function yearTiers(billed: ManagedTier): ManagedTier[] {
  const from = Math.max(1, MANAGED_TIERS.findIndex((t) => t.id === billed.id));
  return MANAGED_TIERS.slice(from);
}
