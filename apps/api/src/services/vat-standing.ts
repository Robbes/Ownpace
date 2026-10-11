// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * What an organisation's VAT number stands for right now is read in
 * `@openmig/managed` (`vat-standing.ts`), where the push reads it too (0111
 * slice 5). Re-exported here so the API's two readers keep their import.
 */

export { billingPartyColumns, readVatStanding, vatConsultationColumns } from '@openmig/managed';

/**
 * The company name the grant page may show (workplan 0108 T8a, the owner's
 * decision of 2026-09-23): the name the EU VAT register gave for this
 * organisation's number, when the LATEST check of the number stored now said
 * valid and disclosed a name.
 *
 * Null otherwise, and each of those is deliberate: a consumer (nothing to
 * check, and their name is not the page's to show), no number, never checked,
 * checked and invalid (an older valid answer does not outvote a newer
 * refusal), changed since the check, or a member state that does not disclose
 * names (VIES answers `---`, which `checkVat` already stores as no name).
 */
export function checkedCompanyName(standing: {
  readonly vatConsultation: { readonly valid: boolean; readonly traderName: string | null } | null;
}): string | null {
  const answer = standing.vatConsultation;
  if (!answer || !answer.valid) return null;
  const name = answer.traderName?.trim();
  return name ? name : null;
}
