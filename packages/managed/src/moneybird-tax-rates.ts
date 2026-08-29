// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A treatment becomes one of the books' own tax rates (workplan 0111 T3).
 *
 * ADR-0044's rule, made mechanical: **no VAT percentage lives in product
 * code.** `vat-treatment.ts` decides WHAT applies (a treatment); this module
 * turns that into WHICH of the Moneybird administration's own tax rates
 * carries it — a `tax_rate_id`, selected by the operator, validated against
 * the administration's real list, and never by matching a percentage this
 * repository would then have to know.
 *
 * ## Why the mapping is CONFIG and not cleverness
 *
 * The obvious shortcut — "find the 21% rate" — smuggles the number right
 * back into the code, one step removed, and breaks the day a government
 * changes it. The honest shape: the person who owns the administration picks
 * each rate in Moneybird's own UI and hands this deployment the ids
 * (`MONEYBIRD_TAX_RATE_ID_*`, wired where T4 consumes them — this module
 * takes them as parameters and reads no environment). `resolveTaxRateId`
 * then refuses, by name, anything the administration does not actually hold:
 * an id that does not exist, one that is inactive, one that is not a sales
 * rate. A mapping validated against the real list cannot silently rot when
 * somebody archives a rate in Moneybird.
 *
 * ## The same three-outcome honesty as vies.ts
 *
 * Fetching the list can fail; failing is never a verdict. `unavailable`
 * means ask again later, and nothing downstream may treat it as "no rates".
 * `destination_oss` resolves to `unresolved` on purpose for now: OSS rates
 * are per destination country, the owner decided to wait for the threshold,
 * and a placeholder mapping today would be a wrong number tomorrow.
 */

import type { VatTreatment } from './vat-treatment.ts';

export interface MoneybirdTaxRate {
  readonly id: string;
  readonly name: string;
  /** Moneybird's, verbatim (e.g. "21.0") — surfaced, never consulted for selection. */
  readonly percentage: string | null;
  readonly taxRateType: string | null;
  readonly active: boolean;
  readonly country: string | null;
}

export type FetchTaxRatesOutcome =
  | { readonly kind: 'ok'; readonly rates: readonly MoneybirdTaxRate[] }
  | { readonly kind: 'unavailable'; readonly reason: string };

/**
 * The administration's sales tax rates, from Moneybird's own API.
 * Injectable fetch for the same reason as `vies.ts`: a test of this module
 * must not be a test of Moneybird.
 */
export async function fetchSalesTaxRates(
  config: { readonly administrationId: string; readonly apiToken: string },
  fetchImpl: typeof fetch = fetch,
): Promise<FetchTaxRatesOutcome> {
  const url =
    `https://moneybird.com/api/v2/${encodeURIComponent(config.administrationId)}` +
    `/tax_rates.json?filter=${encodeURIComponent('tax_rate_type:sales_invoice')}`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${config.apiToken}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    return {
      kind: 'unavailable',
      reason: `Moneybird could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      kind: 'unavailable',
      reason: `Moneybird refused the token (HTTP ${response.status}) — check MONEYBIRD_API_TOKEN and the administration id.`,
    };
  }
  if (!response.ok) {
    return { kind: 'unavailable', reason: `Moneybird answered HTTP ${response.status}.` };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: 'unavailable', reason: 'Moneybird answered something that is not JSON.' };
  }
  if (!Array.isArray(body)) {
    return { kind: 'unavailable', reason: 'Moneybird answered a shape this client does not recognise.' };
  }
  const rates: MoneybirdTaxRate[] = [];
  for (const entry of body) {
    if (typeof entry !== 'object' || entry === null) continue;
    const raw = entry as Record<string, unknown>;
    // Moneybird ids are numeric strings; anything without id AND name is not
    // a rate anybody could have configured, so it is skipped rather than
    // invented.
    if (typeof raw.id !== 'string' || typeof raw.name !== 'string') continue;
    rates.push({
      id: raw.id,
      name: raw.name,
      percentage: typeof raw.percentage === 'string' ? raw.percentage : null,
      taxRateType: typeof raw.tax_rate_type === 'string' ? raw.tax_rate_type : null,
      active: raw.active === true,
      country: typeof raw.country === 'string' && raw.country !== '' ? raw.country : null,
    });
  }
  return { kind: 'ok', rates };
}

/**
 * The operator's mapping, one Moneybird `tax_rate_id` per treatment. Chosen
 * in Moneybird's UI, carried as instance facts — `MONEYBIRD_TAX_RATE_ID_DOMESTIC`,
 * `MONEYBIRD_TAX_RATE_ID_REVERSE_CHARGE`, optionally `MONEYBIRD_TAX_RATE_ID_OUTSIDE_EU`
 * — and validated here against what the administration really holds.
 */
export interface TaxRateIdConfig {
  readonly domesticStandard: string;
  readonly reverseCharge: string;
  /** Optional until a non-EU buyer exists; unset REFUSES rather than guesses. */
  readonly outsideEu?: string | null;
}

export type ResolveTaxRateOutcome =
  | {
      readonly kind: 'resolved';
      readonly taxRateId: string;
      readonly name: string;
      /** Moneybird's number, for display — the one place a percentage may come from. */
      readonly percentage: string | null;
    }
  | { readonly kind: 'unresolved'; readonly reason: string };

export function resolveTaxRateId(
  treatment: VatTreatment,
  config: TaxRateIdConfig,
  rates: readonly MoneybirdTaxRate[],
): ResolveTaxRateOutcome {
  if (treatment === 'destination_oss') {
    return {
      kind: 'unresolved',
      reason:
        'OSS rates are per destination country and OSS is not active (owner decision ' +
        '2026-08-29: wait for the €10k threshold) — configure the per-country mapping when it is.',
    };
  }
  const wanted =
    treatment === 'domestic_standard'
      ? config.domesticStandard
      : treatment === 'reverse_charge'
        ? config.reverseCharge
        : config.outsideEu;
  if (!wanted) {
    return {
      kind: 'unresolved',
      reason:
        `No tax rate is configured for the ${treatment} treatment — set the matching ` +
        'MONEYBIRD_TAX_RATE_ID_* to one of the administration\'s own sales rates.',
    };
  }
  const rate = rates.find((r) => r.id === wanted);
  if (!rate) {
    return {
      kind: 'unresolved',
      reason:
        `Tax rate ${wanted} (configured for ${treatment}) does not exist in the Moneybird ` +
        'administration — the mapping points at a rate that was deleted or belongs elsewhere.',
    };
  }
  if (!rate.active) {
    return {
      kind: 'unresolved',
      reason:
        `Tax rate ${wanted} ("${rate.name}", configured for ${treatment}) is INACTIVE in ` +
        'Moneybird — somebody archived it; pick its replacement in the administration.',
    };
  }
  if (rate.taxRateType !== null && rate.taxRateType !== 'sales_invoice') {
    return {
      kind: 'unresolved',
      reason:
        `Tax rate ${wanted} ("${rate.name}", configured for ${treatment}) is a ` +
        `${rate.taxRateType} rate, not a sales rate — it cannot go on a sales invoice.`,
    };
  }
  return { kind: 'resolved', taxRateId: rate.id, name: rate.name, percentage: rate.percentage };
}
