// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The tier a month bills (workplan 0109 T6; ADR-0014: what it used, never
 * above the agreed tier), and why, when the measurement is past it.
 */

import { describe, it, expect } from 'vitest';
import { allowanceOf, type AllowanceGrant } from './data-ceiling.ts';
import { billedTierOf } from './billed-tier.ts';
import { MANAGED_TIERS, deriveTier } from './tier-calculator.ts';

const tier = (id: string) => MANAGED_TIERS.find((t) => t.id === id)!;
const small = tier('small');
const onSmall: AllowanceGrant = { kind: 'tier', tierId: 'small', bandGb: small.dataGb };
const band: AllowanceGrant = { kind: 'top_up', tierId: 'small', bandGb: small.dataGb };

/** The month as measured, then billed. */
function billed(grants: AllowanceGrant[], peakPaths: number, gb: number) {
  return billedTierOf(deriveTier(peakPaths, gb).tier, allowanceOf(grants), peakPaths, gb);
}

describe('the tier a month bills', () => {
  it('is what it used, when that is within the agreed tier', () => {
    expect(billed([onSmall], 3, 500)).toEqual({ tier: small, beyond: [] });
  });

  it('falls with what was used: a quiet month on an agreed Medium bills what it used', () => {
    expect(billed([{ kind: 'tier', tierId: 'medium', bandGb: tier('medium').dataGb }], 1, 100).tier.id).toBe('free');
  });

  it('keeps Small when bands bought cover the data: top-ups buy room, never a tier', () => {
    // Small and one band: a ceiling of 1,500 GB. 1,000 GB measures as Medium.
    expect(deriveTier(2, 1000).tier?.id).toBe('medium');
    expect(billed([onSmall, band], 2, 1000)).toEqual({ tier: small, beyond: ['bands'] });
  });

  it('never climbs past the agreed tier when more ran at the same time than it runs', () => {
    // Eight at once, on Free: what an organisation still running from the alpha may show.
    expect(billed([], 8, 10)).toEqual({ tier: tier('free'), beyond: ['paths'] });
  });

  it('never climbs past the agreed tier when more was moved than its ceiling', () => {
    expect(billed([onSmall], 1, 800)).toEqual({ tier: small, beyond: ['data'] });
  });

  it('bills the agreed tier past the end of the table, and says why', () => {
    const xl = tier('xl');
    expect(billed([{ kind: 'tier', tierId: 'xl', bandGb: xl.dataGb }], xl.paths + 1, 10)).toEqual({
      tier: xl,
      beyond: ['paths'],
    });
  });
});
