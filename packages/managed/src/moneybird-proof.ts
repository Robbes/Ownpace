// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `operator.sh moneybird proof`: one invoice, made by hand, to prove the books
 * end to end (workplan 0111, decision 12, slice 5 of §"The build, sliced").
 *
 * `moneybird check` reads; this writes, once. It pushes one invoice the way
 * the hourly push does (`pushInvoice`: the rate, the contact, the invoice by
 * its reference, the check, the send, the read back) and says what Moneybird
 * made of it: the number, the date and the total. It answers "would an
 * invoice go through" on the stack whose `.env` names the administration,
 * before anybody is invoiced there.
 *
 * **One a month, and never twice.** The reference is `ownpace-proof-{YYYY-MM}`,
 * so running it again in the same month finds the invoice by its reference,
 * sends nothing, and answers that it exists (`adopted`). A repeated command
 * spends nothing of the sandbox's 50 invoices a month.
 *
 * **Never by e-mail, and never on live.** The sandbox allows ten e-mails a
 * month and a proof needs none: its contact has no e-mail address, and it
 * refuses unless `MONEYBIRD_DELIVERY` is `manual`. Live's books are real, and
 * a proof there would be a real invoice with a real number that only a credit
 * note takes back, so it refuses a stack that runs `NODE_ENV=production`, as
 * live does, and one that names no `NODE_ENV`, which cannot say it is not
 * live. Each refusal comes before Moneybird is asked anything.
 *
 * The buyer is Ownpace's own proof contact, under a customer id no
 * organisation's can take (theirs are `ownpace-{uuid}`), so no customer's
 * contact is touched. The token appears in no line.
 */

import { decimalFromCents } from './line-price.ts';
import { moneybirdFromEnv } from './moneybird-config.ts';
import { pushInvoice, type InvoiceToPush } from './moneybird-push.ts';
import type { MoneybirdContactInput } from './moneybird-sales-invoices.ts';

export interface MoneybirdProof {
  /** True when the proof went through: made now, or found made earlier this month. */
  readonly ok: boolean;
  readonly lines: readonly string[];
}

/** Ownpace's own contact for the proof: a company in the Netherlands, without an e-mail address. */
export const PROOF_BUYER: MoneybirdContactInput = {
  customerId: 'ownpace-proof',
  companyName: 'Ownpace proof',
  address1: 'Proefstraat 1',
  zipcode: '1234 AB',
  city: 'Proefdorp',
  country: 'NL',
  email: null,
};

/** What the proof charges, VAT included: one euro. */
export const PROOF_CENTS = 100;

/** The month's proof reference: `ownpace-proof-2026-10`. One a month, by UTC. */
export function proofReference(now: Date): string {
  return `ownpace-proof-${now.toISOString().slice(0, 7)}`;
}

/** The proof invoice for the month `now` falls in. */
export function proofInvoice(now: Date): InvoiceToPush {
  const month = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(now);
  return {
    reference: proofReference(now),
    treatment: 'domestic_standard',
    buyer: PROOF_BUYER,
    lines: [{ description: `Ownpace proof, ${month}: made by hand to prove the books`, publishedCents: PROOF_CENTS }],
  };
}

/**
 * Why this stack may not make a proof invoice, before Moneybird is asked
 * anything; null when it may. The proof and the nightly ask it alike.
 */
export function proofStackRefusal(env: Readonly<Record<string, string | undefined>>): string | null {
  const nodeEnv = env.NODE_ENV?.trim() ?? '';
  if (nodeEnv === '') {
    return (
      'This stack names no NODE_ENV, so it cannot say it is not live. The proof runs on a test stack ' +
      'against a sandbox administration; set NODE_ENV in .env as managed.yml requires.'
    );
  }
  if (nodeEnv === 'production') {
    return (
      'This stack runs NODE_ENV=production, as live does: its books are real, and a proof there would ' +
      'be a real invoice with a real number that only a credit note takes back. Run the proof on the ' +
      'OTA stack, against the sandbox administration.'
    );
  }
  return null;
}

/** Makes this month's proof invoice, or finds it made, and says what Moneybird holds. */
export async function proveMoneybird(
  env: Readonly<Record<string, string | undefined>>,
  now: Date,
  fetchImpl?: typeof fetch,
): Promise<MoneybirdProof> {
  const refused = proofStackRefusal(env);
  if (refused) return { ok: false, lines: [`No proof was made. ${refused}`] };

  const outcome = moneybirdFromEnv(env);
  if (outcome.kind === 'off') {
    return {
      ok: false,
      lines: ['No proof was made. Moneybird is off: no MONEYBIRD_* key is set, so there are no books to prove.'],
    };
  }
  if (outcome.kind === 'refused') return { ok: false, lines: [`No proof was made. ${outcome.reason}`] };
  const settings = outcome.config;
  if (settings.delivery !== 'manual') {
    return {
      ok: false,
      lines: [
        `No proof was made. MONEYBIRD_DELIVERY is ${settings.delivery}, and a proof is never e-mailed: ` +
          'the sandbox allows ten e-mails a month. Set it to manual on this stack.',
      ],
    };
  }

  const invoice = proofInvoice(now);
  const pushed = await pushInvoice(settings, invoice, fetchImpl);
  if (pushed.kind === 'slow_down') {
    const wait = pushed.retryAfterSeconds === undefined ? 'a while' : `${pushed.retryAfterSeconds} seconds`;
    return { ok: false, lines: [`Moneybird asked to slow down. Run the proof again in ${wait}; nothing is made twice.`] };
  }
  if (pushed.kind !== 'issued') {
    return { ok: false, lines: [`The proof did not go through (${pushed.kind}): ${pushed.reason}`] };
  }

  const made = pushed.invoice;
  const total = made.totalInclTaxCents === null ? 'a total this client cannot read' : `€${decimalFromCents(made.totalInclTaxCents)}`;
  const what = `invoice ${made.invoiceNumber} (${invoice.reference}), dated ${made.invoiceDate ?? 'without a date'}`;
  if (pushed.adopted) {
    return {
      ok: true,
      lines: [
        `It exists: ${what}, state ${made.state ?? 'not given'}. Nothing was made or sent.`,
        "One proof a month: the next is next month's.",
      ],
    };
  }
  return {
    ok: true,
    lines: [
      `Made ${what}: ${total} including VAT, under rate ${pushed.taxRateId}.`,
      'Sent by hand (delivery Manual): no e-mail went out.',
      'Running this again this month answers that it exists.',
    ],
  };
}
