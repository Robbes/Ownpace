// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A WITHDRAWAL FROM THE CONTRACT (workplan 0111, T7, slice 7b; decision 15,
 * the owner, 2026-10-05: "Back to Free from that moment, account and
 * migrations kept; the days used billed in proportion, the excess credited
 * with a credit note; a confirmation e-mail in the organisation's language";
 * terms §7).
 *
 * ## The contract, and its fourteen days
 *
 * The contract a consumer withdraws from is the paid one: it is concluded by
 * the first yes after Free (a yes at the data ceiling, at *Start*, or a pick
 * above the agreed tier: each is a row in `data_allowance`), and the first yes
 * after a withdrawal concludes a new one. It may be withdrawn from until the
 * end of the fourteenth day after the day it was concluded, and when that day
 * is a Saturday or a Sunday, until the end of the Monday after it. Days are
 * UTC days, which end later than Dutch ones: the window is never shorter than
 * the law's. A business customer has no right of withdrawal (terms §7); an
 * organisation that gave no invoice details is treated as a consumer.
 *
 * ## What it does
 *
 * One transaction, under the two locks the writers of a tier and of a month's
 * invoice take, so neither interleaves: the withdrawal is recorded
 * (`contract_withdrawal`, managed 0049), from which moment every reader of the
 * tier reads Free (`since-a-withdrawal.ts`); and each invoice of the contract
 * gets its credit note (`credit-note.ts`), for the days it paid for and was
 * not used. The days used are billed only when the consumer asked us to begin
 * before the fourteen days were over (terms §7; without that request the
 * Consumer Rights Directive, article 14(4)(a)(ii), lets them bear no cost). No
 * yes records that request yet, so for now every invoice of the contract is
 * credited in full; the yes that asks for it is slice 7d.
 *
 * ## The days of an invoice
 *
 * An invoice pays for the days from when its step was made (the month's first
 * hour, or the moment a move up was invoiced) to the end of its month, both
 * days counted. The days used run from the same first day to the day of the
 * withdrawal, which counts as used: a day the service ran is a day used. The
 * credit is the rest, as a share (`numerator` of `denominator`), priced from
 * the invoice as issued when the credit note is pushed.
 */

import { and, asc, eq, sql } from 'drizzle-orm';
import type { PgDatabase } from '@openmig/ledger/db';
import type { NotificationLocale, TenantId } from '@openmig/shared';
import { recordCreditNote } from './credit-note.ts';
import type { PaidTierId } from './data-ceiling.ts';
import { billingParty, contractWithdrawal, dataAllowance } from './schema-managed.ts';
import { sinceTheLatestWithdrawal } from './since-a-withdrawal.ts';
import { MANAGED_TIERS } from './tier-calculator.ts';

/** The days a consumer has to withdraw (terms §7). */
export const WITHDRAWAL_DAYS = 14;

const DAY_MS = 86_400_000;

/** The start of `at`'s UTC day, in milliseconds. */
const dayOf = (at: Date): number => Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());

/** `YYYY-MM-DD` as the start of its UTC day, in milliseconds. */
const dayOfDate = (date: string): number => Date.parse(`${date}T00:00:00Z`);

/**
 * The moment a withdrawal is too late: the end of the fourteenth day after the
 * day `since` falls on, moved to the end of the Monday after it when that day
 * is a Saturday or a Sunday. Exclusive.
 */
export function withdrawalUntil(since: Date): Date {
  const lastDay = dayOf(since) + WITHDRAWAL_DAYS * DAY_MS;
  const weekday = new Date(lastDay).getUTCDay();
  const moved = weekday === 6 ? 2 : weekday === 0 ? 1 : 0;
  return new Date(lastDay + (moved + 1) * DAY_MS);
}

/** A yes on record since the latest withdrawal: when, and to which tier. */
export interface PaidCommitment {
  readonly at: Date;
  readonly tierId: PaidTierId;
}

export type WithdrawalWindow =
  | {
      readonly kind: 'open';
      /** When the contract was concluded: its first yes. */
      readonly since: Date;
      /** When a withdrawal is too late (exclusive). */
      readonly until: Date;
      /** The tier it stands at: the highest it said yes to. */
      readonly tier: PaidTierId;
      /** Whether the consumer asked us to begin before the fourteen days were over. */
      readonly beganOnRequest: boolean;
    }
  | {
      readonly kind: 'closed';
      /** `nothing_paid`: on Free, or withdrawn already; `business`: no right of withdrawal; `past`: the fourteen days are over. */
      readonly reason: 'nothing_paid' | 'business' | 'past';
      readonly since: Date | null;
      readonly until: Date | null;
    };

