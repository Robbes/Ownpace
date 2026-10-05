// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * One invoice, pushed to the books (workplan 0111, slice 2 of §"The build,
 * sliced"): the rate, the contact, the invoice by its reference, the check,
 * the send, and the read back, in that order, in one function.
 *
 * Each step is idempotent, so the whole is: run it twice and the second run
 * finds the contact, finds the invoice by its reference, sees it is no longer
 * a draft, sends nothing, and reads it back. The task that calls it (slice 5)
 * retries by running it again, never by retrying a step.
 *
 * **The draft is checked before it is sent.** A draft has no number and can be
 * thrown away; a sent invoice is a legal document that only a credit note
 * corrects. So the draft's total is compared with what the lines add up to,
 * in the setting the invoice was made in (prices including VAT: the total
 * including VAT; excluding: the total excluding it), and a draft that
 * disagrees is left a draft and refused by name. Under a workflow whose
 * VAT setting was taken instead of stated, this is where 21% too much would
 * show.
 *
 * **What it needs from the administration** is read at run time, never kept
 * here: the treatment's tax rate (`resolveTaxRateId`, refused by name when it
 * is not there) and, for a price without Dutch VAT, the domestic rate's
 * percentage (`line-price.ts`).
 *
 * Outcomes: `issued` (numbered; `adopted` when it existed already, a retry's
 * answer), `refused` (a person must act: a missing rate, an invalid contact, a
 * draft that does not add up), `unavailable` (try again later) and
 * `slow_down` (a 429; try again after `retryAfterSeconds`).
 */

import { decimalFromCents, linePriceFor } from './line-price.ts';
import type { MoneybirdSettings } from './moneybird-config.ts';
import {
  ensureContact,
  ensureSalesInvoiceByReference,
  readSalesInvoice,
  sendSalesInvoice,
  type MoneybirdContactInput,
  type MoneybirdSalesInvoice,
} from './moneybird-sales-invoices.ts';
import type { SlowDown } from './moneybird-http.ts';
import { fetchSalesTaxRates, resolveTaxRateId } from './moneybird-tax-rates.ts';
import type { VatTreatment } from './vat-treatment.ts';

export interface InvoiceToPush {
  /** Ours, fixed once used: `ownpace-{organisation}-m-{YYYY-MM}-{tier}`. */
  readonly reference: string;
  /** Decided by `decideVatTreatment` from the buyer and their VIES evidence. */
  readonly treatment: VatTreatment;
  readonly buyer: MoneybirdContactInput;
  /** Each line's words (decision 8) and its published price, VAT included, in cents. */
  readonly lines: readonly { readonly description: string; readonly publishedCents: number }[];
}

export type PushOutcome =
  | {
      readonly kind: 'issued';
      readonly invoice: MoneybirdSalesInvoice;
      /** True when the invoice existed already: a retry, or a run that died after the send. */
      readonly adopted: boolean;
      readonly taxRateId: string;
      readonly pricesAreInclTax: boolean;
    }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | SlowDown;

/** The draft's total in the setting it was made in, against what its lines add up to. */
function draftDisagrees(invoice: MoneybirdSalesInvoice, pricesAreInclTax: boolean, expectedCents: number): string | null {
  if (invoice.pricesAreInclTax !== null && invoice.pricesAreInclTax !== pricesAreInclTax) {
    return (
      `its prices ${invoice.pricesAreInclTax ? 'include' : 'exclude'} VAT, and the lines were priced ` +
      `${pricesAreInclTax ? 'including' : 'excluding'} it`
    );
  }
  const total = pricesAreInclTax ? invoice.totalInclTaxCents : invoice.totalExclTaxCents;
  const which = pricesAreInclTax ? 'including' : 'excluding';
  if (total === null) return `Moneybird gave no total ${which} VAT that this client can read as cents`;
  if (total !== expectedCents) {
    return `its total ${which} VAT is ${decimalFromCents(total)}, and the lines add up to ${decimalFromCents(expectedCents)}`;
  }
  return null;
}

