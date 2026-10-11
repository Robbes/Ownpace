// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The nightly's sandbox invoice (workplan 0111, decision 12, widened by the
 * owner: *"can we do some kind of smoke test in the nightly, like adding an
 * invoice, paying it, but not sending out the invoice"*). `operator.sh
 * moneybird nightly`, run by the managed nightly gate (`smoke-managed.sh`).
 *
 * One invoice a night, the whole way round: made and numbered as the hourly
 * push makes them (`pushInvoice`), sent by hand, paid by a registered
 * payment, and read back as `paid`. Under the reference
 * `ownpace-nightly-{YYYY-MM-DD}`, so a second run the same night finds it and
 * makes nothing; a night whose invoice is not yet paid is paid, and one that
 * is reads back as it stands.
 *
 * **Under the sandbox's caps.** The month's invoices are counted first, and
 * from the fortieth on (of the sandbox's 50) the night makes none and says
 * so: about 31 nights a month leaves room for the operator's proof and a
 * person's test. The contact has no e-mail address and the delivery must be
 * `manual`, so the ten e-mails a month stay untouched.
 *
 * **Never on live**, refused as the proof refuses (`proofStackRefusal`). A
 * stack with Moneybird off is skipped and said, not failed: the gate proves
 * the books once the owner has given the nightly's stack the sandbox's keys.
 * The token appears in no line.
 */

import { decimalFromCents } from './line-price.ts';
import { moneybirdFromEnv } from './moneybird-config.ts';
import { PROOF_BUYER, PROOF_CENTS, proofStackRefusal } from './moneybird-proof.ts';
import { pushInvoice, type InvoiceToPush } from './moneybird-push.ts';
import { countSalesInvoicesThisMonth, readSalesInvoice, registerPayment } from './moneybird-sales-invoices.ts';

export interface MoneybirdNightly {
  /** False only when the night should fail the gate: a refusal, or the books not answering as they should. */
  readonly ok: boolean;
  /** True when the night made nothing on purpose: Moneybird off, or the month near the sandbox's cap. */
  readonly skipped: boolean;
  readonly lines: readonly string[];
}

/** From this many of the month's invoices on, the night makes none: the sandbox allows 50. */
export const NIGHTLY_MONTH_LIMIT = 40;

/** The night's reference: `ownpace-nightly-2026-10-10`, by UTC. */
export function nightlyReference(now: Date): string {
  return `ownpace-nightly-${now.toISOString().slice(0, 10)}`;
}

/** The night's invoice: one euro, domestic VAT, to Ownpace's own proof contact. */
export function nightlyInvoice(now: Date): InvoiceToPush {
  return {
    reference: nightlyReference(now),
    treatment: 'domestic_standard',
    buyer: PROOF_BUYER,
    lines: [
      {
        description: `Ownpace nightly, ${now.toISOString().slice(0, 10)}: made, paid and read back by the nightly gate`,
        publishedCents: PROOF_CENTS,
      },
    ],
  };
}

const failed = (lines: string[]): MoneybirdNightly => ({ ok: false, skipped: false, lines });

/** Makes, pays and reads back the night's sandbox invoice, or says why not. */
export async function nightlyMoneybird(
  env: Readonly<Record<string, string | undefined>>,
  now: Date,
  fetchImpl?: typeof fetch,
): Promise<MoneybirdNightly> {
  const refused = proofStackRefusal(env);
  if (refused) return failed([`No nightly invoice. ${refused}`]);

  const outcome = moneybirdFromEnv(env);
  if (outcome.kind === 'off') {
    return {
      ok: true,
      skipped: true,
      lines: ['Skipped: Moneybird is off on this stack (no MONEYBIRD_* key), so there are no books to prove tonight.'],
    };
  }
  if (outcome.kind === 'refused') return failed([`No nightly invoice. ${outcome.reason}`]);
  const settings = outcome.config;
  if (settings.delivery !== 'manual') {
    return failed([
      `No nightly invoice. MONEYBIRD_DELIVERY is ${settings.delivery}, and the nightly's invoice is never e-mailed: ` +
        'the sandbox allows ten e-mails a month. Set it to manual on this stack.',
    ]);
  }

  // The month's room first: the sandbox makes 50 a month.
  const counted = await countSalesInvoicesThisMonth(settings, NIGHTLY_MONTH_LIMIT, fetchImpl);
  if (counted.kind !== 'counted') return failed([`The month's invoices could not be counted (${counted.kind}): ${counted.reason}`]);
  if (counted.count >= NIGHTLY_MONTH_LIMIT) {
    return {
      ok: true,
      skipped: true,
      lines: [
        `Skipped: this month already has ${NIGHTLY_MONTH_LIMIT} or more invoices of the sandbox's 50, ` +
          'so the night makes none until the next month.',
      ],
    };
  }

  // Made and numbered, as the hourly push makes them.
  const invoice = nightlyInvoice(now);
  const pushed = await pushInvoice(settings, invoice, fetchImpl);
  if (pushed.kind !== 'issued') return failed([`The night's invoice did not go through (${pushed.kind}): ${pushed.reason}`]);
  const made = pushed.invoice;
  const lines = [
    pushed.adopted
      ? `Found tonight's invoice ${made.invoiceNumber} (${invoice.reference}), made by an earlier run.`
      : `Made invoice ${made.invoiceNumber} (${invoice.reference}), dated ${made.invoiceDate ?? 'without a date'}, sent by hand.`,
  ];

  // Paid by a registered payment, unless it reads back as paid already.
  if (made.state !== 'paid') {
    const cents = made.totalUnpaidCents ?? made.totalInclTaxCents;
    if (cents === null || cents <= 0) {
      return failed([...lines, `It is ${made.state ?? 'in no state'}, and Moneybird gave no amount still to pay.`]);
    }
    const paymentDate = now.toISOString().slice(0, 10);
    const paid = await registerPayment(settings, made.id, { paymentDate, cents }, fetchImpl);
    if (paid.kind !== 'registered') return failed([...lines, `The payment was not registered (${paid.kind}): ${paid.reason}`]);
    lines.push(`Registered a payment of €${decimalFromCents(cents)} on ${paymentDate}.`);
  }

  // And read back as paid: the state the Billing page will one day read.
  const read = await readSalesInvoice(settings, made.id, fetchImpl);
  if (read.kind !== 'ok') return failed([...lines, `It could not be read back (${read.kind}): ${read.reason}`]);
  if (read.invoice.state !== 'paid') {
    return failed([...lines, `It reads back as ${read.invoice.state ?? 'no state'}, not paid.`]);
  }
  lines.push('Read back as paid.');
  return { ok: true, skipped: false, lines };
}
