// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MONTH INVOICED IN ADVANCE (workplan 0111, slice 4 of §"The build,
 * sliced"; 0109 T5; decision 6, the owner, 2026-10-05: *"no, please invoice in
 * advance of the month"*).
 *
 * What a month bills does not change: what it used, never above the agreed
 * tier, never below a tier picked. That is `readBilledNow` (pace.ts), the rule
 * the Billing page's *What this month bills* reads, so the page and the
 * invoices cannot disagree. When it is invoiced does: on its first day (UTC),
 * at the tier it starts on, and after a move up during it, for the
 * difference, so its invoices always add up to what it bills.
 *
 * ## One step, one row, one reference
 *
 * Each run asks one question of an organisation: does what the month bills
 * stand above the highest tier its invoices name? When it does, one draft is
 * made for the step, under `ownpace-{organisation}-m-{YYYY-MM}-{tier}`, for the
 * tier's monthly price less what the month's invoices already ask. When it
 * does not, nothing is made. So a second run makes no second row, and a run
 * that died after its insert is answered by the next, which finds the row.
 * The reference is unique (managed 0045) and the insert gives way to it, so
 * two runs make one row; and a lock on the organisation, held to the end of
 * the transaction, keeps two runs from deciding two different steps on the
 * same reading of the month's invoices.
 *
 * Free makes no row: free means no invoice, not one for nothing (ADR-0014). A
 * month bills no less as it goes on (its peak, its picks and its yeses only
 * rise, and the data counted never falls), so a step once made stays below
 * what the month bills. A voided step still names its tier, so the task never
 * makes it again: a person withdrew it, and a person decides what follows. What
 * it asked is not counted towards the month.
 *
 * ## It prices, so it trues up first
 *
 * Before reading, it records the paths held now as the month's peak if they
 * are more (`recordCurrentOccupancy`, the true-up `currentTier` makes for the
 * same reason): a standing fleet in a quiet month raised no mark, and the
 * invoice is the moment that gap closes. The peak it quotes is then a mark on
 * the record, with the date it was set, and never a number only this run saw.
 *
 * ## The price
 *
 * The agreed one (the owner said yes to it on 2026-10-05: the agreed
 * `price_eur` when a month bills a tier said yes to): the latest yes or pick
 * naming the tier, made by the moment priced, at the monthly price it showed
 * (`data_allowance.price_eur` for a move up, `tier_pick.price_eur`; whole
 * euros). A tier never said yes to bills at the list's price
 * (`MANAGED_TIERS`). So a later list change never re-prices what was agreed.
 *
 * ## What the row carries, and what it leaves to the push
 *
 * A draft, born unnumbered (0045): the month as its period, the step's price
 * as published (VAT included, as the price list) as its total, in cents as
 * the money columns have always held it (the pay route asks Mollie for
 * `total` in cents, and the Billing page formats it as cents), our reference,
 * the evidence its line quotes, and the line in the organisation's language
 * (month-invoice-words.ts). The VAT treatment, the tax rate, the price without
 * Dutch VAT for a reverse-charge buyer and the VIES words are the push's
 * (slice 5), which writes them while the row is a draft, and Moneybird's own
 * figures at issue.
 *
 * ## A year paid ahead (T11)
 *
 * When the organisation bought a year (year-credit.ts), the month's step is
 * priced at the month's rate: half for one of a year's twelve months while
 * credit is left at its first step, full otherwise, and the first step fixes
 * the rate for the month. What the step asks is drawn from the credit as far
 * as it goes (`credit_draw`, managed 0056), and only the rest is invoiced, in
 * the same transaction under the same lock. A draw names its step as the
 * invoice's reference would, so a step is drawn once, invoiced once, or both
 * once.
 *
 * ## What it does not do
 *
 * Push (slice 5). Top-ups and credit notes, `-t-` and `-c-` (slice 7 teaches
 * the rule credit notes). Ask whether billing is on: the task does, and calls
 * this only for a month on or after `OWNPACE_BILLING_FROM`, outside the Alpha
 * (billing-from.ts). A closed organisation is not visited, so nothing is
 * invoiced after the close (decision 13).
 */

import { and, eq, lte, sql } from 'drizzle-orm';
import type { PgDatabase } from '@openmig/ledger/db';
import type { NotificationLocale, TenantId } from '@openmig/shared';
import { monthOf } from './billing-from.ts';
import { PgOccupancyPeakStore } from './occupancy-peak.ts';
import { readBilledNow, type BilledNow } from './pace.ts';
import { dataAllowance, invoice, tierPick } from './schema-managed.ts';
import { MANAGED_TIERS, type ManagedTier } from './tier-calculator.ts';
import { monthStartOf, nextMonthStartOf } from './tier-pick.ts';
import { monthLine, type BilledBy } from './month-invoice-words.ts';
import { atRate, creditForMonth, monthRate, readDraws, readYears, splitStep, type CreditForMonth } from './year-credit.ts';

