// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CREDIT RUNNING OUT, SAID ONCE (workplan 0111 T11, slice Y3; the owner,
 * 2026-10-12: *"Send an email a month before the credit runs out? Yes, one
 * email"*).
 *
 * A year paid ahead is credit each month draws from (`year-credit.ts`); once it
 * is spent, the months are invoiced again. The month before the first month the
 * credit does not pay in full, the organisation is told, once: what is left,
 * what that month costs, and that another year can be bought. This is one
 * organisation's half, in its own scope. The month task
 * (`managed-month-invoices.ts`) asks it after each month's step, and sends.
 *
 * 1. **A year bought, a paid tier.** With no year since the latest withdrawal,
 *    or a month that bills Free, there is no credit to run out.
 * 2. **Next month, as the month task will price it.** The credit next month
 *    may draw (`creditForMonth`, every draw so far counted), against what the
 *    tier the month bills now costs then, at the rate its first step would
 *    take: half within a year's twelve months while credit is left, else full
 *    (`monthRate`). When the credit pays all of it, nothing is said.
 * 3. **Once per year bought.** The claim on managed 0057's `credit_notice`,
 *    keyed by the latest year's reference. Another year bought is news again
 *    when its credit runs low; the same year's never is.
 *
 * Asked every hour, it is said within the hour the credit first falls short:
 * as a rule on the first of the month before, once that month has drawn; after
 * a move up, the hour after it. The claim is made before the send and stands
 * whatever the send does, as the slower cadence's does: a channel switched on
 * next week must not tell anyone then about today.
 */

import { sql } from 'drizzle-orm';
import type { PgDatabase } from '@openmig/ledger/db';
import type { NotificationEvent, NotificationLocale, TenantId } from '@openmig/shared';
import { monthOf } from './billing-from.ts';
import { priceOfTier, readAgreedPrices } from './month-invoice.ts';
import { euros } from './month-invoice-words.ts';
import { readBilledNow } from './pace.ts';
import { creditNotice } from './schema-managed.ts';
import type { ManagedTier } from './tier-calculator.ts';
import { addMonths, atRate, creditForMonth, monthRate, monthWords, readDraws, readYears } from './year-credit.ts';

/** What one organisation's hour came to. */
export type CreditNotice =
  /** No year bought since the latest withdrawal: no credit to run out. */
  | { readonly kind: 'no_year' }
  /** The month bills Free, which draws nothing. */
  | { readonly kind: 'free' }
  /** The credit pays all of next month. */
  | { readonly kind: 'covered' }
  /** Said before, for the latest year. */
  | { readonly kind: 'said_before' }
  /** Claimed: this is to be said. */
  | {
      readonly kind: 'claimed';
      /** The organisation's name, as the order's confirmation names it. */
      readonly organisation: string;
      /** The first month the credit does not pay in full: `2027-10`. */
      readonly month: string;
      readonly leftCents: number;
      readonly tier: { readonly id: Exclude<ManagedTier['id'], 'free'>; readonly name: string };
      /** What that month costs, at its rate, in cents. */
      readonly costCents: number;
      readonly rate: 'half' | 'full';
    };

/** The rows a statement answers in a scope: node-postgres carries them under `rows`. */
const rowsOf = <R>(result: unknown): R[] => (result as { rows: R[] }).rows;

/**
 * One organisation's notice, claimed, in its own scope: `db` is the handle
 * `withTenant` gives. Reads and claims in that one transaction, and sends
 * nothing: the caller does, after it commits.
 */
export async function claimCreditNotice(db: PgDatabase, tenantId: TenantId, now: Date): Promise<CreditNotice> {
  // 1. A year bought, a paid tier.
  const years = await readYears(db, tenantId);
  const latest = years[years.length - 1];
  if (!latest) return { kind: 'no_year' };
  const tier = (await readBilledNow(db, tenantId, now)).billed.tier;
  if (tier.id === 'free') return { kind: 'free' };

  // 2. Next month, as the month task will price it.
  const month = addMonths(monthOf(now), 1);
  const credit = creditForMonth(month, years, await readDraws(db, tenantId));
  const rate = monthRate(null, credit);
  const costCents = atRate(priceOfTier(tier, await readAgreedPrices(db, tenantId, now)).cents, rate);
  if (credit.leftCents >= costCents) return { kind: 'covered' };

  // 3. Once per year bought.
  const [won] = await db
    .insert(creditNotice)
    .values({
      tenantId,
      yearReference: latest.reference,
      month: `${month}-01`,
      evidence: { leftCents: credit.leftCents, tier: tier.id, costCents, rate, at: now.toISOString() },
      noticedAt: now,
    })
    .onConflictDoNothing()
    .returning({ yearReference: creditNotice.yearReference });
  if (!won) return { kind: 'said_before' };

  const [organisation] = rowsOf<{ name: string }>(await db.execute(sql`SELECT name FROM tenant WHERE id = ${tenantId}`));
  return {
    kind: 'claimed',
    organisation: organisation?.name ?? '',
    month,
    leftCents: credit.leftCents,
    tier: { id: tier.id as Exclude<ManagedTier['id'], 'free'>, name: tier.name },
    costCents,
    rate,
  };
}

/** The notice as the mail says it, in the organisation's language. */
export function creditNoticeEvent(
  notice: Extract<CreditNotice, { kind: 'claimed' }>,
  locale: NotificationLocale,
): Extract<NotificationEvent, { kind: 'credit_running_out' }> {
  return {
    kind: 'credit_running_out',
    organisation: notice.organisation,
    month: monthWords(notice.month, locale),
    left: euros(notice.leftCents, locale),
    tier: notice.tier.name,
    cost: euros(notice.costCents, locale),
    halfPrice: notice.rate === 'half',
  };
}
