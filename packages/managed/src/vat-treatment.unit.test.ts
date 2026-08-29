// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The treatment decision, as a table (workplan 0111 T3).
 *
 * Pure function, so the whole legal surface fits in one file of cases. The
 * load-bearing rows: the CONSERVATIVE default (an EU business without a valid
 * consultation is charged like a consumer, never trusted into reverse
 * charge), the OSS gate (unreachable until the owner flips it), and the
 * geography traps (GR is EU under its ISO name; GB is outside even though
 * VIES validates XI numbers — services, not goods).
 */

import { describe, it, expect } from 'vitest';
import { decideVatTreatment, EU_VAT_COUNTRIES } from './vat-treatment.ts';

const NL_SELLER = { sellerCountry: 'NL', ossActive: false } as const;

describe('decideVatTreatment', () => {
  it('a domestic buyer gets domestic VAT, consumer and business alike', () => {
    expect(
      decideVatTreatment({
        ...NL_SELLER,
        buyer: { kind: 'consumer', countryCode: 'NL' },
        consultation: null,
      }).treatment,
    ).toBe('domestic_standard');
    // Reverse charge NEVER applies domestically, however validated the number.
    expect(
      decideVatTreatment({
        ...NL_SELLER,
        buyer: { kind: 'business', countryCode: 'NL' },
        consultation: { valid: true },
      }).treatment,
    ).toBe('domestic_standard');
  });

  it('an EU consumer across the border stays at the seller rate until OSS flips', () => {
    const under = decideVatTreatment({
      ...NL_SELLER,
      buyer: { kind: 'consumer', countryCode: 'DE' },
      consultation: null,
    });
    expect(under.treatment).toBe('domestic_standard');
    expect(under.rationale).toContain('threshold');

    const over = decideVatTreatment({
      sellerCountry: 'NL',
      ossActive: true,
      buyer: { kind: 'consumer', countryCode: 'DE' },
      consultation: null,
    });
    expect(over.treatment).toBe('destination_oss');
  });

  it('reverse charge requires a VALID consultation — the whole point of T2', () => {
    expect(
      decideVatTreatment({
        ...NL_SELLER,
        buyer: { kind: 'business', countryCode: 'DE' },
        consultation: { valid: true },
      }).treatment,
    ).toBe('reverse_charge');
  });

  it('an EU business WITHOUT a valid consultation is charged like a consumer, on purpose', () => {
    // The conservative error: over-charging is the buyer's money and a credit
    // note fixes it; under-charging is the seller's liability. Absent and
    // invalid consultations land the same way.
    for (const consultation of [null, { valid: false }]) {
      const decision = decideVatTreatment({
        ...NL_SELLER,
        buyer: { kind: 'business', countryCode: 'DE' },
        consultation,
      });
      expect(decision.treatment).toBe('domestic_standard');
      expect(decision.rationale).toMatch(/without a valid/i);
    }
  });

  it('outside the EU VAT area is an export, business and consumer, GB included', () => {
    // GB stays outside even though VIES validates XI numbers: Northern
    // Ireland is EU-for-GOODS only, and this is a service.
    for (const kind of ['consumer', 'business'] as const) {
      const decision = decideVatTreatment({
        ...NL_SELLER,
        buyer: { kind, countryCode: 'GB' },
        consultation: kind === 'business' ? { valid: true } : null,
      });
      expect(decision.treatment).toBe('outside_eu');
    }
    expect(
      decideVatTreatment({
        ...NL_SELLER,
        buyer: { kind: 'consumer', countryCode: 'CH' },
        consultation: null,
      }).treatment,
    ).toBe('outside_eu');
  });

  it('speaks ISO: Greece is GR here (the EL dialect stays inside vies.ts)', () => {
    expect(EU_VAT_COUNTRIES.has('GR')).toBe(true);
    expect(EU_VAT_COUNTRIES.has('EL')).toBe(false);
    expect(EU_VAT_COUNTRIES.has('XI')).toBe(false);
    expect(EU_VAT_COUNTRIES.size).toBe(27);
    expect(
      decideVatTreatment({
        ...NL_SELLER,
        buyer: { kind: 'consumer', countryCode: 'gr' },
        consultation: null,
      }).treatment,
    ).toBe('domestic_standard');
  });

  it('refuses a non-EU seller configuration instead of deciding under the wrong rules', () => {
    expect(() =>
      decideVatTreatment({
        sellerCountry: 'US',
        ossActive: false,
        buyer: { kind: 'consumer', countryCode: 'NL' },
        consultation: null,
      }),
    ).toThrow(/OWNPACE_SELLER_COUNTRY/);
  });

  it('never returns a rate — the decision is a treatment, the number is the books’', () => {
    const decision = decideVatTreatment({
      ...NL_SELLER,
      buyer: { kind: 'consumer', countryCode: 'NL' },
      consultation: null,
    });
    // No percentage anywhere in the output (ADR-0044): "21", "0.21", "%".
    expect(JSON.stringify(decision)).not.toMatch(/21|%/);
  });
});