type TierId = ManagedTier['id'];

/** A tier's place in the published table; Free is 0. */
const placeOf = (id: string): number => MANAGED_TIERS.findIndex((t) => t.id === id);

/** One of the month's steps, invoiced or drawn from a year's credit, as the rule reads it. */
export interface MonthStep {
  readonly tierId: TierId;
  /** What the step asked, as published (VAT included), in cents. */
  readonly cents: number;
  /** An invoice's status, or `drawn`: paid from a year's credit (T11). */
  readonly status: 'draft' | 'sent' | 'paid' | 'overdue' | 'void' | 'drawn';
  /** The month's rate when the step was made: half within a year, else full. Before T11, full. */
  readonly rate?: 'half' | 'full';
  /** When the step was made (ISO), so the month's first one fixes its rate. */
  readonly at?: string;
}

/** What a month's invoices need now. */
export type MonthDecision =
  /** The month bills Free: no invoice. */
  | { readonly kind: 'free' }
  /** Its invoices already name the tier it bills, or one above it. */
  | { readonly kind: 'in_step' }
  /** It bills a tier above them, at a price that asks no more than they do already. */
  | { readonly kind: 'nothing_to_add' }
  /** One step: the tier it bills now, for what the month's invoices do not ask yet. */
  | {
      readonly kind: 'step';
      readonly tier: ManagedTier;
      readonly cents: number;
      /** What the month's invoices asked before it, in cents. */
      readonly beforeCents: number;
      /** The highest tier they named, null on the month's first. */
      readonly after: ManagedTier | null;
    };

/**
 * The rule, from what the month bills now, that tier's monthly price in
 * cents, and the month's invoices so far.
 */
export function decideMonthStep(billed: ManagedTier, priceCents: number, steps: readonly MonthStep[]): MonthDecision {
  const highest = steps.reduce((most, step) => Math.max(most, placeOf(step.tierId)), -1);
  if (placeOf(billed.id) <= highest) return { kind: 'in_step' };
  if (billed.id === 'free') return { kind: 'free' };
  const beforeCents = steps.filter((step) => step.status !== 'void').reduce((sum, step) => sum + step.cents, 0);
  const cents = priceCents - beforeCents;
  if (cents <= 0) return { kind: 'nothing_to_add' };
  return { kind: 'step', tier: billed, cents, beforeCents, after: highest >= 0 ? MANAGED_TIERS[highest]! : null };
}

/** A yes or a pick naming a tier, at the monthly price it showed. */
export interface AgreedPrice {
  readonly tierId: string;
  readonly priceEur: number;
  readonly at: Date;
}

/** A tier's monthly price in cents: the latest agreement naming it, else the list's. */
export function priceOfTier(
  tier: ManagedTier,
  agreed: readonly AgreedPrice[],
): { readonly cents: number; readonly from: 'agreed' | 'list' } {
  const latest = agreed
    .filter((a) => a.tierId === tier.id)
    .reduce<AgreedPrice | null>((last, a) => (last && last.at.getTime() >= a.at.getTime() ? last : a), null);
  return latest ? { cents: latest.priceEur * 100, from: 'agreed' } : { cents: tier.monthlyCents, from: 'list' };
}

/** Ours, fixed once used, here and at Moneybird (0045). */
export function monthReference(tenantId: string, at: Date, tierId: TierId): string {
  return `ownpace-${tenantId}-m-${monthOf(at)}-${tierId}`;
}

/** Why the month bills its tier: the pick, the agreed tier past what was used, or the axis that decided it. */
export function billedBy(state: Pick<BilledNow, 'billed' | 'measured'>): BilledBy {
  if (state.billed.picked) return 'picked';
  if (state.billed.beyond.length > 0 || state.measured.tier?.id !== state.billed.tier.id) return 'agreed';
  return state.measured.decidedBy === 'data' ? 'data' : 'paths';
}

/** What the line quotes, kept on the row (`invoice.evidence`, frozen past draft). */
export interface MonthEvidence {
  readonly month: string;
  /** The month's rate (T11): half within a year with credit left, else full. */
  readonly rate: 'half' | 'full';
  /** What a year's credit paid of the step, in cents (T11); `cents` is the rest, invoiced. */
  readonly drawnCents: number;
  readonly tier: TierId;
  readonly by: BilledBy;
  readonly peakPaths: number;
  readonly peakAt: string | null;
  readonly gbCounted: number;
  readonly agreedTier: TierId;
  readonly priceCents: number;
  readonly priceFrom: 'agreed' | 'list';
  readonly beforeCents: number;
  readonly cents: number;
  readonly at: string;
}