/** Whether the organisation may withdraw now, from what is on record. */
export function withdrawalWindow(
  facts: {
    readonly partyKind: 'consumer' | 'business' | null;
    /** Oldest first. */
    readonly commitments: readonly PaidCommitment[];
    readonly beganOnRequest: boolean;
  },
  now: Date,
): WithdrawalWindow {
  const first = facts.commitments[0];
  if (!first) return { kind: 'closed', reason: 'nothing_paid', since: null, until: null };
  const since = first.at;
  const until = withdrawalUntil(since);
  if (facts.partyKind === 'business') return { kind: 'closed', reason: 'business', since, until };
  if (now.getTime() >= until.getTime()) return { kind: 'closed', reason: 'past', since, until };
  const rank = (tierId: PaidTierId) => MANAGED_TIERS.findIndex((t) => t.id === tierId);
  const tier = facts.commitments.reduce<PaidTierId>((top, c) => (rank(c.tierId) > rank(top) ? c.tierId : top), first.tierId);
  return { kind: 'open', since, until, tier, beganOnRequest: facts.beganOnRequest };
}

/** The share of an invoice a withdrawal credits: the days it paid for and were not used. */
export interface CreditShare {
  readonly daysPaid: number;
  readonly daysUsed: number;
  /** Days not used, of `denominator`, the days paid for. */
  readonly numerator: number;
  readonly denominator: number;
}

/**
 * An invoice's share to credit: it paid for `paidFrom` (`YYYY-MM-DD`) to
 * `periodEnd`, both counted; the days used run to the day of `withdrawnAt`,
 * counted, and only when the consumer asked us to begin before the fourteen
 * days were over.
 */
export function creditShare(paidFrom: string, periodEnd: string, withdrawnAt: Date, beganOnRequest: boolean): CreditShare {
  const from = dayOfDate(paidFrom);
  const daysPaid = Math.round((dayOfDate(periodEnd) - from) / DAY_MS) + 1;
  if (!Number.isInteger(daysPaid) || daysPaid < 1) throw new RangeError(`${paidFrom} to ${periodEnd} is not a period`);
  const used = Math.round((dayOf(withdrawnAt) - from) / DAY_MS) + 1;
  const daysUsed = beganOnRequest ? Math.min(Math.max(used, 0), daysPaid) : 0;
  return { daysPaid, daysUsed, numerator: daysPaid - daysUsed, denominator: daysPaid };
}

const MONTHS: Readonly<Record<NotificationLocale, readonly string[]>> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  nl: ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'],
};

/** A UTC day in words: `3 October 2026`, `3 oktober 2026`. No `Intl`, as the month's line has none. */
export function dayInWords(at: Date, locale: NotificationLocale): string {
  return `${at.getUTCDate()} ${MONTHS[locale][at.getUTCMonth()]} ${at.getUTCFullYear()}`;
}

/** A UTC moment in words, for the confirmation: `3 October 2026 at 10:04 UTC`. */
export function momentInWords(at: Date, locale: NotificationLocale): string {
  const time = `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')}`;
  return `${dayInWords(at, locale)} ${locale === 'nl' ? 'om' : 'at'} ${time} UTC`;
}

/** A withdrawal's credit note in words, `{invoice}` standing for the invoice's number. */
export function withdrawalCreditWords(share: CreditShare, withdrawnAt: Date, locale: NotificationLocale): string {
  const day = dayInWords(withdrawnAt, locale);
  const whole = share.numerator === share.denominator;
  if (locale === 'nl') {
    return whole
      ? `Herroeping op ${day}: factuur {invoice} volledig gecrediteerd`
      : `Herroeping op ${day}: ${share.numerator} van de ${share.denominator} dagen van factuur {invoice} gecrediteerd`;
  }
  return whole
    ? `Withdrawal on ${day}: invoice {invoice} credited in full`
    : `Withdrawal on ${day}: ${share.numerator} of the ${share.denominator} days of invoice {invoice} credited`;
}

/**
 * Whether the organisation may withdraw now, read in its own scope: its
 * invoice details' kind, and its yeses since its latest withdrawal.
 */
