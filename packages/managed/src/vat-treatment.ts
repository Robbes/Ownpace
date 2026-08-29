// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The VAT treatment: decided, recorded, never a constant (workplan 0111 T3).
 *
 * `pricing.ts` carries one hard-coded rate for everybody, which was
 * defensible while every customer was Dutch and became A STATED CORRECTNESS
 * BUG the day consumers across the EU became the primary market (owner
 * decision 2026-08-28). The treatment is not a number; it is a DECISION about
 * who the buyer is and where they are, and this module is that decision made
 * explicit, testable and total.
 *
 * ## What decides, and what it consumes
 *
 * The inputs are exactly what T1 and T2 built: the buyer's `kind` and
 * country (`billing_party`), and whether a VIES consultation stands for the
 * number as currently stored (`vat_consultation`, served by the same join
 * the billing page reads). Nothing here consults a network; the decision is
 * pure so it can be tested as a table.
 *
 * ## The conservative error, chosen on purpose
 *
 * An EU business WITHOUT a valid consultation is treated as a consumer:
 * charged the seller's domestic VAT. Both possible mistakes have owners —
 * charging VAT that was not due is the buyer's money and a credit note fixes
 * it; NOT charging VAT that was due is the seller's liability and an audit
 * finds it. The cheap-to-correct error is the default, and the rationale the
 * decision returns says so, so the surface can tell the customer what to do
 * about it (validate the number — T2's button).
 *
 * ## No percentage anywhere
 *
 * The output is a TREATMENT, not a rate. What percentage a treatment means
 * is the bookkeeping system's knowledge (ADR-0044): `moneybird-tax-rates.ts`
 * turns a treatment into one of the administration's own `tax_rate_id`s, and
 * the number on the invoice is forever Moneybird's, never ours.
 *
 * ## Geography notes that will bite whoever forgets them
 *
 * - This module speaks ISO 3166-1 (`GR`), because `billing_party` does. The
 *   EL/XI dialect is VIES's and stays inside `vies.ts`.
 * - Northern Ireland (XI) is EU-for-GOODS only. This product sells services,
 *   so a GB buyer is outside the EU VAT area even when their VAT number is
 *   an XI one that VIES happily validates.
 * - `destination_oss` exists in the enum from day one but stays unreachable
 *   until `ossActive` flips: the owner decided (2026-08-29) to wait for the
 *   €10,000 cross-border threshold, under which the seller's domestic rate
 *   applies to EU consumers everywhere.
 */

/** The EU VAT area, in ISO codes (GR, not VIES's EL). Twenty-seven. */
export const EU_VAT_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR',
  'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO',
  'SE', 'SI', 'SK',
]);

export type VatTreatment =
  /** The seller's own country's VAT, at whatever rate the books hold. */
  | 'domestic_standard'
  /** Art. 196 reverse charge: EU B2B across a border, VIES-validated. */
  | 'reverse_charge'
  /** Union OSS: EU consumer across a border, once the threshold decision flips. */
  | 'destination_oss'
  /** Export of services: the buyer is outside the EU VAT area. */
  | 'outside_eu';

export interface VatBuyer {
  readonly kind: 'consumer' | 'business';
  /** ISO 3166-1 alpha-2, as `billing_party.country_code` stores it. */
  readonly countryCode: string;
}

export interface VatDecisionInput {
  /**
   * The seller's member state, ISO. An instance fact (`OWNPACE_SELLER_COUNTRY`,
   * default NL) — the operating entity is still an accountant conversation.
   */
  readonly sellerCountry: string;
  /** Owner decision 2026-08-29: false until the €10k threshold arrives. */
  readonly ossActive: boolean;
  readonly buyer: VatBuyer;
  /**
   * The consultation standing for the CURRENTLY STORED number, or null.
   * The caller passes what T2's join serves, so staleness is already
   * handled: a changed number arrives here as null.
   */
  readonly consultation: { readonly valid: boolean } | null;
}

export interface VatDecision {
  readonly treatment: VatTreatment;
  /**
   * Why, in one English sentence — for API consumers and the audit trail.
   * The customer-facing wording is the page's, per locale.
   */
  readonly rationale: string;
}

/**
 * Decide the VAT treatment for one buyer. Pure and total: every combination
 * of the inputs has an answer, and the answer never contains a rate.
 */
export function decideVatTreatment(input: VatDecisionInput): VatDecision {
  const seller = input.sellerCountry.trim().toUpperCase();
  if (!EU_VAT_COUNTRIES.has(seller)) {
    // A non-EU seller is a different tax world entirely, and silently
    // proceeding would decide treatments under rules that do not apply.
    throw new Error(
      `The seller country is configured as ${seller}, which is not an EU member state — ` +
        'OWNPACE_SELLER_COUNTRY must name where the operating entity is established.',
    );
  }
  const buyerCountry = input.buyer.countryCode.trim().toUpperCase();

  if (!EU_VAT_COUNTRIES.has(buyerCountry)) {
    return {
      treatment: 'outside_eu',
      rationale:
        `The buyer is in ${buyerCountry}, outside the EU VAT area, so the sale is an export ` +
        'of services. (A GB buyer stays outside even with an XI-prefixed number: Northern ' +
        'Ireland is EU-for-goods only, and this is a service.)',
    };
  }

  if (buyerCountry === seller) {
    return {
      treatment: 'domestic_standard',
      rationale: `Buyer and seller are both in ${seller}: domestic VAT at the standard rate the books hold. Reverse charge never applies domestically.`,
    };
  }

  if (input.buyer.kind === 'business') {
    if (input.consultation?.valid) {
      return {
        treatment: 'reverse_charge',
        rationale:
          `EU business in ${buyerCountry} with a VIES-validated VAT number: reverse charge ` +
          '(art. 196) — no VAT on the invoice; the buyer accounts for it at home.',
      };
    }
    return {
      treatment: 'domestic_standard',
      rationale:
        `EU business in ${buyerCountry} WITHOUT a valid VIES consultation for the stored ` +
        'number: charged like a consumer, deliberately — over-charging is the buyer\'s money ' +
        'and a credit note fixes it, while under-charging is the seller\'s liability. ' +
        'Validate the number to switch to reverse charge.',
    };
  }

  if (input.ossActive) {
    return {
      treatment: 'destination_oss',
      rationale:
        `EU consumer in ${buyerCountry} with OSS active: VAT at the destination country's ` +
        'rate, reported through the One Stop Shop.',
    };
  }
  return {
    treatment: 'domestic_standard',
    rationale:
      `EU consumer in ${buyerCountry}, under the €10,000 cross-border threshold ` +
      `(owner decision 2026-08-29: no OSS yet): the seller's ${seller} rate applies.`,
  };
}
