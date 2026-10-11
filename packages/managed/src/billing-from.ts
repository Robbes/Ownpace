// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE FIRST MONTH THAT IS INVOICED (workplan 0111, decision 7; the owner,
 * 2026-10-05: *"ok, so first we leave this empty, and no one gat an
 * invoice?"*, and the answer is yes).
 *
 * `OWNPACE_BILLING_FROM=YYYY-MM` names the first month the month task
 * invoices. Empty or unset is off: nobody is invoiced, whatever runs. It is
 * set at the switch that ends the Alpha (docs/ending-the-alpha.md), which
 * ends on the first of a month, and the first invoices are made on that
 * month's first day. Months are UTC, as the peak's are (`occupancy_peak`,
 * managed 0015) and the picks' (`tier-pick.ts`).
 *
 * A value that is not a month is refused, and the refusal says what it read:
 * nothing is invoiced while it stands, so a typo is never read as "from the
 * beginning" nor as "never" without anybody hearing of it. The value is no
 * secret; the key and what it holds are both said.
 */

import { holdsAtCeiling } from './data-ceiling.ts';

/** The switch, as read: off, on from a month, or refused. */
export type BillingFrom =
  | { readonly kind: 'off' }
  | { readonly kind: 'on'; readonly from: string }
  | { readonly kind: 'refused'; readonly reason: string };

/** `YYYY-MM`, months 01 to 12. */
const A_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Reads `OWNPACE_BILLING_FROM`, as the task hands it in. */
export function readBillingFrom(raw: string | undefined): BillingFrom {
  const value = raw?.trim() ?? '';
  if (value === '') return { kind: 'off' };
  if (!A_MONTH.test(value)) {
    return {
      kind: 'refused',
      reason:
        `OWNPACE_BILLING_FROM is "${value}", which is not a month written YYYY-MM (2026-11, say). ` +
        'Nobody is invoiced until it is one, or empty (workplan 0111, decision 7).',
    };
  }
  return { kind: 'on', from: value };
}

/** The UTC month `at` falls in, as `YYYY-MM`. */
export function monthOf(at: Date): string {
  return at.toISOString().slice(0, 7);
}

/** Whether the month `at` falls in is invoiced under the switch: on, and not before its month. */
export function monthIsInvoiced(billing: BillingFrom, at: Date): boolean {
  return billing.kind === 'on' && monthOf(at) >= billing.from;
}

/** Why a run invoices nobody, and what it says; null when it invoices. */
export type NobodyInvoiced = {
  readonly reason: 'billing_from_empty' | 'alpha' | 'before_billing_from';
  readonly said: string;
} | null;

/**
 * The switch and the stage, as a run reads them before it reads anything about
 * anybody: off while `OWNPACE_BILLING_FROM` is empty, during the Alpha, and
 * before its month. A value that is not a month is refused, every run, by
 * what it read. The month task and the push ask it alike, so nothing makes
 * or sends an invoice while the other would not.
 */
export function whyNobodyIsInvoiced(billingFrom: string | undefined, stage: string | undefined, now: Date): NobodyInvoiced {
  const billing = readBillingFrom(billingFrom);
  if (billing.kind === 'refused') throw new Error(billing.reason);
  if (billing.kind === 'off') {
    return {
      reason: 'billing_from_empty',
      said: 'nobody is invoiced: OWNPACE_BILLING_FROM is empty (workplan 0111, decision 7).',
    };
  }
  if (!holdsAtCeiling(stage)) {
    return { reason: 'alpha', said: 'nobody is invoiced: OWNPACE_STAGE=alpha, and nothing is charged during the Alpha.' };
  }
  if (!monthIsInvoiced(billing, now)) {
    return {
      reason: 'before_billing_from',
      said: `nobody is invoiced yet: ${monthOf(now)} is before OWNPACE_BILLING_FROM, ${billing.from}.`,
    };
  }
  return null;
}