export async function readWithdrawalWindow(db: PgDatabase, tenantId: TenantId, now: Date): Promise<WithdrawalWindow> {
  const [party] = await db.select({ kind: billingParty.kind }).from(billingParty).where(eq(billingParty.tenantId, tenantId));
  const commitments = await db
    .select({ at: dataAllowance.consentedAt, tierId: dataAllowance.tierId })
    .from(dataAllowance)
    .where(and(eq(dataAllowance.tenantId, tenantId), sinceTheLatestWithdrawal(dataAllowance.consentedAt, tenantId)))
    .orderBy(asc(dataAllowance.consentedAt));
  // No yes records a request to begin before the fourteen days are over yet
  // (slice 7d): without one, the days used are not billed.
  return withdrawalWindow({ partyKind: party?.kind ?? null, commitments, beganOnRequest: false }, now);
}

/** What the consumer gives the withdrawal function (article 11a), and who pressed it. */
export interface WithdrawalStatement {
  /** The signed-in member's id. */
  readonly by: string;
  readonly name: string;
  /** Where the confirmation goes. */
  readonly confirmTo: string;
  readonly language: NotificationLocale;
  readonly via: 'screen' | 'support';
}

export type WithdrawOutcome =
  | {
      readonly kind: 'withdrawn';
      readonly withdrawnAt: Date;
      readonly since: Date;
      readonly tier: PaidTierId;
      readonly beganOnRequest: boolean;
      /** Each credit note recorded: its reference, the invoice's, and the share. */
      readonly credits: readonly { readonly reference: string; readonly invoice: string; readonly share: CreditShare }[];
    }
  | Extract<WithdrawalWindow, { kind: 'closed' }>;

/**
 * Withdraw from the contract, in the organisation's own transaction
 * (`withTenant`): recorded, Free from `now`, and each invoice of the contract
 * credited for the days not used. Closed is answered, and nothing written.
 */
export async function withdraw(
  db: PgDatabase,
  tenantId: TenantId,
  statement: WithdrawalStatement,
  now: Date,
): Promise<WithdrawOutcome> {
  // The locks a yes (billing routes) and a month's invoice (month-invoice.ts)
  // take: a yes or a step made while this runs waits, and then reads Free.
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'data_allowance:' + tenantId}))`);
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`month-invoice:${tenantId}`}, 0))`);
  const window = await readWithdrawalWindow(db, tenantId, now);
  if (window.kind === 'closed') return window;

  const [recorded] = await db
    .insert(contractWithdrawal)
    .values({
      tenantId,
      withdrawnAt: now,
      withdrawnBy: statement.by,
      name: statement.name.trim(),
      confirmTo: statement.confirmTo.trim(),
      contractSince: window.since,
      tierId: window.tier,
      beganOnRequest: window.beganOnRequest,
      language: statement.language,
      via: statement.via,
    })
    .returning({ id: contractWithdrawal.id });

  // The contract's invoices: every step made since it was concluded.
  const result = await db.execute(sql`
    SELECT id, reference, period_start::text AS period_start, period_end::text AS period_end,
           evidence->>'at' AS step_at, created_at
      FROM invoice
     WHERE tenant_id = ${tenantId} AND kind = 'invoice' AND status <> 'void' AND reference IS NOT NULL
       AND created_at >= ${window.since.toISOString()}::timestamptz
     ORDER BY created_at, reference`);
  const invoices = (
    result as unknown as {
      rows: { id: string; reference: string; period_start: string; period_end: string; step_at: string | null; created_at: Date | string }[];
    }
  ).rows;

  const credits: { reference: string; invoice: string; share: CreditShare }[] = [];
  for (const inv of invoices) {
    const stepAt = new Date(inv.step_at ?? inv.created_at);
    const stepDay = new Date(dayOf(stepAt)).toISOString().slice(0, 10);
    const paidFrom = stepDay > inv.period_start ? stepDay : inv.period_start;
    const share = creditShare(paidFrom, inv.period_end, now, window.beganOnRequest);
    if (share.numerator === 0) continue;
    const outcome = await recordCreditNote(db, tenantId, inv.id, {
      description: withdrawalCreditWords(share, now, statement.language),
      numerator: share.numerator,
      denominator: share.denominator,
      evidence: {
        reason: 'withdrawal',
        withdrawalId: recorded!.id,
        withdrawnAt: now.toISOString(),
        paidFrom,
        periodEnd: inv.period_end,
        daysPaid: share.daysPaid,
        daysUsed: share.daysUsed,
        beganOnRequest: window.beganOnRequest,
      },
    });
    if (outcome.kind === 'refused') throw new Error(`invoice ${inv.reference}: ${outcome.reason}`);
    credits.push({ reference: outcome.reference, invoice: inv.reference, share });
  }

  return {
    kind: 'withdrawn',
    withdrawnAt: now,
    since: window.since,
    tier: window.tier,
    beganOnRequest: window.beganOnRequest,
    credits,
  };
}