/** Pushes one invoice: rate, contact, invoice by reference, check, send, read back. */
export async function pushInvoice(
  settings: MoneybirdSettings,
  invoice: InvoiceToPush,
  fetchImpl?: typeof fetch,
): Promise<PushOutcome> {
  if (invoice.lines.length === 0) return { kind: 'refused', reason: `Invoice ${invoice.reference} has no lines.` };

  // 1. The rate, from the administration as it stands.
  const rates = await fetchSalesTaxRates(settings, fetchImpl);
  if (rates.kind !== 'ok') return rates;
  const rate = resolveTaxRateId(invoice.treatment, settings.taxRates, rates.rates);
  if (rate.kind === 'unresolved') return { kind: 'refused', reason: rate.reason };
  const domestic = resolveTaxRateId('domestic_standard', settings.taxRates, rates.rates);
  const domesticPercentage = domestic.kind === 'resolved' ? domestic.percentage : null;

  // 2. The lines' prices, in whole cents.
  const priced: { description: string; cents: number }[] = [];
  let pricesAreInclTax = true;
  for (const line of invoice.lines) {
    const price = linePriceFor(invoice.treatment, line.publishedCents, domesticPercentage);
    if (price.kind === 'refused') return { kind: 'refused', reason: price.reason };
    priced.push({ description: line.description, cents: price.cents });
    pricesAreInclTax = price.pricesAreInclTax;
  }
  const expectedCents = priced.reduce((sum, line) => sum + line.cents, 0);

  // 3. The contact, by our key, in step with the buyer's details.
  const contact = await ensureContact(settings, invoice.buyer, fetchImpl);
  if (contact.kind === 'refused' || contact.kind === 'unavailable' || contact.kind === 'slow_down') return contact;

  // 4. The invoice, by our reference.
  const ensured = await ensureSalesInvoiceByReference(
    settings,
    {
      contactId: contact.contact.id,
      reference: invoice.reference,
      workflowId: settings.workflowId,
      pricesAreInclTax,
      lines: priced.map((line) => ({
        description: line.description,
        price: decimalFromCents(line.cents),
        taxRateId: rate.taxRateId,
      })),
    },
    fetchImpl,
  );
  if (ensured.kind === 'refused' || ensured.kind === 'unavailable' || ensured.kind === 'slow_down') return ensured;
  const adopted = ensured.kind === 'exists';

  // 5. A draft is checked, then sent; anything else was sent before.
  if (ensured.invoice.state === 'draft') {
    const disagreement = draftDisagrees(ensured.invoice, pricesAreInclTax, expectedCents);
    if (disagreement) {
      return {
        kind: 'refused',
        reason:
          `The draft for ${invoice.reference} (Moneybird ${ensured.invoice.id}) was not sent: ${disagreement}. ` +
          "Check the workflow's VAT setting and the rate, then delete the draft in Moneybird.",
      };
    }
    const sent = await sendSalesInvoice(
      settings,
      ensured.invoice,
      settings.delivery === 'email' ? 'Email' : 'Manual',
      fetchImpl,
    );
    if (sent.kind === 'refused' || sent.kind === 'unavailable' || sent.kind === 'slow_down') return sent;
  }

  // 6. Read back what Moneybird holds now: the number and the date are its.
  const read = await readSalesInvoice(settings, ensured.invoice.id, fetchImpl);
  if (read.kind === 'unavailable' || read.kind === 'slow_down') return read;
  if (read.invoice.invoiceNumber === null || read.invoice.state === 'draft') {
    return {
      kind: 'unavailable',
      reason:
        `Invoice ${invoice.reference} (Moneybird ${read.invoice.id}) is not numbered yet ` +
        `(state ${read.invoice.state ?? 'not given'}); the next run reads it again and sends nothing twice.`,
    };
  }
  return { kind: 'issued', invoice: read.invoice, adopted, taxRateId: rate.taxRateId, pricesAreInclTax };
}