/** What a run did for one organisation. */
export type MonthOutcome =
  | { readonly kind: 'free' | 'in_step' | 'nothing_to_add' }
  | {
      readonly kind: 'made';
      readonly reference: string;
      readonly tier: TierId;
      /** What the invoice asks, in cents. */
      readonly cents: number;
      /** What a year's credit paid of the step before it (T11), in cents. */
      readonly drawnCents?: number;
    }
  /** The step was paid from a year's credit, all of it: no invoice (T11). */
  | { readonly kind: 'drawn'; readonly tier: TierId; readonly drawnCents: number }
  /** Another run made the same step between this one's read and its insert. */
  | { readonly kind: 'made_elsewhere'; readonly reference: string };

const STATUSES: ReadonlySet<string> = new Set(['draft', 'sent', 'paid', 'overdue', 'void']);

/** The month's invoices made by this rule, read off their references and evidence. */
async function readMonthSteps(db: PgDatabase, tenantId: TenantId, at: Date): Promise<MonthStep[]> {
  const prefix = `ownpace-${tenantId}-m-${monthOf(at)}-`;
  const rows = await db
    .select({ reference: invoice.reference, status: invoice.status, evidence: invoice.evidence })
    .from(invoice)
    .where(
      and(
        eq(invoice.tenantId, tenantId),
        eq(invoice.periodStart, monthStartOf(at).toISOString().slice(0, 10)),
        eq(invoice.kind, 'invoice'),
      ),
    );
  const steps: MonthStep[] = [];
  for (const row of rows) {
    if (!row.reference?.startsWith(prefix)) continue;
    const tierId = row.reference.slice(prefix.length);
    const evidence = row.evidence as { cents?: unknown; rate?: unknown; at?: unknown } | null;
    const cents = evidence?.cents;
    // Never guessed: money read off a row is either what the row says or a refusal.
    if (placeOf(tierId) < 0 || typeof cents !== 'number' || !Number.isInteger(cents) || !STATUSES.has(row.status)) {
      throw new Error(`invoice ${row.reference}: its tier, its amount or its status cannot be read as a step of the month`);
    }
    // A step made before T11 has no rate: every month was full then.
    const rate = evidence?.rate === 'half' ? 'half' : 'full';
    steps.push({
      tierId: tierId as TierId,
      cents,
      status: row.status,
      rate,
      ...(typeof evidence?.at === 'string' ? { at: evidence.at } : {}),
    });
  }
  // What a year's credit paid (T11): a step as much as an invoice is.
  const drawn = await db.execute(sql`
    SELECT tier_id, cents, rate, drawn_at FROM credit_draw
     WHERE tenant_id = ${tenantId} AND month = ${monthStartOf(at).toISOString().slice(0, 10)}::date`);
  for (const row of resultRows<{ tier_id: string; cents: number; rate: string; drawn_at: Date | string }>(drawn)) {
    steps.push({
      tierId: row.tier_id as TierId,
      cents: Number(row.cents),
      status: 'drawn',
      rate: row.rate === 'half' ? 'half' : 'full',
      at: new Date(row.drawn_at).toISOString(),
    });
  }
  return steps;
}

/** The rate the month's first step fixed, or null when it has none yet. */
function firstStepRate(steps: readonly MonthStep[]): 'half' | 'full' | null {
  const dated = steps.filter((s) => s.status !== 'void');
  if (dated.length === 0) return null;
  const first = dated.reduce((a, b) => ((a.at ?? '') <= (b.at ?? '') ? a : b));
  return first.rate ?? 'full';
}

/** Every yes to a tier and every pick, made by `at`, at the price each showed. */
export async function readAgreedPrices(db: PgDatabase, tenantId: TenantId, at: Date): Promise<AgreedPrice[]> {
  const yeses = await db
    .select({ tierId: dataAllowance.tierId, priceEur: dataAllowance.priceEur, at: dataAllowance.consentedAt })
    .from(dataAllowance)
    .where(and(eq(dataAllowance.tenantId, tenantId), eq(dataAllowance.kind, 'tier'), lte(dataAllowance.consentedAt, at)));
  const picks = await db
    .select({ tierId: tierPick.tierId, priceEur: tierPick.priceEur, at: tierPick.pickedAt })
    .from(tierPick)
    .where(and(eq(tierPick.tenantId, tenantId), lte(tierPick.pickedAt, at)));
  return [...yeses, ...picks];
}

