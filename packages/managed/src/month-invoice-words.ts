// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE WORDS ON A MONTH'S INVOICE LINE (workplan 0111, decision 8; 0109 T5:
 * *"One line, a tier name, a peak and a date"*).
 *
 * In the organisation's language, the tier, the month, and why the month bills
 * that tier, as the owner took them on 2026-10-05:
 *
 *   Ownpace Medium, oktober 2026: 12 migraties tegelijk op 3 oktober
 *   Ownpace Large, oktober 2026: 1,6 TB gemigreerd in totaal
 *   Ownpace Small, oktober 2026: het pakket dat u koos
 *
 * Two cases the decision has no words for, said here and named in the PR for
 * the owner's reading:
 *
 *   - the month bills the tier agreed to while what was used went past it (a
 *     band bought covers the data, or more ran than the tier runs):
 *     *het pakket waarmee u akkoord ging* / *the tier you agreed to*;
 *   - a move up, invoiced for the difference: the line names the tier the
 *     month now bills and adds what was invoiced before it,
 *     *, min het al gefactureerde pakket Small* / *, less Small already
 *     invoiced*, so a price below the list's says why.
 *
 * The amount moved is never printed on or under the line it crossed: a Large
 * invoice that read "1,5 TB" would say the data fits Medium. It is the tenths
 * of a TB rounded, or whole GB rounded, or, at the line itself, whole GB
 * rounded up; whichever comes first that stands above it.
 *
 * Plain tables and arithmetic, no `Intl`: a legal document's words should not
 * depend on which locale data the runtime was built with.
 */

import type { NotificationLocale } from '@openmig/shared';
import { MANAGED_TIERS, type ManagedTier } from './tier-calculator.ts';

/** Why a month bills its tier, as the line says it. */
export type BilledBy = 'paths' | 'data' | 'picked' | 'agreed';

const MONTHS: Readonly<Record<NotificationLocale, readonly string[]>> = {
  en: [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ],
  nl: [
    'januari', 'februari', 'maart', 'april', 'mei', 'juni',
    'juli', 'augustus', 'september', 'oktober', 'november', 'december',
  ],
};

const DECIMAL: Readonly<Record<NotificationLocale, string>> = { en: '.', nl: ',' };
const THOUSANDS: Readonly<Record<NotificationLocale, string>> = { en: ',', nl: '.' };

/** A whole number with the language's thousands separator. */
function whole(n: number, locale: NotificationLocale): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, THOUSANDS[locale]);
}

/**
 * The data moved, in the line's words: `1,6 TB` or `640 GB`, never at or
 * under `aboveGb`, the ceiling of the tier below, when the amount is past it.
 */
export function dataAmount(gb: number, locale: NotificationLocale, aboveGb: number): string {
  const past = gb > aboveGb;
  if (Math.round(gb) >= 1000) {
    const tenths = Math.round(gb / 100);
    if (!past || tenths * 100 > aboveGb) {
      const units = Math.floor(tenths / 10);
      const tenth = tenths % 10;
      return `${whole(units, locale)}${tenth === 0 ? '' : `${DECIMAL[locale]}${tenth}`} TB`;
    }
  }
  const rounded = Math.round(gb);
  if (!past || rounded > aboveGb) return `${whole(rounded, locale)} GB`;
  return `${whole(Math.ceil(gb), locale)} GB`;
}

/** What the line is made from. */
export interface MonthLineFacts {
  readonly tier: ManagedTier;
  /** Any moment in the month invoiced; read in UTC. */
  readonly month: Date;
  readonly by: BilledBy;
  /** The month's peak of migrations at the same time, and when it was set (ISO), for `paths`. */
  readonly peakPaths: number;
  readonly peakAt: string | null;
  /** The data counted, in decimal GB, for `data`. */
  readonly gbCounted: number;
  /** The highest tier the month's invoices already name, when this line is a move up's difference. */
  readonly after: ManagedTier | null;
}

/** The ceiling of the tier below this one: what a data-decided amount stands above. */
function ceilingBelow(tier: ManagedTier): number {
  const place = MANAGED_TIERS.findIndex((t) => t.id === tier.id);
  return place > 0 ? MANAGED_TIERS[place - 1]!.dataGb : 0;
}

/** Why the month bills its tier, in the line's words. */
function because(facts: MonthLineFacts, locale: NotificationLocale): string {
  switch (facts.by) {
    case 'paths': {
      const day = facts.peakAt ? new Date(facts.peakAt) : null;
      const on = day ? `${day.getUTCDate()} ${MONTHS[locale][day.getUTCMonth()]}` : null;
      if (locale === 'nl') return `${facts.peakPaths} migraties tegelijk${on ? ` op ${on}` : ''}`;
      return `${facts.peakPaths} migrations at the same time${on ? ` on ${on}` : ''}`;
    }
    case 'data': {
      const amount = dataAmount(facts.gbCounted, locale, ceilingBelow(facts.tier));
      return locale === 'nl' ? `${amount} gemigreerd in totaal` : `${amount} migrated in total`;
    }
    case 'picked':
      return locale === 'nl' ? 'het pakket dat u koos' : 'the tier you picked';
    case 'agreed':
      return locale === 'nl' ? 'het pakket waarmee u akkoord ging' : 'the tier you agreed to';
  }
}

/** The line: the tier, the month, why, and, for a move up, what was invoiced before it. */
export function monthLine(facts: MonthLineFacts, locale: NotificationLocale): string {
  const month = `${MONTHS[locale][facts.month.getUTCMonth()]} ${facts.month.getUTCFullYear()}`;
  const line = `Ownpace ${facts.tier.name}, ${month}: ${because(facts, locale)}`;
  if (!facts.after) return line;
  return locale === 'nl'
    ? `${line}, min het al gefactureerde pakket ${facts.after.name}`
    : `${line}, less ${facts.after.name} already invoiced`;
}
