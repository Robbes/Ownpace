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
 *
 * **Asked once more when Moneybird says try later.** On 2026-10-20 the
 * sandbox answered 404 to reading back the invoice it had just numbered, and
 * a run an hour later found it there (E2E (managed) #260 and #261): a lag in
 * the sandbox, not a fault in the books, painted a scheduled night red. So an
 * `unavailable` or `slow_down` answer to the count, to making the invoice
 * (`pushInvoice`, its own read back included) or to the read back after the
 * payment is asked once more, after 30 s, or after a 429's `Retry-After` when
 * it is two minutes or less; a 429 that asks for longer fails the night at
 * once rather than asking early. Making it again finds the invoice by its
 * reference and sends nothing twice. **A payment is never posted twice:** one
 * whose answer did not come is read instead, and the night goes on only if
 * the invoice reads as paid or has nothing left to pay; read as paid, that
 * read is the read back. One ask-again a night at most, and the lines keep
 * both answers. A refusal (`refused`), a wrong state and a refused payment
 * fail at once, as before. A refused token is filed as `unavailable` by
 * `moneybird-http.ts`, so it is asked once more and then fails with both
 * answers.
 */

import { decimalFromCents } from './line-price.ts';
import { moneybirdFromEnv } from './moneybird-config.ts';
import { PROOF_BUYER, PROOF_CENTS, proofStackRefusal } from './moneybird-proof.ts';
import type { SlowDown } from './moneybird-http.ts';
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

/** How long the night waits before it asks Moneybird once more, unless a 429 says. */
export const NIGHTLY_ASK_AGAIN_MS = 30_000;

/**
 * The longest `Retry-After` the night waits out: the gate has a run to finish.
 * A 429 that asks for longer is not asked again early; it fails the night.
 */
export const NIGHTLY_ASK_AGAIN_CAP_MS = 120_000;

export interface NightlyOptions {
  /** How the night waits before it asks again: a timer, unless a test gives a clock of its own. */
  readonly wait?: (ms: number) => Promise<void>;
}

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

/** Moneybird's "try later": no answer, an answer it should not have given, or a 429. */
type TryLater = { readonly kind: 'unavailable'; readonly reason: string } | SlowDown;

const isTryLater = (outcome: { readonly kind: string }): outcome is TryLater =>
  outcome.kind === 'unavailable' || outcome.kind === 'slow_down';

/**
 * 30 s, or a 429's `Retry-After` when it is two minutes or less. Null when it
 * asks for longer: the night does not ask again before Moneybird's time is up.
 */
function askAgainAfterMs(answer: TryLater): number | null {
  if (answer.kind === 'slow_down' && answer.retryAfterSeconds !== undefined) {
    const ms = answer.retryAfterSeconds * 1000;
    return ms <= NIGHTLY_ASK_AGAIN_CAP_MS ? ms : null;
  }
  return NIGHTLY_ASK_AGAIN_MS;
}

/** A line naming what did not happen, and Moneybird's answer. */
const said = (head: string, answer: { readonly kind: string; readonly reason: string }): string =>
  `${head} (${answer.kind}): ${answer.reason}`;

/** Makes, pays and reads back the night's sandbox invoice, or says why not. */
export async function nightlyMoneybird(
  env: Readonly<Record<string, string | undefined>>,
  now: Date,
  fetchImpl?: typeof fetch,
  options: NightlyOptions = {},
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

  const lines: string[] = [];
  // The night's one ask-again: the line that says so, then the wait. Once it
  // has asked, or when a 429 asks for longer than the night waits, `askAgain`
  // answers false, and what Moneybird said stands.
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let askedAgain = false;
  const askAgain = async (head: string, answer: TryLater, then: (after: string) => string): Promise<boolean> => {
    const ms = askAgainAfterMs(answer);
    if (askedAgain || ms === null) return false;
    askedAgain = true;
    lines.push(`${said(head, answer).replace(/\.$/, '')}; ${then(`after ${Math.round(ms / 1000)} s`)}.`);
    await wait(ms);
    return true;
  };
  const asked = (after: string) => `asked again ${after}`;

  // The month's room first: the sandbox makes 50 a month. Counted again only
  // when the count itself said try later, never when a later step asks again:
  // the night makes one invoice at most, so the room it found stays found.
  const countHead = "The month's invoices could not be counted";
  let counted = await countSalesInvoicesThisMonth(settings, NIGHTLY_MONTH_LIMIT, fetchImpl);
  if (isTryLater(counted) && (await askAgain(countHead, counted, asked))) {
    counted = await countSalesInvoicesThisMonth(settings, NIGHTLY_MONTH_LIMIT, fetchImpl);
  }
  if (counted.kind !== 'counted') return failed([...lines, said(countHead, counted)]);
  if (counted.count >= NIGHTLY_MONTH_LIMIT) {
    return {
      ok: true,
      skipped: true,
      lines: [
        ...lines,
        `Skipped: this month already has ${NIGHTLY_MONTH_LIMIT} or more invoices of the sandbox's 50, ` +
          'so the night makes none until the next month.',
      ],
    };
  }

  // Made and numbered, as the hourly push makes them. Asked again, the push
  // finds the invoice by its reference, and a sent one is not sent again.
  const invoice = nightlyInvoice(now);
  const pushHead = "The night's invoice did not go through";
  let pushed = await pushInvoice(settings, invoice, fetchImpl);
  const pushAskedAgain = isTryLater(pushed) && (await askAgain(pushHead, pushed, asked));
  if (pushAskedAgain) pushed = await pushInvoice(settings, invoice, fetchImpl);
  if (pushed.kind !== 'issued') return failed([...lines, said(pushHead, pushed)]);
  const made = pushed.invoice;
  lines.push(
    pushed.adopted
      ? `Found tonight's invoice ${made.invoiceNumber} (${invoice.reference}), ` +
          `made ${pushAskedAgain ? 'before the night asked again' : 'by an earlier run'}.`
      : `Made invoice ${made.invoiceNumber} (${invoice.reference}), dated ${made.invoiceDate ?? 'without a date'}, sent by hand.`,
  );

  // Paid by a registered payment, unless it reads back as paid already. A
  // payment is never posted twice: one whose answer did not come is read, and
  // a read that shows it paid is the read back, so a lag after it is no red.
  if (made.state !== 'paid') {
    const cents = made.totalUnpaidCents ?? made.totalInclTaxCents;
    if (cents === null || cents <= 0) {
      return failed([...lines, `It is ${made.state ?? 'in no state'}, and Moneybird gave no amount still to pay.`]);
    }
    const paymentDate = now.toISOString().slice(0, 10);
    const paid = await registerPayment(settings, made.id, { paymentDate, cents }, fetchImpl);
    if (paid.kind === 'refused') return failed([...lines, said('The payment was not registered', paid)]);
    if (paid.kind === 'registered') {
      lines.push(`Registered a payment of €${decimalFromCents(cents)} on ${paymentDate}.`);
    } else {
      const paymentHead = 'The payment was not confirmed';
      if (!(await askAgain(paymentHead, paid, (after) => `read the invoice again ${after} instead of paying again`))) {
        return failed([...lines, said(paymentHead, paid)]);
      }
      const reread = await readSalesInvoice(settings, made.id, fetchImpl);
      if (reread.kind !== 'ok') return failed([...lines, said('It could not be read again', reread)]);
      const state = reread.invoice.state;
      const left = reread.invoice.totalUnpaidCents;
      if (state !== 'paid' && (left === null || left > 0)) {
        return failed([
          ...lines,
          `It reads as ${state ?? 'no state'}` +
            (left === null ? ', and Moneybird gave no amount still to pay' : `, with €${decimalFromCents(left)} still to pay`) +
            '. The payment is not posted again: nothing is paid twice.',
        ]);
      }
      lines.push(
        `It reads as ${state === 'paid' ? 'paid' : `${state ?? 'no state'} with nothing left to pay`}: ` +
          'Moneybird registered the payment after all, so none was posted again.',
      );
      if (state === 'paid') {
        lines.push('Read back as paid.');
        return { ok: true, skipped: false, lines };
      }
    }
  }

  // And read back as paid: the state the Billing page will one day read.
  const readHead = 'It could not be read back';
  let read = await readSalesInvoice(settings, made.id, fetchImpl);
  if (isTryLater(read) && (await askAgain(readHead, read, asked))) {
    read = await readSalesInvoice(settings, made.id, fetchImpl);
  }
  if (read.kind !== 'ok') return failed([...lines, said(readHead, read)]);
  if (read.invoice.state !== 'paid') {
    return failed([...lines, `It reads back as ${read.invoice.state ?? 'no state'}, not paid.`]);
  }
  lines.push('Read back as paid.');
  return { ok: true, skipped: false, lines };
}