function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

/**
 * Keep one organisation's month invoiced in advance: true up, read what it
 * bills, and make the one step its invoices lack, if any. In the
 * organisation's own transaction (`withTenant`), as every store here.
 */
export async function openTheMonth(
  db: PgDatabase,
  tenantId: TenantId,
  now: Date,
  locale: NotificationLocale,
): Promise<MonthOutcome> {
  // One decision per organisation at a time, to the end of this transaction.
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`month-invoice:${tenantId}`}, 0))`);
  await new PgOccupancyPeakStore(db).recordCurrentOccupancy(tenantId, now);
  const state = await readBilledNow(db, tenantId, now);
  const steps = await readMonthSteps(db, tenantId, now);
  const price = priceOfTier(state.billed.tier, await readAgreedPrices(db, tenantId, now));
  // A year paid ahead (T11): the month's rate, and the credit it may draw.
  const credit: CreditForMonth = creditForMonth(monthOf(now), await readYears(db, tenantId), await readDraws(db, tenantId));
  const rate = monthRate(firstStepRate(steps), credit);
  const decision = decideMonthStep(state.billed.tier, atRate(price.cents, rate), steps);
  if (decision.kind !== 'step') return { kind: decision.kind };
  const split = splitStep(decision.cents, credit.leftCents);

  const by = billedBy(state);
  if (split.drawCents > 0) {
    await db.execute(sql`
      INSERT INTO credit_draw (tenant_id, month, tier_id, cents, rate, drawn_at, evidence)
      VALUES (${tenantId}, ${monthStartOf(now).toISOString().slice(0, 10)}::date, ${decision.tier.id},
              ${split.drawCents}, ${rate}, ${now.toISOString()}::timestamptz,
              ${JSON.stringify({
                month: monthOf(now),
                tier: decision.tier.id,
                by,
                rate,
                priceCents: price.cents,
                priceFrom: price.from,
                beforeCents: decision.beforeCents,
                stepCents: decision.cents,
                creditBeforeCents: credit.leftCents,
                at: now.toISOString(),
              })}::jsonb)`);
    if (split.invoiceCents === 0) return { kind: 'drawn', tier: decision.tier.id, drawnCents: split.drawCents };
  }

  const evidence: MonthEvidence = {
    month: monthOf(now),
    rate,
    drawnCents: split.drawCents,
    tier: decision.tier.id,
    by,
    peakPaths: state.measured.evidence.peakPaths,
    peakAt: state.peak?.peakAt ?? null,
    gbCounted: state.measured.evidence.gbMoved,
    agreedTier: state.allowance.tier.id,
    priceCents: price.cents,
    priceFrom: price.from,
    beforeCents: decision.beforeCents,
    cents: split.invoiceCents,
    at: now.toISOString(),
  };
  const description = monthLine(
    {
      tier: decision.tier,
      month: now,
      by,
      peakPaths: evidence.peakPaths,
      peakAt: evidence.peakAt,
      gbCounted: evidence.gbCounted,
      after: decision.after,
      afterDrawn: steps.some((step) => step.status === 'drawn'),
      rate,
      drawnCents: split.drawCents,
    },
    locale,
  );
  const reference = monthReference(tenantId, now, decision.tier.id);
  const lastDay = new Date(nextMonthStartOf(now).getTime() - 86_400_000);
  // In cents, as the money columns have always held it: the pay route asks
  // Mollie for `total` as cents, and the Billing page formats it as cents.
  const amount = String(split.invoiceCents);
  const inserted = resultRows<{ id: string }>(
    await db.execute(sql`
      INSERT INTO invoice (tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total,
                           currency, reference, kind, evidence, lines)
      VALUES (${tenantId}, ${monthStartOf(now).toISOString().slice(0, 10)}, ${lastDay.toISOString().slice(0, 10)},
              'draft', ${amount}, 0, 0, ${amount}, 'EUR', ${reference}, 'invoice',
              ${JSON.stringify(evidence)}::jsonb,
              ${JSON.stringify([{ description, publishedCents: split.invoiceCents }])}::jsonb)
      ON CONFLICT (reference) WHERE reference IS NOT NULL DO NOTHING
      RETURNING id`),
  );
  if (inserted.length === 0) return { kind: 'made_elsewhere', reference };
  return {
    kind: 'made',
    reference,
    tier: decision.tier.id,
    cents: split.invoiceCents,
    ...(split.drawCents > 0 ? { drawnCents: split.drawCents } : {}),
  };
}
