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
 * as published (VAT included, as the price list) as its total, our reference,
 * the evidence its line quotes, and the line in the organisation's language
 * (month-invoice-words.ts). The VAT treatment, the tax rate, the price without
 * Dutch VAT for a reverse-charge buyer and the VIES words are the push's
 * (slice 5), which writes them while the row is a draft, and Moneybird's own
 * figures at issue.
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

type TierId = ManagedTier['id'];

/** A tier's place in the published table; Free is 0. */
const placeOf = (id: string): number => MANAGED_TIERS.findIndex((t) => t.id === id);

/** One of the month's invoices, as the rule reads it. */
export interface MonthStep {
  readonly tierId: TierId;
  /** What the step asked, as published (VAT included), in cents. */
  readonly cents: number;
  readonly status: 'draft' | 'sent' | 'paid' | 'overdue' | 'void';
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
  | { readonly kind: 'made'; readonly reference: string; readonly tier: TierId; readonly cents: number }
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
    const cents = (row.evidence as { cents?: unknown } | null)?.cents;
    // Never guessed: money read off a row is either what the row says or a refusal.
    if (placeOf(tierId) < 0 || typeof cents !== 'number' || !Number.isInteger(cents) || !STATUSES.has(row.status)) {
      throw new Error(`invoice ${row.reference}: its tier, its amount or its status cannot be read as a step of the month`);
    }
    steps.push({ tierId: tierId as TierId, cents, status: row.status });
  }
  return steps;
}

/** Every yes to a tier and every pick, made by `at`, at the price each showed. */
async function readAgreedPrices(db: PgDatabase, tenantId: TenantId, at: Date): Promise<AgreedPrice[]> {
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

/** Cents as the numeric columns hold euros: `1200` → `12.00`. */
function euros(cents: number): string {
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
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
  const decision = decideMonthStep(state.billed.tier, price.cents, steps);
  if (decision.kind !== 'step') return { kind: decision.kind };

  const by = billedBy(state);
  const evidence: MonthEvidence = {
    month: monthOf(now),
    tier: decision.tier.id,
    by,
    peakPaths: state.measured.evidence.peakPaths,
    peakAt: state.peak?.peakAt ?? null,
    gbCounted: state.measured.evidence.gbMoved,
    agreedTier: state.allowance.tier.id,
    priceCents: price.cents,
    priceFrom: price.from,
    beforeCents: decision.beforeCents,
    cents: decision.cents,
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
    },
    locale,
  );
  const reference = monthReference(tenantId, now, decision.tier.id);
  const lastDay = new Date(nextMonthStartOf(now).getTime() - 86_400_000);
  const amount = euros(decision.cents);
  const inserted = resultRows<{ id: string }>(
    await db.execute(sql`
      INSERT INTO invoice (tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total,
                           currency, reference, kind, evidence, lines)
      VALUES (${tenantId}, ${monthStartOf(now).toISOString().slice(0, 10)}, ${lastDay.toISOString().slice(0, 10)},
              'draft', ${amount}, 0, 0, ${amount}, 'EUR', ${reference}, 'invoice',
              ${JSON.stringify(evidence)}::jsonb,
              ${JSON.stringify([{ description, publishedCents: decision.cents }])}::jsonb)
      ON CONFLICT (reference) WHERE reference IS NOT NULL DO NOTHING
      RETURNING id`),
  );
  if (inserted.length === 0) return { kind: 'made_elsewhere', reference };
  return { kind: 'made', reference, tier: decision.tier.id, cents: decision.cents };
}
